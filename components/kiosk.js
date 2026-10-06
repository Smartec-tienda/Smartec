/* ============================================================
   SMARTEC · Modo Kiosco
   Bloquea navegación, atajos y salida de la pestaña.
   Solo se activa cuando el usuario tiene kioskMode: true.
   ============================================================ */

window.SmartecKiosk = (() => {

  let isActive = false;
  let onExitCallback = null;

  /**
   * Bloquea eventos del navegador.
   */
  function blockEvents() {
    // 1. Bloquear clic derecho
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    }, true);

    // 2. Bloquear atajos de teclado peligrosos
    document.addEventListener('keydown', (e) => {
      // F12 (DevTools)
      if (e.key === 'F12') { e.preventDefault(); return false; }

      // Ctrl+Shift+I / J / C (DevTools)
      if (e.ctrlKey && e.shiftKey && ['I','J','C','i','j','c'].includes(e.key)) {
        e.preventDefault(); return false;
      }

      // Ctrl+W (cerrar pestaña)
      if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault(); return false;
      }

      // Ctrl+T (nueva pestaña)
      if (e.ctrlKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault(); return false;
      }

      // Ctrl+N (nueva ventana)
      if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault(); return false;
      }

      // Ctrl+R y F5 (recargar) — opcional, descomentar si quieres bloquear
      // if ((e.ctrlKey && (e.key === 'r' || e.key === 'R')) || e.key === 'F5') {
      //   e.preventDefault(); return false;
      // }

      // Alt+Tab (no siempre funciona, pero intentamos)
      if (e.altKey && e.key === 'Tab') {
        e.preventDefault(); return false;
      }
    }, true);

    // 3. Bloquear arrastrar elementos
    document.addEventListener('dragstart', (e) => {
      e.preventDefault();
      return false;
    }, true);

    // 4. Bloquear seleccionar texto (opcional)
    // document.addEventListener('selectstart', (e) => {
    //   e.preventDefault();
    //   return false;
    // }, true);

    // 5. Detectar salida de la pestaña → cerrar sesión
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && isActive) {
        // El usuario cambió de pestaña o minimizó
        if (onExitCallback) {
          onExitCallback();
        } else {
          // Por defecto: cerrar sesión
          if (confirm('⚠️ Saliste de la aplicación.\n\n¿Cerrar sesión?')) {
            window.location.href = 'home.html';
          }
        }
      }
    });

    // 6. Detectar intento de cerrar la ventana
    window.addEventListener('beforeunload', (e) => {
      if (isActive) {
        e.preventDefault();
        e.returnValue = '¿Seguro que quieres salir?';
        return '¿Seguro que quieres salir?';
      }
    });
  }

  /**
   * Activa el modo kiosco.
   * @param {Function} exitCallback - Se llama cuando el usuario sale de la pestaña.
   */
  function enable(exitCallback = null) {
    if (isActive) return;
    isActive = true;
    onExitCallback = exitCallback;
    blockEvents();
    document.body.classList.add('kiosk-mode');
    console.log('🔒 Modo kiosco activado');
  }

  /**
   * Desactiva el modo kiosco.
   */
  function disable() {
    isActive = false;
    onExitCallback = null;
    document.body.classList.remove('kiosk-mode');
    console.log('🔓 Modo kiosco desactivado');
  }

  /**
   * Devuelve si está activo.
   */
  function active() {
    return isActive;
  }

  return { enable, disable, active };

})();