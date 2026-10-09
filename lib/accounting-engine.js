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

  // Exponer al window
  window.SmartecAccounting = {
    buildMovementsFromComprobante,
    buildReversalMovements,
    buildPucMap,
    dateStrToTimestamp
  };

  console.log('[Smartec] accounting-engine.js cargado');
})();