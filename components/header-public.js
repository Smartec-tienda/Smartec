/* ============================================================
   SMARTEC · header-public.js
   Header de tienda pública (index2.html, producto.html).
   Uso:
     <div id="smartec-header-public"></div>
     

     <script>
       SmartecHeaderPublic.render({
         settings: { logoUrl, categories, ... }
       });
     </script>
============================================================ */

(function () {
  'use strict';

  /**
   * Devuelve true si la categoría debe mostrarse según la temporada.
   */
function isCategoryVisible(slug, group) {
  return group.seasonalActive !== false;
}

  /**
   * Escape básico.
   */
  function escapeHtml(str) {
    if (window.Smartec && typeof window.Smartec.escapeHtml === 'function') {
      return window.Smartec.escapeHtml(str);
    }
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * HTML del header.
   * opts: { logoUrl, categories }
   */
  function buildHeaderHtml(opts) {
    const logoUrl = opts?.logoUrl || null;
    const categories = opts?.categories || {};

    // Logo o texto por defecto
    const logoHtml = logoUrl
      ? `<img id="header-logo-img" src="${logoUrl}" alt="Smartec"
              class="h-6 md:h-10 object-contain" decoding="async">`
      : `<span id="header-logo-text" class="text-lg md:text-3xl font-extrabold logo-mark">SMARTEC</span>`;

    // Categorías visibles
    const visibleGroups = Object.entries(categories)
      .filter(([slug, g]) => isCategoryVisible(slug, g))
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

    const categoriesPills = visibleGroups.map(([slug, g]) => `
      <li>
        <button data-group="${slug}"
          class="cat-nav-btn whitespace-nowrap px-4 py-1.5 rounded-full text-[#6E6E73]">
          ${escapeHtml(g.name)}
        </button>
      </li>
    `).join('');

    const hideCategories = opts?.hideCategories === true;
    const showBackButton = opts?.showBackButton === true;
    const searchRedirect = opts?.searchRedirect || null; // ej: 'index.html'

    const backBtnHtml = showBackButton
      ? `<button onclick="history.back()" class="p-2 rounded-full hover:bg-black/5 transition text-[#1D1D1F] shrink-0" title="Volver">
           <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
             <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
           </svg>
         </button>`
      : '';

    const navHtml = hideCategories ? '' : `
      <!-- Nav categorías -->
      <nav class="border-t border-black/5">
        <div class="container mx-auto px-4 lg:px-6">
          <ul id="categories-nav" class="flex gap-1 py-3 text-sm overflow-x-auto scrollbar-thin">
            <li>
              <button data-group="all"
                class="cat-nav-btn active whitespace-nowrap px-4 py-1.5 rounded-full">
                Todos
              </button>
            </li>
            ${categoriesPills}
          </ul>
        </div>
      </nav>
    `;

    return `
      <header class="glass-strong sticky top-0 z-40 border-b border-white/50">
        <div class="container mx-auto px-4 lg:px-6 py-3 flex items-center justify-between gap-4">
          <div class="flex items-center gap-2 shrink-0">
            ${backBtnHtml}
            <a href="index.html" id="header-logo-link" class="flex items-center">
              ${logoHtml}
            </a>
          </div>

          <!-- Buscador desktop -->
          <div class="flex-1 max-w-xl hidden md:flex relative">
            <div class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </div>
            <input id="search-input" type="text" placeholder="Buscar productos"
              class="w-full pl-11 pr-4 py-2.5 rounded-full text-sm"
              ${searchRedirect ? `data-redirect="${searchRedirect}"` : ''}>
          </div>

          <div class="flex items-center gap-2">
            <button id="mobile-search-toggle"
              class="md:hidden text-[#1D1D1F] p-2 hover:bg-black/5 rounded-full transition">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Buscador móvil -->
        <div id="mobile-search" class="hidden md:hidden px-4 pb-3">
          <input id="search-input-mobile" type="text" placeholder="Buscar productos"
            class="w-full px-4 py-2.5 rounded-full text-sm"
            ${searchRedirect ? `data-redirect="${searchRedirect}"` : ''}>
        </div>

        ${navHtml}
      </header>
    `;
  }

  /**
   * Render principal.
   * opts: {
   *   targetId: 'smartec-header-public' (default),
   *   settings: { logoUrl, categories }
   * }
   */
  async function render(opts) {
    opts = opts || {};
    const targetId = opts.targetId || 'smartec-header-public';
    let settings = opts.settings || {};
    const target = document.getElementById(targetId);

    if (!target) {
      console.warn('[HeaderPublic] No se encontró el contenedor #' + targetId);
      return;
    }

    // Si no nos pasaron settings, buscarlos en Firestore (settings/general)
    if (!settings || !Object.keys(settings).length) {
      try {
        if (window.__FIREBASE_CONFIG) {
          // Reutilizamos la cache del proyecto
          const cacheKey = 'header_public_settings_general';
          const fetchSettings = async () => {
            const mod = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js");
            const appMod = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js");

            let app;
            try { app = appMod.getApp(); } catch (e) { app = appMod.initializeApp(window.__FIREBASE_CONFIG); }
            const db = mod.getFirestore(app);
            const snap = await mod.getDoc(mod.doc(db, 'settings', 'general'));
            return snap.exists() ? snap.data() : {};
          };

          settings = (window.SmartecCache && window.SmartecCache.wrap)
            ? await window.SmartecCache.wrap(cacheKey, fetchSettings)
            : await fetchSettings();
        }
      } catch (e) {
        console.warn('[HeaderPublic] No se pudieron cargar settings desde Firestore:', e);
      }
    }

    target.innerHTML = buildHeaderHtml({
      logoUrl: settings.logoUrl || settings.footerLogoUrl || null,
      categories: settings.categories || {},
      hideCategories: opts.hideCategories === true,
      showBackButton: opts.showBackButton === true,
      searchRedirect: opts.searchRedirect || null
    });

    // 🆕 Si searchRedirect está definido, el buscador redirige en vez de filtrar
    if (opts.searchRedirect) {
      const redirect = opts.searchRedirect;
      const inputs = target.querySelectorAll('#search-input, #search-input-mobile');
      inputs.forEach(inp => {
        let t;
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const q = inp.value.trim();
            if (q) window.location.href = `${redirect}?search=${encodeURIComponent(q)}`;
          }
        });
        inp.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(() => {
            const q = inp.value.trim();
            if (q) window.location.href = `${redirect}?search=${encodeURIComponent(q)}`;
          }, 800);
        });
      });
    }

    console.log('[HeaderPublic] Renderizado');
  }

  // Exponer API
  window.SmartecHeaderPublic = { render };

  console.log('[Smartec] header-public.js cargado');
})();