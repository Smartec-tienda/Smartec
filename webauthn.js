/* ============================================================
   SMARTEC · WebAuthn Helper
   Envuelve las APIs de WebAuthn usando @simplewebauthn/browser
   ============================================================ */

window.SmartecWebAuthn = (() => {

  const RP_NAME = 'Smartec';

  // Import dinámico de la librería (funciona como módulo ES)
  let SimpleWebAuthnBrowser = null;

  async function loadLib() {
    if (SimpleWebAuthnBrowser) return SimpleWebAuthnBrowser;
    SimpleWebAuthnBrowser = await import(
      'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13/+esm'
    );
    return SimpleWebAuthnBrowser;
  }

  /**
   * ¿El dispositivo soporta autenticación con biometría?
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
   * Convierte ArrayBuffer a base64url (helper por si acaso).
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
   * Convierte base64url a Uint8Array.
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
    return bytes;
  }

  /**
   * Registra una nueva credencial WebAuthn.
   * Devuelve la respuesta ya lista para guardar.
   */
  async function registerCredential(opts) {
    const { rpId, userId, userEmail, userName, challenge } = opts;

    const lib = await loadLib();

    // El challenge debe venir como Uint8Array o base64url
    let challengeUint8;
    if (challenge instanceof ArrayBuffer) {
      challengeUint8 = new Uint8Array(challenge);
    } else if (challenge instanceof Uint8Array) {
      challengeUint8 = challenge;
    } else if (typeof challenge === 'string') {
      challengeUint8 = base64UrlToBuffer(challenge);
    } else {
      throw new Error('Challenge inválido');
    }

    // WebAuthn pide un userID único (máx 64 bytes)
    const userHandle = new TextEncoder().encode(userId);

    const options = {
      challenge: challengeUint8,
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
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
        requireResidentKey: false
      },
      timeout: 60000,
      attestation: 'none'
    };

    try {
      // startRegistration devuelve un objeto serializable listo para guardar
      const response = await lib.startRegistration({ optionsJSON: options });

      return {
        credentialId: response.id,
        // response.response.attestationObject está en base64url (serializado por la lib)
        attestationObject: response.response.attestationObject,
        clientDataJSON: response.response.clientDataJSON,
        transports: response.response.transports || [],
        // Guardamos también el userHandle en base64url
        userHandle: bufferToBase64Url(userHandle)
      };
    } catch (e) {
      console.error('[WebAuthn] Error en registerCredential:', e);
      throw e;
    }
  }

  /**
   * Verifica la identidad con una credencial existente.
   */
  async function getAssertion(opts) {
    const { rpId, challenge, allowCredentials } = opts;

    const lib = await loadLib();

    let challengeUint8;
    if (challenge instanceof ArrayBuffer) {
      challengeUint8 = new Uint8Array(challenge);
    } else if (challenge instanceof Uint8Array) {
      challengeUint8 = challenge;
    } else if (typeof challenge === 'string') {
      challengeUint8 = base64UrlToBuffer(challenge);
    } else {
      throw new Error('Challenge inválido');
    }

    const options = {
      challenge: challengeUint8,
      rpId: rpId,
      allowCredentials: (allowCredentials || []).map(id => ({
        id: id,  // ya viene en base64url
        type: 'public-key',
        transports: ['internal', 'hybrid']
      })),
      userVerification: 'required',
      timeout: 60000
    };

    try {
      // startAuthentication devuelve la assertion serializada
      const assertion = await lib.startAuthentication({ optionsJSON: options });

      return {
        credentialId: assertion.id,
        authenticatorData: assertion.response.authenticatorData,
        clientDataJSON: assertion.response.clientDataJSON,
        signature: assertion.response.signature,
        userHandle: assertion.response.userHandle || null
      };
    } catch (e) {
      console.error('[WebAuthn] Error en getAssertion:', e);
      throw e;
    }
  }

  /**
   * Genera un challenge aleatorio (32 bytes).
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

console.log('[Smartec] webauthn.js cargado (v2 - usando @simplewebauthn/browser)');