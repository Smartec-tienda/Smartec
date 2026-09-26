const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * createUserAdmin
 * Crea un usuario en Firebase Auth + guarda su perfil en Firestore.
 * Solo puede ser invocado por un superadmin autenticado.
 */
exports.createUserAdmin = onCall(async (request) => {
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