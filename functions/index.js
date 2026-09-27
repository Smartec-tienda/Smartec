const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * createUserAdmin
 * Crea un usuario en Firebase Auth + guarda su perfil en Firestore.
 * Solo puede ser invocado por un superadmin autenticado.
 */
exports.createUserAdmin = onCall({ cors: true, region: 'us-central1' }, async (request) => {
  const { auth, data } = request;

  // 1. Verificar que hay usuario autenticado
  if (!auth) {
    throw new HttpsError(
      "unauthenticated",
      "Debes iniciar sesión para usar esta función."
    );
  }

  // 2. Verificar que quien llama es superadmin
  const callerUid = auth.uid;
  const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
  if (!callerDoc.exists) {
    throw new HttpsError(
      "permission-denied",
      "Tu perfil de usuario no existe."
    );
  }
  const callerData = callerDoc.data();
  if (callerData.role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo el superadmin puede crear usuarios."
    );
  }

  // 3. Validar datos de entrada
  const email = (data.email || "").trim().toLowerCase();
  const password = data.password || "";
  const name = (data.name || "").trim();

  if (!email) {
    throw new HttpsError("invalid-argument", "El email es obligatorio.");
  }
  if (!password || password.length < 6) {
    throw new HttpsError(
      "invalid-argument",
      "La contraseña debe tener al menos 6 caracteres."
    );
  }
  if (!name) {
    throw new HttpsError("invalid-argument", "El nombre es obligatorio.");
  }

  try {
    // 4. Crear usuario en Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
      emailVerified: false,
      disabled: false
    });

    // 5. Crear perfil en Firestore
    const userProfile = {
      name,
      email,
      role: data.role || "vendedor",
      storeId: data.storeId || null,
      commissionRate: Number(data.commissionRate) || 0,
      goalAmount: Number(data.goalAmount) || 0,
      bonusRate: Number(data.bonusRate) || 0,
      maxDevices: Number(data.maxDevices) || 1,
      pin: data.pin || null,
      kioskMode: !!data.kioskMode,
      active: data.active !== false,
      authorizedDevices: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: auth.token.email || null
    };

    await admin.firestore().collection("users").doc(userRecord.uid).set(userProfile);

    // 6. Registrar en auditoría
    await admin.firestore().collection("auditLog").add({
      action: "create",
      collection: "users",
      docId: userRecord.uid,
      userId: callerUid,
      userEmail: auth.token.email || null,
      userRole: callerData.role,
      storeId: userProfile.storeId,
      after: userProfile,
      note: `Usuario creado: ${name} (${userProfile.role})`,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // 7. Devolver el UID al admin
    return {
      success: true,
      uid: userRecord.uid,
      email: userRecord.email
    };
  } catch (error) {
    console.error("Error creando usuario:", error);

    if (error.code === "auth/email-already-exists") {
      throw new HttpsError(
        "already-exists",
        "Ya existe un usuario con ese email."
      );
    }
    if (error.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Email inválido.");
    }
    if (error.code === "auth/weak-password") {
      throw new HttpsError("invalid-argument", "Contraseña muy débil.");
    }

    throw new HttpsError(
      "internal",
      "Error al crear el usuario: " + error.message
    );
  }
});

/* ============================================================
   verifyWebAuthnAssertion
   Verifica criptográficamente una firma WebAuthn contra la
   clave pública guardada en Firestore.
============================================================ */
const { verifyAuthenticationResponse } = require('@simplewebauthn/server');

exports.verifyWebAuthnAssertion = onCall(
  { cors: true, region: 'us-central1' },
  async (request) => {
    const { auth, data } = request;

    // 1. Verificar autenticación
    if (!auth) {
      throw new HttpsError(
        'unauthenticated',
        'Debes iniciar sesión para verificar la huella.'
      );
    }

    // 2. Validar datos de entrada
    const {
      credentialId,
      authenticatorData,
      clientDataJSON,
      signature
    } = data || {};

    if (!credentialId || !authenticatorData || !clientDataJSON || !signature) {
      throw new HttpsError(
        'invalid-argument',
        'Faltan datos para verificar la firma.'
      );
    }

    // 3. Cargar la credencial desde Firestore
    let credDoc;
    try {
      credDoc = await admin.firestore()
        .collection('webauthnCredentials')
        .doc(credentialId)
        .get();
    } catch (e) {
      console.error('Error leyendo credencial:', e);
      throw new HttpsError('internal', 'Error al leer la credencial.');
    }

    if (!credDoc.exists) {
      throw new HttpsError(
        'not-found',
        'Credencial no encontrada.'
      );
    }

    const credData = credDoc.data();

    // 4. Verificar que la credencial pertenece al usuario que llama
    if (credData.userId !== auth.uid) {
      throw new HttpsError(
        'permission-denied',
        'Esta credencial no te pertenece.'
      );
    }

    // 5. Verificar que la credencial está activa
    if (credData.active === false) {
      throw new HttpsError(
        'permission-denied',
        'Esta credencial está desactivada.'
      );
    }

    // 6. Verificar la firma con SimpleWebAuthn
    const expectedOrigin = [
      'https://smartec-tienda.github.io',
      'http://localhost:5500',
      'http://127.0.0.1:5500'
    ];

    const expectedRPID = 'smartec-tienda.github.io';

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: {
          id: credentialId,
          rawId: credentialId,
          response: {
            authenticatorData,
            clientDataJSON,
            signature,
            userHandle: null
          },
          type: 'public-key',
          clientExtensionResults: {}
        },
        expectedChallenge: (challenge) => typeof challenge === 'string',
        expectedOrigin,
        expectedRPID,
        credential: {
          id: credentialId,
          publicKey: (() => {
            // SimpleWebAuthn espera la public key en formato COSE (Uint8Array).
            // La extraemos del attestationObject usando @simplewebauthn/server.
            const { isoBase64URL, isoCBOR } = require('@simplewebauthn/server/helpers');
            const attestationBuffer = isoBase64URL.toBuffer(credData.attestationObject);
            const decoded = isoCBOR.decodeFirst(attestationBuffer);
            const authData = decoded.authData;
            const credIdLen = (authData[53] << 8) | authData[54];
            const publicKeyOffset = 55 + credIdLen;
            const publicKeyBytes = authData.slice(publicKeyOffset);
            return publicKeyBytes;
          })(),
          counter: Number(credData.counter || 0),
          transports: credData.transports || []
        },
        requireUserVerification: true
      });
    } catch (e) {
      console.error('Verificación WebAuthn falló:', e);
      throw new HttpsError(
        'permission-denied',
        'La firma de la huella no es válida: ' + e.message
      );
    }

    if (!verification.verified) {
      throw new HttpsError(
        'permission-denied',
        'La verificación de huella no pasó.'
      );
    }

    // 7. Actualizar el contador anti-replay
    try {
      await admin.firestore()
        .collection('webauthnCredentials')
        .doc(credentialId)
        .update({
          counter: verification.authenticationInfo.newCounter,
          lastUsedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
      console.warn('No se pudo actualizar el contador:', e);
    }

    // 8. Auditoría
    try {
      await admin.firestore().collection('auditLog').add({
        action: 'login',
        collection: 'webauthnCredentials',
        docId: credentialId,
        userId: auth.uid,
        userEmail: auth.token.email || null,
        note: `Huella verificada correctamente`,
        after: {
          method: 'webauthn',
          newCounter: verification.authenticationInfo.newCounter
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('Auditoría falló:', e);
    }

    return {
      success: true,
      verified: true,
      newCounter: verification.authenticationInfo.newCounter
    };
  }
);