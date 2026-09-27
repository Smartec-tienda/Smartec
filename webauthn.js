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

    // El challenge debe ser base64url string
    let challengeBase64Url;
    if (typeof challenge === 'string') {
      challengeBase64Url = challenge;
    } else if (challenge instanceof ArrayBuffer) {
      challengeBase64Url = bufferToBase64Url(challenge);
    } else if (challenge instanceof Uint8Array) {
      challengeBase64Url = bufferToBase64Url(challenge.buffer);
    } else {
      throw new Error('Challenge inválido');
    }

    // WebAuthn pide un userID único (máx 64 bytes)
    const userHandle = new TextEncoder().encode(userId);
    const userHandleB64 = bufferToBase64Url(userHandle.buffer);

    const options = {
      challenge: challengeBase64Url,
      rp: {
        name: RP_NAME,
        id: rpId
      },
      user: {
        id: userHandleB64,
        name: userEmail,
        displayName: userName || userEmail
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' }
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
      const response = await lib.startRegistration({ optionsJSON: options });

      return {
        credentialId: response.id,
        attestationObject: response.response.attestationObject,
        clientDataJSON: response.response.clientDataJSON,
        transports: response.response.transports || [],
        userHandle: userHandleB64
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

    // El challenge debe ser base64url string
    let challengeBase64Url;
    if (typeof challenge === 'string') {
      challengeBase64Url = challenge;
    } else if (challenge instanceof ArrayBuffer) {
      challengeBase64Url = bufferToBase64Url(challenge);
    } else if (challenge instanceof Uint8Array) {
      challengeBase64Url = bufferToBase64Url(challenge.buffer);
    } else {
      throw new Error('Challenge inválido');
    }

    // allowCredentials ya viene en base64url (string), no hace falta convertir
    const options = {
      challenge: challengeBase64Url,
      rpId: rpId,
      allowCredentials: (allowCredentials || []).map(id => ({
        id: id,
        type: 'public-key',
        transports: ['internal', 'hybrid']
      })),
      userVerification: 'required',
      timeout: 60000
    };

    try {
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