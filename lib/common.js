/* ============================================================
   SMARTEC · Utilidades comunes
   Centraliza helpers usados por múltiples módulos.
   Expone todo en window.Smartec para no romper nada.
============================================================ */

window.Smartec = window.Smartec || {};

(function () {

  /* ============================================================
     FIREBASE CONFIG (única fuente de verdad)
  ============================================================ */
  window.Smartec.firebaseConfig = {
    apiKey: "AIzaSyCJ-bKabzQL5DIq2n1qlHKHadlEY17TT_I",
    authDomain: "smartec-8fc19.firebaseapp.com",
    projectId: "smartec-8fc19",
    storageBucket: "smartec-8fc19.firebasestorage.app",
    messagingSenderId: "879944967068",
    appId: "1:879944967068:web:287b3f2baf2c56f8b95e59",
    measurementId: "G-127MH9ZCN1"
  };

  /* ============================================================
     FORMATEO
  ============================================================ */
  window.Smartec.fmt = function (n) {
    return '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
  };

  window.Smartec.fmtDate = function (ts) {
    if (!ts) return '-';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleString('es-CO', {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  window.Smartec.fmtDateShort = function (ts) {
    if (!ts) return '-';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleDateString('es-CO', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
  };

  window.Smartec.todayStr = function () {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /* ============================================================
     TELÉFONOS
  ============================================================ */
  window.Smartec.normalizePhone = function (raw) {
    if (!raw) return '';
    let p = String(raw).replace(/\D/g, '');
    if (p.length === 10) p = '57' + p;
    return p;
  };

  /* ============================================================
     COLORES
  ============================================================ */
  window.Smartec.COLOR_NAMES = {
    '#000000': 'Negro', '#ffffff': 'Blanco', '#c0c0c0': 'Plateado', '#808080': 'Gris',
    '#ff0000': 'Rojo', '#00ff00': 'Verde', '#0000ff': 'Azul', '#ffff00': 'Amarillo',
    '#ffa500': 'Naranja', '#800080': 'Morado', '#ffc0cb': 'Rosado', '#a52a2a': 'Café',
    '#964b00': 'Café', '#8b4513': 'Café', '#d2b48c': 'Beige', '#f5f5dc': 'Crema',
    '#00ffff': 'Cian', '#008080': 'Turquesa', '#4a7a9a': 'Azul petróleo',
    '#0a2a4a': 'Azul oscuro', '#191970': 'Azul medianoche', '#f0f0f0': 'Blanco humo',
    '#e0e0e0': 'Gris claro', '#a9a9a9': 'Gris oscuro', '#ffd700': 'Dorado',
    '#b87333': 'Bronce', '#cd7f32': 'Bronce', '#36454f': 'Gris carbón'
  };

  window.Smartec.colorNameFromHex = function (hex, fallback) {
    if (!hex) return fallback || '';
    const k = String(hex).toLowerCase();
    return window.Smartec.COLOR_NAMES[k] || fallback || hex;
  };

  /* ============================================================
     HTML ESCAPE (previene XSS al inyectar datos del usuario)
  ============================================================ */
  window.Smartec.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* ============================================================
     FECHAS RELATIVAS
  ============================================================ */
  window.Smartec.timeAgo = function (ts) {
    if (!ts) return '-';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'hace ' + diff + 's';
    if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + 'min';
    if (diff < 86400) return 'hace ' + Math.floor(diff / 3600) + 'h';
    if (diff < 604800) return 'hace ' + Math.floor(diff / 86400) + 'd';
    return window.Smartec.fmtDateShort(ts);
  };

  /* ============================================================
     AUDITORÍA — NÚCLEO ENRIQUECIDO
  ============================================================ */

  /* Mapeo de acción → severidad */
  const SEVERITY_MAP = {
    'login':    'low',
    'logout':   'low',
    'create':   'medium',
    'update':   'medium',
    'sale':     'high',
    'cancel':   'high',
    'seed':     'high',
    'delete':   'critical',
    'cleanup':  'critical'
  };

  /* Mapeo de acción → categoría de retención */
  const RETENTION_MAP = {
    'login':   'noise',
    'logout':  'noise'
    // Todo lo demás → 'critical' (default)
  };

  /* Colores por severidad (para la UI) */
  const SEVERITY_COLORS = {
    'low':      { bg: 'bg-green-100',  text: 'text-green-700',  border: 'border-green-300',  emoji: '🟢' },
    'medium':   { bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-300',   emoji: '🔵' },
    'high':     { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', emoji: '🟠' },
    'critical': { bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-300',    emoji: '🔴' }
  };

  window.Smartec.getSeverity = function (action) {
    return SEVERITY_MAP[action] || 'medium';
  };

  window.Smartec.getRetentionCategory = function (action) {
    return RETENTION_MAP[action] || 'critical';
  };

  window.Smartec.getSeverityColors = function (severity) {
    return SEVERITY_COLORS[severity] || SEVERITY_COLORS.medium;
  };

  /* ============================================================
     SESSION ID (uno por pestaña)
  ============================================================ */
  window.Smartec.getSessionId = function () {
    try {
      let sid = sessionStorage.getItem('smartec_audit_session');
      if (!sid) {
        sid = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem('smartec_audit_session', sid);
      }
      return sid;
    } catch (e) {
      return 'sess_unknown';
    }
  };

  /* ============================================================
     DIFF AUTOMÁTICO (before/after → campos cambiados + resumen)
  ============================================================ */
  const SKIP_FIELDS = ['updatedAt', 'createdAt', 'id', 'timestamp'];

  function formatValueShort(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') {
      if (Array.isArray(v)) return `[${v.length} items]`;
      return '{…}';
    }
    if (typeof v === 'number') {
      // Si parece un precio, formatearlo
      if (v > 1000 && Number.isInteger(v)) {
        return '$' + v.toLocaleString('es-CO');
      }
      return String(v);
    }
    const s = String(v);
    return s.length > 40 ? s.slice(0, 37) + '…' : s;
  }

  window.Smartec.computeDiff = function (before, after) {
    if (!before && !after) return { fields: [], summary: '' };
    if (!before) return { fields: [], summary: 'Registro nuevo' };
    if (!after) return { fields: [], summary: 'Registro eliminado' };

    const fields = [];
    const changes = [];

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    allKeys.forEach(key => {
      if (SKIP_FIELDS.includes(key)) return;

      const b = JSON.stringify(before[key]);
      const a = JSON.stringify(after[key]);

      if (b !== a) {
        fields.push(key);
        changes.push(`${key}: ${formatValueShort(before[key])} → ${formatValueShort(after[key])}`);
      }
    });

    const summary = changes.length === 0
      ? 'Sin cambios detectados'
      : (changes.slice(0, 3).join(' · ') + (changes.length > 3 ? ` (+${changes.length - 3} más)` : ''));

    return { fields, summary };
  };

  /* ============================================================
     AUDIT — función principal
     Uso: await window.Smartec.audit({ action, collection, docId, ... }, ctx)
     ctx = { user, userData, store, storeName, db }
  ============================================================ */
  window.Smartec.audit = async function (entry, ctx) {
    try {
      if (!ctx || !ctx.db) {
        console.warn('[audit] Falta ctx.db, no se puede auditar');
        return;
      }

      // Import dinámico de Firestore (evita dependencia global)
      const { addDoc, collection, serverTimestamp } = await import(
        "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js"
      );

      const action = entry.action || 'update';
      const severity = window.Smartec.getSeverity(action);
      const retentionCategory = window.Smartec.getRetentionCategory(action);

      // Calcular diff si hay before/after
      let changedFields = entry.changedFields || [];
      let changeSummary = entry.changeSummary || '';
      if ((entry.before || entry.after) && !changeSummary) {
        const diff = window.Smartec.computeDiff(entry.before, entry.after);
        changedFields = diff.fields;
        changeSummary = diff.summary;
      }

      const doc = {
        // Identidad del evento
        action,
        collection: entry.collection || null,
        docId: entry.docId || null,

        // Quién
        userId: ctx.user?.uid || null,
        userEmail: ctx.user?.email || null,
        userName: ctx.userData?.name || ctx.user?.email || null,
        userRole: ctx.userData?.role || null,
        userStoreId: ctx.store?.storeId || ctx.userData?.storeId || null,
        userStoreName: ctx.store?.name || ctx.storeName || null,
        sessionId: window.Smartec.getSessionId(),

        // Qué afectó
        entityLabel: entry.entityLabel || null,
        changedFields,
        changeSummary,
        before: entry.before || null,
        after: entry.after || null,
        note: entry.note || null,

        // Metadata
        severity,
        retentionCategory,
        timestamp: serverTimestamp()
      };

      // Limpiar campos null/undefined para no inflar el doc
      Object.keys(doc).forEach(k => {
        if (doc[k] === null || doc[k] === undefined) delete doc[k];
      });

      await addDoc(collection(ctx.db, 'auditLog'), doc);

    } catch (e) {
      // No romper la app por fallo de auditoría
      console.warn('[audit] Falló el registro:', e);
    }
  };

  /* ============================================================
     AUDITORÍA — Helpers de clasificación para la UI
  ============================================================ */
  window.Smartec.ACTION_LABELS = {
    'login':   'Inicio de sesión',
    'logout':  'Cierre de sesión',
    'create':  'Creación',
    'update':  'Actualización',
    'delete':  'Borrado',
    'sale':    'Venta',
    'cancel':  'Anulación',
    'seed':    'Migración',
    'cleanup': 'Limpieza'
  };

  window.Smartec.actionLabel = function (action) {
    return window.Smartec.ACTION_LABELS[action] || action;
  };
  /* ============================================================
     ESTILOS DEL MODO KIOSCO
  ============================================================ */
  (function injectKioskStyles() {
    if (document.getElementById('smartec-kiosk-styles')) return;
    const style = document.createElement('style');
    style.id = 'smartec-kiosk-styles';
    style.textContent = `
      body.kiosk-mode {
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        overflow-x: hidden;
      }
      body.kiosk-mode input,
      body.kiosk-mode textarea {
        user-select: text;
        -webkit-user-select: text;
      }
      body.kiosk-mode::after {
        content: '🔒 MODO KIOSCO';
        position: fixed;
        top: 0;
        right: 0;
        background: #dc2626;
        color: white;
        font-size: 10px;
        font-weight: bold;
        padding: 4px 10px;
        border-bottom-left-radius: 8px;
        z-index: 9999;
        pointer-events: none;
        letter-spacing: 1px;
      }
    `;
    document.head.appendChild(style);
  })();
  /* ============================================================
     FIN
  ============================================================ */
  console.log('[Smartec] common.js cargado · v2.0 (auditoría enriquecida)');

})();