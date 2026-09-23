/* ============================================================
   SMARTEC · Utilidades comunes
   Centraliza helpers usados por múltiples módulos.
   Se expone todo en window.Smartec para no romper nada.
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

})();