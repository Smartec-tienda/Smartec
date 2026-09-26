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

  function markValidatedToday() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        date: todayStr(),
        ts: Date.now()
      }));
    } catch(e) { console.warn('[DeviceGuard] No se pudo guardar validación:', e); }
  }

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

  function clearValidatedToday() {
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  }

  /* ============================================================
     VALIDACIÓN PRINCIPAL
  ============================================================ */
  async function validate(user, userData, ctx) {
    console.log('[DeviceGuard] validate() llamado', {
      uid: user?.uid,
      role: userData?.role,
      maxDevices: userData?.maxDevices
    });

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
        console.log('[DeviceGuard] Superadmin exento');
        result.reason = 'superadmin';
        return result;
      }

      // 2. ¿Ya validó hoy?
      if (isValidatedToday()) {
        console.log('[DeviceGuard] Ya validado hoy');
        result.reason = 'already_authorized';
        return result;
      }

      // 3. ¿Sin límite configurado?
      const maxDevices = Number(userData.maxDevices || 0);
      if (maxDevices <= 0) {
        console.log('[DeviceGuard] Sin límite (maxDevices <= 0)');
        result.reason = 'no_limit';
        markValidatedToday();
        return result;
      }

      result.maxDevices = maxDevices;

      // 4. Generar fingerprint
      console.log('[DeviceGuard] Generando fingerprint...');
      let fingerprint = '';
      let deviceLabel = '';
      try {
        fingerprint = await window.SmartecFingerprint.generate();
        deviceLabel = window.SmartecFingerprint.deviceLabel();
        console.log('[DeviceGuard] Fingerprint generado:', fingerprint.slice(0, 16));
        result.fingerprint = fingerprint;
        result.deviceLabel = deviceLabel;
      } catch (fpErr) {
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
      console.log('[DeviceGuard] Dispositivos autorizados:', devices.length, '/', maxDevices);

      const existing = devices.find(d => d.fingerprint === fingerprint);
      if (existing) {
        console.log('[DeviceGuard] Dispositivo ya autorizado, actualizando lastSeen');
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
        console.log('[DeviceGuard] Hay cupo, auto-registrando dispositivo');
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
      console.log('[DeviceGuard] Sin cupo → bloqueado');
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
  ============================================================ */
  async function validatePin(user, userData, pin, reason, ctx) {
    try {
      if (!userData.pin) {
        return { ok: false, message: 'Este usuario no tiene PIN configurado. Contacta al superadmin.' };
      }
      if (String(userData.pin) !== String(pin)) {
        return { ok: false, message: 'PIN incorrecto.' };
      }
      if (!reason || !reason.trim()) {
        return { ok: false, message: 'Debes indicar el motivo.' };
      }

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

      markValidatedToday();
      return { ok: true };
    } catch (e) {
      console.error('[DeviceGuard] Error validando PIN:', e);
      return { ok: false, message: 'Error al validar PIN: ' + e.message };
    }
  }

  /* ============================================================
     GUARD PARA OTRAS PÁGINAS
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