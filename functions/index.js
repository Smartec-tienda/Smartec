const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { Buffer } = require('buffer');

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

    // 🆕 Validar el rol contra lista blanca
  const validRoles = ['superadmin', 'admin', 'vendedor', 'domiciliario', 'mayorista'];
  const role = data.role || 'vendedor';
  if (!validRoles.includes(role)) {
    throw new HttpsError(
      "invalid-argument",
      `Rol no válido: "${role}". Debe ser uno de: ${validRoles.join(', ')}.`
    );
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
      deviceAutoApprove: !!data.deviceAutoApprove,        // 🆕 faltaba este campo
      employeeId: data.employeeId || null,                 // 🆕 vínculo con empleado
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
      note: `Usuario creado: ${name} (${userProfile.role})${userProfile.employeeId ? ' · vinculado a empleado' : ' · usuario externo'}`,
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
          publicKey: Buffer.from(credData.publicKey, 'base64url'),
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
/* ============================================================
   verifyWebAuthnRegistration
   Verifica y procesa un registro de WebAuthn.
   Extrae la public key correctamente usando SimpleWebAuthn.
   Devuelve la public key en base64url lista para guardar.
============================================================ */
const { verifyRegistrationResponse } = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');

exports.verifyWebAuthnRegistration = onCall(
  { cors: true, region: 'us-central1' },
  async (request) => {
    const { auth, data } = request;

    if (!auth) {
      throw new HttpsError(
        'unauthenticated',
        'Debes iniciar sesión para registrar la huella.'
      );
    }

    const {
      attestationObject,
      clientDataJSON,
      expectedChallenge,
      credentialId
    } = data || {};

    if (!attestationObject || !clientDataJSON || !expectedChallenge || !credentialId) {
      throw new HttpsError(
        'invalid-argument',
        'Faltan datos para verificar el registro.'
      );
    }

    const expectedOrigin = [
      'https://smartec-tienda.github.io',
      'http://localhost:5500',
      'http://127.0.0.1:5500'
    ];

    const expectedRPID = 'smartec-tienda.github.io';

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: {
          id: credentialId,
          rawId: credentialId,
          response: {
            attestationObject,
            clientDataJSON
          },
          type: 'public-key',
          clientExtensionResults: {}
        },
        expectedChallenge,
        expectedOrigin,
        expectedRPID,
        requireUserVerification: true
      });
    } catch (e) {
      console.error('Error verificando registro WebAuthn:', e);
      throw new HttpsError(
        'invalid-argument',
        'La verificación del registro falló: ' + e.message
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new HttpsError(
        'invalid-argument',
        'El registro no pudo ser verificado.'
      );
    }

    const credInfo = verification.registrationInfo;

    // En @simplewebauthn/server v13+: la public key está en credInfo.credential.publicKey
    // En v12 y anteriores: en credInfo.credentialPublicKey
    let credentialPublicKey = credInfo.credentialPublicKey;
    let credentialID = credInfo.credentialID;

    if (!credentialPublicKey && credInfo.credential) {
      credentialPublicKey = credInfo.credential.publicKey;
      credentialID = credInfo.credential.id;
    }

    if (!credentialPublicKey) {
      console.error('No credentialPublicKey. registrationInfo:', credInfo);
      throw new HttpsError('internal', 'No se obtuvo credentialPublicKey del registro. Revisa logs.');
    }

    const counter = credInfo.counter || (credInfo.credential && credInfo.credential.counter) || 0;

    const publicKeyBase64Url = isoBase64URL.fromBuffer(
      credentialPublicKey instanceof Uint8Array ? credentialPublicKey : new Uint8Array(credentialPublicKey)
    );

    const credentialIdBase64Url = credentialID
      ? isoBase64URL.fromBuffer(credentialID instanceof Uint8Array ? credentialID : new Uint8Array(credentialID))
      : credentialId;

    return {
      success: true,
      credentialId: credentialIdBase64Url,
      publicKey: publicKeyBase64Url,
      counter: counter,
      verified: true
    };
  }
);

/* ============================================================
   deleteUser
   Elimina un usuario completamente:
     - Deshabilita y elimina su cuenta en Firebase Auth
     - Marca el documento en Firestore como eliminado (soft delete)
     - Conserva todo el historial (ventas, comprobantes, etc.)
   Solo puede ser invocado por un superadmin autenticado.
============================================================ */
exports.deleteUser = onCall({ cors: true, region: 'us-central1' }, async (request) => {
  const { auth, data } = request;

  // 1. Verificar autenticación
  if (!auth) {
    throw new HttpsError(
      "unauthenticated",
      "Debes iniciar sesión para eliminar usuarios."
    );
  }

  // 2. Verificar que quien llama es superadmin
  const callerUid = auth.uid;
  const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
  if (!callerDoc.exists) {
    throw new HttpsError("permission-denied", "Tu perfil de usuario no existe.");
  }
  const callerData = callerDoc.data();
  if (callerData.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo el superadmin puede eliminar usuarios.");
  }

  // 3. Validar el UID a eliminar
  const targetUid = (data.uid || "").trim();
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "El UID es obligatorio.");
  }

  // 4. No permitir eliminar el propio usuario
  if (targetUid === callerUid) {
    throw new HttpsError(
      "invalid-argument",
      "No puedes eliminar tu propio usuario."
    );
  }

  // 5. Leer el usuario target
  const targetDoc = await admin.firestore().collection("users").doc(targetUid).get();
  if (!targetDoc.exists) {
    throw new HttpsError("not-found", "El usuario no existe.");
  }
  const targetData = targetDoc.data();

  // 6. Si ya estaba eliminado, retornar idempotente
  if (targetData.deleted === true) {
    return {
      success: true,
      uid: targetUid,
      email: targetData.email || null,
      alreadyDeleted: true,
      note: "El usuario ya estaba eliminado previamente."
    };
  }

  // 7. No permitir eliminar al último superadmin activo
  if (targetData.role === "superadmin" && targetData.active !== false) {
    const superadminsSnap = await admin.firestore()
      .collection("users")
      .where("role", "==", "superadmin")
      .where("active", "==", true)
      .where("deleted", "!=", true)
      .get();

    // Contar cuántos superadmins activos quedan además del target
    let activeSuperadmins = 0;
    superadminsSnap.forEach(doc => {
      if (doc.id !== targetUid && doc.data().deleted !== true) {
        activeSuperadmins++;
      }
    });

    if (activeSuperadmins === 0) {
      throw new HttpsError(
        "failed-precondition",
        "No puedes eliminar al último superadmin activo. Debe quedar al menos uno para administrar el sistema."
      );
    }
  }

  const targetEmail = targetData.email || null;
  const targetName = targetData.name || targetEmail || 'Usuario';
  const targetRole = targetData.role || 'desconocido';

  // 8. Marcar como eliminado en Firestore (soft delete)
  try {
    await admin.firestore().collection("users").doc(targetUid).update({
      deleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      deletedBy: auth.token.email || null,
      active: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error("Error marcando usuario como eliminado en Firestore:", e);
    throw new HttpsError("internal", "Error al marcar el usuario como eliminado.");
  }

  // 9. Eliminar de Firebase Auth
  let authDeleted = false;
  let authError = null;
  try {
    await admin.auth().deleteUser(targetUid);
    authDeleted = true;
  } catch (e) {
    // Si el usuario ya no existe en Auth, no es error crítico
    if (e.code === "auth/user-not-found") {
      authDeleted = true;
    } else {
      authError = e.message;
      console.error("Error eliminando de Firebase Auth:", e);
    }
  }

  // 10. Auditoría
  try {
    await admin.firestore().collection("auditLog").add({
      action: "delete",
      collection: "users",
      docId: targetUid,
      userId: callerUid,
      userEmail: auth.token.email || null,
      userRole: callerData.role,
      storeId: targetData.storeId || null,
      before: {
        name: targetData.name,
        email: targetData.email,
        role: targetData.role,
        active: targetData.active,
        storeId: targetData.storeId
      },
      after: {
        deleted: true,
        authDeleted,
        authError
      },
      note: `Usuario eliminado: ${targetName} (${targetRole})${targetEmail ? ' · ' + targetEmail : ''}${authDeleted ? ' · Auth OK' : ' · Auth FAIL: ' + authError}`,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.warn("Auditoría falló:", e);
  }

  return {
    success: true,
    uid: targetUid,
    email: targetEmail,
    authDeleted: authDeleted,
    authError: authError,
    note: authDeleted
      ? "Usuario eliminado correctamente."
      : "Usuario marcado como eliminado, pero hubo un error al eliminar de Auth: " + authError
  };
});