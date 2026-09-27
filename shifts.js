/* ============================================================
   SMARTEC · Sistema de Turnos (marcar entrada/salida)
   - Reutilizable en venta.html y home.html
   - Se inicializa con SmartecShift.init(ctx)
   ============================================================ */

window.SmartecShift = (() => {

  // Contexto compartido (se llena con init())
  let _ctx = null;
  let currentShift = null;         // turno activo del usuario
  let shiftTimerInterval = null;   // intervalo del contador

  /**
   * Inicializa el módulo con el contexto de la página.
   * ctx = {
   *   db, auth, collection, getDocs, query, where,
   *   addDoc, updateDoc, serverTimestamp, doc,
   *   $,           // helper de ID
   *   audit,       // función audit de la página
   *   getCurrentUser,      // () => currentUser
   *   getCurrentUserData,  // () => currentUserData
   *   getCurrentStore,     // () => currentStore
   *   onLogout             // opcional: función para hacer logout real
   * }
   */
  function init(ctx) {
    _ctx = ctx || {};
    console.log('[Shift] Módulo inicializado');
  }

  function _require() {
    if (!_ctx) throw new Error('[Shift] Falta llamar SmartecShift.init(ctx)');
  }

  // Atajos a las variables del contexto
  const _u  = () => _ctx.getCurrentUser ? _ctx.getCurrentUser() : null;
  const _ud = () => _ctx.getCurrentUserData ? _ctx.getCurrentUserData() : null;
  const _st = () => _ctx.getCurrentStore ? _ctx.getCurrentStore() : null;

  /* ============================================================
     UTILIDADES
  ============================================================ */
  function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  }

  /* ============================================================
     CARGAR TURNO ACTIVO DEL USUARIO
  ============================================================ */
  async function loadTodayShift() {
    _require();
    const user = _u();
    const store = _st();
    if (!user || !store) return;

    try {
      const q = _ctx.query(
        _ctx.collection(_ctx.db, 'shifts'),
        _ctx.where('userId', '==', user.uid),
        _ctx.where('storeId', '==', store.storeId),
        _ctx.where('status', '==', 'open')
      );
      const snap = await _ctx.getDocs(q);
      if (snap.empty) {
        currentShift = null;
      } else {
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.startedAt?.seconds || 0) - (a.startedAt?.seconds || 0));
        currentShift = list[0];
      }
      updateShiftButton();
    } catch (e) {
      console.warn('[Shift] Error cargando turno:', e);
    }
  }

  /* ============================================================
     ACTUALIZAR BOTÓN DEL HEADER
  ============================================================ */
  function updateShiftButton() {
    _require();
    const $ = _ctx.$;
    const store = _st();

    const btnDesktop = $('shift-btn');
    const btnMobile = $('shift-btn-mobile');
    const iconD = $('shift-btn-icon');
    const iconM = $('shift-btn-icon-mobile');
    const textD = $('shift-btn-text');
    const timerD = $('shift-timer');

    if (!btnDesktop || !btnMobile) return;

    // Ocultar si la tienda tiene turnos desactivados
    if (store?.shiftEnabled === false) {
      btnDesktop.classList.add('hidden');
      btnMobile.classList.add('hidden');
      stopShiftTimer();
      return;
    }

    btnDesktop.classList.remove('hidden');
    btnMobile.classList.remove('hidden');

    if (currentShift) {
      // Turno abierto → rojo "Marcar salida"
      if (iconD) iconD.innerText = '🔴';
      if (iconM) iconM.innerText = '🔴';
      if (textD) textD.innerText = 'Marcar salida';
      btnDesktop.classList.remove('bg-white/10', 'hover:bg-white/20');
      btnDesktop.classList.add('bg-red-500', 'hover:bg-red-600');
      startShiftTimer();
    } else {
      // Sin turno → verde "Marcar entrada"
      if (iconD) iconD.innerText = '🟢';
      if (iconM) iconM.innerText = '🟢';
      if (textD) textD.innerText = 'Marcar entrada';
      btnDesktop.classList.remove('bg-red-500', 'hover:bg-red-600');
      btnDesktop.classList.add('bg-white/10', 'hover:bg-white/20');
      stopShiftTimer();
      if (timerD) timerD.classList.add('hidden');
    }
  }

  /* ============================================================
     TIMER DEL TURNO
  ============================================================ */
  function startShiftTimer() {
    _require();
    stopShiftTimer();
    const timerD = _ctx.$('shift-timer');
    if (!timerD || !currentShift) return;
    timerD.classList.remove('hidden');

    const tick = () => {
      const startMs = (currentShift.startedAt?.seconds || 0) * 1000;
      if (!startMs) { timerD.innerText = ''; return; }
      timerD.innerText = formatDuration(Date.now() - startMs);
    };
    tick();
    shiftTimerInterval = setInterval(tick, 60000);
  }

  function stopShiftTimer() {
    if (shiftTimerInterval) {
      clearInterval(shiftTimerInterval);
      shiftTimerInterval = null;
    }
  }

  /* ============================================================
     ABRIR MODAL (entrada/salida)
  ============================================================ */
  function toggleShift(options = {}) {
    _require();
    const $ = _ctx.$;
    const user = _u();
    const ud = _ud();
    const store = _st();

    const forced = options?.forced === true;

    if (!store) return;

    const modal = $('shift-modal');
    if (!modal) return;

    // Marcar/desmarcar modo forzado
    modal.dataset.forced = forced ? '1' : '0';

    // Verificar que turnos estén activos
    if (store.shiftEnabled === false) {
      if (forced) {
        console.warn('[Shift] Modal obligatorio solicitado pero la tienda tiene turnos desactivados.');
      } else {
        alert('⛔ El control de turnos no está activado en esta tienda.');
      }
      return;
    }

    const icon = $('shift-modal-icon');
    const title = $('shift-modal-title');
    const subtitle = $('shift-modal-subtitle');
    const body = $('shift-modal-body');
    const escapeBlock = $('shift-modal-escape');
    const closeX = modal.querySelector('button[onclick="SmartecShift.closeShiftModal()"], button[onclick="closeShiftModal()"]');

    if (currentShift) {
      // ==========================================
      // MODAL DE SALIDA (nunca es obligatorio)
      // ==========================================
      if (escapeBlock) escapeBlock.classList.add('hidden');
      if (closeX) closeX.classList.remove('hidden');

      icon.innerText = '🔴';
      icon.className = 'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 text-3xl bg-red-100';
      title.innerText = 'Marcar salida';
      subtitle.innerText = `${store.name} · ${user.email}`;

      const startMs = (currentShift.startedAt?.seconds || 0) * 1000;
      const elapsed = startMs ? formatDuration(Date.now() - startMs) : '—';
      const startTime = startMs
        ? new Date(startMs).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })
        : '—';

      body.innerHTML = `
        <div class="bg-gray-50 rounded-lg p-4 mb-4 text-sm space-y-1">
          <div class="flex justify-between"><span class="text-gray-500">Inicio:</span><b>${startTime}</b></div>
          <div class="flex justify-between"><span class="text-gray-500">Tiempo transcurrido:</span><b>${elapsed}</b></div>
          <div class="flex justify-between"><span class="text-gray-500">Turno abierto:</span><b class="font-mono text-xs">${currentShift.id.slice(-8)}</b></div>
        </div>
        <label class="text-xs font-semibold text-sd block mb-1">Nota (opcional)</label>
        <textarea id="shift-notes" rows="2" class="w-full px-3 py-2 border rounded-lg text-sm mb-4" placeholder="Ej: Cerré caja, salí a almorzar..."></textarea>
        <div class="flex gap-3">
          <button onclick="SmartecShift.closeShiftModal()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
          <button onclick="SmartecShift.confirmCloseShift()" class="flex-1 bg-red-500 text-white py-2.5 rounded-lg hover:bg-red-600 font-semibold">🔴 Marcar salida</button>
        </div>
      `;
    } else {
      // ==========================================
      // MODAL DE ENTRADA
      // ==========================================
      icon.innerText = '🟢';
      icon.className = 'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 text-3xl bg-green-100';
      title.innerText = 'Marcar entrada';
      subtitle.innerText = `${store.name} · ${user.email}`;

      const now = new Date().toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });

      if (forced) {
        // MODO OBLIGATORIO
        if (escapeBlock) escapeBlock.classList.remove('hidden');
        if (closeX) closeX.classList.add('hidden');

        body.innerHTML = `
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-700">
            <p class="font-semibold mb-1">⚠️ Debes marcar entrada para comenzar</p>
            <p>Para garantizar el control de la jornada laboral, necesitas registrar tu hora de entrada. Si no puedes hacerlo, cierra sesión.</p>
          </div>
          <div class="bg-gray-50 rounded-lg p-4 mb-4 text-sm space-y-1">
            <div class="flex justify-between"><span class="text-gray-500">Hora actual:</span><b>${now}</b></div>
            <div class="flex justify-between"><span class="text-gray-500">Rol:</span><b>${ud.role || 'vendedor'}</b></div>
            <div class="flex justify-between"><span class="text-gray-500">Tienda:</span><b>${store.name}</b></div>
          </div>
          <label class="text-xs font-semibold text-sd block mb-1">Nota (opcional)</label>
          <textarea id="shift-notes" rows="2" class="w-full px-3 py-2 border rounded-lg text-sm mb-4" placeholder="Ej: Llegué a apertura..."></textarea>
          <button onclick="SmartecShift.confirmOpenShift()" class="w-full bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 font-semibold">🟢 Marcar entrada</button>
        `;
      } else {
        // MODO NORMAL
        if (escapeBlock) escapeBlock.classList.add('hidden');
        if (closeX) closeX.classList.remove('hidden');

        body.innerHTML = `
          <div class="bg-gray-50 rounded-lg p-4 mb-4 text-sm space-y-1">
            <div class="flex justify-between"><span class="text-gray-500">Hora actual:</span><b>${now}</b></div>
            <div class="flex justify-between"><span class="text-gray-500">Rol:</span><b>${ud.role || 'vendedor'}</b></div>
            <div class="flex justify-between"><span class="text-gray-500">Tienda:</span><b>${store.name}</b></div>
          </div>
          <label class="text-xs font-semibold text-sd block mb-1">Nota (opcional)</label>
          <textarea id="shift-notes" rows="2" class="w-full px-3 py-2 border rounded-lg text-sm mb-4" placeholder="Ej: Llegué a apertura..."></textarea>
          <div class="flex gap-3">
            <button onclick="SmartecShift.closeShiftModal()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
            <button onclick="SmartecShift.confirmOpenShift()" class="flex-1 bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 font-semibold">🟢 Marcar entrada</button>
          </div>
        `;
      }
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  /* ============================================================
     CERRAR MODAL
  ============================================================ */
  function closeShiftModal() {
    _require();
    const modal = _ctx.$('shift-modal');
    if (!modal) return;

    // Bloqueo si es obligatorio
    if (modal.dataset.forced === '1') {
      console.warn('[Shift] Cierre bloqueado: el modal es obligatorio');
      return;
    }

    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.dataset.forced = '0';
  }

  function onShiftOverlayClick() {
    _require();
    const modal = _ctx.$('shift-modal');
    if (!modal) return;
    if (modal.dataset.forced === '1') return;
    closeShiftModal();
  }

  /* ============================================================
     CONFIRMAR ENTRADA
  ============================================================ */
   async function confirmOpenShift() {
    _require();
    const $ = _ctx.$;
    const user = _u();
    const ud = _ud();
    const store = _st();

    const notes = ($('shift-notes')?.value || '').trim();

    if (currentShift) {
      alert('⚠️ Ya tienes un turno abierto. Cierra el anterior primero.');
      return;
    }

    try {
      const data = {
        userId: user.uid,
        userEmail: user.email,
        userName: ud.name || user.email,
        userRole: ud.role || 'vendedor',
        storeId: store.storeId,
        storeName: store.name,
        status: 'open',
        startedAt: _ctx.serverTimestamp(),
        startedNotes: notes || null,
        endedAt: null,
        endedNotes: null,
        durationMinutes: null
      };

      const ref = await _ctx.addDoc(_ctx.collection(_ctx.db, 'shifts'), data);
      currentShift = { id: ref.id, ...data };

      await _ctx.audit({
        action: 'create',
        collection: 'shifts',
        docId: ref.id,
        note: `Turno iniciado: ${store.name} · ${ud.name || user.email}`
      });

      // 🆕 Quitar el modo obligatorio ANTES de cerrar
      // (si no, closeShiftModal bloquea el cierre y el modal queda pegado)
      const modal = $('shift-modal');
      if (modal) {
        modal.dataset.forced = '0';
      }

      closeShiftModal();
      updateShiftButton();
      alert('🟢 Turno iniciado correctamente.');
    } catch (e) {
      console.error('[Shift] Error abriendo turno:', e);
      alert('Error: ' + e.message);
    }
  }

  /* ============================================================
     CONFIRMAR SALIDA
  ============================================================ */
  async function confirmCloseShift() {
    _require();
    const $ = _ctx.$;
    const store = _st();

    if (!currentShift) {
      alert('⚠️ No hay turno abierto.');
      return;
    }

    const notes = ($('shift-notes')?.value || '').trim();

    try {
      const startMs = (currentShift.startedAt?.seconds || 0) * 1000;
      const durationMin = startMs ? Math.round((Date.now() - startMs) / 60000) : 0;

      const updateData = {
        status: 'closed',
        endedAt: _ctx.serverTimestamp(),
        endedNotes: notes || null,
        durationMinutes: durationMin
      };

      await _ctx.updateDoc(_ctx.doc(_ctx.db, 'shifts', currentShift.id), updateData);

      await _ctx.audit({
        action: 'update',
        collection: 'shifts',
        docId: currentShift.id,
        before: { status: 'open' },
        after: { status: 'closed', durationMinutes: durationMin },
        note: `Turno cerrado: ${store?.name || ''} · duración ${formatDuration(durationMin * 60000)}`
      });

      currentShift = null;
      closeShiftModal();
      updateShiftButton();
      alert(`🔴 Turno cerrado. Duración: ${formatDuration(durationMin * 60000)}`);
    } catch (e) {
      console.error('[Shift] Error cerrando turno:', e);
      alert('Error: ' + e.message);
    }
  }

  /* ============================================================
     CERRAR SESIÓN DESDE MODAL OBLIGATORIO
  ============================================================ */
  async function forceLogoutFromShift() {
    _require();
    if (!confirm('¿Cerrar sesión?\n\nNo podrás usar el sistema hasta que vuelvas a ingresar y marques tu entrada.')) {
      return;
    }

    try {
      stopShiftTimer();
      if (window.SmartecKiosk) window.SmartecKiosk.disable();
      await _ctx.audit({
        action: 'logout',
        collection: 'system',
        note: 'Cierre de sesión desde modal obligatorio de entrada'
      });
      if (window.SmartecDeviceGuard?.clearValidatedToday) {
        window.SmartecDeviceGuard.clearValidatedToday();
      }

      // Si la página nos da una función de logout, la usamos
      if (typeof _ctx.onLogout === 'function') {
        await _ctx.onLogout();
      } else {
        // Fallback: cerrar sesión directo
        await _ctx.auth.signOut();
        window.location.href = 'home.html';
      }
    } catch (e) {
      console.error('[Shift] Error cerrando sesión:', e);
      alert('Error: ' + e.message);
    }
  }

  /* ============================================================
     DISPARADOR AUTOMÁTICO
     - Vendedor o admin: abre modal obligatorio si NO tiene turno
     - Superadmin: no aplica
     - Llamar después de loadTodayShift()
  ============================================================ */
  function maybeForceShiftModal() {
    _require();
    const ud = _ud();
    const store = _st();
    if (!ud || !store) return;

    // Superadmin: exento
    if (ud.role === 'superadmin') return;

    // Si la tienda tiene turnos desactivados, no aplicar
    if (store.shiftEnabled === false) return;

    // Si ya tiene turno abierto, no aplicar
    if (currentShift) return;

    console.log('[Shift] Abriendo modal obligatorio para', ud.role);
    toggleShift({ forced: true });
  }

  /* ============================================================
     GETTERS PÚBLICOS
  ============================================================ */
  function getCurrentShift() { return currentShift; }
  function hasOpenShift() { return !!currentShift; }

  /* ============================================================
     API PÚBLICA
  ============================================================ */
  return {
    init,
    // Acciones
    toggleShift,
    closeShiftModal,
    onShiftOverlayClick,
    confirmOpenShift,
    confirmCloseShift,
    forceLogoutFromShift,
    // Carga
    loadTodayShift,
    updateShiftButton,
    maybeForceShiftModal,
    // Utilidades
    formatDuration,
    // Estado
    getCurrentShift,
    hasOpenShift,
  };

})();

console.log('[Smartec] shifts.js cargado');