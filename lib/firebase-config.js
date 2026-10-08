/* ============================================================
   SMARTEC · firebase-config.js
   Configuración centralizada de Firebase.

   Detecta automáticamente qué proyecto de Firebase usar según
   el dominio donde corre la app. Esto permite tener un solo
   código desplegado para múltiples clientes.

   Uso:
     <script src="lib/firebase-config.js"></script>
     <script>
       const config = window.__FIREBASE_CONFIG;
     </script>

   Para agregar un cliente nuevo:
   1. Crea su proyecto en Firebase Console.
   2. Copia las credenciales de "Configuración del proyecto".
   3. Agrega una entrada nueva en CONFIGS con su dominio.
   4. Deploy normal. Listo.
============================================================ */

(function () {
  'use strict';

  // ============================================================
  // CONFIGS POR DOMINIO
  // Cada entrada: 'dominio.com' → { credenciales de Firebase }
  // ============================================================
  const CONFIGS = {

    // ===== PRODUCCIÓN · Cliente principal (Smartec) =====
    'smartec.com': {
      apiKey: "AIzaSyCJ-bKabzQL5DIq2n1qlHKHadlEY17TT_I",
      authDomain: "smartec-8fc19.firebaseapp.com",
      projectId: "smartec-8fc19",
      storageBucket: "smartec-8fc19.firebasestorage.app",
      messagingSenderId: "879944967068",
      appId: "1:879944967068:web:287b3f2baf2c56f8b95e59",
      measurementId: "G-127MH9ZCN1",
      recaptchaEnterpriseKey: "6Lf5ls8tAAAAAFg4fPnRJg4xNgdVgo2Enl9FgZIP",
      functionsRegion: "us-central1"
    },

    // ===== PRODUCCIÓN · Firebase Hosting por defecto =====
    // (Firebase Hosting sirve en *.web.app y *.firebaseapp.com)
    'smartec-8fc19.web.app': {
      apiKey: "AIzaSyCJ-bKabzQL5DIq2n1qlHKHadlEY17TT_I",
      authDomain: "smartec-8fc19.firebaseapp.com",
      projectId: "smartec-8fc19",
      storageBucket: "smartec-8fc19.firebasestorage.app",
      messagingSenderId: "879944967068",
      appId: "1:879944967068:web:287b3f2baf2c56f8b95e59",
      measurementId: "G-127MH9ZCN1",
      recaptchaEnterpriseKey: "6Lf5ls8tAAAAAFg4fPnRJg4xNgdVgo2Enl9FgZIP",
      functionsRegion: "us-central1"
    },

    'smartec-8fc19.firebaseapp.com': {
      apiKey: "AIzaSyCJ-bKabzQL5DIq2n1qlHKHadlEY17TT_I",
      authDomain: "smartec-8fc19.firebaseapp.com",
      projectId: "smartec-8fc19",
      storageBucket: "smartec-8fc19.firebasestorage.app",
      messagingSenderId: "879944967068",
      appId: "1:879944967068:web:287b3f2baf2c56f8b95e59",
      measurementId: "G-127MH9ZCN1",
      recaptchaEnterpriseKey: "6Lf5ls8tAAAAAFg4fPnRJg4xNgdVgo2Enl9FgZIP",
      functionsRegion: "us-central1"
    },

    // ===== DESARROLLO LOCAL =====
    'localhost': {
      apiKey: "AIzaSyCJ-bKabzQL5DIq2n1qlHKHadlEY17TT_I",
      authDomain: "smartec-8fc19.firebaseapp.com",
      projectId: "smartec-8fc19",
      storageBucket: "smartec-8fc19.firebasestorage.app",
      messagingSenderId: "879944967068",
      appId: "1:879944967068:web:287b3f2baf2c56f8b95e59",
      measurementId: "G-127MH9ZCN1",
      recaptchaEnterpriseKey: "6Lf5ls8tAAAAAFg4fPnRJg4xNgdVgo2Enl9FgZIP",
      functionsRegion: "us-central1"
    },

    '127.0.0.1': {
      apiKey: "AIzaSyCJ-bKabzQL5DIq2n1qlHKHadlEY17TT_I",
      authDomain: "smartec-8fc19.firebaseapp.com",
      projectId: "smartec-8fc19",
      storageBucket: "smartec-8fc19.firebasestorage.app",
      messagingSenderId: "879944967068",
      appId: "1:879944967068:web:287b3f2baf2c56f8b95e59",
      measurementId: "G-127MH9ZCN1",
      recaptchaEnterpriseKey: "6Lf5ls8tAAAAAFg4fPnRJg4xNgdVgo2Enl9FgZIP",
      functionsRegion: "us-central1"
    },
    // ===== PRODUCCIÓN · GitHub Pages (Smartec) =====
    'smartec-tienda.github.io': {
      apiKey: "AIzaSyCJ-bKabzQL5DIq2n1qlHKHadlEY17TT_I",
      authDomain: "smartec-8fc19.firebaseapp.com",
      projectId: "smartec-8fc19",
      storageBucket: "smartec-8fc19.firebasestorage.app",
      messagingSenderId: "879944967068",
      appId: "1:879944967068:web:287b3f2baf2c56f8b95e59",
      measurementId: "G-127MH9ZCN1",
      recaptchaEnterpriseKey: "6Lf5ls8tAAAAAFg4fPnRJg4xNgdVgo2Enl9FgZIP",
      functionsRegion: "us-central1"
    },

    // ===== 🆕 CLIENTES FUTUROS =====
    // Copia este ejemplo y adapta los datos cuando vendas el software:
    //
    // 'tienda-pepito.com': {
    //   apiKey: "...",
    //   authDomain: "tienda-pepito.firebaseapp.com",
    //   projectId: "tienda-pepito",
    //   storageBucket: "tienda-pepito.firebasestorage.app",
    //   messagingSenderId: "...",
    //   appId: "...",
    //   measurementId: "...",
    //   recaptchaEnterpriseKey: "...",
    //   functionsRegion: "us-central1"
    // },

  };

  // ============================================================
  // DETECCIÓN AUTOMÁTICA DEL DOMINIO
  // ============================================================
  function detectConfig() {
    const hostname = window.location.hostname.replace(/^www\./, '');
    const fullHost = window.location.hostname; // con www si existe

    // 1. Match exacto del hostname sin www
    if (CONFIGS[hostname]) return { config: CONFIGS[hostname], matched: hostname };

    // 2. Match exacto del hostname completo (con www)
    if (CONFIGS[fullHost]) return { config: CONFIGS[fullHost], matched: fullHost };

    // 3. Match por subdominio: si es "admin.cliente1.com" y hay "cliente1.com"
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join('.');
      if (CONFIGS[candidate]) return { config: CONFIGS[candidate], matched: candidate };
    }

    // 4. Fallback: localhost (para no dejar la app rota si el dominio no está registrado)
    if (CONFIGS['localhost']) {
      console.warn(
        `[Config] Dominio "${fullHost}" no está registrado en firebase-config.js. ` +
        `Usando config de desarrollo (localhost).`
      );
      return { config: CONFIGS['localhost'], matched: 'localhost (fallback)' };
    }

    // 5. Sin fallback → error claro
    throw new Error(
      `[Config] No hay configuración de Firebase para el dominio "${fullHost}". ` +
      `Agrégalo en firebase-config.js → CONFIGS.`
    );
  }

  // ============================================================
  // INICIALIZACIÓN
  // ============================================================
  try {
    const { config, matched } = detectConfig();

    // Congelar el objeto para prevenir modificaciones accidentales
    window.__FIREBASE_CONFIG = Object.freeze({ ...config });

    console.log(`[Config] Firebase project: ${config.projectId} (dominio: ${matched})`);
  } catch (e) {
    console.error(e.message);
    window.__FIREBASE_CONFIG = null;
  }

})();