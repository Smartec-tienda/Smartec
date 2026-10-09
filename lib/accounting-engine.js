/* ============================================================
   SMARTEC · accounting-engine.js
   Motor contable: proyecta comprobantes → movimientos.

   Estructura de un movimiento (colección "movimientos"):
   {
     id: "auto",
     comprobanteId: "abc123",
     comprobanteNumber: "COMP-2026-0001",
     comprobanteType: "diario",         // diario, ingreso, egreso, ajuste...
     date: "2026-10-08",                // YYYY-MM-DD (para queries)
     dateTs: Timestamp,                 // fecha como Timestamp (para ordenar)

     storeId: "tienda-alameda",
     storeName: "Alameda",

     accountCode: "1105",
     accountName: "Caja",
     accountNature: "D",                // D | C (copia del PUC)
     accountLevel: 4,

     type: "D",                          // D | C (débito o crédito de esta línea)
     amount: 500000,

     concept: "Venta de contado",
     note: "",                           // nota de la línea

     thirdParty: null,                   // nombre (futuro)
     thirdPartyDoc: null,                // NIT / cédula (futuro)

     sourceType: "comprobante",          // comprobante | venta | gasto | nomina | depreciacion
     sourceId: "abc123",                 // id del doc origen
     sourceRef: null,                    // nro de factura o ref externa

     isReversal: false,                  // true si es un contra-movimiento
     reversesId: null,                   // id del movimiento original (si es reversión)
     reversalReason: null,               // motivo de anulación

     createdAt: Timestamp,
     createdBy: "uid",
     createdByName: "Nombre Apellido"
   }
============================================================ */

(function () {
  'use strict';

  /**
   * Convierte "YYYY-MM-DD" a Timestamp de Firestore.
   * Necesario porque Firestore no indexa strings como fechas.
   */
  function dateStrToTimestamp(dateStr) {
    if (!dateStr) return null;
    // Usamos UTC para evitar desfases
    const d = new Date(dateStr + 'T12:00:00Z');
    // Retornamos un objeto compatible con Firestore Timestamp
    // (Firestore SDK acepta Date directamente y lo convierte)
    return d;
  }

  /**
   * Proyecta un comprobante completo a un array de movimientos.
   * Devuelve los objetos listos para insertar (sin id).
   *
   * @param {object} comprobante - Doc de la colección "comprobantes" (con .id)
   * @param {object} pucMap - Mapa {code → {name, nature, level}} del PUC
   * @param {object} meta - { createdBy, createdByName }
   * @returns {array} Lista de movimientos
   */
  function buildMovementsFromComprobante(comprobante, pucMap, meta = {}) {
    if (!comprobante || !Array.isArray(comprobante.items)) return [];

    const movements = [];

    for (const item of comprobante.items) {
      const code = String(item.accountCode || '');
      if (!code) continue;

      const pucAcc = pucMap[code] || {};
      const amount = Number(item.amount || 0);
      if (amount === 0) continue;

      movements.push({
        comprobanteId: comprobante.id || null,
        comprobanteNumber: comprobante.number || null,
        comprobanteType: comprobante.type || 'diario',

        date: comprobante.date || null,
        dateTs: dateStrToTimestamp(comprobante.date),

        storeId: comprobante.storeId || null,
        storeName: comprobante.storeName || null,

        accountCode: code,
        accountName: item.accountName || pucAcc.name || null,
        accountNature: pucAcc.nature || null,
        accountLevel: pucAcc.level || null,

        type: item.type === 'C' ? 'C' : 'D',
        amount,

        concept: comprobante.concept || null,
        note: item.note || null,

        thirdParty: item.thirdParty || null,
        thirdPartyDoc: item.thirdPartyDoc || null,

        sourceType: comprobante.sourceType || 'comprobante',
        sourceId: comprobante.id || null,
        sourceRef: comprobante.sourceRef || null,

        isReversal: false,
        reversesId: null,
        reversalReason: null,

        createdAt: new Date(),
        createdBy: meta.createdBy || null,
        createdByName: meta.createdByName || null
      });
    }

    return movements;
  }

  /**
   * Construye los movimientos de reversión de un comprobante.
   * Invierte cada línea (D→C, C→D) y marca isReversal=true.
   *
   * @param {object} comprobante - Comprobante anulado
   * @param {array} originalMovements - Movimientos originales (con id y fields)
   * @param {object} meta - { createdBy, createdByName, reason }
   * @returns {array} Lista de movimientos de reversión
   */
  function buildReversalMovements(comprobante, originalMovements, meta = {}) {
    const reversals = [];

    for (const m of (originalMovements || [])) {
      reversals.push({
        comprobanteId: comprobante.id || null,
        comprobanteNumber: comprobante.number || null,
        comprobanteType: 'reversal',

        date: m.date || comprobante.date || null,
        dateTs: dateStrToTimestamp(m.date || comprobante.date),

        storeId: m.storeId,
        storeName: m.storeName,

        accountCode: m.accountCode,
        accountName: m.accountName,
        accountNature: m.accountNature,
        accountLevel: m.accountLevel,

        // Invertimos D ↔ C
        type: m.type === 'D' ? 'C' : 'D',
        amount: Number(m.amount || 0),

        concept: `REVERSIÓN: ${m.concept || ''}`.trim(),
        note: m.note || null,

        thirdParty: m.thirdParty || null,
        thirdPartyDoc: m.thirdPartyDoc || null,

        sourceType: m.sourceType || 'comprobante',
        sourceId: m.sourceId || null,
        sourceRef: m.sourceRef || null,

        isReversal: true,
        reversesId: m.id || null,
        reversalReason: meta.reason || null,

        createdAt: new Date(),
        createdBy: meta.createdBy || null,
        createdByName: meta.createdByName || null
      });
    }

    return reversals;
  }

  /**
   * Construye un mapa {code → {name, nature, level}} desde un array de cuentas PUC.
   */
  function buildPucMap(pucAccounts) {
    const map = {};
    for (const acc of (pucAccounts || [])) {
      if (!acc || !acc.code) continue;
      map[String(acc.code)] = {
        name: acc.name || null,
        nature: acc.nature || null,
        level: Number(acc.level) || null
      };
    }
    return map;
  }

    /* ============================================================
     🆕 CONFIG PUC POR DEFECTO
     Estos son los defaults. Si en Firestore existe
     settings/accounting.puc, esos valores sobrescriben.
  ============================================================ */
  const PUC_DEFAULTS = {
    ingresosVentasMayor: '413505',
    ingresosVentasMenor: '413510',
    costoVenta:          '613505',
    inventario:          '143505',
    cajaEfectivo:        '110505',
    bancosDefault:       '111005',
    clientesDefault:     '130505',
    contraentrega:       '130505',
    ivaPorPagar:         '240805',
    ivaEnabled:          false,
    comisionFinanciera:  '530515',
    recargoTarjeta:      '4295',
    envioCobrado:        '4210',
    devolucionVentas:    '4175'
  };

  /**
   * Normaliza el paymentBreakdown de una venta a un array de
   * líneas de pago listas para usar en el asiento contable.
   *
   * Cada línea: { method, amount, accountCode, label }
   *   - accountCode: el PUC al que se carga el dinero
   *   - label: descripción legible para la nota
   *
   * @param {object} sale - Doc de venta
   * @param {object} pucConfig - Config PUC
   * @returns {array} Lista de pagos normalizada
   */
  /* ============================================================
     🆕 COMPROBANTE CONTABLE DE NÓMINA
     Convierte un período de nómina completo en un comprobante
     contable con todas las líneas (devengos, deducciones,
     aportes empleador y provisiones), agrupadas por cuenta.
  ============================================================ */
  function buildComprobanteFromNomina(periodo, pucConfig = {}, meta = {}) {
    if (!periodo || !Array.isArray(periodo.items) || !periodo.items.length) {
      return null;
    }

    const PUC = { ...PUC_DEFAULTS, ...pucConfig };
    const items = periodo.items;

    // ============================================================
    // 1. CALCULAR TOTALES POR CUENTA PUC (agrupando)
    // ============================================================
    const accum = {
      // Devengos
      sueldosVentas: 0,       // 520506
      sueldosAdmin: 0,        // 510506
      auxilioTransporte: 0,   // 510515

      // Aportes empleador (gastos)
      saludEmpr: 0,           // 510533
      pensionEmpr: 0,         // 510539
      arlEmpr: 0,             // 510536
      cajaEmpr: 0,            // 510542
      senaEmpr: 0,            // 510545
      icbfEmpr: 0,            // 510548

      // Provisiones (gastos)
      cesantias: 0,           // 510518
      interesesCesantias: 0,  // 510521
      prima: 0,               // 510524
      vacaciones: 0,          // 510527

      // Deducciones empleado (retenciones)
      saludEmp: 0,            // 237005 (parte empleado)
      pensionEmp: 0,          // 237015 (parte empleado)

      // Neto a pagar
      netoPagar: 0            // 250505
    };

    // Detectar si tiene >=10 empleados para SENA/ICBF
    const totalEmpleados = items.length;
    const aplicaSenaIcbf = totalEmpleados >= 10;

    // Detectar cargos de ventas
    const esCargoVentas = (position) => {
      if (!position) return false;
      const p = position.toLowerCase();
      return p.includes('vendedor') ||
             p.includes('vendedora') ||
             p.includes('ventas') ||
             p.includes('cajero') ||
             p.includes('cajera') ||
             p.includes('asesor') ||
             p.includes('comercial');
    };

    // Sumar cada item a su cuenta
    items.forEach(it => {
      const salario = Number(it.salarioDevengado || 0);
      const esVentas = esCargoVentas(it.position);

      // Sueldos (separado por ventas vs admin)
      if (esVentas) accum.sueldosVentas += salario;
      else accum.sueldosAdmin += salario;

      // Auxilio transporte
      accum.auxilioTransporte += Number(it.auxilioTransporte || 0);

      // Aportes empleador
      accum.saludEmpr += Number(it.saludEmpr || 0);
      accum.pensionEmpr += Number(it.pensionEmpr || 0);
      accum.arlEmpr += Number(it.arlVal || 0);
      accum.cajaEmpr += Number(it.caja || 0);
      if (aplicaSenaIcbf) {
        accum.senaEmpr += Number(it.sena || 0);
        accum.icbfEmpr += Number(it.icbf || 0);
      }

      // Provisiones
      accum.cesantias += Number(it.cesantias || 0);
      accum.interesesCesantias += Number(it.interesesCesantias || 0);
      accum.prima += Number(it.prima || 0);
      accum.vacaciones += Number(it.vacaciones || 0);

      // Deducciones empleado
      accum.saludEmp += Number(it.saludEmp || 0);
      accum.pensionEmp += Number(it.pensionEmp || 0);

      // Neto
      accum.netoPagar += Number(it.netoPagar || 0);
    });

    // ============================================================
    // 2. CONSTRUIR LÍNEAS DEL COMPROBANTE
    // ============================================================
    const compItems = [];

    const addD = (code, name, amount, note) => {
      if (amount > 0) compItems.push({ accountCode: code, accountName: name, type: 'D', amount, note });
    };
    const addC = (code, name, amount, note) => {
      if (amount > 0) compItems.push({ accountCode: code, accountName: name, type: 'C', amount, note });
    };

    // ---- DÉBITOS (gastos y provisiones) ----

    // Sueldos ventas (520506)
    addD('520506', 'Sueldos (ventas)', accum.sueldosVentas, 'Sueldos personal de ventas');

    // Sueldos admin (510506)
    addD('510506', 'Sueldos (administración)', accum.sueldosAdmin, 'Sueldos personal administrativo');

    // Auxilio de transporte (510515)
    addD('510515', 'Auxilio de transporte', accum.auxilioTransporte, 'Auxilio de transporte legal');

    // Aportes empleador
    addD('510533', 'Aportes a EPS', accum.saludEmpr, 'Aporte salud empleador');
    addD('510539', 'Aportes a fondos de pensiones', accum.pensionEmpr, 'Aporte pensión empleador');
    addD('510536', 'Aportes a ARL', accum.arlEmpr, 'Aporte ARL');
    addD('510542', 'Aportes a cajas de compensación', accum.cajaEmpr, 'Caja de compensación');
    if (aplicaSenaIcbf) {
      addD('510545', 'Aportes al SENA', accum.senaEmpr, 'Aporte SENA');
      addD('510548', 'Aportes al ICBF', accum.icbfEmpr, 'Aporte ICBF');
    }

    // Provisiones
    addD('510518', 'Cesantías', accum.cesantias, 'Provisión cesantías');
    addD('510521', 'Intereses sobre cesantías', accum.interesesCesantias, 'Provisión intereses cesantías');
    addD('510524', 'Prima de servicios', accum.prima, 'Provisión prima');
    addD('510527', 'Vacaciones', accum.vacaciones, 'Provisión vacaciones');

    // ---- CRÉDITOS (pasivos y neto) ----

    // Deducciones empleado (retenciones)
    const saludTotal = accum.saludEmp + accum.saludEmpr;
    const pensionTotal = accum.pensionEmp + accum.pensionEmpr;

    addC('237005', 'Aportes a EPS', saludTotal, 'Aporte salud total (empleado + empleador)');
    addC('237015', 'Aportes a fondos de pensiones', pensionTotal, 'Aporte pensión total');
    addC('237010', 'Aportes a ARL', accum.arlEmpr, 'Aporte ARL');
    addC('237020', 'Aportes a cajas de compensación', accum.cajaEmpr, 'Caja de compensación');
    if (aplicaSenaIcbf) {
      addC('237025', 'Aportes al SENA', accum.senaEmpr, 'Aporte SENA');
      addC('237030', 'Aportes al ICBF', accum.icbfEmpr, 'Aporte ICBF');
    }

    // Provisiones (pasivo laboral)
    addC('251005', 'Cesantías consolidadas', accum.cesantias, 'Cesantías provisionadas');
    addC('251505', 'Intereses sobre cesantías', accum.interesesCesantias, 'Intereses provisionados');
    addC('252005', 'Prima de servicios', accum.prima, 'Prima provisionada');
    addC('252505', 'Vacaciones consolidadas', accum.vacaciones, 'Vacaciones provisionadas');

    // Neto a pagar al empleado
    addC('250505', 'Salarios por pagar', accum.netoPagar, 'Neto a pagar a empleados');

    // ============================================================
    // 3. TOTALES
    // ============================================================
    const totalDebit = compItems.filter(i => i.type === 'D').reduce((s,i) => s + Number(i.amount || 0), 0);
    const totalCredit = compItems.filter(i => i.type === 'C').reduce((s,i) => s + Number(i.amount || 0), 0);

    const diff = Math.round(totalDebit - totalCredit);
    if (diff !== 0) {
      console.warn('[Accounting/Nomina] Comprobante descuadrado por', diff);
    }

    // ============================================================
    // 4. FECHA Y CONCEPTO
    // ============================================================
    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const periodoLabel = periodo.periodLabel
      || `${monthNames[(periodo.periodMonth||1)-1]} ${periodo.periodYear || ''}`;

    // Último día del mes
    const lastDay = new Date(periodo.periodYear || new Date().getFullYear(), periodo.periodMonth || 1, 0).getDate();
    const fecha = `${periodo.periodYear || new Date().getFullYear()}-${String(periodo.periodMonth || 1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

    const concepto = `Nómina ${periodoLabel} · ${items.length} empleado${items.length !== 1 ? 's' : ''}`;

    // ============================================================
    // 5. RETORNAR COMPROBANTE
    // ============================================================
    return {
      type: 'egreso',
      date: fecha,
      concept: concepto,
      storeId: periodo.storeId || null,
      storeName: periodo.storeName || null,

      sourceType: 'nomina',
      sourceId: periodo.id || null,
      sourceRef: periodoLabel,

      items: compItems,
      totalDebit,
      totalCredit,

      status: 'activo',
      notes: `Generado automáticamente desde liquidación de nómina`,

      createdAt: new Date(),
      createdBy: meta.createdBy || null,
      createdByName: meta.createdByName || null
    };
  }
  
    /* ============================================================
     🆕 MÉTODOS DE PAGO PARA GASTOS
     Combina: Efectivo + Canales de transferencia + Tarjetas de crédito
     Devuelve array unificado para usar en el form de gasto.
  ============================================================ */
  function buildPaymentMethodsOptions(channels = [], cards = [], pucConfig = {}) {
    const PUC = { ...PUC_DEFAULTS, ...pucConfig };
    const options = [];

    // ============================================================
    // 1. EFECTIVO (siempre disponible, hardcoded)
    // ============================================================
    options.push({
      group: 'Efectivo',
      id: 'efectivo',
      label: '💵 Efectivo — Caja general',
      accountCode: PUC.cajaEfectivo,
      accountName: 'Caja general',
      type: 'efectivo',
      isLiability: false
    });

    // ============================================================
    // 2. CANALES DE TRANSFERENCIA (con PUC asignado)
    // ============================================================
    (channels || [])
      .filter(c => c.type === 'transferencia' && c.active !== false && c.pucAccountCode)
      .forEach(c => {
        const icon = c.icon || '🏦';
        const bank = c.bank || 'Banco';
        const name = c.customName ? ` — ${c.customName}` : '';
        options.push({
          group: 'Transferencia',
          id: c.id,
          label: `${icon} ${bank}${name}`,
          accountCode: c.pucAccountCode,
          accountName: c.pucAccountName || 'Banco',
          type: 'transferencia',
          isLiability: false
        });
      });

    // ============================================================
    // 3. TARJETAS DE CRÉDITO (activas, con PUC asignado)
    // ============================================================
    (cards || [])
      .filter(c => c.active !== false && c.pucAccountCode)
      .forEach(c => {
        const brand = c.brand || 'Tarjeta';
        const bank = c.bank || 'Banco';
        const last4 = c.last4 ? ` •••• ${c.last4}` : '';
        options.push({
          group: 'Tarjeta de crédito',
          id: c.id,
          label: `💳 ${c.name || (brand + ' ' + bank)}${last4}`,
          accountCode: c.pucAccountCode,
          accountName: c.pucAccountName || 'Tarjetas de crédito',
          type: 'tarjeta',
          isLiability: true  // 🆕 genera pasivo, no pago
        });
      });

    return options;
  }

  function normalizeSalePayments(sale, pucConfig) {
    const payments = [];
    const status = sale.paymentStatus || 'completed';
    const isPending = status === 'pending';

    // Helper: resuelve cuenta PUC según método y canal
    const resolveAccount = (payment) => {
      const method = payment.method;

      // Si la venta está pendiente (contraentrega / crédito sin cobrar)
      // → todo va a clientes (por cobrar)
      if (isPending) {
        return {
          code: pucConfig.contraentrega,
          name: 'Clientes (por cobrar)'
        };
      }

      // Efectivo
      if (method === 'efectivo') {
        return {
          code: pucConfig.cajaEfectivo,
          name: 'Caja general'
        };
      }

      // Transferencia o crédito → usar la cuenta PUC del canal
      if (method === 'transferencia' || method === 'credito') {
        if (payment.channelPucAccountCode) {
          return {
            code: payment.channelPucAccountCode,
            name: payment.channelPucAccountName || 'Cuenta del canal'
          };
        }
        return {
          code: method === 'credito' ? pucConfig.clientesDefault : pucConfig.bancosDefault,
          name: method === 'credito' ? 'Clientes' : 'Bancos'
        };
      }

      // Tarjeta
      if (method === 'tarjeta') {
        return {
          code: pucConfig.bancosDefault,
          name: 'Bancos (tarjeta)'
        };
      }

      // Contraentrega sin cobrar
      if (method === 'contraentrega') {
        return {
          code: pucConfig.contraentrega,
          name: 'Clientes (contraentrega)'
        };
      }

      // Por defecto
      return {
        code: pucConfig.bancosDefault,
        name: 'Bancos'
      };
    };

    // ============================================================
    // CASO 1: VENTA PENDIENTE (contraentrega / crédito sin cobrar)
    // El débito a Clientes debe incluir subtotal − descuento + envío + recargo
    // (todo lo que el cliente debe pagar cuando se cobre)
    // ============================================================
    if (isPending) {
      const commissionBase = (sale.commissionBase !== undefined)
        ? Number(sale.commissionBase)
        : (Number(sale.subtotal || 0) - Number(sale.discount || 0));

      const shipping = Number(sale.shipping || 0);
      const surcharge = Number(sale.surchargeAmount || 0);
      const totalPorCobrar = commissionBase + shipping + surcharge;

      payments.push({
        method: 'contraentrega',
        amount: totalPorCobrar,
        accountCode: pucConfig.contraentrega,
        label: `Clientes (por cobrar) · ${sale.documentNumber || ''}`.trim()
      });

      return payments;
    }

    // ============================================================
    // CASO 2: VENTA COBRADA (completed)
    // Cada línea de pago se registra con su monto real cobrado.
    // Si es tarjeta, el débito al banco debe incluir el recargo
    // (porque el datáfono realmente pasa base + recargo).
    // ============================================================
    if (Array.isArray(sale.paymentBreakdown) && sale.paymentBreakdown.length) {
      sale.paymentBreakdown.forEach(p => {
        const acc = resolveAccount(p);
        const baseAmount = Number(p.amount || 0);
        const cardSurcharge = Number(p.cardSurchargeAmount || 0);

        // El débito real = base + recargo (si es tarjeta)
        const debitAmount = baseAmount + cardSurcharge;

        payments.push({
          method: p.method,
          amount: debitAmount,
          accountCode: acc.code,
          label: `${p.method} · ${acc.name}${cardSurcharge > 0 ? ' (incluye recargo)' : ''}`
        });
      });
      return payments;
    }

    // ============================================================
    // CASO 3: FALLBACK (ventas viejas sin paymentBreakdown)
    // ============================================================
    const mainMethod = sale.paymentMethod || 'efectivo';
    const base = (sale.commissionBase !== undefined)
      ? Number(sale.commissionBase)
      : (Number(sale.subtotal || 0) - Number(sale.discount || 0));

    const shipping = Number(sale.shipping || 0);
    const surcharge = Number(sale.surchargeAmount || 0);
    const totalCobrado = base + shipping + surcharge;

    const acc = resolveAccount({ method: mainMethod });
    payments.push({
      method: mainMethod,
      amount: totalCobrado,
      accountCode: acc.code,
      label: `${mainMethod} · ${acc.name}`
    });

    return payments;
  }

  /**
   * Construye un comprobante contable a partir de una venta.
   * Genera las líneas de:
   *   - Cobro (débito) según método/canal
   *   - Ingreso (crédito) según mayorista o retail
   *   - Costo de venta (débito)
   *   - Inventario (crédito) por el costo FIFO
   *
   * @param {object} sale - Doc de venta
   * @param {object} pucConfig - Config PUC (sobrescribe defaults)
   * @param {object} meta - { createdBy, createdByName }
   * @returns {object} Comprobante listo para insertar
   */
  function buildComprobanteFromSale(sale, pucConfig = {}, meta = {}) {
    if (!sale) return null;

    // Merge de config con defaults
    const PUC = { ...PUC_DEFAULTS, ...pucConfig };

    const items = [];
    const date = sale.createdAt?.seconds
      ? new Date(sale.createdAt.seconds * 1000).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const saleId = sale.id || null;
    const docNumber = sale.documentNumber || '';
    const customerName = sale.customer?.name || 'Cliente';

    // ============================================================
    // 1. LÍNEAS DE COBRO (DÉBITO)
    //    - Según método de pago y cuenta PUC del canal
    // ============================================================
    const payments = normalizeSalePayments(sale, PUC);
    let cobradoTotal = 0;

    payments.forEach(p => {
      if (p.amount <= 0) return;
      items.push({
        accountCode: p.accountCode,
        accountName: p.label,
        type: 'D',
        amount: p.amount,
        note: ''
      });
      cobradoTotal += p.amount;
    });

    // ============================================================
    // 2. INGRESO (CRÉDITO)
    //    - Mayorista → 413505 · Retail → 413510
    // ============================================================
    const baseVenta = (sale.commissionBase !== undefined)
      ? Number(sale.commissionBase)
      : (Number(sale.subtotal || 0) - Number(sale.discount || 0));

    const esMayorista = sale.saleMode === 'wholesale' || sale.isWholesaleSale === true;
    const ingresoAcc = esMayorista ? PUC.ingresosVentasMayor : PUC.ingresosVentasMenor;
    const ingresoName = esMayorista ? 'Venta mercancía al por mayor' : 'Venta mercancía al por menor';

    if (baseVenta > 0) {
      items.push({
        accountCode: ingresoAcc,
        accountName: ingresoName,
        type: 'C',
        amount: baseVenta,
        note: esMayorista ? 'Venta mayorista' : 'Venta retail'
      });
    }


    // ============================================================
    // 2b. ENVÍO (CRÉDITO a 4210)
    // ============================================================
    const shipping = Number(sale.shipping || 0);
    if (shipping > 0) {
      items.push({
        accountCode: PUC.envioCobrado,
        accountName: 'Ingresos por fletes y envíos',
        type: 'C',
        amount: shipping,
        note: 'Envío cobrado'
      });
    }

    // ============================================================
    // 2c. RECARGO TARJETA (CRÉDITO a 4295)
    // ============================================================
    const surcharge = Number(sale.surchargeAmount || 0);
    if (surcharge > 0) {
      items.push({
        accountCode: PUC.recargoTarjeta,
        accountName: 'Ingresos diversos (recargo tarjeta)',
        type: 'C',
        amount: surcharge,
        note: 'Recargo por pago con tarjeta'
      });
    }

    // ============================================================
    // 2d. IVA (preparado, desactivado por defecto)
    // ============================================================
    if (PUC.ivaEnabled) {
      const ivaTotal = (sale.items || []).reduce((sum, it) => {
        const taxRate = Number(it.taxRate || 0);
        if (taxRate > 0) {
          return sum + (Number(it.qty || 0) * Number(it.unitPrice || 0) * taxRate);
        }
        return sum;
      }, 0);

      if (ivaTotal > 0) {
        // Reducimos el ingreso base (neto) y agregamos el IVA como pasivo
        // Nota: ajustar la línea de ingreso para que sea sin IVA
        // Buscamos la línea de ingreso y le restamos el IVA
        const ingresoLine = items.find(i =>
          i.accountCode === ingresoAcc && i.type === 'C'
        );
        if (ingresoLine) {
          ingresoLine.amount = ingresoLine.amount - ivaTotal;
          ingresoLine.note = (ingresoLine.note || '') + ' (neto sin IVA)';
        }
        items.push({
          accountCode: PUC.ivaPorPagar,
          accountName: 'IVA por pagar',
          type: 'C',
          amount: ivaTotal,
          note: 'IVA generado en la venta'
        });
      }
    }

    // ============================================================
    // 3. COSTO DE VENTA (DÉBITO 613505)
    //    - Costo FIFO de los productos vendidos
    // ============================================================
    const costoTotal = (sale.items || []).reduce((sum, it) => {
      return sum + (Number(it.qty || 0) * Number(it.unitCost || 0));
    }, 0);

    if (costoTotal > 0) {
      items.push({
        accountCode: PUC.costoVenta,
        accountName: 'Costo de mercancía vendida',
        type: 'D',
        amount: costoTotal,
        note: 'Costo FIFO de los productos vendidos'
      });

      // ============================================================
      // 4. INVENTARIO (CRÉDITO 143505)
      // ============================================================
      items.push({
        accountCode: PUC.inventario,
        accountName: 'Mercancías no fabricadas por la empresa',
        type: 'C',
        amount: costoTotal,
        note: 'Salida de inventario por venta'
      });
    }

    // ============================================================
    // 5. TOTALES Y VALIDACIÓN
    // ============================================================
    const totalDebit = items
      .filter(i => i.type === 'D')
      .reduce((s, i) => s + Number(i.amount || 0), 0);
    const totalCredit = items
      .filter(i => i.type === 'C')
      .reduce((s, i) => s + Number(i.amount || 0), 0);

    // Cuadre: débitos deben igualar créditos
    const diff = Math.round(totalDebit - totalCredit);
    if (diff !== 0) {
      console.warn('[Accounting] Comprobante descuadrado por', diff, '· Venta', saleId);
      // Ajustar la línea de ingreso para cuadrar
      const ingresoLine = items.find(i =>
        i.accountCode === ingresoAcc && i.type === 'C'
      );
      if (ingresoLine) {
        ingresoLine.amount = Math.round(ingresoLine.amount + diff);
        ingresoLine.note = (ingresoLine.note || '') + ' (ajuste de cuadre)';
      }
    }

    const totalDebitFinal = items
      .filter(i => i.type === 'D')
      .reduce((s, i) => s + Number(i.amount || 0), 0);
    const totalCreditFinal = items
      .filter(i => i.type === 'C')
      .reduce((s, i) => s + Number(i.amount || 0), 0);

    // ============================================================
    // 6. CONCEPTO
    // ============================================================
    const concepto = docNumber
      ? `Venta #${docNumber} · ${customerName}`
      : `Venta · ${customerName}`;

    // ============================================================
    // 7. RETORNAR COMPROBANTE
    // ============================================================
    return {
      type: 'ingreso',
      date,
      concept: concepto,
      storeId: sale.storeId || null,
      storeName: sale.storeName || null,

      sourceType: 'sale',
      sourceId: saleId,
      sourceRef: docNumber,

      items,
      totalDebit: totalDebitFinal,
      totalCredit: totalCreditFinal,

      status: 'activo',
      notes: '',

      createdAt: new Date(),
      createdBy: meta.createdBy || null,
      createdByName: meta.createdByName || null
    };
  }

  /**
   * Construye un comprobante de reclasificación al confirmar el cobro
   * de una venta que estaba pendiente (contraentrega o crédito).
   * Mueve el saldo de "Clientes" a la cuenta del canal de pago.
   *
   * @param {object} sale - Venta con paymentBreakdown actualizado
   * @param {object} pucConfig - Config PUC
   * @param {object} meta - { createdBy, createdByName }
   * @returns {object} Comprobante de reclasificación
   */
  function buildCobroComprobante(sale, pucConfig = {}, meta = {}) {
    if (!sale) return null;
    const PUC = { ...PUC_DEFAULTS, ...pucConfig };

    const items = [];
    const date = new Date().toISOString().split('T')[0];
    const customerName = sale.customer?.name || 'Cliente';
    const docNumber = sale.documentNumber || '';

    // Débitos: cuentas PUC de cada canal
    const payments = normalizeSalePayments(
      { ...sale, paymentStatus: 'completed' },  // forzar cobrado
      PUC
    );

    let totalCobrado = 0;
    payments.forEach(p => {
      if (p.amount <= 0) return;
      items.push({
        accountCode: p.accountCode,
        accountName: p.label,
        type: 'D',
        amount: p.amount,
        note: 'Cobro confirmado'
      });
      totalCobrado += p.amount;
    });

    // Crédito: Clientes (por cobrar)
    if (totalCobrado > 0) {
      items.push({
        accountCode: PUC.clientesDefault,
        accountName: 'Clientes nacionales',
        type: 'C',
        amount: totalCobrado,
        note: 'Baja de cuentas por cobrar'
      });
    }

    const concepto = docNumber
      ? `Cobro venta #${docNumber} · ${customerName}`
      : `Cobro venta · ${customerName}`;

    return {
      type: 'ingreso',
      date,
      concept: concepto,
      storeId: sale.storeId || null,
      storeName: sale.storeName || null,

      sourceType: 'sale_collection',  // ← tipo distinto para no duplicar
      sourceId: sale.id,
      sourceRef: docNumber,

      items,
      totalDebit: items.filter(i => i.type === 'D').reduce((s,i) => s + i.amount, 0),
      totalCredit: items.filter(i => i.type === 'C').reduce((s,i) => s + i.amount, 0),

      status: 'activo',
      notes: '',

      createdAt: new Date(),
      createdBy: meta.createdBy || null,
      createdByName: meta.createdByName || null
    };
  }

    /* ============================================================
     🆕 MAPEO DE CATEGORÍAS DE GASTO → CUENTAS PUC
     Traduce la categoría del gasto a la cuenta contable.
  ============================================================ */
  const EXPENSE_CATEGORY_MAP = {
    arriendo:      { code: '512005', name: 'Arrendamientos',                    type: 'expense' },
    servicios:     { code: '513595', name: 'Otros servicios',                   type: 'expense' },
    nomina:        { code: '510506', name: 'Sueldos',                           type: 'expense' },
    papeleria:     { code: '519530', name: 'Útiles, papelería y fotocopias',    type: 'expense' },
    transporte:    { code: '519550', name: 'Transporte, fletes y acarreos',     type: 'expense' },
    publicidad:    { code: '519560', name: 'Publicidad, propaganda y promoción',type: 'expense' },
    mantenimiento: { code: '514505', name: 'Mantenimiento y reparaciones',      type: 'expense' },
    impuestos:     { code: '511505', name: 'Industria y comercio',              type: 'expense' },
    mercancia:     { code: '143505', name: 'Mercancías no fabricadas por la empresa', type: 'inventory' },
    otros:         { code: '519595', name: 'Otros gastos',                      type: 'expense' }
  };

  /**
   /**
   * Construye un comprobante contable a partir de un gasto.
   *
   * Reglas de débito:
   *   - Categoría "mercancia" → 143505 (Inventario, activo)
   *   - Otras categorías      → gasto según EXPENSE_CATEGORY_MAP
   *
   * Reglas de crédito (según el método de pago):
   *   1. Si está PAGADO y tiene paidMethod/paidChannelId/creditCardId:
   *      - efectivo      → 110505 Caja general
   *      - transferencia → channel.pucAccountCode
   *      - tarjeta       → card.pucAccountCode (PASIVO, no pago)
   *   2. Si está PAGADO pero no tiene método específico (compatibilidad):
   *      → 110505 Caja general (fallback)
   *   3. Si NO está pagado (a crédito):
   *      → 220505 Proveedores nacionales
   *
   * @param {object} expense - Doc de gasto
   * @param {object} pucConfig - Config PUC
   * @param {object} meta - { createdBy, createdByName, channels, cards }
   * @returns {object|null} Comprobante listo para insertar
   */
  function buildComprobanteFromExpense(expense, pucConfig = {}, meta = {}) {
    if (!expense) return null;

    const PUC = { ...PUC_DEFAULTS, ...pucConfig };

    const category = expense.category || 'otros';
    const catMap = EXPENSE_CATEGORY_MAP[category] || EXPENSE_CATEGORY_MAP.otros;

    const total = Number(expense.total || 0);
    if (total <= 0) return null;

    const items = [];

    // ============================================================
    // 1. DÉBITO: cuenta de gasto o inventario según categoría
    // ============================================================
    items.push({
      accountCode: catMap.code,
      accountName: catMap.name,
      type: 'D',
      amount: total,
      note: catMap.type === 'inventory' ? 'Compra de mercancía' : 'Gasto del período'
    });

    // ============================================================
    // 2. CRÉDITO: ¿cómo se pagó?
    // ============================================================
    const isPaid = !!expense.paidAt;
    const isCredit = !!expense.paymentTerms && expense.paymentTerms !== 'contado';

    let creditAccount;
    let creditNote = '';

    if (isPaid) {
      const paidMethod = expense.paidMethod || null;

      if (paidMethod === 'efectivo') {
        creditAccount = {
          code: PUC.cajaEfectivo,
          name: 'Caja general'
        };
        creditNote = 'Pago en efectivo';

      } else if (paidMethod === 'transferencia') {
        // Buscar el canal para obtener su cuenta PUC
        const channels = meta.channels || [];
        const channel = channels.find(c => c.id === expense.paidChannelId);
        if (channel && channel.pucAccountCode) {
          creditAccount = {
            code: channel.pucAccountCode,
            name: channel.pucAccountName || channel.bank || 'Banco'
          };
          creditNote = `Transferencia · ${channel.bank || ''}`.trim();
        } else {
          creditAccount = {
            code: PUC.bancosDefault,
            name: 'Bancos'
          };
          creditNote = 'Transferencia (canal no especificado)';
        }

      } else if (paidMethod === 'tarjeta') {
        // Buscar la tarjeta para obtener su cuenta PUC (pasivo)
        const cards = meta.cards || [];
        const card = cards.find(c => c.id === expense.creditCardId);
        if (card && card.pucAccountCode) {
          creditAccount = {
            code: card.pucAccountCode,
            name: card.pucAccountName || 'Tarjetas de crédito'
          };
          creditNote = `Tarjeta de crédito · ${card.name || ''}`.trim();
        } else {
          creditAccount = {
            code: '210505',
            name: 'Bancos nacionales (tarjeta)'
          };
          creditNote = 'Tarjeta de crédito (no especificada)';
        }

      } else {
        // Fallback: pagado pero sin método específico
        creditAccount = {
          code: PUC.cajaEfectivo,
          name: 'Caja general'
        };
        creditNote = 'Pago del gasto';
      }

    } else if (isCredit) {
      // A crédito con proveedor
      creditAccount = {
        code: '220505',
        name: 'Proveedores nacionales'
      };
      creditNote = 'Gasto a crédito';

    } else {
      // Sin pagar y sin plazo → cuentas por pagar genéricas
      creditAccount = {
        code: '220505',
        name: 'Proveedores nacionales'
      };
      creditNote = 'Gasto pendiente de pago';
    }

    items.push({
      accountCode: creditAccount.code,
      accountName: creditAccount.name,
      type: 'C',
      amount: total,
      note: creditNote
    });

    // ============================================================
    // 3. Totales
    // ============================================================
    const totalDebit = items.filter(i => i.type === 'D').reduce((s,i) => s + i.amount, 0);
    const totalCredit = items.filter(i => i.type === 'C').reduce((s,i) => s + i.amount, 0);

    // ============================================================
    // 4. Fecha
    // ============================================================
    const date = expense.date || new Date().toISOString().split('T')[0];

    // ============================================================
    // 5. Concepto
    // ============================================================
    const proveedor = expense.supplierName || expense.provider || '';
    const factura = expense.invoiceNumber ? ` · Factura ${expense.invoiceNumber}` : '';
    const concepto = proveedor
      ? `Gasto: ${expense.concept || catMap.name} · ${proveedor}${factura}`
      : `Gasto: ${expense.concept || catMap.name}${factura}`;

    // ============================================================
    // 6. Retornar comprobante
    // ============================================================
    return {
      type: 'egreso',
      date,
      concept: concepto,
      storeId: expense.storeId || null,
      storeName: null,

      sourceType: 'expense',
      sourceId: expense.id || null,
      sourceRef: expense.invoiceNumber || null,

      items,
      totalDebit,
      totalCredit,

      status: 'activo',
      notes: expense.notes || '',

      createdAt: new Date(),
      createdBy: meta.createdBy || null,
      createdByName: meta.createdByName || null
    };
  }

 window.SmartecAccounting = {
    buildMovementsFromComprobante,
    buildReversalMovements,
    buildPucMap,
    dateStrToTimestamp,
    buildComprobanteFromSale,
    buildCobroComprobante,
    normalizeSalePayments,
    PUC_DEFAULTS,
    buildComprobanteFromExpense,
    EXPENSE_CATEGORY_MAP,
    buildPaymentMethodsOptions,
    buildComprobanteFromNomina     // 🆕 NUEVO
  };

  console.log('[Smartec] accounting-engine.js cargado');
})();