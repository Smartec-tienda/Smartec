/* ============================================================
   SMARTEC · footer.js
   Inyecta el footer global en cualquier página.
   Uso: <div id="smartec-footer"></div> + <script src="components/footer.js"></script>
   Y opcionalmente: window.SmartecFooter.render({ settings })
============================================================ */

(function () {
  'use strict';

  const FOOTER_HTML = `
    <footer class="mt-20 pt-16 pb-8 relative">
      <div class="container mx-auto px-4 lg:px-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-10 mb-10">

          <!-- Logo + descripción -->
          <div>
            <div id="footer-logo" class="mb-4">
              <h4 class="text-xl font-extrabold logo-mark tracking-tight">SMARTEC</h4>
            </div>
            <p class="text-sm text-[#6E6E73] leading-relaxed">
              Tu tienda de confianza para electrodomésticos de alta calidad. Tecnología que mejora tu vida.
            </p>
          </div>

          <!-- Categorías -->
          <div>
            <h4 class="font-semibold mb-4 text-sm text-[#1D1D1F]">Categorías</h4>
            <ul id="footer-categories" class="space-y-2 text-sm text-[#6E6E73]"></ul>
          </div>

          <!-- Contacto -->
          <div>
            <h4 class="font-semibold mb-4 text-sm text-[#1D1D1F]">Contacto</h4>
            <ul id="footer-contact" class="space-y-2 text-sm text-[#6E6E73]">
              <li>WhatsApp: —</li>
              <li>Soporte: 24/7</li>
            </ul>
          </div>

          <!-- Accesos + Redes -->
          <div>
            <h4 class="font-semibold mb-4 text-sm text-[#1D1D1F]">Accesos</h4>
            <ul class="space-y-2 text-sm text-[#6E6E73] mb-5">
              <li>
                <a href="/home.html" class="hover:text-[#0071E3] transition inline-flex items-center gap-1.5">
                  🏠 Ir a la plataforma
                </a>
              </li>
              <li>
                <a href="/venta.html" class="hover:text-[#0071E3] transition inline-flex items-center gap-1.5">
                  🛒 Punto de venta
                </a>
              </li>
              <li>
                <a href="/mayoristas.html" class="hover:text-[#BF5AF2] transition inline-flex items-center gap-1.5">
                  🏢 Portal Mayoristas
                </a>
              </li>
            </ul>
            <h4 class="font-semibold mb-4 text-sm text-[#1D1D1F]">Síguenos</h4>
            <div class="flex gap-2">
              <a href="https://www.instagram.com/smartec.co/?hl=es"
                 target="_blank" rel="noopener"
                 aria-label="Instagram"
                 class="w-10 h-10 rounded-full glass-soft hover:bg-gradient-to-br hover:from-[#833AB4] hover:via-[#FD1D1D] hover:to-[#FCB045] hover:text-white transition-all duration-300 flex items-center justify-center shadow-apple group">
                <svg class="w-5 h-5 text-[#1D1D1F] group-hover:text-white transition-colors" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
              </a>
              <a href="https://www.facebook.com/profile.php?id=61594915782562"
                 target="_blank" rel="noopener"
                 aria-label="Facebook"
                 class="w-10 h-10 rounded-full glass-soft hover:bg-[#1877F2] hover:text-white transition-all duration-300 flex items-center justify-center shadow-apple group">
                <svg class="w-5 h-5 text-[#1D1D1F] group-hover:text-white transition-colors" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
              </a>
              <a href="https://www.tiktok.com/@smartec.co?_r=1&_t=ZS-9AMz08dW4Go"
                 target="_blank" rel="noopener"
                 aria-label="TikTok"
                 class="w-10 h-10 rounded-full glass-soft hover:bg-black hover:text-white transition-all duration-300 flex items-center justify-center shadow-apple group">
                <svg class="w-5 h-5 text-[#1D1D1F] group-hover:text-white transition-colors" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
                </svg>
              </a>
            </div>
          </div>

        </div>

        <div class="border-t border-black/5 pt-6 text-center text-xs text-[#6E6E73]">
          <p>© 2026 Smartec. Todos los derechos reservados.</p>
          <div class="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-3">
            <a href="legal/politica-datos.html" class="hover:text-[#0071E3] transition">Política de datos</a>
            <span class="text-gray-300">·</span>
            <a href="legal/terminos.html" class="hover:text-[#0071E3] transition">Términos</a>
            <span class="text-gray-300">·</span>
            <a href="legal/autorizacion.html" class="hover:text-[#0071E3] transition">Autorización</a>
            <span class="text-gray-300">·</span>
            <a href="legal/privacidad.html" class="hover:text-[#0071E3] transition">Privacidad</a>
            <span class="text-gray-300">·</span>
            <a href="legal/cookies.html" class="hover:text-[#0071E3] transition">Cookies</a>
          </div>  
        </div>
      </div>
    </footer>
  `;

  /**
   * Inyecta el footer en el contenedor indicado.
   * @param {Object} opts
   * @param {string} opts.targetId  - ID del div donde inyectar (default: 'smartec-footer')
   * @param {Object} opts.settings  - settings de Firestore (para logo y categorías)
   * @param {Function} opts.onReady - callback opcional cuando ya está inyectado
   */
  async function render(opts) {
    opts = opts || {};
    const targetId = opts.targetId || 'smartec-footer';
    let settings = opts.settings || {};
    const target = document.getElementById(targetId);

    if (!target) {
      console.warn('[Footer] No se encontró el contenedor #' + targetId);
      return;
    }

    // Si no nos pasaron settings, buscarlos en Firestore (settings/general)
    if (!settings || !Object.keys(settings).length) {
      try {
        if (window.__FIREBASE_CONFIG && window.SmartecCache) {
          // Reutilizamos la cache del proyecto
          const allSettings = await window.SmartecCache.wrap('footer_settings_general', async () => {
            // Import dinámico de Firestore (solo si está disponible)
            const mod = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js");
            const appMod = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js");

            // Reusar la app ya inicializada si existe
            let app;
            try { app = appMod.getApp(); } catch (e) { app = appMod.initializeApp(window.__FIREBASE_CONFIG); }
            const db = mod.getFirestore(app);
            const snap = await mod.getDoc(mod.doc(db, 'settings', 'general'));
            return snap.exists() ? snap.data() : {};
          });
          settings = allSettings || {};
        }
      } catch (e) {
        console.warn('[Footer] No se pudieron cargar settings desde Firestore:', e);
      }
    }

    // Inyectar HTML
    target.innerHTML = FOOTER_HTML;

    // Aplicar logo si existe
    const logoUrl = settings.footerLogoUrl || settings.logoUrl || null;
    if (logoUrl) {
      const logoBox = document.getElementById('footer-logo');
      if (logoBox) {
        logoBox.innerHTML = `
          <img src="${logoUrl}" alt="Smartec"
               class="h-10 md:h-20 object-contain" decoding="async">
        `;

        // Ocultar slogan si el logo ya lo incluye
        const slogan = logoBox.parentElement.querySelector('p');
        if (slogan && slogan.textContent.includes('Tecnología')) {
          slogan.style.display = 'none';
        }
      }
    }

    // Renderizar categorías si existen
    if (settings.categories) {
      renderCategories(settings.categories);
    }

    // 🆕 Renderizar datos de contacto (WhatsApp, email, etc.)
    renderContact(settings);

    if (typeof opts.onReady === 'function') opts.onReady();
  }

  /**
   * Renderiza las categorías visibles en el footer.
   */
  function renderCategories(categories) {
    const el = document.getElementById('footer-categories');
    if (!el) return;

    const groups = Object.entries(categories)
      .filter(([slug, g]) => isCategoryVisible(slug, g))
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

    el.innerHTML = groups.map(([slug, g]) => `
      <li>
        <a href="index.html#catalogo"
           onclick="if(window.selectGroup){window.selectGroup('${slug}');return false;}"
           class="hover:text-[#0071E3] transition cursor-pointer">
          ${escapeHtml(g.name)}
        </a>
      </li>
    `).join('');
  }

    /**
   * 🆕 Renderiza los datos de contacto desde settings.
   * Usa settings.whatsapp, settings.companyPhone, settings.companyEmail.
   */
  function renderContact(settings) {
    const el = document.getElementById('footer-contact');
    if (!el) return;

    const lines = [];

    // WhatsApp (prioridad 1) o companyPhone (fallback)
    const rawWhats = String(settings.whatsapp || '').replace(/\D/g, '');
    const rawPhone  = String(settings.companyPhone || '').replace(/\D/g, '');
    const phoneToShow = settings.whatsapp || settings.companyPhone || '';

    if (phoneToShow) {
      // Si tiene 10 dígitos, es celular CO → agregamos +57 para mostrar
      let display = String(phoneToShow).trim();
      if (rawWhats.length === 10) display = '+57 ' + rawWhats.slice(0, 3) + ' ' + rawWhats.slice(3, 6) + ' ' + rawWhats.slice(6);
      else if (rawPhone.length === 10) display = '+57 ' + rawPhone.slice(0, 3) + ' ' + rawPhone.slice(3, 6) + ' ' + rawPhone.slice(6);

      // Link de WhatsApp: si tiene 10 dígitos, agregamos 57 adelante
      const linkDigits = rawWhats || rawPhone;
      const waLink = linkDigits.length === 10 ? '57' + linkDigits : linkDigits;

      lines.push(`
        <li>
          <a href="https://wa.me/${escapeHtml(waLink)}" target="_blank" rel="noopener"
             class="hover:text-[#0071E3] transition">
            WhatsApp: ${escapeHtml(display)}
          </a>
        </li>
      `);
    }

    // Teléfono corporativo (si es distinto del WhatsApp)
    if (settings.companyPhone && settings.companyPhone !== settings.whatsapp) {
      lines.push(`<li>Tel: ${escapeHtml(settings.companyPhone)}</li>`);
    }

    // Email
    if (settings.companyEmail) {
      lines.push(`
        <li>
          <a href="mailto:${escapeHtml(settings.companyEmail)}"
             class="hover:text-[#0071E3] transition">
            ${escapeHtml(settings.companyEmail)}
          </a>
        </li>
      `);
    }

    // Dirección
    if (settings.companyAddress) {
      lines.push(`<li>📍 ${escapeHtml(settings.companyAddress)}</li>`);
    }

    // Soporte (siempre)
    lines.push('<li>Soporte: 24/7</li>');

    el.innerHTML = lines.join('');
  }


  /**
   * ¿La categoría es visible?
   * Nueva regla: visible por defecto, solo se oculta si seasonalActive === false.
   */
  function isCategoryVisible(slug, group) {
    return group.seasonalActive !== false;
  }

  /**
   * Escape básico por si no existe window.Smartec.escapeHtml.
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

  // Exponer API global
  window.SmartecFooter = { render };

  console.log('[Smartec] footer.js cargado');
})();