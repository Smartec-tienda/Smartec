/* ============================================================
   SMARTEC · Device Fingerprint
   Genera un hash único para cada dispositivo/navegador.
   ============================================================ */

window.SmartecFingerprint = (() => {

  /**
   * Genera un hash SHA-256 simple a partir de un string.
   */
  async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Recolecta las características del dispositivo.
   * No usa cookies ni localStorage (para evitar bloqueos).
   */
  function collectSignals() {
    const nav = window.navigator;
    const scr = window.screen;

    const signals = {
      userAgent: nav.userAgent || '',
      language: nav.language || '',
      languages: (nav.languages || []).join(','),
      platform: nav.platform || '',
      hardwareConcurrency: nav.hardwareConcurrency || 0,
      deviceMemory: nav.deviceMemory || 0,
      maxTouchPoints: nav.maxTouchPoints || 0,
      screenWidth: scr.width || 0,
      screenHeight: scr.height || 0,
      colorDepth: scr.colorDepth || 0,
      pixelRatio: window.devicePixelRatio || 1,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      timezoneOffset: new Date().getTimezoneOffset(),
      cookieEnabled: nav.cookieEnabled ? 1 : 0,
      doNotTrack: nav.doNotTrack || '0',
      plugins: Array.from(nav.plugins || []).map(p => p.name).join(','),
      // canvas fingerprint (rápido y estable)
      canvas: (() => {
        try {
          const c = document.createElement('canvas');
          c.width = 200; c.height = 50;
          const ctx = c.getContext('2d');
          ctx.textBaseline = 'top';
          ctx.font = '14px Arial';
          ctx.fillStyle = '#f60';
          ctx.fillRect(125, 1, 62, 20);
          ctx.fillStyle = '#069';
          ctx.fillText('Smartec-FP', 2, 15);
          ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
          ctx.fillText('Smartec-FP', 4, 17);
          return c.toDataURL().slice(-50);
        } catch (e) { return 'canvas-error'; }
      })(),
      // webgl fingerprint
      webgl: (() => {
        try {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
          if (!gl) return 'no-webgl';
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          if (dbg) {
            return gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) + '|' + gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
          }
          return gl.getParameter(gl.VENDOR) + '|' + gl.getParameter(gl.RENDERER);
        } catch (e) { return 'webgl-error'; }
      })()
    };

    return signals;
  }

  /**
   * Genera el fingerprint final.
   * @returns {Promise<string>} hash de 64 caracteres
   */
  async function generate() {
    const signals = collectSignals();
    const raw = JSON.stringify(signals);
    const hash = await sha256(raw);
    return hash;
  }

  /**
   * Devuelve un ID corto legible del fingerprint (primeros 12 chars).
   */
  function shortId(fingerprint) {
    return fingerprint ? fingerprint.slice(0, 12) : 'unknown';
  }

  /**
   * Devuelve un label amigable para mostrar en admin.
   * Ej: "Chrome en Windows · 1920x1080"
   */
  function deviceLabel() {
    const ua = navigator.userAgent || '';
    let browser = 'Navegador';
    if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
    else if (ua.includes('Edg')) browser = 'Edge';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';

    let os = 'SO';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';

    const scr = window.screen;
    return `${browser} en ${os} · ${scr.width}x${scr.height}`;
  }

  return { generate, shortId, deviceLabel };

})();