/* ============================================================
   SMARTEC · favicon.js
   Aplica el favicon dinámico desde settings/general.faviconUrl
   Uso: <script src="components/favicon.js"></script> en cualquier página.
   Requiere: firebase (compat o modular) + Firestore ya inicializados.
============================================================ */

(function () {
  'use strict';

  const FIREBASE_PROJECT = 'smartec-8fc19';

  /**
   * Inyecta (o reemplaza) los <link rel="icon"> en el <head>.
   */
  function applyFavicon(url) {
    if (!url) return;

    // Detectar extensión para el atributo type
    const cleanUrl = url.split('?')[0];
    const ext = cleanUrl.split('.').pop().toLowerCase();
    const typeMap = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      ico: 'image/x-icon'
    };
    const mime = typeMap[ext] || 'image/png';

    // Quitar cualquier favicon previo
    document.querySelectorAll(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
    ).forEach(el => el.remove());

    // Insertar los nuevos
    const head = document.head;

    // Favicon principal (el que pinta el navegador)
    const mainLink = document.createElement('link');
    mainLink.rel = 'icon';
    mainLink.type = mime;
    mainLink.href = url;
    head.appendChild(mainLink);

    // Shortcut icon (compatibilidad navegadores viejos)
    const shortcut = document.createElement('link');
    shortcut.rel = 'shortcut icon';
    shortcut.type = mime;
    shortcut.href = url;
    head.appendChild(shortcut);

    // Apple touch icon (iOS, cuando se agrega a pantalla de inicio)
    const apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.href = url;
    head.appendChild(apple);

    console.log('[FAVICON] Aplicado:', url);
  }

  /**
   * Lee settings/general de Firestore usando la REST API pública.
   * No requiere cargar el SDK completo de Firebase.
   */
  async function fetchFaviconUrl() {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/settings/general?key=AIzaSyCJ-bKabzQL5DIq2n1qlHKHadlEY17TT_I`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const faviconUrl = data?.fields?.faviconUrl?.stringValue || null;
      return faviconUrl;
    } catch (e) {
      console.warn('[FAVICON] No se pudo leer faviconUrl:', e);
      return null;
    }
  }

  /**
   * Función principal.
   */
  async function init() {
    // Si ya hay un favicon forzado en el HTML, respetarlo (por si acaso)
    // pero igual intentamos sobrescribir con el dinámico.

    const url = await fetchFaviconUrl();
    if (url) {
      applyFavicon(url);
    } else {
      console.log('[FAVICON] No hay favicon configurado, se usa el por defecto.');
    }
  }

  // Ejecutar cuando el DOM esté listo (por si el <head> aún no está armado)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exponer por si se necesita re-aplicar tras un cambio
  window.SmartecFavicon = { apply: applyFavicon, reload: init };

  console.log('[Smartec] favicon.js cargado');
})();