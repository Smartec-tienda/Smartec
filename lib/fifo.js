/* ============================================================
   SMARTEC · fifo.js
   Motor FIFO para inventario por lotes
   
   Reglas:
   - Cada item de inventory tiene batches[] con { id, qty, cost, entryDate, source }
   - El stock se calcula: sum(batches[].qty)
   - El costo promedio actual se calcula sobre los lotes activos
   - Al vender/consumir, se descuenta FIFO (lote más viejo primero)
   
   Uso: cargar con <script src="lib/fifo.js"></script> en las páginas
   que lo necesiten (venta.html, admin.html, tiendas.html).
============================================================ */

(function () {
  'use strict';

  /**
   * Genera un ID único para un lote.
   */
  function newBatchId() {
    return 'batch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Suma las cantidades de todos los lotes.
   * Es el stock "real" del inventario.
   */
  function sumBatchesQty(batches) {
    if (!Array.isArray(batches)) return 0;
    return batches.reduce((s, b) => s + Number(b.qty || 0), 0);
  }

  /**
   * Calcula el costo promedio ponderado actual.
   * Fórmula: sum(qty × cost) / sum(qty)
   */
  function avgCostFromBatches(batches) {
    if (!Array.isArray(batches) || !batches.length) return 0;
    let totalQty = 0;
    let totalCost = 0;
    batches.forEach(b => {
      const q = Number(b.qty || 0);
      const c = Number(b.cost || 0);
      totalQty += q;
      totalCost += q * c;
    });
    if (totalQty === 0) return 0;
    return totalCost / totalQty;
  }

  /**
   * Normaliza un inventario para asegurar que tenga batches[].
   * Si no tiene y tiene stock > 0, crea un lote de respaldo con el costo indicado.
   * 
   * @param {object} inv - Documento del inventario (con o sin batches)
   * @param {number} fallbackCost - Costo a usar si hay que crear lote de respaldo
   * @returns {object} - { batches, stock, wasNormalized }
   */
  function normalizeInventory(inv, fallbackCost = 0) {
    const stock = Number(inv?.stock || 0);
    let batches = Array.isArray(inv?.batches) ? inv.batches.slice() : [];
    let wasNormalized = false;

    // Si no hay batches pero hay stock → crear lote de respaldo
    if (!batches.length && stock > 0) {
      batches = [{
        id: newBatchId(),
        qty: stock,
        qtyOriginal: stock,
        cost: Number(fallbackCost) || 0,
        entryDate: new Date().toISOString().split('T')[0],
        source: 'migracion',
        sourceId: null,
        createdBy: 'system',
        createdAt: new Date().toISOString()
      }];
      wasNormalized = true;
    }

    return {
      batches,
      stock: sumBatchesQty(batches),
      wasNormalized
    };
  }

  /**
   * Consume `qty` unidades usando FIFO (lote más viejo primero).
   * 
   * @param {array} batches - Array de lotes
   * @param {number} qty - Cantidad a consumir
   * @returns {object} - {
   *   ok: boolean,           // si se pudo consumir todo
   *   consumed: [            // lotes consumidos, en orden
   *     { batchId, qty, cost, entryDate }
   *   ],
   *   newBatches: [          // lotes restantes (ya sin las cantidades consumidas)
   *   avgCost: number,       // costo promedio ponderado de lo consumido
   *   missing: number        // cuánto faltó (si ok=false)
   * }
   */
  function consumeFIFO(batches, qty) {
    const qtyNeeded = Number(qty || 0);
    if (qtyNeeded <= 0) {
      return { ok: true, consumed: [], newBatches: (batches || []).slice(), avgCost: 0, missing: 0 };
    }

    // Ordenar por fecha de entrada (más viejo primero)
    // Prioridad: createdAt (timestamp con hora) > entryDate > id
    const sorted = (batches || []).slice().sort((a, b) => {
      // 1. Intentar ordenar por createdAt (timestamp ISO con hora)
      const ca = String(a.createdAt || '');
      const cb = String(b.createdAt || '');
      if (ca && cb && ca !== cb) return ca.localeCompare(cb);

      // 2. Si no hay createdAt, usar entryDate
      const da = String(a.entryDate || '');
      const db = String(b.entryDate || '');
      if (da !== db) return da.localeCompare(db);

      // 3. Último desempate: por id
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    let remaining = qtyNeeded;
    const consumed = [];
    const newBatches = [];

    for (const batch of sorted) {
      if (remaining <= 0) {
        // No más consumo → este lote queda intacto
        newBatches.push({ ...batch });
        continue;
      }

      const available = Number(batch.qty || 0);
      if (available <= 0) {
        // Lote vacío → lo saltamos (no lo agregamos al nuevo array)
        continue;
      }

      if (available <= remaining) {
        // Consumir todo este lote
        consumed.push({
          batchId: batch.id,
          qty: available,
          cost: Number(batch.cost || 0),
          entryDate: batch.entryDate || null,
          source: batch.source || null
        });
        remaining -= available;
        // Este lote desaparece (qty = 0)
      } else {
        // Consumir parcialmente este lote
        consumed.push({
          batchId: batch.id,
          qty: remaining,
          cost: Number(batch.cost || 0),
          entryDate: batch.entryDate || null,
          source: batch.source || null
        });
        newBatches.push({
          ...batch,
          qty: available - remaining
        });
        remaining = 0;
      }
    }

    // Calcular costo promedio de lo consumido
    let totalConsumedQty = 0;
    let totalConsumedCost = 0;
    consumed.forEach(c => {
      totalConsumedQty += c.qty;
      totalConsumedCost += c.qty * c.cost;
    });
    const avgCost = totalConsumedQty > 0 ? totalConsumedCost / totalConsumedQty : 0;

    return {
      ok: remaining <= 0,
      consumed,
      newBatches,
      avgCost,
      missing: Math.max(0, remaining)
    };
  }

  /**
   * Crea un nuevo lote para agregar stock.
   * 
   * @param {number} qty - Cantidad del lote
   * @param {number} cost - Costo unitario
   * @param {string} source - 'compra' | 'ajuste' | 'devolucion' | 'traslado' | 'migracion'
   * @param {object} meta - { sourceId, sourceRef, createdBy }
   * @returns {object} - El lote creado
   */
  function createBatch(qty, cost, source = 'compra', meta = {}) {
    const q = Number(qty || 0);
    if (q <= 0) throw new Error('La cantidad del lote debe ser > 0');

    return {
      id: newBatchId(),
      qty: q,
      qtyOriginal: q,
      cost: Number(cost || 0),
      entryDate: new Date().toISOString().split('T')[0],
      source,
      sourceId: meta.sourceId || null,
      sourceRef: meta.sourceRef || null,
      createdBy: meta.createdBy || 'system',
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Reintegra lotes consumidos (para devoluciones/anulaciones).
   * Devuelve un nuevo array de batches con las cantidades reintegradas.
   * 
   * Si un lote original ya no existe, se crea uno nuevo con el mismo costo.
   */
  function reintegrateBatches(currentBatches, consumedList) {
    const batches = (currentBatches || []).map(b => ({ ...b }));

    for (const c of (consumedList || [])) {
      const existing = batches.find(b => b.id === c.batchId);
      if (existing) {
        // Sumar la cantidad al lote existente
        existing.qty = Number(existing.qty || 0) + Number(c.qty || 0);
      } else {
        // El lote ya no existe → crear uno nuevo con el mismo costo
        batches.push({
          id: c.batchId || newBatchId(),
          qty: Number(c.qty || 0),
          qtyOriginal: Number(c.qty || 0),
          cost: Number(c.cost || 0),
          entryDate: new Date().toISOString().split('T')[0],
          source: 'devolucion',
          sourceId: null,
          createdBy: 'system',
          createdAt: new Date().toISOString()
        });
      }
    }

    return batches;
  }

  // ============================================================
  // Exponer al window
  // ============================================================
  window.SmartecFIFO = {
    newBatchId,
    sumBatchesQty,
    avgCostFromBatches,
    normalizeInventory,
    consumeFIFO,
    createBatch,
    reintegrateBatches
  };

  console.log('[Smartec] fifo.js cargado');
})();