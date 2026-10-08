/* ============================================================
   SMARTEC · header-app.js
   Header para páginas internas (home, mis_ventas, inventario,
   clientes, garantias, domicilios, tiendas, contabilidad, etc.).
   NO usar en venta.html ni admin.html (tienen headers propios).
============================================================ */

(function () {
  'use strict';

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
   * Construye el HTML del header.
   */
  function buildHeaderHtml(opts) {
    const settings = opts.settings || {};
    const user = opts.user || {};
    const stores = opts.stores || [];
    const currentStore = opts.currentStore || null;

    const logoUrl = settings.logoUrl || null;
    const logoHtml = logoUrl
      ? `<img id="header-app-logo-img" src="${logoUrl}" alt="Smartec"
              class="h-6 sm:h-8 lg:h-10 object-contain" decoding="async">`
      : `<span id="header-app-logo-text" class="text-base sm:text-lg lg:text-xl font-extrabold logo-mark">SMARTEC</span>`;

    // Info del vendedor
    const sellerInfoHtml = opts.showSellerInfo && user.email
      ? `<span id="header-app-seller-info" class="hidden lg:inline text-xs text-[#6E6E73] font-medium">
           👤 ${escapeHtml(user.email)}
         </span>`
      : '';
    // Título contextual (ej: "Mis Ventas · Tienda X")
    const titleHtml = opts.showTitle
      ? `<p id="header-app-title" class="text-sm md:text-base font-semibold text-[#1D1D1F] truncate">
           ${escapeHtml(opts.titleText || '')}
         </p>`
      : '';

    // Rol del usuario
    const roleLabels = { superadmin: 'Superadmin', admin: 'Admin de tienda', vendedor: 'Vendedor' };
    const roleHtml = opts.showRole && user.role
      ? `<p id="header-app-role" class="text-[10px] text-[#6E6E73]">
           ${escapeHtml(roleLabels[user.role] || user.role)}
         </p>`
      : '';
    // Botón de turno
    const shiftBtnHtml = opts.showShiftButton
      ? `<button id="shift-btn" onclick="if(window.SmartecShift){window.SmartecShift.toggleShift()}"
            class="flex items-center gap-2 text-xs glass-soft hover:bg-white/80 px-2.5 md:px-3 py-1.5 rounded-full transition font-semibold text-[#1D1D1F] whitespace-nowrap">
            <span id="shift-btn-icon">🟢</span>
            <span id="shift-btn-text" class="hidden sm:inline">Marcar entrada</span>
            <span id="shift-timer" class="hidden text-[10px] opacity-80 font-mono"></span>
         </button>`
      : '';

    // Botón refrescar
    const refreshBtnHtml = opts.showRefreshButton
      ? `<button id="header-app-refresh-btn"
            class="glass-soft hover:bg-white/80 p-2 rounded-full transition text-[#1D1D1F]"
            title="Refrescar datos">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
         </button>`
      : '';

    // Links extra
    const extraLinksHtml = (opts.extraLinks || []).map(l => `
      <a href="${escapeHtml(l.href)}"
         class="glass-soft hover:bg-white/80 px-3 py-2 rounded-full transition text-[#1D1D1F] font-semibold hidden md:inline-flex items-center gap-1.5 text-xs">
        ${escapeHtml(l.label)}
      </a>
    `).join('');

    // Botón Home (label configurable)
    const homeLinkLabel = opts.homeLinkLabel || 'Inicio';
    const homeLinkHref = opts.homeLinkHref || 'home.html';
    const homeBtnHtml = opts.showHomeLink
      ? `<a href="${escapeHtml(homeLinkHref)}"
            class="glass-soft hover:bg-white/80 px-4 py-2 rounded-full transition text-[#1D1D1F] font-semibold inline-flex items-center gap-2 text-xs">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
            </svg>
            ${escapeHtml(homeLinkLabel)}
         </a>`
      : '';

    // Botón Salir
    const logoutBtnHtml = opts.showLogoutButton
      ? `<button id="logout-btn"
            class="bg-[#FF375F] hover:bg-[#E0304F] text-white px-4 py-1.5 rounded-full transition text-xs font-semibold shadow-apple">
            Salir
         </button>`
      : '';

    // Selector de tienda (solo si la opción está activa)
    let storeSelectorHtml = '';
    if (opts.showStoreSelector) {
      const isSuper = user.role === 'superadmin';
      if (isSuper && stores.length) {
        // Opción "Todas las tiendas" si está habilitada
        const allOption = opts.storeSelectorIncludeAll
          ? `<option value="all" ${currentStore && currentStore.storeId === 'all' ? 'selected' : ''}>
               🏪 Todas las tiendas
             </option>`
          : '';

        const options = stores.map(s => `
          <option value="${s.storeId}" ${currentStore && currentStore.storeId === s.storeId ? 'selected' : ''}>
            🏢 ${escapeHtml(s.name)}
          </option>
        `).join('');

        storeSelectorHtml = `
          <select id="header-app-store-selector"
            class="text-sm rounded-xl px-3 py-1.5"
            style="color:#1D1D1F;background-color:rgba(255,255,255,0.85);border:1px solid rgba(0,0,0,0.08);cursor:pointer;min-width:200px;">
            ${allOption}${options}
          </select>
        `;
      } else if (currentStore && currentStore.name) {
        storeSelectorHtml = `
          <p id="header-app-store-text" class="text-sm font-semibold text-[#1D1D1F] truncate">
            ${escapeHtml(currentStore.name)}
          </p>
        `;
      }
    }

    return `
      <header class="glass-strong sticky top-0 z-40 border-b border-white/50 shrink-0">
        <div class="px-3 md:px-4 py-2 md:py-3">

          <!-- ═══════════════════════════════════════════
               DESKTOP (lg+): Todo en una fila
          ═══════════════════════════════════════════ -->
          <div class="hidden lg:flex items-center justify-between gap-3">

            <!-- Logo + título + tienda -->
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <a href="home.html" class="flex items-center shrink-0">
                ${logoHtml}
              </a>

              ${(storeSelectorHtml || titleHtml) ? '<div class="w-px h-6 bg-black/10 shrink-0"></div>' : ''}

              <div class="min-w-0 flex flex-col gap-0.5">
                ${titleHtml}
                ${roleHtml}
                ${storeSelectorHtml}
              </div>
            </div>

            <!-- Acciones (todas) -->
            <div class="flex items-center gap-2 text-sm shrink-0">
              ${shiftBtnHtml}
              ${sellerInfoHtml}
              ${extraLinksHtml}
              ${refreshBtnHtml}
              ${homeBtnHtml}
              ${logoutBtnHtml}
            </div>
          </div>

          <!-- ═══════════════════════════════════════════
               MÓVIL + TABLET (<lg): 2 filas
          ═══════════════════════════════════════════ -->
          <div class="flex lg:hidden flex-col gap-2">

            <!-- Fila 1: Logo + acciones esenciales -->
            <div class="flex items-center justify-between gap-2">
              <a href="home.html" class="flex items-center shrink-0">
                ${logoHtml}
              </a>

              <div class="flex items-center gap-1.5 shrink-0">
                ${shiftBtnHtml}
                  ${opts.showHomeLink ? `<a href="${escapeHtml(homeLinkHref)}"
                      class="glass-soft hover:bg-white/80 p-2 rounded-full transition text-[#1D1D1F]"
                      title="${escapeHtml(homeLinkLabel)}">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                      </svg>
                    </a>` : ''}
                ${logoutBtnHtml}
              </div>
            </div>

            <!-- Fila 2: Título + Rol + Selector -->
            <div class="flex flex-col gap-0.5 min-w-0">
              ${titleHtml}
              ${roleHtml}
              ${storeSelectorHtml}
            </div>

          </div>

        </div>
      </header>
      <style>
        /* FIX móvil: asegurar que el header no sea tapado y que sus botones sean clickeables */
        #smartec-header-app {
          position: relative;
          z-index: 60;
        }
        #smartec-header-app header {
          position: sticky;
          top: 0;
          z-index: 60;
          pointer-events: auto;
        }
        #smartec-header-app header button,
        #smartec-header-app header a {
          pointer-events: auto;
          position: relative;
          z-index: 61;
          cursor: pointer;
        }
        /* En móvil, dar más espacio a la fila de acciones */
        @media (max-width: 767px) {
          #smartec-header-app header .flex.md\\:hidden.flex-col.gap-2 > div:first-child {
            flex-wrap: wrap;
            row-gap: 6px;
          }
        }
      </style>
    `;
  }

  /**
   * Conecta los listeners de los botones.
   */
  function attachListeners(opts) {
    // Refrescar
    const refreshBtn = document.getElementById('header-app-refresh-btn');
    if (refreshBtn && typeof opts.onRefresh === 'function') {
      refreshBtn.onclick = () => opts.onRefresh();
    }

    // Salir
    // ⚠️ El botón se renderiza 2 veces (desktop y móvil) con el mismo id.
    //    Usamos querySelectorAll para asignar el listener a AMBOS.
    const logoutBtns = document.querySelectorAll('#logout-btn');
    if (logoutBtns.length) {
      logoutBtns.forEach(btn => {
        btn.onclick = () => {
          if (typeof opts.onLogout === 'function') {
            opts.onLogout();
          } else {
            // Comportamiento por defecto: confirmar y redirigir
            if (confirm('¿Cerrar sesión?')) {
              window.location.href = 'home.html';
            }
          }
        };
      });
    }

    // Selector de tienda
    const storeSel = document.getElementById('header-app-store-selector');
    if (storeSel && typeof opts.onStoreChange === 'function') {
      storeSel.onchange = () => {
        const newStoreId = storeSel.value;
        const store = (opts.stores || []).find(s => s.storeId === newStoreId);
        if (store) opts.onStoreChange(store);
      };
    }
  }

  /**
   * Guardamos las últimas opciones para poder hacer update() sin perder contexto.
   */
  let _lastOpts = null;

  /**
   * Render principal.
   */
  /**
   * Inyecta el CSS del header una sola vez.
   */
  function injectStyles() {
    if (document.getElementById('smartec-header-app-styles')) return;

    const style = document.createElement('style');
    style.id = 'smartec-header-app-styles';
    style.textContent = `
      /* Header-app container: relative para posicionamiento */
      #smartec-header-app > header > div {
        position: relative;
      }

      /* En móvil, mostrar siempre en 2 filas */
      @media (max-width: 767px) {
        /* Ocultar acciones secundarias en móvil */
        #smartec-header-app .header-app-secondary-actions {
          display: none !important;
        }
        /* El título/rol/selector ocupa toda la fila */
        #smartec-header-app .header-app-title-block {
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function render(opts) {
    opts = opts || {};
    _lastOpts = opts;
    injectStyles();

    const targetId = opts.targetId || 'smartec-header-app';
    const target = document.getElementById(targetId);

    if (!target) {
      console.warn('[HeaderApp] No se encontró el contenedor #' + targetId);
      return;
    }

    target.innerHTML = buildHeaderHtml(opts);
    attachListeners(opts);

    console.log('[HeaderApp] Renderizado');
  }

  /**
   * Actualiza solo el título (y rol) sin re-renderizar todo el header.
   * Útil cuando cambia la tienda seleccionada y queremos cambiar el título.
   */
  function updateTitle(newTitle) {
    const el = document.getElementById('header-app-title');
    if (el) el.innerText = newTitle || '';
  }

  /**
   * Re-render completo con las mismas opciones pero actualizadas.
   * Útil cuando cambia la tienda seleccionada y hay que reconstruir el selector.
   */
  function update(overrides) {
    if (!_lastOpts) return;
    const merged = { ..._lastOpts, ...(overrides || {}) };
    render(merged);
  }

  // Exponer API
  window.SmartecHeaderApp = { render, update, updateTitle };

  console.log('[Smartec] header-app.js cargado');
})();