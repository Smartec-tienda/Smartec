/* ============================================================
   SMARTEC — Módulo de cache para Firestore
   Reduce el consumo de lecturas usando sessionStorage
============================================================ */

window.SmartecCache = (() => {

  // Configuración por defecto: 5 minutos
  const DEFAULT_TTL = 5 * 60 * 1000;

  // Prefijo para las claves en sessionStorage
  const PREFIX = 'smartec_cache_';

  /* ---------- API PÚBLICA ---------- */

  return {
    /**
     * Devuelve el valor cacheado si existe y no ha expirado.
     * @param {string} key
     * @returns {any|null}
     */
    get(key) {
      try {
        const raw = sessionStorage.getItem(PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() > parsed.expiresAt) {
          sessionStorage.removeItem(PREFIX + key);
          return null;
        }
        return parsed.value;
      } catch (e) {
        console.warn('[Cache] Error leyendo', key, e);
        return null;
      }
    },

    /**
     * Guarda un valor en el cache.
     * @param {string} key
     * @param {any} value
     * @param {number} [ttl] - milisegundos (opcional)
     */
    set(key, value, ttl = DEFAULT_TTL) {
      try {
        const payload = {
          value,
          expiresAt: Date.now() + ttl,
          savedAt: Date.now()
        };
        sessionStorage.setItem(PREFIX + key, JSON.stringify(payload));
      } catch (e) {
        console.warn('[Cache] Error guardando', key, e);
      }
    },

    /**
     * Invalida una clave específica.
     * @param {string} key
     */
    invalidate(key) {
      sessionStorage.removeItem(PREFIX + key);
    },

    /**
     * Invalida todas las claves que empiecen con un prefijo.
     * Ej: invalidatePrefix('inventory') borra 'inventory_alameda', 'inventory_mallorquin', etc.
     * @param {string} prefix
     */
    invalidatePrefix(prefix) {
      const keysToRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(PREFIX + prefix)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => sessionStorage.removeItem(k));
    },

    /**
     * Limpia TODO el cache de Smartec.
     */
    clear() {
      const keysToRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => sessionStorage.removeItem(k));
      console.log('[Cache] Limpiado');
    },

    /**
     * Envuelve una función async: si el cache tiene el valor, lo devuelve;
     * si no, ejecuta el fetcher y guarda el resultado.
     * @param {string} key
     * @param {Function} fetcher - función async que devuelve el valor
     * @param {number} [ttl]
     */
    async wrap(key, fetcher, ttl = DEFAULT_TTL) {
      const cached = this.get(key);
      if (cached !== null) {
        return cached;
      }
      const value = await fetcher();
      this.set(key, value, ttl);
      return value;
    },

    /**
     * Fuerza la recarga ignorando el cache.
     * @param {string} key
     * @param {Function} fetcher
     * @param {number} [ttl]
     */
    async refresh(key, fetcher, ttl = DEFAULT_TTL) {
      this.invalidate(key);
      return this.wrap(key, fetcher, ttl);
    }
  };

})();