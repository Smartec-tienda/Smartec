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
    console.log('%c[DeviceGuard] validate() llamado', 'color: blue; font-weight: bold', {
      uid: user?.uid,
      email: user?.email,
      role: userData?.role,
      maxDevices: userData?.maxDevices,
      hasDeviceAutoApprove: userData?.deviceAutoApprove,
      authorizedCount: (userData?.authorizedDevices || []).length
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

      // 6. ¿Auto-autorizar? (solo si deviceAutoApprove = true Y hay cupo)
      const autoApprove = userData.deviceAutoApprove === true;

      if (autoApprove && devices.length < maxDevices) {
        console.log('[DeviceGuard] Hay cupo + autoApprove → auto-registrando');
        const newDevice = {
          fingerprint,
          label: deviceLabel,
          userAgent: navigator.userAgent,
          registeredAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          registeredBy: user.email,
          autoApproved: true
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
            note: `Dispositivo autorizado automáticamente (autoApprove=true): ${deviceLabel}`
          });
        }

        markValidatedToday();
        result.reason = 'auto_registered';
        result.currentCount = devices.length + 1;
        return result;
      }

      // 7. Requiere aprobación (autoApprove=false) o sin cupo → bloqueado
      console.log('[DeviceGuard] Requiere aprobación. autoApprove:', autoApprove, '| Cupo:', devices.length, '/', maxDevices);

      // Determinar motivo del bloqueo
      const blockReason = !autoApprove ? 'autoApprove_disabled' : 'no_capacity';

      // 🆕 Registrar intento en la colección deviceAttempts
      if (ctx.addDoc) {
        try {
          await ctx.addDoc(ctx.collection(ctx.db, 'deviceAttempts'), {
            userId: user.uid,
            userEmail: user.email,
            userName: userData.name || user.email,
            userRole: userData.role,
            storeId: userData.storeId || null,
            deviceLabel: deviceLabel || 'Desconocido',
            fingerprint: fingerprint || 'unknown',
            userAgent: navigator.userAgent,
            blockReason,
            autoApprove,
            currentCount: devices.length,
            maxDevices,
            timestamp: ctx.serverTimestamp ? ctx.serverTimestamp() : new Date()
          });
        } catch(e) {
          console.warn('[DeviceGuard] No se pudo registrar el intento:', e);
        }
      }

      // Auditoría general (para el log histórico)
      if (ctx.audit) {
        await ctx.audit({
          action: 'login',
          collection: 'users',
          docId: user.uid,
          note: `Intento de acceso desde dispositivo NO autorizado: ${deviceLabel} (${blockReason})`,
          after: {
            blockedDevice: {
              fingerprint,
              label: deviceLabel,
              autoApprove,
              currentDevices: devices.length,
              maxDevices,
              blockReason
            }
          }
        });
      }

      result.allowed = false;
      result.reason = 'limit_reached';
      result.currentCount = devices.length;
      result.maxDevices = maxDevices;
      result.deviceLabel = deviceLabel;
      result.fingerprint = fingerprint;
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