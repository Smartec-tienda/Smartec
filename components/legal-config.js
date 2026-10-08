/* ============================================================
   SMARTEC · legal-config.js
   Configuración central de datos legales y de la plataforma.

   Cambiar aquí los datos cuando el software se venda a otro
   cliente. Los 5 documentos legales (politica-datos.html,
   terminos.html, autorizacion.html, privacidad.html,
   cookies.html) leen este objeto y se actualizan solos.
============================================================ */

(function () {
  'use strict';

  window.SMARTEC_LEGAL = Object.freeze({

    /* ============================================================
       IDENTIDAD DE LA PLATAFORMA (proveedor del software)
       ============================================================ */
    platformName: "Smartec",
    platformTagline: "Centro de gestión comercial y contable",

    // Datos legales del proveedor
    legalName: "SMARTEC GROUP COLOMBIA S.A.S",
    nit: "902112317-02",
    regimen: "Régimen Ordinario - Responsable de IVA",
    address: "CL114 # 42 C 33 Local 23 N 1A",
    phone: "+573233877904",
    email: "infosmartecol@gmail.com",
    website: "smartec.com",

    /* ============================================================
       DATOS GEOGRÁFICOS Y LEGALES
       ============================================================ */
    country: "Colombia",
    jurisdiction: "Colombia",
    city: "Colombia",

    // Leyes aplicables (Colombia)
    laws: {
      dataProtection: "Ley 1581 de 2012",
      dataProtectionDecree: "Decreto 1377 de 2013",
      ecommerce: "Ley 527 de 1999",
      consumerProtection: "Ley 1480 de 2011",
      habeasData: "Artículo 15 de la Constitución Política de Colombia"
    },

    /* ============================================================
       AUTORIDAD DE CONTROL
       ============================================================ */
    authority: {
      name: "Superintendencia de Industria y Comercio (SIC)",
      website: "https://www.sic.gov.co",
      address: "Carrera 13 No. 27 - 00, Bogotá D.C., Colombia"
    },

    /* ============================================================
       PARÁMETROS DE TRATAMIENTO
       ============================================================ */
    dataRetentionYears: 5,
    responseTimeDays: 15,       // plazo para responder consultas/reclamos
    authorizationRevokeEmail: "infosmartecol@gmail.com",

    /* ============================================================
       FECHAS
       ============================================================ */
    lastUpdate: "2026-10-07",
    effectiveDate: "2026-10-07",

    /* ============================================================
       ROLES LEGALES (aclaración importante)
       ============================================================ */
    roles: {
      provider: "Proveedor de la plataforma (Smartec)",
      merchant: "Comerciante o Tienda (cliente de Smartec)",
      holder: "Titular de los datos (usuario final / comprador)"
    },

    /* ============================================================
       CONTACTO PARA TEMAS LEGALES
       ============================================================ */
    legalContact: {
      email: "infosmartecol@gmail.com",
      phone: "+573233877904",
      address: "CL114 # 42 C 33 Local 23 N 1A"
    }

  });

  console.log('[Smartec] legal-config.js cargado');
})();