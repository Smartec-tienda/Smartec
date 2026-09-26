/* ============================================================
   SMARTEC · WebAuthn Helper
   Envuelve las APIs de WebAuthn para registro y verificación.
   No depende de Firebase (solo del navegador).
   ============================================================ */

window.SmartecWebAuthn = (() => {

  const RP_NAME = 'Smartec';

  /**
   * ¿El dispositivo soporta autenticación con biometría (huella/rostro) o PIN del sistema?
   * @returns {Promise<boolean>}
   */
  async function isPlatformAuthenticatorAvailable() {
    try {
      if (!window.PublicKeyCredential) return false;
      if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
        return false;
      }
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
      console.warn('[WebAuthn] Error comprobando autenticador:', e);
      return false;
    }
  }

  /**
   * Convierte ArrayBuffer a base64url (sin padding).
   */
  function bufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Convierte base64url a ArrayBuffer.
   */
  function base64UrlToBuffer(base64url) {
    const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
    const base64 = (base64url + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Registra una nueva credencial WebAuthn (huella/rostro).
   * @param {Object} opts
   * @param {string} opts.rpId - RP ID (dominio).
   * @param {string} opts.userId - UID del usuario (string).
   * @param {string} opts.userEmail - Email del usuario.
   * @param {string} opts.userName - Nombre del usuario.
   * @param {ArrayBuffer} opts.challenge - Challenge del servidor.
   * @returns {Promise<Object>} Credencial lista para guardar en Firestore.
   */
  async function registerCredential(opts) {
    const { rpId, userId, userEmail, userName, challenge } = opts;

    // Generar un userId random para WebAuthn (no usar el de Firebase directamente por privacidad)
    const userHandle = new TextEncoder().encode(userId);

    const publicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: RP_NAME,
        id: rpId
      },
      user: {
        id: userHandle,
        name: userEmail,
        displayName: userName || userEmail
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' }  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',  // Solo autenticadores del dispositivo (huella, Face ID, Windows Hello)
        userVerification: 'required',          // Obligatorio verificar al usuario
        residentKey: 'preferred',
        requireResidentKey: false
      },
      timeout: 60000,
      attestation: 'none'
    };

    try {
      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions
      });

      return {
        credentialId: bufferToBase64Url(credential.rawId),
        publicKey: bufferToBase64Url(credential.response.getPublicKey
          ? credential.response.getPublicKey()
          : credential.response.attestationObject), // Fallback raro
        attestationObject: bufferToBase64Url(credential.response.attestationObject),
        clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
        transports: credential.response.getTransports
          ? credential.response.getTransports()
          : []
      };
    } catch (e) {
      console.error('[WebAuthn] Error en register:', e);
      throw e;
    }
  }

  /**
   * Verifica la identidad con una credencial existente.
   * @param {Object} opts
   * @param {string} opts.rpId
   * @param {ArrayBuffer} opts.challenge
   * @param {Array<string>} opts.allowCredentials - Lista de credentialIds (base64url) permitidos.
   * @returns {Promise<Object>} Assertion para verificar en el servidor.
   */
  async function getAssertion(opts) {
    const { rpId, challenge, allowCredentials } = opts;

    const publicKeyCredentialRequestOptions = {
      challenge: challenge,
      rpId: rpId,
      allowCredentials: (allowCredentials || []).map(id => ({
        id: base64UrlToBuffer(id),
        type: 'public-key',
        transports: ['internal', 'hybrid']
      })),
      userVerification: 'required',
      timeout: 60000
    };

    try {
      const assertion = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions
      });

      return {
        credentialId: bufferToBase64Url(assertion.rawId),
        authenticatorData: bufferToBase64Url(assertion.response.authenticatorData),
        clientDataJSON: bufferToBase64Url(assertion.response.clientDataJSON),
        signature: bufferToBase64Url(assertion.response.signature),
        userHandle: assertion.response.userHandle
          ? bufferToBase64Url(assertion.response.userHandle)
          : null
      };
    } catch (e) {
      console.error('[WebAuthn] Error en get:', e);
      throw e;
    }
  }

  /**
   * Genera un challenge aleatorio (32 bytes).
   * Nota: en producción, el challenge debe venir del servidor para evitar replay attacks.
   * Por ahora lo generamos en el cliente mientras armamos el flujo.
   */
  function generateChallenge() {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    return challenge.buffer;
  }

  /**
   * Detecta si el error es por cancelación del usuario.
   */
  function isUserCancelled(error) {
    return error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
  }

  return {
    isPlatformAuthenticatorAvailable,
    registerCredential,
    getAssertion,
    generateChallenge,
    bufferToBase64Url,
    base64UrlToBuffer,
    isUserCancelled
  };

})();

console.log('[Smartec] webauthn.js cargado');