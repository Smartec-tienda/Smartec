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
    if (!group.seasonal) return true;
    if (group.seasonalActive === false) return false;
    if (group.seasonalActive === true) return true;
    const month = new Date().getMonth() + 1;
    return month === 12;
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
              class="h-8 md:h-10 object-contain" decoding="async">`
      : `<span id="header-logo-text" class="text-2xl md:text-3xl font-extrabold logo-mark">SMARTEC</span>`;

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

    return `
      <header class="glass-strong sticky top-0 z-40 border-b border-white/50">
        <div class="container mx-auto px-4 lg:px-6 py-3 flex items-center justify-between gap-4">
          <a href="index.html" id="header-logo-link" class="shrink-0 flex items-center">
            ${logoHtml}
          </a>

          <!-- Buscador desktop -->
          <div class="flex-1 max-w-xl hidden md:flex relative">
            <div class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </div>
            <input id="search-input" type="text" placeholder="Buscar productos"
              class="w-full pl-11 pr-4 py-2.5 rounded-full text-sm">
          </div>

          <div class="flex items-center gap-2">
            <button id="mobile-search-toggle"
              class="md:hidden text-[#1D1D1F] p-2 hover:bg-black/5 rounded-full transition">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </button>
            <a href="venta.html"
              class="hidden lg:inline-flex items-center gap-1.5 text-sm font-medium text-[#1D1D1F] hover:text-[#0071E3] transition px-4 py-2 rounded-full hover:bg-black/5">
              Punto de venta
            </a>
          </div>
        </div>

        <!-- Buscador móvil -->
        <div id="mobile-search" class="hidden md:hidden px-4 pb-3">
          <input id="search-input-mobile" type="text" placeholder="Buscar productos"
            class="w-full px-4 py-2.5 rounded-full text-sm">
        </div>

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

        <!-- Subcategorías -->
        <div id="subcategories-bar" class="hidden border-t border-black/5 bg-white/40 backdrop-blur">
          <div class="container mx-auto px-4 lg:px-6 py-3">
            <div id="subcategories-list" class="flex gap-2 overflow-x-auto scrollbar-thin"></div>
          </div>
        </div>
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
  function render(opts) {
    opts = opts || {};
    const targetId = opts.targetId || 'smartec-header-public';
    const settings = opts.settings || {};
    const target = document.getElementById(targetId);

    if (!target) {
      console.warn('[HeaderPublic] No se encontró el contenedor #' + targetId);
      return;
    }

    target.innerHTML = buildHeaderHtml({
      logoUrl: settings.logoUrl || null,
      categories: settings.categories || {}
    });

    console.log('[HeaderPublic] Renderizado');
  }

  // Exponer API
  window.SmartecHeaderPublic = { render };

  console.log('[Smartec] header-public.js cargado');
})();