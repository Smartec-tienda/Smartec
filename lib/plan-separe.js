/* ============================================================
   SMARTEC · plan-separe.js
   Módulo de Plan Separe (apartado / separado) para el POS.

   Funcionalidades:
   - Crear un plan separe con cuota inicial mínima configurable
   - Registrar abonos
   - Completar el plan (genera venta real + comprobante contable)
   - Cancelar el plan (reintegra stock + retención del 10%)
   - Alertas de vencimiento (30 días por defecto)

   Colección Firestore: 'planSepare'

   Requiere:
   - window.SmartecFIFO (para consumir lotes)
   - window.SmartecAccounting (para comprobantes)
   - window.SmartecPUC (para mapas del PUC)
   - db, auth, userData (se pasan por init())

   Uso:
     window.SmartecPlanSepare.init({ db, auth, userData, ... });
     const result = await window.SmartecPlanSepare.create({...});
============================================================ */
(function () {
  'use strict';

  /* ============================================================
     ESTADO INTERNO
  ============================================================ */
  let _ctx = null;               // { db, auth, userData, audit, ... }
  let _initialized = false;

  /* ============================================================
     CONSTANTES
  ============================================================ */
  const DEFAULT_MIN_PCT = 0.40;       // 40% cuota inicial mínima
  const DEFAULT_DAYS = 30;            // 30 días de plazo
  const DEFAULT_CANCEL_FEE_PCT = 0.10; // 10% retención al cancelar

  const STATUS = {
    ACTIVO: 'activo',
    COMPLETADO: 'completado',
    CANCELADO: 'cancelado',
    VENCIDO: 'vencido'
  };

  /* ============================================================
     HELPERS
  ============================================================ */
  const _fmt = n => '$ ' + Math.round(Number(n || 0)).toLocaleString('es-CO');

  const _todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const _addDays = (dateStr, days) => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + Number(days || 0));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const _daysBetween = (dateStr1, dateStr2) => {
    const d1 = new Date(dateStr1 + 'T12:00:00');
    const d2 = new Date(dateStr2 + 'T12:00:00');
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  };

  const _isExpired = (plan) => {
    if (!plan || plan.status !== STATUS.ACTIVO) return false;
    if (!plan.dueDate) return false;
    return plan.dueDate < _todayStr();
  };

  /* ============================================================
     INIT
  ============================================================ */
  function init(context) {
    if (_initialized) {
      console.warn('[PlanSepare] Ya inicializado. Ignorando init().');
      return;
    }

    if (!context || !context.db) {
      throw new Error('[PlanSepare] init() requiere { db, ... }');
    }

    _ctx = {
      db: context.db,
      auth: context.auth || null,
      // 🆕 Soportar tanto valor directo como getter (función)
      userData: typeof context.userData === 'function'
        ? context.userData
        : (() => context.userData || null),
      audit: context.audit || (() => Promise.resolve()),
      // 🆕 Opcional: generador de consecutivos de venta (si está disponible)
      generateDocumentNumber: context.generateDocumentNumber || null,
      // Funciones de Firestore que se inyectan desde el caller
      collection: context.collection,
      doc: context.doc,
      getDoc: context.getDoc,
      getDocs: context.getDocs,
      addDoc: context.addDoc,
      updateDoc: context.updateDoc,
      deleteDoc: context.deleteDoc,
      setDoc: context.setDoc,
      query: context.query,
      where: context.where,
      orderBy: context.orderBy,
      limit: context.limit,
      runTransaction: context.runTransaction,
      serverTimestamp: context.serverTimestamp,
      Timestamp: context.Timestamp
    };

    _initialized = true;
    console.log('[PlanSepare] ✅ Inicializado');
  }

  /* ============================================================
     CONSECUTIVO · Genera el número del Plan Separe
     Formato: XXX-PS-YYYY-#### (ej: TIE-PS-2026-0001)
     Usa transacción para evitar duplicados.
  ============================================================ */
  async function generatePlanNumber(storeId) {
    if (!storeId) throw new Error('[PlanSepare] storeId requerido');

    const year = new Date().getFullYear();
    const counterId = `${storeId}_planSepare_${year}`;
    const ref = _ctx.doc(_ctx.db, 'counters', counterId);

    // Verificar si existe; si no, crearlo
    const preSnap = await _ctx.getDoc(ref);
    if (!preSnap.exists()) {
      const prefix = storeId.slice(0, 3).toUpperCase() + '-PS-' + year + '-';
      await _ctx.setDoc(ref, {
        prefix,
        lastNumber: 0,
        type: 'planSepare',
        storeId,
        year,
        createdAt: _ctx.serverTimestamp(),
        autoCreated: true,
        createdBy: _ctx.userData()?.email || 'system'
      });
    }

    // Incrementar en transacción
    const result = await _ctx.runTransaction(_ctx.db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Contador no inicializado: ' + counterId);
      const data = snap.data();
      const nextNumber = (Number(data.lastNumber) || 0) + 1;
      transaction.update(ref, {
        lastNumber: nextNumber,
        updatedAt: _ctx.serverTimestamp()
      });
      return {
        number: nextNumber,
        prefix: data.prefix,
        fullNumber: data.prefix + String(nextNumber).padStart(4, '0')
      };
    });

    return result;
  }

  /* ============================================================
     CREAR · Crea un nuevo Plan Separe
     
     Params:
       {
         storeId, storeName,
         customer: { name, phone, email, address, city },
         items: [ { productId, variantId, name, sku, colorName, size,
                    qty, unitPrice, subtotal } ],
         initialPayment: {
           amount,        // cuota inicial (debe ser >= minPct * total)
           method,        // 'efectivo' | 'transferencia' | ...
           channelId,     // opcional si method === 'transferencia'
           cardId,        // opcional si method === 'tarjeta'
           notes          // opcional
         },
         notes,           // notas generales del plan
         storeConfig: {
           planSepareMinPct,  // 0.40 por defecto
           planSepareDays,    // 30 por defecto
           cancelFeePct       // 0.10 por defecto
         }
       }
     
     Returns:
       { success, planId, planNumber, plan? } o { success: false, error }
  ============================================================ */
  async function create(params) {
    try {
      if (!_initialized) throw new Error('[PlanSepare] No inicializado. Llama a init() primero.');

      const {
        storeId, storeName,
        customer = {},
        items = [],
        initialPayment = {},
        notes = '',
        storeConfig = {}
      } = params || {};

      // ============================================================
      // VALIDACIONES BÁSICAS
      // ============================================================
      if (!storeId) return { success: false, error: 'Falta storeId.' };
      if (!items.length) return { success: false, error: 'Debe haber al menos 1 producto.' };
      if (!customer.name) return { success: false, error: 'El nombre del cliente es obligatorio.' };
      if (!customer.phone) return { success: false, error: 'El teléfono del cliente es obligatorio.' };

      // ============================================================
      // CÁLCULO DE TOTALES
      // ============================================================
      const total = items.reduce((s, it) => s + Number(it.subtotal || (it.qty * it.unitPrice) || 0), 0);
      if (total <= 0) return { success: false, error: 'El total del plan debe ser mayor a 0.' };

      // ============================================================
      // CUOTA INICIAL MÍNIMA
      // ============================================================
      const minPct = Number(storeConfig.planSepareMinPct ?? DEFAULT_MIN_PCT);
      const minAmount = Math.round(total * minPct);
      const initialAmount = Number(initialPayment.amount || 0);

      if (initialAmount < minAmount) {
        return {
          success: false,
          error: `La cuota inicial mínima es ${_fmt(minAmount)} (${Math.round(minPct * 100)}%). ` +
                 `El cliente ofreció ${_fmt(initialAmount)}.`
        };
      }
      if (initialAmount > total) {
        return { success: false, error: `La cuota inicial no puede superar el total (${_fmt(total)}).` };
      }

      // ============================================================
      // MÉTODO DE PAGO
      // ============================================================
      const validMethods = ['efectivo', 'transferencia', 'tarjeta'];
      const method = initialPayment.method || 'efectivo';
      if (!validMethods.includes(method)) {
        return { success: false, error: `Método de pago inválido: ${method}.` };
      }
      if (method === 'transferencia' && !initialPayment.channelId) {
        return { success: false, error: 'Selecciona el canal para la transferencia.' };
      }
      if (method === 'tarjeta' && !initialPayment.cardId) {
        return { success: false, error: 'Selecciona la tarjeta de crédito.' };
      }

      // ============================================================
      // CONSECUTIVO
      // ============================================================
      const docInfo = await generatePlanNumber(storeId);

      // ============================================================
      // FECHAS
      // ============================================================
      const startDate = _todayStr();
      const days = Number(storeConfig.planSepareDays ?? DEFAULT_DAYS);
      const dueDate = _addDays(startDate, days);

      // ============================================================
      // POLÍTICA DE CANCELACIÓN
      // ============================================================
      const cancelFeePct = Number(storeConfig.cancelFeePct ?? DEFAULT_CANCEL_FEE_PCT);
      const cancellationPolicy =
        `Se retiene el ${Math.round(cancelFeePct * 100)}% del valor abonado si el cliente cancela el plan.`;

      // ============================================================
      // ABONO INICIAL
      // ============================================================
      // 🆕 Nota: Firestore no permite serverTimestamp() dentro de arrays.
      // Para los abonos usamos ISO string (fecha local del cliente).
      const nowISO = new Date().toISOString();
      const firstAbono = {
        amount: initialAmount,
        date: startDate,
        method,
        channelId: initialPayment.channelId || null,
        cardId: initialPayment.cardId || null,
        notes: initialPayment.notes || 'Cuota inicial',
        registeredBy: _ctx.userData()?.email || null,
        registeredByName: _ctx.userData()?.name || null,
        registeredAt: nowISO,               // ✅ ISO string (no serverTimestamp)
        isInitial: true
      };

      // ============================================================
      // ARMAR DOCUMENTO
      // ============================================================
      const planData = {
        // Identificación
        planNumber: docInfo.fullNumber,
        planNumberRaw: docInfo.number,
        storeId,
        storeName: storeName || '',

        // Cliente
        customerId: customer.customerId || customer.phone || null,
        customerName: customer.name || '',
        customerPhone: customer.phone || '',
        customerEmail: customer.email || '',
        customerAddress: customer.address || '',
        customerCity: customer.city || '',

        // Productos
        items: items.map(it => ({
          productId: it.productId || null,
          variantId: it.variantId || null,
          name: it.name || '',
          sku: it.sku || '',
          colorName: it.colorName || null,
          size: it.size || null,
          qty: Number(it.qty || 0),
          unitPrice: Number(it.unitPrice || 0),
          subtotal: Number(it.subtotal || (it.qty * it.unitPrice) || 0),
          unitCost: Number(it.unitCost || 0)   // se recalcula al completar
        })),
        itemsCount: items.length,
        totalQty: items.reduce((s, it) => s + Number(it.qty || 0), 0),

        // Valores
        total,
        abonado: initialAmount,
        saldo: total - initialAmount,

        // Abonos
        abonos: [firstAbono],

        // Fechas
        startDate,
        dueDate,
        completedAt: null,
        cancelledAt: null,

        // Estados
        status: STATUS.ACTIVO,

        // Política
        cancellationPolicy,
        cancellationFeePct: cancelFeePct,

        // Configuración del plan
        minInitialPct: minPct,
        minInitialAmount: minAmount,

        // Venta final (se llena al completar)
        saleId: null,
        saleDocumentNumber: null,

        // Comprobantes contables
        anticipoComprobanteId: null,
        ventaComprobanteId: null,
        cancelacionComprobanteId: null,

        // Metadata
        notes,
        createdBy: _ctx.userData()?.email || null,
        createdByName: _ctx.userData()?.name || null,
        createdAt: _ctx.serverTimestamp(),
        updatedAt: _ctx.serverTimestamp(),
        updatedBy: null
      };

      // ============================================================
      // GUARDAR EN FIRESTORE
      // ============================================================
      const planRef = await _ctx.addDoc(_ctx.collection(_ctx.db, 'planSepare'), planData);
      const planId = planRef.id;

      console.log('[PlanSepare] ✅ Plan creado:', docInfo.fullNumber, '·', _fmt(total));

      // ============================================================
      // AUDITORÍA
      // ============================================================
      try {
        await _ctx.audit({
          action: 'create',
          collection: 'planSepare',
          docId: planId,
          after: {
            planNumber: docInfo.fullNumber,
            customerName: customer.name,
            total,
            initialAmount,
            saldo: total - initialAmount
          },
          note: `Plan Separe ${docInfo.fullNumber} · ${customer.name} · ${_fmt(total)} · Cuota inicial ${_fmt(initialAmount)}`
        });
      } catch (e) {
        console.warn('[PlanSepare] Error en auditoría:', e);
      }

      // ============================================================
      // 🆕 CONTABILIZACIÓN EN BACKGROUND (no bloquea el plan)
      // Si falla, el plan ya quedó creado y se puede regenerar.
      // ============================================================
      (async function generarComprobanteAnticipoAsync() {
        try {
          const compId = await generateAnticipoComprobante({
            planId,
            planNumber: docInfo.fullNumber,
            storeId,
            storeName: storeName || '',
            customerName: customer.name,
            amount: initialAmount,
            method,
            channelId: initialPayment.channelId || null,
            cardId: initialPayment.cardId || null,
            date: startDate,
            note: initialPayment.notes || 'Cuota inicial',
            abonoIndex: 0
          });

          if (compId) {
            // Actualizar el plan con el ID del comprobante
            try {
              await _ctx.updateDoc(_ctx.doc(_ctx.db, 'planSepare', planId), {
                anticipoComprobanteId: compId,
                updatedAt: _ctx.serverTimestamp()
              });
              console.log(`[PlanSepare] ✅ Comprobante de anticipo vinculado al plan ${docInfo.fullNumber}`);
            } catch (linkErr) {
              console.warn('[PlanSepare] No se pudo vincular comprobante al plan:', linkErr);
            }
          }
        } catch (err) {
          console.warn('[PlanSepare] Error en comprobante de anticipo (el plan sí quedó creado):', err);
        }
      })();

      return {
        success: true,
        planId,
        planNumber: docInfo.fullNumber,
        plan: { id: planId, ...planData }
      };

    } catch (e) {
      console.error('[PlanSepare] Error creando plan:', e);
      return { success: false, error: e.message || 'Error desconocido' };
    }
  }

  /* ============================================================
     🆕 HELPERS CONTABLES · Genera números de comprobante
     Formato: COMP-YYYY-#### (transacción atómica)
  ============================================================ */
  async function generateCompNumber() {
    const year = new Date().getFullYear();
    const counterId = `comprobantes_${year}`;
    const ref = _ctx.doc(_ctx.db, 'counters', counterId);

    // Verificar si existe; si no, crearlo
    const preSnap = await _ctx.getDoc(ref);
    if (!preSnap.exists()) {
      await _ctx.setDoc(ref, {
        prefix: `COMP-${year}-`,
        lastNumber: 0,
        type: 'comprobante',
        year,
        createdAt: _ctx.serverTimestamp(),
        autoCreated: true,
        createdBy: _ctx.userData()?.email || 'system'
      });
    }

    const result = await _ctx.runTransaction(_ctx.db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Contador no inicializado: ' + counterId);
      const data = snap.data();
      const nextNumber = (Number(data.lastNumber) || 0) + 1;
      transaction.update(ref, {
        lastNumber: nextNumber,
        updatedAt: _ctx.serverTimestamp()
      });
      return {
        number: nextNumber,
        prefix: data.prefix,
        fullNumber: data.prefix + String(nextNumber).padStart(4, '0')
      };
    });

    return result;
  }

  /* ============================================================
     🆕 COMPROBANTE DE ANTICIPO
     Registra el ingreso del dinero como pasivo (anticipo de cliente).
     
     Asiento:
       D 110505 Caja general            (según método de pago)
          C 281505 Ingresos recibidos para terceros
     
     Es idempotente: si ya existe un comprobante para este
     (planId, abonoIndex), no lo duplica.
     
     Params:
       {
         planId, planNumber,
         storeId, storeName,
         customerName,
         amount,
         method,          // 'efectivo' | 'transferencia' | 'tarjeta'
         channelId,       // si transferencia
         cardId,          // si tarjeta
         date,            // 'YYYY-MM-DD'
         note,            // opcional
         abonoIndex       // 0 para el inicial, 1+ para los siguientes
       }
     
     Returns: compId | null (si falla)
  ============================================================ */
  async function generateAnticipoComprobante(params) {
    try {
      const {
        planId, planNumber, storeId, storeName,
        customerName, amount, method,
        channelId, cardId, date, note, abonoIndex = 0
      } = params || {};

      // Verificar que el motor contable esté disponible
      if (!window.SmartecAccounting || !window.SmartecAccounting.buildMovementsFromComprobante) {
        console.warn('[PlanSepare] accounting-engine no disponible — se omite comprobante');
        return null;
      }

      // Determinar la cuenta débito (caja/banco/tarjeta)
      let debitAccount = { code: '110505', name: 'Caja general' };
      let methodNote = 'Efectivo';

      if (method === 'transferencia') {
        // Buscar el canal para obtener la cuenta PUC
        let channel = null;
        if (channelId) {
          try {
            const chSnap = await _ctx.getDoc(_ctx.doc(_ctx.db, 'paymentChannels', channelId));
            if (chSnap.exists()) channel = chSnap.data();
          } catch (e) {
            console.warn('[PlanSepare] No se pudo leer canal:', e);
          }
        }
        debitAccount = {
          code: channel?.pucAccountCode || '111005',
          name: channel?.pucAccountName || channel?.bank || 'Bancos'
        };
        methodNote = `Transferencia · ${channel?.bank || ''}`.trim();
      } else if (method === 'tarjeta') {
        // Buscar la tarjeta para obtener la cuenta PUC
        let card = null;
        if (cardId) {
          try {
            const cdSnap = await _ctx.getDoc(_ctx.doc(_ctx.db, 'creditCards', cardId));
            if (cdSnap.exists()) card = cdSnap.data();
          } catch (e) {
            console.warn('[PlanSepare] No se pudo leer tarjeta:', e);
          }
        }
        // En tarjeta de crédito, el "pago" no ingresa efectivo sino que genera pasivo
        debitAccount = {
          code: card?.pucAccountCode || '210505',
          name: card?.pucAccountName || 'Bancos nacionales (tarjeta)'
        };
        methodNote = `Tarjeta · ${card?.name || ''}`.trim();
      }

      // Cuenta crédito: anticipos de clientes (pasivo)
      const creditAccount = {
        code: '281505',
        name: 'Ingresos recibidos para terceros'
      };

      // Construir el comprobante
      const nowISO = new Date().toISOString();
      const docInfo = await generateCompNumber();

      const comprobante = {
        number: docInfo.fullNumber,
        numberRaw: docInfo.number,
        date: date || _todayStr(),
        type: 'ingreso',
        concept: `Anticipo Plan Separe ${planNumber || ''} · ${customerName || ''}`.trim(),
        storeId: storeId || null,
        storeName: storeName || '',
        notes: note || `Anticipo recibido (abono #${abonoIndex + 1})`,
        items: [
          {
            accountCode: debitAccount.code,
            accountName: debitAccount.name,
            type: 'D',
            amount: Number(amount || 0),
            note: methodNote
          },
          {
            accountCode: creditAccount.code,
            accountName: creditAccount.name,
            type: 'C',
            amount: Number(amount || 0),
            note: `Anticipo del cliente: ${customerName || '—'}`
          }
        ],
        totalDebit: Number(amount || 0),
        totalCredit: Number(amount || 0),
        status: 'activo',
        sourceType: 'planSepare',
        sourceId: planId,
        sourceRef: planNumber,
        abonoIndex,
        createdAt: _ctx.serverTimestamp(),
        createdBy: _ctx.auth?.currentUser?.uid || _ctx.userData()?.uid || null,
        createdByName: _ctx.userData()?.name || _ctx.userData()?.email || null,
        updatedAt: _ctx.serverTimestamp()
      };

      // Idempotencia: verificar que no exista ya
      const dupQuery = _ctx.query(
        _ctx.collection(_ctx.db, 'comprobantes'),
        _ctx.where('sourceType', '==', 'planSepare'),
        _ctx.where('sourceId', '==', planId),
        _ctx.where('abonoIndex', '==', abonoIndex)
      );
      const dupSnap = await _ctx.getDocs(dupQuery);
      if (!dupSnap.empty) {
        console.log('[PlanSepare] Comprobante de anticipo ya existe:', dupSnap.docs[0].id);
        return dupSnap.docs[0].id;
      }

      // Guardar el comprobante
      const compRef = await _ctx.addDoc(_ctx.collection(_ctx.db, 'comprobantes'), comprobante);
      console.log(`[PlanSepare] ✅ Comprobante anticipo ${docInfo.fullNumber} · $${amount}`);

      // Proyectar a movimientos
      try {
        const pucBase = (window.SmartecPUC && window.SmartecPUC.getBase)
          ? window.SmartecPUC.getBase()
          : [];
        const pucMap = window.SmartecAccounting.buildPucMap(pucBase);

        const movements = window.SmartecAccounting.buildMovementsFromComprobante(
          { id: compRef.id, ...comprobante },
          pucMap,
          {
            createdBy: _ctx.userData()?.uid || null,
            createdByName: _ctx.userData()?.name || _ctx.userData()?.email || null
          }
        );

        for (const mv of movements) {
          if (mv.dateTs && mv.dateTs instanceof Date && _ctx.Timestamp) {
            mv.dateTs = _ctx.Timestamp.fromDate(mv.dateTs);
          }
          await _ctx.addDoc(_ctx.collection(_ctx.db, 'movimientos'), mv);
        }
        console.log(`[PlanSepare] ✅ ${movements.length} movimiento(s) contable(s) creados`);
      } catch (movErr) {
        console.warn('[PlanSepare] Error proyectando movimientos:', movErr);
        // No bloqueamos — el comprobante ya quedó guardado
      }

      // Auditoría
      try {
        await _ctx.audit({
          action: 'create',
          collection: 'comprobantes',
          docId: compRef.id,
          after: {
            planNumber,
            abonoIndex,
            amount,
            debitAccount: debitAccount.code,
            creditAccount: creditAccount.code
          },
          note: `Anticipo Plan Separe ${planNumber}: ${_fmt(amount)} · Abono #${abonoIndex + 1}`
        });
      } catch (e) {
        console.warn('[PlanSepare] Error en auditoría:', e);
      }

      return compRef.id;

    } catch (e) {
      console.error('[PlanSepare] Error generando comprobante de anticipo:', e);
      return null;
    }
  }

  /* ============================================================
     🆕 REGISTRAR ABONO POSTERIOR
     Permite agregar un abono a un plan existente.
     
     Validaciones:
       - El plan debe existir y estar en estado 'activo'.
       - El monto debe ser > 0 y <= saldo pendiente.
       - El método de pago debe ser válido (efectivo/transferencia/tarjeta).
       - Si es transferencia o tarjeta, requiere el channelId/cardId.
     
     Efectos:
       - Agrega el abono al array 'abonos[]'.
       - Actualiza 'abonado' y 'saldo'.
       - Si saldo === 0, marca status: 'completado' (Fase 2.3).
       - En background: genera comprobante contable del abono.
     
     Params:
       {
         planId,            // ID del doc en Firestore
         amount,            // monto del abono (> 0 y <= saldo)
         method,            // 'efectivo' | 'transferencia' | 'tarjeta'
         channelId,         // si method === 'transferencia'
         cardId,            // si method === 'tarjeta'
         date,              // 'YYYY-MM-DD' (default: hoy)
         notes              // opcional
       }
     
     Returns:
       { success, abonoIndex, newAbonado, newSaldo, plan? } | { success: false, error }
  ============================================================ */
  async function addPayment(params) {
    try {
      if (!_initialized) throw new Error('[PlanSepare] No inicializado.');

      const {
        planId,
        amount: rawAmount,
        method: rawMethod,
        channelId = null,
        cardId = null,
        date = _todayStr(),
        notes = ''
      } = params || {};

      // ============================================================
      // VALIDACIONES BÁSICAS
      // ============================================================
      if (!planId) return { success: false, error: 'Falta planId.' };

      const amount = Math.round(Number(rawAmount) || 0);
      if (amount <= 0) return { success: false, error: 'El monto debe ser mayor a 0.' };

      const method = rawMethod || 'efectivo';
      const validMethods = ['efectivo', 'transferencia', 'tarjeta'];
      if (!validMethods.includes(method)) {
        return { success: false, error: `Método de pago inválido: ${method}.` };
      }
      if (method === 'transferencia' && !channelId) {
        return { success: false, error: 'Selecciona el canal para la transferencia.' };
      }
      if (method === 'tarjeta' && !cardId) {
        return { success: false, error: 'Selecciona la tarjeta de crédito.' };
      }

      // ============================================================
      // LEER EL PLAN
      // ============================================================
      const planRef = _ctx.doc(_ctx.db, 'planSepare', planId);
      const planSnap = await _ctx.getDoc(planRef);

      if (!planSnap.exists()) {
        return { success: false, error: 'El plan no existe.' };
      }

      const plan = { id: planId, ...planSnap.data() };

      if (plan.status !== STATUS.ACTIVO) {
        return {
          success: false,
          error: `Este plan ya no está activo (estado: ${plan.status}).`
        };
      }

      const saldoActual = Number(plan.saldo || 0);
      if (saldoActual <= 0) {
        return { success: false, error: 'Este plan ya está pagado en su totalidad.' };
      }

      if (amount > saldoActual) {
        return {
          success: false,
          error: `El abono (${_fmt(amount)}) supera el saldo pendiente (${_fmt(saldoActual)}).`
        };
      }

      // ============================================================
      // ARMAR EL NUEVO ABONO
      // ============================================================
      const abonosActuales = Array.isArray(plan.abonos) ? plan.abonos : [];
      const abonoIndex = abonosActuales.length;

      const nowISO = new Date().toISOString();
      const nuevoAbono = {
        amount,
        date,
        method,
        channelId: channelId || null,
        cardId: cardId || null,
        notes: notes || `Abono #${abonoIndex}`,
        registeredBy: _ctx.userData()?.email || null,
        registeredByName: _ctx.userData()?.name || null,
        registeredAt: nowISO,
        isInitial: false,
        abonoIndex
      };

      const newAbonado = Number(plan.abonado || 0) + amount;
      const newSaldo = saldoActual - amount;
      const nuevoEstado = newSaldo <= 0 ? 'pendiente-cierre' : STATUS.ACTIVO;
      // ⚠️ 'pendiente-cierre' es un estado temporal.
      // El paso 2.3 lo cambia a 'completado' cuando se ejecute complete().

      // ============================================================
      // ACTUALIZAR EL PLAN
      // ============================================================
      await _ctx.updateDoc(planRef, {
        abonos: [...abonosActuales, nuevoAbono],
        abonado: newAbonado,
        saldo: newSaldo,
        status: nuevoEstado,
        updatedAt: _ctx.serverTimestamp(),
        updatedBy: _ctx.userData()?.email || null
      });

      console.log(`[PlanSepare] ✅ Abono #${abonoIndex} registrado: ${_fmt(amount)} · Nuevo saldo: ${_fmt(newSaldo)}`);

      // ============================================================
      // AUDITORÍA
      // ============================================================
      try {
        await _ctx.audit({
          action: 'update',
          collection: 'planSepare',
          docId: planId,
          before: { abonado: plan.abonado, saldo: plan.saldo, status: plan.status },
          after: { abonado: newAbonado, saldo: newSaldo, status: nuevoEstado },
          note: `Abono #${abonoIndex} al plan ${plan.planNumber}: ${_fmt(amount)} · Saldo: ${_fmt(newSaldo)}`
        });
      } catch (e) {
        console.warn('[PlanSepare] Error en auditoría:', e);
      }

      // ============================================================
      // 🆕 CONTABILIZAR EN BACKGROUND (no bloquea)
      // ============================================================
      (async function generarComprobanteAbonoAsync() {
        try {
          const compId = await generateAnticipoComprobante({
            planId,
            planNumber: plan.planNumber,
            storeId: plan.storeId,
            storeName: plan.storeName || '',
            customerName: plan.customerName,
            amount,
            method,
            channelId,
            cardId,
            date,
            note: notes || `Abono #${abonoIndex}`,
            abonoIndex
          });

          if (compId) {
            // Guardar el compId en el abono (para trazabilidad)
            try {
              const planSnap2 = await _ctx.getDoc(planRef);
              if (planSnap2.exists()) {
                const plan2 = planSnap2.data();
                const abonos2 = Array.isArray(plan2.abonos) ? plan2.abonos : [];
                const idx = abonos2.findIndex(a => a.abonoIndex === abonoIndex);
                if (idx >= 0) {
                  abonos2[idx].comprobanteId = compId;
                  await _ctx.updateDoc(planRef, {
                    abonos: abonos2,
                    updatedAt: _ctx.serverTimestamp()
                  });
                }
              }
            } catch (linkErr) {
              console.warn('[PlanSepare] No se pudo vincular compId al abono:', linkErr);
            }
          }
        } catch (err) {
          console.warn('[PlanSepare] Error en comprobante de abono (el abono sí quedó registrado):', err);
        }
      })();

      // ============================================================
      // RETORNAR
      // ============================================================
      return {
        success: true,
        planId,
        abonoIndex,
        newAbonado,
        newSaldo,
        saldoCero: newSaldo <= 0,
        plan: { ...plan, abonos: [...abonosActuales, nuevoAbono], abonado: newAbonado, saldo: newSaldo }
      };

    } catch (e) {
      console.error('[PlanSepare] Error registrando abono:', e);
      return { success: false, error: e.message || 'Error desconocido' };
    }
  }

  /* ============================================================
     🆕 COMPLETAR PLAN
     Se llama cuando el cliente ya pagó el 100% del plan y va a
     reclamar el producto.
     
     Efectos en orden:
       1. Valida plan (existe, activo, saldo === 0)
       2. Valida stock suficiente de cada item
       3. Descuenta stock con FIFO (transacción atómica)
       4. Genera la venta real en 'sales'
       5. Genera el comprobante contable doble (venta + costo)
       6. Actualiza el plan con status 'completado'
     
     Params:
       { planId }
     
     Returns:
       { success, saleId, documentNumber, total, totalCost, profit } | { success: false, error }
  ============================================================ */
  async function complete(params) {
    try {
      if (!_initialized) throw new Error('[PlanSepare] No inicializado.');

      const { planId } = params || {};
      if (!planId) return { success: false, error: 'Falta planId.' };

      // ============================================================
      // 1. LEER Y VALIDAR EL PLAN
      // ============================================================
      const planRef = _ctx.doc(_ctx.db, 'planSepare', planId);
      const planSnap = await _ctx.getDoc(planRef);

      if (!planSnap.exists()) {
        return { success: false, error: 'El plan no existe.' };
      }

      const plan = { id: planId, ...planSnap.data() };

      if (plan.status === STATUS.COMPLETADO) {
        return { success: false, error: 'Este plan ya está completado.' };
      }
      if (plan.status === STATUS.CANCELADO) {
        return { success: false, error: 'Este plan está cancelado.' };
      }
      if (plan.status !== STATUS.ACTIVO && plan.status !== 'pendiente-cierre') {
        return { success: false, error: `Estado del plan no válido: ${plan.status}.` };
      }

      const saldo = Number(plan.saldo || 0);
      if (saldo > 0) {
        return {
          success: false,
          error: `El cliente aún debe ${_fmt(saldo)}. Solo se puede completar cuando el saldo es 0.`
        };
      }

      // ============================================================
      // 2. VALIDAR STOCK
      // ============================================================
      const items = plan.items || [];
      if (!items.length) {
        return { success: false, error: 'El plan no tiene items.' };
      }

      const storeId = plan.storeId;

      // Leer todo el inventario de la tienda de una vez
      const invQuery = _ctx.query(
        _ctx.collection(_ctx.db, 'inventory'),
        _ctx.where('storeId', '==', storeId)
      );
      const invSnap = await _ctx.getDocs(invQuery);
      const inventoryData = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Validar stock
      const stockIssues = [];
      for (const it of items) {
        const invId = `${storeId}_${it.variantId}`;
        let inv = inventoryData.find(i => i.id === invId);
        if (!inv) inv = inventoryData.find(i => i.storeId === storeId && i.variantId === it.variantId);
        const stock = inv ? Number(inv.stock || 0) : 0;
        if (stock < Number(it.qty || 0)) {
          stockIssues.push({
            name: it.name,
            sku: it.sku,
            needed: it.qty,
            available: stock
          });
        }
      }

      if (stockIssues.length) {
        const detail = stockIssues.map(s =>
          `• ${s.name} (${s.sku}): requiere ${s.needed}, disponible ${s.available}`
        ).join('\n');
        return {
          success: false,
          error: `Stock insuficiente para completar el plan:\n\n${detail}\n\nActualiza el inventario antes de continuar.`,
          stockIssues
        };
      }

      // ============================================================
      // 3. GENERAR NÚMERO DE VENTA
      // ============================================================
      // Reusamos el generador de consecutivos de remisión
      // (formato: XXX-REM-YYYY-####)
      let documentNumber = null;
      try {
        // Intenta usar el generador del POS si está disponible
        if (typeof _ctx.generateDocumentNumber === 'function') {
          const docInfo = await _ctx.generateDocumentNumber(storeId, 'remision');
          documentNumber = docInfo.fullNumber;
        } else {
          // Fallback: generar uno manual
          documentNumber = `PLAN-${plan.planNumber}-${Date.now().toString().slice(-4)}`;
        }
      } catch (docErr) {
        console.warn('[PlanSepare] No se pudo generar consecutivo, usando fallback:', docErr);
        documentNumber = `PLAN-${plan.planNumber}-${Date.now().toString().slice(-4)}`;
      }

      // ============================================================
      // 4. DESCONTAR STOCK CON FIFO (transacción atómica)
      // ============================================================
      const FIFO = window.SmartecFIFO;
      if (!FIFO) {
        return { success: false, error: 'El módulo de inventario (FIFO) no está disponible.' };
      }

      const movimientosParaRegistrar = [];
      const itemsConCostoReal = [];

      try {
        await _ctx.runTransaction(_ctx.db, async (transaction) => {
          const invDocs = [];

          // PASO 1: LEER TODOS
          for (const it of items) {
            const invId = `${storeId}_${it.variantId}`;
            const invRef = _ctx.doc(_ctx.db, 'inventory', invId);
            const invSnap = await transaction.get(invRef);

            if (!invSnap.exists()) {
              throw new Error(`Inventario no encontrado para ${it.name}.`);
            }

            const invData = invSnap.data();
            const stockActual = Number(invData.stock || 0);

            if (stockActual < it.qty) {
              throw new Error(
                `Stock insuficiente para "${it.name}": disponible ${stockActual}, requerido ${it.qty}.`
              );
            }

            // Normalizar y consumir FIFO
            const fallbackCost = Number(it.unitCost || 0);
            const normalized = FIFO.normalizeInventory(
              { stock: stockActual, batches: invData.batches },
              fallbackCost
            );

            const consumeResult = FIFO.consumeFIFO(normalized.batches, it.qty);

            if (!consumeResult.ok) {
              throw new Error(`Stock insuficiente en lotes para "${it.name}". Faltan ${consumeResult.missing}.`);
            }

            invDocs.push({
              ref: invRef,
              stockBefore: stockActual,
              stockAfter: FIFO.sumBatchesQty(consumeResult.newBatches),
              batchesAfter: consumeResult.newBatches,
              consumedBatches: consumeResult.consumed,
              avgCost: consumeResult.avgCost,
              item: it
            });
          }

          // PASO 2: ESCRIBIR
          for (const d of invDocs) {
            transaction.update(d.ref, {
              stock: d.stockAfter,
              batches: d.batchesAfter,
              updatedAt: _ctx.serverTimestamp()
            });

            const itemCopy = { ...d.item };
            itemCopy.consumedBatches = d.consumedBatches;
            itemCopy.unitCost = d.avgCost;
            itemsConCostoReal.push(itemCopy);

            movimientosParaRegistrar.push({
              storeId,
              productId: d.item.productId,
              variantId: d.item.variantId,
              sku: d.item.sku,
              productName: d.item.name,
              type: 'salida',
              qtyBefore: d.stockBefore,
              qtyAfter: d.stockAfter,
              delta: -d.item.qty,
              consumedBatches: d.consumedBatches,
              avgCost: d.avgCost,
              reason: `Plan Separe completado ${plan.planNumber}`,
              planSepareId: planId,
              userId: _ctx.userData()?.uid || null,
              userEmail: _ctx.userData()?.email || null,
              createdAt: _ctx.serverTimestamp()
            });
          }
        });
      } catch (txError) {
        console.error('[PlanSepare] Transacción abortada:', txError);
        return { success: false, error: txError.message || 'Error descontando stock.' };
      }

      // ============================================================
      // 5. GENERAR LA VENTA REAL
      // ============================================================
      const total = Number(plan.total || 0);
      const totalCost = itemsConCostoReal.reduce(
        (sum, it) => sum + (Number(it.qty || 0) * Number(it.unitCost || 0)),
        0
      );
      const profit = total - totalCost;
      const commissionBase = total; // sin envío, sin recargo, sin descuentos

      // Snapshot del cliente
      const customer = {
        name: plan.customerName || '',
        phone: plan.customerPhone || '',
        email: plan.customerEmail || '',
        address: plan.customerAddress || '',
        city: plan.customerCity || '',
        notes: `Venta desde Plan Separe ${plan.planNumber}`
      };

      // Fecha de pago: ahora (porque el cliente acaba de pagar el 100%)
      const saleData = {
        documentNumber,
        storeId,
        storeName: plan.storeName || '',

        customer,

        items: itemsConCostoReal.map(it => ({
          productId: it.productId,
          variantId: it.variantId,
          name: it.name,
          sku: it.sku,
          qty: Number(it.qty || 0),
          unitPrice: Number(it.unitPrice || 0),
          originalPrice: Number(it.unitPrice || 0),
          unitCost: Number(it.unitCost || 0),
          consumedBatches: it.consumedBatches || [],
          color: it.color || null,
          colorName: it.colorName || null,
          size: it.size || null,
          subtotal: Number(it.qty || 0) * Number(it.unitPrice || 0),
          warrantyMonths: Number(it.warrantyMonths ?? 12)
        })),

        subtotal: total,
        discount: 0,
        shipping: 0,
        surchargeRate: 0,
        surchargeAmount: 0,
        total,
        totalCost,
        profit,
        commissionBase,

        // 🆕 Sin comisiones (es una venta generada por un plan)
        poolRate: 0,
        poolAmount: 0,
        goalAmount: 0,
        bonusRate: 0,
        bonusAmount: 0,
        sellerCommissionAmount: 0,
        storeCommissionAmount: 0,

        // Trazabilidad con el Plan Separe
        isPlanSepareSale: true,
        fromPlanSepare: planId,
        planSepareNumber: plan.planNumber,
        planSepareAbonos: (plan.abonos || []).length,

        // Pago (el cliente ya pagó todo durante el plan)
        paymentMethod: 'plan-separe',
        paymentStatus: 'completed',
        paymentBreakdown: [{
          method: 'plan-separe',
          amount: total,
          note: `Pagado a través del Plan Separe ${plan.planNumber}`
        }],

        // Fecha de pago (ya está pagado)
        paidAt: _ctx.serverTimestamp(),
        status: 'completada',

        // Autor
        sellerUid: _ctx.userData()?.uid || null,
        sellerEmail: _ctx.userData()?.email || null,
        sellerName: _ctx.userData()?.name || _ctx.userData()?.email || null,

        createdAt: _ctx.serverTimestamp()
      };

      const saleRef = await _ctx.addDoc(_ctx.collection(_ctx.db, 'sales'), saleData);
      const saleId = saleRef.id;
      console.log(`[PlanSepare] ✅ Venta generada: ${documentNumber} · ${_fmt(total)}`);

      // ============================================================
      // 6. REGISTRAR MOVIMIENTOS DE INVENTARIO
      // ============================================================
      for (const mov of movimientosParaRegistrar) {
        mov.saleId = saleId;
        await _ctx.addDoc(_ctx.collection(_ctx.db, 'inventoryMovements'), mov);
      }

      // ============================================================
      // 7. GENERAR COMPROBANTE CONTABLE DOBLE (venta + costo)
      // ============================================================
      let ventaComprobanteId = null;
      try {
        ventaComprobanteId = await generateComprobanteVentaPlan({
          planId,
          planNumber: plan.planNumber,
          saleId,
          documentNumber,
          storeId,
          storeName: plan.storeName || '',
          customerName: plan.customerName || '',
          total,
          totalCost,
          items: itemsConCostoReal
        });
      } catch (compErr) {
        console.warn('[PlanSepare] Error generando comprobante de venta (la venta sí quedó):', compErr);
      }

      // ============================================================
      // 8. ACTUALIZAR EL PLAN
      // ============================================================
      await _ctx.updateDoc(planRef, {
        status: STATUS.COMPLETADO,
        completedAt: _ctx.serverTimestamp(),
        saleId,
        saleDocumentNumber: documentNumber,
        ventaComprobanteId,
        updatedAt: _ctx.serverTimestamp(),
        updatedBy: _ctx.userData()?.email || null
      });

      console.log(`[PlanSepare] ✅ Plan ${plan.planNumber} COMPLETADO · Venta ${documentNumber}`);

      // ============================================================
      // 9. AUDITORÍA
      // ============================================================
      try {
        await _ctx.audit({
          action: 'update',
          collection: 'planSepare',
          docId: planId,
          before: { status: plan.status },
          after: {
            status: STATUS.COMPLETADO,
            saleId,
            documentNumber,
            total,
            totalCost,
            profit
          },
          note: `Plan Separe completado: ${plan.planNumber} · Venta ${documentNumber} · ${_fmt(total)}`
        });
      } catch (e) {
        console.warn('[PlanSepare] Error en auditoría:', e);
      }

      // ============================================================
      // RETORNAR
      // ============================================================
      return {
        success: true,
        planId,
        saleId,
        documentNumber,
        total,
        totalCost,
        profit,
        itemsCount: items.length
      };

    } catch (e) {
      console.error('[PlanSepare] Error completando plan:', e);
      return { success: false, error: e.message || 'Error desconocido' };
    }
  }

  /* ============================================================
     🆕 COMPROBANTE DE VENTA DE PLAN SEPARE (DOBLE ASIENTO)
     Registra:
       1) El ingreso: D 281505 Anticipos / C 413505 Ventas
       2) El costo:   D 613505 Costo / C 143505 Inventario
     
     Usa la misma fecha (ahora) y referencia al plan.
  ============================================================ */
  async function generateComprobanteVentaPlan(params) {
    try {
      const {
        planId, planNumber, saleId, documentNumber,
        storeId, storeName, customerName,
        total, totalCost, items
      } = params || {};

      if (!window.SmartecAccounting || !window.SmartecAccounting.buildMovementsFromComprobante) {
        console.warn('[PlanSepare] accounting-engine no disponible — se omite comprobante');
        return null;
      }

      // Idempotencia
      const dupQuery = _ctx.query(
        _ctx.collection(_ctx.db, 'comprobantes'),
        _ctx.where('sourceType', '==', 'planSepare-complete'),
        _ctx.where('sourceId', '==', planId)
      );
      const dupSnap = await _ctx.getDocs(dupQuery);
      if (!dupSnap.empty) {
        console.log('[PlanSepare] Comprobante de venta ya existe:', dupSnap.docs[0].id);
        return dupSnap.docs[0].id;
      }

      // Generar número
      const docInfo = await generateCompNumber();
      const dateToday = _todayStr();

      // Construir el comprobante con 4 líneas
      const comprobante = {
        number: docInfo.fullNumber,
        numberRaw: docInfo.number,
        date: dateToday,
        type: 'ingreso',
        concept: `Venta desde Plan Separe ${planNumber} · ${customerName}`,
        storeId,
        storeName: storeName || '',
        notes: `Venta ${documentNumber} · ${items.length} item(s)`,
        items: [
          // 1) Ingreso: baja el anticipo, sube la venta
          {
            accountCode: '281505',
            accountName: 'Ingresos recibidos para terceros',
            type: 'D',
            amount: total,
            note: `Baja anticipo del plan ${planNumber}`
          },
          {
            accountCode: '413505',
            accountName: 'Venta de mercancías al por mayor',
            type: 'C',
            amount: total,
            note: `Venta al cliente ${customerName}`
          },
          // 2) Costo: baja el inventario, sube el costo de venta
          {
            accountCode: '613505',
            accountName: 'Costo de mercancías vendidas',
            type: 'D',
            amount: totalCost,
            note: `Costo FIFO de la venta`
          },
          {
            accountCode: '143505',
            accountName: 'Mercancías no fabricadas por la empresa',
            type: 'C',
            amount: totalCost,
            note: `Salida de inventario`
          }
        ],
        totalDebit: total + totalCost,
        totalCredit: total + totalCost,
        status: 'activo',
        sourceType: 'planSepare-complete',
        sourceId: planId,
        sourceRef: planNumber,
        saleId,
        saleDocumentNumber: documentNumber,
        createdAt: _ctx.serverTimestamp(),
        createdBy: _ctx.auth?.currentUser?.uid || _ctx.userData()?.uid || null,
        createdByName: _ctx.userData()?.name || _ctx.userData()?.email || null,
        updatedAt: _ctx.serverTimestamp()
      };

      const compRef = await _ctx.addDoc(_ctx.collection(_ctx.db, 'comprobantes'), comprobante);
      console.log(`[PlanSepare] ✅ Comprobante venta ${docInfo.fullNumber} · Ingreso ${_fmt(total)} + Costo ${_fmt(totalCost)}`);

      // Proyectar a movimientos
      try {
        const pucBase = (window.SmartecPUC && window.SmartecPUC.getBase)
          ? window.SmartecPUC.getBase()
          : [];
        const pucMap = window.SmartecAccounting.buildPucMap(pucBase);

        const movements = window.SmartecAccounting.buildMovementsFromComprobante(
          { id: compRef.id, ...comprobante },
          pucMap,
          {
            createdBy: _ctx.auth?.currentUser?.uid || null,
            createdByName: _ctx.userData()?.name || _ctx.userData()?.email || null
          }
        );

        for (const mv of movements) {
          if (mv.dateTs && mv.dateTs instanceof Date && _ctx.Timestamp) {
            mv.dateTs = _ctx.Timestamp.fromDate(mv.dateTs);
          }
          await _ctx.addDoc(_ctx.collection(_ctx.db, 'movimientos'), mv);
        }
        console.log(`[PlanSepare] ✅ ${movements.length} movimiento(s) contable(s) creados`);
      } catch (movErr) {
        console.warn('[PlanSepare] Error proyectando movimientos:', movErr);
      }

      return compRef.id;

    } catch (e) {
      console.error('[PlanSepare] Error generando comprobante de venta:', e);
      return null;
    }
  }

  /* ============================================================
     🆕 CANCELAR PLAN
     Cancela un plan activo. Reglas:
       - Se reintegra TODO el stock (con costos FIFO originales).
       - Se retiene un % del abonado (default 10%).
       - Se devuelve el resto al cliente.
       - Se genera comprobante contable si hubo abonos.
       - El plan pasa a status 'cancelado'.
     
     Params:
       {
         planId,
         reason,           // motivo de la cancelación (obligatorio)
         refundMethod,     // 'efectivo' | 'transferencia' | 'tarjeta' (default: efectivo)
         refundChannelId,  // si refundMethod === 'transferencia'
         refundCardId,     // si refundMethod === 'tarjeta'
         refundDate        // 'YYYY-MM-DD' (default: hoy)
       }
     
     Returns:
       {
         success, 
         refundAmount,     // monto devuelto
         retentionAmount,  // monto retenido
         totalAbonado,     // total que había abonado
         comprobanteId     // ID del comprobante (o null)
       } | { success: false, error }
  ============================================================ */
  async function cancel(params) {
    try {
      if (!_initialized) throw new Error('[PlanSepare] No inicializado.');

      const {
        planId,
        reason,
        refundMethod = 'efectivo',
        refundChannelId = null,
        refundCardId = null,
        refundDate = _todayStr()
      } = params || {};

      // ============================================================
      // VALIDACIONES
      // ============================================================
      if (!planId) return { success: false, error: 'Falta planId.' };
      if (!reason || !reason.trim()) {
        return { success: false, error: 'El motivo de la cancelación es obligatorio.' };
      }

      const validRefundMethods = ['efectivo', 'transferencia', 'tarjeta'];
      if (!validRefundMethods.includes(refundMethod)) {
        return { success: false, error: `Método de devolución inválido: ${refundMethod}.` };
      }
      if (refundMethod === 'transferencia' && !refundChannelId) {
        return { success: false, error: 'Selecciona el canal para la devolución.' };
      }
      if (refundMethod === 'tarjeta' && !refundCardId) {
        return { success: false, error: 'Selecciona la tarjeta para la devolución.' };
      }

      // ============================================================
      // LEER EL PLAN
      // ============================================================
      const planRef = _ctx.doc(_ctx.db, 'planSepare', planId);
      const planSnap = await _ctx.getDoc(planRef);

      if (!planSnap.exists()) {
        return { success: false, error: 'El plan no existe.' };
      }

      const plan = { id: planId, ...planSnap.data() };

      if (plan.status === STATUS.COMPLETADO) {
        return { success: false, error: 'Este plan ya está completado. No se puede cancelar.' };
      }
      if (plan.status === STATUS.CANCELADO) {
        return { success: false, error: 'Este plan ya está cancelado.' };
      }
      if (plan.status !== STATUS.ACTIVO && plan.status !== 'pendiente-cierre') {
        return { success: false, error: `Estado del plan no válido: ${plan.status}.` };
      }

      const items = plan.items || [];
      if (!items.length) {
        return { success: false, error: 'El plan no tiene items.' };
      }

      const storeId = plan.storeId;

      // ============================================================
      // 1. REINTEGRAR STOCK (transacción atómica)
      // ============================================================
      const FIFO = window.SmartecFIFO;
      if (!FIFO) {
        return { success: false, error: 'El módulo de inventario (FIFO) no está disponible.' };
      }

      const movimientosReintegro = [];

      try {
        await _ctx.runTransaction(_ctx.db, async (transaction) => {
          const invDocs = [];

          // PASO 1: LEER
          for (const it of items) {
            const invId = `${storeId}_${it.variantId}`;
            const invRef = _ctx.doc(_ctx.db, 'inventory', invId);
            const invSnap = await transaction.get(invRef);

            if (!invSnap.exists()) {
              console.warn(`[PlanSepare] Inventario no encontrado para ${it.name} — se omite reintegro.`);
              continue;
            }

            const invData = invSnap.data();
            const stockActual = Number(invData.stock || 0);

            // Normalizar
            const fallbackCost = Number(it.unitCost || 0);
            const normalized = FIFO.normalizeInventory(
              { stock: stockActual, batches: invData.batches },
              fallbackCost
            );

            // Crear un lote de "devolución" con el costo original del item
            const devolucionBatch = FIFO.createBatch(
              Number(it.qty || 0),
              Number(it.unitCost || 0),
              'devolucion',
              {
                sourceId: planId,
                sourceRef: `Cancelación Plan Separe ${plan.planNumber}`,
                createdBy: _ctx.userData()?.email || null
              }
            );

            const batchesFinal = [...normalized.batches, devolucionBatch];
            const stockFinal = FIFO.sumBatchesQty(batchesFinal);

            invDocs.push({
              ref: invRef,
              stockBefore: stockActual,
              stockAfter: stockFinal,
              batchesAfter: batchesFinal,
              item: it
            });
          }

          // PASO 2: ESCRIBIR
          for (const d of invDocs) {
            transaction.update(d.ref, {
              stock: d.stockAfter,
              batches: d.batchesAfter,
              updatedAt: _ctx.serverTimestamp()
            });

            movimientosReintegro.push({
              storeId,
              productId: d.item.productId,
              variantId: d.item.variantId,
              sku: d.item.sku,
              productName: d.item.name,
              type: 'devolucion',
              qtyBefore: d.stockBefore,
              qtyAfter: d.stockAfter,
              delta: Number(d.item.qty || 0),
              reason: `Cancelación Plan Separe ${plan.planNumber} · ${reason.trim()}`,
              planSepareId: planId,
              userId: _ctx.userData()?.uid || null,
              userEmail: _ctx.userData()?.email || null,
              createdAt: _ctx.serverTimestamp()
            });
          }
        });
      } catch (txError) {
        console.error('[PlanSepare] Transacción de reintegro abortada:', txError);
        return { success: false, error: txError.message || 'Error reintegrando stock.' };
      }

      // ============================================================
      // 2. REGISTRAR MOVIMIENTOS DE REINTEGRO
      // ============================================================
      for (const mov of movimientosReintegro) {
        await _ctx.addDoc(_ctx.collection(_ctx.db, 'inventoryMovements'), mov);
      }

      // ============================================================
      // 3. CALCULAR RETENCIÓN Y DEVOLUCIÓN
      // ============================================================
      const totalAbonado = Number(plan.abonado || 0);
      const cancelFeePct = Number(plan.cancellationFeePct ?? DEFAULT_CANCEL_FEE_PCT);
      const retentionAmount = Math.round(totalAbonado * cancelFeePct);
      const refundAmount = totalAbonado - retentionAmount;

      // ============================================================
      // 4. GENERAR COMPROBANTE CONTABLE (solo si hubo abonos)
      // ============================================================
      let cancelacionComprobanteId = null;
      if (totalAbonado > 0) {
        try {
          cancelacionComprobanteId = await generateComprobanteCancelacion({
            planId,
            planNumber: plan.planNumber,
            storeId,
            storeName: plan.storeName || '',
            customerName: plan.customerName,
            totalAbonado,
            retentionAmount,
            refundAmount,
            refundMethod,
            refundChannelId,
            refundCardId,
            refundDate,
            cancelReason: reason.trim()
          });
        } catch (compErr) {
          console.warn('[PlanSepare] Error generando comprobante de cancelación:', compErr);
        }
      }

      // ============================================================
      // 5. ACTUALIZAR EL PLAN
      // ============================================================
      await _ctx.updateDoc(planRef, {
        status: STATUS.CANCELADO,
        cancelledAt: _ctx.serverTimestamp(),
        cancelledBy: _ctx.userData()?.email || null,
        cancelReason: reason.trim(),
        retentionAmount,
        refundAmount,
        refundMethod,
        cancelacionComprobanteId,
        updatedAt: _ctx.serverTimestamp(),
        updatedBy: _ctx.userData()?.email || null
      });

      console.log(`[PlanSepare] ✅ Plan ${plan.planNumber} CANCELADO · Devolución: ${_fmt(refundAmount)} · Retención: ${_fmt(retentionAmount)}`);

      // ============================================================
      // 6. AUDITORÍA
      // ============================================================
      try {
        await _ctx.audit({
          action: 'update',
          collection: 'planSepare',
          docId: planId,
          before: { status: plan.status, abonado: totalAbonado },
          after: {
            status: STATUS.CANCELADO,
            refundAmount,
            retentionAmount,
            cancelReason: reason.trim()
          },
          note: `Plan Separe cancelado: ${plan.planNumber} · Motivo: ${reason.trim()} · Devolución ${_fmt(refundAmount)} · Retención ${_fmt(retentionAmount)}`
        });
      } catch (e) {
        console.warn('[PlanSepare] Error en auditoría:', e);
      }

      // ============================================================
      // RETORNAR
      // ============================================================
      return {
        success: true,
        planId,
        refundAmount,
        retentionAmount,
        totalAbonado,
        comprobanteId: cancelacionComprobanteId,
        itemsReintegrados: movimientosReintegro.length
      };

    } catch (e) {
      console.error('[PlanSepare] Error cancelando plan:', e);
      return { success: false, error: e.message || 'Error desconocido' };
    }
  }

  /* ============================================================
     🆕 COMPROBANTE DE CANCELACIÓN (con retención)
     Asiento:
       D 281505 Anticipos de clientes    $ totalAbonado
          C 110505 Caja general           $ refundAmount
          C 429505 Diversos (ingresos)    $ retentionAmount
  ============================================================ */
  async function generateComprobanteCancelacion(params) {
    try {
      const {
        planId, planNumber, storeId, storeName, customerName,
        totalAbonado, retentionAmount, refundAmount,
        refundMethod, refundChannelId, refundCardId,
        refundDate, cancelReason
      } = params || {};

      if (!window.SmartecAccounting || !window.SmartecAccounting.buildMovementsFromComprobante) {
        console.warn('[PlanSepare] accounting-engine no disponible — se omite comprobante');
        return null;
      }

      // Idempotencia
      const dupQuery = _ctx.query(
        _ctx.collection(_ctx.db, 'comprobantes'),
        _ctx.where('sourceType', '==', 'planSepare-cancel'),
        _ctx.where('sourceId', '==', planId)
      );
      const dupSnap = await _ctx.getDocs(dupQuery);
      if (!dupSnap.empty) {
        console.log('[PlanSepare] Comprobante de cancelación ya existe:', dupSnap.docs[0].id);
        return dupSnap.docs[0].id;
      }

      // Determinar la cuenta crédito para la devolución
      let refundAccount = { code: '110505', name: 'Caja general' };
      let methodNote = 'Efectivo';

      if (refundMethod === 'transferencia' && refundChannelId) {
        let channel = null;
        try {
          const chSnap = await _ctx.getDoc(_ctx.doc(_ctx.db, 'paymentChannels', refundChannelId));
          if (chSnap.exists()) channel = chSnap.data();
        } catch (e) {
          console.warn('[PlanSepare] No se pudo leer canal:', e);
        }
        refundAccount = {
          code: channel?.pucAccountCode || '111005',
          name: channel?.pucAccountName || channel?.bank || 'Bancos'
        };
        methodNote = `Transferencia · ${channel?.bank || ''}`.trim();
      } else if (refundMethod === 'tarjeta' && refundCardId) {
        let card = null;
        try {
          const cdSnap = await _ctx.getDoc(_ctx.doc(_ctx.db, 'creditCards', refundCardId));
          if (cdSnap.exists()) card = cdSnap.data();
        } catch (e) {
          console.warn('[PlanSepare] No se pudo leer tarjeta:', e);
        }
        refundAccount = {
          code: card?.pucAccountCode || '210505',
          name: card?.pucAccountName || 'Bancos nacionales (tarjeta)'
        };
        methodNote = `Tarjeta · ${card?.name || ''}`.trim();
      }

      // Generar número
      const docInfo = await generateCompNumber();

      // Construir items del comprobante
      const items = [
        {
          accountCode: '281505',
          accountName: 'Ingresos recibidos para terceros',
          type: 'D',
          amount: totalAbonado,
          note: `Reversión anticipo plan ${planNumber}`
        },
        {
          accountCode: refundAccount.code,
          accountName: refundAccount.name,
          type: 'C',
          amount: refundAmount,
          note: `Devolución al cliente · ${methodNote}`
        }
      ];

      if (retentionAmount > 0) {
        items.push({
          accountCode: '429505',
          accountName: 'Diversos',
          type: 'C',
          amount: retentionAmount,
          note: `Retención por cancelación (${Math.round((retentionAmount / totalAbonado) * 100)}%)`
        });
      }

      const comprobante = {
        number: docInfo.fullNumber,
        numberRaw: docInfo.number,
        date: refundDate || _todayStr(),
        type: 'egreso',
        concept: `Cancelación Plan Separe ${planNumber} · ${customerName}`,
        storeId,
        storeName: storeName || '',
        notes: `Motivo: ${cancelReason}`,
        items,
        totalDebit: totalAbonado,
        totalCredit: totalAbonado,
        status: 'activo',
        sourceType: 'planSepare-cancel',
        sourceId: planId,
        sourceRef: planNumber,
        createdAt: _ctx.serverTimestamp(),
        createdBy: _ctx.auth?.currentUser?.uid || _ctx.userData()?.uid || null,
        createdByName: _ctx.userData()?.name || _ctx.userData()?.email || null,
        updatedAt: _ctx.serverTimestamp()
      };

      const compRef = await _ctx.addDoc(_ctx.collection(_ctx.db, 'comprobantes'), comprobante);
      console.log(`[PlanSepare] ✅ Comprobante cancelación ${docInfo.fullNumber} · Devolución ${_fmt(refundAmount)} · Retención ${_fmt(retentionAmount)}`);

      // Proyectar a movimientos
      try {
        const pucBase = (window.SmartecPUC && window.SmartecPUC.getBase)
          ? window.SmartecPUC.getBase()
          : [];
        const pucMap = window.SmartecAccounting.buildPucMap(pucBase);

        const movements = window.SmartecAccounting.buildMovementsFromComprobante(
          { id: compRef.id, ...comprobante },
          pucMap,
          {
            createdBy: _ctx.auth?.currentUser?.uid || null,
            createdByName: _ctx.userData()?.name || _ctx.userData()?.email || null
          }
        );

        for (const mv of movements) {
          if (mv.dateTs && mv.dateTs instanceof Date && _ctx.Timestamp) {
            mv.dateTs = _ctx.Timestamp.fromDate(mv.dateTs);
          }
          await _ctx.addDoc(_ctx.collection(_ctx.db, 'movimientos'), mv);
        }
        console.log(`[PlanSepare] ✅ ${movements.length} movimiento(s) contable(s) creados`);
      } catch (movErr) {
        console.warn('[PlanSepare] Error proyectando movimientos:', movErr);
      }

      return compRef.id;

    } catch (e) {
      console.error('[PlanSepare] Error generando comprobante de cancelación:', e);
      return null;
    }
  }

  /* ============================================================
     API PÚBLICA
  ============================================================ */
  window.SmartecPlanSepare = {
    init,
    STATUS,
    DEFAULT_MIN_PCT,
    DEFAULT_DAYS,
    DEFAULT_CANCEL_FEE_PCT,
    // Funciones de negocio
    generatePlanNumber,
    generateCompNumber,
    generateAnticipoComprobante,
    generateComprobanteVentaPlan,
    generateComprobanteCancelacion,
    create,
    addPayment,
    complete,
    cancel,
    // Helpers públicos
    _fmt,
    _todayStr,
    _addDays,
    _daysBetween,
    _isExpired
  };

  console.log('[Smartec] plan-separe.js cargado');
})();