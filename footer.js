/* ============================================================
   SMARTEC · footer.js
   Inyecta el footer global en cualquier página.
   Uso: <div id="smartec-footer"></div> + <script src="footer.js"></script>
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

          <!-- Redes -->
          <div>
            <h4 class="font-semibold mb-4 text-sm text-[#1D1D1F]">Síguenos</h4>
            <div class="flex gap-2">
              <a href="#" class="w-10 h-10 rounded-full glass-soft hover:bg-white transition-all flex items-center justify-center shadow-apple">📷</a>
              <a href="#" class="w-10 h-10 rounded-full glass-soft hover:bg-white transition-all flex items-center justify-center shadow-apple">📘</a>
              <a href="#" class="w-10 h-10 rounded-full glass-soft hover:bg-white transition-all flex items-center justify-center shadow-apple">💬</a>
            </div>
          </div>

        </div>

        <div class="border-t border-black/5 pt-6 text-center text-xs text-[#6E6E73]">
          <p>© 2026 Smartec. Todos los derechos reservados.</p>
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
  function render(opts) {
    opts = opts || {};
    const targetId = opts.targetId || 'smartec-footer';
    const settings = opts.settings || {};
    const target = document.getElementById(targetId);

    if (!target) {
      console.warn('[Footer] No se encontró el contenedor #' + targetId);
      return;
    }

    // Inyectar HTML
    target.innerHTML = FOOTER_HTML;

    // Aplicar logo si existe
    if (settings.footerLogoUrl) {
      const logoBox = document.getElementById('footer-logo');
      if (logoBox) {
        logoBox.innerHTML = `
          <img src="${settings.footerLogoUrl}" alt="Smartec"
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