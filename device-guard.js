/* ============================================================
   SMARTEC · Device Guard
   Valida el dispositivo del usuario al iniciar sesión.
   - Una vez al día (reset a las 00:00 hora local)
   - Solo para roles admin y vendedor (superadmin exento)
   - Configurable por usuario (maxDevices > 0)
   ============================================================ */

window.SmartecDeviceGuard = (() => {

  const STORAGE_KEY = 'smartec_device_ok';

  /* ============================================================
     HELPERS
  ============================================================ */
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  /**
   * Marca el dispositivo como validado HOY.
   */
  function markValidatedToday() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        date: todayStr(),
        ts: Date.now()
      }));
    } catch(e) { console.warn('[DeviceGuard] No se pudo guardar validación:', e); }
  }

  /**
   * ¿Ya se validó HOY?
   */
  function isValidatedToday() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return data.date === todayStr();
    } catch(e) {
      return false;
    }
  }

  /**
   * Fuerza revalidación (borra el flag).
   */
  function clearValidatedToday() {
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  }

  /* ============================================================
     VALIDACIÓN PRINCIPAL
     Devuelve:
     {
       allowed: bool,
       reason: 'ok' | 'no_limit' | 'already_authorized' | 'auto_registered'
             | 'limit_reached' | 'superadmin' | 'error',
       deviceLabel, fingerprint, currentCount, maxDevices,
       userData, user
     }
  ============================================================ */
  async function validate(user, userData, ctx) {
    // ctx = { db, updateDoc, doc, serverTimestamp, audit }
    const result = {
      allowed: true,
      reason: 'ok',
      deviceLabel: '',
      fingerprint: '',
      currentCount: 0,
      maxDevices: 0
    };

    try {
      // 1. Superadmin → exento
      if (userData.role === 'superadmin') {
        result.reason = 'superadmin';
        return result;
      }

      // 2. ¿Ya validó hoy?
      if (isValidatedToday()) {
        result.reason = 'already_authorized';
        return result;
      }

      // 3. ¿Sin límite configurado? (maxDevices <= 0)
      const maxDevices = Number(userData.maxDevices || 0);
      if (maxDevices <= 0) {
        result.reason = 'no_limit';
        markValidatedToday();
        return result;
      }

      result.maxDevices = maxDevices;

      // 4. Generar fingerprint
      let fingerprint = '';
      let deviceLabel = '';
      try {
        fingerprint = await window.SmartecFingerprint.generate();
        deviceLabel = window.SmartecFingerprint.deviceLabel();
        result.fingerprint = fingerprint;
        result.deviceLabel = deviceLabel;
      } catch (fpErr) {
        // Fingerprint falló técnicamente → permitir PIN
        console.warn('[DeviceGuard] Fingerprint falló:', fpErr);
        return {
          ...result,
          allowed: false,
          reason: 'fingerprint_failed'
        };
      }

      // 5. ¿Ya está autorizado?
      const devices = userData.authorizedDevices || [];
      result.currentCount = devices.length;

      const existing = devices.find(d => d.fingerprint === fingerprint);
      if (existing) {
        // Actualizar lastSeen
        try {
          const updatedDevices = devices.map(d =>
            d.fingerprint === fingerprint
              ? { ...d, lastSeen: new Date().toISOString() }
              : d
          );
          await ctx.updateDoc(ctx.doc(ctx.db, 'users', user.uid), {
            authorizedDevices: updatedDevices
          });
        } catch(e) { console.warn('No se pudo actualizar lastSeen:', e); }

        markValidatedToday();
        result.reason = 'already_authorized';
        return result;
      }

      // 6. ¿Hay cupo? → Auto-registrar
      if (devices.length < maxDevices) {
        const newDevice = {
          fingerprint,
          label: deviceLabel,
          userAgent: navigator.userAgent,
          registeredAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          registeredBy: user.email
        };

        await ctx.updateDoc(ctx.doc(ctx.db, 'users', user.uid), {
          authorizedDevices: [...devices, newDevice]
        });

        if (ctx.audit) {
          await ctx.audit({
            action: 'create',
            collection: 'users',
            docId: user.uid,
            after: { device: newDevice },
            note: `Dispositivo autorizado automáticamente: ${deviceLabel}`
          });
        }

        markValidatedToday();
        result.reason = 'auto_registered';
        result.currentCount = devices.length + 1;
        return result;
      }

      // 7. Sin cupo → bloqueado
      result.allowed = false;
      result.reason = 'limit_reached';
      return result;

    } catch (e) {
      console.error('[DeviceGuard] Error:', e);
      return {
        ...result,
        allowed: false,
        reason: 'error',
        error: e.message
      };
    }
  }

  /* ============================================================
     VALIDACIÓN DE PIN
     Usada cuando el fingerprint falló técnicamente.
     El usuario introduce su PIN + un motivo obligatorio.
  ============================================================ */
  async function validatePin(user, userData, pin, reason, ctx) {
    try {
      // 1. Comparar PIN
      if (!userData.pin) {
        return { ok: false, message: 'Este usuario no tiene PIN configurado. Contacta al superadmin.' };
      }
      if (String(userData.pin) !== String(pin)) {
        return { ok: false, message: 'PIN incorrecto.' };
      }
      if (!reason || !reason.trim()) {
        return { ok: false, message: 'Debes indicar el motivo.' };
      }

      // 2. Registrar en auditoría
      if (ctx.audit) {
        await ctx.audit({
          action: 'login',
          collection: 'users',
          docId: user.uid,
          note: `Acceso con PIN (huella falló): ${reason.trim()}`,
          after: {
            method: 'pin',
            reason: reason.trim(),
            userAgent: navigator.userAgent
          }
        });
      }

      // 3. Marcar como validado hoy
      markValidatedToday();

      return { ok: true };
    } catch (e) {
      console.error('[DeviceGuard] Error validando PIN:', e);
      return { ok: false, message: 'Error al validar PIN: ' + e.message };
    }
  }

  /* ============================================================
     GUARD PARA OTRAS PÁGINAS
     Redirige a home.html si:
     - No hay sesión
     - No se validó hoy
     - El rol no es válido
     - El perfil no existe

     Excepción: superadmin siempre pasa.

     Uso: se llama desde onAuthStateChanged de cada página.
  ============================================================ */
  function shouldRedirectToHome(userData) {
    if (!userData) return true;
    if (userData.role === 'superadmin') return false;
    if (isValidatedToday()) return false;
    return true;
  }

  return {
    validate,
    validatePin,
    markValidatedToday,
    isValidatedToday,
    clearValidatedToday,
    shouldRedirectToHome,
    todayStr
  };

})();

console.log('[Smartec] device-guard.js cargado');