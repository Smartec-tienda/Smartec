import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc,
  updateDoc, deleteDoc, serverTimestamp, query, where, orderBy, limit,
  startAfter, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject }
  from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

/* ============================================================
   CONFIG
   🆕 Config detectada automáticamente por firebase-config.js
   según el dominio donde corra la app.
============================================================ */
const firebaseConfig = window.__FIREBASE_CONFIG;

if (!firebaseConfig) {
  document.body.innerHTML = `
    <div style="padding:40px;font-family:-apple-system,sans-serif;text-align:center;color:#1D1D1F">
      <h2 style="color:#0A2A4A">Error de configuración</h2>
      <p>No se encontró configuración de Firebase para este dominio.</p>
      <p style="color:#6E6E73;font-size:14px">Contacta al administrador del sistema.</p>
    </div>
  `;
  throw new Error('[Config] Firebase config no disponible');
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
// 🛡️ App Check con reCAPTCHA Enterprise
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(firebaseConfig.recaptchaEnterpriseKey),
  isTokenAutoRefreshEnabled: true
});
const functions = getFunctions(app, firebaseConfig.functionsRegion || 'us-central1');


/* ============================================================
   ESTADO GLOBAL
============================================================ */
let currentUser = null;
let currentUserData = null;
let stores = [], users = [], products = [], inventory = [],
    sales = [], auditLogs = [], settings = {},
    storeGoals = [], cashRegisters = [], expensesAll = [];
let currentProductImages = [];
let shiftsAll = [];  // 🕒 todos los turnos (entradas/salidas)
let paymentChannels = [];      // 🆕 cuentas/canales de pago
let paymentPlatforms = [];     // 🆕 catálogo de bancos/plataformas
let suppliers = [];            // 🆕 maestro de proveedores
let accountingSettings = { defaultTermsDays: 30, defaultAlertDays: 5 }; // 🆕
let currentAccView = 'summary'; // 🆕 vista actual de contabilidad
let transferRequestsAll = [];   // 🆕 solicitudes de traslado (tiempo real)
let deviceRequestsAll = [];     // 🆕 solicitudes de dispositivo (tiempo real)
let deviceAttemptsAll = [];     // 🆕 intentos de acceso bloqueados (tiempo real)

/* ============================================================
   HELPERS
============================================================ */
const fmt = n => '$' + Math.round(Number(n||0)).toLocaleString('es-CO');
const escapeHtml = window.Smartec.escapeHtml;   // 🆕

/* ============ SPLASH SCREEN ============ */
function hideSplash() {
  if (document.body.classList.contains('app-loading')) {
    document.body.classList.remove('app-loading');
    console.log('[SPLASH] Oculto. App lista.');
  }
}

/* ============================================================
   🆕 CARGA DIFERIDA DE LIBRERÍAS PESADAS (jsPDF, AutoTable, ExcelJS)
   Se cargan SOLO cuando se llama a loadLazyLibs(). Quedan cacheadas
   en window.__SMARTEC_LAZY_LOADED para no recargarlas dos veces.
============================================================ */
const _lazyLoaded = { jspdf: false, autotable: false, exceljs: false };
const _lazyPromises = { jspdf: null, autotable: null, exceljs: null };

function _injectScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar: ' + src));
    document.head.appendChild(s);
  });
}

async function loadLazyLibs(needed) {
  // needed: 'jspdf' | 'exceljs' | 'both'
  const urls = window.__SMARTEC_LAZY_LIBS || {};
  const tasks = [];

  const wantJsPDF = needed === 'jspdf' || needed === 'both';
  const wantExcel = needed === 'exceljs' || needed === 'both';

  if (wantJsPDF && !_lazyLoaded.jspdf) {
    if (!_lazyPromises.jspdf) {
      _lazyPromises.jspdf = (async () => {
        if (!window.jspdf) await _injectScript(urls.jspdf);
        if (!window.jspdf?.jsPDF?.API?.autoTable) await _injectScript(urls.autotable);
        _lazyLoaded.jspdf = true;
        _lazyLoaded.autotable = true;
        console.log('[LazyLibs] jsPDF + AutoTable listos');
      })();
    }
    tasks.push(_lazyPromises.jspdf);
  }

  if (wantExcel && !_lazyLoaded.exceljs) {
    if (!_lazyPromises.exceljs) {
      _lazyPromises.exceljs = (async () => {
        if (!window.ExcelJS) await _injectScript(urls.exceljs);
        _lazyLoaded.exceljs = true;
        console.log('[LazyLibs] ExcelJS listo');
      })();
    }
    tasks.push(_lazyPromises.exceljs);
  }

  await Promise.all(tasks);
}

// Exponer global para usarlas desde cualquier parte
window.loadLazyLibs = loadLazyLibs;

/* ============================================================
   🆕 SIDEBAR — Toggle y colapso
============================================================ */
window.toggleSidebar = () => {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    sidebar.classList.remove('open');
    backdrop?.classList.add('hidden');
    document.body.style.overflow = '';
  } else {
    sidebar.classList.add('open');
    backdrop?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
};

window.toggleSidebarCollapse = () => {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.classList.toggle('collapsed');
  try {
    localStorage.setItem('smartec_admin_sidebar_collapsed',
      sidebar.classList.contains('collapsed') ? '1' : '0');
  } catch (e) {}
};

// Restaurar estado del sidebar al cargar
(function initSidebarCollapse() {
  try {
    if (localStorage.getItem('smartec_admin_sidebar_collapsed') === '1') {
      document.getElementById('sidebar')?.classList.add('collapsed');
    }
  } catch (e) {}
})();

// Cerrar sidebar móvil al redimensionar a desktop
window.addEventListener('resize', () => {
  if (window.innerWidth >= 1024) {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    sidebar?.classList.remove('open');
    backdrop?.classList.add('hidden');
    document.body.style.overflow = '';
  }
});
const fmtDate = ts => {
  if (!ts) return '-';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return d.toLocaleString('es-CO', { year:'2-digit', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
};
const $ = id => document.getElementById(id);

async function audit(entry) {
  try {
    // Usar la versión enriquecida de common.js
    await window.Smartec.audit(entry, {
      db,
      user: currentUser,
      userData: currentUserData,
      store: { storeId: currentUserData?.storeId || null },
      storeName: stores?.find(s => s.storeId === currentUserData?.storeId)?.name || null
    });
  } catch(e) {
    console.warn('audit fail (fallback al simple):', e);
    // Fallback: si falla la versión rica, guardar la simple
    try {
      await addDoc(collection(db,'auditLog'), {
        ...entry,
        userId: currentUser?.uid || null,
        userEmail: currentUser?.email || null,
        userRole: currentUserData?.role || null,
        storeId: currentUserData?.storeId || null,
        timestamp: serverTimestamp()
      });
    } catch(e2) { console.warn('audit fallback fail', e2); }
  }
}


/* ============================================================
   🆕 RENDER DEL HEADER-APP (inyecta el header unificado)
============================================================ */
function renderAdminHeader() {
  if (!window.SmartecHeaderApp) {
    console.warn('[Admin] header-app.js no está cargado');
    return;
  }
  if (!currentUser || !currentUserData) return;

  window.SmartecHeaderApp.render({
    settings: settings || {},
    user: {
      uid: currentUser.uid,
      email: currentUser.email,
      name: currentUserData.name || currentUser.email,
      role: currentUserData.role,
      storeId: currentUserData.storeId || null
    },
    stores: [],              // admin no maneja tiendas específicas
    currentStore: null,
    showTitle: true,
    titleText: 'Panel Superadmin',
    showRole: true,
    showShiftButton: false,  // admin no maneja turnos
    showSellerInfo: true,
    showHomeLink: true,
    homeLinkLabel: 'Inicio',      // 🆕 se muestra como "Inicio" pero va a home.html
    homeLinkHref: 'home.html',    // 🆕 destino del botón
    showRefreshButton: true,
    showLogoutButton: true,
    showStoreSelector: false,
    extraLinks: [
      { label: '🛒 Punto de venta', href: 'venta.html' },
      { label: '🚚 Domicilios', href: 'domicilios.html' }
    ],
    onRefresh: () => { if (window.forceRefreshCache) window.forceRefreshCache(); },
    onLogout: async () => {
      if (window.SmartecKiosk) window.SmartecKiosk.disable();
      await audit({ action:'logout', collection:'system', note:'Cierre de sesión' });
      window.SmartecDeviceGuard.clearValidatedToday();
      await signOut(auth);
      window.location.href = 'home.html';
    }
  });
}


/* ============================================================
   TRADUCTOR DE COLORES (hex → nombre en español)
============================================================ */
const COLOR_NAMES = {
  '#000000':'Negro', '#ffffff':'Blanco', '#c0c0c0':'Plateado', '#808080':'Gris',
  '#ff0000':'Rojo', '#00ff00':'Verde', '#0000ff':'Azul', '#ffff00':'Amarillo',
  '#ffa500':'Naranja', '#800080':'Morado', '#ffc0cb':'Rosado', '#a52a2a':'Café',
  '#964b00':'Café', '#8b4513':'Café', '#d2b48c':'Beige', '#f5f5dc':'Crema',
  '#00ffff':'Cian', '#008080':'Turquesa', '#4a7a9a':'Azul petróleo',
  '#0a2a4a':'Azul oscuro', '#191970':'Azul medianoche', '#f0f0f0':'Blanco humo',
  '#e0e0e0':'Gris claro', '#a9a9a9':'Gris oscuro', '#ffd700':'Dorado',
  '#b87333':'Bronce', '#cd7f32':'Bronce', '#36454f':'Gris carbón'
};

function colorNameFromHex(hex) {
  if (!hex) return '';
  const h = String(hex).toLowerCase().trim();
  if (COLOR_NAMES[h]) return COLOR_NAMES[h];

  // Búsqueda por aproximación si no hay coincidencia exacta
  const rgb = hexToRgb(h);
  if (!rgb) return hex;
  let closest = null, minDist = Infinity;
  for (const [hexKey, name] of Object.entries(COLOR_NAMES)) {
    const c = hexToRgb(hexKey);
    if (!c) continue;
    const d = Math.sqrt(
      Math.pow(rgb.r-c.r,2) + Math.pow(rgb.g-c.g,2) + Math.pow(rgb.b-c.b,2)
    );
    if (d < minDist) { minDist = d; closest = name; }
  }
  return closest || hex;
}

function hexToRgb(hex) {
  const m = String(hex).replace('#','').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
}

/* Devuelve el nombre real del color (usa colorName si ya es un nombre legible) */
function displayColorName(variant) {
  if (!variant) return '';
  const n = variant.colorName || '';
  // Si el nombre empieza con # o es puro hex, traducirlo
  if (n.startsWith('#') || /^[a-f0-9]{6}$/i.test(n)) return colorNameFromHex(n);
  return n;
}
/* ============================================================
   AUTENTICACIÓN
============================================================ */
$('login-btn').onclick = async () => {
  const err = $('login-error');
  err.classList.add('hidden');
  try {
    await signInWithEmailAndPassword(auth,
      $('login-email').value.trim(),
      $('login-pass').value);
  } catch(e) {
    err.innerText = 'Error: ' + e.message;
    err.classList.remove('hidden');
  }
};

onAuthStateChanged(auth, async user => {
      // 🚧 GUARD: solo se entra a esta página desde home.html
    if (user) {
      try {
        const _guardSnap = await getDoc(doc(db, 'users', user.uid));
        const _guardData = _guardSnap.exists() ? _guardSnap.data() : null;

        if (!_guardData || !['superadmin','admin','vendedor'].includes(_guardData.role)) {
          await signOut(auth);
          window.location.href = 'home.html';
          return;
        }

        if (window.SmartecDeviceGuard.shouldRedirectToHome(_guardData)) {
          window.location.href = 'home.html';
          return;
        }
      } catch (e) {
        console.warn('[Guard] Error validando acceso:', e);
        window.location.href = 'home.html';
        return;
      }
    }
  // 🆕 Si NO hay usuario, redirigir a home (no mostrar login, porque el login no está en este flujo)
  if (!user) {
    window.location.href = 'home.html';
    hideSplash();
    return;
  }

  if (user) {
    currentUser = user;
    // Cargar perfil
    try {
      const snap = await getDoc(doc(db,'users',user.uid));
      currentUserData = snap.exists() ? snap.data() : { role:'vendedor', storeId:null };
    } catch(e) { currentUserData = { role:'vendedor', storeId:null }; }

     // Bloquear si no es superadmin
    if (currentUserData.role !== 'superadmin') {
      alert('⛔ Este panel es exclusivo del superadmin. Serás redirigido al inicio.');
      await signOut(auth);
      window.location.href = 'home.html';
      return;
    }
        // 🔒 Activar modo kiosco si el usuario lo tiene configurado
    if (currentUserData.kioskMode === true) {
      window.SmartecKiosk.enable(() => {
        if (confirm('⚠️ Saliste de la aplicación.\n\n¿Cerrar sesión?')) {
          window.location.href = 'home.html';
        }
      });
    }

$('login-screen').classList.add('hidden');
$('panel').classList.remove('hidden');

await audit({ action:'login', collection:'system', note:'Inicio de sesión' });
await loadAll();

// 🆕 Renderizar el header unificado
renderAdminHeader();

// Badge en tiempo real de solicitudes pendientes
startTransfersBadgeListener();
  } else {
    currentUser = null; currentUserData = null;

    // Detener listeners viejos
    if (transfersBadgeUnsubscribe) { transfersBadgeUnsubscribe(); transfersBadgeUnsubscribe = null; }
    if (devicesBadgeUnsubscribe)   { devicesBadgeUnsubscribe();   devicesBadgeUnsubscribe = null; }
    if (attemptsBadgeUnsubscribe)  { attemptsBadgeUnsubscribe();  attemptsBadgeUnsubscribe = null; }

    // Detener polling
    if (window.__transfersBadgeInterval) {
      clearInterval(window.__transfersBadgeInterval);
      window.__transfersBadgeInterval = null;
    }

    // 🆕 Sin sesión → redirigir a home
    window.location.href = 'home.html';
  }
});

/* ============================================================
   TABS
============================================================ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = async () => {
    // UI: marcar activo
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('tab-active');
      b.classList.add('border-transparent','text-gray-500');
    });
    btn.classList.add('tab-active');
    btn.classList.remove('border-transparent','text-gray-500');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    $('tab-' + btn.dataset.tab).classList.remove('hidden');

    // Auto-cerrar sidebar en móvil
    if (window.innerWidth < 1024) {
      const sidebar = document.getElementById('sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      sidebar?.classList.remove('open');
      backdrop?.classList.add('hidden');
      document.body.style.overflow = '';
    }

    const tab = btn.dataset.tab;

    try {
      // ===== LAZY LOADING POR SECCIÓN =====
      if (tab === 'dashboard') {
        renderDashboard();
      }
      else if (tab === 'stores') {
        renderStores();
      }
      else if (tab === 'sellers') {
        renderSellers();
      }
      else if (tab === 'products') {
        renderProducts();
      }
      else if (tab === 'inventory') {
        renderInventory();
      }
      else if (tab === 'sales') {
        renderSales();
      }
      else if (tab === 'reports') {
        populateReportFilters();
        const dateFrom = $('rep-date-from');
        const dateTo = $('rep-date-to');
        if (!dateFrom.value || !dateTo.value) setReportRange('month');
        else renderReports();
        setTimeout(() => {
          try { renderCharts(getFilteredSales()); } catch(e) { console.warn(e); }
        }, 200);
      }
      else if (tab === 'shifts') {
        renderShifts();
      }
      else if (tab === 'cashregisters') {
        renderCashRegisters();
      }
      else if (tab === 'transfers') {
        // Asegurar que los listeners estén activos
        if (typeof startTransfersBadgeListener === 'function') {
          startTransfersBadgeListener();
        }
        renderTransfers();
      }
      else if (tab === 'audit') {
        // 🆕 Auditoría: cargar solo cuando entras (es pesada)
        const tbody = $('audit-tbody');
        if (tbody && !_loaded.auditLogs) {
          tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-gray-400">⏳ Cargando auditoría...</td></tr>';
        }
        await ensureAuditLogsLoaded();
        renderAudit();
      }
      else if (tab === 'accounting') {
        // 🆕 Contabilidad: cargar gastos + proveedores on demand
        const mainEl = $('tab-accounting');
        // (Si quieres un spinner, aquí se podría poner)
        await ensureAccountingLoaded();
        renderAccounting();
      }
      else if (tab === 'settings') {
        // 🆕 Configuración: cargar canales + plataformas on demand
        await ensureSettingsDataLoaded();
        renderSettings();
        initLogoListeners();
      }
    } catch (e) {
      console.error(`[Tab:${tab}] Error:`, e);
    }
  };
});

/* ============================================================
   LAZY LOADING — Flags de qué se ha cargado ya
============================================================ */
const _loaded = {
  stores: false,
  users: false,
  products: false,
  settings: false,
  inventory: false,
  sales: false,
  cashRegisters: false,
  auditLogs: false,
  expenses: false,
  suppliers: false,
  accountingSettings: false,
  paymentChannels: false,
  paymentPlatforms: false,
  shifts: false,
  transfers: false,
  deviceRequests: false,
  deviceAttempts: false
};

/* ============================================================
   PAGINACIÓN — Tamaños de página y cursores
   El cursor guarda el último documento leído para continuar
   desde ahí cuando el usuario pida "Cargar más".
============================================================ */
const PAGE_SIZE = {
  sales: 100,
  products: 100,
  inventory: 100,
  cashRegisters: 50,
  shifts: 50,
  auditLogs: 100,
  expenses: 100,
  suppliers: 100
};

const _cursor = {
  sales: null,
  products: null,
  inventory: null,
  cashRegisters: null,
  shifts: null,
  auditLogs: null,
  expenses: null,
  suppliers: null
};

const _hasMore = {
  sales: true,
  products: true,
  inventory: true,
  cashRegisters: true,
  shifts: true,
  auditLogs: true,
  expenses: true,
  suppliers: true
};

/* ============================================================
   CARGA INICIAL — Solo lo mínimo para que la app arranque
   El resto se carga bajo demanda (cuando el usuario entra
   a cada pestaña) o con "Cargar más" (paginación).
============================================================ */
async function loadAll() {
  const C = window.SmartecCache;

  await Promise.all([
    // ===== Colecciones pequeñas: se cargan completas =====
    C.wrap('stores', async () => {
      const s = await getDocs(collection(db,'stores'));
      return s.docs.map(d => ({id:d.id,...d.data()}));
    }).then(v => { stores = v; _loaded.stores = true; }),

    C.wrap('users', async () => {
      const s = await getDocs(collection(db,'users'));
      return s.docs.map(d => ({id:d.id,...d.data()}));
    }).then(v => { users = v; _loaded.users = true; }),

    C.wrap('settings', async () => {
      const s = await getDoc(doc(db,'settings','general'));
      return s.exists() ? s.data() : {};
    }).then(v => { settings = v; _loaded.settings = true; }),

    // ===== Ventas: solo las últimas 100 (ordenadas por fecha) =====
    C.wrap('sales_page_1', async () => {
      const s = await getDocs(query(
        collection(db,'sales'),
        orderBy('createdAt','desc'),
        limit(PAGE_SIZE.sales)
      ));
      const docs = s.docs.map(d => ({id:d.id,...d.data()}));
      _cursor.sales = s.docs[s.docs.length - 1] || null;
      _hasMore.sales = s.docs.length === PAGE_SIZE.sales;
      return docs;
    }).then(v => { sales = v; _loaded.sales = true; }),

    // ===== Productos: primeros 100 =====
    C.wrap('products_page_1', async () => {
      const s = await getDocs(query(
        collection(db,'products'),
        orderBy('name','asc'),
        limit(PAGE_SIZE.products)
      ));
      const docs = s.docs.map(d => ({id:d.id,...d.data()}));
      _cursor.products = s.docs[s.docs.length - 1] || null;
      _hasMore.products = s.docs.length === PAGE_SIZE.products;
      return docs;
    }).then(v => { products = v; _loaded.products = true; }),

    // ===== Inventario: primeros 100 =====
    C.wrap('inventory_page_1', async () => {
      const s = await getDocs(query(
        collection(db,'inventory'),
        orderBy('productName','asc'),
        limit(PAGE_SIZE.inventory)
      ));
      const docs = s.docs.map(d => ({id:d.id,...d.data()}));
      _cursor.inventory = s.docs[s.docs.length - 1] || null;
      _hasMore.inventory = s.docs.length === PAGE_SIZE.inventory;
      return docs;
    }).then(v => { inventory = v; _loaded.inventory = true; }),

    // ===== Arqueos: últimos 50 =====
    C.wrap('cashRegisters_page_1', async () => {
      const s = await getDocs(query(
        collection(db,'cashRegisters'),
        orderBy('createdAt','desc'),
        limit(PAGE_SIZE.cashRegisters)
      ));
      const docs = s.docs.map(d => ({id:d.id,...d.data()}));
      _cursor.cashRegisters = s.docs[s.docs.length - 1] || null;
      _hasMore.cashRegisters = s.docs.length === PAGE_SIZE.cashRegisters;
      return docs;
    }).then(v => { cashRegisters = v; _loaded.cashRegisters = true; }),

    // ===== Turnos: últimos 50 =====
    C.wrap('shifts_page_1', async () => {
      const s = await getDocs(query(
        collection(db,'shifts'),
        orderBy('startedAt','desc'),
        limit(PAGE_SIZE.shifts)
      ));
      const docs = s.docs.map(d => ({id:d.id,...d.data()}));
      _cursor.shifts = s.docs[s.docs.length - 1] || null;
      _hasMore.shifts = s.docs.length === PAGE_SIZE.shifts;
      return docs;
    }).then(v => { shiftsAll = v; _loaded.shifts = true; }),

    // ===== Solicitudes: SOLO pendientes (máx 50) =====
    C.wrap('transferRequests_pending', async () => {
      const s = await getDocs(query(
        collection(db,'transferRequests'),
        where('status','==','pendiente'),
        limit(50)
      ));
      return s.docs.map(d => ({id:d.id,...d.data()}));
    }).then(v => { transferRequestsAll = v; _loaded.transfers = true; }),

    C.wrap('deviceRequests_pending', async () => {
      const s = await getDocs(query(
        collection(db,'deviceRequests'),
        where('status','==','pendiente'),
        limit(50)
      ));
      return s.docs.map(d => ({id:d.id,...d.data()}));
    }).then(v => { deviceRequestsAll = v; _loaded.deviceRequests = true; }),

    C.wrap('deviceAttempts_pending', async () => {
      const s = await getDocs(query(
        collection(db,'deviceAttempts'),
        where('status','!=','resuelto'),
        limit(50)
      ));
      return s.docs.map(d => ({id:d.id,...d.data()}));
    }).then(v => { deviceAttemptsAll = v; _loaded.deviceAttempts = true; })
  ]);

  // Render inicial
  renderDashboard();

  // 🆕 Si la URL trae #transfers, abrir esa pestaña
  if (window.location.hash === '#transfers') {
    history.replaceState(null, '', window.location.pathname);
    startTransfersBadgeListener();
    setTimeout(() => {
      const btn = document.querySelector('[data-tab="transfers"]');
      if (btn) btn.click();
    }, 300);
  }

  // 🆕 Quitar splash
  hideSplash();

  // 🆕 Prefetch en background
  requestIdleCallback(() => {
    prefetchCommons();
  }, { timeout: 4000 });
}

/* ============================================================
   🆕 LAZY LOADERS — Carga por demanda
============================================================ */

// ===== AUDITORÍA (pesada, solo si la abres) — paginada =====
async function ensureAuditLogsLoaded() {
  if (_loaded.auditLogs) return;
  const C = window.SmartecCache;
  try {
    const s = await getDocs(query(
      collection(db,'auditLog'),
      orderBy('timestamp','desc'),
      limit(PAGE_SIZE.auditLogs)
    ));
    auditLogs = s.docs.map(d => ({id:d.id,...d.data()}));
    _cursor.auditLogs = s.docs[s.docs.length - 1] || null;
    _hasMore.auditLogs = s.docs.length === PAGE_SIZE.auditLogs;
    _loaded.auditLogs = true;
  } catch(e) {
    console.warn('[Lazy] Error cargando auditLog:', e);
    auditLogs = [];
    _hasMore.auditLogs = false;
  }
}

/* ============================================================
   CARGAR MÁS — Paginación bajo demanda
============================================================ */

async function loadMoreSales() {
  if (!_hasMore.sales || !_cursor.sales) return;
  try {
    const s = await getDocs(query(
      collection(db,'sales'),
      orderBy('createdAt','desc'),
      startAfter(_cursor.sales),
      limit(PAGE_SIZE.sales)
    ));
    const newDocs = s.docs.map(d => ({id:d.id,...d.data()}));
    sales = sales.concat(newDocs);
    _cursor.sales = s.docs[s.docs.length - 1] || null;
    _hasMore.sales = s.docs.length === PAGE_SIZE.sales;
    if (typeof window.renderSales === 'function') window.renderSales();
    updateLoadMoreButton('sales', _hasMore.sales);
  } catch(e) {
    console.error('loadMoreSales:', e);
  }
}

async function loadMoreProducts() {
  if (!_hasMore.products || !_cursor.products) return;
  try {
    const s = await getDocs(query(
      collection(db,'products'),
      orderBy('name','asc'),
      startAfter(_cursor.products),
      limit(PAGE_SIZE.products)
    ));
    const newDocs = s.docs.map(d => ({id:d.id,...d.data()}));
    products = products.concat(newDocs);
    _cursor.products = s.docs[s.docs.length - 1] || null;
    _hasMore.products = s.docs.length === PAGE_SIZE.products;
    if (typeof window.renderProducts === 'function') window.renderProducts();
    updateLoadMoreButton('products', _hasMore.products);
  } catch(e) {
    console.error('loadMoreProducts:', e);
  }
}

async function loadMoreInventory() {
  if (!_hasMore.inventory || !_cursor.inventory) return;
  try {
    const s = await getDocs(query(
      collection(db,'inventory'),
      orderBy('productName','asc'),
      startAfter(_cursor.inventory),
      limit(PAGE_SIZE.inventory)
    ));
    const newDocs = s.docs.map(d => ({id:d.id,...d.data()}));
    inventory = inventory.concat(newDocs);
    _cursor.inventory = s.docs[s.docs.length - 1] || null;
    _hasMore.inventory = s.docs.length === PAGE_SIZE.inventory;
    if (typeof window.renderInventory === 'function') window.renderInventory();
    updateLoadMoreButton('inventory', _hasMore.inventory);
  } catch(e) {
    console.error('loadMoreInventory:', e);
  }
}

async function loadMoreCashRegisters() {
  if (!_hasMore.cashRegisters || !_cursor.cashRegisters) return;
  try {
    const s = await getDocs(query(
      collection(db,'cashRegisters'),
      orderBy('createdAt','desc'),
      startAfter(_cursor.cashRegisters),
      limit(PAGE_SIZE.cashRegisters)
    ));
    const newDocs = s.docs.map(d => ({id:d.id,...d.data()}));
    cashRegisters = cashRegisters.concat(newDocs);
    _cursor.cashRegisters = s.docs[s.docs.length - 1] || null;
    _hasMore.cashRegisters = s.docs.length === PAGE_SIZE.cashRegisters;
    if (typeof window.renderCashRegisters === 'function') window.renderCashRegisters();
    updateLoadMoreButton('cashRegisters', _hasMore.cashRegisters);
  } catch(e) {
    console.error('loadMoreCashRegisters:', e);
  }
}

async function loadMoreShifts() {
  if (!_hasMore.shifts || !_cursor.shifts) return;
  try {
    const s = await getDocs(query(
      collection(db,'shifts'),
      orderBy('startedAt','desc'),
      startAfter(_cursor.shifts),
      limit(PAGE_SIZE.shifts)
    ));
    const newDocs = s.docs.map(d => ({id:d.id,...d.data()}));
    shiftsAll = shiftsAll.concat(newDocs);
    _cursor.shifts = s.docs[s.docs.length - 1] || null;
    _hasMore.shifts = s.docs.length === PAGE_SIZE.shifts;
    if (typeof window.renderShifts === 'function') window.renderShifts();
    updateLoadMoreButton('shifts', _hasMore.shifts);
  } catch(e) {
    console.error('loadMoreShifts:', e);
  }
}

async function loadMoreAudit() {
  if (!_hasMore.auditLogs || !_cursor.auditLogs) return;
  try {
    const s = await getDocs(query(
      collection(db,'auditLog'),
      orderBy('timestamp','desc'),
      startAfter(_cursor.auditLogs),
      limit(PAGE_SIZE.auditLogs)
    ));
    const newDocs = s.docs.map(d => ({id:d.id,...d.data()}));
    auditLogs = auditLogs.concat(newDocs);
    _cursor.auditLogs = s.docs[s.docs.length - 1] || null;
    _hasMore.auditLogs = s.docs.length === PAGE_SIZE.auditLogs;
    if (typeof window.renderAudit === 'function') window.renderAudit();
    updateLoadMoreButton('auditLogs', _hasMore.auditLogs);
  } catch(e) {
    console.error('loadMoreAudit:', e);
  }
}

function updateLoadMoreButton(key, hasMore) {
  const btn = document.getElementById(`load-more-${key}`);
  const endMsg = document.getElementById(`load-more-end-${key}`);
  if (btn) {
    if (hasMore) {
      btn.classList.remove('hidden');
      btn.disabled = false;
      btn.innerText = '⬇️ Cargar más (100 más)';
    } else {
      btn.classList.add('hidden');
    }
  }
  if (endMsg) {
    if (!hasMore) endMsg.classList.remove('hidden');
    else endMsg.classList.add('hidden');
  }
}
// ===== CONTABILIDAD (gastos, proveedores, settings) =====
async function ensureAccountingLoaded() {
  if (_loaded.expenses && _loaded.suppliers && _loaded.accountingSettings) return;
  const C = window.SmartecCache;

  await Promise.all([
    !_loaded.expenses ? C.wrap('expenses_all', async () => {
      const s = await getDocs(collection(db,'expenses'));
      return s.docs.map(d => ({id:d.id,...d.data()}));
    }).then(v => { expensesAll = v; _loaded.expenses = true; }) : Promise.resolve(),

    !_loaded.suppliers ? C.wrap('suppliers_all', async () => {
      const s = await getDocs(collection(db,'suppliers'));
      return s.docs.map(d => ({id:d.id,...d.data()}));
    }).then(v => { suppliers = v; _loaded.suppliers = true; }) : Promise.resolve(),

    !_loaded.accountingSettings ? C.wrap('accounting_settings', async () => {
      const s = await getDoc(doc(db,'settings','accounting'));
      return s.exists() ? s.data() : {};
    }).then(v => {
      accountingSettings = {
        defaultTermsDays: Number(v.defaultTermsDays ?? 30),
        defaultAlertDays: Number(v.defaultAlertDays ?? 5)
      };
      _loaded.accountingSettings = true;
    }) : Promise.resolve()
  ]);
}

// ===== CONFIGURACIÓN (canales + plataformas) =====
async function ensureSettingsDataLoaded() {
  if (_loaded.paymentChannels && _loaded.paymentPlatforms) return;
  const C = window.SmartecCache;

  await Promise.all([
    !_loaded.paymentChannels ? C.wrap('paymentChannels', async () => {
      const s = await getDocs(collection(db,'paymentChannels'));
      return s.docs.map(d => ({id:d.id,...d.data()}));
    }).then(v => { paymentChannels = v; _loaded.paymentChannels = true; }) : Promise.resolve(),

    !_loaded.paymentPlatforms ? C.wrap('paymentPlatforms', async () => {
      const s = await getDocs(collection(db,'paymentPlatforms'));
      return s.docs.map(d => ({id:d.id,...d.data()}));
    }).then(v => { paymentPlatforms = v; _loaded.paymentPlatforms = true; }) : Promise.resolve()
  ]);
}

// ===== PREFETCH INTELIGENTE (idle time) =====
function prefetchCommons() {
  console.log('[Lazy] Prefetch en background iniciado');
  // Precargar en background las 3 secciones más usadas
  Promise.all([
    ensureAccountingLoaded(),
    // Auditoría NO se precarga (es pesada)
    // Configuración NO se precarga (poco uso)
  ]).then(() => {
    console.log('[Lazy] Prefetch completado');
  }).catch(e => console.warn('[Lazy] Prefetch error:', e));
}

/* Fallback para navegadores sin requestIdleCallback */
if (typeof window.requestIdleCallback !== 'function') {
  window.requestIdleCallback = (cb) => setTimeout(cb, 2000);
}
/* ============================================================
   DASHBOARD
============================================================ */
/* ============================================================
   DASHBOARD SÚPER
============================================================ */
let dashCharts = { sales: null, methods: null };

/* ============ Filtros ============ */
window.dashFilters = {
  period: 'month',
  dateFrom: null,
  dateTo: null,
  storeId: 'all',
  sellerUid: 'all'
};

function getDashDateRange() {
  const now = new Date();
  const f = window.dashFilters;

  if (f.period === 'custom' && f.dateFrom && f.dateTo) {
    return {
      from: new Date(f.dateFrom + 'T00:00:00'),
      to: new Date(f.dateTo + 'T23:59:59'),
      prevFrom: (() => {
        const d = new Date(f.dateFrom + 'T00:00:00');
        const days = Math.ceil((new Date(f.dateTo + 'T23:59:59') - d) / 86400000);
        d.setDate(d.getDate() - days);
        return d;
      })(),
      prevTo: (() => {
        const d = new Date(f.dateFrom + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        d.setHours(23, 59, 59);
        return d;
      })(),
      label: `${f.dateFrom} → ${f.dateTo}`
    };
  }

  const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay = d => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

  switch (f.period) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now), prevFrom: startOfDay(new Date(now.getTime() - 86400000)), prevTo: endOfDay(new Date(now.getTime() - 86400000)), label: 'Hoy' };
    case 'yesterday': {
      const y = new Date(now.getTime() - 86400000);
      const py = new Date(now.getTime() - 2 * 86400000);
      return { from: startOfDay(y), to: endOfDay(y), prevFrom: startOfDay(py), prevTo: endOfDay(py), label: 'Ayer' };
    }
    case 'week': {
      const day = now.getDay() || 7;
      const start = new Date(now); start.setDate(now.getDate() - day + 1); start.setHours(0,0,0,0);
      const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
      const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd.setHours(23,59,59,999);
      return { from: start, to: endOfDay(now), prevFrom: prevStart, prevTo: prevEnd, label: 'Esta semana' };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0); prevEnd.setHours(23,59,59,999);
      return { from: start, to: endOfDay(now), prevFrom: prevStart, prevTo: prevEnd, label: 'Este mes' };
    }
    case 'lastmonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0); end.setHours(23,59,59,999);
      const pStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const pEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0); pEnd.setHours(23,59,59,999);
      return { from: start, to: end, prevFrom: pStart, prevTo: pEnd, label: 'Mes pasado' };
    }
    case 'year':
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now), prevFrom: new Date(now.getFullYear() - 1, 0, 1), prevTo: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59), label: 'Este año' };
    case 'all':
    default:
      return { from: null, to: null, prevFrom: null, prevTo: null, label: 'Todo el histórico' };
  }
}

function getDashSalesFiltered() {
  const range = getDashDateRange();
  const f = window.dashFilters;
  let list = sales.filter(s => s.status !== 'anulada');

  if (range.from) list = list.filter(s => s.createdAt?.seconds && new Date(s.createdAt.seconds * 1000) >= range.from);
  if (range.to) list = list.filter(s => s.createdAt?.seconds && new Date(s.createdAt.seconds * 1000) <= range.to);

  if (f.storeId !== 'all') {
    if (f.storeId === 'active') {
      const activeIds = stores.filter(s => s.active).map(s => s.storeId);
      list = list.filter(s => activeIds.includes(s.storeId));
    } else {
      list = list.filter(s => s.storeId === f.storeId);
    }
  }
  if (f.sellerUid !== 'all') list = list.filter(s => s.sellerUid === f.sellerUid);

  return { list, range };
}

function getPrevSalesFiltered() {
  const range = getDashDateRange();
  if (!range.prevFrom || !range.prevTo) return [];
  const f = window.dashFilters;
  let list = sales.filter(s => s.status !== 'anulada');
  list = list.filter(s => s.createdAt?.seconds && new Date(s.createdAt.seconds * 1000) >= range.prevFrom && new Date(s.createdAt.seconds * 1000) <= range.prevTo);

  if (f.storeId !== 'all') {
    if (f.storeId === 'active') {
      const activeIds = stores.filter(s => s.active).map(s => s.storeId);
      list = list.filter(s => activeIds.includes(s.storeId));
    } else {
      list = list.filter(s => s.storeId === f.storeId);
    }
  }
  if (f.sellerUid !== 'all') list = list.filter(s => s.sellerUid === f.sellerUid);
  return list;
}

function computeDashKPIs(salesList) {
  let salesTotal = 0, costTotal = 0, count = 0, units = 0;
  let pool = 0, bonus = 0, collected = 0, pending = 0, pendingCount = 0;

  salesList.forEach(s => {
    const sub = Number(s.subtotal || 0);
    const disc = Number(s.discount || 0);
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (sub - disc);
    salesTotal += base;

    const sCost = Number(s.totalCost) > 0
      ? Number(s.totalCost)
      : (s.items || []).reduce((sum, it) => sum + Number(it.unitCost || 0) * Number(it.qty || 0), 0);
    costTotal += sCost;
    count++;
    units += (s.items || []).reduce((y, i) => y + Number(i.qty || 0), 0);
    pool += Number(s.poolAmount || s.commissionAmount || 0);
    bonus += Number(s.bonusAmount || 0);

    const ps = s.paymentStatus || 'completed';
    if (ps === 'pending') { pending += base; pendingCount++; }
    else { collected += base; }
  });

  return {
    sales: salesTotal, cost: costTotal, profit: salesTotal - costTotal,
    count, units, pool, bonus, commission: pool + bonus,
    collected, pending, pendingCount,
    ticket: count > 0 ? salesTotal / count : 0
  };
}

function pctChange(curr, prev) {
  if (prev === 0 && curr === 0) return { pct: 0, arrow: '→', cls: 'text-gray-400' };
  if (prev === 0) return { pct: 100, arrow: '↗', cls: 'text-green-600' };
  const p = ((curr - prev) / prev) * 100;
  const arrow = p > 0 ? '↗' : p < 0 ? '↘' : '→';
  const cls = p > 0 ? 'text-green-600' : p < 0 ? 'text-red-600' : 'text-gray-400';
  return { pct: p, arrow, cls };
}

/* ============ Render principal ============ */
function renderDashboard() {
  // Sincronizar filtros
  const periodSel = $('dash-period');
  const storeSel = $('dash-store-filter');
  const sellerSel = $('dash-seller-filter');

  if (periodSel) window.dashFilters.period = periodSel.value;
  if (storeSel) window.dashFilters.storeId = storeSel.value;
  if (sellerSel) window.dashFilters.sellerUid = sellerSel.value;
  if (window.dashFilters.period === 'custom') {
    const df = $('dash-date-from'); const dt = $('dash-date-to');
    if (df && dt && df.value && dt.value) {
      window.dashFilters.dateFrom = df.value;
      window.dashFilters.dateTo = dt.value;
    }
  }

  // Poblar selects (una sola vez)
  populateDashFilters();

  const { list: salesPeriod, range } = getDashSalesFiltered();
  const salesPrev = getPrevSalesFiltered();
  const kpi = computeDashKPIs(salesPeriod);
  const kpiPrev = computeDashKPIs(salesPrev);

  // Info del rango
  const rangeInfo = $('dash-range-info');
  if (rangeInfo) {
    const fmtD = d => d ? d.toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';
    rangeInfo.innerText = `📅 Mostrando: ${range.label} · ${range.from ? fmtD(range.from) + ' → ' + fmtD(range.to) : 'todos los datos'} · ${salesPeriod.length} ventas`;
  }

  // ============================================================
  // KPIs
  // ============================================================
  const setTxt = (id, v) => { const el = $(id); if (el) el.innerText = v; };
  const setTrend = (id, curr, prev) => {
    const el = $(id);
    if (!el) return;
    const t = pctChange(curr, prev);
    el.innerText = `${t.arrow} ${Math.abs(t.pct).toFixed(1)}%`;
    el.className = `text-[10px] font-bold ${t.cls}`;
  };

  setTxt('dash-kpi-sales', fmt(kpi.sales));
  setTxt('dash-kpi-sales-prev', `vs período anterior: ${fmt(kpiPrev.sales)}`);
  setTrend('dash-kpi-sales-trend', kpi.sales, kpiPrev.sales);

  setTxt('dash-kpi-count', kpi.count);
  setTxt('dash-kpi-count-prev', `vs período anterior: ${kpiPrev.count}`);
  setTrend('dash-kpi-count-trend', kpi.count, kpiPrev.count);

  setTxt('dash-kpi-ticket', fmt(kpi.ticket));
  setTxt('dash-kpi-ticket-prev', `vs período anterior: ${fmt(kpiPrev.ticket)}`);
  setTrend('dash-kpi-ticket-trend', kpi.ticket, kpiPrev.ticket);

  setTxt('dash-kpi-units-sold', kpi.units.toLocaleString('es-CO'));
  setTxt('dash-kpi-units-prev', `vs período anterior: ${kpiPrev.units}`);
  setTrend('dash-kpi-units-trend', kpi.units, kpiPrev.units);

  setTxt('dash-kpi-profit', fmt(kpi.profit));
  setTxt('dash-kpi-profit-margin', `Margen ${kpi.sales > 0 ? ((kpi.profit/kpi.sales)*100).toFixed(1) : 0}%`);
  setTrend('dash-kpi-profit-trend', kpi.profit, kpiPrev.profit);

  setTxt('dash-kpi-commission', fmt(kpi.commission));
  setTxt('dash-kpi-pool', fmt(kpi.pool));
  setTxt('dash-kpi-bonus', fmt(kpi.bonus));

  setTxt('dash-kpi-collected', fmt(kpi.collected));
  setTxt('dash-kpi-collected-pct', `${kpi.sales > 0 ? ((kpi.collected/kpi.sales)*100).toFixed(1) : 0}% del total`);

  setTxt('dash-kpi-pending', fmt(kpi.pending));
  setTxt('dash-kpi-pending-pct', kpi.pendingCount > 0
    ? `${kpi.sales > 0 ? ((kpi.pending/kpi.sales)*100).toFixed(1) : 0}% · ${kpi.pendingCount} venta${kpi.pendingCount !== 1 ? 's' : ''}`
    : 'Sin pendientes');

  // ============================================================
  // Inventario KPIs
  // ============================================================
  let invFiltered = inventory.slice();
  if (window.dashFilters.storeId !== 'all' && window.dashFilters.storeId !== 'active') {
    invFiltered = invFiltered.filter(i => i.storeId === window.dashFilters.storeId);
  } else if (window.dashFilters.storeId === 'active') {
    const activeIds = stores.filter(s => s.active).map(s => s.storeId);
    invFiltered = invFiltered.filter(i => activeIds.includes(i.storeId));
  }

  let invCost = 0, invPrice = 0, unitsStock = 0;
  invFiltered.forEach(i => {
    const p = products.find(x => x.id === i.productId);
    if (!p) return;
    const cost = Number(p.cost || 0);
    const price = (p.onSale && p.salePrice) ? Number(p.salePrice) : Number(p.price || 0);
    const st = Number(i.stock || 0);
    invCost += cost * st;
    invPrice += price * st;
    unitsStock += st;
  });
  setTxt('kpi-inv-cost', fmt(invCost));
  setTxt('kpi-inv-price', fmt(invPrice));
  setTxt('kpi-margin', fmt(invPrice - invCost));
  setTxt('kpi-units', unitsStock.toLocaleString('es-CO'));

  // ============================================================
  // Stock bajo
  // ============================================================
  const low = invFiltered.filter(i => Number(i.stock||0) <= Number(i.minStock||settings.minStock||5));
  const ul = $('low-stock-list');
  if (ul) {
    ul.innerHTML = low.length ? low.slice(0, 30).map(i => {
      const store = stores.find(s => s.storeId === i.storeId);
      const color = i.colorName ? ' · ' + i.colorName : '';
      const size = i.size ? ' · ' + i.size : '';
      return `<li class="flex justify-between border-b border-gray-100 pb-1 last:border-0">
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-medium text-sd">${escapeHtml(i.productName)}</p>
          <p class="text-[10px] text-gray-400">${escapeHtml(store?.name||i.storeId)} · ${escapeHtml(i.sku)}${color}${size}</p>
        </div>
        <span class="${Number(i.stock)===0?'text-red-600 font-bold':'text-orange-500 font-bold'} text-xs whitespace-nowrap ml-2">${i.stock} und</span>
      </li>`;
    }).join('') : '<li class="text-gray-400 text-xs text-center py-4">🎉 Sin alertas de stock</li>';
  }

  // ============================================================
  // Top tiendas
  // ============================================================
  renderDashTopStores(salesPeriod);
  renderDashTopSellers(salesPeriod);

  // ============================================================
  // Gráficos
  // ============================================================
  renderDashCharts(salesPeriod);

  // ============================================================
  // Alertas inteligentes
  // ============================================================
  renderDashAlerts(invFiltered, salesPeriod);

  // ============================================================
  // Actividad reciente
  // ============================================================
  renderDashRecentActivity();

  // ============================================================
  // Desempeño por tienda (versión compacta)
  // ============================================================
  renderDashStorePerformance(salesPeriod);
}

/* ============ Poblar filtros ============ */
function populateDashFilters() {
  const storeSel = $('dash-store-filter');
  if (storeSel && !storeSel.dataset.loaded) {
    storeSel.dataset.loaded = '1';
    const opts = stores.map(s => `<option value="${s.storeId}">${escapeHtml(s.name)}${!s.active?' (inactiva)':''}</option>`).join('');
    storeSel.innerHTML = `<option value="all">Todas las tiendas</option><option value="active">Solo tiendas activas</option>${opts}`;
    storeSel.onchange = renderDashboard;
  }

  const sellerSel = $('dash-seller-filter');
  if (sellerSel && !sellerSel.dataset.loaded) {
    sellerSel.dataset.loaded = '1';
    const sellers = users.filter(u => ['vendedor','admin','superadmin'].includes(u.role));
    sellerSel.innerHTML = '<option value="all">Todos los vendedores</option>' +
      sellers.map(u => `<option value="${u.id}">${escapeHtml(u.name || u.email)}</option>`).join('');
    sellerSel.onchange = renderDashboard;
  }

  const periodSel = $('dash-period');
  if (periodSel && !periodSel.dataset.loaded) {
    periodSel.dataset.loaded = '1';
    periodSel.onchange = () => {
      const custom = $('dash-custom-range');
      if (periodSel.value === 'custom') custom.classList.remove('hidden');
      else custom.classList.add('hidden');
      renderDashboard();
    };
  }

  ['dash-date-from','dash-date-to'].forEach(id => {
    const el = $(id);
    if (el && !el.dataset.loaded) {
      el.dataset.loaded = '1';
      el.onchange = renderDashboard;
    }
  });
}

/* ============ Top tiendas ============ */
function renderDashTopStores(salesList) {
  const el = $('dash-top-stores');
  const empty = $('dash-top-stores-empty');
  const count = $('dash-top-stores-count');
  if (!el) return;

  const byStore = {};
  salesList.forEach(s => {
    const k = s.storeId;
    if (!byStore[k]) byStore[k] = { sales:0, count:0, profit:0 };
    const sub = Number(s.subtotal || 0);
    const disc = Number(s.discount || 0);
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (sub - disc);
    byStore[k].sales += base;
    byStore[k].count += 1;
    byStore[k].profit += Number(s.profit || 0);
  });

  const list = Object.entries(byStore)
    .map(([sid, v]) => ({ storeId: sid, ...v, name: stores.find(s => s.storeId === sid)?.name || sid }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 8);

  if (count) count.innerText = `${list.length} tienda${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    el.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  const max = list[0].sales || 1;
  el.innerHTML = list.map((v, i) => {
    const pct = (v.sales / max) * 100;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    return `
      <div>
        <div class="flex justify-between items-baseline mb-1">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-sd truncate">${medal} ${escapeHtml(v.name)}</p>
            <p class="text-[10px] text-gray-400">${v.count} venta${v.count !== 1 ? 's' : ''} · ${fmt(v.profit)} utilidad</p>
          </div>
          <p class="text-xs font-bold text-sl ml-2 whitespace-nowrap">${fmt(v.sales)}</p>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-1.5">
          <div class="h-1.5 rounded-full bg-gradient-to-r from-sl to-blue-400" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

/* ============ Top vendedores ============ */
function renderDashTopSellers(salesList) {
  const el = $('dash-top-sellers');
  const empty = $('dash-top-sellers-empty');
  const count = $('dash-top-sellers-count');
  if (!el) return;

  const bySeller = {};
  salesList.forEach(s => {
    const k = s.sellerUid || s.sellerEmail || 'unknown';
    if (!bySeller[k]) bySeller[k] = { name: s.sellerName || s.sellerEmail || '—', sales:0, count:0, commission:0 };
    const sub = Number(s.subtotal || 0);
    const disc = Number(s.discount || 0);
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (sub - disc);
    bySeller[k].sales += base;
    bySeller[k].count += 1;
    bySeller[k].commission += Number(s.sellerCommissionAmount || 0);
  });

  const list = Object.values(bySeller).sort((a, b) => b.sales - a.sales).slice(0, 8);
  if (count) count.innerText = `${list.length} vendedor${list.length !== 1 ? 'es' : ''}`;

  if (!list.length) {
    el.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  const max = list[0].sales || 1;
  el.innerHTML = list.map((v, i) => {
    const pct = (v.sales / max) * 100;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    return `
      <div>
        <div class="flex justify-between items-baseline mb-1">
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-sd truncate">${medal} ${escapeHtml(v.name)}</p>
            <p class="text-[10px] text-gray-400">${v.count} venta${v.count !== 1 ? 's' : ''} · ${fmt(v.commission)} comisión</p>
          </div>
          <p class="text-xs font-bold text-sl ml-2 whitespace-nowrap">${fmt(v.sales)}</p>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-1.5">
          <div class="h-1.5 rounded-full bg-gradient-to-r from-purple-400 to-purple-600" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

/* ============ Gráficos ============ */
function renderDashCharts(salesList) {
  if (typeof Chart === 'undefined') return;

  // Destruir previos
  Object.values(dashCharts).forEach(c => { if (c) c.destroy(); });
  dashCharts = { sales: null, methods: null };

  // ========== Gráfico 1: Ventas últimos 30 días ==========
  const canvasSales = $('dash-chart-sales');
  const emptySales = $('dash-chart-sales-empty');
  if (canvasSales && canvasSales.offsetParent !== null) {
    // Traer los últimos 30 días del histórico completo (no solo del filtro)
    const now = new Date();
    const start30 = new Date(now); start30.setDate(start30.getDate() - 29); start30.setHours(0,0,0,0);

    let baseList = sales.filter(s => s.status !== 'anulada' && s.createdAt?.seconds);
    baseList = baseList.filter(s => new Date(s.createdAt.seconds * 1000) >= start30);
    if (window.dashFilters.storeId !== 'all') {
      if (window.dashFilters.storeId === 'active') {
        const activeIds = stores.filter(s => s.active).map(s => s.storeId);
        baseList = baseList.filter(s => activeIds.includes(s.storeId));
      } else {
        baseList = baseList.filter(s => s.storeId === window.dashFilters.storeId);
      }
    }
    if (window.dashFilters.sellerUid !== 'all') baseList = baseList.filter(s => s.sellerUid === window.dashFilters.sellerUid);

    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      days.push(d);
    }

    const values = days.map(day => {
      const dayEnd = new Date(day); dayEnd.setHours(23,59,59,999);
      return baseList.reduce((sum, s) => {
        const sd = new Date(s.createdAt.seconds * 1000);
        if (sd >= day && sd <= dayEnd) {
          const sub = Number(s.subtotal || 0);
          const disc = Number(s.discount || 0);
          return sum + ((s.commissionBase !== undefined) ? Number(s.commissionBase) : (sub - disc));
        }
        return sum;
      }, 0);
    });

    const labels = days.map(d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`);

    if (values.every(v => v === 0)) {
      if (emptySales) emptySales.classList.remove('hidden');
    } else {
      if (emptySales) emptySales.classList.add('hidden');
      dashCharts.sales = new Chart(canvasSales, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Ventas ($)',
            data: values,
            borderColor: '#4A7A9A',
            backgroundColor: 'rgba(74,122,154,0.15)',
            tension: 0.35,
            fill: true,
            pointBackgroundColor: '#0A2A4A',
            pointRadius: 3,
            pointHoverRadius: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => '$' + Number(ctx.parsed.y).toLocaleString('es-CO')
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { callback: (v) => '$' + (v/1000).toFixed(0) + 'k' }
            }
          }
        }
      });
    }
  }

  // ========== Gráfico 2: Por método de pago ==========
  const canvasMethods = $('dash-chart-methods');
  const emptyMethods = $('dash-chart-methods-empty');
  if (canvasMethods && canvasMethods.offsetParent !== null) {
    const byMethod = {};
    salesList.forEach(s => {
      // 🆕 Si la venta tiene paymentBreakdown, cada pago va a su método
      if (Array.isArray(s.paymentBreakdown) && s.paymentBreakdown.length) {
        s.paymentBreakdown.forEach(p => {
          const m = p.method || 'efectivo';
          byMethod[m] = (byMethod[m] || 0) + Number(p.amount || 0);
        });
        return;
      }

      // Compatibilidad: venta normal
      const m = s.paymentMethod || 'efectivo';
      const sub = Number(s.subtotal || 0);
      const disc = Number(s.discount || 0);
      const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (sub - disc);
      byMethod[m] = (byMethod[m] || 0) + base;
    });

    const labelsMap = {
      efectivo: '💵 Efectivo',
      transferencia: '🔄 Transferencia',
      tarjeta: '💳 Tarjeta',
      contraentrega: '📦 Contra entrega',
      credito: '🛍️ Crédito',
      nequi: '📱 Nequi'
    };

    const entries = Object.entries(byMethod).sort((a,b) => b[1] - a[1]);
    if (!entries.length) {
      if (emptyMethods) emptyMethods.classList.remove('hidden');
    } else {
      if (emptyMethods) emptyMethods.classList.add('hidden');
      const palette = ['#22c55e','#3b82f6','#a855f7','#f97316','#eab308','#06b6d4','#ef4444','#ec4899'];
      dashCharts.methods = new Chart(canvasMethods, {
        type: 'doughnut',
        data: {
          labels: entries.map(([k]) => labelsMap[k] || k),
          datasets: [{
            data: entries.map(([,v]) => v),
            backgroundColor: palette.slice(0, entries.length),
            borderWidth: 2,
            borderColor: '#fff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { font: { size: 10 }, padding: 8, boxWidth: 12 }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
                  const pct = total > 0 ? (ctx.parsed / total) * 100 : 0;
                  return `${ctx.label}: $${Number(ctx.parsed).toLocaleString('es-CO')} (${pct.toFixed(1)}%)`;
                }
              }
            }
          }
        }
      });
    }
  }
}

/* ============ Alertas inteligentes ============ */
function renderDashAlerts(invFiltered, salesPeriod) {
  const listEl = $('dash-alerts-list');
  const emptyEl = $('dash-alerts-empty');
  const countEl = $('dash-alerts-count');
  if (!listEl) return;

  const alerts = [];

  // 1. Stock bajo / agotado
  const lowStock = invFiltered.filter(i => Number(i.stock||0) <= Number(i.minStock||settings.minStock||5));
  const zeroStock = lowStock.filter(i => Number(i.stock||0) === 0);
  if (zeroStock.length > 0) {
    alerts.push({
      icon: '🔴', color: 'red',
      title: `${zeroStock.length} producto${zeroStock.length !== 1 ? 's' : ''} agotado${zeroStock.length !== 1 ? 's' : ''}`,
      detail: zeroStock.slice(0, 3).map(i => i.productName).join(', ') + (zeroStock.length > 3 ? `… +${zeroStock.length - 3}` : ''),
      tab: 'inventory'
    });
  }
  const lowOnly = lowStock.filter(i => Number(i.stock||0) > 0);
  if (lowOnly.length > 0) {
    alerts.push({
      icon: '🟠', color: 'orange',
      title: `${lowOnly.length} producto${lowOnly.length !== 1 ? 's' : ''} con stock bajo`,
      detail: lowOnly.slice(0, 3).map(i => i.productName).join(', ') + (lowOnly.length > 3 ? `… +${lowOnly.length - 3}` : ''),
      tab: 'inventory'
    });
  }

  // 2. Cobros pendientes
  const pendingSales = sales.filter(s => s.status !== 'anulada' && (s.paymentStatus || 'completed') === 'pending');
  if (pendingSales.length > 0) {
    const totalPending = pendingSales.reduce((sum, s) => {
      const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
      return sum + base;
    }, 0);
    alerts.push({
      icon: '⏳', color: 'amber',
      title: `${pendingSales.length} cobro${pendingSales.length !== 1 ? 's' : ''} pendiente${pendingSales.length !== 1 ? 's' : ''} · ${fmt(totalPending)}`,
      detail: 'Ventas contra entrega u otras sin confirmar',
      tab: 'reports'
    });
  }

  // 3. Arqueos pendientes
  const pendingArqueos = cashRegisters.filter(a => a.status === 'pending_approval');
  if (pendingArqueos.length > 0) {
    alerts.push({
      icon: '🌅', color: 'blue',
      title: `${pendingArqueos.length} arqueo${pendingArqueos.length !== 1 ? 's' : ''} por aprobar`,
      detail: 'Requieren revisión del superadmin',
      tab: 'cashregisters'
    });
  }

  // 4. Solicitudes pendientes
  const pendingT = (transferRequestsAll || []).filter(r => r.status === 'pendiente').length;
  const pendingD = (deviceRequestsAll || []).filter(r => r.status === 'pendiente').length;
  const pendingA = (deviceAttemptsAll || []).filter(r => r.status !== 'resuelto').length;
  const totalSolicitudes = pendingT + pendingD + pendingA;
  if (totalSolicitudes > 0) {
    alerts.push({
      icon: '📤', color: 'purple',
      title: `${totalSolicitudes} solicitud${totalSolicitudes !== 1 ? 'es' : ''} pendiente${totalSolicitudes !== 1 ? 's' : ''}`,
      detail: `${pendingT} traslados · ${pendingD} dispositivos · ${pendingA} intentos`,
      tab: 'transfers'
    });
  }

  // 5. Turnos abiertos > 12h
  const longShifts = (shiftsAll || []).filter(s => {
    if (s.status !== 'open' || !s.startedAt?.seconds) return false;
    const hours = (Date.now() - s.startedAt.seconds * 1000) / 3600000;
    return hours > 12;
  });
  if (longShifts.length > 0) {
    alerts.push({
      icon: '⏰', color: 'red',
      title: `${longShifts.length} turno${longShifts.length !== 1 ? 's' : ''} abierto${longShifts.length !== 1 ? 's' : ''} > 12h`,
      detail: longShifts.slice(0, 3).map(s => s.userName || s.userEmail).join(', '),
      tab: 'shifts'
    });
  }

  // 6. Productos sin movimiento (stock sin venderse en 60 días)
  const hace60 = new Date(); hace60.setDate(hace60.getDate() - 60);
  const productosVendidos = new Set();
  sales.forEach(s => {
    if (!s.createdAt?.seconds) return;
    if (new Date(s.createdAt.seconds * 1000) >= hace60) {
      (s.items || []).forEach(it => { if (it.productId) productosVendidos.add(it.productId); });
    }
  });
  const stockParado = inventory.filter(i => Number(i.stock || 0) > 0 && !productosVendidos.has(i.productId));
  if (stockParado.length > 5) {
    const unidadesParadas = stockParado.reduce((s, i) => s + Number(i.stock || 0), 0);
    alerts.push({
      icon: '🐌', color: 'gray',
      title: `${stockParado.length} SKU sin movimiento en 60 días`,
      detail: `${unidadesParadas} unidades paradas · Considera promocionarlas`,
      tab: 'inventory'
    });
  }

  // Render
  if (countEl) {
    if (alerts.length > 0) {
      countEl.classList.remove('hidden');
      countEl.innerText = alerts.length;
    } else {
      countEl.classList.add('hidden');
    }
  }

  if (!alerts.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  const colorMap = {
    red:    { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    icon: 'bg-red-100' },
    orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: 'bg-orange-100' },
    amber:  { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  icon: 'bg-amber-100' },
    blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   icon: 'bg-blue-100' },
    purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: 'bg-purple-100' },
    gray:   { bg: 'bg-gray-50',   border: 'border-gray-200',   text: 'text-gray-700',   icon: 'bg-gray-100' }
  };

  listEl.innerHTML = alerts.map(a => {
    const c = colorMap[a.color] || colorMap.gray;
    return `
      <div class="border ${c.border} ${c.bg} rounded-lg p-3 flex items-start gap-3 cursor-pointer hover:shadow transition"
           onclick="document.querySelector('[data-tab=${a.tab}]')?.click()">
        <div class="w-9 h-9 rounded-full ${c.icon} flex items-center justify-center shrink-0 text-lg">
          ${a.icon}
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-bold ${c.text}">${escapeHtml(a.title)}</p>
          <p class="text-[10px] text-gray-500 mt-0.5 truncate">${escapeHtml(a.detail)}</p>
        </div>
        <span class="text-gray-300 text-xs shrink-0">→</span>
      </div>
    `;
  }).join('');
}

/* ============ Actividad reciente ============ */
function renderDashRecentActivity() {
  const el = $('dash-recent-activity');
  if (!el) return;

  // Últimas 10 ventas + últimas 5 acciones de auditoría
  const recentSales = sales
    .filter(s => s.createdAt?.seconds)
    .sort((a, b) => (b.createdAt.seconds || 0) - (a.createdAt.seconds || 0))
    .slice(0, 10);

  const recentAudit = (auditLogs || [])
    .filter(a => a.timestamp?.seconds && a.action !== 'login' && a.action !== 'logout')
    .sort((a, b) => (b.timestamp.seconds || 0) - (a.timestamp.seconds || 0))
    .slice(0, 5);

  const combined = [];

  recentSales.forEach(s => {
    const store = stores.find(x => x.storeId === s.storeId);
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
    combined.push({
      when: s.createdAt.seconds,
      icon: s.status === 'anulada' ? '❌' : '💰',
      color: s.status === 'anulada' ? 'red' : 'green',
      title: `${s.customer?.name || 'Cliente'} compró ${fmt(base)}`,
      detail: `${store?.name || s.storeId} · ${s.sellerName || s.sellerEmail || '—'}`,
      onClick: `viewSale('${s.id}')`
    });
  });

  recentAudit.forEach(a => {
    const icon = { create:'🆕', update:'✏️', delete:'🗑', sale:'💰', cancel:'📉', seed:'🌱', cleanup:'🧹' }[a.action] || '📋';
    combined.push({
      when: a.timestamp.seconds,
      icon,
      color: a.action === 'delete' ? 'red' : a.action === 'cancel' ? 'orange' : 'blue',
      title: a.note || a.changeSummary || `${a.action} en ${a.collection}`,
      detail: `${a.userName || a.userEmail || '—'} · ${fmtDate(a.timestamp)}`,
      onClick: `viewAudit('${a.id}')`
    });
  });

  combined.sort((a, b) => b.when - a.when);

  if (!combined.length) {
    el.innerHTML = '<p class="text-center text-gray-400 text-xs py-6">Sin actividad reciente</p>';
    return;
  }

  const colorMap = {
    green:  'bg-green-100 text-green-700',
    red:    'bg-red-100 text-red-700',
    orange: 'bg-orange-100 text-orange-700',
    blue:   'bg-blue-100 text-blue-700'
  };

  el.innerHTML = combined.slice(0, 15).map(a => {
    const cls = colorMap[a.color] || colorMap.blue;
    const timeAgo = (() => {
      const diff = Math.floor((Date.now() - a.when * 1000) / 1000);
      if (diff < 60) return `${diff}s`;
      if (diff < 3600) return `${Math.floor(diff/60)}min`;
      if (diff < 86400) return `${Math.floor(diff/3600)}h`;
      return `${Math.floor(diff/86400)}d`;
    })();
    return `
      <div class="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50 rounded px-1"
           onclick='${a.onClick}'>
        <div class="w-7 h-7 rounded-full ${cls} flex items-center justify-center shrink-0 text-xs">
          ${a.icon}
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs text-sd truncate">${escapeHtml(a.title)}</p>
          <p class="text-[10px] text-gray-400 truncate">${escapeHtml(a.detail)}</p>
        </div>
        <span class="text-[10px] text-gray-400 whitespace-nowrap shrink-0">${timeAgo}</span>
      </div>
    `;
  }).join('');
}

/* ============ Desempeño por tienda (compacto) ============ */
function renderDashStorePerformance(salesPeriod) {
  const perf = $('store-performance');
  if (!perf) return;

  if (currentUserData.role === 'admin') {
    perf.innerHTML = '<p class="text-gray-400 text-xs text-center py-4">Solo el superadmin ve el consolidado por tienda.</p>';
    return;
  }

  const storesToShow = window.dashFilters.storeId === 'active'
    ? stores.filter(s => s.active)
    : window.dashFilters.storeId === 'all'
      ? stores
      : stores.filter(s => s.storeId === window.dashFilters.storeId);

  if (!storesToShow.length) {
    perf.innerHTML = '<p class="text-gray-400 text-xs text-center py-4">Sin tiendas para mostrar.</p>';
    return;
  }

  perf.innerHTML = storesToShow.map(s => {
    const sSales = salesPeriod.filter(x => x.storeId === s.storeId);
    let total = 0, shippingTotal = 0, surchargeTotal = 0;
    sSales.forEach(x => {
      const sub = Number(x.subtotal || 0);
      const disc = Number(x.discount || 0);
      total += (x.commissionBase !== undefined) ? Number(x.commissionBase) : (sub - disc);
      shippingTotal += Number(x.shipping || 0);
      surchargeTotal += Number(x.surchargeAmount || 0);
    });
    const cnt = sSales.length;

    return `
      <div class="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-sd truncate">${escapeHtml(s.name)}</p>
          <p class="text-[10px] text-gray-400">${cnt} venta${cnt !== 1 ? 's' : ''} · Envíos ${fmt(shippingTotal)} · Recargos ${fmt(surchargeTotal)}</p>
        </div>
        <p class="text-xs font-bold text-sl ml-3 whitespace-nowrap">${fmt(total)}</p>
      </div>
    `;
  }).join('');
}

/* ESC cierra modales si aplica */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { /* ya manejado por otros modales */ }
});

/* ============================================================
   TIENDAS
============================================================ */
function renderStores() {
  const grid = $('stores-grid');
  const alertBox = $('goals-alert');

  if (!stores.length) {
    grid.innerHTML = '<p class="text-gray-400 col-span-full">Sin tiendas.</p>';
    alertBox.classList.add('hidden');
    return;
  }

  // ========== MES ACTUAL Y ANTERIOR ==========
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;

  // ========== META EFECTIVA POR TIENDA ==========
  // Prioridad: storeGoals del mes actual > storeGoals del mes anterior > stores.goalAmount
  const getEffectiveGoal = (storeId) => {
    const currentGoal = storeGoals.find(g => g.id === `${storeId}_${currentMonth}`);
    if (currentGoal) return { goalAmount: currentGoal.goalAmount || 0, bonusRate: currentGoal.bonusRate || 0, source: 'current' };

    const prevGoal = storeGoals.find(g => g.id === `${storeId}_${prevMonth}`);
    if (prevGoal) return { goalAmount: prevGoal.goalAmount || 0, bonusRate: prevGoal.bonusRate || 0, source: 'inherited' };

    const store = stores.find(s => s.storeId === storeId);
    return { goalAmount: store?.goalAmount || 0, bonusRate: store?.bonusRate || 0, source: 'default' };
  };

  // ========== BANNER DE ALERTA ==========
  const storesWithoutCurrentGoal = stores.filter(s => {
    if (!s.active) return false;
    return !storeGoals.find(g => g.id === `${s.storeId}_${currentMonth}`);
  });

  if (storesWithoutCurrentGoal.length > 0) {
    alertBox.classList.remove('hidden');
    alertBox.innerHTML = `
      <div class="bg-yellow-50 border-l-4 border-yellow-400 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div class="flex-1">
          <p class="font-semibold text-yellow-800 text-sm">⚠️ Metas sin configurar para ${currentMonth}</p>
          <p class="text-xs text-yellow-700 mt-1">
            Las siguientes tiendas usarán la meta heredada del mes anterior:
            <b>${storesWithoutCurrentGoal.map(s => s.name).join(', ')}</b>
          </p>
        </div>
        <button onclick="document.querySelector('[data-tab=stores]').click();" class="text-xs bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1.5 rounded font-semibold whitespace-nowrap">
          Entendido
        </button>
      </div>
    `;
  } else {
    alertBox.classList.add('hidden');
  }

  // ========== TARJETAS DE TIENDA ==========
  grid.innerHTML = stores.map(s => {
    const { goalAmount, bonusRate, source } = getEffectiveGoal(s.storeId);
    const hasGoal = goalAmount > 0;

    // Ventas del mes actual
    const monthSales = sales.filter(x =>
      x.storeId === s.storeId &&
      x.status !== 'anulada' &&
      x.createdAt?.seconds &&
      new Date(x.createdAt.seconds * 1000) >= new Date(now.getFullYear(), now.getMonth(), 1)
    ).reduce((sum, x) => sum + Number(x.total || 0), 0);

    const pct = hasGoal ? Math.min(100, (monthSales / goalAmount) * 100) : 0;
    const achieved = hasGoal && monthSales >= goalAmount;

    // Etiqueta de origen de la meta
    const sourceLabel = source === 'current' ? '' :
                       source === 'inherited' ? '<span class="text-[9px] text-orange-500 ml-1">(heredada)</span>' :
                       '<span class="text-[9px] text-gray-400 ml-1">(por defecto)</span>';

    return `
      <div class="bg-white p-5 rounded-xl shadow">
        <div class="flex justify-between items-start mb-3">
          <div>
            <p class="text-xs text-gray-400">${escapeHtml(s.storeId)}</p>
            <h3 class="text-lg font-bold text-sd">${escapeHtml(s.name)}</h3>
          </div>
          <span class="text-xs px-2 py-1 rounded ${s.active?'bg-green-100 text-green-700':'bg-gray-200 text-gray-600'}">
            ${s.active?'Activa':'Inactiva'}
          </span>
        </div>
        <div class="text-xs space-y-1 mb-4">
          ${s.address?`<p>📍 ${escapeHtml(s.address)}</p>`:''}
          ${s.phone?`<p>📞 ${escapeHtml(s.phone)}</p>`:''}
          ${s.email?`<p>✉️ ${escapeHtml(s.email)}</p>`:''}
          <p>💵 Comisión pool: <b>${((s.commissionRate||0)*100).toFixed(1)}%</b>
            ${(s.commissionMode || 'always') === 'goal'
              ? ' <span class="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">🎯 Por meta</span>'
              : ' <span class="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full font-semibold">💰 Siempre</span>'}
          </p>
          <p>🛡️ Margen arqueo: <b>${fmt(s.arqueoMargin||0)}</b></p>
          <p>🌇 Hora de cierre: <b>${s.closeHour || '20:00'}</b>
            ${s.alertCloseEnabled !== false
              ? `<span class="text-green-600">· alertas ON (${s.alertCloseMinutesBefore ?? 30} min antes)</span>`
              : `<span class="text-gray-400">· alertas OFF</span>`}
          </p>
        </div>
        ${hasGoal ? `
          <div class="border-t pt-3 mb-3">
            <div class="flex justify-between items-center mb-1">
              <p class="text-[11px] text-gray-500 font-semibold">🎯 META DEL MES ${sourceLabel}</p>
              <p class="text-[11px] ${achieved?'text-green-600 font-bold':'text-gray-500'}">${pct.toFixed(0)}%</p>
            </div>
            <div class="w-full bg-gray-100 rounded-full h-2 mb-2">
              <div class="h-2 rounded-full ${achieved?'bg-green-500':'bg-sl'}" style="width:${pct}%"></div>
            </div>
            <div class="flex justify-between text-[10px] text-gray-500">
              <span>${fmt(monthSales)}</span>
              <span>de ${fmt(goalAmount)}</span>
            </div>
            <p class="text-[10px] ${achieved?'text-green-600 font-bold':'text-gray-400'} mt-1">
              ${achieved?'✅ Meta cumplida':'Bonus admin: ' + (bonusRate*100).toFixed(1) + '%'}
            </p>
          </div>
        ` : '<p class="text-[10px] text-gray-300 border-t pt-3 mb-3">Sin meta asignada</p>'}
        <div class="flex gap-3 text-sm flex-wrap">
          <button onclick='editStore("${s.storeId}")' class="text-sl hover:underline">Editar</button>
          <button onclick='openStoreGoalModal("${s.storeId}")' class="text-orange-500 hover:underline">🎯 Meta del mes</button>
          <button onclick='toggleStore("${s.storeId}")' class="text-gray-500 hover:underline">${s.active?'Desactivar':'Activar'}</button>
        </div>
      </div>
    `;
  }).join('');
}

window.openStoreForm = (s = null) => {
  $('form-title').innerText = s ? 'Editar tienda' : 'Nueva tienda';

  const v = s
    ? { ...s, commissionMode: s.commissionMode || 'always' }   // tienda existente → default 'always'
    : {
        storeId: '', name: '', address: '', phone: '', email: '',
        commissionRate: 0, arqueoMargin: 0, goalAmount: 0, bonusRate: 0, active: true,
        commissionMode: 'goal'                                  // tienda nueva → default 'goal'
      };

  $('form-body').innerHTML = `
    <label class="text-xs font-semibold">ID de tienda (slug, sin espacios)</label>
    <input id="f-storeId" value="${v.storeId || ''}" ${s ? 'disabled' : ''} placeholder="tienda-ejemplo" class="w-full px-3 py-2 border rounded mb-3">

    <label class="text-xs font-semibold">Nombre</label>
    <input id="f-name" value="${v.name || ''}" class="w-full px-3 py-2 border rounded mb-3">

    <label class="text-xs font-semibold">Dirección</label>
    <input id="f-address" value="${v.address || ''}" class="w-full px-3 py-2 border rounded mb-3">

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold">Teléfono</label>
        <input id="f-phone" value="${v.phone || ''}" class="w-full px-3 py-2 border rounded">
      </div>
      <div>
        <label class="text-xs font-semibold">Email</label>
        <input id="f-email" value="${v.email || ''}" class="w-full px-3 py-2 border rounded">
      </div>
    </div>

    <!-- 🆕 Modo de comisión -->
    <div class="mb-3">
      <label class="text-xs font-semibold">Modo de comisión del pool</label>
      <select id="f-commissionMode" class="w-full px-3 py-2 border rounded mt-1">
        <option value="goal" ${((v.commissionMode || 'goal') === 'goal') ? 'selected' : ''}>
          🎯 Pool por meta mensual (solo sobre el excedente de la meta)
        </option>
        <option value="always" ${((v.commissionMode || 'goal') === 'always') ? 'selected' : ''}>
          💰 Pool siempre (sobre el 100% de la venta)
        </option>
      </select>
      <p class="text-[10px] text-gray-400 mt-1">
        <b>Pool por meta:</b> el vendedor solo gana pool cuando la tienda supera su meta mensual. Si la meta es 0, el pool aplica sobre todo.
        <br>
        <b>Pool siempre:</b> el vendedor gana pool desde la primera venta del mes, sin importar la meta.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold">Comisión pool (%)</label>
        <input id="f-commission" type="number" step="0.01" value="${((v.commissionRate || 0) * 100).toFixed(2)}" class="w-full px-3 py-2 border rounded">
        <p class="text-[10px] text-gray-400 mt-1">% que gana el vendedor por venta</p>
      </div>
      <div>
        <label class="text-xs font-semibold">Margen arqueo ($)</label>
        <input id="f-arqueoMargin" type="number" value="${v.arqueoMargin || 0}" class="w-full px-3 py-2 border rounded">
        <p class="text-[10px] text-gray-400 mt-1">Diferencia máxima sin bloquear</p>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold">Meta mensual por defecto ($)</label>
        <input id="f-goalAmount" type="number" value="${v.goalAmount || ''}" placeholder="200000000" class="w-full px-3 py-2 border rounded">
        <p class="text-[10px] text-gray-400 mt-1">0 = sin meta</p>
      </div>
      <div>
        <label class="text-xs font-semibold">Bonus admin al cumplir (%)</label>
        <input id="f-bonusRate" type="number" step="0.01" value="${((v.bonusRate || 0) * 100).toFixed(2)}" class="w-full px-3 py-2 border rounded">
        <p class="text-[10px] text-gray-400 mt-1">% extra para el admin si cumple meta</p>
      </div>
    </div>

    <div class="border-t pt-3 mt-3 mb-3">
      <p class="text-xs font-semibold text-sd mb-2">🌇 Cierre de caja y alertas</p>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="text-xs font-semibold">Hora de cierre</label>
          <input id="f-closeHour" type="time" value="${v.closeHour || '20:00'}" class="w-full px-3 py-2 border rounded">
          <p class="text-[10px] text-gray-400 mt-1">Hora oficial del cierre diario</p>
        </div>
        <div>
          <label class="text-xs font-semibold">Minutos antes para alertar</label>
          <input id="f-alertCloseMinutesBefore" type="number" min="0" max="180" value="${v.alertCloseMinutesBefore ?? 30}" class="w-full px-3 py-2 border rounded">
          <p class="text-[10px] text-gray-400 mt-1">Ej: 30 → aviso 30 min antes</p>
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-2 text-sm">
            <input id="f-alertCloseEnabled" type="checkbox" ${v.alertCloseEnabled !== false ? 'checked' : ''} class="w-4 h-4">
            <span>Alertas activas</span>
          </label>
        </div>
      </div>
    </div>

        <div class="border-t pt-3 mt-3 mb-3">
      <p class="text-xs font-semibold text-sd mb-2">⏱ Turnos y control de acceso</p>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="flex items-center gap-2 text-sm mb-2">
            <input id="f-shiftEnabled" type="checkbox" ${v.shiftEnabled !== false ? 'checked' : ''} class="w-4 h-4">
            <span>Activar control de turnos</span>
          </label>
          <p class="text-[10px] text-gray-400">Si está activo, los vendedores deben marcar entrada/salida.</p>
        </div>
        <div>
          <label class="text-xs font-semibold">Duración máxima de turno (horas)</label>
          <input id="f-shiftMaxHours" type="number" min="1" max="24" value="${v.shiftMaxHours ?? 12}" class="w-full px-3 py-2 border rounded">
          <p class="text-[10px] text-gray-400 mt-1">Genera alerta si un turno supera este tiempo.</p>
        </div>
      </div>
    </div>

    <label class="flex items-center gap-2 text-sm mb-3">
      <input id="f-active" type="checkbox" ${v.active !== false ? 'checked' : ''} class="w-4 h-4">
      Tienda activa
    </label>

    <button onclick="saveStore('${s ? s.storeId : ''}')" class="w-full bg-sd text-white py-2 rounded-lg hover:bg-sl font-semibold">Guardar cambios</button>
  `;

  openForm();
};

window.editStore = (id) => {
  console.log('🔍 Buscando tienda:', id);
  console.log('   Tiendas disponibles:', stores.map(x => x.storeId));

  const s = stores.find(x => x.storeId === id);
  if (!s) {
    alert('⛔ Tienda no encontrada');
    return;
  }

  console.log('📄 Datos de la tienda:', s);
  openStoreForm(s);
};

window.saveStore = async (existingId) => {
  const storeId = existingId || ($('f-storeId')?.value || '').trim().toLowerCase().replace(/\s+/g, '-');

  if (!storeId) return alert('El ID es obligatorio');
  if (!/^[a-z0-9-]+$/.test(storeId)) return alert('El ID solo puede tener letras minúsculas, números y guiones');

  const data = {
    storeId,
    name: $('f-name').value.trim(),
    address: $('f-address').value.trim(),
    phone: $('f-phone').value.trim(),
    email: $('f-email').value.trim(),
    commissionMode: $('f-commissionMode').value || 'always',
    commissionRate: (Number($('f-commission').value) || 0) / 100,
    arqueoMargin: Number($('f-arqueoMargin').value) || 0,
    goalAmount: Number($('f-goalAmount').value) || 0,
    bonusRate: (Number($('f-bonusRate').value) || 0) / 100,
    shiftEnabled: $('f-shiftEnabled').checked,
    shiftMaxHours: Number($('f-shiftMaxHours').value) || 12,
    closeHour: $('f-closeHour').value || '20:00',
    alertCloseMinutesBefore: Number($('f-alertCloseMinutesBefore').value) || 30,
    alertCloseEnabled: $('f-alertCloseEnabled').checked,
    active: $('f-active').checked,
    updatedAt: serverTimestamp()
  };

  if (!data.name) return alert('El nombre es obligatorio');

  const isNew = !existingId;
  const before = isNew ? null : stores.find(x => x.storeId === existingId);

  try {
    // ========== 1. Guardar tienda ==========
    const ref = doc(db, 'stores', storeId);
    if (isNew) {
      await setDoc(ref, { ...data, createdAt: serverTimestamp() });
    } else {
      await updateDoc(ref, data);
    }

    await audit({
      action: isNew ? 'create' : 'update',
      collection: 'stores',
      docId: storeId,
      before,
      after: data,
      note: `${isNew ? 'Creada' : 'Editada'} tienda ${data.name}`
    });

    // ========== 2. Sincronizar con storeGoals del mes actual ==========
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const goalDocId = `${storeId}_${currentMonth}`;
    const goalRef = doc(db,'storeGoals', goalDocId);
    const goalSnap = await getDoc(goalRef);

    let sincronizar = false;

    if (!goalSnap.exists()) {
      // No existe meta para el mes actual → crearla automáticamente con los valores base
      sincronizar = true;
      console.log('🎯 No había meta para el mes actual. Se creará con los valores base.');
    } else {
      // Ya existe una meta para este mes
      const existing = goalSnap.data();
      const sameGoal = Number(existing.goalAmount) === Number(data.goalAmount);
      const sameBonus = Number(existing.bonusRate) === Number(data.bonusRate);

      if (!sameGoal || !sameBonus) {
        // Preguntar si quiere sobrescribir la del mes
        const msg =
          `Ya existe una meta para ${currentMonth}:\n\n` +
          `Actual:   ${fmt(existing.goalAmount)} · Bonus ${((existing.bonusRate||0)*100).toFixed(2)}%\n` +
          `Nueva:    ${fmt(data.goalAmount)} · Bonus ${(data.bonusRate*100).toFixed(2)}%\n\n` +
          `¿Quieres actualizar también la meta del mes actual?`;
        sincronizar = confirm(msg);
      } else {
        console.log('✅ Meta del mes ya coincide con la base. Sin cambios.');
      }
    }

    if (sincronizar) {
      const goalData = {
        storeId,
        month: currentMonth,
        goalAmount: data.goalAmount,
        bonusRate: data.bonusRate,
        updatedAt: serverTimestamp()
      };
      if (goalSnap.exists()) {
        await updateDoc(goalRef, goalData);
      } else {
        await setDoc(goalRef, { ...goalData, createdAt: serverTimestamp() });
      }

      await audit({
        action: goalSnap.exists() ? 'update' : 'create',
        collection: 'storeGoals',
        docId: goalDocId,
        after: goalData,
        note: `Meta sincronizada desde edición de tienda: ${fmt(data.goalAmount)} · Bonus ${(data.bonusRate*100).toFixed(2)}%`
      });
      console.log('✅ Meta del mes sincronizada');
    }

        // ========== NUEVO: Asegurar contadores de documentos ==========
    // Se crean los contadores de remisión, tirilla y media carta
    // para el año actual. Si ya existen, no se tocan.
    const year = new Date().getFullYear();
    const tiposDocumento = ['remision', 'tirilla', 'mediacarta'];

    for (const tipo of tiposDocumento) {
      const counterId = `${storeId}_${tipo}_${year}`;
      const counterRef = doc(db, 'counters', counterId);
      const counterSnap = await getDoc(counterRef);

      if (!counterSnap.exists()) {
        // Prefijo: primeras 3 letras de la tienda en mayúsculas + tipo corto
        const tipoShort = tipo === 'remision' ? 'REM'
                        : tipo === 'tirilla' ? 'TIR'
                        : 'MED';
        const prefix = storeId.slice(0, 3).toUpperCase() + '-' + tipoShort + '-' + year + '-';

        await setDoc(counterRef, {
          prefix,
          lastNumber: 0,
          type: tipo,
          storeId,
          year,
          createdAt: serverTimestamp()
        });

        console.log(`✅ Contador ${counterId} creado (prefix: ${prefix})`);

        await audit({
          action: 'create',
          collection: 'counters',
          docId: counterId,
          after: { prefix, lastNumber: 0, type: tipo, storeId, year },
          note: `Contador inicializado: ${tipo} ${year} (${prefix})`
        });
      } else {
        console.log(`ℹ️ Contador ${counterId} ya existe. Sin cambios.`);
      }
    }

    window.SmartecCache.invalidate('stores');

    // ========== 3. Cerrar y recargar ==========
    closeForm();
    await loadAll();
    alert('✅ Tienda guardada correctamente. Contadores de documentos listos.');

  } catch (e) {
    console.error('❌ Error en saveStore:', e);
    alert('Error al guardar: ' + e.message);
  }
};

window.toggleStore = async (storeId) => {
  const s = stores.find(x => x.storeId === storeId);
  if (!s) return;
  if (!confirm(`¿${s.active ? 'Desactivar' : 'Activar'} ${s.name}?`)) return;

  await updateDoc(doc(db, 'stores', storeId), {
    active: !s.active,
    updatedAt: serverTimestamp()
  });

  await audit({
    action: 'update',
    collection: 'stores',
    docId: storeId,
    note: `${s.active ? 'Desactivada' : 'Activada'}`
  });
  window.SmartecCache.invalidate('stores');
  await loadAll();
};
/* ============================================================
   META MENSUAL DE TIENDA (storeGoals)
============================================================ */
/* ============================================================
   META MENSUAL DE TIENDA (storeGoals)
============================================================ */
window.openStoreGoalModal = async (storeId) => {
  const store = stores.find(s => s.storeId === storeId);
  if (!store) return;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;

  $('goal-modal-subtitle').innerText = `${store.name} · ${currentMonth}`;

  // ========== CARGAR META CON HERENCIA ==========
  let existingGoal = null;
  let inheritedFrom = null;

  // 1. Buscar la del mes actual
  try {
    const snap = await getDoc(doc(db,'storeGoals',`${storeId}_${currentMonth}`));
    if (snap.exists()) {
      existingGoal = snap.data();
      console.log('✅ Meta actual encontrada:', existingGoal);
    }
  } catch(e) { console.warn('Error buscando meta actual:', e); }

  // 2. Si no existe, heredar del mes anterior
  if (!existingGoal) {
    try {
      const prevSnap = await getDoc(doc(db,'storeGoals',`${storeId}_${prevMonth}`));
      if (prevSnap.exists()) {
        existingGoal = prevSnap.data();
        inheritedFrom = prevMonth;
        console.log('🔄 Meta heredada de', prevMonth);
      }
    } catch(e) { console.warn('Error buscando meta anterior:', e); }
  }

  // 3. Valores finales (con fallback a la tienda)
  const goalAmount = Number(existingGoal?.goalAmount || store.goalAmount || 0);
  const bonusRate = Number(existingGoal?.bonusRate ?? store.bonusRate ?? 0);

  console.log('📊 Valores a mostrar → meta:', goalAmount, '· bonus:', bonusRate);

  // ========== VENTAS DEL MES ==========
  const monthSales = sales.filter(s =>
    s.storeId === storeId &&
    s.status !== 'anulada' &&
    s.createdAt?.seconds &&
    new Date(s.createdAt.seconds * 1000) >= new Date(now.getFullYear(), now.getMonth(), 1)
  ).reduce((sum, s) => sum + Number(s.total || 0), 0);

  const pct = goalAmount > 0 ? Math.min(100, (monthSales / goalAmount) * 100) : 0;
  const achieved = monthSales >= goalAmount && goalAmount > 0;

  // ========== RENDER ==========
  $('goal-modal-body').innerHTML = `
    ${inheritedFrom ? `
      <div class="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 text-xs">
        <p class="text-orange-700 font-semibold mb-1">🔄 Meta heredada de ${inheritedFrom}</p>
        <p class="text-orange-600">Aún no has guardado la meta de ${currentMonth}. Los valores mostrados son los del mes anterior.</p>
      </div>
    ` : ''}
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs">
      <p class="text-gray-700">
        💡 <b>¿Cómo funciona?</b> Cuando la tienda alcance esta meta mensual, el administrador recibirá el <b>bonus</b> sobre el total vendido del mes.
      </p>
    </div>
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div>
        <label class="text-xs font-semibold text-sd">Meta del mes ($)</label>
        <input id="g-goalAmount" type="number" value="${goalAmount}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Bonus admin (%)</label>
        <input id="g-bonusRate" type="number" step="0.01" value="${(bonusRate*100).toFixed(2)}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>
    <div class="bg-gray-50 rounded-lg p-3 mb-4 text-xs">
      <p class="text-gray-500 mb-1">Ventas actuales del mes:</p>
      <p class="text-lg font-bold text-sd" id="g-currentSales">${fmt(monthSales)}</p>
      <p class="text-gray-500 mt-2">Progreso:</p>
      <div class="w-full bg-gray-200 rounded-full h-2 mt-1">
        <div id="g-progress-bar" class="h-2 rounded-full ${achieved ? 'bg-green-500' : 'bg-sl'}" style="width:${pct}%"></div>
      </div>
      <p class="text-[10px] text-gray-500 mt-1" id="g-progress-text">
        ${goalAmount > 0
          ? `${pct.toFixed(0)}% · ${achieved ? '✅ Meta cumplida' : 'Faltan ' + fmt(Math.max(0, goalAmount - monthSales))}`
          : 'Sin meta configurada'}
      </p>
    </div>
    <div class="flex gap-2">
      <button onclick="closeGoalModal()" class="flex-1 bg-gray-100 text-sd py-2 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveStoreGoal('${storeId}','${currentMonth}')" class="flex-1 bg-sd text-white py-2 rounded-lg hover:bg-sl font-semibold">💾 Guardar meta</button>
    </div>
  `;

  // Actualización en vivo del progreso
  $('g-goalAmount').addEventListener('input', () => {
    const newGoal = Number($('g-goalAmount').value) || 0;
    const newPct = newGoal > 0 ? Math.min(100, (monthSales / newGoal) * 100) : 0;
    const newAchieved = monthSales >= newGoal && newGoal > 0;
    $('g-progress-bar').style.width = newPct + '%';
    $('g-progress-bar').className = `h-2 rounded-full ${newAchieved ? 'bg-green-500' : 'bg-sl'}`;
    $('g-progress-text').innerText = newGoal > 0
      ? `${newPct.toFixed(0)}% · ${newAchieved ? '✅ Meta cumplida' : 'Faltan ' + fmt(Math.max(0, newGoal - monthSales))}`
      : 'Sin meta configurada';
  });

  const m = $('goal-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeGoalModal = () => {
  const m = $('goal-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

window.saveStoreGoal = async (storeId, month) => {
  const goalAmount = Number($('g-goalAmount').value) || 0;
  const bonusRate = (Number($('g-bonusRate').value) || 0) / 100;

  const docId = `${storeId}_${month}`;

  const data = {
    storeId,
    month,
    goalAmount,
    bonusRate,
    updatedAt: serverTimestamp()
  };

  console.log('💾 Guardando meta:', docId, data);

  try {
    const ref = doc(db,'storeGoals', docId);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      await updateDoc(ref, data);
      console.log('✅ Actualizado');
    } else {
      await setDoc(ref, { ...data, createdAt: serverTimestamp() });
      console.log('✅ Creado');
    }

    await audit({
      action: snap.exists() ? 'update' : 'create',
      collection: 'storeGoals',
      docId,
      after: data,
      note: `Meta ${month} para ${storeId}: ${fmt(goalAmount)} · Bonus ${(bonusRate*100).toFixed(2)}%`
    });

    window.SmartecCache.invalidate('storeGoals');

    closeGoalModal();
    alert('✅ Meta guardada correctamente');
    await loadAll();
  } catch(e) {
    console.error('❌ Error guardando meta:', e);
    alert('Error al guardar: ' + e.message);
  }
};

/* Cerrar con ESC */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('goal-modal').classList.contains('hidden')) closeGoalModal();
});

/* ============================================================
   VENDEDORES / USUARIOS
============================================================ */
function renderSellers() {
  const filter = $('sellers-store-filter').value;
  const tb = $('sellers-tbody');
  let list = users;
  if (filter !== 'all') list = list.filter(u => u.storeId === filter);

  tb.innerHTML = list.length ? list.map(u => {
    const store = stores.find(s => s.storeId === u.storeId);
    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 font-medium text-sd">${escapeHtml(u.name) || '-'}</td>
      <td class="p-3 text-gray-500 text-xs">${escapeHtml(u.email) || '-'}</td>
      <td class="p-3"><span class="text-xs px-2 py-1 rounded ${
        u.role==='superadmin'?'bg-purple-100 text-purple-700':
        u.role==='admin'?'bg-blue-100 text-blue-700':'bg-gray-100 text-gray-700'
      }">${u.role||'-'}</span></td>
      <td class="p-3">${escapeHtml(store?.name) || (u.role==='superadmin'?'Todas':'—')}</td>
      <td class="p-3 text-center">
        ${(() => {
          const auth = (u.authorizedDevices || []).length;
          const max = Number(u.maxDevices ?? 1);
          const kioskBadge = u.kioskMode ? '<span class="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold ml-1">🔒 Kiosco</span>' : '';
          const colorCls = auth >= max ? 'text-red-600 font-bold' : auth > 0 ? 'text-green-600 font-semibold' : 'text-gray-400';
          return `
            <div class="text-xs ${colorCls}">
              ${auth} / ${max}
            </div>
            <div class="text-[10px] text-gray-400 mt-0.5">${auth === max ? 'límite alcanzado' : 'disponible'}</div>
            ${kioskBadge}
          `;
        })()}
      </td>
            <td class="p-3 text-center">
        <div class="text-xs font-semibold">${((u.commissionRate||0)*100).toFixed(1)}%</div>
        ${Number(u.goalAmount) > 0 ? (() => {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), 1);
          const sellerMonthSales = sales.filter(s =>
            s.sellerUid === u.id &&
            s.status !== 'anulada' &&
            s.createdAt?.seconds &&
            new Date(s.createdAt.seconds * 1000) >= start
          ).reduce((sum, s) => sum + Number(s.total||0), 0);
          const pct = Math.min(100, (sellerMonthSales / Number(u.goalAmount)) * 100);
          const achieved = sellerMonthSales >= Number(u.goalAmount);
          return `
            <div class="text-[10px] mt-1 ${achieved?'text-green-600 font-bold':'text-gray-400'}">
              🎯 ${pct.toFixed(0)}% (${fmt(sellerMonthSales)} / ${fmt(u.goalAmount)})
            </div>
            <div class="text-[10px] ${achieved?'text-green-600':'text-gray-400'}">
              ${achieved?'✅ Meta cumplida · ':'Bonus: '}${((u.bonusRate||0)*100).toFixed(1)}%
            </div>
          `;
        })() : '<div class="text-[10px] text-gray-300 mt-1">Sin meta</div>'}
      </td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='editSeller("${u.id}")' class="text-sl hover:underline mr-2">Editar</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="p-6 text-center text-gray-400">Sin usuarios</td></tr>';
}

window.openSellerForm = (u = null) => {
  $('form-title').innerText = u ? 'Editar usuario' : 'Nuevo usuario';
  const v = u || { name:'', email:'', role:'vendedor', storeId:'', commissionRate:0, active:true };
  $('form-body').innerHTML = `
    ${u ? `
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs">
        <b>UID:</b> <span class="font-mono">${u.id}</span>
      </div>
    ` : `
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-xs">
        <b>✨ Crear usuario nuevo:</b> Ingresa el email y la contraseña. El sistema creará la cuenta automáticamente en Firebase Authentication.
      </div>
    `}
    <label class="text-xs font-semibold">Nombre *</label>
    <input id="f-name" value="${v.name||''}" class="w-full px-3 py-2 border rounded mb-3">
    <label class="text-xs font-semibold">Email *</label>
    <input id="f-email" type="email" value="${v.email||''}" ${u?'disabled':''} placeholder="usuario@ejemplo.com" class="w-full px-3 py-2 border rounded mb-3">
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold">Rol</label>
        <select id="f-role" class="w-full px-3 py-2 border rounded">
          <option value="vendedor" ${v.role==='vendedor'?'selected':''}>Vendedor</option>
          <option value="admin" ${v.role==='admin'?'selected':''}>Admin de tienda</option>
          <option value="superadmin" ${v.role==='superadmin'?'selected':''}>Superadmin</option>
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold">Tienda</label>
        <select id="f-storeId" class="w-full px-3 py-2 border rounded">
          <option value="">— Ninguna —</option>
          ${stores.map(s => `<option value="${s.storeId}" ${v.storeId===s.storeId?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </div>
    </div>
        <div class="grid grid-cols-3 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold">Comisión individual (%)</label>
        <input id="f-commission" type="number" step="0.01" value="${((v.commissionRate||0)*100).toFixed(2)}" class="w-full px-3 py-2 border rounded">
        <p class="text-[10px] text-gray-400 mt-1">0 = usar el pool de la tienda</p>
      </div>
      <div>
        <label class="text-xs font-semibold">Meta mensual ($)</label>
        <input id="f-goal" type="number" value="${v.goalAmount||''}" placeholder="50000000" class="w-full px-3 py-2 border rounded">
        <p class="text-[10px] text-gray-400 mt-1">0 = sin meta</p>
      </div>
      <div>
        <label class="text-xs font-semibold">Bonus al cumplir (%)</label>
        <input id="f-bonus" type="number" step="0.01" value="${((v.bonusRate||0)*100).toFixed(2)}" class="w-full px-3 py-2 border rounded">
        <p class="text-[10px] text-gray-400 mt-1">Solo sobre el excedente</p>
      </div>
    </div>

        <div class="border-t pt-3 mt-3 mb-3">
      <p class="text-xs font-semibold text-sd mb-2">🔒 Control de acceso y dispositivos</p>
      <div class="grid grid-cols-3 gap-3 mb-2">
        <div>
          <label class="text-xs font-semibold">Máx. dispositivos</label>
          <input id="f-maxDevices" type="number" min="1" max="10" value="${v.maxDevices ?? 1}" class="w-full px-3 py-2 border rounded">
          <p class="text-[10px] text-gray-400 mt-1">Cantidad de equipos autorizados</p>
        </div>
        <div>
          <label class="text-xs font-semibold">PIN acceso rápido (4 dígitos)</label>
          <input id="f-pin" type="text" maxlength="4" inputmode="numeric" pattern="[0-9]*" value="${v.pin || ''}" placeholder="1234" class="w-full px-3 py-2 border rounded font-mono text-center tracking-widest">
          <p class="text-[10px] text-gray-400 mt-1">Opcional. Para bloquear/desbloquear.</p>
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-2 text-sm">
            <input id="f-kioskMode" type="checkbox" ${v.kioskMode ? 'checked' : ''} class="w-4 h-4">
            <span>Modo kiosco</span>
          </label>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 mt-2">
        <div>
          <label class="flex items-center gap-2 text-sm">
            <input id="f-deviceAutoApprove" type="checkbox" ${v.deviceAutoApprove === true ? 'checked' : ''} class="w-4 h-4">
            <span>Auto-autorizar dispositivos nuevos</span>
          </label>
          <p class="text-[10px] text-gray-400 mt-1">Si está activo, cuando el usuario entre desde un dispositivo nuevo y haya cupo, se autorizará solo. Si está apagado, requerirá aprobación del superadmin.</p>
        </div>
      </div>
          <!-- ============================================================ -->
    <!-- 🆕 DISPOSITIVOS AUTORIZADOS (solo visible al editar usuario) -->
    <!-- ============================================================ -->
    ${u && u.role !== 'superadmin' ? `
    <div class="border-t pt-3 mt-3 mb-3">
      <div class="flex justify-between items-center mb-2">
        <p class="text-xs font-semibold text-sd">📱 Dispositivos autorizados</p>
        <span id="f-devices-count" class="text-[10px] text-gray-400">
          ${(u.authorizedDevices || []).length} / ${u.maxDevices ?? 1}
        </span>
      </div>
      <div id="f-devices-list" class="bg-gray-50 rounded-lg p-3 space-y-2 max-h-56 overflow-y-auto scrollbar-thin">
        <!-- Se llena dinámicamente desde renderSellerDevices() -->
      </div>
      <p class="text-[10px] text-gray-400 mt-2">
        💡 Al "liberar un cupo", el dispositivo deberá autorizarse de nuevo al iniciar sesión desde ese equipo.
      </p>
    </div>
    ` : ''}
      <p class="text-[10px] text-gray-400">
        💡 <b>Modo kiosco:</b> bloquea clic derecho, atajos de teclado y cierra sesión si el usuario sale de la pestaña. Ideal para tablets de tienda.
      </p>
    </div>

    <label class="flex items-center gap-2 text-sm mb-3">
      <input id="f-active" type="checkbox" ${v.active!==false?'checked':''} class="w-4 h-4"> Activo
    </label>
    <button onclick="saveSeller('${u?u.id:''}')" class="w-full bg-sd text-white py-2 rounded-lg hover:bg-sl font-semibold">Guardar</button>
  `;
  openForm();

  // 🆕 Renderizar la lista de dispositivos autorizados (solo al editar)
  if (u && u.role !== 'superadmin') {
    renderSellerDevices(u);
  }
};

/* ============================================================
   🆕 DISPOSITIVOS AUTORIZADOS — Render en el modal de edición
============================================================ */
window.renderSellerDevices = (seller) => {
  const list = $('f-devices-list');
  const countEl = $('f-devices-count');
  if (!list) return;

  const devices = seller?.authorizedDevices || [];
  const maxDevices = Number(seller?.maxDevices ?? 1);

  if (countEl) {
    countEl.innerText = `${devices.length} / ${maxDevices}`;
    countEl.className = devices.length >= maxDevices
      ? 'text-[10px] text-red-600 font-bold'
      : devices.length > 0
        ? 'text-[10px] text-green-600 font-semibold'
        : 'text-[10px] text-gray-400';
  }

  if (!devices.length) {
    list.innerHTML = `
      <p class="text-[10px] text-gray-400 text-center py-3 italic">
        Sin dispositivos autorizados aún. El primer dispositivo se registrará automáticamente al iniciar sesión.
      </p>
    `;
    return;
  }

  list.innerHTML = devices.map((d, i) => {
    const shortId = (d.fingerprint || '').slice(0, 12) || 'unknown';
    const label = d.label || 'Dispositivo desconocido';
    const registeredAt = d.registeredAt
      ? new Date(d.registeredAt).toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'2-digit' })
      : '—';
    const lastSeen = d.lastSeen
      ? new Date(d.lastSeen).toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'2-digit' })
      : '—';

    return `
      <div class="bg-white border border-gray-200 rounded-lg p-3 flex items-start gap-3">
        <div class="w-8 h-8 rounded-full bg-sl/10 flex items-center justify-center shrink-0 text-sm">
          💻
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-sd truncate">${escapeHtml(label)}</p>
          <p class="text-[10px] text-gray-400 font-mono truncate">ID: ${escapeHtml(shortId)}…</p>
          <p class="text-[10px] text-gray-400 mt-0.5">
            Registrado: ${registeredAt} · Último uso: ${lastSeen}
          </p>
        </div>
        <button
          type="button"
          onclick="releaseDevice('${seller.id}', '${escapeHtml(d.fingerprint || '')}', ${i})"
          class="text-red-500 hover:text-red-700 text-[10px] font-semibold px-2 py-1 rounded hover:bg-red-50 whitespace-nowrap shrink-0"
          title="Eliminar este dispositivo (libera un cupo)">
          🗑 Liberar
        </button>
      </div>
    `;
  }).join('');
};

/* ============================================================
   🆕 LIBERAR CUPO DE DISPOSITIVO
============================================================ */
window.releaseDevice = async (sellerUid, fingerprint, index) => {
  if (!sellerUid || !fingerprint) {
    alert('⚠️ Datos del dispositivo incompletos.');
    return;
  }

  // Confirmación
  const seller = users.find(x => x.id === sellerUid);
  if (!seller) {
    alert('⛔ Usuario no encontrado.');
    return;
  }

  const devices = seller.authorizedDevices || [];
  const device = devices.find(d => d.fingerprint === fingerprint);
  if (!device) {
    alert('⛔ Dispositivo no encontrado en la lista.');
    return;
  }

  const label = device.label || 'Dispositivo desconocido';
  const remaining = devices.length - 1;
  const isLastDevice = remaining === 0;

  let confirmMsg =
    `⚠️ ¿Liberar este dispositivo?\n\n` +
    `Usuario: ${seller.name || seller.email}\n` +
    `Dispositivo: ${label}\n` +
    `ID: ${fingerprint.slice(0, 16)}…\n\n` +
    `Dispositivos autorizados: ${devices.length} → quedará(n) ${remaining}\n\n` +
    `El dispositivo deberá autorizarse de nuevo al iniciar sesión desde ese equipo.\n\n`;

  if (isLastDevice) {
    confirmMsg +=
      `🔴 ATENCIÓN: este es el ÚLTIMO dispositivo autorizado.\n` +
      `El usuario NO podrá iniciar sesión hasta que registre otro.\n\n` +
      `¿Continuar de todas formas?`;
  } else {
    confirmMsg += `Esta acción quedará registrada en el historial de dispositivos.\n\n¿Continuar?`;
  }

  if (!confirm(confirmMsg)) return;

  // 🆕 Pedir motivo de liberación (opcional, pero útil para auditar)
  const reason = prompt(
    'Motivo de la liberación (opcional pero recomendado).\n\n' +
    'Ej: "El empleado ya no trabaja aquí", "Cambio de equipo", "Por seguridad"'
  ) || '';

  try {
    // Filtrar el dispositivo fuera del array
    const newDevices = devices.filter(d => d.fingerprint !== fingerprint);

    await updateDoc(doc(db, 'users', sellerUid), {
      authorizedDevices: newDevices,
      updatedAt: serverTimestamp()
    });

    // Auditoría general
    await audit({
      action: 'update',
      collection: 'users',
      docId: sellerUid,
      before: { authorizedDevices: devices.length },
      after: { authorizedDevices: newDevices.length },
      note: `Dispositivo liberado: ${label} (${fingerprint.slice(0, 12)}…) · Usuario: ${seller.name || seller.email}${reason ? ' · Motivo: ' + reason : ''}`
    });

    // 🆕 Historial inmutable en deviceHistory
    try {
      await addDoc(collection(db, 'deviceHistory'), {
        deviceFingerprint: fingerprint,
        deviceLabel: label,
        userId: sellerUid,
        userEmail: seller.email || null,
        userName: seller.name || seller.email || null,
        userRole: seller.role || null,
        storeId: seller.storeId || null,
        credentialId: null,  // No hay credencial específica al liberar
        action: 'release',
        reason: reason || null,
        releasedBy: currentUser?.uid || null,
        releasedByEmail: currentUser?.email || null,
        userAgent: navigator.userAgent,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.warn('[releaseDevice] No se pudo guardar deviceHistory:', e);
    }

    // Invalidar cache
    window.SmartecCache.invalidate('users');

    // Actualizar la lista en el modal sin cerrarlo
    const updatedSeller = { ...seller, authorizedDevices: newDevices };
    const idx = users.findIndex(x => x.id === sellerUid);
    if (idx !== -1) users[idx] = updatedSeller;

    renderSellerDevices(updatedSeller);

    alert('✅ Cupo liberado correctamente.');
  } catch (e) {
    console.error('Error liberando dispositivo:', e);
    alert('❌ Error: ' + e.message);
  }
};

window.editSeller = id => { const u = users.find(x => x.id === id); if (u) openSellerForm(u); };

window.saveSeller = async (existingUid) => {
  const isNew = !existingUid;

  const data = {
    name: $('f-name').value.trim(),
    email: $('f-email').value.trim(),
    role: $('f-role').value,
    storeId: $('f-storeId').value || null,
    commissionRate: (Number($('f-commission').value)||0)/100,
    goalAmount: Number($('f-goal').value)||0,
    bonusRate: (Number($('f-bonus').value)||0)/100,
    maxDevices: Number($('f-maxDevices').value) || 1,
    pin: $('f-pin').value.trim() || null,
    kioskMode: $('f-kioskMode')?.checked || false,
    deviceAutoApprove: $('f-deviceAutoApprove')?.checked || false,
    active: $('f-active').checked
  };
  if (!data.name) return alert('El nombre es obligatorio');

  // ========== CREAR USUARIO NUEVO ==========
  if (isNew) {
    // Validar email
    if (!data.email) return alert('El email es obligatorio para crear un usuario');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return alert('⚠️ El email no tiene un formato válido');
    }

    // Pedir contraseña
    const password = prompt(
      `🔐 Crear usuario: ${data.name}\n\n` +
      `Ingresa la contraseña inicial (mínimo 6 caracteres):\n\n` +
      `El usuario podrá cambiarla después.`
    );
    if (!password) return;
    if (password.length < 6) return alert('⚠️ La contraseña debe tener al menos 6 caracteres');

    // Confirmar antes de crear
    if (!confirm(
      `¿Crear el usuario?\n\n` +
      `Nombre: ${data.name}\n` +
      `Email: ${data.email}\n` +
      `Rol: ${data.role}\n` +
      `Tienda: ${data.storeId || 'Ninguna'}`
    )) return;

    try {
      // Llamar a la Cloud Function
      // Obtener token fresco del usuario actual
      const idToken = await currentUser.getIdToken(true);

      // Usar httpsCallable (maneja el token automáticamente)
      const createUserFn = httpsCallable(functions, 'createUserAdmin');
      const result = await createUserFn({
        email: data.email,
        password: password,
        name: data.name,
        role: data.role,
        storeId: data.storeId,
        commissionRate: data.commissionRate,
        goalAmount: data.goalAmount,
        bonusRate: data.bonusRate,
        maxDevices: data.maxDevices,
        pin: data.pin,
        kioskMode: data.kioskMode,
        deviceAutoApprove: data.deviceAutoApprove,
        active: data.active
      });

      if (!result.data?.success) {
        throw new Error('La función no confirmó la creación');
      }

      window.SmartecCache.invalidate('users');
      closeForm();
      await loadAll();
      return;
    } catch (e) {
      console.error('Error creando usuario:', e);
      const msg = e.message || 'Error desconocido';
      alert('❌ No se pudo crear el usuario:\n\n' + msg);
      return;
    }
  }

  // ========== EDITAR USUARIO EXISTENTE ==========
  const before = users.find(u => u.id === existingUid);

  try {
    await setDoc(doc(db,'users',existingUid), {
      ...data,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await audit({
      action: 'update',
      collection: 'users',
      docId: existingUid,
      before: before,
      after: data,
      note: `Editado usuario ${data.name} (${data.role})`
    });

    window.SmartecCache.invalidate('users');
    closeForm();
    await loadAll();
    alert('✅ Usuario actualizado');
  } catch (e) {
    console.error('Error editando usuario:', e);
    alert('❌ Error al guardar: ' + e.message);
  }
};

/* ============================================================
   PRODUCTOS
============================================================ */
function renderProducts() {
  const tb = $('products-tbody');
  const term = ($('products-search').value||'').toLowerCase();
  const list = products.filter(p =>
    !term || (p.name||'').toLowerCase().includes(term) || (p.sku||'').toLowerCase().includes(term)
  );

  tb.innerHTML = list.length ? list.map(p => {
    // Stock total y desglose por tienda
    const invOfProduct = inventory.filter(i => i.productId === p.id);
    const totalStock = invOfProduct.reduce((s,i) => s + Number(i.stock||0), 0);

    // Stock por tienda (solo las tiendas visibles para este usuario)
    const stockByStore = stores.map(st => {
      const storeInv = invOfProduct.filter(i => i.storeId === st.storeId);
      const storeStock = storeInv.reduce((s,i) => s + Number(i.stock||0), 0);
      return { storeId: st.storeId, storeName: st.name, stock: storeStock };
    });

    const stockTooltip = stockByStore.map(x => `${x.storeName}: ${x.stock}`).join(' · ');

    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-gray-500 text-xs">${escapeHtml(p.sku)||'-'}</td>
      <td class="p-3 font-medium text-sd">${escapeHtml(p.name)}</td>
      <td class="p-3 text-xs">${escapeHtml(p.categoryGroupName)||''}<br><span class="text-gray-400">${escapeHtml(p.categoryName)||''}</span></td>
      <td class="p-3 text-right">${fmt(p.cost)}</td>
      <td class="p-3 text-right font-semibold">${fmt(p.onSale&&p.salePrice?p.salePrice:p.price)}</td>
      <td class="p-3 text-center text-xs">${(p.variants||[]).length}</td>
      <td class="p-3 text-center font-semibold ${totalStock<=5?'text-orange-500':''}" title="${stockTooltip}">
        ${totalStock}
      </td>
      <td class="p-3 text-center">
        <button onclick='viewInventory("${p.id}")' class="text-sl hover:underline text-xs whitespace-nowrap">
          👁 Ver / editar
        </button>
      </td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='editProduct("${p.id}")' class="text-sl hover:underline mr-2">Editar</button>
        <button onclick='delProduct("${p.id}")' class="text-red-500 hover:underline">Borrar</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="p-6 text-center text-gray-400">Sin productos</td></tr>';
}
$('products-search').addEventListener('input', renderProducts);

function getCategoryTree() {
  return settings.categories || {};
}

window.openProductForm = (p = null) => {
  $('form-title').innerText = p ? 'Editar producto' : 'Nuevo producto';
  const v = p || {
    sku:'', name:'', brand:'', description:'', categoryGroup:'', category:'',
    price:'', cost:'', taxRate:0, warrantyMonths:12, serialRequired:false,
    onSale:false, salePrice:'', active:true, images:[], variants:[]
  };
  const tree = getCategoryTree();
  const groupOptions = Object.entries(tree).map(([slug,g]) =>
    `<option value="${slug}" ${v.categoryGroup===slug?'selected':''}>${g.name}</option>`).join('');

  $('form-body').innerHTML = `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div><label class="text-xs font-semibold">SKU base</label><input id="f-sku" value="${v.sku||''}" class="w-full px-3 py-2 border rounded"></div>
      <div><label class="text-xs font-semibold">Marca</label><input id="f-brand" value="${v.brand||''}" class="w-full px-3 py-2 border rounded"></div>
    </div>
    <label class="text-xs font-semibold">Nombre</label>
    <input id="f-name" value="${v.name||''}" class="w-full px-3 py-2 border rounded mb-3">
    <label class="text-xs font-semibold">Descripción</label>
    <textarea id="f-desc" rows="2" class="w-full px-3 py-2 border rounded mb-3">${v.description||''}</textarea>
        <label class="text-xs font-semibold">Descripción larga (opcional, tipo ficha técnica)</label>
    <textarea id="f-longDesc" rows="4" placeholder="Escribe aquí la descripción extendida del producto. Puedes usar saltos de línea y guiones para listas." class="w-full px-3 py-2 border rounded mb-3 text-sm">${v.longDescription||''}</textarea>

    <div class="border border-gray-200 rounded-lg p-3 mb-3">
      <div class="flex justify-between items-center mb-2">
        <p class="text-xs font-semibold text-sd">⚙️ Especificaciones técnicas</p>
        <button type="button" onclick="addSpecRow()" class="text-[10px] bg-sl text-white px-2 py-1 rounded hover:bg-sd">+ Agregar</button>
      </div>
      <div id="specs-container" class="space-y-2 max-h-48 overflow-y-auto scrollbar-thin"></div>
    </div>

    <div class="border border-gray-200 rounded-lg p-3 mb-3">
      <div class="flex justify-between items-center mb-2">
        <p class="text-xs font-semibold text-sd">❓ Preguntas frecuentes</p>
        <button type="button" onclick="addFaqRow()" class="text-[10px] bg-sl text-white px-2 py-1 rounded hover:bg-sd">+ Agregar</button>
      </div>
      <div id="faqs-container" class="space-y-2 max-h-64 overflow-y-auto scrollbar-thin"></div>
    </div>
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold">Categoría principal</label>
        <select id="f-catGroup" class="w-full px-3 py-2 border rounded" onchange="updateSubcats()">
          ${groupOptions}
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold">Subcategoría</label>
        <select id="f-catSub" class="w-full px-3 py-2 border rounded"></select>
      </div>
    </div>
    <div class="grid grid-cols-3 gap-3 mb-3">
      <div><label class="text-xs font-semibold">Costo</label><input id="f-cost" type="number" value="${v.cost||''}" class="w-full px-3 py-2 border rounded"></div>
      <div><label class="text-xs font-semibold">Precio venta</label><input id="f-price" type="number" value="${v.price||''}" class="w-full px-3 py-2 border rounded"></div>
      <div><label class="text-xs font-semibold">IVA %</label><input id="f-taxRate" type="number" step="0.01" value="${(v.taxRate||0)*100}" class="w-full px-3 py-2 border rounded"></div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold">🔒 Precio mínimo de venta</label>
        <input id="f-minPrice" type="number" value="${v.minPrice||''}" placeholder="Ej: 900000" class="w-full px-3 py-2 border rounded">
        <p class="text-[10px] text-gray-400 mt-1">Mínimo autorizado al vendedor. Si se deja vacío, se usa 0 (sin restricción).</p>
      </div>
      <div>
        <label class="text-xs font-semibold">🏷️ Precio mayorista (referencia)</label>
        <input id="f-wholesalePrice" type="number" value="${v.wholesalePrice||''}" placeholder="Opcional" class="w-full px-3 py-2 border rounded">
        <p class="text-[10px] text-gray-400 mt-1">Referencia comercial. Independiente del mínimo.</p>
      </div>
    </div>
    <div class="grid grid-cols-3 gap-3 mb-3">
      <div><label class="text-xs font-semibold">Garantía (meses)</label><input id="f-warranty" type="number" value="${v.warrantyMonths||12}" class="w-full px-3 py-2 border rounded"></div>
      <label class="flex items-center gap-2 text-sm mt-5">
        <input id="f-serial" type="checkbox" ${v.serialRequired?'checked':''} class="w-4 h-4"> Requiere N° serie
      </label>
      <label class="flex items-center gap-2 text-sm mt-5">
        <input id="f-active" type="checkbox" ${v.active!==false?'checked':''} class="w-4 h-4"> Activo
      </label>
    </div>
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <label class="flex items-center gap-2 text-sm">
        <input id="f-onsale" type="checkbox" ${v.onSale?'checked':''} class="w-4 h-4"> En promoción
      </label>
      <input id="f-salePrice" type="number" placeholder="Precio oferta" value="${v.salePrice||''}" class="px-3 py-2 border rounded w-40">
    </div>
    <div class="border border-gray-200 rounded-lg p-3 mb-3">
      <div class="flex justify-between items-center mb-2">
        <p class="text-xs font-semibold text-sd">📸 Imágenes del producto</p>
        <button type="button" onclick="document.getElementById('f-image-file').click()" class="text-[10px] bg-sl text-white px-2 py-1 rounded hover:bg-sd">
          + Subir imágenes
        </button>
      </div>
      <input type="file" id="f-image-file" accept="image/jpeg,image/png,image/webp" multiple class="hidden">
      <div id="f-dropzone" class="img-dropzone">
        <p class="text-xs text-gray-500">
          Arrastra tus imágenes aquí o haz clic en <b>"+ Subir imágenes"</b>
        </p>
        <p class="text-[10px] text-gray-400 mt-1">
          JPG, PNG o WebP · máx 5MB · se convertirán a WebP automáticamente
        </p>
      </div>
      <div id="f-images-preview" class="grid grid-cols-4 gap-2 mt-3"></div>
      <p id="f-images-counter" class="text-[10px] text-gray-400 mt-2 text-center"></p>
    </div>

    <div class="border-t pt-3 mt-3">
      <div class="flex justify-between items-center mb-2">
        <p class="text-sm font-bold text-sd">Variantes (colores + dimensiones)</p>
        <button onclick="addVariantRow()" class="text-xs bg-sl text-white px-3 py-1 rounded hover:bg-sd">+ Agregar variante</button>
      </div>
      <div class="bg-gray-50 rounded-lg p-3 max-h-60 overflow-y-auto scrollbar-thin">
        <div id="variants-container" class="space-y-2"></div>
      </div>
    </div>

    <div id="upload-progress-wrap" class="upload-progress-wrap">
      <div class="flex justify-between items-center text-xs font-semibold text-sd">
        <span id="upload-progress-text">📤 Subiendo imágenes…</span>
        <span id="upload-progress-count" class="text-gray-500">0 / 0</span>
      </div>
      <div class="upload-progress-bar">
        <div id="upload-progress-fill" class="upload-progress-fill"></div>
      </div>
    </div>

    <button onclick="saveProduct('${p?p.id:''}')" class="mt-5 w-full bg-sd text-white py-2 rounded-lg hover:bg-sl font-semibold transition-all">Guardar producto</button>
  `;

  updateSubcats();
  // Render variantes
  const container = $('variants-container');
  container.innerHTML = '';
  (v.variants||[]).forEach(vr => addVariantRow(vr));
  if (!(v.variants||[]).length) addVariantRow();
  
    // Render specs
  const specsC = $('specs-container');
  specsC.innerHTML = '';
  (v.specs||[]).forEach(s => addSpecRow(s));

  // Render faqs
  const faqsC = $('faqs-container');
  faqsC.innerHTML = '';
  (v.faqs||[]).forEach(f => addFaqRow(f));

  // 🆕 Render imágenes del producto
  initProductImages(p);

  openForm();
};
window.editProduct = id => { const p = products.find(x => x.id === id); if (p) openProductForm(p); };

/* ============================================================
   🆕 IMÁGENES DE PRODUCTO — Attachments con drag&drop
============================================================ */

/**
 * Inicializa el array currentProductImages y los listeners del formulario.
 * Se llama al abrir el modal de producto (nuevo o editando).
 */
window.initProductImages = (product) => {
  // Cargar imágenes existentes del producto (si estamos editando)
  currentProductImages = (product?.images || []).map(url => ({
    url,
    file: null,
    previewUrl: url,
    isNew: false
  }));

  renderProductImagesPreview();
  attachProductImagesListeners();
};

/**
 * Conecta los listeners de subida, drag&drop y ordenamiento.
 */
function attachProductImagesListeners() {
  const fileInput = $('f-image-file');
  const dropzone = $('f-dropzone');

  if (!fileInput || !dropzone) return;

  // Click en el input → seleccionar archivos
  fileInput.onchange = (e) => {
    handleProductImageFiles(Array.from(e.target.files));
    fileInput.value = '';
  };

  // Click en dropzone → abrir selector
  dropzone.onclick = () => fileInput.click();

  // Drag & drop sobre dropzone
  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    handleProductImageFiles(files);
  });
}

/**
 * Procesa los archivos seleccionados: valida y los agrega a la lista.
 */
function handleProductImageFiles(files) {
  if (!files.length) return;

  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const maxSizeMB = 5;

  let added = 0;
  let rejected = [];

  files.forEach(file => {
    // Validar tipo
    if (!validTypes.includes(file.type)) {
      rejected.push(`"${file.name}" (formato no soportado)`);
      return;
    }
    // Validar peso
    if (file.size > maxSizeMB * 1024 * 1024) {
      rejected.push(`"${file.name}" (supera ${maxSizeMB}MB)`);
      return;
    }
    // Crear preview local
    const previewUrl = URL.createObjectURL(file);
    currentProductImages.push({
      url: null,
      file,
      previewUrl,
      isNew: true
    });
    added++;
  });

  if (rejected.length) {
    alert(`⚠️ Algunos archivos fueron rechazados:\n\n${rejected.join('\n')}`);
  }

  if (added > 0) {
    renderProductImagesPreview();
  }
}

/**
 * Renderiza las miniaturas en el grid.
 */
function renderProductImagesPreview() {
  const container = $('f-images-preview');
  const counter = $('f-images-counter');
  if (!container) return;

  if (!currentProductImages.length) {
    container.innerHTML = '<p class="text-[10px] text-gray-400 col-span-4 text-center py-3">Sin imágenes aún</p>';
    if (counter) counter.innerText = '';
    return;
  }

  container.innerHTML = currentProductImages.map((img, i) => `
    <div class="img-thumb ${i === 0 ? 'is-main' : ''}"
         draggable="true"
         data-index="${i}">
      <img src="${img.previewUrl}" class="w-full h-full object-contain p-1" draggable="false">
      <button type="button" class="btn-remove"
              onclick="event.stopPropagation(); removeProductImage(${i})"
              title="Eliminar">✕</button>
      ${img.isNew ? '<span class="absolute top-1 left-1 bg-blue-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full z-10">NUEVA</span>' : ''}
    </div>
  `).join('');

  if (counter) {
    const total = currentProductImages.length;
    counter.innerText = `${total} imagen${total !== 1 ? 'es' : ''} · la primera será la principal del catálogo`;
  }

  attachThumbDragListeners();
}

/**
 * Conecta los listeners de drag&drop para reordenar las miniaturas.
 */
function attachThumbDragListeners() {
  const thumbs = document.querySelectorAll('#f-images-preview .img-thumb');
  let draggedIndex = null;

  thumbs.forEach(thumb => {
    thumb.addEventListener('dragstart', (e) => {
      draggedIndex = Number(thumb.dataset.index);
      thumb.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('dragging');
      document.querySelectorAll('#f-images-preview .img-thumb').forEach(t => t.classList.remove('drop-target'));
    });

    thumb.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (Number(thumb.dataset.index) !== draggedIndex) {
        thumb.classList.add('drop-target');
      }
    });

    thumb.addEventListener('dragleave', () => {
      thumb.classList.remove('drop-target');
    });

    thumb.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIndex = Number(thumb.dataset.index);
      if (draggedIndex === null || draggedIndex === targetIndex) return;

      // Mover el elemento en el array
      const [moved] = currentProductImages.splice(draggedIndex, 1);
      currentProductImages.splice(targetIndex, 0, moved);

      renderProductImagesPreview();
    });
  });
}

/**
 * Elimina una imagen de la lista (no borra de Storage todavía).
 */
window.removeProductImage = (index) => {
  const img = currentProductImages[index];
  if (!img) return;

  // Si es nueva, revocar el blob URL para liberar memoria
  if (img.isNew && img.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(img.previewUrl);
  }

  currentProductImages.splice(index, 1);
  renderProductImagesPreview();
};

window.updateSubcats = () => {
  const group = $('f-catGroup').value;
  const tree = getCategoryTree();
  const subSelect = $('f-catSub');
  if (!tree[group]) { subSelect.innerHTML = ''; return; }
  subSelect.innerHTML = Object.entries(tree[group].subcategories).map(([slug,s]) =>
    `<option value="${slug}">${s.name}</option>`).join('');
};

window.addVariantRow = (v = {}) => {
  const c = $('variants-container');
  const div = document.createElement('div');
  div.className = 'variant-row bg-white p-3 rounded border space-y-2';
  div.innerHTML = `
    <div class="grid grid-cols-12 gap-2 items-center">
      <input class="v-sku col-span-4 px-2 py-1 border rounded text-xs font-mono" placeholder="SKU variante" value="${v.sku||''}">
      <input class="v-colorName col-span-2 px-2 py-1 border rounded text-xs" placeholder="Color" value="${v.colorName||''}">
      <input class="v-color col-span-2 px-2 py-1 border rounded text-xs" type="color" value="${v.color||'#000000'}">
      <input class="v-size col-span-2 px-2 py-1 border rounded text-xs" placeholder="Dimensión" value="${v.size||''}">
      <input class="v-priceDelta col-span-1 px-2 py-1 border rounded text-xs" type="number" placeholder="+$" value="${v.priceDelta||0}">
      <button type="button" onclick="this.closest('.variant-row').remove()" class="col-span-1 text-red-500 hover:text-red-700 text-center">✕</button>
    </div>
    <div class="flex items-center gap-2">
      <label class="text-[10px] font-semibold text-sd whitespace-nowrap">📷 Código de barras:</label>
      <input class="v-barcode flex-1 px-2 py-1 border rounded text-xs font-mono" placeholder="Ej: 7701234567890" value="${v.barcode||''}">
    </div>
  `;
  c.appendChild(div);
};

window.saveProduct = async (existingId) => {
  const variantRows = document.querySelectorAll('.variant-row');
  const variants = [];
  variantRows.forEach(row => {
    const sku = row.querySelector('.v-sku').value.trim();
    if (!sku) return;
    variants.push({
      variantId: sku,
      sku,
      color: row.querySelector('.v-color').value || null,
      colorName: row.querySelector('.v-colorName').value.trim(),
      size: row.querySelector('.v-size').value.trim() || null,
      priceDelta: Number(row.querySelector('.v-priceDelta').value)||0,
      barcode: row.querySelector('.v-barcode').value.trim() || null,
      active: true
    });
  });

  if (!variants.length) return alert('Debes agregar al menos una variante');

  const group = $('f-catGroup').value;
  const sub = $('f-catSub').value;
  const tree = getCategoryTree();
  if (!tree[group] || !tree[group].subcategories[sub]) return alert('Selecciona categoría y subcategoría válidas');

  // Recolectar specs
  const specs = [];
  document.querySelectorAll('.spec-row').forEach(row => {
    const key = row.querySelector('.spec-key').value.trim();
    const val = row.querySelector('.spec-value').value.trim();
    if (key && val) specs.push({ key, value: val });
  });

  // Recolectar faqs
  const faqs = [];
  document.querySelectorAll('.faq-row').forEach(row => {
    const question = row.querySelector('.faq-q').value.trim();
    const answer = row.querySelector('.faq-a').value.trim();
    if (question && answer) faqs.push({ question, answer });
  });

  const data = {
    sku: $('f-sku').value.trim(),
    name: $('f-name').value.trim(),
    brand: $('f-brand').value.trim(),
    description: $('f-desc').value.trim(),
    longDescription: $('f-longDesc').value.trim(),
    specs,
    faqs,
    categoryGroup: group,
    categoryGroupName: tree[group].name,
    category: sub,
    categoryName: tree[group].subcategories[sub].name,
    cost: Number($('f-cost').value)||0,
    price: Number($('f-price').value)||0,
    minPrice: Number($('f-minPrice').value)||0,
    wholesalePrice: Number($('f-wholesalePrice').value)||0,
    taxRate: (Number($('f-taxRate').value)||0)/100,
    warrantyMonths: Number($('f-warranty').value)||12,
    serialRequired: $('f-serial').checked,
    active: $('f-active').checked,
    onSale: $('f-onsale').checked,
    salePrice: Number($('f-salePrice').value)||0,
    images: currentProductImages.filter(i => i.url).map(i => i.url),
    variants,
    updatedAt: serverTimestamp()
  };
  if (!data.name) return alert('El nombre es obligatorio');

    // 🆕 Validar coherencia de precios
  if (data.minPrice > 0 && data.price > 0 && data.minPrice > data.price) {
    return alert('⚠️ El precio mínimo no puede ser mayor que el precio de venta.');
  }
  if (data.salePrice > 0 && data.minPrice > 0 && data.minPrice > data.salePrice) {
    return alert('⚠️ El precio mínimo no puede ser mayor que el precio de oferta.');
  }
  if (data.wholesalePrice > 0 && data.minPrice > 0 && data.wholesalePrice < data.minPrice) {
    if (!confirm('⚠️ El precio mayorista es menor que el precio mínimo de venta. ¿Continuar de todas formas?')) {
      return;
    }
  }

  const isNew = !existingId;
  let docId = existingId;

  // 🆕 Detectar imágenes nuevas pendientes de subir
  const newImages = currentProductImages.filter(img => img.isNew && img.file);

  // 🆕 Botón "Guardando..." con animación Apple + barra de progreso
  const saveBtn = document.querySelector('#form-body button[onclick*="saveProduct"]');
  const progressWrap = $('upload-progress-wrap');

  if (newImages.length > 0 && saveBtn) {
    saveBtn.classList.add('btn-saving');
    saveBtn.disabled = true;
    saveBtn.dataset.originalText = saveBtn.innerText;
    saveBtn.innerText = 'Guardando…';
    if (progressWrap) progressWrap.classList.add('active');
    updateUploadProgress(0, newImages.length, newImages[0]?.file?.name || '');
  }

  try {
    // 1. Crear/actualizar doc base (SIN las imágenes nuevas aún)
    if (isNew) {
      const ref = await addDoc(collection(db,'products'), { ...data, createdAt: serverTimestamp() });
      docId = ref.id;
    } else {
      await updateDoc(doc(db,'products',docId), data);
    }

    // 2. Subir imágenes nuevas si las hay (todas a WebP optimizado)
    let finalImages = data.images;
    if (newImages.length > 0) {
      const uploadedUrls = [];
      for (let i = 0; i < newImages.length; i++) {
        const img = newImages[i];
        updateUploadProgress(i, newImages.length, img.file.name);
        try {
          const url = await uploadProductImageAsWebp(img.file, docId);
          uploadedUrls.push(url);
        } catch (err) {
          console.error('Error subiendo imagen:', err);
          alert(`⚠️ No se pudo subir "${img.file.name}": ${err.message}`);
        }
      }

      // 3. Combinar: existentes + nuevas subidas (en el orden visual final)
      finalImages = currentProductImages
        .map(img => {
          if (img.isNew && img.file) {
            const idx = newImages.indexOf(img);
            return uploadedUrls[idx] || null;
          }
          return img.url;
        })
        .filter(Boolean);

      // 4. Actualizar el doc con las URLs finales
      await updateDoc(doc(db,'products', docId), {
        images: finalImages,
        updatedAt: serverTimestamp()
      });

      data.images = finalImages;
      updateUploadProgress(newImages.length, newImages.length, '');
    }

    // 5. Crear registros de inventario para las variantes (solo si es nuevo)
    if (isNew) {
      for (const vr of variants) {
        for (const store of stores) {
          const invId = `${store.storeId}_${vr.variantId}`;
          const invSnap = await getDoc(doc(db,'inventory',invId));
          if (!invSnap.exists()) {
            await setDoc(doc(db,'inventory',invId), {
              storeId: store.storeId,
              productId: docId,
              variantId: vr.variantId,
              productName: data.name,
              sku: vr.sku,
              color: vr.color,
              colorName: vr.colorName,
              size: vr.size,
              stock: 0,
              minStock: settings.minStock || 5,
              serials: [],
              updatedAt: serverTimestamp()
            });
          }
        }
      }
    }

    // 6. Auditoría (única, al final)
    await audit({
      action: isNew ? 'create' : 'update',
      collection: 'products',
      docId,
      after: data,
      note: `${isNew?'Creado':'Editado'} producto ${data.name}${newImages.length ? ` · ${newImages.length} imagen(es) nueva(s)` : ''}`
    });
  } catch (err) {
    console.error('Error guardando producto:', err);
    alert('❌ Error al guardar: ' + err.message);
    if (saveBtn) {
      saveBtn.classList.remove('btn-saving');
      saveBtn.disabled = false;
      saveBtn.innerText = saveBtn.dataset.originalText || 'Guardar producto';
    }
    if (progressWrap) progressWrap.classList.remove('active');
    return;
  }

  window.SmartecCache.invalidate('products');
  window.SmartecCache.invalidate('inventory');

  // Limpiar blobs en memoria
  currentProductImages.forEach(img => {
    if (img.isNew && img.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(img.previewUrl);
    }
  });
  currentProductImages = [];

  closeForm();
  await loadAll();
};
/* ============================================================
   🆕 SUBIDA DE IMÁGENES A WEBP OPTIMIZADO
============================================================ */

/**
 * Sube una imagen de producto a Storage, convirtiéndola a WebP optimizado.
 * - Redimensiona a máx 2000px en el lado más largo.
 * - Calidad 92%.
 * - Devuelve la URL pública.
 */
async function uploadProductImageAsWebp(file, productId) {
  // 1. Cargar imagen en un objeto Image para conocer dimensiones
  const imageBitmap = await loadImageFromFile(file);

  // 2. Redimensionar a máx 2000 px
  const MAX_DIM = 2000;
  let { width, height } = imageBitmap;
  if (width > MAX_DIM || height > MAX_DIM) {
    const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // 3. Dibujar en canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0, width, height);

  // 4. Convertir a WebP calidad 92%
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('No se pudo convertir a WebP')),
      'image/webp',
      0.92
    );
  });

  // 5. Validar tamaño final
  if (blob.size > 5 * 1024 * 1024) {
    throw new Error('La imagen final supera 5MB incluso después de optimizar');
  }

  // 6. Subir a Storage
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.webp`;
  const path = `products/${productId}/${fileName}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, blob, {
    contentType: 'image/webp',
    cacheControl: 'public, max-age=31536000'
  });

  const url = await getDownloadURL(storageRef);
  return url;
}

/**
 * Carga un File como ImageBitmap (o HTMLImageElement como fallback).
 */
async function loadImageFromFile(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch (e) {
      console.warn('createImageBitmap falló, usando fallback:', e);
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo cargar la imagen'));
    };
    img.src = url;
  });
}

/**
 * Actualiza la barra de progreso de subida.
 */
function updateUploadProgress(done, total, currentFileName) {
  const fill = $('upload-progress-fill');
  const text = $('upload-progress-text');
  const count = $('upload-progress-count');

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  if (fill) fill.style.width = pct + '%';
  if (count) count.innerText = `${done} / ${total}`;

  if (text) {
    if (done >= total && total > 0) {
      text.innerText = '✅ Subida completa';
    } else if (currentFileName) {
      text.innerText = `Procesando: ${currentFileName}`;
    } else {
      text.innerText = 'Subiendo imágenes…';
    }
  }
}
window.delProduct = async (id) => {
  const p = products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`¿Eliminar el producto "${p.name}"?\n\nSe desactivará, NO se borrará (por auditoría).`)) return;

  // Desactivar en lugar de borrar (auditoría)
  await updateDoc(doc(db,'products',id), {
    active: false,
    deletedAt: serverTimestamp(),
    deletedBy: currentUser.email,
    updatedAt: serverTimestamp()
  });

  await audit({
    action: 'delete',
    collection: 'products',
    docId: id,
    before: { active: true, name: p.name },
    after: { active: false },
    note: `Producto desactivado: ${p.name}`
  });

  window.SmartecCache.invalidate('products');
  await loadAll();
};

/* ============================================================
   VENTAS
============================================================ */
/* ============================================================
   🆕 FILTRO DE FECHA DE PAGO EN LA PESTAÑA VENTAS
============================================================ */
window.setSalesPaidRange = (range) => {
  const now = new Date();
  let from, to;

  switch(range) {
    case 'today': from = to = now; break;
    case 'week': {
      const day = now.getDay() || 7;
      from = new Date(now);
      from.setDate(now.getDate() - day + 1);
      to = now;
      break;
    }
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = now;
      break;
    case 'lastmonth':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      to = now;
      break;
    default:
      return;
  }

  const fmtD = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  $('sales-paid-date-from').value = fmtD(from);
  $('sales-paid-date-to').value = fmtD(to);
  renderSales();
};

window.clearSalesPaidDate = () => {
  $('sales-paid-date-from').value = '';
  $('sales-paid-date-to').value = '';
  renderSales();
};

/* Listeners de los inputs de fecha */
document.addEventListener('DOMContentLoaded', () => {
  ['sales-paid-date-from', 'sales-paid-date-to'].forEach(id => {
    const el = $(id);
    if (el && !el.dataset.listeners) {
      el.dataset.listeners = '1';
      el.addEventListener('change', renderSales);
    }
  });
});

/* ============================================================
   RENDER DE LA PESTAÑA VENTAS
============================================================ */
function renderSales() {
  const storeF = $('sales-store-filter')?.value || 'all';
  const methodF = $('sales-payment-method-filter')?.value || 'all';
  const statusF = $('sales-payment-status-filter')?.value || 'all';
  const paidFrom = $('sales-paid-date-from')?.value || '';
  const paidTo = $('sales-paid-date-to')?.value || '';

  const tb = $('sales-tbody');
  let list = sales.slice();

  if (storeF !== 'all') list = list.filter(s => s.storeId === storeF);
  if (methodF !== 'all') list = list.filter(s => s.paymentMethod === methodF);
  if (statusF !== 'all') {
    list = list.filter(s => {
      const ps = s.paymentStatus || 'completed';
      return ps === statusF;
    });
  }

  // 🆕 Filtro por fecha de pago (paidAt con fallback a createdAt)
  if (paidFrom || paidTo) {
    list = list.filter(s => {
      // Fecha de pago: paidAt si existe, si no createdAt
      const ts = s.paidAt?.seconds
        ? s.paidAt.seconds * 1000
        : (s.createdAt?.seconds ? s.createdAt.seconds * 1000 : null);

      if (!ts) return false;

      const d = new Date(ts);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      if (paidFrom && dateStr < paidFrom) return false;
      if (paidTo && dateStr > paidTo) return false;
      return true;
    });
  }

  list.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

  tb.innerHTML = list.length ? list.slice(0,200).map(s => {
    const store = stores.find(x => x.storeId === s.storeId);
    const itemsCount = (s.items||[]).reduce((sum,i) => sum + (i.qty||0), 0);
    const seller = users.find(u => u.id === s.sellerUid);
    const statusCls = s.status==='anulada'?'bg-red-100 text-red-700':
                     s.status==='completada'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700';

    const paymentCell = renderPaymentCell(s);

    // 🆕 Fecha de pago (con formato corto o "sin cobrar")
    const paidAtLabel = s.paidAt?.seconds
      ? `💰 ${new Date(s.paidAt.seconds * 1000).toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'2-digit' })} ${new Date(s.paidAt.seconds * 1000).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })}`
      : (s.paymentStatus === 'pending' ? '⏳ Sin cobrar' : '');
    const paidAtClass = s.paidAt?.seconds ? 'text-green-600' : 'text-amber-600';

    return `<tr class="border-b hover:bg-gray-50 ${s.paymentStatus==='pending'?'bg-amber-50/40':''}">
      <td class="p-3 text-xs text-gray-500">
        ${fmtDate(s.createdAt)}
        ${paidAtLabel ? `<br><span class="${paidAtClass} text-[10px] font-semibold">${paidAtLabel}</span>` : ''}
      </td>
      <td class="p-3 font-medium text-sd">${escapeHtml(s.customer?.name)||'-'}<br><span class="text-[10px] text-gray-400">${s.customer?.phone||''}</span></td>
      <td class="p-3 text-xs">${escapeHtml(store?.name)||s.storeId}</td>
      <td class="p-3 text-xs">${escapeHtml(seller?.name)||s.sellerEmail||'-'}</td>
      <td class="p-3 text-xs">${paymentCell}</td>
      <td class="p-3 text-center">${itemsCount}</td>
      <td class="p-3 text-right font-semibold">${fmt(s.total)}</td>
      <td class="p-3 text-right text-xs text-rose-600 font-semibold">${s.creditCommissionAmount ? '-' + fmt(s.creditCommissionAmount) : '—'}</td>
      <td class="p-3 text-center"><span class="text-xs px-2 py-1 rounded ${statusCls}">${s.status||'pendiente'}</span></td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewSale("${s.id}")' class="text-sl hover:underline text-xs">Ver</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="p-6 text-center text-gray-400">Sin ventas</td></tr>';
}

/* Helper: celda de pago reutilizable */
function renderPaymentCell(s) {
  const method = s.paymentMethod || 'efectivo';
  const status = s.paymentStatus || 'completed';

  const methodLabels = {
    efectivo: '💵 Efectivo',
    transferencia: '🔄 Transferencia',
    tarjeta: '💳 Tarjeta',
    contraentrega: '📦 Contra entrega',
    credito: '🛍️ Crédito',
    nequi: '📱 Nequi'  // legacy
  };
  const methodLabel = methodLabels[method] || method;

  // Canal (si aplica)
  let channelLine = '';
  if (method === 'transferencia' && s.paymentChannelBank) {
    const icon = s.paymentChannelIcon || '🏦';
    const name = s.paymentChannelName ? ` — ${s.paymentChannelName}` : '';
    channelLine = `<div class="text-[10px] text-gray-500 mt-0.5">${icon} ${escapeHtml(s.paymentChannelBank)}${escapeHtml(name)}</div>`;
  } else if (method === 'credito' && s.paymentChannelBank) {
    const icon = s.paymentChannelIcon || '🛍️';
    channelLine = `<div class="text-[10px] text-gray-500 mt-0.5">${icon} ${escapeHtml(s.paymentChannelBank)}</div>`;
  }

  // Badge de estado
  let statusBadge = '';
  if (status === 'pending') {
    statusBadge = '<span class="inline-block text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold mt-1">⏳ PENDIENTE</span>';
  }

  return `<div>
    <div class="font-medium text-sd text-xs">${methodLabel}</div>
    ${channelLine}
    ${statusBadge}
  </div>`;
}

window.viewSale = async (id) => {
  const s = sales.find(x => x.id === id);
  if (!s) return;
  const store = stores.find(x => x.storeId === s.storeId);
  const seller = users.find(u => u.id === s.sellerUid);

  $('sale-detail').innerHTML = `
    <div class="grid grid-cols-2 gap-3 text-sm mb-4">
      <div><p class="text-xs text-gray-400">Fecha</p><p class="font-semibold">${fmtDate(s.createdAt)}</p></div>
      <div><p class="text-xs text-gray-400">Estado</p><p class="font-semibold">${s.status||'pendiente'}</p></div>
      <div><p class="text-xs text-gray-400">Tienda</p><p class="font-semibold">${escapeHtml(store?.name)||s.storeId}</p></div>
      <div><p class="text-xs text-gray-400">Vendedor</p><p class="font-semibold">${escapeHtml(seller?.name)||s.sellerEmail||'-'}</p></div>
    </div>
    <div class="bg-gray-50 p-3 rounded-lg mb-4 text-sm">
      <p class="font-bold text-sd mb-2">Cliente</p>
      <p><b>${escapeHtml(s.customer?.name)||'-'}</b></p>
      <p class="text-xs text-gray-500">${s.customer?.phone||''} · ${escapeHtml(s.customer?.email)}</p>
      <p class="text-xs text-gray-500">${escapeHtml(s.customer?.address)} ${escapeHtml(s.customer?.city)}</p>
      ${s.customer?.notes?`<p class="text-xs text-gray-500 mt-1 italic">"${escapeHtml(s.customer.notes)}"</p>`:''}
    </div>
    <div class="mb-4">
      <p class="font-bold text-sd mb-2 text-sm">Productos</p>
      <div class="space-y-2">
        ${(s.items||[]).map(it => {
          const hasEx = !!it.priceException;
          return `
          <div class="flex justify-between border-b pb-2 text-sm ${hasEx ? 'bg-orange-50/50 -mx-1 px-1 rounded' : ''}">
            <div class="min-w-0 flex-1">
              <p class="font-medium text-sd truncate">
                ${hasEx ? '⚠️ ' : ''}${escapeHtml(it.name)}
              </p>
              <p class="text-[10px] text-gray-400">${escapeHtml(it.sku)} ${it.color?'· '+colorNameFromHex(it.color):''} ${escapeHtml(it.size)?'· '+escapeHtml(it.size):''}</p>
              ${hasEx ? `
                <p class="text-[10px] text-orange-600 font-semibold mt-0.5">
                  🔒 Mín: ${fmt(it.priceException.minPrice)} → ${fmt(it.priceException.finalPrice)}
                  (${it.priceException.differencePct.toFixed(1)}%)
                </p>
                <p class="text-[10px] text-orange-500 leading-tight">
                  ✅ ${escapeHtml(it.priceException.authorizedByName || '—')} · ${escapeHtml(it.priceException.authorizedByRole || '—')}
                </p>
                <p class="text-[10px] text-gray-500 italic leading-tight">
                  "${escapeHtml(it.priceException.reason || '')}"
                </p>
              ` : ''}
            </div>
            <div class="text-right whitespace-nowrap ml-3">
              <p class="text-xs">${it.qty} × ${fmt(it.unitPrice)}</p>
              <p class="font-bold ${hasEx ? 'text-orange-600' : 'text-sl'}">${fmt(it.qty*it.unitPrice)}</p>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
        <div class="bg-gray-50 p-3 rounded-lg text-sm space-y-1 mb-4">
      <div class="flex justify-between"><span>Subtotal</span><span>${fmt(s.subtotal)}</span></div>
      ${s.discount?`<div class="flex justify-between text-red-500"><span>Descuento</span><span>-${fmt(s.discount)}</span></div>`:''}
      ${s.shipping?`<div class="flex justify-between"><span>Envío</span><span>${fmt(s.shipping)}</span></div>`:''}
      ${s.surchargeAmount?`<div class="flex justify-between text-gray-600"><span>Recargo tarjeta</span><span>${fmt(s.surchargeAmount)}</span></div>`:''}
      <div class="flex justify-between font-bold text-sd border-t pt-2"><span>TOTAL</span><span>${fmt(s.total)}</span></div>
      <div class="flex justify-between text-xs text-gray-500"><span>Costo</span><span>${fmt(s.totalCost)}</span></div>
      <div class="flex justify-between text-xs text-green-600 font-semibold"><span>Utilidad</span><span>${fmt(s.profit)}</span></div>
    </div>
    ${renderPaymentDetail(s)}

    <!-- 🆕 Documentos PDF (remisión, tirilla, media carta) -->
    ${renderDocumentsSection(s)}

    <div class="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm mb-4">
      <p class="font-bold text-orange-700 mb-2">💰 Comisiones generadas</p>
      <div class="flex justify-between text-xs">
        <span>Pool vendedor (${((s.poolRate || s.commissionRate || 0)*100).toFixed(2)}%)</span>
        <span class="font-semibold text-sl">${fmt(s.poolAmount || s.commissionAmount || 0)}</span>
      </div>
      ${s.bonusAmount ? `
        <div class="flex justify-between text-xs mt-1">
          <span>Bonus meta (${((s.bonusRate||0)*100).toFixed(2)}%)</span>
          <span class="font-semibold text-green-600">${fmt(s.bonusAmount)}</span>
        </div>
      ` : ''}
      <div class="flex justify-between font-bold mt-2 pt-2 border-t border-orange-200">
        <span>Total comisión</span>
        <span>${fmt((s.poolAmount || s.commissionAmount || 0) + (s.bonusAmount || 0))}</span>
      </div>
    </div>

    ${s.hasPriceExceptions && Array.isArray(s.priceExceptions) && s.priceExceptions.length ? `
      <div class="bg-orange-50 border-2 border-orange-300 rounded-lg p-3 text-sm mb-4">
        <p class="font-bold text-orange-700 mb-2 flex items-center gap-2">
          ⚠️ Excepciones de precio autorizadas (${s.priceExceptions.length})
        </p>
        <div class="space-y-2">
          ${s.priceExceptions.map(ex => `
            <div class="bg-white rounded-lg p-2 text-xs border border-orange-200">
              <p class="font-semibold text-orange-800 mb-1">${escapeHtml(ex.name)}</p>
              <div class="grid grid-cols-2 gap-1 text-[10px] text-gray-600">
                <div>Mínimo: <b class="text-red-600">${fmt(ex.minPrice)}</b></div>
                <div>Vendido: <b class="text-orange-600">${fmt(ex.finalPrice)}</b></div>
                <div>Diferencia: <b class="text-red-600">-${fmt(Math.abs(ex.difference))}</b></div>
                <div>Rebaja: <b>${ex.differencePct.toFixed(1)}%</b></div>
              </div>
              <div class="mt-1.5 pt-1.5 border-t border-orange-100 text-[10px]">
                <p class="text-gray-500">
                  <b>Autorizado por:</b> ${escapeHtml(ex.authorizedByName || '—')} · ${escapeHtml(ex.authorizedByRole || '—')}
                </p>
                <p class="text-gray-500 italic mt-0.5">
                  <b>Motivo:</b> "${escapeHtml(ex.reason || '—')}"
                </p>
              </div>
            </div>
          `).join('')}
        </div>
        <p class="text-[10px] text-orange-600 mt-2 pt-2 border-t border-orange-200">
          Total descontado por excepciones: <b>-${fmt(s.totalDiscountFromExceptions || 0)}</b>
        </p>
      </div>
    ` : ''}

    ${s.status === 'anulada' ? `
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm mb-3">
        <p class="font-bold text-red-700 mb-1">Venta anulada</p>
        <p class="text-xs text-red-600">Motivo: ${escapeHtml(s.cancelReason)||'-'}</p>
        <p class="text-xs text-gray-500 mt-1">Por: ${escapeHtml(s.cancelledBy)||'-'} · ${fmtDate(s.cancelledAt)}</p>
      </div>
    ` : (['superadmin','admin'].includes(currentUserData.role) ? `
      <button onclick="cancelSale('${s.id}')" class="w-full bg-red-500 text-white py-2 rounded-lg hover:bg-red-600 font-semibold text-sm">
        ⛔ Anular venta
      </button>
    ` : '')}
  `;

  const m = $('sale-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

/* ============================================================
   🆕 DOCUMENTOS PDF EN EL DETALLE DE VENTA
   Muestra los botones para abrir remisión, tirilla y media carta.
   Si aún no se han generado, muestra un botón "Regenerar".
============================================================ */
function renderDocumentsSection(s) {
  const docs = s.documents || null;

  // Si no hay documentos, mostrar aviso + botón para regenerar
  if (!docs) {
    return `
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm mb-4">
        <div class="flex justify-between items-start mb-2 flex-wrap gap-2">
          <div>
            <p class="font-bold text-amber-700">📄 Documentos</p>
            <p class="text-xs text-amber-600 mt-0.5">Los PDFs aún no se han generado para esta venta.</p>
          </div>
          <button onclick="regenerateDocuments('${s.id}')"
            class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition shadow-apple">
            🔄 Regenerar documentos
          </button>
        </div>
      </div>
    `;
  }

  const docTypes = [
    { key: 'remision',   icon: '📄', label: 'Remisión',     color: 'blue'   },
    { key: 'tirilla',    icon: '🧾', label: 'Tirilla POS',  color: 'green'  },
    { key: 'mediacarta', icon: '📋', label: 'Media carta',  color: 'purple' },
  ];

  const buttonsHtml = docTypes.map(dt => {
    const d = docs[dt.key];
    if (!d || !d.url) {
      return `
        <div class="flex-1 min-w-[120px] bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
          <p class="text-xs text-gray-400">${dt.icon} ${dt.label}</p>
          <p class="text-[10px] text-gray-400 mt-1">No generado</p>
        </div>
      `;
    }
    return `
      <a href="${d.url}" target="_blank"
         class="flex-1 min-w-[120px] bg-white border border-${dt.color}-200 rounded-lg p-3 text-center hover:border-${dt.color}-400 hover:shadow-md transition">
        <p class="text-xs font-semibold text-${dt.color}-700">${dt.icon} ${dt.label}</p>
        <p class="text-[10px] text-gray-500 mt-1">${Math.round((d.size || 0) / 1024)} KB · Ver PDF</p>
      </a>
    `;
  }).join('');

  return `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm mb-4">
      <div class="flex justify-between items-center mb-3 flex-wrap gap-2">
        <div>
          <p class="font-bold text-blue-700">📄 Documentos</p>
          <p class="text-xs text-blue-600 mt-0.5">Descargar los 3 formatos generados</p>
        </div>
        <button onclick="regenerateDocuments('${s.id}')"
          class="text-xs text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-1">
          🔄 Regenerar
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        ${buttonsHtml}
      </div>
    </div>
  `;
}

/* Helper: sección de detalle de pago para el modal */
function renderPaymentDetail(s) {
  const method = s.paymentMethod || 'efectivo';
  const status = s.paymentStatus || 'completed';

  const methodLabels = {
    efectivo: '💵 Efectivo',
    transferencia: '🔄 Transferencia',
    tarjeta: '💳 Tarjeta',
    contraentrega: '📦 Contra entrega',
    credito: '🛍️ Crédito',
    nequi: '📱 Nequi (legacy)'
  };
  const methodLabel = methodLabels[method] || method;

  const statusBadge = status === 'pending'
    ? '<span class="bg-amber-100 text-amber-700 text-xs px-3 py-1 rounded-full font-bold">⏳ PAGO PENDIENTE</span>'
    : '<span class="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full font-semibold">✅ Pagado</span>';

  let channelSection = '';

  if (method === 'transferencia' && s.paymentChannelBank) {
    const icon = s.paymentChannelIcon || '🏦';
    channelSection = `
      <div class="grid grid-cols-2 gap-2 text-xs mt-2">
        <div><p class="text-gray-400">Banco/Plataforma</p><p class="font-semibold">${icon} ${escapeHtml(s.paymentChannelBank)}</p></div>
        ${s.paymentChannelName ? `<div><p class="text-gray-400">Nombre</p><p class="font-semibold">${escapeHtml(s.paymentChannelName)}</p></div>` : ''}
        ${s.paymentChannelAccount ? `<div><p class="text-gray-400">Cuenta</p><p class="font-mono font-semibold">${escapeHtml(s.paymentChannelAccount)}</p></div>` : ''}
        ${s.paymentChannelCode ? `<div><p class="text-gray-400">Código</p><p class="font-mono font-semibold">${escapeHtml(s.paymentChannelCode)}</p></div>` : ''}
      </div>
    `;
  } else if (method === 'credito' && s.paymentChannelBank) {
    const icon = s.paymentChannelIcon || '🛍️';
    channelSection = `
      <div class="grid grid-cols-2 gap-2 text-xs mt-2">
        <div><p class="text-gray-400">Entidad</p><p class="font-semibold">${icon} ${escapeHtml(s.paymentChannelBank)}</p></div>
        ${s.paymentChannelName ? `<div><p class="text-gray-400">Notas</p><p class="font-semibold">${escapeHtml(s.paymentChannelName)}</p></div>` : ''}
        ${s.paymentChannelCode ? `<div><p class="text-gray-400">Código</p><p class="font-mono font-semibold">${escapeHtml(s.paymentChannelCode)}</p></div>` : ''}
      </div>
    `;
  } else if (method === 'contraentrega') {
    channelSection = `
      <p class="text-xs text-amber-700 mt-2">
        Esta venta se registró como <b>contra entrega</b>.
        El cobro se debe confirmar al momento de la entrega.
      </p>
    `;
  }

  return `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm mb-4">
      <div class="flex justify-between items-start mb-2">
        <p class="font-bold text-blue-700">💳 Información de pago</p>
        ${statusBadge}
      </div>
      <p class="text-sm font-semibold text-sd">${methodLabel}</p>
      ${channelSection}
    </div>
  `;
}

window.closeSaleModal = () => { const m=$('sale-modal'); m.classList.add('hidden'); m.classList.remove('flex'); };

window.cancelSale = async (id) => {
  const s = sales.find(x => x.id === id);
  if (!s) return;
  const reason = prompt('Motivo de la anulación (obligatorio):');
  if (!reason || !reason.trim()) return alert('Debes escribir el motivo');

  await updateDoc(doc(db,'sales',id), {
    status: 'anulada',
    cancelReason: reason.trim(),
    cancelledAt: serverTimestamp(),
    cancelledBy: currentUser.email
  });

  // Devolver stock a inventario
  for (const it of (s.items||[])) {
    const invId = `${s.storeId}_${it.variantId || ''}`;
    const invRef = doc(db,'inventory', invId);
    const invSnap = await getDoc(invRef);
    if (invSnap.exists()) {
      await updateDoc(invRef, { stock: Number(invSnap.data().stock||0) + Number(it.qty||0) });
    }
  }

  await audit({
    action: 'cancel',
    collection: 'sales',
    docId: id,
    before: { status: s.status },
    after: { status: 'anulada', cancelReason: reason },
    note: `Venta anulada: ${reason}`
  });

  window.SmartecCache.invalidate('sales'); 
  window.SmartecCache.invalidate('inventory');
  closeSaleModal();
  await loadAll();
};

/* ============================================================
   AUDITORÍA
============================================================ */
/* ============================================================
   AUDITORÍA — Versión reestructurada (trazabilidad completa)
   ============================================================ */

// Estado de filtros rápidos
let auditQuickFilter = 'all';

// Helpers de severidad
function auditSeverity(a) {
  return a.severity || window.Smartec?.getSeverity?.(a.action) || 'medium';
}

function auditSeverityBadge(a) {
  const s = auditSeverity(a);
  const map = {
    critical: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', icon: '🔴', label: 'Crítica' },
    high:     { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300', icon: '🟠', label: 'Alta' },
    medium:   { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300', icon: '🔵', label: 'Media' },
    low:      { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', icon: '🟢', label: 'Baja' }
  };
  const m = map[s] || map.medium;
  return `<span class="inline-flex items-center justify-center w-6 h-6 rounded-full ${m.bg} ${m.text} text-xs font-bold" title="Severidad ${m.label}">${m.icon}</span>`;
}

function auditActionBadge(action) {
  const map = {
    create:  { bg: 'bg-green-100 text-green-700',  label: '🆕 Crear' },
    update:  { bg: 'bg-blue-100 text-blue-700',    label: '✏️ Editar' },
    delete:  { bg: 'bg-red-100 text-red-700',      label: '🗑 Borrar' },
    sale:    { bg: 'bg-purple-100 text-purple-700', label: '💰 Venta' },
    login:   { bg: 'bg-gray-100 text-gray-700',    label: '🔐 Login' },
    logout:  { bg: 'bg-gray-100 text-gray-700',    label: '🚪 Logout' },
    cancel:  { bg: 'bg-orange-100 text-orange-700', label: '📉 Anulación' },
    seed:    { bg: 'bg-yellow-100 text-yellow-700', label: '🌱 Migración' },
    cleanup: { bg: 'bg-pink-100 text-pink-700',    label: '🧹 Limpieza' },
    price_exception: { bg: 'bg-amber-100 text-amber-700', label: '⚠️ Excepción precio' }
  };
  const m = map[action] || { bg: 'bg-gray-100 text-gray-700', label: action };
  return `<span class="text-[10px] px-2 py-0.5 rounded ${m.bg} font-semibold whitespace-nowrap">${m.label}</span>`;
}

function auditRoleBadge(role) {
  const map = {
    superadmin: 'bg-purple-100 text-purple-700',
    admin:      'bg-blue-100 text-blue-700',
    vendedor:   'bg-gray-100 text-gray-700'
  };
  return `<span class="text-[10px] px-2 py-0.5 rounded ${map[role] || 'bg-gray-100 text-gray-600'} font-semibold">${escapeHtml(role) || '—'}</span>`;
}

function auditCollectionLabel(coll) {
  const map = {
    products: '📦 Productos',
    sales: '💰 Ventas',
    stores: '🏪 Tiendas',
    users: '👤 Usuarios',
    inventory: '📊 Inventario',
    inventoryMovements: '🔄 Movs. inv.',
    promos: '🎁 Promos',
    cashRegisters: '🌅 Arqueos',
    paymentChannels: '💳 Métodos pago',
    paymentPlatforms: '🏦 Plataformas',
    transferRequests: '📤 Traslados',
    storeGoals: '🎯 Metas',
    settings: '⚙️ Config',
    suppliers: '🏭 Proveedores',
    expenses: '💸 Gastos',
    customers: '👥 Clientes',
    warranties: '🛡️ Garantías',
    system: '🔧 Sistema',
    counters: '🔢 Consecutivos',
    audits: '📋 Auditoría'
  };
  return map[coll] || coll || '—';
}

// ============================================================
// Filtros rápidos
// ============================================================
window.setAuditQuickFilter = (key) => {
  auditQuickFilter = key;
  // Actualizar estilo de los botones
  document.querySelectorAll('.audit-quick-btn').forEach(btn => {
    const isActive = btn.dataset.quick === key;
    if (isActive) {
      // Activar
      const colorMap = {
        all: 'border-sl bg-sl text-white',
        critical: 'border-red-500 bg-red-500 text-white',
        cancel: 'border-orange-500 bg-orange-500 text-white',
        delete: 'border-red-500 bg-red-500 text-white',
        cashRegisters: 'border-blue-500 bg-blue-500 text-white',
        sales: 'border-purple-500 bg-purple-500 text-white',
        inventory: 'border-amber-500 bg-amber-500 text-white',
        users: 'border-gray-500 bg-gray-500 text-white',
        paymentChannels: 'border-cyan-500 bg-cyan-500 text-white'
      };
      btn.className = `audit-quick-btn px-3 py-1.5 rounded-full text-xs font-semibold border-2 ${colorMap[key] || colorMap.all}`;
    } else {
      // Resetear a inactivo
      const inactiveMap = {
        all: 'border-sl text-sl hover:bg-blue-50',
        critical: 'border-red-300 text-red-700 hover:bg-red-50',
        cancel: 'border-orange-300 text-orange-700 hover:bg-orange-50',
        delete: 'border-red-300 text-red-700 hover:bg-red-50',
        cashRegisters: 'border-blue-300 text-blue-700 hover:bg-blue-50',
        sales: 'border-purple-300 text-purple-700 hover:bg-purple-50',
        inventory: 'border-amber-300 text-amber-700 hover:bg-amber-50',
        users: 'border-gray-300 text-gray-700 hover:bg-gray-50',
        paymentChannels: 'border-cyan-300 text-cyan-700 hover:bg-cyan-50'
      };
      btn.className = `audit-quick-btn px-3 py-1.5 rounded-full text-xs font-semibold border-2 ${inactiveMap[btn.dataset.quick] || inactiveMap.all}`;
    }
  });
  renderAudit();
};

// ============================================================
// Rango de fechas rápidas
// ============================================================
window.setAuditRange = (range) => {
  const now = new Date();
  let from, to;
  switch(range) {
    case 'today': from = to = now; break;
    case 'week': {
      const day = now.getDay() || 7;
      from = new Date(now); from.setDate(now.getDate() - day + 1);
      to = now;
      break;
    }
    case 'month': from = new Date(now.getFullYear(), now.getMonth(), 1); to = now; break;
    case 'lastmonth':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'year': from = new Date(now.getFullYear(), 0, 1); to = now; break;
    default: return;
  }
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fromEl = $('audit-date-from');
  const toEl = $('audit-date-to');
  if (fromEl) fromEl.value = fmtD(from);
  if (toEl) toEl.value = fmtD(to);
  renderAudit();
};

window.clearAuditFilters = () => {
  const setVal = (id, val) => { const el = $(id); if (el) el.value = val; };
  setVal('audit-date-from', '');
  setVal('audit-date-to', '');
  setVal('audit-role-filter', 'all');
  setVal('audit-user-filter', 'all');
  setVal('audit-severity-filter', 'all');
  setVal('audit-action-filter', 'all');
  setVal('audit-collection-filter', 'all');
  setVal('audit-search', '');
  auditQuickFilter = 'all';
  setAuditQuickFilter('all');
};

// ============================================================
// Poblar dropdown de usuarios
// ============================================================
function populateAuditUserFilter() {
  const sel = $('audit-user-filter');
  if (!sel || sel.dataset.loaded) return;
  sel.dataset.loaded = '1';

  // Combinar usuarios de auditLogs + users actuales
  const map = new Map();
  auditLogs.forEach(a => {
    if (a.userEmail && !map.has(a.userEmail)) {
      map.set(a.userEmail, a.userName || a.userEmail);
    }
  });
  users.forEach(u => {
    if (u.email && !map.has(u.email)) {
      map.set(u.email, u.name || u.email);
    }
  });

  const list = Array.from(map.entries()).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));
  sel.innerHTML = '<option value="all">Todos los usuarios</option>' +
    list.map(([email, name]) =>
      `<option value="${escapeHtml(email)}">${escapeHtml(name)} — ${escapeHtml(email)}</option>`
    ).join('');
}

// ============================================================
// Filtrado principal
// ============================================================
function getFilteredAudit() {
  let list = auditLogs.slice();

  // Filtro rápido
  if (auditQuickFilter === 'critical') {
    list = list.filter(a => auditSeverity(a) === 'critical');
  } else if (auditQuickFilter === 'cancel') {
    list = list.filter(a => a.action === 'cancel');
  } else if (auditQuickFilter === 'delete') {
    list = list.filter(a => a.action === 'delete');
  } else if (auditQuickFilter === 'cashRegisters') {
    list = list.filter(a => a.collection === 'cashRegisters');
  } else if (auditQuickFilter === 'sales') {
    list = list.filter(a => a.collection === 'sales');
  } else if (auditQuickFilter === 'inventory') {
    list = list.filter(a => a.collection === 'inventory' || a.collection === 'inventoryMovements');
  } else if (auditQuickFilter === 'users') {
    list = list.filter(a => a.collection === 'users' || a.action === 'login' || a.action === 'logout');
  } else if (auditQuickFilter === 'paymentChannels') {
    list = list.filter(a => a.collection === 'paymentChannels' || a.collection === 'paymentPlatforms');
  }

  // Fecha desde
  const from = $('audit-date-from')?.value;
  if (from) {
    const fromTs = new Date(from + 'T00:00:00').getTime() / 1000;
    list = list.filter(a => (a.timestamp?.seconds || 0) >= fromTs);
  }
  // Fecha hasta
  const to = $('audit-date-to')?.value;
  if (to) {
    const toTs = new Date(to + 'T23:59:59').getTime() / 1000;
    list = list.filter(a => (a.timestamp?.seconds || 0) <= toTs);
  }

  // Rol
  const roleF = $('audit-role-filter')?.value || 'all';
  if (roleF !== 'all') list = list.filter(a => a.userRole === roleF);

  // Usuario
  const userF = $('audit-user-filter')?.value || 'all';
  if (userF !== 'all') list = list.filter(a => a.userEmail === userF);

  // Severidad
  const sevF = $('audit-severity-filter')?.value || 'all';
  if (sevF !== 'all') list = list.filter(a => auditSeverity(a) === sevF);

  // Acción
  const actionF = $('audit-action-filter')?.value || 'all';
  if (actionF !== 'all') list = list.filter(a => a.action === actionF);

  // Colección
  const collF = $('audit-collection-filter')?.value || 'all';
  if (collF !== 'all') list = list.filter(a => a.collection === collF);

  // Búsqueda libre
  const searchF = ($('audit-search')?.value || '').toLowerCase().trim();
  if (searchF) {
    list = list.filter(a =>
      (a.note || '').toLowerCase().includes(searchF) ||
      (a.docId || '').toLowerCase().includes(searchF) ||
      (a.changeSummary || '').toLowerCase().includes(searchF) ||
      (a.userEmail || '').toLowerCase().includes(searchF) ||
      (a.userName || '').toLowerCase().includes(searchF) ||
      (a.entityLabel || '').toLowerCase().includes(searchF)
    );
  }

  // Ordenar por fecha descendente
  list.sort((a,b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

  return list;
}

// ============================================================
// Render de KPIs
// ============================================================
function renderAuditKPIs(list) {
  const total = list.length;
  const critical = list.filter(a => auditSeverity(a) === 'critical').length;
  const uniqueUsers = new Set(list.map(a => a.userEmail).filter(Boolean)).size;

  // Última actividad (en toda la lista filtrada, no solo la página)
  const last = list[0];
  let lastLabel = '—', lastSub = 'hace —';
  if (last?.timestamp?.seconds) {
    lastLabel = fmtDate(last.timestamp);
    lastSub = 'hace ' + timeAgo(last.timestamp);
  }

  const setTxt = (id, val) => { const el = $(id); if (el) el.innerText = val; };
  setTxt('audit-kpi-total', total);
  setTxt('audit-kpi-total-sub', `en el período`);
  setTxt('audit-kpi-critical', critical);
  setTxt('audit-kpi-critical-sub', critical > 0 ? '⚠️ requieren atención' : '✅ sin eventos críticos');
  setTxt('audit-kpi-users', uniqueUsers);
  setTxt('audit-kpi-users-sub', uniqueUsers === 1 ? 'usuario distinto' : 'usuarios distintos');
  setTxt('audit-kpi-last', lastLabel);
  setTxt('audit-kpi-last-sub', lastSub);
}

// Helper: hace X tiempo
function timeAgo(ts) {
  if (!ts?.seconds) return '—';
  const diff = Math.floor((Date.now() - ts.seconds * 1000) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff/60)} min`;
  if (diff < 86400) return `${Math.floor(diff/3600)} h`;
  if (diff < 604800) return `${Math.floor(diff/86400)} d`;
  return fmtDate(ts);
}

// ============================================================
// Render principal
// ============================================================
function renderAudit() {
  if (currentUserData.role !== 'superadmin') {
    $('audit-tbody').innerHTML = '<tr><td colspan="8" class="p-6 text-center text-gray-400">Solo superadmin tiene acceso a la auditoría.</td></tr>';
    return;
  }

  populateAuditUserFilter();

  const list = getFilteredAudit();

  // KPIs
  renderAuditKPIs(list);

  // Contador
  const countEl = $('audit-results-count');
  if (countEl) countEl.innerText = `${list.length} evento${list.length !== 1 ? 's' : ''}`;

  // Tabla
  const tb = $('audit-tbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-gray-400">Sin registros con esos filtros</td></tr>';
    return;
  }

  tb.innerHTML = list.slice(0, 500).map(a => {
    const summary = a.changeSummary || a.note || '—';
    const userLabel = a.userName || a.userEmail || '—';
    return `<tr class="border-b hover:bg-gray-50 cursor-pointer" onclick='viewAudit("${a.id}")'>
      <td class="p-3 text-center">${auditSeverityBadge(a)}</td>
      <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${fmtDate(a.timestamp)}</td>
      <td class="p-3 text-xs">
        <p class="font-medium text-sd truncate max-w-[180px]">${escapeHtml(userLabel)}</p>
        <p class="text-[10px] text-gray-400 truncate max-w-[180px]">${escapeHtml(a.userEmail) || ''}</p>
      </td>
      <td class="p-3 text-center">${auditRoleBadge(a.userRole)}</td>
      <td class="p-3">${auditActionBadge(a.action)}</td>
      <td class="p-3 text-xs">${auditCollectionLabel(a.collection)}</td>
      <td class="p-3 text-xs text-gray-600 max-w-md truncate">${escapeHtml(summary)}</td>
      <td class="p-3 text-right">
        <button onclick='event.stopPropagation(); viewAudit("${a.id}")' class="text-sl hover:underline text-xs">Ver →</button>
      </td>
    </tr>`;
  }).join('');

  // Si hay más de 500, avisar
  if (list.length > 500) {
    tb.innerHTML += `<tr><td colspan="8" class="p-3 text-center text-xs text-amber-600">Mostrando primeros 500 de ${list.length}. Refina los filtros para ver más específico.</td></tr>`;
  }
}

// ============================================================
// Listeners de los filtros (enganchar una sola vez)
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const ids = ['audit-date-from','audit-date-to','audit-role-filter','audit-user-filter',
               'audit-severity-filter','audit-action-filter','audit-collection-filter','audit-search'];
  ids.forEach(id => {
    const el = $(id);
    if (!el || el.dataset.auditListeners) return;
    el.dataset.auditListeners = '1';
    el.addEventListener('input', renderAudit);
    el.addEventListener('change', renderAudit);
  });
});

window.viewAudit = (id) => {
  const a = auditLogs.find(x => x.id === id);
  if (!a) return;

  const sev = auditSeverity(a);
  const sevColors = {
    critical: 'bg-red-100 text-red-700 border-red-300',
    high:     'bg-orange-100 text-orange-700 border-orange-300',
    medium:   'bg-blue-100 text-blue-700 border-blue-300',
    low:      'bg-green-100 text-green-700 border-green-300'
  };
  const sevLabels = { critical: '🔴 Crítica', high: '🟠 Alta', medium: '🔵 Media', low: '🟢 Baja' };

  // Diff visual (si existe before/after)
  let diffHtml = '';
  if (a.changedFields && a.changedFields.length) {
    diffHtml = `
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p class="text-xs font-bold text-amber-800 mb-2">📝 Campos modificados (${a.changedFields.length})</p>
        <div class="flex flex-wrap gap-1">
          ${a.changedFields.map(f => `<span class="text-[10px] bg-white border border-amber-300 text-amber-800 px-2 py-0.5 rounded font-mono">${escapeHtml(f)}</span>`).join('')}
        </div>
        ${a.changeSummary ? `<p class="text-xs text-amber-700 mt-2 italic">"${escapeHtml(a.changeSummary)}"</p>` : ''}
      </div>
    `;
  }

  $('audit-detail').innerHTML = `
    <div class="space-y-4 text-sm">

      <!-- Encabezado con severidad y acción -->
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <span class="text-xs px-3 py-1 rounded-full border-2 font-bold ${sevColors[sev]}">
            ${sevLabels[sev]}
          </span>
          ${auditActionBadge(a.action)}
        </div>
        <div class="text-right">
          <p class="text-xs text-gray-400">${fmtDate(a.timestamp)}</p>
          <p class="text-[10px] text-gray-400">hace ${timeAgo(a.timestamp)}</p>
        </div>
      </div>

      <!-- Quién -->
      <div class="bg-gray-50 rounded-lg p-3">
        <p class="text-[10px] font-bold text-gray-500 uppercase mb-2">👤 Usuario</p>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div><p class="text-gray-500">Nombre</p><p class="font-semibold">${escapeHtml(a.userName) || escapeHtml(a.userEmail) || '—'}</p></div>
          <div><p class="text-gray-500">Email</p><p class="font-semibold text-xs">${escapeHtml(a.userEmail) || '—'}</p></div>
          <div><p class="text-gray-500">Rol</p><p>${auditRoleBadge(a.userRole)}</p></div>
          <div><p class="text-gray-500">Tienda</p><p class="font-semibold">${escapeHtml(a.userStoreName) || escapeHtml(a.storeId) || '—'}</p></div>
        </div>
      </div>

      <!-- Qué -->
      <div class="bg-gray-50 rounded-lg p-3">
        <p class="text-[10px] font-bold text-gray-500 uppercase mb-2">🎯 Qué afectó</p>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div><p class="text-gray-500">Colección</p><p class="font-semibold">${auditCollectionLabel(a.collection)}</p></div>
          <div><p class="text-gray-500">Doc ID</p><p class="font-mono text-[10px] truncate">${escapeHtml(a.docId) || '—'}</p></div>
          ${a.entityLabel ? `<div class="col-span-2"><p class="text-gray-500">Entidad</p><p class="font-semibold">${escapeHtml(a.entityLabel)}</p></div>` : ''}
        </div>
      </div>

      <!-- Nota -->
      ${a.note ? `
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p class="text-[10px] font-bold text-blue-800 uppercase mb-1">📝 Nota</p>
          <p class="text-xs text-blue-900">${escapeHtml(a.note)}</p>
        </div>
      ` : ''}

      <!-- Resumen del cambio -->
      ${a.changeSummary ? `
        <div class="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <p class="text-[10px] font-bold text-purple-800 uppercase mb-1">🔍 Resumen del cambio</p>
          <p class="text-xs text-purple-900">${escapeHtml(a.changeSummary)}</p>
        </div>
      ` : ''}

      <!-- Campos modificados -->
      ${diffHtml}

      <!-- Sesión -->
      ${a.sessionId ? `
        <div class="text-[10px] text-gray-400 text-center">
          Sesión: <span class="font-mono">${escapeHtml(a.sessionId)}</span>
        </div>
      ` : ''}

      <!-- Antes/Después (colapsables) -->
      ${a.before ? `
        <details class="bg-red-50 border border-red-200 rounded-lg">
          <summary class="p-3 text-xs font-bold text-red-800 cursor-pointer">📤 Estado anterior (click para ver)</summary>
          <pre class="p-3 text-[10px] overflow-x-auto scrollbar-thin bg-white/50 rounded-b-lg">${escapeHtml(JSON.stringify(a.before, null, 2))}</pre>
        </details>
      ` : ''}

      ${a.after ? `
        <details class="bg-green-50 border border-green-200 rounded-lg">
          <summary class="p-3 text-xs font-bold text-green-800 cursor-pointer">📥 Estado nuevo (click para ver)</summary>
          <pre class="p-3 text-[10px] overflow-x-auto scrollbar-thin bg-white/50 rounded-b-lg">${escapeHtml(JSON.stringify(a.after, null, 2))}</pre>
        </details>
      ` : ''}

    </div>
  `;
  const m = $('audit-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

/* ============================================================
   🆕 EXPORTAR AUDITORÍA — BOTONES DIRECTOS
   Se llaman desde los botones de la UI. Ya no preguntan nada.
============================================================ */
window.exportAuditExcelDirect = async () => {
  if (!window.ExcelJS) {
    try { await loadLazyLibs('exceljs'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de Excel.\n\n' + e.message); return; }
  }
  const list = getFilteredAudit();
  if (!list.length) {
    alert('No hay eventos para exportar con los filtros actuales.');
    return;
  }
  await exportAuditExcel(list);
};

window.exportAuditPDFDirect = async () => {
  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }
  const list = getFilteredAudit();
  if (!list.length) {
    alert('No hay eventos para exportar con los filtros actuales.');
    return;
  }
  exportAuditPDF(list);
};

/* ============================================================
   EXPORTAR AUDITORÍA A EXCEL (XLSX) — solo lo filtrado
   ============================================================ */
/* ============================================================
   EXPORTAR AUDITORÍA A EXCEL (XLSX) con ExcelJS — solo lo filtrado
   ============================================================ */
async function exportAuditExcel(list) {
  if (!window.ExcelJS) {
    alert('⚠️ La librería de Excel aún no ha cargado. Espera unos segundos y vuelve a intentar.');
    return;
  }

  // ===== Filtros aplicados =====
  const quickLabel = {
    all: 'Todos', critical: 'Solo críticos', cancel: 'Anulaciones',
    delete: 'Borrados', cashRegisters: 'Arqueos de caja', sales: 'Ventas',
    inventory: 'Inventario', users: 'Usuarios', paymentChannels: 'Métodos de pago'
  }[auditQuickFilter] || auditQuickFilter;

  const from = $('audit-date-from')?.value || 'todo';
  const to = $('audit-date-to')?.value || 'hoy';
  const roleF = $('audit-role-filter')?.value || 'all';
  const userF = $('audit-user-filter')?.value || 'all';
  const sevF = $('audit-severity-filter')?.value || 'all';
  const actionF = $('audit-action-filter')?.value || 'all';
  const collF = $('audit-collection-filter')?.value || 'all';
  const searchF = $('audit-search')?.value || '';

  // ===== Estadísticas =====
  const total = list.length;
  const critical = list.filter(a => auditSeverity(a) === 'critical').length;
  const high = list.filter(a => auditSeverity(a) === 'high').length;
  const medium = list.filter(a => auditSeverity(a) === 'medium').length;
  const low = list.filter(a => auditSeverity(a) === 'low').length;
  const uniqueUsers = new Set(list.map(a => a.userEmail).filter(Boolean)).size;

  // ===== Crear workbook =====
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smartec';
  wb.created = new Date();

  // ============================================================
  // HOJA 1: RESUMEN
  // ============================================================
  const wsR = wb.addWorksheet('Resumen', {
    properties: { defaultRowHeight: 18 }
  });

  // Título
  wsR.mergeCells('A1:B1');
  const titleCell = wsR.getCell('A1');
  titleCell.value = 'SMARTEC · Auditoría del sistema';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2A4A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  wsR.getRow(1).height = 32;

  // Metadatos
  const addMeta = (row, label, value) => {
    wsR.getCell(`A${row}`).value = label;
    wsR.getCell(`A${row}`).font = { bold: true, color: { argb: 'FF0A2A4A' } };
    wsR.getCell(`B${row}`).value = value;
  };

  addMeta(3, 'Generado', new Date().toLocaleString('es-CO'));
  addMeta(4, 'Total eventos', total);
  addMeta(5, 'Usuarios activos', uniqueUsers);

  // Sección "Filtros aplicados"
  wsR.mergeCells('A7:B7');
  const filtrosTitle = wsR.getCell('A7');
  filtrosTitle.value = 'FILTROS APLICADOS';
  filtrosTitle.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  filtrosTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A7A9A' } };
  filtrosTitle.alignment = { horizontal: 'center' };

  addMeta(8, 'Filtro rápido', quickLabel);
  addMeta(9, 'Desde', from);
  addMeta(10, 'Hasta', to);
  addMeta(11, 'Rol', roleF === 'all' ? 'Todos' : roleF);
  addMeta(12, 'Usuario', userF === 'all' ? 'Todos' : userF);
  addMeta(13, 'Severidad', sevF === 'all' ? 'Todas' : sevF);
  addMeta(14, 'Acción', actionF === 'all' ? 'Todas' : actionF);
  addMeta(15, 'Colección', collF === 'all' ? 'Todas' : collF);
  addMeta(16, 'Búsqueda', searchF || '—');

  // Sección "Resumen por severidad"
  wsR.mergeCells('A18:B18');
  const sevTitle = wsR.getCell('A18');
  sevTitle.value = 'RESUMEN POR SEVERIDAD';
  sevTitle.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sevTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A7A9A' } };
  sevTitle.alignment = { horizontal: 'center' };

  addMeta(19, 'Críticas', critical);
  addMeta(20, 'Altas', high);
  addMeta(21, 'Medias', medium);
  addMeta(22, 'Bajas', low);

  // 🆕 Pintar cada fila del resumen con su color de severidad
  const paintSevRow = (row, bgColor, textColor) => {
    const labelCell = wsR.getCell(`A${row}`);
    const valueCell = wsR.getCell(`B${row}`);
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    labelCell.font = { bold: true, color: { argb: textColor } };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    valueCell.font = { bold: true, color: { argb: textColor } };
  };
  paintSevRow(19, 'FFFEE2E2', 'FF991B1B'); // Críticas → rojo claro
  paintSevRow(20, 'FFFFEDD5', 'FF9A3412'); // Altas    → naranja claro
  paintSevRow(21, 'FFDBEAFE', 'FF1E40AF'); // Medias   → azul claro
  paintSevRow(22, 'FFDCFCE7', 'FF166534'); // Bajas    → verde claro

  wsR.getColumn(1).width = 22;
  wsR.getColumn(2).width = 45;

  // ============================================================
  // HOJA 2: EVENTOS
  // ============================================================
  const wsE = wb.addWorksheet('Eventos', {
    properties: { defaultRowHeight: 18 }
  });

  const headers = [
    { header: 'Fecha / hora', width: 20 },
    { header: 'Severidad', width: 12 },
    { header: 'Acción', width: 15 },
    { header: 'Colección', width: 22 },
    { header: 'Doc ID', width: 26 },
    { header: 'Usuario', width: 24 },
    { header: 'Email', width: 30 },
    { header: 'Rol', width: 14 },
    { header: 'Tienda', width: 22 },
    { header: 'Resumen del cambio', width: 60 },
    { header: 'Nota', width: 40 },
    { header: 'Campos modificados', width: 40 }
  ];

  // Fila de encabezados
  wsE.columns = headers.map(h => ({ width: h.width }));
  const headerRow = wsE.addRow(headers.map(h => h.header));
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2A4A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF08344C' } },
      bottom: { style: 'thin', color: { argb: 'FF08344C' } },
      left: { style: 'thin', color: { argb: 'FF08344C' } },
      right: { style: 'thin', color: { argb: 'FF08344C' } }
    };
  });

  // Colores por severidad
  const sevStyles = {
    critical: { bg: 'FFFEE2E2', text: 'FF991B1B', label: 'CRÍTICA' },
    high:     { bg: 'FFFFEDD5', text: 'FF9A3412', label: 'ALTA' },
    medium:   { bg: 'FFDBEAFE', text: 'FF1E40AF', label: 'MEDIA' },
    low:      { bg: 'FFDCFCE7', text: 'FF166534', label: 'BAJA' }
  };

  // Filas de datos
  list.forEach(a => {
    const sev = auditSeverity(a);
    const style = sevStyles[sev] || sevStyles.medium;

    const row = wsE.addRow([
      fmtDate(a.timestamp),
      style.label,
      (a.action || '').toUpperCase(),
      auditCollectionLabel(a.collection).replace(/^[^\w]+/, '').trim(),
      a.docId || '',
      a.userName || '',
      a.userEmail || '',
      a.userRole || '',
      a.userStoreName || a.storeId || '',
      a.changeSummary || '',
      a.note || '',
      (a.changedFields || []).join(' | ')
    ]);

    // Aplicar estilo a toda la fila
    row.eachCell((cell, colIdx) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      cell.alignment = { vertical: 'top', wrapText: colIdx >= 10 }; // wrap en Resumen/Nota/Campos
    });

    // Colorear columna Severidad
    const sevCell = row.getCell(2);
    sevCell.font = { bold: true, color: { argb: style.text } };
    sevCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.bg } };
    sevCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // Colorear columna Fecha y Acción (más tenue)
    row.getCell(1).font = { color: { argb: 'FF6B7280' } };
    row.getCell(3).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(8).alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // Congelar la primera fila (encabezados)
  wsE.views = [{ state: 'frozen', ySplit: 1 }];

  // Auto-filtro sobre todas las columnas
  wsE.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  // ============================================================
  // Descargar
  // ============================================================
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `smartec_auditoria_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
/* --------- PDF --------- */
/* --------- PDF --------- */
/* --------- PDF --------- */
function exportAuditPDF(list) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ===== Encabezado =====
  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Auditoría', 14, 13);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Trazabilidad de eventos', pageW - 14, 13, { align: 'right' });

  let y = 28;

  // ===== Filtros aplicados =====
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  const quickLabel = {
    all: 'Todos',
    critical: 'Solo críticos',
    cancel: 'Anulaciones',
    delete: 'Borrados',
    cashRegisters: 'Arqueos de caja',
    sales: 'Ventas',
    inventory: 'Inventario',
    users: 'Usuarios',
    paymentChannels: 'Métodos de pago'
  }[auditQuickFilter] || auditQuickFilter;

  const from = $('audit-date-from')?.value || 'todo';
  const to = $('audit-date-to')?.value || 'hoy';
  const roleF = $('audit-role-filter')?.value || 'all';
  const userF = $('audit-user-filter')?.value || 'all';
  const sevF = $('audit-severity-filter')?.value || 'all';
  const actionF = $('audit-action-filter')?.value || 'all';
  const collF = $('audit-collection-filter')?.value || 'all';
  const searchF = $('audit-search')?.value || '';

  doc.text(`Período: ${from} — ${to}`, 14, y); y += 5;
  doc.text(`Filtro rápido: ${quickLabel}`, 14, y); y += 5;
  if (roleF !== 'all') { doc.text(`Rol: ${roleF}`, 14, y); y += 5; }
  if (userF !== 'all') { doc.text(`Usuario: ${userF}`, 14, y); y += 5; }
  if (sevF !== 'all') { doc.text(`Severidad: ${sevF}`, 14, y); y += 5; }
  if (actionF !== 'all') { doc.text(`Acción: ${actionF}`, 14, y); y += 5; }
  if (collF !== 'all') { doc.text(`Colección: ${collF}`, 14, y); y += 5; }
  if (searchF) { doc.text(`Búsqueda: "${searchF}"`, 14, y); y += 5; }

  doc.text(`Total eventos: ${list.length}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  // ===== KPIs resumen =====
  const total = list.length;
  const critical = list.filter(a => auditSeverity(a) === 'critical').length;
  const high = list.filter(a => auditSeverity(a) === 'high').length;
  const medium = list.filter(a => auditSeverity(a) === 'medium').length;
  const low = list.filter(a => auditSeverity(a) === 'low').length;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 42, 74);
  doc.text('Resumen por severidad', 14, y);
  y += 3;

  doc.autoTable({
    startY: y,
    head: [['Total', 'Críticas', 'Altas', 'Medias', 'Bajas']],
    body: [[
      String(total),
      String(critical),
      String(high),
      String(medium),
      String(low)
    ]],
    theme: 'grid',
    headStyles: { fillColor: [74, 122, 154], textColor: 255, halign: 'center', fontStyle: 'bold' },
    bodyStyles: { halign: 'center', fontSize: 10 },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 8;

  // ===== Tabla detallada =====
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 42, 74);
  doc.text('Detalle de eventos', 14, y);
  y += 3;

  const rows = list.map(a => {
    const sevLabel = { critical: 'CRITICA', high: 'ALTA', medium: 'MEDIA', low: 'BAJA' }[auditSeverity(a)] || 'MEDIA';
    const summary = a.changeSummary || a.note || '';
    return [
      fmtDate(a.timestamp),
      sevLabel,
      (a.action || '').toUpperCase(),
      a.collection || '',
      a.userName || a.userEmail || '',
      a.userRole || '',
      summary.substring(0, 80)
    ];
  });

  doc.autoTable({
    startY: y,
    head: [['Fecha', 'Sev.', 'Acción', 'Colección', 'Usuario', 'Rol', 'Resumen']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 8, cellPadding: 1.5 },
    bodyStyles: { fontSize: 7, cellPadding: 1.5 },
    margin: { left: 8, right: 8 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 25 },
      4: { cellWidth: 32 },
      5: { cellWidth: 16 },
      6: { cellWidth: 55 }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const v = data.cell.raw;
        if (v === 'CRITICA') data.cell.styles.textColor = [220, 38, 38];
        else if (v === 'ALTA') data.cell.styles.textColor = [234, 88, 12];
        else if (v === 'MEDIA') data.cell.styles.textColor = [59, 130, 246];
        else if (v === 'BAJA') data.cell.styles.textColor = [22, 163, 74];
      }
    }
  });

  // ===== Pie de página =====
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Smartec · Auditoría · Página ${i} de ${pages}`,
      pageW / 2,
      pageH - 8,
      { align: 'center' }
    );
  }

  const filename = `smartec_auditoria_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}

window.closeAuditModal = () => { const m=$('audit-modal'); m.classList.add('hidden'); m.classList.remove('flex'); };

/* ============================================================
   MÉTODOS DE PAGO — PLATAFORMAS POR DEFECTO
============================================================ */

const DEFAULT_PLATFORMS = [
  // ===== BANCOS TRADICIONALES =====
  { name: 'Bancolombia',       category: 'banco',   icon: '🏦', color: '#FDDA24', order: 1 },
  { name: 'Banco de Bogotá',   category: 'banco',   icon: '🏦', color: '#0057B7', order: 2 },
  { name: 'Davivienda',        category: 'banco',   icon: '🏦', color: '#E30613', order: 3 },
  { name: 'BBVA Colombia',     category: 'banco',   icon: '🏦', color: '#072146', order: 4 },
  { name: 'Banco de Occidente',category: 'banco',   icon: '🏦', color: '#ED1C24', order: 5 },
  { name: 'Banco Popular',     category: 'banco',   icon: '🏦', color: '#00843D', order: 6 },
  { name: 'Banco Caja Social', category: 'banco',   icon: '🏦', color: '#0033A0', order: 7 },
  { name: 'Scotiabank Colpatria', category: 'banco',icon: '🏦', color: '#ED1C24', order: 8 },
  { name: 'Banco GNB Sudameris',  category: 'banco',icon: '🏦', color: '#003F7D', order: 9 },
  { name: 'Banco AV Villas',   category: 'banco',   icon: '🏦', color: '#E4002B', order: 10 },
  { name: 'Banco Pichincha',   category: 'banco',   icon: '🏦', color: '#FFD100', order: 11 },
  { name: 'Bancoomeva',        category: 'banco',   icon: '🏦', color: '#003A70', order: 12 },
  { name: 'Banco Agrario',     category: 'banco',   icon: '🏦', color: '#006633', order: 13 },
  { name: 'Banco Falabella',   category: 'banco',   icon: '🏦', color: '#78BE20', order: 14 },
  { name: 'Banco Finandina',   category: 'banco',   icon: '🏦', color: '#003E7E', order: 15 },
  { name: 'Banco W',           category: 'banco',   icon: '🏦', color: '#F7941D', order: 16 },
  { name: 'Banco Mundo Mujer', category: 'banco',   icon: '🏦', color: '#8B2E8A', order: 17 },
  { name: 'Bancamía',          category: 'banco',   icon: '🏦', color: '#00A0DF', order: 18 },
  { name: 'Lulo Bank',         category: 'banco',   icon: '🏦', color: '#F2FF00', order: 19 },
  { name: 'Nu Bank',           category: 'banco',   icon: '💜', color: '#820AD1', order: 20 },
  { name: 'Ualá',              category: 'banco',   icon: '🏦', color: '#FF007A', order: 21 },
  { name: 'RappiPay',          category: 'banco',   icon: '🏦', color: '#FF441F', order: 22 },

  // ===== BILLETERAS DIGITALES =====
  { name: 'Nequi',             category: 'billetera', icon: '📱', color: '#200020', order: 30 },
  { name: 'Daviplata',         category: 'billetera', icon: '📱', color: '#E30613', order: 31 },
  { name: 'Dale!',             category: 'billetera', icon: '📱', color: '#F5A623', order: 32 },
  { name: 'Movii',             category: 'billetera', icon: '📱', color: '#F5A623', order: 33 },
  { name: 'BICO',              category: 'billetera', icon: '📱', color: '#006633', order: 34 },

  // ===== ENTIDADES DE CRÉDITO =====
  { name: 'Addi',              category: 'credito', icon: '🛍️', color: '#6C00FF', order: 50 },
  { name: 'Sistecrédito',      category: 'credito', icon: '🛍️', color: '#00A859', order: 51 },
  { name: 'Cupo Brilla',       category: 'credito', icon: '✨', color: '#FF6B00', order: 52 },
  { name: 'Sumas Pay',         category: 'credito', icon: '🛍️', color: '#1E40AF', order: 53 },
  { name: 'Credinet',          category: 'credito', icon: '🛍️', color: '#0A7C4E', order: 54 },
  { name: 'Effi',              category: 'credito', icon: '🛍️', color: '#F59E0B', order: 55 },

  // ===== OTRAS FINANCIERAS =====
  { name: 'Credifamilia',      category: 'credito', icon: '💳', color: '#F7941D', order: 60 },
  { name: 'Financiera Juriscoop', category: 'credito', icon: '💳', color: '#003876', order: 61 },
  { name: 'Tuya S.A.',         category: 'credito', icon: '💳', color: '#E4002B', order: 62 },
  { name: 'Serfinansa',        category: 'credito', icon: '💳', color: '#F7941D', order: 63 }
];

window.seedDefaultPlatforms = async () => {
  // Solo superadmin
  if (currentUserData?.role !== 'superadmin') {
    alert('⛔ Solo el superadmin puede inicializar plataformas.');
    return;
  }

  if (!confirm(
    `Esto agregará ${DEFAULT_PLATFORMS.length} plataformas por defecto a Firestore.\n\n` +
    `Las que ya existan (mismo nombre) no se sobreescribirán.\n\n` +
    `¿Continuar?`
  )) return;

  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Cargando...'; }

  try {
    // Leer todas las plataformas existentes
    const existing = await getDocs(collection(db, 'paymentPlatforms'));
    const existingNames = new Set(existing.docs.map(d => d.data().name));

    let added = 0;
    let skipped = 0;

    for (const p of DEFAULT_PLATFORMS) {
      if (existingNames.has(p.name)) {
        skipped++;
        continue;
      }

      // Crear con ID auto
      await addDoc(collection(db, 'paymentPlatforms'), {
        ...p,
        active: true,
        createdAt: serverTimestamp(),
        createdBy: currentUser.email
      });
      added++;
    }

    await audit({
      action: 'seed',
      collection: 'paymentPlatforms',
      after: { added, skipped, total: DEFAULT_PLATFORMS.length },
      note: `Plataformas inicializadas: ${added} nuevas, ${skipped} existentes`
    });

    window.SmartecCache.invalidate('paymentPlatforms');

    alert(
      `✅ Plataformas inicializadas\n\n` +
      `• Agregadas: ${added}\n` +
      `• Ya existían: ${skipped}\n` +
      `• Total: ${DEFAULT_PLATFORMS.length}`
    );

    // Recargar datos
    await loadPaymentPlatforms();

  } catch(e) {
    console.error('Error en seedDefaultPlatforms:', e);
    alert('Error: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '🔧 Inicializar plataformas por defecto'; }
  }
};

/* ============================================================
   MÉTODOS DE PAGO — CARGA Y RENDER
============================================================ */

window.loadPaymentPlatforms = async () => {
  try {
    const s = await getDocs(collection(db,'paymentPlatforms'));
    paymentPlatforms = s.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (a.order||0) - (b.order||0));
    window.SmartecCache.set('paymentPlatforms', paymentPlatforms);
    renderPaymentStats();
  } catch(e) {
    console.warn('Error cargando plataformas:', e);
  }
};

function renderPaymentStats() {
  // Transferencias activas
  const transferCount = paymentChannels.filter(c =>
    c.type === 'transferencia' && c.active !== false
  ).length;

  // Crédito activas
  const creditCount = paymentChannels.filter(c =>
    c.type === 'credito' && c.active !== false
  ).length;

  const tEl = $('channels-count-transferencia');
  const cEl = $('channels-count-credito');

  if (tEl) tEl.innerText = transferCount === 0
    ? 'Sin cuentas configuradas'
    : `${transferCount} canal${transferCount !== 1 ? 'es' : ''} activo${transferCount !== 1 ? 's' : ''}`;

  if (cEl) cEl.innerText = creditCount === 0
    ? 'Sin entidades configuradas'
    : `${creditCount} entidad${creditCount !== 1 ? 'es' : ''} activa${creditCount !== 1 ? 's' : ''}`;
}

window.openChannelsModal = (type) => {
  const modal = $('channels-modal');
  const list = $('channels-modal-list');
  const empty = $('channels-modal-empty');
  const title = $('channels-modal-title');
  const subtitle = $('channels-modal-subtitle');

  if (!modal) return;

  // Configurar textos según tipo
  if (type === 'transferencia') {
    title.innerText = '🔄 Canales de transferencia';
    subtitle.innerText = 'Cuentas donde los clientes pueden hacer transferencias';
  } else {
    title.innerText = '🛍️ Entidades de crédito';
    subtitle.innerText = 'Entidades que ofrecen financiación al cliente';
  }

  // Filtrar por tipo
  const channels = paymentChannels.filter(c => c.type === type);

  // Ordenar alfabéticamente por bank, luego por customName
  channels.sort((a, b) => {
    const bk = (a.bank || '').localeCompare(b.bank || '');
    if (bk !== 0) return bk;
    return (a.customName || '').localeCompare(b.customName || '');
  });

  if (!channels.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    list.innerHTML = channels.map(c => renderChannelCard(c)).join('');
  }

  // Guardar tipo actual para el botón "+ Nuevo canal"
  modal.dataset.currentType = type;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeChannelsModal = () => {
  const modal = $('channels-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
};

window.openChannelForm = (channelId = null) => {
  const modal = $('channel-form-modal');
  const titleEl = $('channel-form-title');
  const bodyEl = $('channel-form-body');
  if (!modal || !bodyEl) return;

  // Determinar tipo (nuevo → del modal abierto; editar → del canal)
  let type = 'transferencia';
  if (channelId) {
    const c = paymentChannels.find(x => x.id === channelId);
    if (!c) return;
    type = c.type;
  } else {
    type = $('channels-modal')?.dataset.currentType || 'transferencia';
  }

  // Determinar código autogenerado (solo si es nuevo)
  let code = '';
  if (channelId) {
    code = paymentChannels.find(x => x.id === channelId)?.code || '';
  } else {
    code = generateNextChannelCode(type);
  }

  // Datos actuales (o vacíos)
  const existing = channelId ? paymentChannels.find(x => x.id === channelId) : null;
  const channel = existing || {
    type,
    code,
    bank: '',
    customName: '',
    accountNumber: '',
    icon: type === 'transferencia' ? '🏦' : '🛍️',
    color: '#0A2A4A',
    active: true,
    notes: ''
  };

  titleEl.innerText = existing ? 'Editar canal' : 'Nuevo canal';

  // Filtrar plataformas según el tipo
  const relevantPlatforms = paymentPlatforms.filter(p => {
    if (type === 'transferencia') return p.category === 'banco' || p.category === 'billetera';
    return p.category === 'credito';
  });

  // Agrupar por categoría para el optgroup
  const groups = {
    banco: [],
    billetera: [],
    credito: []
  };
  relevantPlatforms.forEach(p => {
    const cat = p.category || 'banco';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });

  const groupLabels = {
    banco: '🏦 Bancos',
    billetera: '📱 Billeteras digitales',
    credito: '🛍️ Entidades de crédito'
  };

  // Construir los <optgroup>
  let platformOptions = '';
  ['banco','billetera','credito'].forEach(cat => {
    if (!groups[cat] || !groups[cat].length) return;
    platformOptions += `<optgroup label="${groupLabels[cat]}">`;
    groups[cat].forEach(p => {
      platformOptions += `<option value="${escapeHtml(p.name)}" data-icon="${p.icon||''}" data-color="${p.color||''}">${escapeHtml(p.name)}</option>`;
    });
    platformOptions += `</optgroup>`;
  });

  // Opción "Otro"
  platformOptions += `<optgroup label="Otros"><option value="__otro__" data-icon="⚪" data-color="#6b7280">Otro (personalizado)</option></optgroup>`;

  bodyEl.innerHTML = `
    <div class="space-y-4">

      <!-- Código -->
      <div>
        <label class="text-xs font-semibold text-sd">Código</label>
        <input id="cf-code" type="text" value="${escapeHtml(channel.code || '')}"
               ${existing ? 'disabled' : 'readonly'}
               class="w-full px-3 py-2 border rounded-lg mt-1 font-mono text-sm bg-gray-50 text-gray-600">
        <p class="text-[10px] text-gray-400 mt-1">Autogenerado. Se usa como referencia interna.</p>
      </div>

      <!-- Banco/Plataforma -->
      <div>
        <label class="text-xs font-semibold text-sd">Banco / Plataforma *</label>
        <select id="cf-bank" class="w-full px-3 py-2 border rounded-lg mt-1" onchange="onBankChange()">
          <option value="">— Selecciona —</option>
          ${platformOptions}
        </select>
      </div>

      <!-- Campo custom (solo si "Otro") -->
      <div id="cf-custom-bank-wrap" class="hidden">
        <label class="text-xs font-semibold text-sd">Nombre personalizado del banco/plataforma *</label>
        <input id="cf-custom-bank" type="text" placeholder="Ej: Banco XYZ" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>

      <!-- Nombre descriptivo -->
      <div>
        <label class="text-xs font-semibold text-sd">Nombre descriptivo *</label>
        <input id="cf-custom-name" type="text" value="${escapeHtml(channel.customName || '')}"
               placeholder="Ej: Andrea, Principal, Cobros"
               class="w-full px-3 py-2 border rounded-lg mt-1">
        <p class="text-[10px] text-gray-400 mt-1">Para diferenciar varias cuentas del mismo banco.</p>
      </div>

      ${type === 'credito' ? `
      <div>
        <label class="text-xs font-semibold text-sd">% Comisión comercio</label>
        <input id="cf-commissionRate" type="number" step="0.01" min="0" max="100"
               value="${((channel.commissionRate || 0) * 100).toFixed(2)}"
               placeholder="Ej: 6.5"
               class="w-full px-3 py-2 border rounded-lg mt-1">
        <p class="text-[10px] text-gray-400 mt-1">Porcentaje que la entidad descuenta al comercio por cada venta financiada.</p>
      </div>
      ` : ''}
      <!-- Número de cuenta -->
      <div>
        <label class="text-xs font-semibold text-sd">Número de cuenta / teléfono</label>
        <input id="cf-account" type="text" value="${escapeHtml(channel.accountNumber || '')}"
               placeholder="Ej: 3001234567 o ····1234"
               class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>

      <!-- Vista previa + personalización -->
      <div class="border-t pt-4">
        <p class="text-xs font-semibold text-sd mb-2">Vista previa</p>
        <div id="cf-preview" class="bg-gray-50 rounded-lg p-3 flex items-center gap-3">
          <!-- Se llena con JS -->
        </div>
      </div>

      <!-- Personalizar apariencia -->
      <details class="border-t pt-3">
        <summary class="text-xs font-semibold text-sd cursor-pointer">🎨 Personalizar apariencia</summary>
        <div class="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label class="text-[10px] font-semibold text-sd">Emoji / ícono</label>
            <input id="cf-icon" type="text" maxlength="2" value="${escapeHtml(channel.icon || '🏦')}"
                   class="w-full px-3 py-2 border rounded-lg mt-1 text-center text-2xl">
          </div>
          <div>
            <label class="text-[10px] font-semibold text-sd">Color</label>
            <input id="cf-color" type="color" value="${channel.color || '#0A2A4A'}"
                   class="w-full h-10 border rounded-lg mt-1 cursor-pointer" onchange="updatePreview()">
          </div>
        </div>
      </details>

      <!-- Notas -->
      <div>
        <label class="text-xs font-semibold text-sd">Notas</label>
        <textarea id="cf-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm"
                  placeholder="Observaciones opcionales">${escapeHtml(channel.notes || '')}</textarea>
      </div>

      <!-- Estado -->
      <label class="flex items-center gap-2 text-sm">
        <input id="cf-active" type="checkbox" ${channel.active !== false ? 'checked' : ''} class="w-4 h-4">
        Canal activo (aparecerá en el POS)
      </label>

      <!-- Botones -->
      <div class="flex gap-3 pt-2">
        <button onclick="closeChannelForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">
          Cancelar
        </button>
        <button onclick="saveChannel('${channelId || ''}')" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">
          💾 Guardar
        </button>
      </div>

    </div>
  `;

  // Preseleccionar banco si es edición
  if (existing && existing.bank) {
    const sel = $('cf-bank');
    // Buscar opción que coincida
    const opt = Array.from(sel.options).find(o => o.value === existing.bank);
    if (opt) {
      sel.value = existing.bank;
    } else {
      // No está en la lista → es "Otro"
      sel.value = '__otro__';
      $('cf-custom-bank-wrap').classList.remove('hidden');
      $('cf-custom-bank').value = existing.bank;
    }
  }

  // Listeners para actualizar vista previa
  ['cf-bank', 'cf-custom-name', 'cf-account', 'cf-icon', 'cf-custom-bank'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', updatePreview);
  });

  updatePreview();  

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeChannelForm = () => {
  const modal = $('channel-form-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
};

/* ============================================================
   MODAL DE CONFIRMAR COBRO
============================================================ */
window.openConfirmPaymentModal = (saleId) => {
  const sale = sales.find(x => x.id === saleId);
  if (!sale) return alert('Venta no encontrada');

  const modal = $('confirm-payment-modal');
  const subtitle = $('confirm-payment-subtitle');
  const body = $('confirm-payment-body');
  if (!modal || !body) return;

  const store = stores.find(s => s.storeId === sale.storeId);

  // 🆕 Total a cobrar = total real de la venta (incluye envío y recargo)
  //    El envío y el recargo NO entran a comisión, pero SÍ se cobran al cliente.
  const totalToCharge = Number(sale.total || 0);

  // Guardar el id de la venta en el dataset del modal
  modal.dataset.saleId = saleId;
  modal.dataset.totalToCharge = String(totalToCharge);

  subtitle.innerText = `Venta de ${sale.customer?.name || 'Cliente'} · ${store?.name || sale.storeId}`;

  // Canales de transferencia activos (para los selects de cada fila)
  const transferChannels = paymentChannels
    .filter(c => c.type === 'transferencia' && c.active !== false)
    .sort((a, b) => {
      const bk = (a.bank || '').localeCompare(b.bank || '');
      if (bk !== 0) return bk;
      return (a.customName || '').localeCompare(b.customName || '');
    });

  // Canales de crédito activos
  const creditChannels = paymentChannels
    .filter(c => c.type === 'credito' && c.active !== false)
    .sort((a, b) => (a.bank || '').localeCompare(b.bank || ''));

  // Guardar en una global temporal para reusar en render
  window.__confirmTransferChannels = transferChannels;
  window.__confirmCreditChannels = creditChannels;
  window.__confirmPayments = [
    // Fila inicial: método efectivo con el monto total
    { method: 'efectivo', amount: totalToCharge, channelId: null }
  ];

  // Render inicial
  renderConfirmPaymentBody(body, totalToCharge);

  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

/**
 * 🆕 Renderiza el cuerpo del modal con la lista de pagos.
 */
function renderConfirmPaymentBody(body, totalToCharge) {
  const payments = window.__confirmPayments || [];
  const transferChannels = window.__confirmTransferChannels || [];
  const creditChannels = window.__confirmCreditChannels || [];

  // Calcular suma actual
  const sum = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remaining = totalToCharge - sum;
  const diffClass = Math.abs(remaining) < 1
    ? 'text-green-700'
    : (remaining > 0 ? 'text-amber-700' : 'text-red-600');

  // Opciones de canales de transferencia
  const transferOptions = transferChannels.map(c => {
    const icon = c.icon || '🏦';
    const label = c.customName ? `${c.bank} — ${c.customName}` : c.bank;
    const account = c.accountNumber ? ` (${c.accountNumber})` : '';
    return `<option value="${c.id}">${icon} ${escapeHtml(label)}${escapeHtml(account)}</option>`;
  }).join('');

  // Opciones de canales de crédito
  const creditOptions = creditChannels.map(c => {
    const icon = c.icon || '🛍️';
    const label = c.customName ? `${c.bank} — ${c.customName}` : c.bank;
    const comm = c.commissionRate ? ` · ${(c.commissionRate*100).toFixed(2)}%` : '';
    return `<option value="${c.id}">${icon} ${escapeHtml(label)}${escapeHtml(comm)}</option>`;
  }).join('');

  // Render de cada fila
  const rowsHtml = payments.map((p, idx) => {
    const methodOptions = [
      { v: 'efectivo', l: '💵 Efectivo' },
      { v: 'transferencia', l: '🔄 Transferencia' },
      { v: 'tarjeta', l: '💳 Tarjeta' },
      { v: 'credito', l: '🛍️ Crédito' },
    ].map(o => `<option value="${o.v}" ${p.method === o.v ? 'selected' : ''}>${o.l}</option>`).join('');

    const needsTransfer = p.method === 'transferencia';
    const needsCredit = p.method === 'credito';
    const needsChannel = needsTransfer || needsCredit;

    const channelOptions = needsTransfer
      ? transferOptions
      : (needsCredit ? creditOptions : '');

    const channelLabel = needsTransfer ? 'Cuenta destino *' : 'Entidad de crédito *';

    return `
      <div class="border rounded-lg p-3 mb-2 bg-gray-50" data-row-idx="${idx}">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs font-semibold text-gray-500">Pago ${idx + 1} de ${payments.length}</p>
          ${payments.length > 1 ? `
            <button type="button" onclick="removeConfirmPaymentRow(${idx})" class="text-red-500 hover:text-red-700 text-xs font-semibold">
              ✕ Eliminar
            </button>
          ` : ''}
        </div>

        <div class="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label class="text-[10px] font-semibold text-sd block mb-1">Método *</label>
            <select onchange="updateConfirmPaymentRow(${idx}, 'method', this.value)"
              class="w-full px-2 py-1.5 border rounded-lg text-xs">
              ${methodOptions}
            </select>
          </div>
          <div>
            <label class="text-[10px] font-semibold text-sd block mb-1">Monto *</label>
            <input type="number" value="${p.amount || 0}" min="0" step="100"
              onchange="updateConfirmPaymentRow(${idx}, 'amount', this.value)"
              class="w-full px-2 py-1.5 border rounded-lg text-xs text-right font-semibold">
          </div>
        </div>

        ${needsChannel ? `
          <div>
            <label class="text-[10px] font-semibold text-sd block mb-1">${channelLabel}</label>
            <select onchange="updateConfirmPaymentRow(${idx}, 'channelId', this.value)"
              class="w-full px-2 py-1.5 border rounded-lg text-xs">
              <option value="">— Selecciona —</option>
              ${channelOptions}
            </select>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  body.innerHTML = `
    <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5">
      <div class="flex justify-between items-center mb-2">
        <p class="text-xs text-gray-600">Monto a cobrar:</p>
        <p class="text-2xl font-bold text-amber-700">${fmt(totalToCharge)}</p>
      </div>
      <p class="text-[10px] text-gray-500">
        Venta registrada como <b>${sale_paymentMethodLabel()}</b>
      </p>
    </div>

    <div class="mb-4">
      <div class="flex justify-between items-center mb-2">
        <p class="text-xs font-semibold text-sd">Pagos aplicados</p>
        <span class="text-xs ${diffClass} font-semibold">
          ${Math.abs(remaining) < 1
            ? '✅ Cuadra perfecto'
            : (remaining > 0
                ? `Faltan ${fmt(remaining)}`
                : `Sobra ${fmt(-remaining)}`)}
        </span>
      </div>

      <div id="confirm-payments-list">
        ${rowsHtml}
      </div>

      <button type="button" onclick="addConfirmPaymentRow()"
        class="w-full mt-2 py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs font-semibold text-gray-500 hover:border-sl hover:text-sl transition">
        + Agregar otro método
      </button>
    </div>

    <label class="text-xs font-semibold text-sd block mb-1">Nota (opcional)</label>
    <textarea id="confirm-notes" rows="2" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ej: Cobrado al entregar a las 3pm..."></textarea>

    <div class="flex gap-3 mt-5">
      <button onclick="closeConfirmPaymentModal()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">
        Cancelar
      </button>
      <button id="confirm-payment-btn" onclick="submitConfirmPayment()" class="flex-1 bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 font-semibold disabled:opacity-40">
        ✅ Confirmar cobro
      </button>
    </div>
  `;

  // Revalidar botón
  validateConfirmPayment();
}

/** Helper para el label del método original de la venta */
function sale_paymentMethodLabel() {
  const modal = $('confirm-payment-modal');
  const saleId = modal?.dataset.saleId;
  const sale = sales.find(x => x.id === saleId);
  if (!sale) return '—';
  const labels = {
    efectivo: '💵 Efectivo',
    transferencia: '🔄 Transferencia',
    tarjeta: '💳 Tarjeta',
    contraentrega: '📦 Contra entrega',
    credito: '🛍️ Crédito'
  };
  return labels[sale.paymentMethod] || sale.paymentMethod || '—';
}

/** 🆕 Agrega una nueva fila de pago (monto 0 por defecto) */
window.addConfirmPaymentRow = () => {
  const modal = $('confirm-payment-modal');
  const body = $('confirm-payment-body');
  if (!modal || !body) return;

  const totalToCharge = Number(modal.dataset.totalToCharge || 0);
  const payments = window.__confirmPayments || [];

  // 🆕 Al agregar fila, la suma anterior se ajusta:
  //    la primera fila se reduce al remanente y la nueva toma 0.
  const sumBefore = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remaining = totalToCharge - sumBefore;

  // Nueva fila con el remanente (o 0 si ya cuadra)
  payments.push({
    method: 'efectivo',
    amount: remaining > 0 ? remaining : 0,
    channelId: null
  });

  // Ajustar la fila anterior: si era la única, reducirla al 0
  if (payments.length === 2 && payments[0].amount === totalToCharge) {
    payments[0].amount = Math.max(0, totalToCharge - payments[1].amount);
  }

  renderConfirmPaymentBody(body, totalToCharge);
};

/** 🆕 Elimina una fila de pago */
window.removeConfirmPaymentRow = (idx) => {
  const modal = $('confirm-payment-modal');
  const body = $('confirm-payment-body');
  if (!modal || !body) return;

  const totalToCharge = Number(modal.dataset.totalToCharge || 0);
  const payments = window.__confirmPayments || [];

  if (payments.length <= 1) return;
  payments.splice(idx, 1);

  // Si solo queda 1 fila, le ponemos el total (para que cuadre)
  if (payments.length === 1) {
    payments[0].amount = totalToCharge;
  }

  renderConfirmPaymentBody(body, totalToCharge);
};

/** 🆕 Actualiza un campo de una fila */
window.updateConfirmPaymentRow = (idx, field, value) => {
  const modal = $('confirm-payment-modal');
  const body = $('confirm-payment-body');
  if (!modal || !body) return;

  const totalToCharge = Number(modal.dataset.totalToCharge || 0);
  const payments = window.__confirmPayments || [];
  if (!payments[idx]) return;

  if (field === 'amount') {
    payments[idx].amount = Math.max(0, Number(value) || 0);
  } else {
    payments[idx][field] = value;
    // Si cambia el método y no es transferencia ni crédito, limpiar canal
    if (field === 'method' && value !== 'transferencia' && value !== 'credito') {
      payments[idx].channelId = null;
    }
  }

  // Re-renderizar
  renderConfirmPaymentBody(body, totalToCharge);
};

window.closeConfirmPaymentModal = () => {
  const modal = $('confirm-payment-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  delete modal.dataset.saleId;
};

/**
 * 🆕 Validación del modal de confirmar cobro con pagos múltiples.
 * Reglas:
 *  - Debe haber al menos 1 pago
 *  - La suma debe cuadrar exactamente con el total
 *  - Cada pago con transferencia o crédito debe tener canal seleccionado
 */
function validateConfirmPayment() {
  const modal = $('confirm-payment-modal');
  const btn = $('confirm-payment-btn');
  if (!modal || !btn) return;

  const totalToCharge = Number(modal.dataset.totalToCharge || 0);
  const payments = window.__confirmPayments || [];

  // Regla 1: al menos 1 pago
  if (!payments.length) {
    btn.disabled = true;
    return;
  }

  // Regla 2: cada pago debe tener monto > 0
  for (const p of payments) {
    if (!p.amount || Number(p.amount) <= 0) {
      btn.disabled = true;
      return;
    }
  }

  // Regla 3: suma debe cuadrar
  const sum = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  if (Math.abs(sum - totalToCharge) > 1) {
    btn.disabled = true;
    return;
  }

  // Regla 4: cada transferencia/crédito debe tener canal
  for (const p of payments) {
    if ((p.method === 'transferencia' || p.method === 'credito') && !p.channelId) {
      btn.disabled = true;
      return;
    }
  }

  // Todo OK
  btn.disabled = false;
}

// 🆕 Listener global: cuando el modal se re-renderiza, revalidar
document.addEventListener('change', (e) => {
  // El modal se re-renderiza cada vez, así que validamos por si acaso
  if (e.target.closest('#confirm-payment-modal')) {
    setTimeout(validateConfirmPayment, 50);
  }
});

window.submitConfirmPayment = async () => {
  const modal = $('confirm-payment-modal');
  const saleId = modal?.dataset.saleId;
  if (!saleId) return;

  const sale = sales.find(x => x.id === saleId);
  if (!sale) return alert('Venta no encontrada');

  const notes = $('confirm-notes')?.value.trim() || '';
  const totalToCharge = Number(modal.dataset.totalToCharge || 0);
  const payments = window.__confirmPayments || [];

  // Validar
  if (!payments.length) return alert('Debes agregar al menos un método de pago');
  const sum = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  if (Math.abs(sum - totalToCharge) > 1) {
    return alert(`⚠️ Los pagos no cuadran con el total.\n\nTotal: ${fmt(totalToCharge)}\nSuma: ${fmt(sum)}\nDiferencia: ${fmt(totalToCharge - sum)}`);
  }
  for (const p of payments) {
    if ((p.method === 'transferencia' || p.method === 'credito') && !p.channelId) {
      return alert('⚠️ Cada transferencia o crédito debe tener un canal seleccionado.');
    }
  }

  // 🆕 Construir el paymentBreakdown para guardar en Firestore
  const paymentBreakdown = payments.map(p => {
    const item = {
      method: p.method,
      amount: Number(p.amount || 0),
    };
    // Snapshot del canal si aplica
    if (p.channelId) {
      const ch = paymentChannels.find(c => c.id === p.channelId);
      if (ch) {
        item.channelId = ch.id;
        item.channelCode = ch.code || null;
        item.channelType = ch.type || null;
        item.channelBank = ch.bank || null;
        item.channelName = ch.customName || null;
        item.channelAccount = ch.accountNumber || null;
        item.channelIcon = ch.icon || null;
        item.channelColor = ch.color || null;
        // Para crédito: guardar la tasa de comisión
        if (p.method === 'credito') {
          item.creditCommissionRate = Number(ch.commissionRate || 0);
          item.creditCommissionAmount = Number(p.amount || 0) * Number(ch.commissionRate || 0);
        }
      }
    }
    return item;
  });

  // 🆕 Método "resumen": si hay 1 solo pago, usar el método; si hay varios, "mixto"
  const methods = payments.map(p => p.method);
  const uniqueMethods = [...new Set(methods)];
  const summaryMethod = uniqueMethods.length === 1 ? uniqueMethods[0] : 'mixto';

  // 🆕 Comisión financiera total (suma de todos los pagos con crédito)
  const totalCreditCommission = paymentBreakdown.reduce((s, p) => s + Number(p.creditCommissionAmount || 0), 0);

  const btn = $('confirm-payment-btn');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Guardando...'; }

  try {
    const before = {
      paymentStatus: sale.paymentStatus || 'pending',
      paymentMethod: sale.paymentMethod,
    };

    const updateData = {
      paymentStatus: 'completed',
      paymentMethod: summaryMethod,   // 🆕 ahora puede ser "mixto"
      paymentBreakdown,                // 🆕 array de pagos
      creditCommissionAmount: totalCreditCommission,  // 🆕 total comisiones financieras
      finalPaymentAt: serverTimestamp(),
      finalPaymentBy: currentUser.email,
      finalPaymentNotes: notes || null,
      updatedAt: serverTimestamp(),
    };

    // Compatibilidad con el código viejo: si hay 1 solo pago, llenar los campos final* como antes
    if (paymentBreakdown.length === 1) {
      const p = paymentBreakdown[0];
      updateData.finalPaymentMethod = p.method;
      if (p.channelId) {
        updateData.finalPaymentChannelId = p.channelId;
        updateData.finalPaymentChannelCode = p.channelCode;
        updateData.finalPaymentChannelBank = p.channelBank;
        updateData.finalPaymentChannelName = p.channelName;
        updateData.finalPaymentChannelAccount = p.channelAccount;
        updateData.finalPaymentChannelIcon = p.channelIcon;
        updateData.finalPaymentChannelColor = p.channelColor;
      }
    }

    await updateDoc(doc(db, 'sales', saleId), updateData);

    // Nota de auditoría
    const noteParts = paymentBreakdown.map(p => `${p.method} ${fmt(p.amount)}`);
    const auditNote = `Cobro confirmado: ${noteParts.join(' + ')} · ${fmt(totalToCharge)}`;

    await audit({
      action: 'update',
      collection: 'sales',
      docId: saleId,
      before,
      after: updateData,
      note: auditNote,
    });

    window.SmartecCache.invalidate('sales');

    closeConfirmPaymentModal();
    window.__confirmPayments = null;

    // Refrescar UI
    await loadAll();
    renderReports();

    alert(`✅ Cobro confirmado.\n\n${noteParts.join('\n')}`);
  } catch (e) {
    console.error('Error confirmando cobro:', e);
    alert('Error: ' + e.message);
    if (btn) { btn.disabled = false; btn.innerText = '✅ Confirmar cobro'; }
  }
};

window.saveChannel = async (channelId = '') => {
  // Determinar tipo según el canal existente o el modal abierto
  let type = 'transferencia';
  if (channelId) {
    const c = paymentChannels.find(x => x.id === channelId);
    if (!c) return alert('Canal no encontrado');
    type = c.type;
  } else {
    type = $('channels-modal')?.dataset.currentType || 'transferencia';
  }

  // Recolectar datos del formulario
  const code = $('cf-code').value.trim();
  const bankSelect = $('cf-bank').value;
  const customBank = $('cf-custom-bank')?.value.trim() || '';
  const customName = $('cf-custom-name').value.trim();
  const accountNumber = $('cf-account').value.trim();
  const icon = $('cf-icon').value.trim() || '🏦';
  const color = $('cf-color').value || '#0A2A4A';
  const notes = $('cf-notes').value.trim();
  const commissionRate = (Number($('cf-commissionRate')?.value) || 0) / 100;
  const active = $('cf-active').checked;

  // Determinar el nombre real del banco
  let bank = '';
  if (bankSelect === '__otro__') {
    bank = customBank;
  } else {
    bank = bankSelect;
  }

  // Validaciones
  if (!bank) return alert('⚠️ Debes seleccionar o escribir un banco/plataforma');
  if (!customName) return alert('⚠️ El nombre descriptivo es obligatorio');
  if (!code) return alert('⚠️ El código no se pudo generar. Recarga el modal.');

  // Verificar duplicados (solo en creación)
  if (!channelId) {
    const existing = paymentChannels.find(c => c.code === code);
    if (existing) {
      return alert(`⚠️ Ya existe un canal con el código ${code}. Recarga y vuelve a intentar.`);
    }
  }

  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Guardando...'; }

  const data = {
    code,
    type,
    bank,
    customName,
    accountNumber,
    icon,
    color,
    notes,
    commissionRate,
    active,
    updatedAt: serverTimestamp()
  };

  try {
    if (channelId) {
      // Editar
      const before = paymentChannels.find(c => c.id === channelId);
      await updateDoc(doc(db, 'paymentChannels', channelId), data);

      await audit({
        action: 'update',
        collection: 'paymentChannels',
        docId: channelId,
        before: { code: before.code, bank: before.bank, customName: before.customName, active: before.active },
        after: data,
        note: `Canal editado: ${code} · ${bank} — ${customName}`
      });
    } else {
      // Crear
      const ref = await addDoc(collection(db, 'paymentChannels'), {
        ...data,
        createdAt: serverTimestamp(),
        createdBy: currentUser.email
      });

      await audit({
        action: 'create',
        collection: 'paymentChannels',
        docId: ref.id,
        after: data,
        note: `Canal creado: ${code} · ${bank} — ${customName}`
      });
    }

    // Recargar canales y refrescar UI
    await reloadPaymentChannels();

    closeChannelForm();
    // Reabrir el modal de lista (ya actualizado)
    openChannelsModal(type);

    alert(channelId ? '✅ Canal actualizado' : '✅ Canal creado');
  } catch(e) {
    console.error('Error en saveChannel:', e);
    alert('Error: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '💾 Guardar'; }
  }
};

function generateNextChannelCode(type) {
  const prefix = type === 'transferencia' ? 'CH' : 'CR';
  const allCodes = paymentChannels
    .filter(c => c.type === type)
    .map(c => c.code || '')
    .filter(Boolean);

  let maxNum = 0;
  allCodes.forEach(code => {
    const m = code.match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });

  const next = maxNum + 1;
  return `${prefix}_${String(next).padStart(3, '0')}`;
}

window.onBankChange = () => {
  const sel = $('cf-bank');
  const value = sel.value;
  const wrap = $('cf-custom-bank-wrap');
  const customBankInput = $('cf-custom-bank');

  if (value === '__otro__') {
    wrap.classList.remove('hidden');
    // No sobreescribir si ya había un valor
    if (!customBankInput.value) customBankInput.value = '';
  } else {
    wrap.classList.add('hidden');
    // Autocompletar icono/color según el banco seleccionado
    const opt = sel.options[sel.selectedIndex];
    const icon = opt.dataset.icon || '';
    const color = opt.dataset.color || '';
    if (icon) $('cf-icon').value = icon;
    if (color) $('cf-color').value = color;
  }

  updatePreview();
};

window.updatePreview = () => {
  const el = $('cf-preview');
  if (!el) return;

  const bank = $('cf-bank')?.value === '__otro__'
    ? ($('cf-custom-bank')?.value || 'Otro')
    : ($('cf-bank')?.value || 'Banco');

  const customName = $('cf-custom-name')?.value || '';
  const account = $('cf-account')?.value || '';
  const icon = $('cf-icon')?.value || '🏦';
  const color = $('cf-color')?.value || '#0A2A4A';

  const displayName = customName ? `${bank} — ${customName}` : bank;

  el.innerHTML = `
    <div class="w-12 h-12 rounded-full flex items-center justify-center shrink-0 text-2xl"
         style="background:${color}20; border:2px solid ${color}40">
      ${icon}
    </div>
    <div class="flex-1 min-w-0">
      <p class="font-semibold text-sd text-sm truncate">${escapeHtml(displayName)}</p>
      ${account ? `<p class="text-xs text-gray-500 mt-0.5">Cuenta: <span class="font-mono">${escapeHtml(account)}</span></p>` : ''}
    </div>
  `;
};

async function reloadPaymentChannels() {
  try {
    const s = await getDocs(collection(db,'paymentChannels'));
    paymentChannels = s.docs.map(d => ({id:d.id, ...d.data()}));
    window.SmartecCache.set('paymentChannels', paymentChannels);
    renderPaymentStats();
  } catch(e) {
    console.warn('Error recargando paymentChannels:', e);
  }
}

window.toggleChannel = async (channelId) => {
  const c = paymentChannels.find(x => x.id === channelId);
  if (!c) return;

  const willActivate = c.active === false;
  if (!confirm(`¿${willActivate ? 'Activar' : 'Desactivar'} el canal "${c.bank} — ${c.customName}"?`)) return;

  try {
    await updateDoc(doc(db, 'paymentChannels', channelId), {
      active: willActivate,
      updatedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'paymentChannels',
      docId: channelId,
      before: { active: c.active },
      after: { active: willActivate },
      note: `Canal ${willActivate ? 'activado' : 'desactivado'}: ${c.code} · ${c.bank} — ${c.customName}`
    });

    await reloadPaymentChannels();
    openChannelsModal(c.type);
  } catch(e) {
    console.error(e);
    alert('Error: ' + e.message);
  }
};

window.deleteChannel = async (channelId) => {
  const c = paymentChannels.find(x => x.id === channelId);
  if (!c) return;

  // Verificar si el canal tiene ventas asociadas
  // Por ahora revisamos en el estado `sales` en memoria.
  // (En FASE 2 las ventas guardarán `paymentChannelId`)
  const salesWithChannel = sales.filter(s => s.paymentChannelId === channelId);

  if (salesWithChannel.length > 0) {
    alert(
      `⛔ Este canal tiene ${salesWithChannel.length} venta(s) asociada(s).\n\n` +
      `No se puede eliminar porque afectaría la trazabilidad.\n\n` +
      `En su lugar, usa "Desactivar" para ocultarlo del POS sin perder el historial.`
    );
    return;
  }

  if (!confirm(`⚠️ ¿Eliminar definitivamente el canal "${c.bank} — ${c.customName}"?\n\nEsta acción no se puede deshacer.`)) return;

  try {
    await deleteDoc(doc(db, 'paymentChannels', channelId));

    await audit({
      action: 'delete',
      collection: 'paymentChannels',
      docId: channelId,
      before: { code: c.code, bank: c.bank, customName: c.customName, type: c.type },
      note: `Canal eliminado: ${c.code} · ${c.bank} — ${c.customName}`
    });

    await reloadPaymentChannels();
    openChannelsModal(c.type);

    alert('✅ Canal eliminado');
  } catch(e) {
    console.error(e);
    alert('Error: ' + e.message);
  }
};

function renderChannelCard(c) {
  const icon = c.icon || (c.type === 'transferencia' ? '🏦' : '🛍️');
  const bank = escapeHtml(c.bank || '');
  const customName = escapeHtml(c.customName || '');
  const account = escapeHtml(c.accountNumber || '');
  const active = c.active !== false;

  const displayName = customName ? `${bank} — ${customName}` : bank;

    const commissionLine = (c.type === 'credito' && c.commissionRate)
    ? `<p class="text-xs text-gray-500 mt-0.5">Comisión comercio: <b class="text-sl">${(c.commissionRate*100).toFixed(2)}%</b></p>`
    : '';

  // Badge de estado
  const badge = active
    ? '<span class="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Activo</span>'
    : '<span class="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-semibold">Inactivo</span>';

  // Color de fondo del ícono
  const colorBg = c.color || '#e5e7eb';

  return `
    <div class="border rounded-lg p-4 flex items-center gap-3 ${active ? 'bg-white' : 'bg-gray-50 opacity-70'}">
      <div class="w-12 h-12 rounded-full flex items-center justify-center shrink-0 text-2xl"
           style="background:${colorBg}20; border:2px solid ${colorBg}40">
        ${icon}
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <p class="font-semibold text-sd text-sm truncate">${displayName}</p>
          ${badge}
        </div>
        ${account ? `<p class="text-xs text-gray-500 mt-0.5">Cuenta: <span class="font-mono">${account}</span></p>` : ''}
        ${commissionLine}
      </div>

      <div class="flex gap-2 shrink-0">
        <button onclick="openChannelForm('${c.id}')" class="text-sl hover:text-sd text-xs font-semibold px-2 py-1" title="Editar">
          ✏️ Editar
        </button>
        <button onclick="toggleChannel('${c.id}')" class="text-xs font-semibold px-2 py-1 ${active ? 'text-orange-500 hover:text-orange-700' : 'text-green-600 hover:text-green-800'}" title="${active ? 'Desactivar' : 'Activar'}">
          ${active ? '⏸ Desactivar' : '▶ Activar'}
        </button>
        <button onclick="deleteChannel('${c.id}')" class="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1" title="Eliminar">
          🗑
        </button>
      </div>
    </div>
  `;
}

/* ============================================================
   CONFIGURACIÓN
============================================================ */
function renderSettings() {
  // 🆕 Actualizar contadores de métodos de pago
  renderPaymentStats();

  // 🆕 Actualizar el resumen de categorías
  renderCategoriesSummary();

  $('set-whatsapp').value = settings.whatsapp || '';
  $('set-minstock').value = settings.minStock || 5;
  $('set-taxEnabled').checked = !!settings.taxEnabled;
  $('set-taxRate').value = (settings.taxRate||0)*100;
  $('set-dianEnabled').checked = !!settings.dianEnabled;
  $('set-dianProvider').value = settings.dianProvider || '';

  // Datos de la empresa
  $('set-razonSocial').value = settings.companyRazonSocial || '';
  $('set-nit').value = settings.companyNit || '';
  $('set-regimen').value = settings.companyRegimen || '';
  $('set-companyAddress').value = settings.companyAddress || '';
  $('set-companyPhone').value = settings.companyPhone || '';
  $('set-companyEmail').value = settings.companyEmail || '';
  // 🆕 Render logo
   renderLogoPreview();

}

/* ============================================================
   🆕 LOGO — Identidad visual
============================================================ */

let _pendingLogoFile = null;      // Archivo seleccionado pendiente de guardar
let _currentLogoUrl = null;       // URL del logo guardado en Firestore
let _pendingFooterLogoFile = null; // Archivo del logo del footer pendiente
let _currentFooterLogoUrl = null;  // URL del logo del footer guardado
let _pendingFaviconFile = null;   // Archivo del favicon pendiente de guardar
let _currentFaviconUrl = null;    // URL del favicon guardado en Firestore

/**
 * Renderiza la vista previa del logo según el estado actual.
 */
function renderLogoPreview() {
  // ============ HEADER ============
  const container = $('logo-preview-container');
  const removeBtn = $('logo-remove-btn');
  const saveBtn = $('logo-save-btn');

  if (container) {
    if (_pendingLogoFile) {
      const blobUrl = URL.createObjectURL(_pendingLogoFile);
      container.innerHTML = `<img src="${blobUrl}" class="max-h-32 max-w-full object-contain">`;
      removeBtn?.classList.remove('hidden');
      saveBtn?.classList.remove('hidden');
      if (removeBtn) removeBtn.innerText = '↩️ Descartar';
    } else {
      _currentLogoUrl = settings.logoUrl || null;
      if (_currentLogoUrl) {
        container.innerHTML = `<img src="${_currentLogoUrl}" class="max-h-32 max-w-full object-contain" alt="Logo">`;
        removeBtn?.classList.remove('hidden');
        saveBtn?.classList.add('hidden');
        if (removeBtn) removeBtn.innerText = '🗑 Eliminar';
      } else {
        container.innerHTML = '<p class="text-xs text-gray-400 italic">Sin logo</p>';
        removeBtn?.classList.add('hidden');
        saveBtn?.classList.add('hidden');
      }
    }
  }

  // ============ FOOTER ============
  const fContainer = $('footer-logo-preview-container');
  const fRemoveBtn = $('footer-logo-remove-btn');
  const fSaveBtn = $('footer-logo-save-btn');

  if (fContainer) {
    if (_pendingFooterLogoFile) {
      const blobUrl = URL.createObjectURL(_pendingFooterLogoFile);
      fContainer.innerHTML = `<img src="${blobUrl}" class="max-h-32 max-w-full object-contain">`;
      fRemoveBtn?.classList.remove('hidden');
      fSaveBtn?.classList.remove('hidden');
      if (fRemoveBtn) fRemoveBtn.innerText = '↩️ Descartar';
    } else {
      _currentFooterLogoUrl = settings.footerLogoUrl || null;
      if (_currentFooterLogoUrl) {
        fContainer.innerHTML = `<img src="${_currentFooterLogoUrl}" class="max-h-32 max-w-full object-contain" alt="Logo del footer">`;
        fRemoveBtn?.classList.remove('hidden');
        fSaveBtn?.classList.add('hidden');
        if (fRemoveBtn) fRemoveBtn.innerText = '🗑 Eliminar';
      } else {
        fContainer.innerHTML = '<p class="text-xs text-gray-400 italic">Sin logo</p>';
        fRemoveBtn?.classList.add('hidden');
        fSaveBtn?.classList.add('hidden');
      }
    }
  }

  // ============ FAVICON ============
  const favContainer = $('favicon-preview-container');
  const favRemoveBtn = $('favicon-remove-btn');
  const favSaveBtn = $('favicon-save-btn');

  if (favContainer) {
    if (_pendingFaviconFile) {
      const blobUrl = URL.createObjectURL(_pendingFaviconFile);
      favContainer.innerHTML = `<img src="${blobUrl}" class="max-h-full max-w-full object-contain" style="image-rendering: crisp-edges">`;
      favRemoveBtn?.classList.remove('hidden');
      favSaveBtn?.classList.remove('hidden');
      if (favRemoveBtn) favRemoveBtn.innerText = '↩️ Descartar';
    } else {
      _currentFaviconUrl = settings.faviconUrl || null;
      if (_currentFaviconUrl) {
        favContainer.innerHTML = `<img src="${_currentFaviconUrl}" class="max-h-full max-w-full object-contain" style="image-rendering: crisp-edges">`;
        favRemoveBtn?.classList.remove('hidden');
        favSaveBtn?.classList.add('hidden');
        if (favRemoveBtn) favRemoveBtn.innerText = '🗑 Eliminar';
      } else {
        favContainer.innerHTML = '<p class="text-[10px] text-gray-400 italic text-center">Sin favicon</p>';
        favRemoveBtn?.classList.add('hidden');
        favSaveBtn?.classList.add('hidden');
      }
    }
  }
}

/**
 * Inicializa los listeners del logo (llamar una sola vez al cargar el panel).
 */
function initLogoListeners() {
  // ============ HEADER ============
  initSingleLogoListeners({
    fileInputId: 'logo-file-input',
    dropzoneId: 'logo-dropzone',
    removeBtnId: 'logo-remove-btn',
    saveBtnId: 'logo-save-btn',
    onFile: (file) => handleLogoFile(file, 'header'),
    onRemove: async () => {
      if (_pendingLogoFile) {
        _pendingLogoFile = null;
        renderLogoPreview();
        showLogoStatus('', 'header');
        return;
      }
      if (!confirm('¿Eliminar el logo del header?\n\nEl catálogo volverá a mostrar el texto "SMARTEC".')) return;
      await deleteLogo('header');
    },
    onSave: () => saveLogo('header')
  });

  // ============ FOOTER ============
  initSingleLogoListeners({
    fileInputId: 'footer-logo-file-input',
    dropzoneId: 'footer-logo-dropzone',
    removeBtnId: 'footer-logo-remove-btn',
    saveBtnId: 'footer-logo-save-btn',
    onFile: (file) => handleLogoFile(file, 'footer'),
    onRemove: async () => {
      if (_pendingFooterLogoFile) {
        _pendingFooterLogoFile = null;
        renderLogoPreview();
        showLogoStatus('', 'footer');
        return;
      }
      if (!confirm('¿Eliminar el logo del footer?')) return;
      await deleteLogo('footer');
    },
    onSave: () => saveLogo('footer')
  });

  // ============ FAVICON ============
  initSingleLogoListeners({
    fileInputId: 'favicon-file-input',
    dropzoneId: 'favicon-dropzone',
    removeBtnId: 'favicon-remove-btn',
    saveBtnId: 'favicon-save-btn',
    onFile: (file) => handleLogoFile(file, 'favicon'),
    onRemove: async () => {
      if (_pendingFaviconFile) {
        _pendingFaviconFile = null;
        renderLogoPreview();
        showLogoStatus('', 'favicon');
        return;
      }
      if (!confirm('¿Eliminar el favicon?\n\nLas pestañas volverán a mostrar el ícono por defecto.')) return;
      await deleteLogo('favicon');
    },
    onSave: () => saveLogo('favicon')
  });
}

/**
 * Helper: conecta los listeners de UN logo (header o footer).
 */
function initSingleLogoListeners({ fileInputId, dropzoneId, removeBtnId, saveBtnId, onFile, onRemove, onSave }) {
  const fileInput = $(fileInputId);
  const dropzone = $(dropzoneId);
  const removeBtn = $(removeBtnId);
  const saveBtn = $(saveBtnId);
  if (!fileInput || fileInput.dataset.listeners) return;
  fileInput.dataset.listeners = '1';

  // Click en input
  fileInput.onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    fileInput.value = '';
  };

  // Click en dropzone → abrir selector
  if (dropzone) dropzone.onclick = () => fileInput.click();

  // Drag & drop
  if (dropzone) {
    ['dragenter', 'dragover'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) onFile(file);
    });
  }

  if (removeBtn) removeBtn.onclick = onRemove;
  if (saveBtn) saveBtn.onclick = onSave;
}

/**
 * Valida el archivo seleccionado y lo deja pendiente de guardar.
 */
function handleLogoFile(file, type = 'header') {
  // Valores por tipo
  const isFavicon = type === 'favicon';
  const validTypes = isFavicon
    ? ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']
    : ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
  const maxSizeMB = isFavicon ? 2 : 5;

  if (!validTypes.includes(file.type)) {
    const formats = isFavicon ? 'PNG, JPG, WebP, SVG o ICO' : 'JPG, PNG, WebP o SVG';
    showLogoStatus(`⚠️ Formato no soportado. Usa ${formats}.`, 'error', type);
    return;
  }
  if (file.size > maxSizeMB * 1024 * 1024) {
    showLogoStatus(`⚠️ El archivo supera ${maxSizeMB}MB.`, 'error', type);
    return;
  }

  if (type === 'footer') {
    _pendingFooterLogoFile = file;
  } else if (type === 'favicon') {
    _pendingFaviconFile = file;
  } else {
    _pendingLogoFile = file;
  }

  renderLogoPreview();
  showLogoStatus('✅ Listo para guardar. Clic en "Guardar".', 'ok', type);
}

/**
 * Sube el logo pendiente a Storage y lo guarda en Firestore.
 */
async function saveLogo(type = 'header') {
  const pending = type === 'footer' ? _pendingFooterLogoFile
                 : type === 'favicon' ? _pendingFaviconFile
                 : _pendingLogoFile;
  if (!pending) return;

  // IDs dinámicos según tipo
  const wrap = $(type === 'footer' ? 'footer-logo-progress-wrap'
              : type === 'favicon' ? 'favicon-progress-wrap'
              : 'logo-progress-wrap');
  const fill = $(type === 'footer' ? 'footer-logo-progress-fill'
              : type === 'favicon' ? 'favicon-progress-fill'
              : 'logo-progress-fill');
  const text = $(type === 'footer' ? 'footer-logo-progress-text'
              : type === 'favicon' ? 'favicon-progress-text'
              : 'logo-progress-text');
  const saveBtn = $(type === 'footer' ? 'footer-logo-save-btn'
                  : type === 'favicon' ? 'favicon-save-btn'
                  : 'logo-save-btn');

  wrap?.classList.add('active');
  if (fill) fill.style.width = '10%';
  if (text) text.innerText = '📤 Procesando…';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerText = '⏳ Subiendo…'; }

  try {
    // Convertir a WebP si no es SVG ni ICO
    let blob, contentType;
    if (pending.type === 'image/svg+xml') {
      blob = pending;
      contentType = 'image/svg+xml';
    } else if (pending.type === 'image/x-icon' || pending.type === 'image/vnd.microsoft.icon') {
      blob = pending;
      contentType = 'image/x-icon';
    } else {
      // El favicon conviene optimizarlo a un tamaño pequeño también
      const maxDim = type === 'favicon' ? 512 : 2000;
      const result = await convertImageToWebp(pending, maxDim);
      blob = result.blob;
      contentType = 'image/webp';
    }

    if (fill) fill.style.width = '50%';
    if (text) text.innerText = '📤 Subiendo a Storage…';

    // Nombre del archivo según tipo
    let ext;
    if (contentType === 'image/svg+xml') ext = 'svg';
    else if (contentType === 'image/x-icon') ext = 'ico';
    else ext = 'webp';

    const fileName = type === 'footer' ? `logo-footer.${ext}`
                    : type === 'favicon' ? `favicon.${ext}`
                    : `logo.${ext}`;
    const path = `settings/${fileName}`;
    const storageRef = ref(storage, path);

    await uploadBytes(storageRef, blob, {
      contentType,
      cacheControl: 'public, max-age=3600'
    });

    if (fill) fill.style.width = '85%';
    if (text) text.innerText = '💾 Guardando URL…';

    const url = await getDownloadURL(storageRef);

    // Campo de Firestore según tipo
    const fieldName = type === 'footer' ? 'footerLogoUrl'
                    : type === 'favicon' ? 'faviconUrl'
                    : 'logoUrl';

    const updatePayload = {
      [fieldName]: url,
      updatedAt: serverTimestamp()
    };
    if (type === 'footer') updatePayload.footerLogoUpdatedAt = serverTimestamp();
    else if (type === 'favicon') updatePayload.faviconUpdatedAt = serverTimestamp();
    else updatePayload.logoUpdatedAt = serverTimestamp();

    await updateDoc(doc(db, 'settings', 'general'), updatePayload);

    // Auditoría
    const auditLabel = type === 'footer' ? 'Logo del footer actualizado'
                       : type === 'favicon' ? 'Favicon actualizado'
                       : 'Logo del header actualizado';
    await audit({
      action: 'update',
      collection: 'settings',
      docId: 'general',
      note: auditLabel
    });

    // Cache local
    window.SmartecCache.invalidate('settings');
    settings[fieldName] = url;

    if (type === 'footer') _pendingFooterLogoFile = null;
    else if (type === 'favicon') _pendingFaviconFile = null;
    else _pendingLogoFile = null;

    if (fill) fill.style.width = '100%';
    if (text) text.innerText = '✅ Guardado';
    showLogoStatus('✅ Actualizado correctamente.', 'ok', type);

    renderLogoPreview();

    setTimeout(() => {
      wrap?.classList.remove('active');
      if (fill) fill.style.width = '0%';
    }, 1500);

  } catch (e) {
    console.error('Error guardando logo:', e);
    showLogoStatus('❌ Error: ' + e.message, 'error', type);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = '💾 Guardar'; }
  }
}

/**
 * Elimina el logo actual de Storage y de Firestore.
 */
async function deleteLogo(type = 'header') {
  try {
    // Rutas a intentar borrar
    const fileBase = type === 'footer' ? 'logo-footer'
                    : type === 'favicon' ? 'favicon'
                    : 'logo';
    const paths = [
      `settings/${fileBase}.webp`,
      `settings/${fileBase}.svg`,
      `settings/${fileBase}.ico`
    ];

    for (const p of paths) {
      try {
        await deleteObject(ref(storage, p));
      } catch (e) {
        // Silencioso: archivo no existe, no importa
      }
    }

    // Quitar el campo de Firestore
    const fieldName = type === 'footer' ? 'footerLogoUrl'
                    : type === 'favicon' ? 'faviconUrl'
                    : 'logoUrl';
    const updatePayload = {
      [fieldName]: null,
      updatedAt: serverTimestamp()
    };
    if (type === 'footer') updatePayload.footerLogoUpdatedAt = serverTimestamp();
    else if (type === 'favicon') updatePayload.faviconUpdatedAt = serverTimestamp();
    else updatePayload.logoUpdatedAt = serverTimestamp();

    await updateDoc(doc(db, 'settings', 'general'), updatePayload);

    const auditLabel = type === 'footer' ? 'Logo del footer eliminado'
                       : type === 'favicon' ? 'Favicon eliminado'
                       : 'Logo del header eliminado';
    await audit({
      action: 'update',
      collection: 'settings',
      docId: 'general',
      note: auditLabel
    });

    window.SmartecCache.invalidate('settings');
    settings[fieldName] = null;

    if (type === 'footer') {
      _pendingFooterLogoFile = null;
      _currentFooterLogoUrl = null;
    } else if (type === 'favicon') {
      _pendingFaviconFile = null;
      _currentFaviconUrl = null;
    } else {
      _pendingLogoFile = null;
      _currentLogoUrl = null;
    }

    renderLogoPreview();
    showLogoStatus('✅ Eliminado.', 'ok', type);

  } catch (e) {
    console.error('Error eliminando logo:', e);
    showLogoStatus('❌ Error eliminando: ' + e.message, 'error', type);
  }
}
/**
 * Convierte una imagen a WebP optimizado (92%, máx 2000px).
 * Reutilizable para logo y otros usos.
 */
async function convertImageToWebp(file, maxDim = 2000) {
  const imageBitmap = await loadImageFromFile(file);
  const MAX_DIM = Number(maxDim) || 2000;
  let { width, height } = imageBitmap;
  if (width > MAX_DIM || height > MAX_DIM) {
    const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0, width, height);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('No se pudo convertir a WebP')),
      'image/webp',
      0.92
    );
  });
  return { blob };
}

/**
 * Muestra un mensaje de estado debajo de los botones.
 */
function showLogoStatus(msg, statusType = 'ok', logoTarget = 'header') {
  const el = $(logoTarget === 'footer' ? 'footer-logo-status-msg' : 'logo-status-msg');
  if (!el) return;
  if (!msg) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerText = msg;
  el.className = 'text-xs ' + (statusType === 'error' ? 'text-red-600' : 'text-green-600');
}

$('save-general-settings').onclick = async () => {
  await updateDoc(doc(db,'settings','general'), {
    whatsapp: $('set-whatsapp').value.trim(),
    minStock: Number($('set-minstock').value)||5,
    companyRazonSocial: $('set-razonSocial').value.trim(),
    companyNit: $('set-nit').value.trim(),
    companyRegimen: $('set-regimen').value,
    companyAddress: $('set-companyAddress').value.trim(),
    companyPhone: $('set-companyPhone').value.trim(),
    companyEmail: $('set-companyEmail').value.trim(),
    updatedAt: serverTimestamp()
  });
  await audit({ action:'update', collection:'settings', docId:'general', note:'Config general actualizada' });
  window.SmartecCache.invalidate('settings');
  alert('Guardado ✅');
  await loadAll();
};

$('save-tax-settings').onclick = async () => {
  await updateDoc(doc(db,'settings','general'), {
    taxEnabled: $('set-taxEnabled').checked,
    taxRate: (Number($('set-taxRate').value)||0)/100,
    updatedAt: serverTimestamp()
  });
  await audit({ action:'update', collection:'settings', docId:'general', note:'Config IVA actualizada' });
  window.SmartecCache.invalidate('settings');
  alert('Guardado ✅');
  await loadAll();
};

$('save-dian-settings').onclick = async () => {
  await updateDoc(doc(db,'settings','general'), {
    dianEnabled: $('set-dianEnabled').checked,
    dianProvider: $('set-dianProvider').value || null,
    updatedAt: serverTimestamp()
  });
  await audit({ action:'update', collection:'settings', docId:'general', note:'Config DIAN actualizada' });
  window.SmartecCache.invalidate('settings');
  alert('Guardado ✅');
  await loadAll();
};

document.querySelectorAll('[data-seasonal]').forEach(cb => {
  cb.addEventListener('change', async (e) => {
    const slug = e.target.dataset.seasonal;
    const cats = settings.categories || {};
    if (cats[slug]) {
      cats[slug].seasonalActive = e.target.checked;
      await updateDoc(doc(db,'settings','general'), { categories: cats, updatedAt: serverTimestamp() });
      await audit({ action:'update', collection:'settings', docId:'general', note:`Estacional ${slug}: ${e.target.checked}` });
    }
  });
});

/* ============================================================
   🆕 GESTOR DE CATEGORÍAS Y SUBCATEGORÍAS
   ============================================================ */

/**
 * Estado temporal mientras el gestor está abierto.
 * Se llena al abrir el modal y se limpia al cerrar.
 */
let _categoriesDraft = null;

/**
 * Lee las categorías actuales desde settings (o desde el draft si está abierto).
 */
function getCategoriesSource() {
  if (_categoriesDraft) return _categoriesDraft;
  return settings.categories || {};
}

/**
 * Genera un slug a partir de un texto.
 * Ej: "Ropa Deportiva" → "ropa-deportiva"
 */
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quitar acentos
    .replace(/[^a-z0-9\s-]/g, '')                        // quitar símbolos
    .trim()
    .replace(/\s+/g, '-')                                // espacios → guiones
    .replace(/-+/g, '-');                                // guiones múltiples → uno
}

/**
 * Genera un slug único dentro de un objeto de categorías/subcategorías.
 * Si ya existe, le agrega -2, -3, etc.
 */
function uniqueSlug(baseSlug, existingKeys) {
  const keys = new Set(existingKeys || []);
  if (!keys.has(baseSlug)) return baseSlug;
  let i = 2;
  while (keys.has(`${baseSlug}-${i}`)) i++;
  return `${baseSlug}-${i}`;
}

/**
 * Renderiza el resumen compacto en la sección de Configuración.
 * Muestra 4 contadores: total categorías, visibles, total subcategorías, ocultas.
 */
function renderCategoriesSummary() {
  const el = $('categories-summary');
  if (!el) return;

  const cats = settings.categories || {};
  const catEntries = Object.entries(cats);

  const totalCats = catEntries.length;
  const visibleCats = catEntries.filter(([_, g]) => g.seasonalActive !== false).length;
  const hiddenCats = totalCats - visibleCats;

  let totalSubs = 0;
  let visibleSubs = 0;
  catEntries.forEach(([_, g]) => {
    const subs = Object.entries(g.subcategories || {});
    totalSubs += subs.length;
    visibleSubs += subs.filter(([_, s]) => s.seasonalActive !== false).length;
  });

  el.innerHTML = `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
      <p class="text-[10px] text-blue-700 uppercase font-semibold">Categorías</p>
      <p class="text-xl font-bold text-sd mt-1">${totalCats}</p>
      <p class="text-[10px] text-gray-500 mt-0.5">${visibleCats} visibles · ${hiddenCats} ocultas</p>
    </div>
    <div class="bg-purple-50 border border-purple-200 rounded-lg p-3">
      <p class="text-[10px] text-purple-700 uppercase font-semibold">Subcategorías</p>
      <p class="text-xl font-bold text-sd mt-1">${totalSubs}</p>
      <p class="text-[10px] text-gray-500 mt-0.5">${visibleSubs} visibles</p>
    </div>
    <div class="bg-green-50 border border-green-200 rounded-lg p-3">
      <p class="text-[10px] text-green-700 uppercase font-semibold">Productos activos</p>
      <p class="text-xl font-bold text-sd mt-1">${products.filter(p => p.active !== false).length}</p>
      <p class="text-[10px] text-gray-500 mt-0.5">en el catálogo</p>
    </div>
    <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
      <p class="text-[10px] text-amber-700 uppercase font-semibold">Con inventario</p>
      <p class="text-xl font-bold text-sd mt-1">${(() => {
        const catSet = new Set();
        inventory.forEach(i => {
          if (Number(i.stock || 0) > 0) {
            const p = products.find(x => x.id === i.productId);
            if (p && p.categoryGroup) catSet.add(p.categoryGroup);
          }
        });
        return catSet.size;
      })()}</p>
      <p class="text-[10px] text-gray-500 mt-0.5">categorías bloqueadas para eliminar</p>
    </div>
  `;
}

/* ============================================================
   ABRIR / CERRAR GESTOR
============================================================ */
window.openCategoriesManager = () => {
  // Clonar settings.categories en el draft (para no ensuciar hasta guardar)
  _categoriesDraft = JSON.parse(JSON.stringify(settings.categories || {}));

  renderCategoriesList();

  const m = $('categories-modal');
  if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
};

window.closeCategoriesManager = () => {
  _categoriesDraft = null;
  const m = $('categories-modal');
  if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
};

/* ============================================================
   LISTAR CATEGORÍAS + SUBCATEGORÍAS
============================================================ */
function renderCategoriesList() {
  const listEl = $('categories-list');
  const emptyEl = $('categories-empty');
  if (!listEl) return;

  const cats = getCategoriesSource();
  const entries = Object.entries(cats).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

  if (!entries.length) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = entries.map(([slug, g]) => {
    const subs = Object.entries(g.subcategories || {})
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

    // Contadores: productos y stock total de esta categoría
    const productsOfCat = products.filter(p => p.categoryGroup === slug);
    const activeProductsOfCat = productsOfCat.filter(p => p.active !== false);
    const productIdsOfCat = new Set(productsOfCat.map(p => p.id));
    const stockOfCat = inventory
      .filter(i => productIdsOfCat.has(i.productId))
      .reduce((sum, i) => sum + Number(i.stock || 0), 0);

    const isVisible = g.seasonalActive !== false;
    const visibilityBadge = isVisible
      ? '<span class="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">👁 Visible</span>'
      : '<span class="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-semibold">🚫 Oculta</span>';

    const stockBadge = stockOfCat > 0
      ? `<span class="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">📦 ${stockOfCat} en stock</span>`
      : '';

    const subsHtml = subs.length
      ? subs.map(([subSlug, s]) => {
          const subVisible = s.seasonalActive !== false;
          const subBadge = subVisible
            ? '<span class="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">👁</span>'
            : '<span class="text-[9px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full font-semibold">🚫</span>';
          const productsOfSub = products.filter(p => p.categoryGroup === slug && p.category === subSlug);
          const stockOfSub = inventory
            .filter(i => productsOfSub.some(p => p.id === i.productId))
            .reduce((sum, i) => sum + Number(i.stock || 0), 0);
          const subStockBadge = stockOfSub > 0
            ? `<span class="text-[9px] text-red-600 ml-1">📦 ${stockOfSub}</span>`
            : '';

          return `
            <div class="sub-row flex items-center justify-between py-1.5 pl-6 border-b border-gray-100 last:border-0 cursor-move"
                 draggable="true"
                 data-cat-slug="${slug}"
                 data-sub-slug="${subSlug}">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="drag-handle text-gray-300 hover:text-gray-500 select-none" title="Arrastra para reordenar">⋮⋮</span>
                <span class="text-xs text-gray-500">└</span>
                <span class="text-xs text-gray-700 truncate">${escapeHtml(s.name)}</span>
                ${subBadge}
                ${subStockBadge}
                <span class="text-[10px] text-gray-400">(${productsOfSub.length} prod.)</span>
              </div>
              <div class="flex gap-2 shrink-0">
                <button onclick="toggleSubcategoryVisibility('${slug}','${subSlug}')" class="text-[10px] text-sl hover:underline font-semibold">
                  ${subVisible ? '🚫 Ocultar' : '👁 Mostrar'}
                </button>
                <button onclick="openCategoryForm('${slug}','${subSlug}')" class="text-[10px] text-sl hover:underline font-semibold">✏️</button>
                <button onclick="confirmDeleteSubcategory('${slug}','${subSlug}')" class="text-[10px] text-red-500 hover:underline font-semibold">🗑</button>
              </div>
            </div>
          `;
        }).join('')
      : '<p class="text-[10px] text-gray-400 italic pl-6 py-1">Sin subcategorías</p>';

    return `
      <div class="category-card border rounded-lg overflow-hidden bg-white transition-shadow"
           draggable="true"
           data-cat-slug="${slug}">
        <div class="p-4 flex justify-between items-start gap-3 flex-wrap">
          <div class="min-w-0 flex-1 flex items-start gap-2">
            <span class="drag-handle text-gray-300 hover:text-gray-500 select-none mt-1 cursor-move text-lg leading-none" title="Arrastra para reordenar">⋮⋮</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h4 class="font-bold text-sd text-sm">${escapeHtml(g.name)}</h4>
                ${visibilityBadge}
                ${stockBadge}
              </div>
              <p class="text-[10px] text-gray-400 font-mono mt-0.5">${slug}</p>
              <p class="text-[10px] text-gray-500 mt-1">
                ${activeProductsOfCat.length} producto(s) activo(s) · ${subs.length} subcategoría(s)
              </p>
            </div>
          </div>
          <div class="flex gap-2 flex-wrap shrink-0">
            <button onclick="toggleCategoryVisibility('${slug}')" class="text-[10px] ${isVisible ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-green-100 text-green-700 hover:bg-green-200'} px-3 py-1.5 rounded-full font-semibold transition">
              ${isVisible ? '🚫 Ocultar' : '👁 Mostrar'}
            </button>
            <button onclick="openCategoryForm('${slug}')" class="text-[10px] bg-sl text-white px-3 py-1.5 rounded-full font-semibold hover:bg-sd transition">
              ✏️ Editar
            </button>
            <button onclick="openCategoryForm('${slug}', null, true)" class="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-full font-semibold hover:bg-blue-100 transition">
              + Subcategoría
            </button>
            <button onclick="confirmDeleteCategory('${slug}')" class="text-[10px] bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-full font-semibold hover:bg-red-100 transition">
              🗑
            </button>
          </div>
        </div>
        <div class="subs-container bg-gray-50 border-t border-gray-100">
          ${subsHtml}
        </div>
      </div>
    `;
  }).join('');

  // 🆕 Activar drag & drop después de renderizar
  attachCategoryDragListeners();
}

/* ============================================================
   🆕 DRAG & DROP — REORDENAR CATEGORÍAS Y SUBCATEGORÍAS
   Versión robusta: usa un solo listener global en el contenedor
============================================================ */

function attachCategoryDragListeners() {
  const listEl = $('categories-list');
  if (!listEl) return;

  // Evitar enganchar múltiples veces
  if (listEl.dataset.dragListeners === '1') return;
  listEl.dataset.dragListeners = '1';

  let dragType = null;     // 'category' | 'subcategory'
  let dragCatSlug = null;
  let dragSubSlug = null;

  // ============================================================
  // DRAGSTART — capturamos qué se está arrastrando
  // ============================================================
  listEl.addEventListener('dragstart', (e) => {
    const subRow = e.target.closest('.sub-row');
    const catCard = e.target.closest('.category-card');

    if (subRow) {
      dragType = 'subcategory';
      dragCatSlug = subRow.dataset.catSlug;
      dragSubSlug = subRow.dataset.subSlug;
      subRow.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'sub');
      return;
    }

    if (catCard) {
      dragType = 'category';
      dragCatSlug = catCard.dataset.catSlug;
      dragSubSlug = null;
      catCard.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'cat');
      return;
    }
  });

  // ============================================================
  // DRAGEND — limpiamos todo
  // ============================================================
  listEl.addEventListener('dragend', (e) => {
    // Restaurar opacidad
    listEl.querySelectorAll('.category-card, .sub-row').forEach(el => {
      el.style.opacity = '';
      el.classList.remove('border-sl', 'shadow-md', 'bg-blue-100', 'ring-2', 'ring-sl');
    });

    dragType = null;
    dragCatSlug = null;
    dragSubSlug = null;
  });

  // ============================================================
  // DRAGOVER — habilitamos el drop y mostramos feedback visual
  // ============================================================
  listEl.addEventListener('dragover', (e) => {
    if (!dragType) return;

    if (dragType === 'category') {
      const targetCard = e.target.closest('.category-card');
      if (!targetCard) return;
      if (targetCard.dataset.catSlug === dragCatSlug) return;

      e.preventDefault();   // 🔑 ESTO habilita el drop
      e.dataTransfer.dropEffect = 'move';
      targetCard.classList.add('border-sl', 'shadow-md');
      return;
    }

    if (dragType === 'subcategory') {
      const targetSub = e.target.closest('.sub-row');
      if (!targetSub) return;
      if (targetSub.dataset.catSlug !== dragCatSlug) return;
      if (targetSub.dataset.subSlug === dragSubSlug) return;

      e.preventDefault();   // 🔑 ESTO habilita el drop
      e.dataTransfer.dropEffect = 'move';
      targetSub.classList.add('bg-blue-100', 'ring-2', 'ring-sl');
      return;
    }
  });

  // ============================================================
  // DRAGLEAVE — quitamos feedback visual
  // ============================================================
  listEl.addEventListener('dragleave', (e) => {
    const target = e.target.closest('.category-card, .sub-row');
    if (!target) return;
    target.classList.remove('border-sl', 'shadow-md', 'bg-blue-100', 'ring-2', 'ring-sl');
  });

  // ============================================================
  // DROP — ejecutamos el reordenamiento
  // ============================================================
  listEl.addEventListener('drop', async (e) => {
    if (!dragType) return;

    if (dragType === 'category') {
      const targetCard = e.target.closest('.category-card');
      if (!targetCard) return;
      if (targetCard.dataset.catSlug === dragCatSlug) return;

      e.preventDefault();
      const fromSlug = dragCatSlug;
      const toSlug = targetCard.dataset.catSlug;

      dragType = null;
      dragCatSlug = null;

      await reorderCategory(fromSlug, toSlug);
      return;
    }

    if (dragType === 'subcategory') {
      const targetSub = e.target.closest('.sub-row');
      if (!targetSub) return;
      if (targetSub.dataset.catSlug !== dragCatSlug) return;
      if (targetSub.dataset.subSlug === dragSubSlug) return;

      e.preventDefault();
      const fromCat = dragCatSlug;
      const fromSub = dragSubSlug;
      const toSub = targetSub.dataset.subSlug;

      dragType = null;
      dragCatSlug = null;
      dragSubSlug = null;

      await reorderSubcategory(fromCat, fromSub, toSub);
      return;
    }
  });
}
/* ============================================================
   REORDENAR: intercambia los valores de `order` entre dos items
============================================================ */
async function reorderCategory(fromSlug, toSlug) {
  const cats = getCategoriesSource();
  if (!cats[fromSlug] || !cats[toSlug]) return;

  const fromOrder = Number(cats[fromSlug].order || 0);
  const toOrder = Number(cats[toSlug].order || 0);

  // Intercambiar
  cats[fromSlug].order = toOrder;
  cats[toSlug].order = fromOrder;

  await persistCategories(
    `🔄 Reordenadas: "${cats[fromSlug].name}" ↔ "${cats[toSlug].name}"`
  );
}

async function reorderSubcategory(catSlug, fromSubSlug, toSubSlug) {
  const cats = getCategoriesSource();
  if (!cats[catSlug] || !cats[catSlug].subcategories) return;
  const subs = cats[catSlug].subcategories;
  if (!subs[fromSubSlug] || !subs[toSubSlug]) return;

  const fromOrder = Number(subs[fromSubSlug].order || 0);
  const toOrder = Number(subs[toSubSlug].order || 0);

  // Intercambiar
  subs[fromSubSlug].order = toOrder;
  subs[toSubSlug].order = fromOrder;

  await persistCategories(
    `🔄 Reordenadas subcategorías: "${subs[fromSubSlug].name}" ↔ "${subs[toSubSlug].name}"`
  );
}
/* ============================================================
   TOGGLE DE VISIBILIDAD (persiste inmediatamente)
   🆕 Advertencia si hay productos activos al OCULTAR
============================================================ */
window.toggleCategoryVisibility = async (catSlug) => {
  const cats = getCategoriesSource();
  if (!cats[catSlug]) return;

  const willBeVisible = cats[catSlug].seasonalActive === false; // si estaba oculta → ahora visible
  const catName = cats[catSlug].name;

  // 🆕 Si vamos a OCULTAR, advertir si hay productos activos
  if (!willBeVisible) {
    const activeProducts = products.filter(p =>
      p.categoryGroup === catSlug && p.active !== false
    );
    if (activeProducts.length > 0) {
      const stock = inventory
        .filter(i => activeProducts.some(p => p.id === i.productId))
        .reduce((sum, i) => sum + Number(i.stock || 0), 0);

      const msg =
        `🚫 Ocultar categoría "${catName}"\n\n` +
        `Esta categoría tiene ${activeProducts.length} producto(s) activo(s).\n` +
        (stock > 0 ? `📦 Stock actual: ${stock} unidad(es)\n\n` : '\n') +
        `Al ocultarla:\n` +
        `• Desaparecerá del menú del catálogo público\n` +
        `• Sus productos ya no serán navegables desde esa categoría\n` +
        `• El inventario y los productos se conservan intactos\n` +
        `• Puedes volver a mostrarla cuando quieras\n\n` +
        `¿Continuar?`;

      if (!confirm(msg)) return;
    }
  }

  cats[catSlug].seasonalActive = willBeVisible;
  cats[catSlug].seasonal = true;

  // 🔒 Persistir inmediatamente
  await persistCategories(
    `${willBeVisible ? '👁 Categoría visible' : '🚫 Categoría oculta'}: ${catName}`
  );
};

window.toggleSubcategoryVisibility = async (catSlug, subSlug) => {
  const cats = getCategoriesSource();
  if (!cats[catSlug] || !cats[catSlug].subcategories[subSlug]) return;

  const sub = cats[catSlug].subcategories[subSlug];
  const willBeVisible = sub.seasonalActive === false;
  const catName = cats[catSlug].name;
  const subName = sub.name;

  // 🆕 Si vamos a OCULTAR, advertir si hay productos activos
  if (!willBeVisible) {
    const activeProducts = products.filter(p =>
      p.categoryGroup === catSlug &&
      p.category === subSlug &&
      p.active !== false
    );
    if (activeProducts.length > 0) {
      const stock = inventory
        .filter(i => activeProducts.some(p => p.id === i.productId))
        .reduce((sum, i) => sum + Number(i.stock || 0), 0);

      const msg =
        `🚫 Ocultar subcategoría "${subName}"\n\n` +
        `Dentro de: "${catName}"\n` +
        `Tiene ${activeProducts.length} producto(s) activo(s).\n` +
        (stock > 0 ? `📦 Stock actual: ${stock} unidad(es)\n\n` : '\n') +
        `Al ocultarla:\n` +
        `• Desaparecerá del filtro de subcategorías en el catálogo\n` +
        `• Los productos seguirán visibles en su categoría principal\n` +
        `• El inventario y los productos se conservan intactos\n` +
        `• Puedes volver a mostrarla cuando quieras\n\n` +
        `¿Continuar?`;

      if (!confirm(msg)) return;
    }
  }

  sub.seasonalActive = willBeVisible;

  // 🔒 Persistir inmediatamente
  await persistCategories(
    `${willBeVisible ? '👁 Subcategoría visible' : '🚫 Subcategoría oculta'}: ${subName}`
  );
};

/* ============================================================
   FORM: CREAR / EDITAR CATEGORÍA O SUBCATEGORÍA
   Modos:
   - openCategoryForm(null)                     → nueva categoría
   - openCategoryForm('slug')                   → editar categoría
   - openCategoryForm('catSlug', null, true)    → nueva subcategoría dentro de catSlug
   - openCategoryForm('catSlug', 'subSlug')     → editar subcategoría
============================================================ */
let _categoryFormMode = null;   // { type: 'category'|'subcategory', catSlug: string|null, subSlug: string|null, isNewSub: boolean }

window.openCategoryForm = (catSlug = null, subSlug = null, isNewSub = false) => {
  const cats = getCategoriesSource();

  let mode, title, subtitle, data;

  if (catSlug && subSlug) {
    // Editar subcategoría existente
    const cat = cats[catSlug];
    if (!cat) return alert('Categoría no encontrada');
    const sub = cat.subcategories?.[subSlug];
    if (!sub) return alert('Subcategoría no encontrada');

    mode = { type: 'subcategory', catSlug, subSlug, isNew: false };
    title = 'Editar subcategoría';
    subtitle = `En "${cat.name}"`;
    data = {
      name: sub.name || '',
      order: sub.order || 0,
      visible: sub.seasonalActive !== false
    };
  } else if (catSlug && isNewSub) {
    // Nueva subcategoría
    const cat = cats[catSlug];
    if (!cat) return alert('Categoría no encontrada');
    mode = { type: 'subcategory', catSlug, subSlug: null, isNew: true };
    title = 'Nueva subcategoría';
    subtitle = `En "${cat.name}"`;
    data = { name: '', order: 0, visible: true };
  } else if (catSlug) {
    // Editar categoría existente
    const cat = cats[catSlug];
    if (!cat) return alert('Categoría no encontrada');
    mode = { type: 'category', catSlug, subSlug: null, isNew: false };
    title = 'Editar categoría';
    subtitle = `Slug: ${catSlug}`;
    data = {
      name: cat.name || '',
      slug: catSlug,
      order: cat.order || 0,
      visible: cat.seasonalActive !== false
    };
  } else {
    // Nueva categoría
    mode = { type: 'category', catSlug: null, subSlug: null, isNew: true };
    title = 'Nueva categoría';
    subtitle = 'Podrás asignarle un nombre y luego agregar subcategorías.';
    data = { name: '', slug: '', order: 0, visible: true };
  }

  _categoryFormMode = mode;

  $('category-form-title').innerText = title;
  $('category-form-subtitle').innerText = subtitle;

  const isCat = mode.type === 'category';
  const isNew = mode.isNew;
  const showSlug = isCat;

  $('category-form-body').innerHTML = `
    <div class="space-y-4">

      <div>
        <label class="text-xs font-semibold text-sd">Nombre *</label>
        <input id="cf-name" type="text" value="${escapeHtml(data.name)}"
               placeholder="${isCat ? 'Ej: Ropa, Electrodomésticos…' : 'Ej: Camisetas, Neveras…'}"
               class="w-full px-3 py-2 border rounded-lg mt-1">
        <p class="text-[10px] text-gray-400 mt-1">Se mostrará en el catálogo público.</p>
      </div>

      ${showSlug ? `
      <div>
        <label class="text-xs font-semibold text-sd">Slug (URL interna)</label>
        <input id="cf-slug" type="text" value="${escapeHtml(data.slug)}"
               ${!isNew ? 'disabled' : ''}
               placeholder="ropa"
               class="w-full px-3 py-2 border rounded-lg mt-1 font-mono text-sm ${!isNew ? 'bg-gray-50 text-gray-500' : ''}">
        <p class="text-[10px] text-gray-400 mt-1">
          ${isNew
            ? 'Si lo dejas vacío, se genera automáticamente desde el nombre.'
            : '⚠️ El slug no se puede cambiar una vez creado (los productos lo usan).'}
        </p>
      </div>
      ` : ''}

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs font-semibold text-sd">Orden</label>
          <input id="cf-order" type="number" value="${data.order}"
                 class="w-full px-3 py-2 border rounded-lg mt-1">
          <p class="text-[10px] text-gray-400 mt-1">Menor número = aparece primero.</p>
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-2 text-sm">
            <input id="cf-visible" type="checkbox" ${data.visible ? 'checked' : ''} class="w-4 h-4">
            <span>Visible en el catálogo</span>
          </label>
        </div>
      </div>

      <div class="flex gap-3 pt-3 border-t">
        <button onclick="closeCategoryForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">
          Cancelar
        </button>
        <button onclick="saveCategoryForm()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">
          💾 Guardar
        </button>
      </div>

    </div>
  `;

  // Auto-generar slug al escribir el nombre (solo si es nueva categoría)
  if (showSlug && isNew) {
    const nameInput = $('cf-name');
    const slugInput = $('cf-slug');
    nameInput.addEventListener('input', () => {
      if (!slugInput.dataset.touched) {
        slugInput.value = slugify(nameInput.value);
      }
    });
    slugInput.addEventListener('input', () => {
      slugInput.dataset.touched = '1';
      slugInput.value = slugify(slugInput.value);
    });
  }

  const m = $('category-form-modal');
  if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
};

window.closeCategoryForm = () => {
  _categoryFormMode = null;
  const m = $('category-form-modal');
  if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
};

/* ============================================================
   GUARDAR (crear o editar) CATEGORÍA / SUBCATEGORÍA
============================================================ */
window.saveCategoryForm = async () => {
  if (!_categoryFormMode) return;
  const mode = _categoryFormMode;
  const cats = getCategoriesSource();

  const name = ($('cf-name').value || '').trim();
  const order = Number($('cf-order').value) || 0;
  const visible = $('cf-visible').checked;

  if (!name) return alert('⚠️ El nombre es obligatorio.');

  // ============================================================
  // GUARDAR SUBCATEGORÍA
  // ============================================================
  if (mode.type === 'subcategory') {
    const cat = cats[mode.catSlug];
    if (!cat) return alert('Categoría no encontrada.');
    if (!cat.subcategories) cat.subcategories = {};

    if (mode.isNew) {
      // Crear: generar slug único
      const baseSlug = slugify(name);
      const existingKeys = Object.keys(cat.subcategories);
      const slug = uniqueSlug(baseSlug, existingKeys);

      cat.subcategories[slug] = {
        name,
        order,
        seasonal: true,
        seasonalActive: visible
      };
    } else {
      // Editar: mantener slug y subcategorías
      const sub = cat.subcategories[mode.subSlug];
      if (!sub) return alert('Subcategoría no encontrada.');
      sub.name = name;
      sub.order = order;
      sub.seasonalActive = visible;
      sub.seasonal = true;
    }

    await persistCategories('Subcategoría guardada');
    return;
  }

  // ============================================================
  // GUARDAR CATEGORÍA
  // ============================================================
  if (mode.type === 'category') {
    if (mode.isNew) {
      // Crear nueva categoría
      let slugInput = ($('cf-slug').value || '').trim();
      let baseSlug = slugInput || slugify(name);
      if (!baseSlug) return alert('⚠️ No se pudo generar un slug válido. Revisa el nombre.');

      const existingKeys = Object.keys(cats);
      const slug = uniqueSlug(baseSlug, existingKeys);

      cats[slug] = {
        name,
        order,
        seasonal: true,
        seasonalActive: visible,
        subcategories: {}
      };
    } else {
      // Editar categoría existente (no se toca el slug)
      const cat = cats[mode.catSlug];
      if (!cat) return alert('Categoría no encontrada.');
      cat.name = name;
      cat.order = order;
      cat.seasonalActive = visible;
      cat.seasonal = true;
    }

    await persistCategories('Categoría guardada');
    return;
  }
};

/* ============================================================
   PERSISTIR EN FIRESTORE (todo el objeto settings.categories)
============================================================ */
async function persistCategories(successMsg) {
  const cats = getCategoriesSource();

  // Calcular cambios para auditoría
  const before = settings.categories || {};
  const after = JSON.parse(JSON.stringify(cats));

  const changedFields = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  allKeys.forEach(k => {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changedFields.push(k);
  });

  try {
    await updateDoc(doc(db, 'settings', 'general'), {
      categories: after,
      updatedAt: serverTimestamp()
    });

    // Actualizar estado local
    settings.categories = after;

    // Auditoría
    await audit({
      action: 'update',
      collection: 'settings',
      docId: 'general',
      before: { categories: before },
      after: { categories: after },
      note: `${successMsg || 'Categorías actualizadas'} · ${changedFields.length} cambio(s)`
    });

    // Invalidar cache de settings
    window.SmartecCache.invalidate('settings');

    // Cerrar el form y refrescar el gestor + el resumen
    closeCategoryForm();
    renderCategoriesList();
    renderCategoriesSummary();

  } catch (e) {
    console.error('Error guardando categorías:', e);
    alert('❌ Error al guardar: ' + e.message);
  }
}

/* ============================================================
   🆕 ELIMINACIÓN DE CATEGORÍAS / SUBCATEGORÍAS
   Reglas:
   - Si hay INVENTARIO (stock > 0) → bloquear, solo ocultar.
   - Si hay PRODUCTOS (sin stock) → permitir, con confirmación fuerte.
     Los productos se DESACTIVAN (no se borran).
   - Confirmación: escribir el nombre exacto.
============================================================ */

/**
 * Cuenta cuántos productos y cuánto stock tiene una categoría o subcategoría.
 */
function countCategoryImpact(catSlug, subSlug = null) {
  const prods = products.filter(p => {
    if (p.categoryGroup !== catSlug) return false;
    if (subSlug && p.category !== subSlug) return false;
    return true;
  });
  const productIds = new Set(prods.map(p => p.id));
  const stock = inventory
    .filter(i => productIds.has(i.productId))
    .reduce((sum, i) => sum + Number(i.stock || 0), 0);
  const activeProds = prods.filter(p => p.active !== false).length;
  return { products: prods, productCount: prods.length, activeProds, stock };
}

/* ============================================================
   CONFIRMAR ELIMINACIÓN DE CATEGORÍA
============================================================ */
window.confirmDeleteCategory = (catSlug) => {
  const cats = getCategoriesSource();
  const cat = cats[catSlug];
  if (!cat) return alert('Categoría no encontrada.');

  const impact = countCategoryImpact(catSlug);
  const subCount = Object.keys(cat.subcategories || {}).length;

  // ========== VALIDACIÓN 1: INVENTARIO ==========
  if (impact.stock > 0) {
    _showDeleteBlockedModal({
      title: 'No se puede eliminar',
      subtitle: `La categoría "${cat.name}" tiene productos con stock.`,
      reason: `Hay ${impact.stock} unidad(es) en inventario distribuidas en ${impact.productCount} producto(s).`,
      suggestion: 'Puedes OCULTARLA en lugar de eliminarla. Los productos no se verán en el catálogo, pero el inventario se conserva.'
    });
    return;
  }

  // ========== VALIDACIÓN 2: SIN INVENTARIO, CON PRODUCTOS ==========
  if (impact.productCount > 0) {
    _showDeleteConfirmModal({
      type: 'category',
      catSlug,
      subSlug: null,
      name: cat.name,
      productCount: impact.productCount,
      activeProds: impact.activeProds,
      subCount
    });
    return;
  }

  // ========== VALIDACIÓN 3: SIN PRODUCTOS → confirmación simple también por seguridad ==========
  _showDeleteConfirmModal({
    type: 'category',
    catSlug,
    subSlug: null,
    name: cat.name,
    productCount: 0,
    activeProds: 0,
    subCount
  });
};

/* ============================================================
   CONFIRMAR ELIMINACIÓN DE SUBCATEGORÍA
============================================================ */
window.confirmDeleteSubcategory = (catSlug, subSlug) => {
  const cats = getCategoriesSource();
  const cat = cats[catSlug];
  if (!cat) return alert('Categoría no encontrada.');
  const sub = cat.subcategories?.[subSlug];
  if (!sub) return alert('Subcategoría no encontrada.');

  const impact = countCategoryImpact(catSlug, subSlug);

  // ========== VALIDACIÓN 1: INVENTARIO ==========
  if (impact.stock > 0) {
    _showDeleteBlockedModal({
      title: 'No se puede eliminar',
      subtitle: `La subcategoría "${sub.name}" tiene productos con stock.`,
      reason: `Hay ${impact.stock} unidad(es) en inventario distribuidas en ${impact.productCount} producto(s).`,
      suggestion: 'Puedes OCULTARLA en lugar de eliminarla. Los productos no se verán en el catálogo, pero el inventario se conserva.'
    });
    return;
  }

  _showDeleteConfirmModal({
    type: 'subcategory',
    catSlug,
    subSlug,
    name: sub.name,
    productCount: impact.productCount,
    activeProds: impact.activeProds,
    subCount: 0
  });
};

/* ============================================================
   MODAL: BLOQUEADO POR INVENTARIO
============================================================ */
function _showDeleteBlockedModal({ title, subtitle, reason, suggestion }) {
  $('category-delete-title').innerText = '🚫 ' + title;
  $('category-delete-title').className = 'text-xl font-bold text-red-700';
  $('category-delete-subtitle').innerText = subtitle;

  $('category-delete-body').innerHTML = `
    <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
      <p class="text-sm text-red-800 font-semibold mb-2">¿Por qué está bloqueado?</p>
      <p class="text-xs text-red-700 leading-relaxed">${escapeHtml(reason)}</p>
    </div>

    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5">
      <p class="text-sm text-blue-800 font-semibold mb-2">💡 Sugerencia</p>
      <p class="text-xs text-blue-700 leading-relaxed">${escapeHtml(suggestion)}</p>
    </div>

    <button onclick="closeCategoryDeleteModal()" class="w-full bg-sd text-white py-3 rounded-lg hover:bg-sl font-semibold">
      Entendido
    </button>
  `;

  const m = $('category-delete-modal');
  if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
}

/* ============================================================
   MODAL: CONFIRMACIÓN FUERTE (escribir nombre)
============================================================ */
let _deleteConfirmContext = null;

function _showDeleteConfirmModal(ctx) {
  _deleteConfirmContext = ctx;

  const { type, name, productCount, activeProds, subCount } = ctx;

  $('category-delete-title').innerText = '⚠️ Eliminar ' + (type === 'category' ? 'categoría' : 'subcategoría');
  $('category-delete-title').className = 'text-xl font-bold text-red-700';
  $('category-delete-subtitle').innerText = `"${name}"`;

  const impactLines = [];
  if (productCount > 0) {
    impactLines.push(`<li>Se <b>desactivarán ${activeProds}</b> producto(s) activo(s) (${productCount} en total).</li>`);
    impactLines.push(`<li>Los productos <b>desaparecerán del catálogo público</b>.</li>`);
    impactLines.push(`<li>El inventario asociado se conserva en el sistema (por auditoría).</li>`);
  } else {
    impactLines.push(`<li>No hay productos asociados a esta ${type === 'category' ? 'categoría' : 'subcategoría'}.</li>`);
  }
  if (type === 'category' && subCount > 0) {
    impactLines.push(`<li>Se eliminarán también sus <b>${subCount} subcategoría(s)</b>.</li>`);
  }

  $('category-delete-body').innerHTML = `
    <div class="bg-red-50 border-2 border-red-300 rounded-lg p-4 mb-4">
      <p class="text-sm font-bold text-red-800 mb-2">🚨 Esta acción es DEFINITIVA</p>
      <ul class="text-xs text-red-700 leading-relaxed space-y-1 list-disc list-inside">
        ${impactLines.join('')}
      </ul>
    </div>

    <div class="mb-4">
      <label class="text-xs font-semibold text-gray-700 block mb-2">
        Escribe <b class="text-red-700">${escapeHtml(name)}</b> para confirmar:
      </label>
      <input id="category-delete-confirm-input" type="text" autocomplete="off"
             placeholder="${escapeHtml(name)}"
             class="w-full px-3 py-2 border-2 border-red-200 rounded-lg focus:border-red-500 focus:outline-none font-mono text-sm">
      <p id="category-delete-confirm-error" class="text-[10px] text-red-600 mt-1 hidden">
        El nombre no coincide. Escríbelo tal cual (respeta mayúsculas y espacios).
      </p>
    </div>

    <div class="flex gap-3">
      <button onclick="closeCategoryDeleteModal()" class="flex-1 bg-gray-100 text-sd py-3 rounded-lg hover:bg-gray-200 font-semibold">
        Cancelar
      </button>
      <button id="category-delete-confirm-btn" onclick="executeCategoryDelete()" disabled
              class="flex-1 bg-gray-300 text-white py-3 rounded-lg font-semibold cursor-not-allowed transition">
        🗑 Eliminar definitivamente
      </button>
    </div>
  `;

  // Listener del input de confirmación
  const input = $('category-delete-confirm-input');
  const btn = $('category-delete-confirm-btn');
  const err = $('category-delete-confirm-error');

  if (input && btn) {
    input.addEventListener('input', () => {
      const match = input.value === name;
      btn.disabled = !match;
      btn.className = match
        ? 'flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 font-semibold transition'
        : 'flex-1 bg-gray-300 text-white py-3 rounded-lg font-semibold cursor-not-allowed transition';
      err.classList.toggle('hidden', match || input.value.length === 0);
    });
    input.focus();
  }

  const m = $('category-delete-modal');
  if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
}

window.closeCategoryDeleteModal = () => {
  _deleteConfirmContext = null;
  const m = $('category-delete-modal');
  if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
};

/* ============================================================
   EJECUTAR ELIMINACIÓN (después de la confirmación fuerte)
============================================================ */
window.executeCategoryDelete = async () => {
  const ctx = _deleteConfirmContext;
  if (!ctx) return;

  const { type, catSlug, subSlug } = ctx;
  const cats = getCategoriesSource();

  try {
    // 1. Desactivar productos asociados (no borrar)
    const prodsToDeactivate = products.filter(p => {
      if (p.categoryGroup !== catSlug) return false;
      if (subSlug && p.category !== subSlug) return false;
      return true;
    });

    let deactivatedCount = 0;
    for (const p of prodsToDeactivate) {
      if (p.active === false) continue;   // ya estaba desactivado
      await updateDoc(doc(db, 'products', p.id), {
        active: false,
        deactivatedAt: serverTimestamp(),
        deactivatedBy: currentUser.email,
        deactivatedReason: `Categoría/subcategoría eliminada: ${ctx.name}`,
        updatedAt: serverTimestamp()
      });
      deactivatedCount++;
    }

    // 2. Eliminar del objeto categories
    if (type === 'category') {
      delete cats[catSlug];
    } else {
      if (cats[catSlug] && cats[catSlug].subcategories) {
        delete cats[catSlug].subcategories[subSlug];
      }
    }

    // 3. Persistir
    await persistCategories(
      `${type === 'category' ? 'Categoría' : 'Subcategoría'} "${ctx.name}" eliminada · ${deactivatedCount} producto(s) desactivado(s)`
    );

    // 4. Invalidar cache de productos
    window.SmartecCache.invalidate('products');

    // 5. Cerrar el modal de confirmación
    closeCategoryDeleteModal();

    // 6. Aviso final
    alert(
      `✅ Eliminado correctamente.\n\n` +
      (deactivatedCount > 0
        ? `${deactivatedCount} producto(s) fueron desactivados y ya no aparecen en el catálogo.`
        : `No había productos asociados.`)
    );

  } catch (e) {
    console.error('Error eliminando:', e);
    alert('❌ Error al eliminar: ' + e.message);
  }
};

/* ============================================================
   SELECTS GLOBALES
============================================================ */
/* ============================================================
   SELECTS GLOBALES
============================================================ */
function populateStoreSelects() {
  const opts = stores.map(s =>
    `<option value="${s.storeId}">${s.name}${!s.active?' (inactiva)':''}</option>`
  ).join('');

  // === Filtros de la pestaña Vendedores y Ventas ===
  ['sellers-store-filter','sales-store-filter'].forEach(id => {
    const sel = $(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="all">Todas las tiendas</option>${opts}`;
    sel.value = prev || 'all';
  });

  // === Filtros del Dashboard ===
  const dashFilter = $('dash-store-filter');
  if (dashFilter) {
    const prev = dashFilter.value;
    dashFilter.innerHTML = `<option value="all">Todas las tiendas</option>
                            <option value="active">Solo tiendas activas</option>
                            ${opts}`;
    dashFilter.value = prev || 'all';
  }

  const dashSellerFilter = $('dash-seller-filter');
  if (dashSellerFilter && !dashSellerFilter.dataset.loaded) {
    // El filtro de vendedores lo llena populateDashFilters, aquí solo aseguramos que exista
    dashSellerFilter.dataset.loaded = '1';
  }

  // === onchange handlers ===
  const sellersFilter = $('sellers-store-filter');
  if (sellersFilter) sellersFilter.onchange = renderSellers;

  const salesFilter = $('sales-store-filter');
  if (salesFilter) salesFilter.onchange = renderSales;

  const pmf = $('sales-payment-method-filter');
  if (pmf) pmf.onchange = renderSales;

  const psf = $('sales-payment-status-filter');
  if (psf) psf.onchange = renderSales;
}
/* ============================================================
   INVENTARIO POR PRODUCTO (modal Ver/Editar)
============================================================ */
let currentInvProduct = null;

window.viewInventory = (productId) => {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  currentInvProduct = p;

  $('inv-title').innerText = p.name;
  $('inv-subtitle').innerText = `SKU base: ${p.sku||'-'} · ${p.variants?.length||0} variante(s) · ${stores.length} tienda(s)`;

  const body = $('inv-body');
  body.innerHTML = '';

  // Por cada tienda
  stores.forEach(st => {
    const storeBlock = document.createElement('div');
    storeBlock.className = 'border rounded-lg mb-4 overflow-hidden';
    
        // Total real de esta tienda para este producto (con fallback por variantId)
    const storeTotal = (p.variants || []).reduce((sum, vr) => {
      const invId = `${st.storeId}_${vr.variantId}`;
      let inv = inventory.find(i => i.id === invId);
      if (!inv) inv = inventory.find(i => i._docId === invId);
      if (!inv) inv = inventory.find(i => i.storeId === st.storeId && i.variantId === vr.variantId);
      if (!inv) inv = inventory.find(i => i.storeId === st.storeId && i.sku === vr.sku);
      return sum + (inv ? Number(inv.stock||0) : 0);
    }, 0);

    storeBlock.innerHTML = `
      <div class="bg-gray-50 px-4 py-2 flex justify-between items-center border-b">
        <div>
          <p class="font-semibold text-sd text-sm">${st.name}</p>
          <p class="text-[10px] text-gray-400">${st.storeId}</p>
        </div>
        <span class="text-sm font-bold ${storeTotal<=5?'text-orange-500':'text-green-600'}">${storeTotal} und</span>
      </div>
      <div class="p-3 space-y-2" data-store="${st.storeId}"></div>
    `;

    const variantsContainer = storeBlock.querySelector(`[data-store="${st.storeId}"]`);

        // Por cada variante
    (p.variants||[]).forEach(vr => {
      const invId = `${st.storeId}_${vr.variantId}`;

      // Búsqueda robusta: por id, por _docId, por storeId+variantId, por storeId+sku
      let inv = inventory.find(i => i.id === invId);
      if (!inv) inv = inventory.find(i => i._docId === invId);
      if (!inv) inv = inventory.find(i => i.storeId === st.storeId && i.variantId === vr.variantId);
      if (!inv) inv = inventory.find(i => i.storeId === st.storeId && i.sku === vr.sku);

      const stock = inv ? Number(inv.stock||0) : 0;
      const minStock = inv ? Number(inv.minStock||5) : 5;

            const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-3 py-3 border-b last:border-0';
      row.innerHTML = `
        <div class="flex items-center gap-2 min-w-0 flex-1">
          ${vr.color ? `<span class="w-5 h-5 rounded-full border flex-shrink-0" style="background:${vr.color}"></span>` : ''}
          <div class="min-w-0 flex-1">
            <p class="text-xs font-medium text-sd truncate">
              ${displayColorName(vr)} ${vr.size?'· '+vr.size:''}
              ${!displayColorName(vr) && !vr.size ? '<span class="text-gray-400">Estándar</span>' : ''}
            </p>
            <p class="text-[10px] text-gray-400 font-mono truncate">${vr.sku}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <!-- Stock actual (solo lectura, destacado) -->
          <div class="text-right min-w-[80px]">
            <p class="text-[9px] text-gray-400 uppercase font-semibold leading-none">Stock actual</p>
            <p class="text-xl font-bold ${stock === 0 ? 'text-red-500' : (stock <= minStock ? 'text-orange-500' : 'text-green-600')} leading-tight">
              ${stock}
            </p>
          </div>

          <!-- Separador visual -->
          <div class="w-px h-8 bg-gray-200"></div>

          <!-- Controles de edición -->
          <div class="flex items-center gap-1">
            <button type="button" onclick="adjustInvInput(this, -1)" class="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm">−</button>
            <input 
              type="number" 
              min="0"
              value="0"
              data-inv-id="${invId}"
              data-store-id="${st.storeId}"
              data-variant-id="${vr.variantId}"
              data-product-id="${p.id}"
              data-product-name="${p.name}"
              data-sku="${vr.sku}"
              data-color="${vr.color||''}"
              data-color-name="${vr.colorName||''}"
              data-size="${vr.size||''}"
              class="inv-input w-16 px-2 py-1 border border-gray-300 rounded text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sl"
              placeholder="0"
            >
            <button type="button" onclick="adjustInvInput(this, 1)" class="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm">+</button>
          </div>
        </div>
      `;
      variantsContainer.appendChild(row);
    });

    body.appendChild(storeBlock);
  });

  const m = $('inv-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeInvModal = () => {
  const m = $('inv-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  currentInvProduct = null;
};

window.saveInventory = async () => {
  const inputs = document.querySelectorAll('.inv-input');
  if (!inputs.length) return;

  let cambios = 0;
  const cambiosDetalle = [];

  for (const input of inputs) {
    const invId = input.dataset.invId;
    const newStock = Math.max(0, Number(input.value)||0);
    const inv = inventory.find(i => i.id === invId);
    const oldStock = inv ? Number(inv.stock||0) : 0;

    if (newStock === oldStock) continue;

    const data = {
      storeId: input.dataset.storeId,
      productId: input.dataset.productId,
      productName: input.dataset.productName,
      variantId: input.dataset.variantId,
      sku: input.dataset.sku,
      color: input.dataset.color || null,
      colorName: input.dataset.colorName,
      size: input.dataset.size || null,
      stock: newStock,
      minStock: inv?.minStock || 5,
      serials: inv?.serials || [],
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db,'inventory',invId), data, { merge: true });

    // Registrar movimiento de inventario
    await addDoc(collection(db,'inventoryMovements'), {
      storeId: input.dataset.storeId,
      productId: input.dataset.productId,
      variantId: input.dataset.variantId,
      sku: input.dataset.sku,
      type: oldStock === 0 ? 'entrada' : (newStock > oldStock ? 'entrada' : 'ajuste'),
      qtyBefore: oldStock,
      qtyAfter: newStock,
      delta: newStock - oldStock,
      reason: 'Ajuste manual desde admin',
      userId: currentUser.uid,
      userEmail: currentUser.email,
      createdAt: serverTimestamp()
    });

    cambios++;
    cambiosDetalle.push(`${input.dataset.sku}: ${oldStock} → ${newStock}`);
  }

  if (cambios > 0) {
    await audit({
      action: 'update',
      collection: 'inventory',
      note: `Ajuste de stock: ${currentInvProduct?.name} (${cambios} variante(s))`,
      after: { cambios: cambiosDetalle }
    });
    alert(`✅ ${cambios} cambio(s) guardado(s)`);
  } else {
    alert('Sin cambios que guardar');
  }

  window.SmartecCache.invalidate('inventory');

  closeInvModal();
  await loadAll();
};

/* Cerrar con ESC */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('inv-modal').classList.contains('hidden')) closeInvModal();
});

/* ============================================================
   INVENTARIO — RENDER, FILTROS Y KPIs
============================================================ */

function populateInventoryFilters() {
  // Select tiendas
  const sel = $('inv-filter-store');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="all">Todas las tiendas</option>` +
    stores.map(s => `<option value="${s.storeId}">${s.name}${!s.active?' (inactiva)':''}</option>`).join('');
  sel.value = prev || 'all';

  // Select categorías
  const catSel = $('inv-filter-group');
  if (catSel) {
    const prevCat = catSel.value;
    const cats = settings.categories || {};
    catSel.innerHTML = `<option value="all">Todas</option>` +
      Object.entries(cats).map(([slug,g]) => `<option value="${slug}">${g.name}</option>`).join('');
    catSel.value = prevCat || 'all';
  }

  sel.onchange = renderInventory;
  catSel && (catSel.onchange = renderInventory);
  $('inv-filter-status') && ($('inv-filter-status').onchange = renderInventory);
  $('inv-filter-search') && ($('inv-filter-search').oninput = renderInventory);
}

function renderInventory() {
  // KPIs primero
  renderInventoryKPIs();

  // 🆕 Conectar filtros (solo una vez)
  populateInventoryFilters();

  const tb = $('inventory-tbody');
  const empty = $('inv-empty');
  if (!tb) return;

  const storeF = $('inv-filter-store')?.value || 'all';
  const groupF = $('inv-filter-group')?.value || 'all';
  const statusF = $('inv-filter-status')?.value || 'all';
  const searchF = ($('inv-filter-search')?.value || '').toLowerCase().trim();

  // Filtrar
  let list = inventory.slice();

  if (storeF !== 'all') list = list.filter(i => i.storeId === storeF);

  if (groupF !== 'all') {
    list = list.filter(i => {
      const p = products.find(x => x.id === i.productId);
      return p && p.categoryGroup === groupF;
    });
  }

  if (statusF !== 'all') {
    list = list.filter(i => {
      const stock = Number(i.stock||0);
      const min = Number(i.minStock||settings.minStock||5);
      if (statusF === 'zero') return stock === 0;
      if (statusF === 'low') return stock > 0 && stock <= min;
      if (statusF === 'available') return stock > min;
      return true;
    });
  }

  if (searchF) {
    list = list.filter(i =>
      (i.sku||'').toLowerCase().includes(searchF) ||
      (i.productName||'').toLowerCase().includes(searchF) ||
      (i.colorName||'').toLowerCase().includes(searchF) ||
      (i.size||'').toLowerCase().includes(searchF)
    );
  }

  // Ordenar: primero los agotados, luego stock bajo, luego alfabético
  list.sort((a,b) => {
    const sa = Number(a.stock||0), sb = Number(b.stock||0);
    const ma = Number(a.minStock||5), mb = Number(b.minStock||5);
    const prio = (s,m) => s === 0 ? 0 : s <= m ? 1 : 2;
    const pa = prio(sa,ma), pb = prio(sb,mb);
    if (pa !== pb) return pa - pb;
    return (a.productName||'').localeCompare(b.productName||'');
  });

  if (!list.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = list.map(i => {
    const p = products.find(x => x.id === i.productId) || {};
    const st = stores.find(s => s.storeId === i.storeId);
    const stock = Number(i.stock||0);
    const min = Number(i.minStock||settings.minStock||5);
    const isZero = stock === 0;
    const isLow = stock > 0 && stock <= min;

    const statusBadge = isZero
      ? '<span class="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">Agotado</span>'
      : isLow
        ? '<span class="text-[10px] px-2 py-0.5 rounded bg-orange-100 text-orange-700 font-semibold">Bajo</span>'
        : '<span class="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700">OK</span>';

    const variantLabel = [
      i.colorName || '',
      i.size || ''
    ].filter(Boolean).join(' · ') || 'Estándar';

    const colorDot = i.color
      ? `<span class="inline-block w-3 h-3 rounded-full border" style="background:${i.color}"></span>`
      : '';

    return `<tr class="border-b hover:bg-gray-50 ${isZero?'bg-red-50/40':isLow?'bg-orange-50/40':''}">
      <td class="p-3 font-medium text-sd text-xs">${escapeHtml(i.productName)||'-'}<br>
        <span class="text-[10px] text-gray-400">${escapeHtml(p.categoryName)||''}</span>
      </td>
      <td class="p-3 text-xs">
        <div class="flex items-center gap-2">
          ${colorDot}
          <span>${variantLabel}</span>
        </div>
      </td>
      <td class="p-3 text-xs font-mono text-gray-500">${escapeHtml(i.sku)||'-'}</td>
      <td class="p-3 text-xs">${escapeHtml(st?.name)||i.storeId}</td>
      <td class="p-3 text-right text-xs">${fmt(p.cost)}</td>
      <td class="p-3 text-right text-xs font-semibold">${fmt(p.onSale&&p.salePrice?p.salePrice:p.price)}</td>
      <td class="p-3 text-center font-bold ${isZero?'text-red-600':isLow?'text-orange-500':'text-sd'}">${stock}</td>
      <td class="p-3 text-center text-xs text-gray-400">${min}</td>
      <td class="p-3 text-center">${statusBadge}</td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewMovementHistory("${i.storeId}","${i.productId}","${i.variantId}")' class="text-sl hover:underline text-xs" title="Ver historial">📜</button>
      </td>
    </tr>`;
  }).join('');
}

function renderInventoryKPIs() {
  const storeF = $('inv-filter-store')?.value || 'all';

  let invFiltered = inventory.slice();
  if (storeF !== 'all') invFiltered = invFiltered.filter(i => i.storeId === storeF);
  else if (currentUserData.role === 'admin') invFiltered = invFiltered.filter(i => i.storeId === currentUserData.storeId);

  let invCost = 0, invPrice = 0, units = 0, alerts = 0;
  invFiltered.forEach(i => {
    const p = products.find(x => x.id === i.productId);
    if (!p) return;
    const cost = Number(p.cost || 0);
    const price = (p.onSale && p.salePrice) ? Number(p.salePrice) : Number(p.price || 0);
    const st = Number(i.stock || 0);
    const min = Number(i.minStock || settings.minStock || 5);
    invCost += cost * st;
    invPrice += price * st;
    units += st;
    if (st <= min) alerts++;
  });

  $('inv-kpi-cost').innerText = fmt(invCost);
  $('inv-kpi-price').innerText = fmt(invPrice);
  $('inv-kpi-units').innerText = units.toLocaleString('es-CO');
  $('inv-kpi-alerts').innerText = alerts;
}

/* ============================================================
   MOVIMIENTOS DE INVENTARIO (entrada / salida / traslado / ajuste)
============================================================ */
let currentMovementType = null;

window.openMovementForm = (type) => {
  currentMovementType = type;
  const titles = {
    entrada: '➕ Registrar entrada',
    salida: '➖ Registrar salida',
    traslado: '🔄 Registrar traslado',
    ajuste: '⚙️ Ajuste de inventario'
  };
  const subtitles = {
    entrada: 'Suma unidades al stock (compra a proveedor, devolución de cliente, etc.)',
    salida: 'Resta unidades del stock (daño, pérdida, uso interno, garantía, etc.)',
    traslado: 'Mueve unidades de una tienda a otra',
    ajuste: 'Corrige el stock al valor real después de un conteo físico'
  };

  $('mov-title').innerText = titles[type];
  $('mov-subtitle').innerText = subtitles[type];

  // Filtrar tiendas activas
  const activeStores = stores.filter(s => s.active);
  const storeOpts = activeStores.map(s => `<option value="${s.storeId}">${s.name}</option>`).join('');

  // Productos con variantes
  const productOpts = products
    .filter(p => p.active !== false && p.variants && p.variants.length)
    .map(p => `<option value="${p.id}">${p.name}</option>`)
    .join('');

  const isTraslado = type === 'traslado';

  $('mov-body').innerHTML = `
    <div class="space-y-4">
      <div>
        <label class="text-xs font-semibold text-sd">${isTraslado ? 'Tienda origen' : 'Tienda'}</label>
        <select id="mov-store" class="w-full px-3 py-2 border rounded-lg mt-1">
          ${storeOpts}
        </select>
      </div>
      ${isTraslado ? `
      <div>
        <label class="text-xs font-semibold text-sd">Tienda destino</label>
        <select id="mov-store-dest" class="w-full px-3 py-2 border rounded-lg mt-1">
          ${storeOpts}
        </select>
      </div>` : ''}
      <div>
        <label class="text-xs font-semibold text-sd">Producto</label>
        <select id="mov-product" class="w-full px-3 py-2 border rounded-lg mt-1">
          <option value="">— Selecciona un producto —</option>
          ${productOpts}
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Variante</label>
        <select id="mov-variant" class="w-full px-3 py-2 border rounded-lg mt-1" disabled>
          <option value="">— Primero elige producto —</option>
        </select>
      </div>
      <div class="bg-gray-50 rounded-lg p-3 text-xs">
        <p>Stock actual en tienda: <span id="mov-current-stock" class="font-bold text-sd">—</span></p>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">
          ${type === 'ajuste' ? 'Stock real (después del conteo)' : 'Cantidad'}
        </label>
        <input id="mov-qty" type="number" min="0" value="" class="w-full px-3 py-2 border rounded-lg mt-1 text-lg font-semibold">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Motivo / notas</label>
        <textarea id="mov-reason" rows="2" placeholder="${type==='entrada'?'Ej: Compra a proveedor Samsung':'Ej: Producto dañado en bodega'}" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm"></textarea>
      </div>
      <button onclick="saveMovement()" class="w-full bg-sd text-white py-3 rounded-lg hover:bg-sl font-bold">
        Guardar movimiento
      </button>
    </div>
  `;

  // Listeners
  $('mov-product').onchange = onMovementProductChange;
  $('mov-store').onchange = updateCurrentStockDisplay;
  if (isTraslado) $('mov-store-dest').onchange = updateCurrentStockDisplay;

  const m = $('mov-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeMovModal = () => {
  const m = $('mov-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  currentMovementType = null;
};

function onMovementProductChange() {
  const pid = $('mov-product').value;
  const varSel = $('mov-variant');
  if (!pid) {
    varSel.innerHTML = '<option value="">— Primero elige producto —</option>';
    varSel.disabled = true;
    updateCurrentStockDisplay();
    return;
  }
  const p = products.find(x => x.id === pid);
  varSel.disabled = false;
  varSel.innerHTML = (p.variants||[]).map(v => {
    const label = [v.colorName, v.size].filter(Boolean).join(' · ') || 'Estándar';
    return `<option value="${v.variantId}">${label} · ${v.sku}</option>`;
  }).join('');
  varSel.onchange = updateCurrentStockDisplay;
  updateCurrentStockDisplay();
}

function updateCurrentStockDisplay() {
  const pid = $('mov-product')?.value;
  const vid = $('mov-variant')?.value;
  const storeId = $('mov-store')?.value;
  const el = $('mov-current-stock');
  if (!el) return;
  if (!pid || !vid || !storeId) { el.innerText = '—'; return; }

  // Búsqueda robusta: por id, o por (storeId + variantId), o por (storeId + sku)
  const invId = `${storeId}_${vid}`;
  let inv = inventory.find(i => i.id === invId);
  if (!inv) {
    inv = inventory.find(i => i.storeId === storeId && i.variantId === vid);
  }
  if (!inv) {
    // Buscar por SKU como último recurso
    const product = products.find(p => p.id === pid);
    const variant = (product?.variants||[]).find(v => v.variantId === vid);
    if (variant) {
      inv = inventory.find(i => i.storeId === storeId && i.sku === variant.sku);
    }
  }

  const stock = inv ? Number(inv.stock||0) : 0;
  el.innerText = `${stock} unidades`;
  el.classList.toggle('text-red-500', stock === 0);
  el.classList.toggle('text-sd', stock > 0);
}

window.saveMovement = async () => {
  const type = currentMovementType;
  const storeId = $('mov-store').value;
  const pid = $('mov-product').value;
  const vid = $('mov-variant').value;
  const qtyRaw = Number($('mov-qty').value);
  const reason = $('mov-reason').value.trim();

  if (!storeId) return alert('Selecciona una tienda');
  if (!pid) return alert('Selecciona un producto');
  if (!vid) return alert('Selecciona una variante');
  if (!qtyRaw || qtyRaw <= 0) return alert('La cantidad debe ser mayor a 0');
  if (!reason) return alert('El motivo es obligatorio');

  const product = products.find(x => x.id === pid);
  const variant = (product.variants||[]).find(v => v.variantId === vid);
  const invId = `${storeId}_${vid}`;
  const invSnap = await getDoc(doc(db,'inventory',invId));
  const inv = invSnap.exists() ? { id: invId, ...invSnap.data() } : null;
  const stockBefore = inv ? Number(inv.stock||0) : 0;

  let stockAfter = stockBefore;
  let type2 = type; // por si ajustamos entrada/salida a ajuste
  let destStoreId = null;

  if (type === 'entrada') {
    stockAfter = stockBefore + qtyRaw;
  } else if (type === 'salida') {
    if (qtyRaw > stockBefore) {
      if (!confirm(`⚠️ Vas a sacar ${qtyRaw} und pero solo hay ${stockBefore}. ¿Continuar?`)) return;
    }
    stockAfter = Math.max(0, stockBefore - qtyRaw);
  } else if (type === 'ajuste') {
    stockAfter = qtyRaw;
  } else if (type === 'traslado') {
  destStoreId = $('mov-store-dest').value;
  if (!destStoreId) return alert('Selecciona la tienda destino');
  if (destStoreId === storeId) return alert('La tienda destino debe ser diferente a la origen');
  if (qtyRaw > stockBefore) return alert(`No hay suficiente stock. Disponible en origen: ${stockBefore}`);

  // Ver stock actual en destino
  const destInvIdPreview = `${destStoreId}_${vid}`;
  const destInvPreview = inventory.find(i => i.id === destInvIdPreview);
  const destStockBefore = destInvPreview ? Number(destInvPreview.stock||0) : 0;
  const originStore = stores.find(s => s.storeId === storeId);
  const destStore = stores.find(s => s.storeId === destStoreId);

  const confirmMsg =
    `Confirmar traslado:\n\n` +
    `📦 Producto: ${product.name}\n` +
    `🎨 Variante: ${[variant.colorName, variant.size].filter(Boolean).join(' · ') || 'Estándar'}\n\n` +
    `Origen — ${originStore?.name}:\n` +
    `   ${stockBefore} → ${stockBefore - qtyRaw} (−${qtyRaw})\n\n` +
    `Destino — ${destStore?.name}:\n` +
    `   ${destStockBefore} → ${destStockBefore + qtyRaw} (+${qtyRaw})\n\n` +
    `¿Confirmar traslado de ${qtyRaw} unidad(es)?`;

  if (!confirm(confirmMsg)) return;

  stockAfter = stockBefore - qtyRaw;
}

  // Guardar inventario origen (o único)
  const baseInvData = {
    storeId,
    productId: pid,
    variantId: vid,
    productName: product.name,
    sku: variant.sku,
    color: variant.color || null,
    colorName: variant.colorName || '',
    size: variant.size || null,
    minStock: inv?.minStock || settings.minStock || 5,
    serials: inv?.serials || [],
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db,'inventory',invId), { ...baseInvData, stock: stockAfter }, { merge: true });

  // Si es traslado, actualizar tienda destino
  if (type === 'traslado') {
    const destInvId = `${destStoreId}_${vid}`;
    const destSnap = await getDoc(doc(db,'inventory',destInvId));
    const destBefore = destSnap.exists() ? Number(destSnap.data().stock||0) : 0;
    const destAfter = destBefore + qtyRaw;

    await setDoc(doc(db,'inventory',destInvId), {
      ...baseInvData,
      storeId: destStoreId,
      stock: destAfter
    }, { merge: true });

    // Movimiento: salida origen
    await addDoc(collection(db,'inventoryMovements'), {
      storeId,
      productId: pid,
      variantId: vid,
      sku: variant.sku,
      productName: product.name,
      type: 'traslado-salida',
      qtyBefore: stockBefore,
      qtyAfter: stockAfter,
      delta: -qtyRaw,
      destinationStoreId: destStoreId,
      reason,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      createdAt: serverTimestamp()
    });

    // Movimiento: entrada destino
    await addDoc(collection(db,'inventoryMovements'), {
      storeId: destStoreId,
      productId: pid,
      variantId: vid,
      sku: variant.sku,
      productName: product.name,
      type: 'traslado-entrada',
      qtyBefore: destBefore,
      qtyAfter: destAfter,
      delta: qtyRaw,
      originStoreId: storeId,
      reason,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      createdAt: serverTimestamp()
    });
  } else {
    // Movimiento simple (entrada, salida, ajuste)
    await addDoc(collection(db,'inventoryMovements'), {
      storeId,
      productId: pid,
      variantId: vid,
      sku: variant.sku,
      productName: product.name,
      type,
      qtyBefore: stockBefore,
      qtyAfter: stockAfter,
      delta: stockAfter - stockBefore,
      reason,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      createdAt: serverTimestamp()
    });
  }

  // Auditoría
  const typeLabels = { entrada:'Entrada', salida:'Salida', traslado:'Traslado', ajuste:'Ajuste' };
  await audit({
    action: 'update',
    collection: 'inventory',
    docId: invId,
    before: { stock: stockBefore },
    after: { stock: stockAfter },
    note: `${typeLabels[type]}: ${product.name} · ${variant.colorName||''} ${variant.size||''} · ${stockBefore} → ${stockAfter}${destStoreId?' (destino: '+destStoreId+')':''} · ${reason}`
  });

  window.SmartecCache.invalidate('inventory');

  closeMovModal();
  await loadAll();
  alert('✅ Movimiento registrado');
};

/* ============================================================
   HISTORIAL DE MOVIMIENTOS
============================================================ */
window.viewMovementHistory = async (storeId, productId, variantId) => {
  const p = products.find(x => x.id === productId);
  const st = stores.find(s => s.storeId === storeId);
  const v = (p?.variants||[]).find(x => x.variantId === variantId);

  $('hist-title').innerText = 'Historial de movimientos';
  $('hist-subtitle').innerText = `${p?.name||''} · ${[v?.colorName, v?.size].filter(Boolean).join(' · ')||'Estándar'} · ${st?.name||storeId}`;

  $('hist-body').innerHTML = '<p class="text-center text-gray-400 py-6">Cargando…</p>';
  const m = $('hist-modal');
  m.classList.remove('hidden'); m.classList.add('flex');

  try {
    const q = query(
      collection(db,'inventoryMovements'),
      where('storeId','==',storeId),
      where('variantId','==',variantId)
    );
    const snap = await getDocs(q);
    const movs = snap.docs.map(d => ({id:d.id, ...d.data()}));
    movs.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

    if (!movs.length) {
      $('hist-body').innerHTML = '<p class="text-center text-gray-400 py-6">Sin movimientos registrados.</p>';
      return;
    }

    const typeColors = {
      'entrada':'bg-green-100 text-green-700',
      'salida':'bg-red-100 text-red-700',
      'ajuste':'bg-gray-200 text-gray-700',
      'traslado-salida':'bg-orange-100 text-orange-700',
      'traslado-entrada':'bg-blue-100 text-blue-700'
    };
    const typeLabels = {
      'entrada':'Entrada',
      'salida':'Salida',
      'ajuste':'Ajuste',
      'traslado-salida':'Traslado (sale)',
      'traslado-entrada':'Traslado (entra)'
    };

    $('hist-body').innerHTML = `
      <div class="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
        ${movs.map(mv => `
          <div class="border rounded-lg p-3 text-sm">
            <div class="flex justify-between items-start gap-2 mb-1">
              <span class="text-[10px] px-2 py-0.5 rounded ${typeColors[mv.type]||'bg-gray-100 text-gray-700'} font-semibold">
                ${typeLabels[mv.type]||mv.type}
              </span>
              <span class="text-[10px] text-gray-400">${fmtDate(mv.createdAt)}</span>
            </div>
            <div class="flex justify-between items-center">
              <div class="text-xs">
                <span class="text-gray-500">${mv.qtyBefore}</span>
                <span class="mx-1 text-gray-400">→</span>
                <span class="font-bold text-sd">${mv.qtyAfter}</span>
                <span class="ml-2 ${mv.delta>0?'text-green-600':'text-red-500'} font-semibold">
                  (${mv.delta>0?'+':''}${mv.delta})
                </span>
              </div>
            </div>
            ${mv.reason?`<p class="text-xs text-gray-500 mt-1 italic">"${mv.reason}"</p>`:''}
            <p class="text-[10px] text-gray-400 mt-1">por ${mv.userEmail||'—'}</p>
          </div>
        `).join('')}
      </div>
    `;
  } catch(e) {
    console.error(e);
    $('hist-body').innerHTML = '<p class="text-red-500 text-center py-6">Error cargando historial</p>';
  }
};

window.closeHistModal = () => {
  const m = $('hist-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

/* Cerrar con ESC */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('mov-modal').classList.contains('hidden')) return closeMovModal();
    if (!$('hist-modal').classList.contains('hidden')) return closeHistModal();
  }
});
/* ============================================================
   ARQUEOS DE CAJA
============================================================ */
function populateArqueoFilters() {
  const sel = $('arq-store-filter');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="all">Todas las tiendas</option>` +
    stores.map(s => `<option value="${s.storeId}">${s.name}</option>`).join('');
  sel.value = prev || 'all';
  sel.onchange = renderCashRegisters;
  $('arq-status-filter').onchange = renderCashRegisters;
}

function renderCashRegisters() {
  const tb = $('arqueos-tbody');
  const empty = $('arq-empty');
  if (!tb) return;

  const storeF = $('arq-store-filter')?.value || 'all';
  const statusF = $('arq-status-filter')?.value || 'all';

  // KPIs
  const kpiBase = cashRegisters;
  $('arq-kpi-total').innerText = kpiBase.length;
  $('arq-kpi-pending').innerText = kpiBase.filter(a => a.status === 'pending_approval').length;
  $('arq-kpi-approved').innerText = kpiBase.filter(a => a.status === 'approved').length;
  $('arq-kpi-rejected').innerText = kpiBase.filter(a => a.status === 'rejected').length;

  // Filtrar
  let list = cashRegisters.slice();
  if (storeF !== 'all') list = list.filter(a => a.storeId === storeF);
  if (statusF !== 'all') list = list.filter(a => a.status === statusF);

  list.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

  if (!list.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = list.slice(0, 200).map(a => {
    const store = stores.find(s => s.storeId === a.storeId);
    const diff = Number(a.difference || 0);
    const diffClass = diff === 0 ? 'text-gray-500' : (diff > 0 ? 'text-green-600' : 'text-red-500');
    const statusClass =
      a.status === 'approved' ? 'bg-green-100 text-green-700' :
      a.status === 'rejected' ? 'bg-red-100 text-red-700' :
      'bg-yellow-100 text-yellow-700';
    const statusLabel =
      a.status === 'approved' ? 'Aprobado' :
      a.status === 'rejected' ? 'Rechazado' : 'Pendiente';

    const typeLabel = a.type === 'apertura' ? '🌅 Apertura' : '🌇 Cierre';

    return `<tr class="border-b hover:bg-gray-50 ${a.status === 'pending_approval' ? 'bg-yellow-50/40' : ''}">
      <td class="p-3 text-xs text-gray-500">${fmtDate(a.createdAt)}</td>
      <td class="p-3 text-xs">${store?.name || a.storeId}</td>
      <td class="p-3 text-xs">${typeLabel}</td>
      <td class="p-3 text-xs">${a.adminEmail || '-'}</td>
      <td class="p-3 text-right text-xs">${fmt(a.expectedBase)}</td>
      <td class="p-3 text-right text-xs font-semibold">${fmt(a.actualAmount)}</td>
      <td class="p-3 text-right text-xs font-bold ${diffClass}">${diff > 0 ? '+' : ''}${fmt(diff)}</td>
      <td class="p-3 text-center"><span class="text-xs px-2 py-0.5 rounded ${statusClass}">${statusLabel}</span></td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewArqueo("${a.id}")' class="text-sl hover:underline text-xs">Ver</button>
      </td>
    </tr>`;
  }).join('');
}

window.viewArqueo = (id) => {
  const a = cashRegisters.find(x => x.id === id);
  if (!a) return;
  const store = stores.find(s => s.storeId === a.storeId);
  const diff = Number(a.difference || 0);
  const diffClass = diff === 0 ? 'text-gray-500' : (diff > 0 ? 'text-green-600' : 'text-red-500');

  $('arq-modal-title').innerText = `${a.type === 'apertura' ? '🌅 Apertura' : '🌇 Cierre'} de caja`;
  $('arq-modal-subtitle').innerText = `${store?.name || a.storeId} · ${fmtDate(a.createdAt)}`;

  const statusBadge =
    a.status === 'approved' ? '<span class="px-3 py-1 rounded-full text-xs bg-green-100 text-green-700 font-semibold">✅ Aprobado</span>' :
    a.status === 'rejected' ? '<span class="px-3 py-1 rounded-full text-xs bg-red-100 text-red-700 font-semibold">⛔ Rechazado</span>' :
    '<span class="px-3 py-1 rounded-full text-xs bg-yellow-100 text-yellow-700 font-semibold">⏳ Pendiente de aprobación</span>';

  let bodyHtml = `
    <div class="flex justify-end mb-4">${statusBadge}</div>
    <div class="grid grid-cols-2 gap-3 text-sm mb-5">
      <div><p class="text-xs text-gray-400">Tienda</p><p class="font-semibold">${store?.name || a.storeId}</p></div>
      <div><p class="text-xs text-gray-400">Admin</p><p class="font-semibold text-xs">${a.adminEmail || '-'}</p></div>
      <div><p class="text-xs text-gray-400">Base esperada</p><p class="font-semibold">${fmt(a.expectedBase)}</p></div>
      <div><p class="text-xs text-gray-400">Monto ingresado</p><p class="font-semibold">${fmt(a.actualAmount)}</p></div>
      <div><p class="text-xs text-gray-400">Diferencia</p><p class="font-bold ${diffClass}">${diff > 0 ? '+' : ''}${fmt(diff)}</p></div>
      <div><p class="text-xs text-gray-400">Margen permitido</p><p class="font-semibold">${fmt(a.arqueoMargin || 0)}</p></div>
    </div>
    ${a.notes ? `
      <div class="bg-gray-50 rounded-lg p-3 mb-4">
        <p class="text-xs text-gray-400 mb-1">Observaciones del admin:</p>
        <p class="text-sm">${a.notes}</p>
      </div>
    ` : ''}
    ${a.reviewNotes ? `
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
        <p class="text-xs text-blue-700 font-semibold mb-1">Nota de revisión:</p>
        <p class="text-sm">${a.reviewNotes}</p>
        <p class="text-[10px] text-gray-500 mt-1">Revisado por: ${a.reviewedBy || '-'} · ${fmtDate(a.reviewedAt)}</p>
      </div>
    ` : ''}
  `;

  // Botones de acción si está pendiente
  if (a.status === 'pending_approval' && currentUserData.role === 'superadmin') {
    bodyHtml += `
      <div class="border-t pt-4 mt-4">
        <p class="text-xs font-semibold text-sd mb-2">Acciones del superadmin:</p>
        <textarea id="arq-review-notes" rows="2" placeholder="Nota (obligatoria para rechazar, opcional para aprobar)" class="w-full px-3 py-2 border rounded-lg text-sm mb-3"></textarea>
        <div class="grid grid-cols-2 gap-3">
          <button onclick="approveArqueo('${a.id}')" class="bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 font-semibold text-sm">
            ✅ Aprobar
          </button>
          <button onclick="rejectArqueo('${a.id}')" class="bg-red-500 text-white py-2 rounded-lg hover:bg-red-600 font-semibold text-sm">
            ⛔ Rechazar
          </button>
        </div>
      </div>
    `;
  } else if (a.status !== 'pending_approval') {
    bodyHtml += `
      <div class="border-t pt-4 mt-4 text-xs text-gray-500">
        <p>Revisado por: <b>${a.reviewedBy || '-'}</b></p>
        <p>Fecha de revisión: ${fmtDate(a.reviewedAt)}</p>
      </div>
    `;
  }

  $('arq-modal-body').innerHTML = bodyHtml;
  const m = $('arq-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeArqModal = () => {
  const m = $('arq-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

window.approveArqueo = async (id) => {
  const a = cashRegisters.find(x => x.id === id);
  if (!a) return;
  const notes = ($('arq-review-notes')?.value || '').trim();

  if (!confirm(`¿Aprobar el ${a.type} de ${fmt(a.actualAmount)}?`)) return;

  try {
    await updateDoc(doc(db,'cashRegisters',id), {
      status: 'approved',
      reviewNotes: notes || 'Aprobado sin observaciones',
      reviewedBy: currentUser.email,
      reviewedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'cashRegisters',
      docId: id,
      before: { status: a.status },
      after: { status: 'approved', reviewNotes: notes },
      note: `Arqueo aprobado (${a.type}) - ${a.storeId} · ${fmt(a.actualAmount)}`
    });

    window.SmartecCache.invalidate('cashRegisters');

    closeArqModal();
    await loadAll();
    alert('✅ Arqueo aprobado');
  } catch(e) {
    console.error(e);
    alert('Error: ' + e.message);
  }
};

window.rejectArqueo = async (id) => {
  const a = cashRegisters.find(x => x.id === id);
  if (!a) return;
  const notes = ($('arq-review-notes')?.value || '').trim();

  if (!notes) {
    alert('⚠️ Debes escribir el motivo del rechazo');
    return;
  }

  if (!confirm(`¿Rechazar el ${a.type} de ${fmt(a.actualAmount)}?`)) return;

  try {
    await updateDoc(doc(db,'cashRegisters',id), {
      status: 'rejected',
      reviewNotes: notes,
      reviewedBy: currentUser.email,
      reviewedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'cashRegisters',
      docId: id,
      before: { status: a.status },
      after: { status: 'rejected', reviewNotes: notes },
      note: `Arqueo rechazado (${a.type}) - ${a.storeId}: ${notes}`
    });

    window.SmartecCache.invalidate('cashRegisters');

    closeArqModal();
    await loadAll();
    alert('⛔ Arqueo rechazado');
  } catch(e) {
    console.error(e);
    alert('Error: ' + e.message);
  }
};

/* ESC cierra modal */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('arq-modal').classList.contains('hidden')) closeArqModal();
});

/* ============================================================
   ESPECIFICACIONES Y FAQ (dinámicos)
============================================================ */
window.addSpecRow = (spec = {}) => {
  const c = $('specs-container');
  const div = document.createElement('div');
  div.className = 'spec-row grid grid-cols-12 gap-2 items-center bg-gray-50 p-2 rounded';
  div.innerHTML = `
    <input class="spec-key col-span-5 px-2 py-1 border rounded text-xs" placeholder="Ej: Marca" value="${spec.key || ''}">
    <input class="spec-value col-span-6 px-2 py-1 border rounded text-xs" placeholder="Ej: Samsung" value="${spec.value || ''}">
    <button type="button" onclick="this.parentElement.remove()" class="col-span-1 text-red-500 hover:text-red-700 text-center">✕</button>
  `;
  c.appendChild(div);
};

window.addFaqRow = (faq = {}) => {
  const c = $('faqs-container');
  const div = document.createElement('div');
  div.className = 'faq-row bg-gray-50 p-2 rounded space-y-1';
  div.innerHTML = `
    <div class="flex gap-2 items-start">
      <input class="faq-q flex-1 px-2 py-1 border rounded text-xs" placeholder="¿Pregunta?" value="${faq.question || ''}">
      <button type="button" onclick="this.closest('.faq-row').remove()" class="text-red-500 hover:text-red-700 text-center pt-1">✕</button>
    </div>
    <textarea class="faq-a w-full px-2 py-1 border rounded text-xs" rows="2" placeholder="Respuesta">${faq.answer || ''}</textarea>
  `;
  c.appendChild(div);
};

/* ============================================================
   REPORTES CONSOLIDADOS
============================================================ */
let reportFilters = {
  dateFrom: null,
  dateTo: null,
  storeId: 'all',
  sellerUid: 'all',
  category: 'all',
  brand: 'all',
  paymentMethod: 'all',       // 🆕
  paymentChannelId: 'all',    // 🆕
  paymentStatus: 'all'        // 🆕
};

/* Lista completa de reportes con sus valores por defecto */
const REPORT_DEFAULTS = {
  comparison: true,
  byStore: true,
  topSellers: true,
  topProducts: true,
  byMethod: true,
  pending: true,
  reconciliation: true,
  byCategory: true,
  chartSales: true,
  chartTopSellers: true,
  topCustomers: true,
  profitability: true,
  taxes: true,
  detail: true
};

/* Se carga desde localStorage o se usan los defaults */
let reportVisibility = (() => {
  try {
    const saved = localStorage.getItem('smartec_report_visibility');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge: si hay nuevos reportes que no estaban guardados, los activamos por defecto
      return { ...REPORT_DEFAULTS, ...parsed };
    }
  } catch (e) {}
  return { ...REPORT_DEFAULTS };
})();

/* Guarda el estado actual en localStorage */
function saveReportVisibility() {
  try {
    localStorage.setItem('smartec_report_visibility', JSON.stringify(reportVisibility));
  } catch (e) {}
}

let charts = {
  sales: null, category: null, payment: null, topsellers: null
};

let salesChartGroupBy = 'day';   // 🆕 modo de agrupación del gráfico de ventas

/* ============ TOGGLE DEL PANEL ============ */
window.toggleReportCustomizer = () => {
  $('report-customizer').classList.toggle('hidden');
};

window.selectAllReports = (value) => {
  document.querySelectorAll('.report-toggle').forEach(cb => { cb.checked = value; });
  Object.keys(reportVisibility).forEach(k => { reportVisibility[k] = value; });
  applyReportVisibility();
};

window.resetReportsDefault = () => {
  reportVisibility = { ...REPORT_DEFAULTS };
  document.querySelectorAll('.report-toggle').forEach(cb => {
    cb.checked = reportVisibility[cb.dataset.report] !== false;
  });
  applyReportVisibility();
};

function applyReportVisibility() {
  document.querySelectorAll('.report-toggle').forEach(cb => {
    reportVisibility[cb.dataset.report] = cb.checked;
  });

  // Guardar en localStorage
  saveReportVisibility();

  // Ocultar/mostrar bloques
  Object.entries(reportVisibility).forEach(([key, visible]) => {
    const el = $(`report-block-${key}`);
    if (el) el.classList.toggle('hidden', !visible);
  });

  // Redibujar los gráficos ahora visibles
  setTimeout(() => { renderCharts(getFilteredSales()); }, 50);
}

/* ============ INICIALIZACIÓN ============ */
function populateReportFilters() {
    // 🔄 Restaurar el estado de los checkboxes guardado en localStorage
  document.querySelectorAll('.report-toggle').forEach(cb => {
    const key = cb.dataset.report;
    if (reportVisibility[key] !== undefined) {
      cb.checked = reportVisibility[key];
    }
  });
  // Aplicar visibilidad a los bloques según el estado guardado
  Object.entries(reportVisibility).forEach(([key, visible]) => {
    const el = document.getElementById(`report-block-${key}`);
    if (el) el.classList.toggle('hidden', !visible);
  });
  const storeSel = $('rep-store');
  if (storeSel) {
    const prev = storeSel.value;
    storeSel.innerHTML = '<option value="all">Todas</option>' +
      stores.map(s => `<option value="${s.storeId}">${s.name}</option>`).join('');
    storeSel.value = prev || 'all';
    storeSel.onchange = renderReports;
  }

  const sellerSel = $('rep-seller');
  if (sellerSel) {
    const prev = sellerSel.value;
    const sellers = users.filter(u => ['vendedor','admin','superadmin'].includes(u.role));
    sellerSel.innerHTML = '<option value="all">Todos</option>' +
      sellers.map(u => `<option value="${u.id}">${u.name || u.email}</option>`).join('');
    sellerSel.value = prev || 'all';
    sellerSel.onchange = renderReports;
  }

  const catSel = $('rep-category');
  if (catSel) {
    const prev = catSel.value;
    const cats = settings.categories || {};
    catSel.innerHTML = '<option value="all">Todas</option>' +
      Object.entries(cats)
        .sort((a,b) => (a[1].order||0) - (b[1].order||0))
        .map(([slug, g]) => `<option value="${slug}">${g.name}</option>`).join('');
    catSel.value = prev || 'all';
    catSel.onchange = renderReports;
  }

  const brandSel = $('rep-brand');
  if (brandSel) {
    const prev = brandSel.value;
    const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort();
    brandSel.innerHTML = '<option value="all">Todas</option>' +
      brands.map(b => `<option value="${b}">${b}</option>`).join('');
    brandSel.value = prev || 'all';
    brandSel.onchange = renderReports;
  }

  // Método de pago
  const payMethodSel = $('rep-payment-method');
  if (payMethodSel) {
    const prev = payMethodSel.value;
    payMethodSel.value = prev || 'all';
    payMethodSel.onchange = () => {
      reportFilters.paymentMethod = payMethodSel.value;
      // Repoblar canales según el método
      populatePaymentChannelsFilter();
      renderReports();
    };
  }

  // Canal/cuenta
  const channelSel = $('rep-payment-channel');
  if (channelSel) {
    channelSel.value = 'all';
    channelSel.onchange = () => {
      reportFilters.paymentChannelId = channelSel.value;
      renderReports();
    };
    populatePaymentChannelsFilter();
  }

  // Estado de pago
  const payStatusSel = $('rep-payment-status');
  if (payStatusSel) {
    const prev = payStatusSel.value;
    payStatusSel.value = prev || 'all';
    payStatusSel.onchange = () => {
      reportFilters.paymentStatus = payStatusSel.value;
      renderReports();
    };
  }

  const dateFrom = $('rep-date-from');
  const dateTo = $('rep-date-to');
  if (dateFrom) dateFrom.onchange = () => { reportFilters.dateFrom = dateFrom.value || null; renderReports(); };
  if (dateTo) dateTo.onchange = () => { reportFilters.dateTo = dateTo.value || null; renderReports(); };

  // 🆕 Listener del toggle "Filtrar por"
  const dateModeSel = $('rep-date-mode');
  if (dateModeSel && !dateModeSel.dataset.listeners) {
    dateModeSel.dataset.listeners = '1';
    dateModeSel.onchange = () => {
      // Guardar en localStorage para persistir entre sesiones
      try { localStorage.setItem('smartec_rep_date_mode', dateModeSel.value); } catch (e) {}
      renderReports();
    };
    // Restaurar el valor guardado
    try {
      const saved = localStorage.getItem('smartec_rep_date_mode');
      if (saved) dateModeSel.value = saved;
    } catch (e) {}
  }

  // 🆕 Listener del dropdown "Agrupar por"
  const groupBySel = $('chart-sales-groupby');
  if (groupBySel) {
    // Sincronizar el valor actual SIEMPRE (aunque el listener ya esté puesto)
    if (groupBySel.value) {
      salesChartGroupBy = groupBySel.value;
    }
    // Poner el listener solo una vez
    if (!groupBySel.dataset.listeners) {
      groupBySel.dataset.listeners = '1';
      groupBySel.onchange = () => {
        salesChartGroupBy = groupBySel.value;
        renderCharts(getFilteredSales());
      };
    }
  }

  // Listeners de los toggles
  document.querySelectorAll('.report-toggle').forEach(cb => {
    cb.onchange = applyReportVisibility;
  });

  // Inicializar con mes actual
  if (!dateFrom.value) setReportRange('month');
}

function populatePaymentChannelsFilter() {
  const sel = $('rep-payment-channel');
  if (!sel) return;

  const method = $('rep-payment-method')?.value || 'all';

  // Obtener canales de las ventas existentes (agrupados por id de canal)
  // Combinamos con paymentChannels global para tener nombres actualizados
  const channelsMap = new Map();

  // 1. De las ventas que tienen canal asignado
  (sales || []).forEach(s => {
    if (!s.paymentChannelId) return;
    if (method !== 'all' && s.paymentMethod !== method) return;

    if (!channelsMap.has(s.paymentChannelId)) {
      channelsMap.set(s.paymentChannelId, {
        id: s.paymentChannelId,
        code: s.paymentChannelCode || '',
        bank: s.paymentChannelBank || '',
        name: s.paymentChannelName || '',
        icon: s.paymentChannelIcon || '',
        type: s.paymentChannelType || ''
      });
    }
  });

  // 2. De la lista de canales configurados (para el caso de que aún no haya ventas)
  if (typeof paymentChannels !== 'undefined' && paymentChannels.length) {
    paymentChannels.forEach(c => {
      if (c.active === false) return;
      if (method !== 'all' && c.type !== method) return;

      if (!channelsMap.has(c.id)) {
        channelsMap.set(c.id, {
          id: c.id,
          code: c.code || '',
          bank: c.bank || '',
          name: c.customName || '',
          icon: c.icon || '',
          type: c.type || ''
        });
      }
    });
  }

  // Ordenar alfabéticamente
  const list = Array.from(channelsMap.values()).sort((a, b) => {
    const bk = (a.bank || '').localeCompare(b.bank || '');
    if (bk !== 0) return bk;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Preservar valor anterior si sigue existiendo
  const prevValue = sel.value;

  sel.innerHTML = '<option value="all">Todos</option>' +
    list.map(c => {
      const icon = c.icon || '';
      const label = c.name ? `${c.bank} — ${c.name}` : c.bank;
      return `<option value="${c.id}">${icon} ${escapeHtml(label)}</option>`;
    }).join('');

  // Restaurar valor si existe
  if (prevValue && prevValue !== 'all') {
    const exists = Array.from(sel.options).some(o => o.value === prevValue);
    if (exists) sel.value = prevValue;
    else {
      sel.value = 'all';
      reportFilters.paymentChannelId = 'all';
    }
  }
}
 
window.setReportRange = (range) => {
  const now = new Date();
  let from, to;

  switch (range) {
    case 'today': from = to = now; break;
    case 'week': {
      const day = now.getDay() || 7;
      from = new Date(now);
      from.setDate(now.getDate() - day + 1);
      to = now;
      break;
    }
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = now;
      break;
    case 'lastmonth':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      to = now;
      break;
    default: return;
  }

  const fmtD = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };

  $('rep-date-from').value = fmtD(from);
  $('rep-date-to').value = fmtD(to);
  reportFilters.dateFrom = fmtD(from);
  reportFilters.dateTo = fmtD(to);

  renderReports();
};

window.clearReportFilters = () => {
  reportFilters = {
    dateFrom: null, dateTo: null,
    storeId: 'all', sellerUid: 'all',
    category: 'all', brand: 'all',
    paymentMethod: 'all', paymentChannelId: 'all', paymentStatus: 'all'
  };
  $('rep-date-from').value = '';
  $('rep-date-to').value = '';
  $('rep-store').value = 'all';
  $('rep-seller').value = 'all';
  $('rep-category').value = 'all';
  $('rep-brand').value = 'all';
  $('rep-payment-method').value = 'all';
  $('rep-payment-channel').value = 'all';
  $('rep-payment-status').value = 'all';
  populatePaymentChannelsFilter();
  renderReports();
};  

/* ============ FILTRADO ============ */
function getFilteredSales() {
  let list = sales.filter(s => s.status !== 'anulada');

  // 🆕 Determinar qué fecha usar como referencia
  const dateMode = $('rep-date-mode')?.value || 'created';
  const getRefDate = (s) => {
    if (dateMode === 'paid') {
      // Fecha de pago: paidAt si existe, si no createdAt (fallback)
      return s.paidAt?.seconds
        ? new Date(s.paidAt.seconds * 1000)
        : (s.createdAt?.seconds ? new Date(s.createdAt.seconds * 1000) : null);
    }
    // Fecha de creación (comportamiento original)
    return s.createdAt?.seconds ? new Date(s.createdAt.seconds * 1000) : null;
  };

  if (reportFilters.dateFrom) {
    const from = new Date(reportFilters.dateFrom + 'T00:00:00');
    list = list.filter(s => {
      const d = getRefDate(s);
      return d && d >= from;
    });
  }
  if (reportFilters.dateTo) {
    const to = new Date(reportFilters.dateTo + 'T23:59:59');
    list = list.filter(s => {
      const d = getRefDate(s);
      return d && d <= to;
    });
  }
  if (reportFilters.storeId !== 'all') {
    list = list.filter(s => s.storeId === reportFilters.storeId);
  }
  if (reportFilters.sellerUid !== 'all') {
    list = list.filter(s => s.sellerUid === reportFilters.sellerUid);
  }
  if (reportFilters.category !== 'all') {
    list = list.filter(s => (s.items || []).some(it => {
      const prod = products.find(p => p.id === it.productId);
      return prod && prod.categoryGroup === reportFilters.category;
    }));
  }
  if (reportFilters.brand !== 'all') {
    list = list.filter(s => (s.items || []).some(it => {
      const prod = products.find(p => p.id === it.productId);
      return prod && prod.brand === reportFilters.brand;
    }));
  }

  // 🆕 Filtro por método de pago
  if (reportFilters.paymentMethod !== 'all') {
    list = list.filter(s => s.paymentMethod === reportFilters.paymentMethod);
  }

  // 🆕 Filtro por canal/cuenta específico
  if (reportFilters.paymentChannelId !== 'all') {
    list = list.filter(s => s.paymentChannelId === reportFilters.paymentChannelId);
  }

  // 🆕 Filtro por estado de pago
  if (reportFilters.paymentStatus !== 'all') {
    list = list.filter(s => (s.paymentStatus || 'completed') === reportFilters.paymentStatus);
  }

  return list;
}

/* ============ RENDER PRINCIPAL ============ */
function renderReports() {
  reportFilters.storeId = $('rep-store')?.value || 'all';
  reportFilters.sellerUid = $('rep-seller')?.value || 'all';
  reportFilters.category = $('rep-category')?.value || 'all';
  reportFilters.brand = $('rep-brand')?.value || 'all';
  reportFilters.paymentMethod = $('rep-payment-method')?.value || 'all';
  reportFilters.paymentChannelId = $('rep-payment-channel')?.value || 'all';
  reportFilters.paymentStatus = $('rep-payment-status')?.value || 'all';
  reportFilters.dateFrom = $('rep-date-from')?.value || null;
  reportFilters.dateTo = $('rep-date-to')?.value || null;

  const filtered = getFilteredSales();

    // ===== KPIs (venta neta sin envío ni recargo tarjeta) =====
  let totalSales = 0;
  let totalShippingRep = 0;
  let totalSurchargeRep = 0;

  filtered.forEach(x => {
    const sub = Number(x.subtotal || 0);
    const disc = Number(x.discount || 0);
    const base = (x.commissionBase !== undefined) ? Number(x.commissionBase) : (sub - disc);
    totalSales += base;
    totalShippingRep += Number(x.shipping || 0);
    totalSurchargeRep += Number(x.surchargeAmount || 0);
  });

    // Calcular costo real desde los items (fallback si no tiene totalCost guardado)
  const totalCost = filtered.reduce((sum, s) => {
    if (Number(s.totalCost || 0) > 0) return sum + Number(s.totalCost);
    return sum + (s.items || []).reduce((itSum, it) => {
      return itSum + (Number(it.unitCost || 0) * Number(it.qty || 0));
    }, 0);
  }, 0);
  const totalProfit = totalSales - totalCost;
  const totalPool = filtered.reduce((s, x) => s + Number(x.poolAmount || x.commissionAmount || 0), 0);
  const totalBonus = filtered.reduce((s, x) => s + Number(x.bonusAmount || 0), 0);
  const totalCommission = totalPool + totalBonus;
  const totalUnits = filtered.reduce((s, x) =>
    s + (x.items || []).reduce((y, it) => y + Number(it.qty || 0), 0), 0);
  const ticket = filtered.length > 0 ? totalSales / filtered.length : 0;

  // 🆕 Calcular cobrado vs pendiente
  let totalCollected = 0;
  let totalPending = 0;
  let countPending = 0;

  filtered.forEach(s => {
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
    const ps = s.paymentStatus || 'completed';
    if (ps === 'pending') {
      totalPending += base;
      countPending++;
    } else {
      totalCollected += base;
    }
  });

  const collectedPct = totalSales > 0 ? (totalCollected / totalSales) * 100 : 0;
  const pendingPct = totalSales > 0 ? (totalPending / totalSales) * 100 : 0;

  $('rep-kpi-sales').innerText = fmt(totalSales);
  $('rep-kpi-count').innerText = `${filtered.length} transacciones · +${fmt(totalShippingRep)} envíos · +${fmt(totalSurchargeRep)} recargos`;
  $('rep-kpi-profit').innerText = fmt(totalProfit);
  $('rep-kpi-margin').innerText = `Margen ${totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(1) : 0}%`;
  $('rep-kpi-collected').innerText = fmt(totalCollected);
  $('rep-kpi-collected-pct').innerText = `${collectedPct.toFixed(1)}% del total`;
  $('rep-kpi-pending').innerText = fmt(totalPending);
  $('rep-kpi-pending-pct').innerText = countPending > 0
    ? `${pendingPct.toFixed(1)}% · ${countPending} venta${countPending !== 1 ? 's' : ''}`
    : 'Sin pendientes';
  $('rep-kpi-commission').innerText = fmt(totalCommission);
  $('rep-kpi-pool').innerText = fmt(totalPool);
  $('rep-kpi-bonus').innerText = fmt(totalBonus);
  // Los KPIs "Ticket promedio" y "Unidades" ya no están en el HTML (fueron reemplazados por Cobrado/Pendiente)
  // Si quieres volver a mostrarlos, agrega los elementos con id="rep-kpi-ticket" y "rep-kpi-units" al HTML.
  // $('rep-kpi-ticket').innerText = fmt(ticket);
  // $('rep-kpi-units').innerText = `${totalUnits} unidades`;

  // 🆕 Desglose por método y canal
  renderReportByMethod(filtered);

  // 🆕 Cobros pendientes
  renderReportPending(filtered);

  // 🆕 Conciliación bancaria
  renderReportReconciliation(filtered);

  renderReportByStore(filtered);
  renderReportTopSellers(filtered);
  renderReportTopProducts(filtered);
  renderReportByCategory(filtered);
  renderReportDetail(filtered);
  // 🆕 Nuevos bloques
  renderReportComparison(filtered);
  renderReportTopCustomers(filtered);
  renderReportProfitability(filtered);
  renderReportTaxes(filtered);

  // Gráficos
  renderCharts(filtered);
}

/* 🆕 Re-renderizar charts al redimensionar la ventana */
window.addEventListener('resize', () => {
  Object.values(charts).forEach(c => { if (c) c.resize(); });
});

/* ============================================================
   COMPUTE DATA PARA EL GRÁFICO DE VENTAS (agrupación dinámica)
============================================================ */
function computeSalesChartData(filtered, mode) {
  const palette = ['#4A7A9A','#0A2A4A','#22c55e','#f97316','#a855f7','#ef4444','#eab308','#06b6d4','#ec4899','#84cc16'];

  // Helper: obtener la fecha de la venta
  const getDate = s => s.createdAt?.seconds ? new Date(s.createdAt.seconds * 1000) : null;

  // Helper: obtener el lunes de una semana ISO
  const getWeekKey = (d) => {
    const temp = new Date(d.getTime());
    const day = temp.getDay() || 7;
    temp.setDate(temp.getDate() - day + 1);
    return `${temp.getFullYear()}-W${String(Math.ceil((((temp - new Date(temp.getFullYear(), 0, 1)) / 86400000) + 1) / 7)).padStart(2, '0')}`;
  };

  if (mode === 'day' || mode === 'week' || mode === 'month') {
    // ===== Serie temporal (línea) =====
    const byKey = {};
    filtered.forEach(s => {
      const d = getDate(s);
      if (!d) return;
      let key;
      if (mode === 'day') {
        key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      } else if (mode === 'week') {
        key = getWeekKey(d);
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      }
      if (!byKey[key]) byKey[key] = 0;
      byKey[key] += Number(s.total || 0);
    });

    const keys = Object.keys(byKey).sort();

    // Formatear labels
    const labels = keys.map(k => {
      if (mode === 'day') {
        const [y, m, day] = k.split('-');
        return `${day}/${m}`;
      } else if (mode === 'week') {
        const [y, w] = k.split('-W');
        return `Sem ${w}`;
      } else {
        const [y, m] = k.split('-');
        const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        return `${monthNames[parseInt(m)-1]} ${y.slice(2)}`;
      }
    });

    return {
      labels,
      values: keys.map(k => byKey[k]),
      chartType: 'line',
      chartTitle: mode === 'day' ? '📈 Ventas por día'
                 : mode === 'week' ? '📈 Ventas por semana'
                 : '📈 Ventas por mes',
      colors: palette[0]
    };
  }

  // ===== Agrupaciones categóricas =====
  const byCat = {};

  filtered.forEach(s => {
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
    let key = 'Sin categoría';

    if (mode === 'paymentMethod') {
      // 🆕 Si la venta tiene paymentBreakdown, la sumamos al método principal
      //    (o al método con mayor monto si es mixta)
      if (Array.isArray(s.paymentBreakdown) && s.paymentBreakdown.length) {
        // Tomar el método con mayor monto como principal
        const main = s.paymentBreakdown.reduce((max, p) =>
          Number(p.amount || 0) > Number(max.amount || 0) ? p : max
        , s.paymentBreakdown[0]);
        const labels = {
          efectivo: '💵 Efectivo',
          transferencia: '🔄 Transferencia',
          tarjeta: '💳 Tarjeta',
          contraentrega: '📦 Contra entrega',
          credito: '🛍️ Crédito'
        };
        key = labels[main.method] || main.method || 'Sin método';
        // El monto a sumar es el del método principal, no el total de la venta
        // Para no doble-contar. Se maneja en el byCat de abajo.
        byCat[key] = (byCat[key] || 0) + Number(main.amount || 0);
        return;
      }
      const labels = {
        efectivo: '💵 Efectivo',
        transferencia: '🔄 Transferencia',
        tarjeta: '💳 Tarjeta',
        contraentrega: '📦 Contra entrega',
        credito: '🛍️ Crédito',
        nequi: '📱 Nequi (legacy)'
      };
      key = labels[s.paymentMethod] || s.paymentMethod || 'Sin método';
    } else if (mode === 'paymentChannel') {
      if (s.finalPaymentChannelId || s.paymentChannelId) {
        const icon = s.finalPaymentChannelIcon || s.paymentChannelIcon || '🏦';
        const bank = s.finalPaymentChannelBank || s.paymentChannelBank || '';
        const name = s.finalPaymentChannelName || s.paymentChannelName || '';
        key = `${icon} ${bank}${name ? ' — ' + name : ''}`;
      } else {
        // Sin canal → agrupar por método final
        const fm = s.finalPaymentMethod || s.paymentMethod || 'efectivo';
        const labels = {
          efectivo: '💵 Efectivo',
          transferencia: '🔄 Transferencia (genérica)',
          tarjeta: '💳 Tarjeta',
          contraentrega: '📦 Contra entrega sin confirmar',
          credito: '🛍️ Crédito'
        };
        key = labels[fm] || fm;
      }
    } else if (mode === 'store') {
      const st = stores.find(x => x.storeId === s.storeId);
      key = st?.name || s.storeId || 'Sin tienda';
    } else if (mode === 'seller') {
      key = s.sellerName || s.sellerEmail || 'Sin vendedor';
    } else if (mode === 'category') {
      // Suma por categorías de los items
      const cats = {};
      (s.items || []).forEach(it => {
        const prod = products.find(p => p.id === it.productId);
        const cat = prod?.categoryGroupName || 'Sin categoría';
        const itemTotal = Number(it.qty || 0) * Number(it.unitPrice || 0);
        cats[cat] = (cats[cat] || 0) + itemTotal;
      });
      // Tomar la categoría principal (la de mayor valor) o "Múltiples"
      const catEntries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
      if (catEntries.length === 1) {
        key = catEntries[0][0];
        byCat[key] = (byCat[key] || 0) + base;
      } else if (catEntries.length > 1) {
        key = 'Múltiples categorías';
        byCat[key] = (byCat[key] || 0) + base;
      }
      return; // ya sumamos arriba
    }

    byCat[key] = (byCat[key] || 0) + base;
  });

  // Ordenar de mayor a menor
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  // Limitar a los top 10 si hay muchos
  const top = sorted.slice(0, 10);

  const chartTitles = {
    paymentMethod: '💳 Ventas por método de pago',
    paymentChannel: '🏦 Ventas por canal/cuenta',
    store: '🏪 Ventas por tienda',
    seller: '👤 Ventas por vendedor',
    category: '📂 Ventas por categoría'
  };

  return {
    labels: top.map(([k]) => k.length > 25 ? k.slice(0, 22) + '…' : k),
    values: top.map(([,v]) => v),
    chartType: 'bar',
    chartTitle: chartTitles[mode] || '📊 Ventas',
    colors: palette
  };
}
/* 🆕 Guard: no renderizar charts si el canvas no es visible */
function isCanvasVisible(el) {
  return el && el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0;
}

function renderCharts(filtered) {
  // Destruir anteriores
  Object.values(charts).forEach(c => { if (c) c.destroy(); charts[c] = null; });

  const palette = ['#4A7A9A','#0A2A4A','#22c55e','#f97316','#a855f7','#ef4444','#eab308','#06b6d4','#ec4899','#84cc16'];

  // ============================================================
  // GRÁFICO DE VENTAS — Agrupación dinámica
  // ============================================================
  const ctxSales = $('chart-sales');
  const titleEl = $('chart-sales-title');
  const emptyMsg = $('chart-sales-empty');

  if (ctxSales && reportVisibility.chartSales && isCanvasVisible(ctxSales)) {
    // Calcular datos según el modo
    const { labels, values, chartType, chartTitle, colors } = computeSalesChartData(filtered, salesChartGroupBy);

    // Actualizar el título
    if (titleEl) titleEl.innerText = chartTitle;

    // 🆕 Si no hay datos, mostrar mensaje y salir
    if (!values || !values.length || values.every(v => !v || v === 0)) {
      if (emptyMsg) emptyMsg.classList.remove('hidden');
      return;
    }
    if (emptyMsg) emptyMsg.classList.add('hidden');

    // Configuración base
    const isBar = chartType === 'bar';
    const isDoughnut = chartType === 'doughnut';

    const dataset = isDoughnut
      ? {
          data: values,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#fff'
        }
      : {
          label: 'Ventas ($)',
          data: values,
          borderColor: '#4A7A9A',
          backgroundColor: isBar ? colors : 'rgba(74,122,154,0.15)',
          tension: 0.35,
          fill: !isBar,
          pointBackgroundColor: '#0A2A4A',
          pointRadius: isBar ? 0 : 4,
          borderRadius: isBar ? 6 : 0
        };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: isDoughnut,
          position: 'bottom',
          labels: { font: { size: 11 }, padding: 10 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const value = isDoughnut ? ctx.parsed : (isBar ? ctx.parsed.y : ctx.parsed.y);
              return '$' + Number(value).toLocaleString('es-CO');
            }
          }
        }
      }
    };

    // Escalas solo para line/bar
    if (!isDoughnut) {
      options.scales = {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => '$' + (v/1000).toFixed(0) + 'k' }
        }
      };
      if (isBar) {
        options.indexAxis = 'y';
        options.scales = {
          x: {
            beginAtZero: true,
            ticks: { callback: (v) => '$' + (v/1000).toFixed(0) + 'k' }
          }
        };
      }
    }

    charts.sales = new Chart(ctxSales, {
      type: chartType,
      data: { labels, datasets: [dataset] },
      options
    });
  }

  // ===== Top vendedores (barras horizontales) =====
  const bySeller = {};
  filtered.forEach(s => {
    const key = s.sellerUid || s.sellerEmail || 'unknown';
    if (!bySeller[key]) bySeller[key] = { name: s.sellerName || s.sellerEmail || '—', sales: 0 };
    bySeller[key].sales += Number(s.total || 0);
  });
  const sellers = Object.values(bySeller).sort((a,b) => b.sales - a.sales).slice(0, 8);

  const ctxTS = $('chart-topsellers');
  if (ctxTS && reportVisibility.chartTopSellers && isCanvasVisible(ctxTS)) {
    charts.topsellers = new Chart(ctxTS, {
      type: 'bar',
      data: {
        labels: sellers.map(s => s.name.length > 20 ? s.name.substring(0, 18) + '…' : s.name),
        datasets: [{
          label: 'Ventas ($)',
          data: sellers.map(s => s.sales),
          backgroundColor: palette,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => '$' + Number(ctx.parsed.x).toLocaleString('es-CO') }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { callback: (v) => '$' + (v/1000).toFixed(0) + 'k' }
          }
        }
      }
    });
  }
}

/* ============================================================
   DESGLOSE POR MÉTODO Y CANAL
============================================================ */
function renderReportByMethod(filtered) {
  const el = $('rep-by-method');
  const totalEl = $('rep-method-total');
  if (!el) return;

  // Definir orden y estilo de métodos
  const methodMeta = {
    efectivo:       { label: 'Efectivo',       icon: '💵', color: 'green',   order: 1 },
    transferencia:  { label: 'Transferencia',  icon: '🔄', color: 'blue',    order: 2 },
    tarjeta:        { label: 'Tarjeta',        icon: '💳', color: 'purple',  order: 3 },
    contraentrega:  { label: 'Contra entrega', icon: '📦', color: 'orange',  order: 4 },
    credito:        { label: 'Crédito',        icon: '🛍️', color: 'amber',   order: 5 },
    nequi:          { label: 'Nequi (legacy)', icon: '📱', color: 'gray',    order: 99 }
  };

  // Agrupar por método
  const byMethod = {};

  /**
   * 🆕 Helper: registra un "pago parcial" en el byMethod.
   * - Si la venta tiene paymentBreakdown, itera por cada pago.
   * - Si no, usa el método principal como antes.
   */
  const registerPayment = (s, method, amount, channelData, isPending) => {
    if (!byMethod[method]) {
      byMethod[method] = {
        method,
        total: 0,
        count: 0,
        pending: 0,
        pendingCount: 0,
        channels: {}
      };
    }

    byMethod[method].total += amount;
    byMethod[method].count += 1;

    if (isPending) {
      byMethod[method].pending += amount;
      byMethod[method].pendingCount += 1;
    }

    // Canal específico
    if (channelData && channelData.id) {
      const cid = channelData.id;
      if (!byMethod[method].channels[cid]) {
        byMethod[method].channels[cid] = {
          id: cid,
          bank: channelData.bank || '',
          name: channelData.name || '',
          icon: channelData.icon || '',
          color: channelData.color || '',
          total: 0,
          count: 0,
          pending: 0,
          pendingCount: 0
        };
      }
      byMethod[method].channels[cid].total += amount;
      byMethod[method].channels[cid].count += 1;
      if (isPending) {
        byMethod[method].channels[cid].pending += amount;
        byMethod[method].channels[cid].pendingCount += 1;
      }
    }
  };

  filtered.forEach(s => {
    const ps = s.paymentStatus || 'completed';
    const isPending = ps === 'pending';

    // 🆕 Caso 1: tiene paymentBreakdown (venta mixta o dividida)
    if (Array.isArray(s.paymentBreakdown) && s.paymentBreakdown.length) {
      s.paymentBreakdown.forEach(p => {
        const channel = p.channelId ? {
          id: p.channelId,
          bank: p.channelBank || '',
          name: p.channelName || '',
          icon: p.channelIcon || '',
          color: p.channelColor || ''
        } : null;
        registerPayment(s, p.method, Number(p.amount || 0), channel, isPending);
      });
      return;
    }

    // 🆕 Caso 2: venta normal (compatibilidad con ventas viejas)
    const method = s.paymentMethod || 'efectivo';
    const base = (s.commissionBase !== undefined)
      ? Number(s.commissionBase)
      : (Number(s.subtotal || 0) - Number(s.discount || 0));

    const channel = s.paymentChannelId ? {
      id: s.paymentChannelId,
      bank: s.paymentChannelBank || '',
      name: s.paymentChannelName || '',
      icon: s.paymentChannelIcon || '',
      color: s.paymentChannelColor || ''
    } : null;

    registerPayment(s, method, base, channel, isPending);
  });

  // Calcular total general
  const totalGeneral = Object.values(byMethod).reduce((s, m) => s + m.total, 0);

  if (totalEl) totalEl.querySelector('p:last-child').innerText = fmt(totalGeneral);

  // Si no hay datos
  if (!Object.keys(byMethod).length) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-6">Sin ventas en el período</p>';
    return;
  }

  // Ordenar métodos según `order`
  const methodsSorted = Object.values(byMethod).sort((a, b) => {
    const oa = methodMeta[a.method]?.order ?? 50;
    const ob = methodMeta[b.method]?.order ?? 50;
    return oa - ob;
  });

  // Render
  el.innerHTML = methodsSorted.map(m => {
    const meta = methodMeta[m.method] || { label: m.method, icon: '●', color: 'gray' };
    const pct = totalGeneral > 0 ? (m.total / totalGeneral) * 100 : 0;

    // Colores de fondo del bloque del método
    const bgMap = {
      green:  'bg-green-50 border-green-200',
      blue:   'bg-blue-50 border-blue-200',
      purple: 'bg-purple-50 border-purple-200',
      orange: 'bg-orange-50 border-orange-200',
      amber:  'bg-amber-50 border-amber-200',
      gray:   'bg-gray-50 border-gray-200'
    };
    const textMap = {
      green:  'text-green-700',
      blue:   'text-blue-700',
      purple: 'text-purple-700',
      orange: 'text-orange-700',
      amber:  'text-amber-700',
      gray:   'text-gray-700'
    };
    const bg = bgMap[meta.color] || bgMap.gray;
    const txt = textMap[meta.color] || textMap.gray;

    // Sub-canales ordenados
    const channels = Object.values(m.channels).sort((a, b) => b.total - a.total);

    const channelsHtml = channels.length
      ? channels.map(c => {
          const icon = c.icon || '●';
          const label = c.name ? `${c.bank} — ${c.name}` : c.bank;
          const cPct = m.total > 0 ? (c.total / m.total) * 100 : 0;
          const pendingBadge = c.pendingCount > 0
            ? `<span class="ml-2 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">⏳ ${c.pendingCount}</span>`
            : '';
          return `
            <div class="flex items-center justify-between py-1.5 pl-6 border-t border-gray-100 first:border-t-0">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="text-sm">${icon}</span>
                <span class="text-xs text-gray-600 truncate">${escapeHtml(label)}</span>
                ${pendingBadge}
              </div>
              <div class="text-right ml-3 flex-shrink-0">
                <p class="text-xs font-semibold text-sd">${fmt(c.total)}</p>
                <p class="text-[10px] text-gray-400">${c.count} venta${c.count !== 1 ? 's' : ''} · ${cPct.toFixed(1)}%</p>
              </div>
            </div>
          `;
        }).join('')
      : '';

    const pendingInfo = m.pendingCount > 0
      ? `<p class="text-[10px] text-amber-600 font-semibold mt-1 pl-6">⏳ ${m.pendingCount} pendiente${m.pendingCount !== 1 ? 's' : ''} · ${fmt(m.pending)}</p>`
      : '';

    return `
      <div class="border rounded-lg p-3 ${bg}">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <span class="text-lg">${meta.icon}</span>
            <span class="font-semibold ${txt} text-sm">${meta.label}</span>
          </div>
          <div class="text-right">
            <p class="text-base font-bold ${txt}">${fmt(m.total)}</p>
            <p class="text-[10px] text-gray-500">${m.count} venta${m.count !== 1 ? 's' : ''} · ${pct.toFixed(1)}% del total</p>
          </div>
        </div>
        ${pendingInfo}
        ${channelsHtml}
      </div>
    `;
  }).join('');
}

/* ============================================================
   CONCILIACIÓN BANCARIA
============================================================ */
function renderReportReconciliation(filtered) {
  const listEl = $('rep-reconciliation-list');
  const emptyEl = $('rep-reconciliation-empty');
  if (!listEl) return;

  // 🆕 Mapeo de métodos a "cuentas destino" genéricas (para pagos sin canal específico)
  const genericAccounts = {
    efectivo:  { bank: 'Efectivo',  name: 'Caja física',          icon: '💵', color: '#22c55e', type: 'efectivo' },
    tarjeta:   { bank: 'Tarjeta',   name: 'Datáfono / Terminal',  icon: '💳', color: '#a855f7', type: 'tarjeta' },
    transferencia: { bank: 'Transferencia', name: 'Sin especificar', icon: '🔄', color: '#3b82f6', type: 'transferencia' },
    credito:   { bank: 'Crédito',   name: 'Sin especificar',      icon: '🛍️', color: '#8b5cf6', type: 'credito' }
  };

  const groups = {};

  /** Helper: agrega un pago a un grupo */
  const addToGroup = (key, data, amount, count = 1) => {
    if (!groups[key]) {
      groups[key] = { ...data, total: 0, count: 0 };
    }
    groups[key].total += amount;
    groups[key].count += count;
  };

  /** Helper: clasifica un pago a su cuenta destino */
  const classifyPayment = (s, payment, isPending) => {
    const amount = Number(payment.amount || 0);
    const method = payment.method;

    // Si la venta está pendiente, todo va a "Por cobrar"
    if (isPending) {
      return {
        key: 'pending_contraentrega',
        data: {
          type: 'pending',
          bank: 'Por cobrar',
          name: 'Contra entrega pendiente',
          account: '',
          icon: '⏳',
          color: '#f59e0b'
        },
        amount
      };
    }

    // Si tiene canal específico (transferencia o crédito)
    if (payment.channelId && (method === 'transferencia' || method === 'credito')) {
      return {
        key: payment.channelId,
        data: {
          type: method,
          bank: payment.channelBank || 'Cuenta',
          name: payment.channelName || '',
          account: payment.channelAccount || '',
          icon: payment.channelIcon || (method === 'credito' ? '🛍️' : '🏦'),
          color: payment.channelColor || '#0A2A4A'
        },
        amount
      };
    }

    // Método genérico
    const generic = genericAccounts[method] || {
      bank: method || 'Otros', name: '', icon: '●', color: '#6b7280', type: 'otros'
    };
    return {
      key: method,
      data: {
        type: generic.type,
        bank: generic.bank,
        name: generic.name,
        account: '',
        icon: generic.icon,
        color: generic.color
      },
      amount
    };
  };

  filtered.forEach(s => {
    const base = (s.commissionBase !== undefined)
      ? Number(s.commissionBase)
      : (Number(s.subtotal||0) - Number(s.discount||0));
    const ps = s.paymentStatus || 'completed';
    const isPending = ps === 'pending';

    // 🆕 Si tiene paymentBreakdown → cada pago va a su cuenta
    if (Array.isArray(s.paymentBreakdown) && s.paymentBreakdown.length) {
      s.paymentBreakdown.forEach(p => {
        const c = classifyPayment(s, p, isPending);
        addToGroup(c.key, c.data, c.amount, 1);
      });
      return;
    }

    // 🆕 Si no → usar método original (compatibilidad)
    const method = s.finalPaymentMethod || s.paymentMethod || 'efectivo';
    const channel = {
      channelId: s.finalPaymentChannelId || s.paymentChannelId || null,
      channelBank: s.finalPaymentChannelBank || s.paymentChannelBank || null,
      channelName: s.finalPaymentChannelName || s.paymentChannelName || null,
      channelAccount: s.finalPaymentChannelAccount || s.paymentChannelAccount || null,
      channelIcon: s.finalPaymentChannelIcon || s.paymentChannelIcon || null,
      channelColor: s.finalPaymentChannelColor || s.paymentChannelColor || null,
      method: method
    };
    const c = classifyPayment(s, { ...channel, amount: base }, isPending);
    addToGroup(c.key, c.data, c.amount, 1);
  });

  // Si no hay datos
  if (!Object.keys(groups).length) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  // Ordenar: primero los cobrados (mayor a menor total), al final los pendientes
  const sortedGroups = Object.values(groups).sort((a, b) => {
    if (a.type === 'pending' && b.type !== 'pending') return 1;
    if (a.type !== 'pending' && b.type === 'pending') return -1;
    return b.total - a.total;
  });

  const totalAll = sortedGroups.reduce((s, g) => s + g.total, 0);

  listEl.innerHTML = sortedGroups.map(g => {
    const pct = totalAll > 0 ? (g.total / totalAll) * 100 : 0;
    const isPending = g.type === 'pending';

    const bgClass = isPending ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200';

    return `
      <div class="border rounded-lg p-4 ${bgClass} flex flex-wrap items-center gap-3">
        <div class="w-12 h-12 rounded-full flex items-center justify-center shrink-0 text-2xl"
             style="background:${g.color}20; border:2px solid ${g.color}40">
          ${g.icon}
        </div>

        <div class="flex-1 min-w-0">
          <p class="font-semibold text-sd text-sm truncate">
            ${g.bank}${g.name ? ' — ' + g.name : ''}
          </p>
          <p class="text-[10px] text-gray-500 mt-0.5">
            ${g.account ? 'Cuenta: <span class="font-mono">' + escapeHtml(g.account) + '</span> · ' : ''}
            ${g.count} venta${g.count !== 1 ? 's' : ''}
            ${isPending ? ' · ⏳ pendiente de cobro' : ''}
          </p>
        </div>

        <div class="text-right">
          <p class="text-lg font-bold ${isPending ? 'text-amber-700' : 'text-sl'}">${fmt(g.total)}</p>
          <p class="text-[10px] text-gray-400">${pct.toFixed(1)}% del total</p>
        </div>
      </div>
    `;
  }).join('');
}

window.exportReconciliationPDF = async () => {
  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }
  const { jsPDF } = window.jspdf;
  const filtered = getFilteredSales();

  if (!filtered.length) {
    alert('No hay ventas para exportar con estos filtros.');
    return;
  }

  // Recolectar la misma data que muestra la UI
  const groups = {};

  filtered.forEach(s => {
    const base = (s.commissionBase !== undefined)
      ? Number(s.commissionBase)
      : (Number(s.subtotal||0) - Number(s.discount||0));
    const ps = s.paymentStatus || 'completed';

    let accountKey, accountData;

    if (ps === 'pending') {
      accountKey = 'pending_contraentrega';
      accountData = {
        type: 'pending',
        bank: 'Por cobrar',
        name: 'Contra entrega pendiente',
        account: '',
        icon: '⏳'
      };
    } else {
      const finalMethod = s.finalPaymentMethod || s.paymentMethod;

      if (finalMethod === 'efectivo') {
        accountKey = 'efectivo';
        accountData = { type: 'efectivo', bank: 'Efectivo', name: 'Caja física', account: '', icon: '💵' };
      } else if (finalMethod === 'tarjeta') {
        accountKey = 'tarjeta';
        accountData = { type: 'tarjeta', bank: 'Tarjeta', name: 'Datáfono / Terminal', account: '', icon: '💳' };
      } else if (finalMethod === 'transferencia' || finalMethod === 'credito') {
        const cid = s.finalPaymentChannelId || s.paymentChannelId;
        const cBank = s.finalPaymentChannelBank || s.paymentChannelBank;
        const cName = s.finalPaymentChannelName || s.paymentChannelName;
        const cAccount = s.finalPaymentChannelAccount || s.paymentChannelAccount;
        const cIcon = s.finalPaymentChannelIcon || s.paymentChannelIcon;

        if (cid) {
          accountKey = cid;
          accountData = {
            type: finalMethod,
            bank: cBank || 'Cuenta',
            name: cName || '',
            account: cAccount || '',
            icon: cIcon || (finalMethod === 'credito' ? '🛍️' : '🏦')
          };
        } else {
          accountKey = 'transferencia_generica';
          accountData = { type: 'transferencia', bank: 'Transferencia', name: 'Sin especificar', account: '', icon: '🔄' };
        }
      } else {
        accountKey = 'otros';
        accountData = { type: 'otros', bank: 'Otros', name: '', account: '', icon: '●' };
      }
    }

    if (!groups[accountKey]) {
      groups[accountKey] = { ...accountData, total: 0, count: 0 };
    }
    groups[accountKey].total += base;
    groups[accountKey].count += 1;
  });

  const sortedGroups = Object.values(groups).sort((a, b) => {
    if (a.type === 'pending' && b.type !== 'pending') return 1;
    if (a.type !== 'pending' && b.type === 'pending') return -1;
    return b.total - a.total;
  });

  const totalGeneral = sortedGroups.reduce((s, g) => s + g.total, 0);

  // Crear el PDF
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  // Encabezado
  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC', 14, 13);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Conciliación por cuenta', pageW - 14, 13, { align: 'right' });

  y = 28;

  // Filtros aplicados
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  doc.text(`Período: ${reportFilters.dateFrom || 'todo'} — ${reportFilters.dateTo || 'hoy'}`, 14, y); y += 5;
  doc.text(`Tienda: ${reportFilters.storeId === 'all' ? 'Todas' : (stores.find(s => s.storeId === reportFilters.storeId)?.name || reportFilters.storeId)}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  // Total general
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 42, 74);
  doc.text('Total del período', 14, y); y += 3;

  doc.autoTable({
    startY: y,
    head: [['Total', 'Ventas', 'Cuentas']],
    body: [[
      '$' + totalGeneral.toLocaleString('es-CO'),
      String(filtered.length),
      String(sortedGroups.length)
    ]],
    theme: 'grid',
    headStyles: { fillColor: [74, 122, 154], textColor: 255, halign: 'center', fontStyle: 'bold' },
    bodyStyles: { halign: 'center', fontSize: 10 },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 10;

  // Detalle por cuenta
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 42, 74);
  doc.text('Detalle por cuenta/canal', 14, y); y += 3;

  const rows = sortedGroups.map(g => [
    stripEmojis(`${g.icon} ${g.bank}${g.name ? ' — ' + g.name : ''}`),
    g.account || '-',
    String(g.count),
    '$' + g.total.toLocaleString('es-CO'),
    totalGeneral > 0 ? ((g.total / totalGeneral) * 100).toFixed(1) + '%' : '0%'
  ]);

  doc.autoTable({
    startY: y,
    head: [['Cuenta / Canal', 'Nº cuenta', 'Ventas', 'Total', '%']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 30, font: 'courier' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 20, halign: 'right' }
    },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 10;

  // Pie de página
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Smartec · Conciliación bancaria · Página ${i} de ${pages}`,
      pageW / 2,
      pageH - 8,
      { align: 'center' }
    );
  }

  const filename = `smartec_conciliacion_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
};

/* ============================================================
   COBROS PENDIENTES
============================================================ */
function renderReportPending(filtered) {

  const listEl = $('rep-pending-list');
  const emptyEl = $('rep-pending-empty');
  const totalEl = $('rep-pending-total');
  if (!listEl) return;

  // Filtrar solo pendientes
  const pending = filtered.filter(s => (s.paymentStatus || 'completed') === 'pending');

  // Calcular total
  const totalPending = pending.reduce((sum, s) => {
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
    return sum + base;
  }, 0);

  if (totalEl) totalEl.innerText = fmt(totalPending);

  // Si no hay pendientes
  if (!pending.length) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  // Ordenar por fecha ascendente (los más antiguos primero para priorizar cobro)
  pending.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

  listEl.innerHTML = pending.slice(0, 100).map(s => {
    const store = stores.find(x => x.storeId === s.storeId);
    const seller = users.find(u => u.id === s.sellerUid);
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
    const itemsCount = (s.items||[]).reduce((sum,i) => sum + (i.qty||0), 0);

    // Días transcurridos
    const daysAgo = s.createdAt?.seconds
      ? Math.floor((Date.now() - new Date(s.createdAt.seconds * 1000).getTime()) / (24*60*60*1000))
      : 0;
    const daysLabel = daysAgo === 0 ? 'Hoy'
      : daysAgo === 1 ? 'Ayer'
      : `Hace ${daysAgo} días`;
    const urgencyClass = daysAgo >= 7 ? 'text-red-600 font-bold'
                       : daysAgo >= 3 ? 'text-orange-500 font-semibold'
                       : 'text-gray-500';

    // Método original
    const method = s.paymentMethod || 'efectivo';
    const methodLabels = {
      efectivo: '💵 Efectivo',
      transferencia: '🔄 Transferencia',
      tarjeta: '💳 Tarjeta',
      contraentrega: '📦 Contra entrega',
      credito: '🛍️ Crédito'
    };
    const methodLabel = methodLabels[method] || method;

    return `
      <div class="border-l-4 border-amber-400 bg-amber-50 rounded-lg p-3 flex flex-wrap items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="font-semibold text-sd text-sm">${escapeHtml(s.customer?.name) || 'Cliente'}</p>
            <span class="text-[10px] bg-white text-amber-700 px-2 py-0.5 rounded-full font-semibold">${methodLabel}</span>
          </div>
          <p class="text-[10px] text-gray-500 mt-0.5">
            ${fmtDate(s.createdAt)} · ${store?.name || s.storeId} · ${seller?.name || s.sellerEmail || ''}
          </p>
          <p class="text-[10px] text-gray-400">${itemsCount} item(s) · ${escapeHtml(s.customer?.phone) || 'sin teléfono'}</p>
        </div>

        <div class="text-right">
          <p class="text-lg font-bold text-amber-700">${fmt(base)}</p>
          <p class="text-[10px] ${urgencyClass}">⏱ ${daysLabel}</p>
        </div>

        <div class="shrink-0">
          <button onclick='openConfirmPaymentModal("${s.id}")'
                  class="bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition">
            ✅ Confirmar cobro
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/* ============================================================
   🆕 BLOQUE: Comparativa con período anterior
============================================================ */
function renderReportComparison(filtered) {
  const el = $('rep-comparison-grid');
  const subtitle = $('rep-comparison-subtitle');
  if (!el) return;

  // Determinar el rango actual
  const dateFrom = reportFilters.dateFrom;
  const dateTo = reportFilters.dateTo;

  if (!dateFrom || !dateTo) {
    subtitle.innerText = '⚠️ Selecciona un rango de fechas para comparar';
    el.innerHTML = '<p class="text-xs text-gray-400 col-span-full text-center py-4">Sin rango de comparación</p>';
    return;
  }

  const fromDate = new Date(dateFrom + 'T00:00:00');
  const toDate = new Date(dateTo + 'T23:59:59');
  const diffDays = Math.max(1, Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)));

  // Calcular el período anterior de igual duración
  const prevTo = new Date(fromDate);
  prevTo.setDate(prevTo.getDate() - 1);
  prevTo.setHours(23, 59, 59);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - diffDays + 1);
  prevFrom.setHours(0, 0, 0);

  subtitle.innerText = `Comparando ${dateFrom} → ${dateTo} con ${prevFrom.toISOString().split('T')[0]} → ${prevTo.toISOString().split('T')[0]}`;

  // Filtrar las ventas del período anterior
  let prevSales = sales.filter(s => s.status !== 'anulada');
  prevSales = prevSales.filter(s => {
    if (!s.createdAt?.seconds) return false;
    const d = new Date(s.createdAt.seconds * 1000);
    return d >= prevFrom && d <= prevTo;
  });

  // Aplicar los mismos filtros de tienda/vendedor/categoría/marca que el actual
  if (reportFilters.storeId !== 'all') prevSales = prevSales.filter(s => s.storeId === reportFilters.storeId);
  if (reportFilters.sellerUid !== 'all') prevSales = prevSales.filter(s => s.sellerUid === reportFilters.sellerUid);
  if (reportFilters.paymentMethod !== 'all') prevSales = prevSales.filter(s => s.paymentMethod === reportFilters.paymentMethod);
  if (reportFilters.paymentChannelId !== 'all') prevSales = prevSales.filter(s => s.paymentChannelId === reportFilters.paymentChannelId);
  if (reportFilters.paymentStatus !== 'all') prevSales = prevSales.filter(s => (s.paymentStatus || 'completed') === reportFilters.paymentStatus);

  // KPIs del período anterior
  const prev = computePeriodKPIs(prevSales);
  // KPIs del período actual
  const curr = computePeriodKPIs(filtered);

  // Función auxiliar para formatear % de cambio
  const fmtChange = (currVal, prevVal) => {
    if (prevVal === 0 && currVal === 0) return { text: '0%', cls: 'text-gray-400', arrow: '→' };
    if (prevVal === 0) return { text: '+100%', cls: 'text-green-600', arrow: '↗' };
    const pct = ((currVal - prevVal) / prevVal) * 100;
    const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→';
    const cls = pct > 0 ? 'text-green-600' : pct < 0 ? 'text-red-600' : 'text-gray-400';
    return { text: (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%', cls, arrow };
  };

  const cards = [
    { label: 'Ventas netas', curr: curr.sales, prev: prev.sales, icon: '💰', money: true },
    { label: 'Transacciones', curr: curr.count, prev: prev.count, icon: '🧾', money: false },
    { label: 'Ticket promedio', curr: curr.ticket, prev: prev.ticket, icon: '🎯', money: true },
    { label: 'Unidades vendidas', curr: curr.units, prev: prev.units, icon: '📦', money: false },
    { label: 'Utilidad bruta', curr: curr.profit, prev: prev.profit, icon: '📈', money: true },
    { label: 'Comisiones', curr: curr.commission, prev: prev.commission, icon: '💵', money: true }
  ];

  el.innerHTML = cards.map(c => {
    const ch = fmtChange(c.curr, c.prev);
    const fmtVal = c.money ? fmt(c.curr) : Number(c.curr).toLocaleString('es-CO');
    const fmtPrev = c.money ? fmt(c.prev) : Number(c.prev).toLocaleString('es-CO');
    return `
      <div class="border rounded-lg p-3 bg-white">
        <div class="flex items-center justify-between mb-1">
          <p class="text-[10px] text-gray-500 uppercase font-semibold">${c.icon} ${c.label}</p>
          <span class="${ch.cls} text-xs font-bold">${ch.arrow} ${ch.text}</span>
        </div>
        <p class="text-lg font-bold text-sd">${fmtVal}</p>
        <p class="text-[10px] text-gray-400">Período anterior: ${fmtPrev}</p>
      </div>
    `;
  }).join('');
}

/**
 * Calcula KPIs agregados de un array de ventas.
 */
function computePeriodKPIs(salesList) {
  let sales = 0, count = 0, units = 0, cost = 0, profit = 0, commission = 0;
  salesList.forEach(s => {
    const sub = Number(s.subtotal || 0);
    const disc = Number(s.discount || 0);
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (sub - disc);
    sales += base;
    count += 1;
    units += (s.items || []).reduce((y, i) => y + Number(i.qty || 0), 0);
    const sCost = Number(s.totalCost) > 0
      ? Number(s.totalCost)
      : (s.items || []).reduce((sum, it) => sum + Number(it.unitCost || 0) * Number(it.qty || 0), 0);
    cost += sCost;
    profit += base - sCost;
    commission += Number(s.poolAmount || s.commissionAmount || 0) + Number(s.bonusAmount || 0);
  });
  return {
    sales, count, units, cost, profit, commission,
    ticket: count > 0 ? sales / count : 0
  };
}

/* ============ BLOQUES DE RENDERIZADO ============ */
function renderReportByStore(filtered) {
  const el = $('rep-by-store');
  const byStore = {};
  filtered.forEach(s => {
    const key = s.storeId;
    if (!byStore[key]) byStore[key] = { sales:0, count:0, commission:0, profit:0 };
    const sub = Number(s.subtotal || 0);
    const disc = Number(s.discount || 0);
    const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (sub - disc);
    byStore[key].sales += base;
    byStore[key].count += 1;
    byStore[key].commission += Number(s.sellerCommissionAmount || 0);
    byStore[key].profit += Number(s.profit || 0);
  });

  const rows = stores.map(st => ({ ...st, ...(byStore[st.storeId] || {sales:0,count:0,commission:0,profit:0}) }))
    .sort((a,b) => b.sales - a.sales);

  if (!rows.length || rows.every(r => r.sales === 0)) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Sin datos en este rango</p>';
    return;
  }

  const max = Math.max(...rows.map(r => r.sales), 1);
  el.innerHTML = rows.map(r => {
    const pct = (r.sales / max) * 100;
    return `
      <div>
        <div class="flex justify-between items-center mb-1">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-sd truncate">${r.name}</p>
            <p class="text-[10px] text-gray-400">${r.count} ventas · ${fmt(r.profit)} utilidad</p>
          </div>
          <div class="text-right ml-3">
            <p class="text-sm font-bold text-sl">${fmt(r.sales)}</p>
            <p class="text-[10px] text-orange-500">${fmt(r.commission)} comisión</p>
          </div>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-2">
          <div class="h-2 rounded-full bg-gradient-to-r from-sl to-blue-400 transition-all" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderReportTopSellers(filtered) {
  const el = $('rep-top-sellers');
  const bySeller = {};
  filtered.forEach(s => {
    const key = s.sellerUid || s.sellerEmail || 'unknown';
    if (!bySeller[key]) bySeller[key] = { name: s.sellerName || s.sellerEmail || '—', email: s.sellerEmail || '', sales:0, count:0, commission:0 };
    bySeller[key].sales += Number(s.total || 0);
    bySeller[key].count += 1;
    bySeller[key].commission += Number(s.sellerCommissionAmount || 0);
  });

  const list = Object.values(bySeller).sort((a,b) => b.sales - a.sales).slice(0, 10);
  if (!list.length) { el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Sin vendedores con ventas</p>'; return; }

  const max = list[0].sales || 1;
  el.innerHTML = list.map((v, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `
      <div class="flex items-center gap-3">
        <span class="w-8 h-8 rounded-full ${i<3?'bg-yellow-50':'bg-gray-100'} flex items-center justify-center text-sm font-bold">${medal}</span>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-baseline mb-1">
            <p class="text-xs font-semibold text-sd truncate">${v.name}</p>
            <p class="text-xs font-bold text-sl ml-2">${fmt(v.sales)}</p>
          </div>
          <div class="w-full bg-gray-100 rounded-full h-1.5">
            <div class="h-1.5 rounded-full bg-sl" style="width:${(v.sales/max)*100}%"></div>
          </div>
          <div class="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>${v.count} ventas</span>
            <span class="text-orange-500">${fmt(v.commission)} comisión</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ============================================================
   🆕 BLOQUE: Top clientes
============================================================ */
function renderReportTopCustomers(filtered) {
  const el = $('rep-top-customers');
  const empty = $('rep-customers-empty');
  const totalEl = $('rep-customers-total');
  if (!el) return;

  // Agrupar por cliente (por teléfono normalizado o nombre)
  const byCustomer = {};
  filtered.forEach(s => {
    const rawPhone = s.customer?.phone || '';
    const phone = String(rawPhone).replace(/\D/g, '');
    const key = phone || s.customer?.name || 'sin-cliente';
    if (!byCustomer[key]) {
      byCustomer[key] = {
        name: s.customer?.name || 'Sin nombre',
        phone: s.customer?.phone || '',
        count: 0,
        total: 0,
        firstPurchase: null,
        lastPurchase: null
      };
    }
    const base = (s.commissionBase !== undefined)
      ? Number(s.commissionBase)
      : (Number(s.subtotal || 0) - Number(s.discount || 0));
    byCustomer[key].count += 1;
    byCustomer[key].total += base;

    if (s.createdAt?.seconds) {
      const t = s.createdAt.seconds;
      if (!byCustomer[key].firstPurchase || t < byCustomer[key].firstPurchase) byCustomer[key].firstPurchase = t;
      if (!byCustomer[key].lastPurchase || t > byCustomer[key].lastPurchase) byCustomer[key].lastPurchase = t;
    }
  });

  const list = Object.values(byCustomer).sort((a, b) => b.total - a.total);

  if (totalEl) totalEl.innerText = list.length.toLocaleString('es-CO');

  if (!list.length) {
    el.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const top20 = list.slice(0, 20);
  const maxTotal = top20[0]?.total || 1;
  const grandTotal = list.reduce((s, c) => s + c.total, 0);

  el.innerHTML = top20.map((c, i) => {
    const pct = (c.total / maxTotal) * 100;
    const sharePct = grandTotal > 0 ? (c.total / grandTotal) * 100 : 0;
    const avg = c.count > 0 ? c.total / c.count : 0;
    const lastLabel = c.lastPurchase
      ? new Date(c.lastPurchase * 1000).toLocaleDateString('es-CO')
      : '—';

    return `
      <div>
        <div class="flex justify-between items-baseline mb-1 flex-wrap gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-sd truncate">
              ${i + 1}. ${escapeHtml(c.name)}
            </p>
            <p class="text-[10px] text-gray-400">
              ${escapeHtml(c.phone) || 'sin teléfono'} · Última compra: ${lastLabel} · Ticket prom.: ${fmt(avg)}
            </p>
          </div>
          <div class="text-right">
            <p class="text-sm font-bold text-sl">${fmt(c.total)}</p>
            <p class="text-[10px] text-gray-400">${c.count} compra${c.count !== 1 ? 's' : ''} · ${sharePct.toFixed(1)}% del total</p>
          </div>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-2">
          <div class="h-2 rounded-full bg-gradient-to-r from-sl to-blue-400" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderReportTopProducts(filtered) {
  const el = $('rep-top-products');
  const byProduct = {};
  filtered.forEach(s => {
    (s.items || []).forEach(it => {
      const key = it.productId || it.sku || it.name;
      if (!byProduct[key]) byProduct[key] = { name: it.name, sku: it.sku, units: 0, sales: 0 };
      byProduct[key].units += Number(it.qty || 0);
      byProduct[key].sales += Number(it.qty || 0) * Number(it.unitPrice || 0);
    });
  });

  const list = Object.values(byProduct).sort((a,b) => b.sales - a.sales).slice(0, 10);
  if (!list.length) { el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Sin productos vendidos</p>'; return; }

  const max = list[0].sales || 1;
  el.innerHTML = list.map((p, i) => `
    <div>
      <div class="flex justify-between items-baseline mb-1">
        <p class="text-xs font-semibold text-sd truncate flex-1 min-w-0">${i+1}. ${p.name}</p>
        <p class="text-xs font-bold text-sl ml-2 whitespace-nowrap">${fmt(p.sales)}</p>
      </div>
      <div class="w-full bg-gray-100 rounded-full h-1.5">
        <div class="h-1.5 rounded-full bg-gradient-to-r from-green-400 to-green-600" style="width:${(p.sales/max)*100}%"></div>
      </div>
      <p class="text-[10px] text-gray-400 mt-0.5">${p.units} unidades · SKU: ${p.sku || '-'}</p>
    </div>
  `).join('');
}

function renderReportByCategory(filtered) {
  const el = $('rep-by-category');
  const byCat = {};
  filtered.forEach(s => {
    (s.items || []).forEach(it => {
      const prod = products.find(p => p.id === it.productId);
      const cat = prod?.categoryGroupName || 'Sin categoría';
      if (!byCat[cat]) byCat[cat] = { sales: 0, units: 0, count: 0 };
      byCat[cat].sales += Number(it.qty || 0) * Number(it.unitPrice || 0);
      byCat[cat].units += Number(it.qty || 0);
      byCat[cat].count += 1;
    });
  });

  const list = Object.entries(byCat).sort((a,b) => b[1].sales - a[1].sales);
  if (!list.length) { el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Sin datos</p>'; return; }

  const total = list.reduce((s, [,v]) => s + v.sales, 0);
  const max = list[0][1].sales || 1;

  el.innerHTML = list.map(([name, v]) => {
    const pct = (v.sales / total) * 100;
    return `
      <div>
        <div class="flex justify-between items-baseline mb-1">
          <p class="text-xs font-semibold text-sd">${name}</p>
          <p class="text-xs font-bold text-sl">${fmt(v.sales)} <span class="text-gray-400 font-normal">(${pct.toFixed(1)}%)</span></p>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-2">
          <div class="h-2 rounded-full bg-gradient-to-r from-orange-400 to-red-500" style="width:${(v.sales/max)*100}%"></div>
        </div>
        <p class="text-[10px] text-gray-400 mt-0.5">${v.units} unidades · ${v.count} líneas</p>
      </div>
    `;
  }).join('');
}

/* ============================================================
   🆕 BLOQUE: Rentabilidad
============================================================ */
function renderReportProfitability(filtered) {
  const kpis = computePeriodKPIs(filtered);

  // Comisiones financieras (crédito)
  let financialCommissions = 0;
  let financialCount = 0;
  filtered.forEach(s => {
    const cc = Number(s.creditCommissionAmount || 0);
    if (cc > 0) { financialCommissions += cc; financialCount++; }
  });

  const grossProfit = kpis.sales - kpis.cost;
  const netProfit = grossProfit - financialCommissions;
  const grossMargin = kpis.sales > 0 ? (grossProfit / kpis.sales) * 100 : 0;
  const netMargin = kpis.sales > 0 ? (netProfit / kpis.sales) * 100 : 0;
  const cogsPct = kpis.sales > 0 ? (kpis.cost / kpis.sales) * 100 : 0;

  const setTxt = (id, v) => { const el = $(id); if (el) el.innerText = v; };
  setTxt('rep-profit-sales', fmt(kpis.sales));
  setTxt('rep-profit-sales-count', `${kpis.count} venta${kpis.count !== 1 ? 's' : ''}`);
  setTxt('rep-profit-cogs', fmt(kpis.cost));
  setTxt('rep-profit-cogs-pct', `${cogsPct.toFixed(1)}% de ventas`);
  setTxt('rep-profit-gross', fmt(grossProfit));
  setTxt('rep-profit-gross-margin', `Margen ${grossMargin.toFixed(1)}%`);
  setTxt('rep-profit-financial', fmt(financialCommissions));
  setTxt('rep-profit-financial-count', `${financialCount} venta${financialCount !== 1 ? 's' : ''} con crédito`);
  setTxt('rep-profit-net', fmt(netProfit));
  setTxt('rep-profit-net-margin', `Margen ${netMargin.toFixed(1)}%`);

  // Color dinámico en utilidad neta
  const netEl = $('rep-profit-net');
  if (netEl) netEl.className = netProfit >= 0
    ? 'text-lg font-bold text-purple-700 mt-1'
    : 'text-lg font-bold text-red-600 mt-1';
}

/* ============================================================
   🆕 BLOQUE: Impuestos y recargos
============================================================ */
function renderReportTaxes(filtered) {
  let shipping = 0, shippingCount = 0;
  let surcharge = 0, surchargeCount = 0;
  let discount = 0, discountCount = 0;
  let iva = 0;

  filtered.forEach(s => {
    const sh = Number(s.shipping || 0);
    if (sh > 0) { shipping += sh; shippingCount++; }

    const su = Number(s.surchargeAmount || 0);
    if (su > 0) { surcharge += su; surchargeCount++; }

    const d = Number(s.discount || 0);
    if (d > 0) { discount += d; discountCount++; }

    // IVA aproximado (si la venta tiene items con taxRate)
    (s.items || []).forEach(it => {
      const taxRate = Number(it.taxRate || 0);
      if (taxRate > 0) {
        iva += Number(it.unitPrice || 0) * Number(it.qty || 0) * taxRate;
      }
    });
  });

  const setTxt = (id, v) => { const el = $(id); if (el) el.innerText = v; };
  setTxt('rep-tax-shipping', fmt(shipping));
  setTxt('rep-tax-shipping-count', `${shippingCount} venta${shippingCount !== 1 ? 's' : ''} con envío`);
  setTxt('rep-tax-surcharge', fmt(surcharge));
  setTxt('rep-tax-surcharge-count', `${surchargeCount} venta${surchargeCount !== 1 ? 's' : ''} con recargo`);
  setTxt('rep-tax-discount', fmt(discount));
  setTxt('rep-tax-discount-count', `${discountCount} venta${discountCount !== 1 ? 's' : ''} con descuento`);
  setTxt('rep-tax-iva', fmt(iva));
}

function renderReportDetail(filtered) {
  const tbody = $('rep-tbody');
  const empty = $('rep-empty');
  $('rep-detail-count').innerText = `${filtered.length} ventas`;

  if (!filtered.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const sorted = filtered.slice().sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 500);
  tbody.innerHTML = sorted.map(s => {
    const store = stores.find(x => x.storeId === s.storeId);
    // Separar pool y bonus con tolerancia a ventas antiguas
    const pool = Number(s.poolAmount || s.commissionAmount || 0);
    const bonus = Number(s.bonusAmount || 0);
    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${fmtDate(s.createdAt)}</td>
      <td class="p-3 text-xs">${escapeHtml(store?.name) || s.storeId || '-'}</td>
      <td class="p-3 text-xs">${escapeHtml(s.sellerName) || s.sellerEmail || '-'}</td>
      <td class="p-3 text-xs">${escapeHtml(s.customer?.name) || '-'}<br><span class="text-[10px] text-gray-400">${s.customer?.phone || ''}</span></td>
      <td class="p-3 text-right text-xs font-semibold">${fmt((s.commissionBase !== undefined) ? s.commissionBase : (Number(s.subtotal||0) - Number(s.discount||0)))}</td>
            <td class="p-3 text-right text-xs text-gray-500">${fmt(
        Number(s.totalCost) > 0
          ? Number(s.totalCost)
          : (s.items || []).reduce((sum, it) => sum + Number(it.unitCost || 0) * Number(it.qty || 0), 0)
      )}</td>
            <td class="p-3 text-right text-xs text-green-600 font-semibold">${fmt(
        Number(s.profit) > 0
          ? Number(s.profit)
          : ((Number(s.commissionBase) || (Number(s.subtotal||0) - Number(s.discount||0))) - (s.items || []).reduce((sum, it) => sum + Number(it.unitCost || 0) * Number(it.qty || 0), 0))
      )}</td>
      <td class="p-3 text-right text-xs text-sl font-semibold">${fmt(pool)}</td>
      <td class="p-3 text-right text-xs text-green-600 font-semibold">${fmt(bonus)}</td>
      <td class="p-3 text-right"><button onclick='viewSale("${s.id}")' class="text-sl hover:underline text-xs">Ver</button></td>
    </tr>`;
  }).join('');
}

/* Helper: limpiar emojis de un texto para el PDF (jsPDF no los soporta) */
function stripEmojis(text) {
  if (!text) return '';
  // Eliminar emojis y símbolos unicode que jsPDF no soporta
  return String(text)
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')      // emojis principales
    .replace(/[\u{2600}-\u{27BF}]/gu, '')        // símbolos varios
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')      // mahjong/dominó
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')        // variation selectors
    .replace(/[\u{200D}]/gu, '')                 // zero-width joiner
    .replace(/\s+/g, ' ')                        // espacios múltiples
    .trim();
}

/* ============================================================
   EXPORTAR REPORTES A EXCEL — con formato profesional
============================================================ */
window.exportReportsExcel = async () => {
  // 🆕 Cargar ExcelJS bajo demanda si aún no está
  if (!window.ExcelJS) {
    try {
      await loadLazyLibs('exceljs');
    } catch (e) {
      alert('⚠️ No se pudo cargar la librería de Excel. Verifica tu conexión.\n\n' + e.message);
      return;
    }
  }

  const filtered = getFilteredSales();
  if (!filtered.length) {
    alert('No hay ventas para exportar con estos filtros.');
    return;
  }

  const V = reportVisibility || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smartec';
  wb.created = new Date();

  const fechaGen = new Date().toLocaleString('es-CO');
  const periodo = `${reportFilters.dateFrom || 'todo'} — ${reportFilters.dateTo || 'hoy'}`;

  // ============================================================
  // COLORES POR SECCIÓN (para encabezados)
  // ============================================================
  const COLORS = {
    portada:       'FF0A2A4A',
    resumen:       'FF0A2A4A',
    comparativa:   'FF4A7A9A',
    rentabilidad:  'FF16A34A',
    impuestos:     'FFEA580C',
    metodo:        'FF2563EB',
    conciliacion:  'FF7C3AED',
    pendientes:    'FFD97706',
    tienda:        'FF0891B2',
    vendedores:    'FFCA8A04',
    productos:     'FF65A30D',
    categoria:     'FFDB2777',
    clientes:      'FF4F46E5',
    detalle:       'FF334155'
  };

  // Colores de texto/fondo reutilizables
  const MONEDA_FONT   = { color: { argb: 'FF166534' }, bold: true };
  const CANTIDAD_FONT = { color: { argb: 'FF1E40AF' } };
  const PORC_FONT     = { color: { argb: 'FF7C3AED' }, bold: true };
  const ZEBRA_BG      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
  const TOTAL_BG      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

  // ============================================================
  // Helpers de estilo
  // ============================================================
  const styleHeaderRow = (row, color = 'FF0A2A4A') => {
    row.height = 24;
    row.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top:    { style: 'thin', color: { argb: color } },
        bottom: { style: 'thin', color: { argb: color } },
        left:   { style: 'thin', color: { argb: color } },
        right:  { style: 'thin', color: { argb: color } }
      };
    });
  };

  const styleDataRow = (row, opts = {}) => {
    const { zebra = false, wrapCols = [], total = false } = opts;
    row.eachCell((cell, idx) => {
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left:   { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right:  { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      cell.alignment = { vertical: 'middle', wrapText: wrapCols.includes(idx) };
      if (total) {
        cell.fill = TOTAL_BG;
        cell.font = { ...(cell.font || {}), bold: true };
      } else if (zebra) {
        cell.fill = ZEBRA_BG;
      }
    });
  };

  const styleMetaRow = (row) => {
    row.getCell(1).font = { bold: true, color: { argb: 'FF0A2A4A' } };
    row.getCell(2).font = { color: { argb: 'FF111827' } };
    row.getCell(1).alignment = { vertical: 'middle' };
    row.getCell(2).alignment = { vertical: 'middle' };
  };

  // Aplica formato de moneda, cantidad o porcentaje a una columna específica
  const applyNumberFormat = (row, colIdx, type) => {
    const cell = row.getCell(colIdx);
    if (type === 'moneda') {
      cell.numFmt = '"$"#,##0';
      cell.font = MONEDA_FONT;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else if (type === 'cantidad') {
      cell.numFmt = '#,##0';
      cell.font = CANTIDAD_FONT;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    } else if (type === 'porcentaje') {
      cell.numFmt = '0.0"%"';
      cell.font = PORC_FONT;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  };

  const addTitleRow = (ws, title, color, colSpan = 6) => {
    const r = ws.addRow([title]);
    ws.mergeCells(r.number, 1, r.number, colSpan);
    const cell = r.getCell(1);
    cell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    r.height = 28;
    return r;
  };

  const freezeHeader = (ws, rowNumber) => {
    ws.views = [{ state: 'frozen', ySplit: rowNumber }];
  };

  // ============================================================
  // HOJA: PORTADA
  // ============================================================
  {
    const ws = wb.addWorksheet('Portada', { properties: { defaultRowHeight: 18 } });
    ws.mergeCells('A1:B1');
    const t = ws.getCell('A1');
    t.value = 'SMARTEC · Reporte consolidado';
    t.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.portada } };
    t.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 40;

    ws.addRow([]);
    const meta = [
      ['Generado', fechaGen],
      ['Período', periodo],
      ['Tienda', reportFilters.storeId === 'all' ? 'Todas' : (stores.find(s => s.storeId === reportFilters.storeId)?.name || reportFilters.storeId)],
      ['Vendedor', reportFilters.sellerUid === 'all' ? 'Todos' : (users.find(u => u.id === reportFilters.sellerUid)?.name || reportFilters.sellerUid)],
      ['Total ventas', filtered.length],
      ['Hojas incluidas', Object.keys(V).filter(k => V[k]).join(', ') || 'solo resumen']
    ];
    meta.forEach(([label, val]) => {
      const r = ws.addRow([label, val]);
      r.height = 22;
      r.getCell(1).font = { bold: true, color: { argb: 'FF0A2A4A' }, size: 11 };
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      r.getCell(2).font = { color: { argb: 'FF111827' }, size: 11 };
      r.getCell(2).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      r.eachCell(c => {
        c.border = {
          top:    { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left:   { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right:  { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
      });
    });

    ws.getColumn(1).width = 26;
    ws.getColumn(2).width = 70;
  }

  // ============================================================
  // HOJA: RESUMEN EJECUTIVO
  // ============================================================
  {
    const ws = wb.addWorksheet('Resumen ejecutivo');
    ws.columns = [
      { width: 32 },
      { width: 28 }
    ];

    addTitleRow(ws, 'RESUMEN EJECUTIVO', COLORS.resumen, 2);
    ws.addRow([]);

    const hRow = ws.addRow(['Métrica', 'Valor']);
    styleHeaderRow(hRow, COLORS.resumen);

    const totalSales = filtered.reduce((s, x) => {
      const sub = Number(x.subtotal || 0);
      const disc = Number(x.discount || 0);
      return s + ((x.commissionBase !== undefined) ? Number(x.commissionBase) : (sub - disc));
    }, 0);
    const totalCost = filtered.reduce((sum, s) => {
      if (Number(s.totalCost || 0) > 0) return sum + Number(s.totalCost);
      return sum + (s.items || []).reduce((itSum, it) => itSum + (Number(it.unitCost || 0) * Number(it.qty || 0)), 0);
    }, 0);
    const totalProfit = totalSales - totalCost;
    const totalPool = filtered.reduce((s, x) => s + Number(x.poolAmount || x.commissionAmount || 0), 0);
    const totalBonus = filtered.reduce((s, x) => s + Number(x.bonusAmount || 0), 0);
    const totalCommission = totalPool + totalBonus;

    const data = [
      ['Total vendido',    totalSales,      'moneda'],
      ['Costo total',      totalCost,       'moneda'],
      ['Utilidad bruta',   totalProfit,     'moneda'],
      ['Pool tienda',      totalPool,       'moneda'],
      ['Bonus metas',      totalBonus,      'moneda'],
      ['Comisiones totales', totalCommission, 'moneda'],
      ['Transacciones',    filtered.length, 'cantidad'],
      ['Ticket promedio',  filtered.length > 0 ? totalSales / filtered.length : 0, 'moneda']
    ];

    data.forEach(([label, value, type], i) => {
      const row = ws.addRow([label, value]);
      styleDataRow(row, { zebra: i % 2 === 0 });
      row.getCell(1).font = { bold: true, color: { argb: 'FF0A2A4A' } };
      applyNumberFormat(row, 2, type);
    });

    // Fila TOTAL destacada
    const totalRow = ws.addRow(['Utilidad neta (ventas − costo)', totalProfit]);
    styleDataRow(totalRow, { total: true });
    applyNumberFormat(totalRow, 2, 'moneda');

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: COMPARATIVA CON PERÍODO ANTERIOR
  // ============================================================
  if (V.comparison && reportFilters.dateFrom && reportFilters.dateTo) {
    const ws = wb.addWorksheet('Comparativa período');
    ws.columns = [
      { width: 28 }, { width: 20 }, { width: 20 }, { width: 15 }
    ];

    addTitleRow(ws, 'COMPARATIVA CON PERÍODO ANTERIOR', COLORS.comparativa, 4);
    ws.addRow([]);
    const hRow = ws.addRow(['Métrica', 'Actual', 'Anterior', 'Cambio %']);
    styleHeaderRow(hRow, COLORS.comparativa);

    const fromDate = new Date(reportFilters.dateFrom + 'T00:00:00');
    const toDate = new Date(reportFilters.dateTo + 'T23:59:59');
    const diffDays = Math.max(1, Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)));
    const prevTo = new Date(fromDate); prevTo.setDate(prevTo.getDate() - 1); prevTo.setHours(23,59,59);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - diffDays + 1); prevFrom.setHours(0,0,0);

    let prevSales = sales.filter(s => s.status !== 'anulada' && s.createdAt?.seconds);
    prevSales = prevSales.filter(s => {
      const d = new Date(s.createdAt.seconds * 1000);
      return d >= prevFrom && d <= prevTo;
    });
    if (reportFilters.storeId !== 'all') prevSales = prevSales.filter(s => s.storeId === reportFilters.storeId);
    if (reportFilters.sellerUid !== 'all') prevSales = prevSales.filter(s => s.sellerUid === reportFilters.sellerUid);

    const prev = computePeriodKPIs(prevSales);
    const curr = computePeriodKPIs(filtered);

    const calcPct = (c, p) => (p === 0 ? (c === 0 ? 0 : 100) : ((c - p) / p) * 100);

    const rows = [
      ['Ventas netas',       curr.sales,      prev.sales,      'moneda'],
      ['Transacciones',      curr.count,      prev.count,      'cantidad'],
      ['Ticket promedio',    Math.round(curr.ticket), Math.round(prev.ticket), 'moneda'],
      ['Unidades vendidas',  curr.units,      prev.units,      'cantidad'],
      ['Utilidad bruta',     curr.profit,     prev.profit,     'moneda'],
      ['Comisiones',         curr.commission, prev.commission, 'moneda']
    ];

    rows.forEach(([label, c, p, type], i) => {
      const row = ws.addRow([label, c, p, calcPct(c, p) / 100]);
      styleDataRow(row, { zebra: i % 2 === 0 });
      row.getCell(1).font = { bold: true, color: { argb: 'FF0A2A4A' } };
      applyNumberFormat(row, 2, type);
      applyNumberFormat(row, 3, type);
      // Columna cambio como % con color según signo
      const chg = row.getCell(4);
      chg.numFmt = '+0.0%;-0.0%;0.0%';
      chg.alignment = { vertical: 'middle', horizontal: 'center' };
      const pct = calcPct(c, p);
      chg.font = { bold: true, color: { argb: pct > 0 ? 'FF166534' : (pct < 0 ? 'FF991B1B' : 'FF6B7280') } };
    });

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: RENTABILIDAD
  // ============================================================
  if (V.profitability) {
    const ws = wb.addWorksheet('Rentabilidad');
    ws.columns = [{ width: 38 }, { width: 28 }];

    addTitleRow(ws, 'RENTABILIDAD DEL PERÍODO', COLORS.rentabilidad, 2);
    ws.addRow([]);
    const hRow = ws.addRow(['Concepto', 'Valor']);
    styleHeaderRow(hRow, COLORS.rentabilidad);

    const kpis = computePeriodKPIs(filtered);
    let financialCommissions = 0;
    filtered.forEach(s => { financialCommissions += Number(s.creditCommissionAmount || 0); });
    const grossProfit = kpis.sales - kpis.cost;
    const netProfit = grossProfit - financialCommissions;
    const grossMargin = kpis.sales > 0 ? (grossProfit / kpis.sales) * 100 : 0;
    const netMargin = kpis.sales > 0 ? (netProfit / kpis.sales) * 100 : 0;

    const rows = [
      ['Ventas',                    kpis.sales,             false],
      ['− Costo mercancía',        -kpis.cost,              false],
      ['= Utilidad bruta',          grossProfit,            true],
      ['   Margen bruto',           grossMargin,            'pct'],
      ['− Comisiones financieras', -financialCommissions,   false],
      ['= Utilidad neta',           netProfit,              true],
      ['   Margen neto',            netMargin,              'pct']
    ];

    rows.forEach(([label, value, kind], i) => {
      const row = ws.addRow([label, value]);
      const isTotal = kind === true;
      styleDataRow(row, { zebra: i % 2 === 0, total: isTotal });
      row.getCell(1).font = { bold: isTotal, color: { argb: isTotal ? 'FF166534' : 'FF0A2A4A' } };
      if (kind === 'pct') {
        row.getCell(2).numFmt = '0.0"%"';
        row.getCell(2).font = { bold: true, color: { argb: 'FF7C3AED' } };
        row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        applyNumberFormat(row, 2, 'moneda');
      }
    });

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: IMPUESTOS Y RECARGOS
  // ============================================================
  if (V.taxes) {
    const ws = wb.addWorksheet('Impuestos y recargos');
    ws.columns = [{ width: 35 }, { width: 15 }, { width: 24 }];

    addTitleRow(ws, 'IMPUESTOS, RECARGOS Y ENVÍOS', COLORS.impuestos, 3);
    ws.addRow([]);
    const hRow = ws.addRow(['Concepto', 'Ventas', 'Total']);
    styleHeaderRow(hRow, COLORS.impuestos);

    let shipping=0, shippingCount=0, surcharge=0, surchargeCount=0, discount=0, discountCount=0, iva=0;
    filtered.forEach(s => {
      if (Number(s.shipping || 0) > 0) { shipping += Number(s.shipping); shippingCount++; }
      if (Number(s.surchargeAmount || 0) > 0) { surcharge += Number(s.surchargeAmount); surchargeCount++; }
      if (Number(s.discount || 0) > 0) { discount += Number(s.discount); discountCount++; }
      (s.items || []).forEach(it => {
        const tr = Number(it.taxRate || 0);
        if (tr > 0) iva += Number(it.unitPrice || 0) * Number(it.qty || 0) * tr;
      });
    });

    const rows = [
      ['Envíos cobrados',      shippingCount,  shipping],
      ['Recargos tarjeta',     surchargeCount, surcharge],
      ['Descuentos otorgados', discountCount,  discount],
      ['IVA cobrado',          '—',            iva]
    ];

    rows.forEach(([label, cant, total], i) => {
      const row = ws.addRow([label, cant, total]);
      styleDataRow(row, { zebra: i % 2 === 0 });
      row.getCell(1).font = { bold: true, color: { argb: 'FF0A2A4A' } };
      if (typeof cant === 'number') applyNumberFormat(row, 2, 'cantidad');
      applyNumberFormat(row, 3, 'moneda');
    });

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: DESGLOSE POR MÉTODO DE PAGO
  // ============================================================
  if (V.byMethod) {
    const ws = wb.addWorksheet('Por método pago');
    ws.columns = [{ width: 26 }, { width: 14 }, { width: 24 }, { width: 12 }];

    addTitleRow(ws, 'DESGLOSE POR MÉTODO DE PAGO', COLORS.metodo, 4);
    ws.addRow([]);
    const hRow = ws.addRow(['Método', 'Ventas', 'Total', '%']);
    styleHeaderRow(hRow, COLORS.metodo);

    const byMethod = {};
    filtered.forEach(s => {
      const m = s.paymentMethod || 'efectivo';
      const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
      if (!byMethod[m]) byMethod[m] = { total: 0, count: 0 };
      byMethod[m].total += base;
      byMethod[m].count += 1;
    });
    const labels = { efectivo:'💵 Efectivo', transferencia:'🔄 Transferencia', tarjeta:'💳 Tarjeta', contraentrega:'📦 Contra entrega', credito:'🛍️ Crédito', nequi:'📱 Nequi' };
    const totalGen = Object.values(byMethod).reduce((s, m) => s + m.total, 0);

    Object.entries(byMethod).sort((a,b) => b[1].total - a[1].total).forEach(([k,v], i) => {
      const row = ws.addRow([labels[k] || k, v.count, v.total, totalGen > 0 ? v.total / totalGen : 0]);
      styleDataRow(row, { zebra: i % 2 === 0 });
      row.getCell(1).font = { bold: true, color: { argb: 'FF0A2A4A' } };
      applyNumberFormat(row, 2, 'cantidad');
      applyNumberFormat(row, 3, 'moneda');
      const pct = row.getCell(4);
      pct.numFmt = '0.0%';
      pct.font = PORC_FONT;
      pct.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Fila total
    const totalRow = ws.addRow(['TOTAL', Object.values(byMethod).reduce((s,m)=>s+m.count,0), totalGen, 1]);
    styleDataRow(totalRow, { total: true });
    applyNumberFormat(totalRow, 2, 'cantidad');
    applyNumberFormat(totalRow, 3, 'moneda');
    totalRow.getCell(4).numFmt = '0.0%';
    totalRow.getCell(4).font = PORC_FONT;
    totalRow.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: CONCILIACIÓN POR CUENTA
  // ============================================================
  if (V.reconciliation) {
    const ws = wb.addWorksheet('Conciliación');
    ws.columns = [{ width: 38 }, { width: 24 }, { width: 12 }, { width: 24 }];

    addTitleRow(ws, 'CONCILIACIÓN POR CUENTA', COLORS.conciliacion, 4);
    ws.addRow([]);
    const hRow = ws.addRow(['Cuenta / Canal', 'Nº cuenta', 'Ventas', 'Total']);
    styleHeaderRow(hRow, COLORS.conciliacion);

    const groups = {};
    filtered.forEach(s => {
      const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
      const ps = s.paymentStatus || 'completed';
      let key, data;
      if (ps === 'pending') { key='pending'; data={bank:'⏳ Por cobrar',name:'Contra entrega pendiente',account:''}; }
      else {
        const fm = s.finalPaymentMethod || s.paymentMethod;
        if (fm === 'efectivo') { key='efectivo'; data={bank:'💵 Efectivo',name:'Caja física',account:''}; }
        else if (fm === 'tarjeta') { key='tarjeta'; data={bank:'💳 Tarjeta',name:'Datáfono',account:''}; }
        else if (fm === 'transferencia' || fm === 'credito') {
          const cid = s.finalPaymentChannelId || s.paymentChannelId;
          if (cid) { key=cid; data={ bank:s.finalPaymentChannelBank||s.paymentChannelBank||'🏦', name:s.finalPaymentChannelName||s.paymentChannelName||'', account:s.finalPaymentChannelAccount||s.paymentChannelAccount||'' }; }
          else { key='transferencia_gen'; data={bank:'🔄 Transferencia',name:'Sin especificar',account:''}; }
        } else { key='otros'; data={bank:'● Otros',name:'',account:''}; }
      }
      if (!groups[key]) groups[key] = { ...data, total:0, count:0 };
      groups[key].total += base;
      groups[key].count += 1;
    });

    Object.values(groups).sort((a,b) => b.total - a.total).forEach((g, i) => {
      const row = ws.addRow([
        `${g.bank}${g.name ? ' — ' + g.name : ''}`,
        g.account || '-',
        g.count,
        g.total
      ]);
      styleDataRow(row, { zebra: i % 2 === 0 });
      row.getCell(1).font = { bold: true, color: { argb: 'FF0A2A4A' } };
      row.getCell(2).font = { family: 3, color: { argb: 'FF6B7280' } };
      applyNumberFormat(row, 3, 'cantidad');
      applyNumberFormat(row, 4, 'moneda');
    });

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: COBROS PENDIENTES
  // ============================================================
  if (V.pending) {
    const pending = filtered.filter(s => (s.paymentStatus || 'completed') === 'pending');
    if (pending.length) {
      const ws = wb.addWorksheet('Cobros pendientes');
      ws.columns = [
        { width: 14 }, { width: 26 }, { width: 18 },
        { width: 22 }, { width: 22 }, { width: 20 }
      ];

      addTitleRow(ws, `COBROS PENDIENTES (${pending.length})`, COLORS.pendientes, 6);
      ws.addRow([]);
      const hRow = ws.addRow(['Fecha', 'Cliente', 'Teléfono', 'Tienda', 'Vendedor', 'Monto']);
      styleHeaderRow(hRow, COLORS.pendientes);

      pending.sort((a,b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)).forEach((s, i) => {
        const store = stores.find(x => x.storeId === s.storeId);
        const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
        const date = s.createdAt?.seconds ? new Date(s.createdAt.seconds*1000).toLocaleDateString('es-CO') : '-';
        const row = ws.addRow([date, s.customer?.name||'', s.customer?.phone||'', store?.name||s.storeId, s.sellerName||s.sellerEmail||'', base]);
        styleDataRow(row, { zebra: i % 2 === 0 });
        applyNumberFormat(row, 6, 'moneda');
      });

      // Fila total
      const total = pending.reduce((sum, s) => {
        const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
        return sum + base;
      }, 0);
      const totalRow = ws.addRow(['', '', '', '', 'TOTAL', total]);
      styleDataRow(totalRow, { total: true });
      applyNumberFormat(totalRow, 6, 'moneda');

      freezeHeader(ws, 3);
    }
  }

  // ============================================================
  // HOJA: COMPARATIVA POR TIENDA
  // ============================================================
  if (V.byStore) {
    const ws = wb.addWorksheet('Por tienda');
    ws.columns = [{ width: 30 }, { width: 12 }, { width: 24 }, { width: 24 }, { width: 24 }];

    addTitleRow(ws, 'COMPARATIVA POR TIENDA', COLORS.tienda, 5);
    ws.addRow([]);
    const hRow = ws.addRow(['Tienda', 'Ventas', 'Total', 'Utilidad', 'Comisión']);
    styleHeaderRow(hRow, COLORS.tienda);

    const byStore = {};
    filtered.forEach(s => {
      if (!byStore[s.storeId]) byStore[s.storeId] = { sales:0, count:0, commission:0, profit:0 };
      byStore[s.storeId].sales += Number(s.total || 0);
      byStore[s.storeId].count += 1;
      byStore[s.storeId].commission += Number(s.sellerCommissionAmount || 0);
      byStore[s.storeId].profit += Number(s.profit || 0);
    });

    const sorted = Object.entries(byStore).sort((a,b) => b[1].sales - a[1].sales);
    sorted.forEach(([sid, v], i) => {
      const st = stores.find(s => s.storeId === sid);
      const row = ws.addRow([st?.name || sid, v.count, v.sales, v.profit, v.commission]);
      styleDataRow(row, { zebra: i % 2 === 0 });
      row.getCell(1).font = { bold: true, color: { argb: 'FF0A2A4A' } };
      applyNumberFormat(row, 2, 'cantidad');
      applyNumberFormat(row, 3, 'moneda');
      applyNumberFormat(row, 4, 'moneda');
      applyNumberFormat(row, 5, 'moneda');
    });

    // Total general
    const totSales = sorted.reduce((s, [,v]) => s + v.sales, 0);
    const totProfit = sorted.reduce((s, [,v]) => s + v.profit, 0);
    const totComm = sorted.reduce((s, [,v]) => s + v.commission, 0);
    const totCount = sorted.reduce((s, [,v]) => s + v.count, 0);
    const totalRow = ws.addRow(['TOTAL', totCount, totSales, totProfit, totComm]);
    styleDataRow(totalRow, { total: true });
    applyNumberFormat(totalRow, 2, 'cantidad');
    applyNumberFormat(totalRow, 3, 'moneda');
    applyNumberFormat(totalRow, 4, 'moneda');
    applyNumberFormat(totalRow, 5, 'moneda');

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: RANKING VENDEDORES
  // ============================================================
  if (V.topSellers) {
    const ws = wb.addWorksheet('Ranking vendedores');
    ws.columns = [{ width: 6 }, { width: 32 }, { width: 12 }, { width: 24 }, { width: 24 }];

    addTitleRow(ws, 'RANKING VENDEDORES', COLORS.vendedores, 5);
    ws.addRow([]);
    const hRow = ws.addRow(['#', 'Vendedor', 'Ventas', 'Total', 'Comisión']);
    styleHeaderRow(hRow, COLORS.vendedores);

    const bySeller = {};
    filtered.forEach(s => {
      const k = s.sellerUid || s.sellerEmail || 'unknown';
      if (!bySeller[k]) bySeller[k] = { name: s.sellerName || s.sellerEmail || '—', sales:0, count:0, commission:0 };
      bySeller[k].sales += Number(s.total || 0);
      bySeller[k].count += 1;
      bySeller[k].commission += Number(s.sellerCommissionAmount || 0);
    });

    Object.values(bySeller).sort((a,b) => b.sales - a.sales).forEach((v, i) => {
      const row = ws.addRow([i+1, v.name, v.count, v.sales, v.commission]);
      styleDataRow(row, { zebra: i % 2 === 0 });
      // Medallas
      const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
      row.getCell(1).font = { bold: true, color: { argb: i < 3 ? 'FFCA8A04' : 'FF6B7280' } };
      row.getCell(2).font = { bold: i < 3, color: { argb: 'FF0A2A4A' } };
      applyNumberFormat(row, 3, 'cantidad');
      applyNumberFormat(row, 4, 'moneda');
      applyNumberFormat(row, 5, 'moneda');
    });

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: TOP PRODUCTOS
  // ============================================================
  if (V.topProducts) {
    const ws = wb.addWorksheet('Top productos');
    ws.columns = [{ width: 6 }, { width: 42 }, { width: 22 }, { width: 12 }, { width: 24 }];

    addTitleRow(ws, 'TOP PRODUCTOS VENDIDOS', COLORS.productos, 5);
    ws.addRow([]);
    const hRow = ws.addRow(['#', 'Producto', 'SKU', 'Unidades', 'Total']);
    styleHeaderRow(hRow, COLORS.productos);

    const byProduct = {};
    filtered.forEach(s => {
      (s.items || []).forEach(it => {
        const k = it.productId || it.sku || it.name;
        if (!byProduct[k]) byProduct[k] = { name: it.name, sku: it.sku || '', units:0, sales:0 };
        byProduct[k].units += Number(it.qty || 0);
        byProduct[k].sales += Number(it.qty || 0) * Number(it.unitPrice || 0);
      });
    });

    Object.values(byProduct).sort((a,b) => b.sales - a.sales).forEach((p, i) => {
      const row = ws.addRow([i+1, p.name, p.sku, p.units, p.sales]);
      styleDataRow(row, { zebra: i % 2 === 0, wrapCols: [2] });
      row.getCell(1).font = { bold: true, color: { argb: 'FF6B7280' } };
      row.getCell(2).font = { bold: true, color: { argb: 'FF0A2A4A' } };
      row.getCell(3).font = { family: 3, color: { argb: 'FF6B7280' } };
      applyNumberFormat(row, 4, 'cantidad');
      applyNumberFormat(row, 5, 'moneda');
    });

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: VENTAS POR CATEGORÍA
  // ============================================================
  if (V.byCategory) {
    const ws = wb.addWorksheet('Por categoría');
    ws.columns = [{ width: 32 }, { width: 12 }, { width: 24 }, { width: 12 }];

    addTitleRow(ws, 'VENTAS POR CATEGORÍA', COLORS.categoria, 4);
    ws.addRow([]);
    const hRow = ws.addRow(['Categoría', 'Unidades', 'Total', '%']);
    styleHeaderRow(hRow, COLORS.categoria);

    const byCat = {};
    filtered.forEach(s => {
      (s.items || []).forEach(it => {
        const prod = products.find(p => p.id === it.productId);
        const cat = prod?.categoryGroupName || 'Sin categoría';
        if (!byCat[cat]) byCat[cat] = { sales:0, units:0 };
        byCat[cat].sales += Number(it.qty || 0) * Number(it.unitPrice || 0);
        byCat[cat].units += Number(it.qty || 0);
      });
    });
    const list = Object.entries(byCat).sort((a,b) => b[1].sales - a[1].sales);
    const total = list.reduce((s,[,v]) => s + v.sales, 0);

    list.forEach(([name, v], i) => {
      const row = ws.addRow([name, v.units, v.sales, total > 0 ? v.sales / total : 0]);
      styleDataRow(row, { zebra: i % 2 === 0 });
      row.getCell(1).font = { bold: true, color: { argb: 'FF0A2A4A' } };
      applyNumberFormat(row, 2, 'cantidad');
      applyNumberFormat(row, 3, 'moneda');
      const pct = row.getCell(4);
      pct.numFmt = '0.0%';
      pct.font = PORC_FONT;
      pct.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const totUnits = list.reduce((s,[,v]) => s + v.units, 0);
    const totalRow = ws.addRow(['TOTAL', totUnits, total, 1]);
    styleDataRow(totalRow, { total: true });
    applyNumberFormat(totalRow, 2, 'cantidad');
    applyNumberFormat(totalRow, 3, 'moneda');
    totalRow.getCell(4).numFmt = '0.0%';
    totalRow.getCell(4).font = PORC_FONT;
    totalRow.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: TOP CLIENTES
  // ============================================================
  if (V.topCustomers) {
    const ws = wb.addWorksheet('Top clientes');
    ws.columns = [{ width: 6 }, { width: 32 }, { width: 20 }, { width: 12 }, { width: 24 }];

    addTitleRow(ws, 'TOP CLIENTES', COLORS.clientes, 5);
    ws.addRow([]);
    const hRow = ws.addRow(['#', 'Cliente', 'Teléfono', 'Compras', 'Total']);
    styleHeaderRow(hRow, COLORS.clientes);

    const byCustomer = {};
    filtered.forEach(s => {
      const phone = String(s.customer?.phone || '').replace(/\D/g, '');
      const key = phone || s.customer?.name || 'sin-cliente';
      if (!byCustomer[key]) byCustomer[key] = { name: s.customer?.name || 'Sin nombre', phone: s.customer?.phone || '', count: 0, total: 0 };
      const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
      byCustomer[key].count += 1;
      byCustomer[key].total += base;
    });

    Object.values(byCustomer).sort((a,b) => b.total - a.total).slice(0, 50).forEach((c, i) => {
      const row = ws.addRow([i+1, c.name, c.phone || '—', c.count, c.total]);
      styleDataRow(row, { zebra: i % 2 === 0 });
      row.getCell(1).font = { bold: true, color: { argb: 'FF6B7280' } };
      row.getCell(2).font = { bold: true, color: { argb: 'FF0A2A4A' } };
      applyNumberFormat(row, 4, 'cantidad');
      applyNumberFormat(row, 5, 'moneda');
    });

    freezeHeader(ws, 3);
  }

  // ============================================================
  // HOJA: DETALLE DE VENTAS
  // ============================================================
  if (V.detail) {
    const ws = wb.addWorksheet('Detalle ventas');
    ws.columns = [
      { width: 14 }, { width: 22 }, { width: 22 }, { width: 24 },
      { width: 32 }, { width: 20 }, { width: 18 }, { width: 8 },
      { width: 15 }, { width: 15 }, { width: 15 }, { width: 12 },
      { width: 15 }, { width: 15 }, { width: 15 }, { width: 18 }
    ];

    addTitleRow(ws, 'DETALLE DE VENTAS', COLORS.detalle, 16);
    ws.addRow([]);
    const hRow = ws.addRow([
      'Fecha','Tienda','Vendedor','Cliente','Producto','SKU','Variante',
      'Und','Costo','Venta','Descuento','Envío','Rec. Tarjeta',
      'Pool','Bonus','Total venta'
    ]);
    styleHeaderRow(hRow, COLORS.detalle);

    filtered.forEach((s, sIdx) => {
      const store = stores.find(x => x.storeId === s.storeId);
      const date = s.createdAt?.seconds ? new Date(s.createdAt.seconds * 1000).toLocaleDateString('es-CO') : '-';
      const items = s.items || [];
      const subtotalVenta = items.reduce((sum, it) => sum + Number(it.qty||0) * Number(it.unitPrice||0), 0);
      const shipping = Number(s.shipping || 0);
      const surcharge = Number(s.surchargeAmount || 0);
      const discount = Number(s.discount || 0);
      const poolTotal = Number(s.poolAmount || s.commissionAmount || 0);
      const bonusTotal = Number(s.bonusAmount || 0);

      items.forEach(it => {
        const qty = Number(it.qty || 0);
        const lineTotal = qty * Number(it.unitPrice || 0);
        const lineCost = qty * Number(it.unitCost || 0);
        const ratio = subtotalVenta > 0 ? lineTotal / subtotalVenta : 0;
        const variant = [it.colorName, it.size].filter(Boolean).join(' · ') || 'Estándar';

        const row = ws.addRow([
          date,
          store?.name || s.storeId || '',
          s.sellerName || s.sellerEmail || '',
          s.customer?.name || '',
          it.name || '',
          it.sku || '',
          variant,
          qty,
          lineCost,
          lineTotal,
          discount * ratio,
          shipping * ratio,
          surcharge * ratio,
          poolTotal * ratio,
          bonusTotal * ratio,
          Number(s.total || 0)
        ]);
        styleDataRow(row, { zebra: sIdx % 2 === 1, wrapCols: [5] });
        applyNumberFormat(row, 8, 'cantidad');
        applyNumberFormat(row, 9, 'moneda');
        applyNumberFormat(row, 10, 'moneda');
        applyNumberFormat(row, 11, 'moneda');
        applyNumberFormat(row, 12, 'moneda');
        applyNumberFormat(row, 13, 'moneda');
        applyNumberFormat(row, 14, 'moneda');
        applyNumberFormat(row, 15, 'moneda');
        applyNumberFormat(row, 16, 'moneda');
      });
    });

    freezeHeader(ws, 3);
  }

  // ============================================================
  // DESCARGAR
  // ============================================================
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `smartec_reporte_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/* ============ EXPORTAR PDF (respeta la selección del personalizador) ============ */
window.exportReportsPDF = async () => {
  // 🆕 Cargar jsPDF bajo demanda si aún no está
  if (!window.jspdf) {
    try {
      await loadLazyLibs('jspdf');
    } catch (e) {
      alert('⚠️ No se pudo cargar la librería de PDF. Verifica tu conexión.\n\n' + e.message);
      return;
    }
  }

  const { jsPDF } = window.jspdf;
  const filtered = getFilteredSales();

  if (!filtered.length) {
    alert('No hay ventas para exportar con estos filtros.');
    return;
  }

  const V = reportVisibility || {};
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const MARGIN_BOTTOM = 15;

  function ensureSpace(needed) {
    if (y + needed > pageH - MARGIN_BOTTOM) { doc.addPage(); y = 20; }
  }
  let y = 15;

  // ===== Encabezado =====
  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC', 14, 13);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Reporte consolidado', pageW - 14, 13, { align: 'right' });

  y = 28;

  // ===== Info de filtros =====
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  const filterLines = [
    `Período: ${reportFilters.dateFrom || 'todo'} — ${reportFilters.dateTo || 'hoy'}`,
    `Tienda: ${reportFilters.storeId === 'all' ? 'Todas' : (stores.find(s => s.storeId === reportFilters.storeId)?.name || reportFilters.storeId)}`,
    `Vendedor: ${reportFilters.sellerUid === 'all' ? 'Todos' : (users.find(u => u.id === reportFilters.sellerUid)?.name || reportFilters.sellerUid)}`,
    `Generado: ${new Date().toLocaleString('es-CO')}`
  ];
  filterLines.forEach(line => { doc.text(line, 14, y); y += 5; });
  y += 4;

  // ============================================================
  // RESUMEN EJECUTIVO (siempre)
  // ============================================================
  const totalSales = filtered.reduce((s, x) => {
    const sub = Number(x.subtotal || 0);
    const disc = Number(x.discount || 0);
    return s + ((x.commissionBase !== undefined) ? Number(x.commissionBase) : (sub - disc));
  }, 0);
  const totalCost = filtered.reduce((sum, s) => {
    if (Number(s.totalCost || 0) > 0) return sum + Number(s.totalCost);
    return sum + (s.items || []).reduce((itSum, it) => itSum + (Number(it.unitCost || 0) * Number(it.qty || 0)), 0);
  }, 0);
  const totalProfit = totalSales - totalCost;
  const totalPoolPDF = filtered.reduce((s, x) => s + Number(x.poolAmount || x.commissionAmount || 0), 0);
  const totalBonusPDF = filtered.reduce((s, x) => s + Number(x.bonusAmount || 0), 0);
  const totalCommission = totalPoolPDF + totalBonusPDF;

  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(10, 42, 74);
  doc.text('Resumen ejecutivo', 14, y); y += 6;

  doc.autoTable({
    startY: y,
    head: [['Total vendido', 'Utilidad bruta', 'Pool tienda', 'Bonus metas', 'Comisiones', 'Transacciones']],
    body: [[
      '$' + totalSales.toLocaleString('es-CO'),
      '$' + totalProfit.toLocaleString('es-CO'),
      '$' + totalPoolPDF.toLocaleString('es-CO'),
      '$' + totalBonusPDF.toLocaleString('es-CO'),
      '$' + totalCommission.toLocaleString('es-CO'),
      String(filtered.length)
    ]],
    theme: 'grid',
    headStyles: { fillColor: [74, 122, 154], textColor: 255, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { halign: 'center', fontSize: 10 },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 10;

  // ============================================================
  // BLOQUE: Comparativa con período anterior
  // ============================================================
  if (V.comparison && reportFilters.dateFrom && reportFilters.dateTo) {
    const fromDate = new Date(reportFilters.dateFrom + 'T00:00:00');
    const toDate = new Date(reportFilters.dateTo + 'T23:59:59');
    const diffDays = Math.max(1, Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)));
    const prevTo = new Date(fromDate); prevTo.setDate(prevTo.getDate() - 1); prevTo.setHours(23,59,59);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - diffDays + 1); prevFrom.setHours(0,0,0);

    let prevSales = sales.filter(s => s.status !== 'anulada' && s.createdAt?.seconds);
    prevSales = prevSales.filter(s => {
      const d = new Date(s.createdAt.seconds * 1000);
      return d >= prevFrom && d <= prevTo;
    });
    if (reportFilters.storeId !== 'all') prevSales = prevSales.filter(s => s.storeId === reportFilters.storeId);
    if (reportFilters.sellerUid !== 'all') prevSales = prevSales.filter(s => s.sellerUid === reportFilters.sellerUid);

    const prev = computePeriodKPIs(prevSales);
    const curr = computePeriodKPIs(filtered);

    const fmtChangePDF = (c, p) => {
      if (p === 0 && c === 0) return '0%';
      if (p === 0) return '+100%';
      const pct = ((c - p) / p) * 100;
      return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    };

    ensureSpace(50);
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
    doc.text('Comparativa con período anterior', 14, y); y += 3;

    doc.autoTable({
      startY: y,
      head: [['Métrica', 'Actual', 'Anterior', 'Cambio']],
      body: [
        ['Ventas netas', '$' + curr.sales.toLocaleString('es-CO'), '$' + prev.sales.toLocaleString('es-CO'), fmtChangePDF(curr.sales, prev.sales)],
        ['Transacciones', String(curr.count), String(prev.count), fmtChangePDF(curr.count, prev.count)],
        ['Ticket promedio', '$' + Math.round(curr.ticket).toLocaleString('es-CO'), '$' + Math.round(prev.ticket).toLocaleString('es-CO'), fmtChangePDF(curr.ticket, prev.ticket)],
        ['Utilidad bruta', '$' + curr.profit.toLocaleString('es-CO'), '$' + prev.profit.toLocaleString('es-CO'), fmtChangePDF(curr.profit, prev.profit)]
      ],
      theme: 'striped',
      headStyles: { fillColor: [74, 122, 154], textColor: 255 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ============================================================
  // BLOQUE: Rentabilidad
  // ============================================================
  if (V.profitability) {
    ensureSpace(60);
    const kpis = computePeriodKPIs(filtered);
    let financialCommissions = 0;
    filtered.forEach(s => { financialCommissions += Number(s.creditCommissionAmount || 0); });
    const grossProfit = kpis.sales - kpis.cost;
    const netProfit = grossProfit - financialCommissions;
    const grossMargin = kpis.sales > 0 ? (grossProfit / kpis.sales) * 100 : 0;
    const netMargin = kpis.sales > 0 ? (netProfit / kpis.sales) * 100 : 0;

    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
    doc.text('Rentabilidad del período', 14, y); y += 3;

    doc.autoTable({
      startY: y,
      head: [['Concepto', 'Valor']],
      body: [
        ['Ventas', '$' + kpis.sales.toLocaleString('es-CO')],
        ['− Costo mercancía', '-' + '$' + kpis.cost.toLocaleString('es-CO')],
        ['= Utilidad bruta', '$' + grossProfit.toLocaleString('es-CO') + ` (${grossMargin.toFixed(1)}%)`],
        ['− Comisiones financieras', '-' + '$' + financialCommissions.toLocaleString('es-CO')],
        ['= Utilidad neta', '$' + netProfit.toLocaleString('es-CO') + ` (${netMargin.toFixed(1)}%)`]
      ],
      theme: 'grid',
      headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: 'bold' },
      bodyStyles: { fontSize: 10 },
      columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 150, halign: 'right', fontStyle: 'bold' } },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ============================================================
  // BLOQUE: Impuestos, recargos y envíos
  // ============================================================
  if (V.taxes) {
    ensureSpace(50);
    let shipping = 0, shippingCount = 0, surcharge = 0, surchargeCount = 0;
    let discount = 0, discountCount = 0, iva = 0;
    filtered.forEach(s => {
      if (Number(s.shipping || 0) > 0) { shipping += Number(s.shipping); shippingCount++; }
      if (Number(s.surchargeAmount || 0) > 0) { surcharge += Number(s.surchargeAmount); surchargeCount++; }
      if (Number(s.discount || 0) > 0) { discount += Number(s.discount); discountCount++; }
      (s.items || []).forEach(it => {
        const tr = Number(it.taxRate || 0);
        if (tr > 0) iva += Number(it.unitPrice || 0) * Number(it.qty || 0) * tr;
      });
    });

    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
    doc.text('Impuestos, recargos y envíos', 14, y); y += 3;

    doc.autoTable({
      startY: y,
      head: [['Concepto', 'Ventas', 'Total']],
      body: [
        ['Envíos cobrados', String(shippingCount), '$' + shipping.toLocaleString('es-CO')],
        ['Recargos tarjeta', String(surchargeCount), '$' + surcharge.toLocaleString('es-CO')],
        ['Descuentos otorgados', String(discountCount), '$' + discount.toLocaleString('es-CO')],
        ['IVA cobrado', '—', '$' + iva.toLocaleString('es-CO')]
      ],
      theme: 'striped',
      headStyles: { fillColor: [74, 122, 154], textColor: 255 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ============================================================
  // BLOQUE: Desglose por método y canal
  // ============================================================
  if (V.byMethod) {
    ensureSpace(60);
    const byMethod = {};
    filtered.forEach(s => {
      const m = s.paymentMethod || 'efectivo';
      const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
      if (!byMethod[m]) byMethod[m] = { total: 0, count: 0 };
      byMethod[m].total += base;
      byMethod[m].count += 1;
    });
    const methodLabelsPDF = {
      efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta',
      contraentrega: 'Contra entrega', credito: 'Crédito', nequi: 'Nequi'
    };
    const totalGen = Object.values(byMethod).reduce((s, m) => s + m.total, 0);
    const rows = Object.entries(byMethod)
      .sort((a,b) => b[1].total - a[1].total)
      .map(([k,v]) => [methodLabelsPDF[k] || k, String(v.count), '$' + v.total.toLocaleString('es-CO'), totalGen > 0 ? ((v.total/totalGen)*100).toFixed(1) + '%' : '0%']);

    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
    doc.text('Desglose por método de pago', 14, y); y += 3;

    doc.autoTable({
      startY: y,
      head: [['Método', 'Ventas', 'Total', '%']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [74, 122, 154], textColor: 255 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 0:{cellWidth:80}, 1:{cellWidth:25,halign:'center'}, 2:{cellWidth:40,halign:'right',fontStyle:'bold'}, 3:{cellWidth:25,halign:'right'} },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ============================================================
  // BLOQUE: Conciliación por cuenta
  // ============================================================
  if (V.reconciliation) {
    ensureSpace(60);
    const reconcGroups = {};
    filtered.forEach(s => {
      const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
      const ps = s.paymentStatus || 'completed';
      let key, data;
      if (ps === 'pending') { key = 'pending'; data = { bank: 'Por cobrar', name: 'Contra entrega pendiente', account: '' }; }
      else {
        const fm = s.finalPaymentMethod || s.paymentMethod;
        if (fm === 'efectivo') { key='efectivo'; data={bank:'Efectivo',name:'Caja física',account:''}; }
        else if (fm === 'tarjeta') { key='tarjeta'; data={bank:'Tarjeta',name:'Datáfono',account:''}; }
        else if (fm === 'transferencia' || fm === 'credito') {
          const cid = s.finalPaymentChannelId || s.paymentChannelId;
          if (cid) { key=cid; data={ bank:s.finalPaymentChannelBank||s.paymentChannelBank||'', name:s.finalPaymentChannelName||s.paymentChannelName||'', account:s.finalPaymentChannelAccount||s.paymentChannelAccount||'' }; }
          else { key='transferencia_gen'; data={bank:'Transferencia',name:'Sin especificar',account:''}; }
        } else { key='otros'; data={bank:'Otros',name:'',account:''}; }
      }
      if (!reconcGroups[key]) reconcGroups[key] = { ...data, total:0, count:0 };
      reconcGroups[key].total += base;
      reconcGroups[key].count += 1;
    });
    const reconcRows = Object.values(reconcGroups).sort((a,b) => b.total - a.total)
      .map(g => [`${g.bank}${g.name ? ' — ' + g.name : ''}`, g.account || '-', String(g.count), '$' + g.total.toLocaleString('es-CO')]);

    if (reconcRows.length) {
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
      doc.text('Conciliación por cuenta', 14, y); y += 3;
      doc.autoTable({
        startY: y,
        head: [['Cuenta / Canal','Nº cuenta','Ventas','Total']],
        body: reconcRows,
        theme: 'striped',
        headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 0:{cellWidth:90}, 1:{cellWidth:35,font:'courier'}, 2:{cellWidth:25,halign:'center'}, 3:{cellWidth:35,halign:'right',fontStyle:'bold'} },
        margin: { left: 14, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 10;
    }
  }

  // ============================================================
  // BLOQUE: Cobros pendientes
  // ============================================================
  if (V.pending) {
    const pendingSales = filtered.filter(s => (s.paymentStatus || 'completed') === 'pending');
    if (pendingSales.length) {
      ensureSpace(60);
      const totalPending = pendingSales.reduce((sum, s) => {
        const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
        return sum + base;
      }, 0);

      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
      doc.text(`Cobros pendientes (${pendingSales.length} · $${totalPending.toLocaleString('es-CO')})`, 14, y); y += 3;

      const pendingRows = pendingSales
        .sort((a,b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
        .slice(0, 50)
        .map(s => {
          const store = stores.find(x => x.storeId === s.storeId);
          const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
          const date = s.createdAt?.seconds ? new Date(s.createdAt.seconds*1000).toLocaleDateString('es-CO') : '-';
          return [date, s.customer?.name||'', s.customer?.phone||'', store?.name||s.storeId, s.sellerName||s.sellerEmail||'', '$'+base.toLocaleString('es-CO')];
        });

      doc.autoTable({
        startY: y,
        head: [['Fecha','Cliente','Teléfono','Tienda','Vendedor','Monto']],
        body: pendingRows,
        theme: 'striped',
        headStyles: { fillColor: [217, 119, 6], textColor: 255, fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        margin: { left: 14, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 10;
    }
  }

  // ============================================================
  // BLOQUE: Comparativa por tienda
  // ============================================================
  if (V.byStore) {
    ensureSpace(60);
    const byStore = {};
    filtered.forEach(s => {
      if (!byStore[s.storeId]) byStore[s.storeId] = { sales:0, count:0, commission:0, profit:0 };
      byStore[s.storeId].sales += Number(s.total || 0);
      byStore[s.storeId].count += 1;
      byStore[s.storeId].commission += Number(s.sellerCommissionAmount || 0);
      byStore[s.storeId].profit += Number(s.profit || 0);
    });
    const rows = Object.entries(byStore).map(([sid,v]) => {
      const st = stores.find(s => s.storeId === sid);
      return [st?.name || sid, v.count, '$'+v.sales.toLocaleString('es-CO'), '$'+v.profit.toLocaleString('es-CO'), '$'+v.commission.toLocaleString('es-CO')];
    }).sort((a,b) => Number(b[2].replace(/\D/g,'')) - Number(a[2].replace(/\D/g,'')));

    if (rows.length) {
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
      doc.text('Comparativa por tienda', 14, y); y += 3;
      doc.autoTable({
        startY: y,
        head: [['Tienda','Ventas','Total','Utilidad','Comisión']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [74, 122, 154], textColor: 255 },
        bodyStyles: { fontSize: 9 },
        margin: { left: 14, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 10;
    }
  }

  // ============================================================
  // BLOQUE: Ranking vendedores
  // ============================================================
  if (V.topSellers) {
    ensureSpace(60);
    const bySeller = {};
    filtered.forEach(s => {
      const k = s.sellerUid || s.sellerEmail || 'unknown';
      if (!bySeller[k]) bySeller[k] = { name: s.sellerName || s.sellerEmail || '—', sales:0, count:0, commission:0 };
      bySeller[k].sales += Number(s.total || 0);
      bySeller[k].count += 1;
      bySeller[k].commission += Number(s.sellerCommissionAmount || 0);
    });
    const rows = Object.values(bySeller).sort((a,b) => b.sales - a.sales).slice(0, 15)
      .map(v => [v.name, v.count, '$'+v.sales.toLocaleString('es-CO'), '$'+v.commission.toLocaleString('es-CO')]);
    if (rows.length) {
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
      doc.text('Ranking vendedores', 14, y); y += 3;
      doc.autoTable({
        startY: y,
        head: [['Vendedor','Ventas','Total','Comisión']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [74, 122, 154], textColor: 255 },
        bodyStyles: { fontSize: 9 },
        margin: { left: 14, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 10;
    }
  }

  // ============================================================
  // BLOQUE: Top productos
  // ============================================================
  if (V.topProducts) {
    ensureSpace(60);
    const byProduct = {};
    filtered.forEach(s => {
      (s.items || []).forEach(it => {
        const k = it.productId || it.sku || it.name;
        if (!byProduct[k]) byProduct[k] = { name: it.name, sku: it.sku || '', units:0, sales:0 };
        byProduct[k].units += Number(it.qty || 0);
        byProduct[k].sales += Number(it.qty || 0) * Number(it.unitPrice || 0);
      });
    });
    const rows = Object.values(byProduct).sort((a,b) => b.sales - a.sales).slice(0, 15)
      .map(p => [p.name, p.sku, p.units, '$'+p.sales.toLocaleString('es-CO')]);
    if (rows.length) {
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
      doc.text('Top productos vendidos', 14, y); y += 3;
      doc.autoTable({
        startY: y,
        head: [['Producto','SKU','Unidades','Total']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [74, 122, 154], textColor: 255 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 0: { cellWidth: 80 } },
        margin: { left: 14, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 10;
    }
  }

  // ============================================================
  // BLOQUE: Ventas por categoría
  // ============================================================
  if (V.byCategory) {
    ensureSpace(60);
    const byCat = {};
    filtered.forEach(s => {
      (s.items || []).forEach(it => {
        const prod = products.find(p => p.id === it.productId);
        const cat = prod?.categoryGroupName || 'Sin categoría';
        if (!byCat[cat]) byCat[cat] = { sales:0, units:0, count:0 };
        byCat[cat].sales += Number(it.qty || 0) * Number(it.unitPrice || 0);
        byCat[cat].units += Number(it.qty || 0);
        byCat[cat].count += 1;
      });
    });
    const list = Object.entries(byCat).sort((a,b) => b[1].sales - a[1].sales);
    if (list.length) {
      const total = list.reduce((s,[,v]) => s + v.sales, 0);
      const rows = list.map(([name, v]) => [name, v.units, '$'+v.sales.toLocaleString('es-CO'), total>0 ? ((v.sales/total)*100).toFixed(1)+'%' : '0%']);
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
      doc.text('Ventas por categoría', 14, y); y += 3;
      doc.autoTable({
        startY: y,
        head: [['Categoría','Unidades','Total','%']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [74, 122, 154], textColor: 255 },
        bodyStyles: { fontSize: 9 },
        margin: { left: 14, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 10;
    }
  }

  // ============================================================
  // BLOQUE: Top clientes
  // ============================================================
  if (V.topCustomers) {
    ensureSpace(60);
    const byCustomer = {};
    filtered.forEach(s => {
      const phone = String(s.customer?.phone || '').replace(/\D/g, '');
      const key = phone || s.customer?.name || 'sin-cliente';
      if (!byCustomer[key]) byCustomer[key] = { name: s.customer?.name || 'Sin nombre', phone: s.customer?.phone || '', count: 0, total: 0 };
      const base = (s.commissionBase !== undefined) ? Number(s.commissionBase) : (Number(s.subtotal||0) - Number(s.discount||0));
      byCustomer[key].count += 1;
      byCustomer[key].total += base;
    });
    const list = Object.values(byCustomer).sort((a,b) => b.total - a.total).slice(0, 20);
    if (list.length) {
      const rows = list.map((c, i) => [String(i+1), c.name, c.phone || '—', String(c.count), '$'+c.total.toLocaleString('es-CO')]);
      doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
      doc.text(`Top clientes (${Object.keys(byCustomer).length} únicos)`, 14, y); y += 3;
      doc.autoTable({
        startY: y,
        head: [['#','Cliente','Teléfono','Compras','Total']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [74, 122, 154], textColor: 255 },
        bodyStyles: { fontSize: 9 },
        columnStyles: { 0:{cellWidth:10,halign:'center'}, 1:{cellWidth:60}, 2:{cellWidth:35}, 3:{cellWidth:20,halign:'center'}, 4:{cellWidth:35,halign:'right',fontStyle:'bold'} },
        margin: { left: 14, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 10;
    }
  }

  // ============================================================
  // BLOQUE: Detalle de ventas
  // ============================================================
  if (V.detail) {
    ensureSpace(40);
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
    doc.text(`Detalle de ventas (${filtered.length})`, 14, y); y += 3;

    const rows = filtered.slice(0, 500).map(s => {
      const store = stores.find(x => x.storeId === s.storeId);
      return [fmtDate(s.createdAt), store?.name || s.storeId, s.sellerName || s.sellerEmail || '', s.customer?.name || '', '$' + Number(s.total || 0).toLocaleString('es-CO')];
    });

    doc.autoTable({
      startY: y,
      head: [['Fecha','Tienda','Vendedor','Cliente','Total']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 10, right: 10 }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ============================================================
  // Pie de página
  // ============================================================
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Smartec · Reporte generado automáticamente · Página ${i} de ${pages}`, pageW / 2, pageH - 8, { align: 'center' });
  }

  const filename = `smartec_reporte_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
};

/* ============================================================
   AJUSTE RÁPIDO DE CANTIDAD EN MODAL DE INVENTARIO
============================================================ */
window.adjustInvInput = (btn, delta) => {
  const container = btn.parentElement;
  const input = container.querySelector('.inv-input');
  if (!input) return;
  const current = Number(input.value) || 0;
  const next = Math.max(0, current + delta);
  input.value = next;
  input.classList.toggle('border-orange-400', next > 0);
  input.classList.toggle('bg-orange-50', next > 0);
  input.classList.toggle('text-orange-700', next > 0);
};

/* ============================================================
   MODAL HELPERS
============================================================ */
window.openForm = () => { const m=$('form-modal'); m.classList.remove('hidden'); m.classList.add('flex'); };
window.closeForm = () => { const m=$('form-modal'); m.classList.add('hidden'); m.classList.remove('flex'); };

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('channel-form-modal').classList.contains('hidden')) return closeChannelForm();
    if (!$('channels-modal').classList.contains('hidden')) return closeChannelsModal();
    if (!$('form-modal').classList.contains('hidden')) return closeForm();
    if (!$('sale-modal').classList.contains('hidden')) return closeSaleModal();
    if (!$('audit-modal').classList.contains('hidden')) return closeAuditModal();
  }
});

/* ============================================================
   🆕 REGENERAR DOCUMENTOS PDF
   Vuelve a generar los 3 PDFs y a subirlos a Storage.
   Usa window.SmartecPdf (debe estar cargado en la página).
============================================================ */
window.regenerateDocuments = async (saleId) => {
  const sale = sales.find(x => x.id === saleId);
  if (!sale) return alert('Venta no encontrada.');

  if (!window.SmartecPdf || typeof window.SmartecPdf.generateAndUploadAll !== 'function') {
    return alert('⚠️ El generador de PDFs no está cargado. Recarga la página.');
  }

  if (!confirm('¿Regenerar los 3 documentos PDF de esta venta?\n\nSe sobrescribirán los existentes.')) return;

  // Bloquear el botón
  const btns = document.querySelectorAll(`button[onclick="regenerateDocuments('${saleId}')"]`);
  btns.forEach(b => { b.disabled = true; b.textContent = '⏳ Generando...'; });

  try {
    // Cargar settings
    const setSnap = await getDoc(doc(db, 'settings', 'general'));
    const pdfSettings = setSnap.exists() ? setSnap.data() : {};

    // Preparar venta para PDF
    const saleForPdf = {
      id: sale.id,
      documentNumber: sale.documentNumber,
      storeId: sale.storeId,
      storeName: sale.storeName || '',
      customer: sale.customer || {},
      items: sale.items || [],
      subtotal: Number(sale.subtotal || 0),
      discount: Number(sale.discount || 0),
      shipping: Number(sale.shipping || 0),
      surchargeRate: Number(sale.surchargeRate || 0),
      surchargeAmount: Number(sale.surchargeAmount || 0),
      total: Number(sale.total || 0),
      paymentMethod: sale.paymentMethod || '',
      sellerName: sale.sellerName || '',
      sellerEmail: sale.sellerEmail || '',
      createdAt: sale.createdAt || null,
    };

    await window.SmartecPdf.generateAndUploadAll(saleForPdf, pdfSettings, {
      storage,
      ref,
      uploadBytes,
      getDownloadURL,
      db,
      doc,
      updateDoc,
      serverTimestamp,
    });

    alert('✅ Documentos regenerados correctamente.');

    // Recargar la venta en memoria
    window.SmartecCache.invalidate('sales');
    await loadAll();

    // Reabrir el detalle con datos actualizados
    viewSale(saleId);
  } catch (e) {
    console.error('Error regenerando documentos:', e);
    alert('❌ Error: ' + e.message);
    btns.forEach(b => { b.disabled = false; b.textContent = '🔄 Regenerar'; });
  }
};

window.forceRefreshCache = async () => {
  // Resetear flags de lazy loading para que todo se recargue
  Object.keys(_loaded).forEach(k => { _loaded[k] = false; });

  window.SmartecCache.clear();
  await loadAll();

  alert('✅ Datos actualizados desde el servidor');
};

/* ============================================================
   BADGE EN TIEMPO REAL — SOLICITUDES PENDIENTES
============================================================ */
let transfersBadgeUnsubscribe = null;

let devicesBadgeUnsubscribe = null;
let attemptsBadgeUnsubscribe = null;

/* ============================================================
   BADGE DE SOLICITUDES PENDIENTES — OPTIMIZADO
   🚨 Listeners en tiempo real DESACTIVADOS por costo.
   ✅ Ahora: polling cada 5 minutos + conteo puntual.
============================================================ */
function startTransfersBadgeListener() {
  console.log('[Badge] Listeners en tiempo real DESACTIVADOS. Usando polling cada 5min.');

  // Cancelar cualquier listener viejo por si quedó activo
  if (transfersBadgeUnsubscribe) { transfersBadgeUnsubscribe(); transfersBadgeUnsubscribe = null; }
  if (devicesBadgeUnsubscribe)   { devicesBadgeUnsubscribe();   devicesBadgeUnsubscribe = null; }
  if (attemptsBadgeUnsubscribe)  { attemptsBadgeUnsubscribe();  attemptsBadgeUnsubscribe = null; }

  // Conteo inicial
  updateTransfersBadgeOnce();

  // Refrescar cada 5 minutos
  if (window.__transfersBadgeInterval) clearInterval(window.__transfersBadgeInterval);
  window.__transfersBadgeInterval = setInterval(updateTransfersBadgeOnce, 5 * 60 * 1000);
}

async function updateTransfersBadgeOnce() {
  try {
    const [tSnap, dSnap, aSnap] = await Promise.all([
      getDocs(query(collection(db,'transferRequests'), where('status','==','pendiente'), limit(50))),
      getDocs(query(collection(db,'deviceRequests'),   where('status','==','pendiente'), limit(50))),
      getDocs(query(collection(db,'deviceAttempts'),   where('status','!=','resuelto'), limit(50)))
    ]);

    transferRequestsAll = tSnap.docs.map(d => ({id:d.id, ...d.data()}));
    deviceRequestsAll    = dSnap.docs.map(d => ({id:d.id, ...d.data()}));
    deviceAttemptsAll    = aSnap.docs.map(d => ({id:d.id, ...d.data()}));

    updateTransfersBadge();

    // Si el usuario está viendo la pestaña de solicitudes, re-renderizar
    const tabTransfers = $('tab-transfers');
    if (tabTransfers && !tabTransfers.classList.contains('hidden')) {
      if (typeof window.renderTransfers === 'function') window.renderTransfers();
    }
  } catch (e) {
    console.warn('[Badge] Error en polling:', e);
  }
}

window.addEventListener('beforeunload', () => {
  if (transfersBadgeUnsubscribe) transfersBadgeUnsubscribe();
  if (devicesBadgeUnsubscribe) devicesBadgeUnsubscribe();
  if (attemptsBadgeUnsubscribe) attemptsBadgeUnsubscribe();
  if (window.__transfersBadgeInterval) {
    clearInterval(window.__transfersBadgeInterval);
    window.__transfersBadgeInterval = null;
  }
});

/* ============================================================
   VISTAS DE CONTABILIDAD
============================================================ */
window.setAccView = (view) => {
  currentAccView = view;

  // Actualizar botones
  document.querySelectorAll('.acc-view-btn').forEach(btn => {
    if (btn.dataset.view === view) {
      btn.classList.add('bg-sd', 'text-white');
      btn.classList.remove('text-gray-600', 'hover:bg-gray-100');
    } else {
      btn.classList.remove('bg-sd', 'text-white');
      btn.classList.add('text-gray-600', 'hover:bg-gray-100');
    }
  });

  // Mostrar la vista correspondiente
  document.querySelectorAll('.acc-view-content').forEach(el => el.classList.add('hidden'));
  const target = $(`acc-view-${view}`);
  if (target) target.classList.remove('hidden');

  // Renderizar según la vista (con protección)
  try {
    // Siempre actualizar los KPIs superiores
    renderAccSummary();

    // Y renderizar la vista específica si no es la de resumen
    if (view === 'invoices') renderAccInvoices();
    if (view === 'suppliers') renderAccSuppliers();

  } catch(e) {
    console.error('Error renderizando vista contable:', view, e);
  }
};

window.clearAccFilters = () => {
  const setVal = (id, val) => { const el = $(id); if (el) el.value = val; };
  setVal('acc-date-from', '');
  setVal('acc-date-to', '');
  setVal('acc-status-filter', 'all');
  setVal('acc-supplier-filter', 'all');
  setVal('acc-terms-filter', 'all');
  setVal('acc-search', '');
  setAccRange('month');
};

function populateAccSupplierFilter() {
  const sel = $('acc-supplier-filter');
  if (!sel) return;
  const prev = sel.value;

  const active = suppliers.filter(s => s.active !== false);
  sel.innerHTML = '<option value="all">Todos</option>' +
    active.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');

  if (prev && Array.from(sel.options).some(o => o.value === prev)) {
    sel.value = prev;
  }
}

function populateAccStoreFilter() {
  const sel = $('acc-store-filter');
  if (!sel || sel.dataset.loaded) return;
  sel.dataset.loaded = '1';
  sel.innerHTML = '<option value="all">Todas las tiendas</option>' +
    stores.map(s => `<option value="${s.storeId}">${escapeHtml(s.name)}</option>`).join('') +
    '<option value="general">General (sin tienda)</option>';
  sel.onchange = () => {
    if (currentAccView === 'summary') renderAccSummary();
    if (currentAccView === 'invoices') renderAccInvoices();
    if (currentAccView === 'suppliers') renderAccSuppliers();
  };
}


/* ============================================================
   CONTABILIDAD — RESUMEN
============================================================ */
window.setAccRange = (range) => {
  const now = new Date();
  let from, to;

  switch(range) {
    case 'today': from = to = now; break;
    case 'week': {
      const day = now.getDay() || 7;
      from = new Date(now); from.setDate(now.getDate() - day + 1);
      to = now;
      break;
    }
    case 'month': from = new Date(now.getFullYear(), now.getMonth(), 1); to = now; break;
    case 'lastmonth':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'year': from = new Date(now.getFullYear(), 0, 1); to = now; break;
    default: return;
  }

  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const fromEl = $('acc-date-from');
  const toEl = $('acc-date-to');
  if (fromEl) fromEl.value = fmtD(from);
  if (toEl) toEl.value = fmtD(to);

  // Re-renderizar SIEMPRE los KPIs + la vista activa
  try {
    renderAccSummary();
    if (currentAccView === 'invoices') renderAccInvoices();
    if (currentAccView === 'suppliers') renderAccSuppliers();
  } catch(e) {
    console.error('Error al aplicar rango:', e);
  }
};

/* ============================================================
   HELPERS CONTABILIDAD
============================================================ */

/* Constantes de condiciones de pago */
const ACC_PAYMENT_TERMS = [
  { slug:'contado', label:'Contado', days: 0 },
  { slug:'net_15', label:'Net 15 días', days: 15 },
  { slug:'net_30', label:'Net 30 días', days: 30 },
  { slug:'net_45', label:'Net 45 días', days: 45 },
  { slug:'net_60', label:'Net 60 días', days: 60 },
  { slug:'net_90', label:'Net 90 días', days: 90 },
  { slug:'custom', label:'Personalizado', days: null }
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1 + 'T12:00:00');
  const d2 = new Date(dateStr2 + 'T12:00:00');
  return Math.round((d2 - d1) / (1000*60*60*24));
}

/* Calcular estado efectivo de pago al vuelo */
function computeAccPaymentStatus(e) {
  if (e.status === 'anulado') return 'anulado';
  if (e.paidAt) return 'paid';
  if (!e.dueDate) return 'pending';
  const today = todayStr();
  if (e.dueDate < today) return 'overdue';
  return 'pending';
}

function accStatusBadge(status) {
  const map = {
    pending:  { cls: 'bg-amber-100 text-amber-700', lbl: '⏳ Pendiente' },
    paid:     { cls: 'bg-green-100 text-green-700', lbl: '✅ Pagado' },
    overdue:  { cls: 'bg-red-100 text-red-700',    lbl: '🔴 Vencido' },
    anulado:  { cls: 'bg-gray-200 text-gray-600',  lbl: '⚪ Anulado' }
  };
  const m = map[status] || map.pending;
  return `<span class="text-[10px] px-2 py-0.5 rounded ${m.cls} font-semibold whitespace-nowrap">${m.lbl}</span>`;
}

function accTermsLabel(slug) {
  const t = ACC_PAYMENT_TERMS.find(x => x.slug === slug);
  return t ? t.label : (slug || '—');
}

function getFilteredExpenses() {
  let list = (expensesAll || []).slice();

  const storeF = $('acc-store-filter')?.value || 'all';
  if (storeF !== 'all') list = list.filter(e => e.storeId === storeF);

  const from = $('acc-date-from')?.value;
  const to = $('acc-date-to')?.value;
  if (from) list = list.filter(e => e.date >= from);
  if (to) list = list.filter(e => e.date <= to);

  // Filtro por estado de pago
  const statusF = $('acc-status-filter')?.value || 'all';
  if (statusF !== 'all') {
    list = list.filter(e => computeAccPaymentStatus(e) === statusF);
  }

  // Filtro por proveedor
  const supplierF = $('acc-supplier-filter')?.value || 'all';
  if (supplierF !== 'all') {
    list = list.filter(e => e.supplierId === supplierF);
  }

  // 🆕 Filtro por categoría
  const categoryF = $('acc-category-filter')?.value || 'all';
  if (categoryF !== 'all') {
    list = list.filter(e => (e.category || 'otros') === categoryF);
  }

  // Filtro por condición de pago
  const termsF = $('acc-terms-filter')?.value || 'all';
  if (termsF !== 'all') {
    list = list.filter(e => e.paymentTerms === termsF);
  }

  // Búsqueda libre (concepto o factura)
  const searchF = ($('acc-search')?.value || '').toLowerCase().trim();
  if (searchF) {
    list = list.filter(e =>
      (e.concept||'').toLowerCase().includes(searchF) ||
      (e.invoiceNumber||'').toLowerCase().includes(searchF) ||
      (e.supplierName||'').toLowerCase().includes(searchF) ||
      (e.provider||'').toLowerCase().includes(searchF)
    );
  }
  window.__debugList = list;
  return list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
}

/* ============================================================
   CONTABILIDAD — RENDER PRINCIPAL
============================================================ */
window.renderAccounting = () => {
  populateAccStoreFilter();
  populateAccSupplierFilter();

  // Conectar listeners (solo una vez)
  ['acc-status-filter','acc-supplier-filter','acc-terms-filter','acc-search',
   'acc-date-from','acc-date-to','acc-category-filter','acc-date-mode'].forEach(id => {
    const el = $(id);
    if (el && !el.dataset.listeners) {
      el.dataset.listeners = '1';
      const refreshAll = () => {
        // 🆕 SIEMPRE actualizar los KPIs superiores
        renderAccSummary();
        // Y renderizar la vista activa
        if (currentAccView === 'invoices') renderAccInvoices();
        if (currentAccView === 'suppliers') renderAccSuppliers();
      };
      el.addEventListener('input', refreshAll);
      el.addEventListener('change', refreshAll);
    }
  });

  // 🆕 Persistir el toggle de fecha
  const accDateMode = $('acc-date-mode');
  if (accDateMode && !accDateMode.dataset.persist) {
    accDateMode.dataset.persist = '1';
    try {
      const saved = localStorage.getItem('smartec_acc_date_mode');
      if (saved) accDateMode.value = saved;
    } catch (e) {}
    accDateMode.addEventListener('change', () => {
      try { localStorage.setItem('smartec_acc_date_mode', accDateMode.value); } catch (e) {}
    });
  }

  // Aplicar vista actual
  setAccView(currentAccView || 'summary');
};

  /* ============================================================
   🆕 HELPER: Filtrar ventas por rango de fechas de Contabilidad
   Usa el toggle "acc-date-mode" para decidir si filtra por
   createdAt o paidAt.
============================================================ */
function getAccSalesFiltered() {
  const dateMode = $('acc-date-mode')?.value || 'created';
  const dateFrom = $('acc-date-from')?.value || '';
  const dateTo = $('acc-date-to')?.value || '';

  let list = (sales || []).filter(s => s.status !== 'anulada');

  const getRefDate = (s) => {
    if (dateMode === 'paid') {
      return s.paidAt?.seconds
        ? new Date(s.paidAt.seconds * 1000)
        : (s.createdAt?.seconds ? new Date(s.createdAt.seconds * 1000) : null);
    }
    return s.createdAt?.seconds ? new Date(s.createdAt.seconds * 1000) : null;
  };

  if (dateFrom) {
    const from = new Date(dateFrom + 'T00:00:00');
    list = list.filter(s => {
      const d = getRefDate(s);
      return d && d >= from;
    });
  }
  if (dateTo) {
    const to = new Date(dateTo + 'T23:59:59');
    list = list.filter(s => {
      const d = getRefDate(s);
      return d && d <= to;
    });
  }

  // Filtro por tienda (si aplica)
  const storeF = $('acc-store-filter')?.value || 'all';
  if (storeF !== 'all') {
    if (storeF === 'general') {
      list = list.filter(s => !s.storeId);
    } else {
      list = list.filter(s => s.storeId === storeF);
    }
  }

  return list;
}
/* ============================================================
   VISTA: RESUMEN FINANCIERO
============================================================ */
function renderAccSummary() {
  const list = getFilteredExpenses();

  // ============================================================
  // 1. KPIs DE RENTABILIDAD (Ventas vs Costos vs Gastos)
  // ============================================================
  const salesFiltered = getAccSalesFiltered();
  const totalSales = salesFiltered.reduce((s, x) => {
    const sub = Number(x.subtotal || 0);
    const disc = Number(x.discount || 0);
    const base = (x.commissionBase !== undefined) ? Number(x.commissionBase) : (sub - disc);
    return s + base;
  }, 0);

  const totalCogs = salesFiltered.reduce((sum, s) => {
    if (Number(s.totalCost || 0) > 0) return sum + Number(s.totalCost);
    return sum + (s.items || []).reduce((itSum, it) =>
      itSum + (Number(it.unitCost || 0) * Number(it.qty || 0)), 0);
  }, 0);

  // Gastos operativos del período (excluye anulados)
  const operatingExpenses = list
    .filter(e => e.status !== 'anulado' && e.type === 'gasto')
    .reduce((s, e) => s + Number(e.total || 0), 0);

  // 🆕 Comisiones financieras (crédito: Addi, Sistecrédito, etc.)
  let financialCommissions = 0;
  let financialCommissionsCount = 0;
  salesFiltered.forEach(s => {
    const cc = Number(s.creditCommissionAmount || 0);
    if (cc > 0) {
      financialCommissions += cc;
      financialCommissionsCount++;
    }
  });

  const grossProfit = totalSales - totalCogs;
  const netProfit = totalSales - totalCogs - operatingExpenses - financialCommissions;
  const grossMargin = totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
  const netMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;

  const safeSet = (id, val) => { const el = $(id); if (el) el.innerText = val; };

  safeSet('acc-rent-sales', fmt(totalSales));
  safeSet('acc-rent-sales-count', `${salesFiltered.length} ventas`);
  safeSet('acc-rent-cogs', fmt(totalCogs));
  safeSet('acc-rent-expenses', fmt(operatingExpenses));
  safeSet('acc-rent-financial', fmt(financialCommissions));
  safeSet('acc-rent-net', fmt(netProfit));
  safeSet('acc-rent-margin', `Margen ${netMargin.toFixed(1)}%`);
  safeSet('acc-rent-gross', fmt(grossProfit));
  safeSet('acc-rent-gross-margin', `${grossMargin.toFixed(1)}%`);

  // Color dinámico en utilidad neta
  const netEl = $('acc-rent-net');
  if (netEl) netEl.className = netProfit >= 0
    ? 'text-lg font-bold text-purple-700 mt-1'
    : 'text-lg font-bold text-red-600 mt-1';

  // ============================================================
  // 2. KPIs SUPERIORES (Gastos + Costos)
  // ============================================================
  let totalMov = 0, costMov = 0, expenseMov = 0, taxMov = 0, retentionMov = 0;
  list.forEach(e => {
    if (e.status === 'anulado') return;
    totalMov += Number(e.total || 0);
    if (e.type === 'costo') costMov += Number(e.total || 0);
    else expenseMov += Number(e.total || 0);
    taxMov += Number(e.taxAmount || 0);
    retentionMov += Number(e.retentionAmount || 0);
  });

  // Cálculo de CxP (cuentas por pagar) y vencidos
  let payable = 0, payableCount = 0, overdueTotal = 0, overdueCount = 0;
  let paidTotal = 0, paidCount = 0;
  list.forEach(e => {
    if (e.status === 'anulado') return;
    const ps = computeAccPaymentStatus(e);
    if (ps === 'pending') { payable += Number(e.total || 0); payableCount++; }
    else if (ps === 'overdue') { overdueTotal += Number(e.total || 0); overdueCount++; payable += Number(e.total || 0); payableCount++; }
    else if (ps === 'paid') { paidTotal += Number(e.total || 0); paidCount++; }
  });

  safeSet('acc-kpi-total', fmt(totalMov));
  safeSet('acc-kpi-count', `${list.length} movimiento${list.length !== 1 ? 's' : ''}`);
  safeSet('acc-kpi-cost', fmt(costMov));
  safeSet('acc-kpi-expense', fmt(expenseMov));
  safeSet('acc-kpi-tax', fmt(taxMov));
  safeSet('acc-kpi-retention', `Retenciones: ${fmt(retentionMov)}`);
  safeSet('acc-kpi-payable', fmt(payable));
  safeSet('acc-kpi-payable-count', `${payableCount} factura${payableCount !== 1 ? 's' : ''} pendiente${payableCount !== 1 ? 's' : ''}`);
  safeSet('acc-kpi-overdue', fmt(overdueTotal));
  safeSet('acc-kpi-overdue-count', `${overdueCount} factura${overdueCount !== 1 ? 's' : ''} vencida${overdueCount !== 1 ? 's' : ''}`);
  safeSet('acc-kpi-paid', fmt(paidTotal));
  safeSet('acc-kpi-paid-count', `${paidCount} pago${paidCount !== 1 ? 's' : ''} registrado${paidCount !== 1 ? 's' : ''}`);
  safeSet('acc-kpi-net', fmt(netProfit));
  safeSet('acc-kpi-net-detail', `Ventas ${fmt(totalSales)} − Costos ${fmt(totalCogs + operatingExpenses + financialCommissions)}`);
  safeSet('acc-kpi-financial-commissions', fmt(financialCommissions));
  safeSet('acc-kpi-financial-commissions-count', `${financialCommissionsCount} venta${financialCommissionsCount !== 1 ? 's' : ''} con crédito`);

  // ============================================================
  // 3. DESGLOSE POR TIENDA (gastos)
  // ============================================================
  const byStore = {};
  list.forEach(e => {
    if (e.status === 'anulado') return;
    const key = e.storeId || 'general';
    if (!byStore[key]) byStore[key] = { sales: 0, count: 0 };
    byStore[key].sales += Number(e.total || 0);
    byStore[key].count += 1;
  });

  const storeEl = $('acc-by-store');
  if (storeEl) {
    const entries = Object.entries(byStore).sort((a,b) => b[1].sales - a[1].sales);
    if (!entries.length) {
      storeEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Sin datos</p>';
    } else {
      const max = entries[0][1].sales || 1;
      storeEl.innerHTML = entries.map(([sid, v]) => {
        const st = stores.find(s => s.storeId === sid);
        const name = sid === 'general' ? 'General' : (st?.name || sid);
        const pct = (v.sales / max) * 100;
        return `
          <div>
            <div class="flex justify-between items-center mb-1">
              <p class="text-sm font-semibold text-sd">${escapeHtml(name)}</p>
              <p class="text-sm font-bold text-sl">${fmt(v.sales)}</p>
            </div>
            <div class="w-full bg-gray-100 rounded-full h-2">
              <div class="h-2 rounded-full bg-gradient-to-r from-sl to-blue-400" style="width:${pct}%"></div>
            </div>
            <p class="text-[10px] text-gray-400 mt-0.5">${v.count} movimientos</p>
          </div>
        `;
      }).join('');
    }
  }

  // ============================================================
  // 4. DESGLOSE POR CATEGORÍA
  // ============================================================
  const byCat = {};
  list.forEach(e => {
    if (e.status === 'anulado') return;
    const key = e.category || 'otros';
    if (!byCat[key]) byCat[key] = { sales: 0, count: 0 };
    byCat[key].sales += Number(e.total || 0);
    byCat[key].count += 1;
  });

  const catEl = $('acc-by-category');
  const catNames = {
    arriendo:'Arriendo', servicios:'Servicios públicos', nomina:'Nómina',
    papeleria:'Papelería', transporte:'Transporte', publicidad:'Publicidad',
    mantenimiento:'Mantenimiento', impuestos:'Impuestos',
    mercancia:'Compra de mercancía', otros:'Otros'
  };

  if (catEl) {
    const catEntries = Object.entries(byCat).sort((a,b) => b[1].sales - a[1].sales);
    if (!catEntries.length) {
      catEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Sin datos</p>';
    } else {
      const max = catEntries[0][1].sales || 1;
      catEl.innerHTML = catEntries.map(([slug, v]) => {
        const name = catNames[slug] || slug;
        const pct = (v.sales / max) * 100;
        return `
          <div>
            <div class="flex justify-between items-center mb-1">
              <p class="text-sm font-semibold text-sd">${escapeHtml(name)}</p>
              <p class="text-sm font-bold text-sl">${fmt(v.sales)}</p>
            </div>
            <div class="w-full bg-gray-100 rounded-full h-2">
              <div class="h-2 rounded-full bg-gradient-to-r from-orange-400 to-red-500" style="width:${pct}%"></div>
            </div>
            <p class="text-[10px] text-gray-400 mt-0.5">${v.count} movimientos</p>
          </div>
        `;
      }).join('');
    }
  }

  // ============================================================
  // 5. DESGLOSE POR CONDICIÓN DE PAGO
  // ============================================================
  const termsEl = $('acc-by-terms');
  if (termsEl) {
    const byTerms = {};
    list.forEach(e => {
      if (e.status === 'anulado') return;
      const key = e.paymentTerms || 'contado';
      if (!byTerms[key]) byTerms[key] = { sales: 0, count: 0, paid: 0, pending: 0 };
      const st = computeAccPaymentStatus(e);
      byTerms[key].sales += Number(e.total || 0);
      byTerms[key].count += 1;
      if (st === 'paid') byTerms[key].paid += Number(e.total || 0);
      else byTerms[key].pending += Number(e.total || 0);
    });

    const termsEntries = Object.entries(byTerms).sort((a,b) => b[1].sales - a[1].sales);
    if (!termsEntries.length) {
      termsEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Sin datos</p>';
    } else {
      termsEl.innerHTML = termsEntries.map(([slug, v]) => `
        <div class="flex justify-between items-center border-b border-gray-100 py-2 last:border-0">
          <div>
            <p class="text-sm font-semibold text-sd">${escapeHtml(accTermsLabel(slug))}</p>
            <p class="text-[10px] text-gray-400">${v.count} factura${v.count !== 1 ? 's' : ''}</p>
          </div>
          <div class="text-right">
            <p class="text-sm font-bold text-sl">${fmt(v.sales)}</p>
            <p class="text-[10px] text-green-600">Pagado: ${fmt(v.paid)} · <span class="text-amber-600">Pend: ${fmt(v.pending)}</span></p>
          </div>
        </div>
      `).join('');
    }
  }

  // ============================================================
  // 6. FLUJO DE CAJA PROYECTADO
  // ============================================================
  renderAccCashflow(list);

  // ============================================================
  // 7. VENCIDAS CRÍTICAS
  // ============================================================
  renderAccOverdue(list);
}

/* ============================================================
   FLUJO DE CAJA PROYECTADO (próximos 30 días)
============================================================ */
function renderAccCashflow(list) {
  const listEl = $('acc-cashflow-list');
  const emptyEl = $('acc-cashflow-empty');
  const totalEl = $('acc-cashflow-total');
  if (!listEl) return;

  const today = todayStr();
  const in30 = addDays(today, 30);

  const upcoming = list.filter(e => {
    if (e.status === 'anulado') return false;
    if (e.paidAt) return false;
    if (!e.dueDate) return false;
    return e.dueDate >= today && e.dueDate <= in30;
  });

  const totalUpcoming = upcoming.reduce((s, e) => s + Number(e.total || 0), 0);
  if (totalEl) totalEl.innerText = fmt(totalUpcoming);

  if (!upcoming.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  const weeks = {};
  upcoming.forEach(e => {
    const daysFromNow = daysBetween(today, e.dueDate);
    const weekIdx = Math.floor(daysFromNow / 7);
    if (!weeks[weekIdx]) weeks[weekIdx] = { total: 0, items: [] };
    weeks[weekIdx].total += Number(e.total || 0);
    weeks[weekIdx].items.push(e);
  });

  const weekLabels = ['Esta semana', 'Próxima semana', 'En 2 semanas', 'En 3 semanas', 'En 4 semanas'];

  listEl.innerHTML = Object.entries(weeks)
    .sort((a,b) => Number(a[0]) - Number(b[0]))
    .map(([idx, w]) => `
      <div class="border rounded-lg p-3">
        <div class="flex justify-between items-center mb-2">
          <p class="font-semibold text-sd text-sm">${weekLabels[idx] || `Semana ${Number(idx)+1}`}</p>
          <p class="text-base font-bold text-amber-600">${fmt(w.total)}</p>
        </div>
        <div class="space-y-1">
          ${w.items.slice(0, 5).map(e => `
            <div class="flex justify-between text-xs text-gray-600">
              <span class="truncate">${escapeHtml(e.concept || e.supplierName || e.provider || '—')}</span>
              <span class="ml-2 whitespace-nowrap">${fmt(e.total)} · vence ${e.dueDate}</span>
            </div>
          `).join('')}
          ${w.items.length > 5 ? `<p class="text-[10px] text-gray-400 italic">... y ${w.items.length - 5} más</p>` : ''}
        </div>
      </div>
    `).join('');
}

/* ============================================================
   VENCIDAS CRÍTICAS
============================================================ */
function renderAccOverdue(list) {
  const blockEl = $('acc-overdue-block');
  const listEl = $('acc-overdue-list');
  const totalEl = $('acc-overdue-total');
  if (!blockEl || !listEl) return;

  const overdue = list
    .filter(e => e.status !== 'anulado' && computeAccPaymentStatus(e) === 'overdue')
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  if (!overdue.length) {
    blockEl.classList.add('hidden');
    return;
  }

  blockEl.classList.remove('hidden');
  const totalOverdue = overdue.reduce((s, e) => s + Number(e.total || 0), 0);
  if (totalEl) totalEl.innerText = fmt(totalOverdue);

  const today = todayStr();
  listEl.innerHTML = overdue.slice(0, 20).map(e => {
    const diff = daysBetween(e.dueDate, today);
    return `
      <div class="bg-white border border-red-200 rounded-lg p-3 flex justify-between items-center">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-red-700 truncate">${escapeHtml(e.concept || e.supplierName || '—')}</p>
          <p class="text-[10px] text-red-500">
            Venció hace ${diff} día${diff !== 1 ? 's' : ''} · ${e.dueDate}
          </p>
        </div>
        <p class="text-sm font-bold text-red-700 ml-3">${fmt(e.total)}</p>
      </div>
    `;
  }).join('');
}

/* ============================================================
   VISTA: FACTURAS
============================================================ */
function renderAccInvoices() {
  const tb = $('acc-invoices-tbody');
  const empty = $('acc-invoices-empty');
  const countEl = $('acc-invoices-count');
  if (!tb) return;

  const list = getFilteredExpenses();
  if (countEl) countEl.innerText = `${list.length} facturas`;

  if (!list.length) {
    tb.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  // Mapa de nombres de categoría
  const catNames = {
    arriendo: 'Arriendo',
    servicios: 'Servicios públicos',
    nomina: 'Nómina',
    papeleria: 'Papelería',
    transporte: 'Transporte',
    publicidad: 'Publicidad',
    mantenimiento: 'Mantenimiento',
    impuestos: 'Impuestos',
    mercancia: 'Compra de mercancía',
    otros: 'Otros'
  };

  // Colores de badge por categoría
  const catColors = {
    arriendo: 'bg-purple-100 text-purple-700',
    servicios: 'bg-cyan-100 text-cyan-700',
    nomina: 'bg-blue-100 text-blue-700',
    papeleria: 'bg-pink-100 text-pink-700',
    transporte: 'bg-amber-100 text-amber-700',
    publicidad: 'bg-fuchsia-100 text-fuchsia-700',
    mantenimiento: 'bg-slate-100 text-slate-700',
    impuestos: 'bg-red-100 text-red-700',
    mercancia: 'bg-orange-100 text-orange-700',
    otros: 'bg-gray-100 text-gray-700'
  };

  tb.innerHTML = list.slice(0, 500).map(e => {
    const st = stores.find(s => s.storeId === e.storeId);
    const status = computeAccPaymentStatus(e);
    const typeBadge = e.type === 'costo'
      ? '<span class="text-[10px] px-2 py-0.5 rounded bg-orange-100 text-orange-700 font-semibold">Costo</span>'
      : '<span class="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">Gasto</span>';

    const catSlug = e.category || 'otros';
    const catLabel = catNames[catSlug] || catSlug;
    const catCls = catColors[catSlug] || catColors.otros;

    const adjCount = (e.supports || []).length + (e.supportUrl && !(e.supports||[]).length ? 1 : 0);

    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs whitespace-nowrap">${e.date || '-'}</td>
      <td class="p-3 text-xs font-mono">${escapeHtml(e.invoiceNumber) || '-'}</td>
      <td class="p-3">${typeBadge}</td>
      <td class="p-3 text-xs">${escapeHtml(e.supplierName || e.provider) || '-'}</td>
      <td class="p-3 text-xs max-w-xs truncate">${escapeHtml(e.concept) || '-'}</td>
      <td class="p-3">
        <span class="text-[10px] px-2 py-0.5 rounded ${catCls} font-semibold whitespace-nowrap">
          ${escapeHtml(catLabel)}
        </span>
      </td>
      <td class="p-3 text-xs">${e.storeId === 'general' ? 'General' : escapeHtml(st?.name) || e.storeId || '-'}</td>
      <td class="p-3 text-right text-xs font-bold">${fmt(e.total)}</td>
      <td class="p-3 text-center text-xs">${e.dueDate || '-'}</td>
      <td class="p-3 text-center">${accStatusBadge(status)}</td>
      <td class="p-3 text-center text-xs">${adjCount > 0 ? `📎 ${adjCount}` : '-'}</td>
    </tr>`;
  }).join('');
}

/* ============================================================
   VISTA: PROVEEDORES
============================================================ */
function renderAccSuppliers() {
  const tb = $('acc-suppliers-tbody');
  const empty = $('acc-suppliers-empty');
  const countEl = $('acc-suppliers-count');
  if (!tb) return;

  const list = getFilteredExpenses();

  const bySupplier = {};
  list.forEach(e => {
    if (e.status === 'anulado') return;
    const key = e.supplierId || e.supplierName || e.provider || 'sin-proveedor';
    if (!bySupplier[key]) {
      bySupplier[key] = {
        name: e.supplierName || e.provider || 'Sin proveedor',
        supplierId: e.supplierId || null,
        invoices: 0,
        total: 0,
        paid: 0,
        pending: 0,
        overdue: 0,
        lastPurchase: null,
        totalDaysToPay: 0,
        paymentsCount: 0
      };
    }
    const s = bySupplier[key];
    const status = computeAccPaymentStatus(e);
    const amount = Number(e.total || 0);
    s.invoices += 1;
    s.total += amount;
    if (status === 'paid') {
      s.paid += amount;
      if (e.date && e.paidAt) {
        const days = daysBetween(e.date, e.paidAt.split('T')[0]);
        if (days >= 0) { s.totalDaysToPay += days; s.paymentsCount += 1; }
      }
    } else if (status === 'overdue') {
      s.overdue += amount;
      s.pending += amount;
    } else {
      s.pending += amount;
    }
    if (!s.lastPurchase || (e.date && e.date > s.lastPurchase)) {
      s.lastPurchase = e.date;
    }
  });

  const rows = Object.values(bySupplier).sort((a,b) => b.total - a.total);
  if (countEl) countEl.innerText = `${rows.length} proveedores`;

  if (!rows.length) {
    tb.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  tb.innerHTML = rows.map(s => {
    const avgDays = s.paymentsCount > 0 ? Math.round(s.totalDaysToPay / s.paymentsCount) : '—';
    const avg = s.invoices > 0 ? s.total / s.invoices : 0;
    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs font-semibold text-sd">${escapeHtml(s.name)}</td>
      <td class="p-3 text-center text-xs">${s.invoices}</td>
      <td class="p-3 text-right text-xs font-bold">${fmt(s.total)}</td>
      <td class="p-3 text-right text-xs text-green-600">${fmt(s.paid)}</td>
      <td class="p-3 text-right text-xs text-amber-600">${fmt(s.pending)}</td>
      <td class="p-3 text-right text-xs text-red-500 font-semibold">${fmt(s.overdue)}</td>
      <td class="p-3 text-center text-xs">${s.lastPurchase || '-'}</td>
      <td class="p-3 text-center text-xs">${avgDays}</td>
      <td class="p-3 text-right text-xs">${fmt(avg)}</td>
      <td class="p-3 text-right">
        <button onclick='viewAccSupplier("${s.supplierId || ''}","${escapeHtml(s.name).replace(/'/g, "\\'")}")' class="text-sl hover:underline text-xs">Ver</button>
      </td>
    </tr>`;
  }).join('');
}

/* ============================================================
   MODAL: DETALLE PROVEEDOR
============================================================ */
window.viewAccSupplier = (supplierId, name) => {
  const list = getFilteredExpenses().filter(e =>
    (supplierId && e.supplierId === supplierId) ||
    (!supplierId && (e.supplierName || e.provider) === name)
  );

  const body = $('acc-supplier-body');
  const title = $('acc-supplier-title');
  const subtitle = $('acc-supplier-subtitle');
  if (!body) return;

  title.innerText = name;
  subtitle.innerText = `${list.length} factura(s) en el período`;

  if (!list.length) {
    body.innerHTML = '<p class="text-center py-8 text-gray-400">Sin facturas para este proveedor.</p>';
  } else {
    body.innerHTML = `
      <div class="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
        ${list.map(e => {
          const status = computeAccPaymentStatus(e);
          return `
            <div class="border rounded-lg p-3">
              <div class="flex justify-between items-start mb-1">
                <div>
                  <p class="text-xs font-mono text-gray-500">${escapeHtml(e.invoiceNumber) || 'Sin N°'}</p>
                  <p class="text-sm font-semibold text-sd">${escapeHtml(e.concept) || '—'}</p>
                </div>
                ${accStatusBadge(status)}
              </div>
              <div class="flex justify-between text-xs text-gray-500 mt-1">
                <span>${e.date || '-'} · vence ${e.dueDate || '—'}</span>
                <span class="font-bold text-sd">${fmt(e.total)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  const m = $('acc-supplier-modal');
  if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
};

window.closeAccSupplierModal = () => {
  const m = $('acc-supplier-modal');
  if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
};

/* ============================================================
   BADGE: SOLICITUDES PENDIENTES
============================================================ */
function updateTransfersBadge() {
  const badge = $('transfers-badge');
  if (!badge) return;
  const pendingT = (transferRequestsAll || []).filter(r => r.status === 'pendiente').length;
  const pendingD = (deviceRequestsAll || []).filter(r => r.status === 'pendiente').length;
  // 🆕 Los intentos cuentan solo si NO fueron marcados como resueltos
  const pendingA = (deviceAttemptsAll || []).filter(r => r.status !== 'resuelto').length;
  const total = pendingT + pendingD + pendingA;
  if (total > 0) {
    badge.classList.remove('hidden');
    badge.innerText = total > 99 ? '99+' : total;
  } else {
    badge.classList.add('hidden');
  }
}

/* ============================================================
   TURNOS — Render y control
   ============================================================ */

function formatShiftDuration(ms) {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatShiftDurationFromMinutes(min) {
  if (!min || min < 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function populateShiftFilters() {
  const storeSel = $('shift-store-filter');
  if (storeSel && !storeSel.dataset.loaded) {
    storeSel.dataset.loaded = '1';
    storeSel.innerHTML = '<option value="all">Todas</option>' +
      stores.map(s => `<option value="${s.storeId}">${s.name}</option>`).join('');
    storeSel.onchange = renderShifts;
  }

  const userSel = $('shift-user-filter');
  if (userSel && !userSel.dataset.loaded) {
    userSel.dataset.loaded = '1';
    const map = new Map();
    shiftsAll.forEach(s => {
      if (s.userEmail && !map.has(s.userEmail)) {
        map.set(s.userEmail, s.userName || s.userEmail);
      }
    });
    users.forEach(u => {
      if (u.email && !map.has(u.email)) map.set(u.email, u.name || u.email);
    });
    const list = Array.from(map.entries()).sort((a,b) => (a[1]||'').localeCompare(b[1]||''));
    userSel.innerHTML = '<option value="all">Todos</option>' +
      list.map(([email, name]) => `<option value="${escapeHtml(email)}">${escapeHtml(name)}</option>`).join('');
    userSel.onchange = renderShifts;
  }

  ['shift-date-from','shift-date-to','shift-status-filter'].forEach(id => {
    const el = $(id);
    if (el && !el.dataset.loaded) {
      el.dataset.loaded = '1';
      el.addEventListener('change', renderShifts);
      el.addEventListener('input', renderShifts);
    }
  });
}

function getFilteredShifts() {
  let list = shiftsAll.slice();

  const from = $('shift-date-from')?.value;
  if (from) {
    const fromTs = new Date(from + 'T00:00:00').getTime() / 1000;
    list = list.filter(s => (s.startedAt?.seconds || 0) >= fromTs);
  }

  const to = $('shift-date-to')?.value;
  if (to) {
    const toTs = new Date(to + 'T23:59:59').getTime() / 1000;
    list = list.filter(s => (s.startedAt?.seconds || 0) <= toTs);
  }

  const storeF = $('shift-store-filter')?.value || 'all';
  if (storeF !== 'all') list = list.filter(s => s.storeId === storeF);

  const userF = $('shift-user-filter')?.value || 'all';
  if (userF !== 'all') list = list.filter(s => s.userEmail === userF);

  const statusF = $('shift-status-filter')?.value || 'all';
  if (statusF !== 'all') list = list.filter(s => s.status === statusF);

  list.sort((a, b) => (b.startedAt?.seconds || 0) - (a.startedAt?.seconds || 0));
  return list;
}

window.setShiftRange = (range) => {
  const now = new Date();
  let from, to;
  switch(range) {
    case 'today': from = to = now; break;
    case 'week': {
      const day = now.getDay() || 7;
      from = new Date(now); from.setDate(now.getDate() - day + 1);
      to = now;
      break;
    }
    case 'month': from = new Date(now.getFullYear(), now.getMonth(), 1); to = now; break;
    case 'lastmonth':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    default: return;
  }
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fromEl = $('shift-date-from');
  const toEl = $('shift-date-to');
  if (fromEl) fromEl.value = fmtD(from);
  if (toEl) toEl.value = fmtD(to);
  renderShifts();
};

window.clearShiftFilters = () => {
  const setVal = (id, val) => { const el = $(id); if (el) el.value = val; };
  setVal('shift-date-from', '');
  setVal('shift-date-to', '');
  setVal('shift-store-filter', 'all');
  setVal('shift-user-filter', 'all');
  setVal('shift-status-filter', 'all');
  renderShifts();
};

function renderShifts() {
  populateShiftFilters();

  const now = new Date();
  const todayStrVal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // ===== KPIs =====
  const activeShifts = shiftsAll.filter(s => s.status === 'open');
  const todayShifts = shiftsAll.filter(s => {
    const ts = s.startedAt?.seconds;
    if (!ts) return false;
    const d = new Date(ts * 1000);
    return d.toDateString() === now.toDateString();
  });
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
  const weekShifts = shiftsAll.filter(s => {
    const ts = s.startedAt?.seconds;
    if (!ts) return false;
    return new Date(ts * 1000) >= weekAgo;
  });
  const closedShifts = shiftsAll.filter(s => s.status === 'closed' && s.durationMinutes > 0);
  const avgDuration = closedShifts.length > 0
    ? Math.round(closedShifts.reduce((sum, s) => sum + Number(s.durationMinutes || 0), 0) / closedShifts.length)
    : 0;

  const setTxt = (id, v) => { const el = $(id); if (el) el.innerText = v; };
  setTxt('shift-kpi-active', activeShifts.length);
  setTxt('shift-kpi-active-sub', activeShifts.length === 0 ? 'sin turno abierto' : `${activeShifts.length} usuario${activeShifts.length !== 1 ? 's' : ''} operando`);
  setTxt('shift-kpi-today', todayShifts.length);
  setTxt('shift-kpi-today-sub', 'iniciados hoy');
  setTxt('shift-kpi-week', weekShifts.length);
  setTxt('shift-kpi-week-sub', 'últimos 7 días');
  setTxt('shift-kpi-avg', avgDuration > 0 ? formatShiftDurationFromMinutes(avgDuration) : '—');
  setTxt('shift-kpi-avg-sub', `${closedShifts.length} turno${closedShifts.length !== 1 ? 's' : ''} cerrado${closedShifts.length !== 1 ? 's' : ''}`);

  // ===== Turnos activos =====
  const activeList = $('shift-active-list');
  const activeEmpty = $('shift-active-empty');
  const activeCount = $('shift-active-count');

  if (activeCount) activeCount.innerText = `${activeShifts.length} turno${activeShifts.length !== 1 ? 's' : ''}`;

  if (!activeShifts.length) {
    activeList.innerHTML = '';
    activeEmpty.classList.remove('hidden');
  } else {
    activeEmpty.classList.add('hidden');
    activeList.innerHTML = activeShifts.map(s => {
      const startMs = (s.startedAt?.seconds || 0) * 1000;
      const elapsed = startMs ? Date.now() - startMs : 0;
      const startTime = startMs ? new Date(startMs).toLocaleTimeString('es-CO', {hour:'2-digit', minute:'2-digit'}) : '—';
      const store = stores.find(st => st.storeId === s.storeId);
      const maxHours = Number(store?.shiftMaxHours ?? 12);
      const exceeded = elapsed > maxHours * 3600000;
      const cardClass = exceeded ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-200';

      return `
        <div class="border rounded-lg p-3 ${cardClass} flex flex-wrap items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 text-xl">
            ${exceeded ? '🔴' : '🟢'}
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sd text-sm truncate">${escapeHtml(s.userName || s.userEmail)}</p>
            <p class="text-[10px] text-gray-500">
              ${escapeHtml(store?.name || s.storeId)} · ${s.userRole || ''} · inicio ${startTime}
            </p>
            ${exceeded ? `<p class="text-[10px] text-red-600 font-bold mt-0.5">⚠️ Excede el máximo (${maxHours}h)</p>` : ''}
          </div>
          <div class="text-right">
            <p class="text-lg font-bold ${exceeded ? 'text-red-600' : 'text-green-600'}">${formatShiftDuration(elapsed)}</p>
            <p class="text-[10px] text-gray-400">en curso</p>
          </div>
        </div>
      `;
    }).join('');
  }

  // ===== Histórico =====
  const list = getFilteredShifts();
  const tbody = $('shift-hist-tbody');
  const empty = $('shift-hist-empty');
  const countEl = $('shift-hist-count');
  if (countEl) countEl.innerText = `${list.length} turno${list.length !== 1 ? 's' : ''}`;

  if (!list.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = list.slice(0, 500).map(s => {
    const store = stores.find(st => st.storeId === s.storeId);
    const startTime = s.startedAt?.seconds
      ? new Date(s.startedAt.seconds * 1000).toLocaleString('es-CO', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})
      : '—';
    const endTime = s.endedAt?.seconds
      ? new Date(s.endedAt.seconds * 1000).toLocaleString('es-CO', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})
      : '—';
    const isOpen = s.status === 'open';

    let durationLabel = '—';
    if (isOpen) {
      const ms = (Date.now() - (s.startedAt?.seconds || 0) * 1000);
      durationLabel = formatShiftDuration(ms);
    } else if (s.durationMinutes) {
      durationLabel = formatShiftDurationFromMinutes(s.durationMinutes);
    }

    const statusBadge = isOpen
      ? '<span class="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 font-semibold">🟢 Abierto</span>'
      : '<span class="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-semibold">✅ Cerrado</span>';

    const notes = [s.startedNotes, s.endedNotes].filter(Boolean).join(' · ') || '—';

    return `<tr class="border-b hover:bg-gray-50 ${isOpen ? 'bg-green-50/40' : ''}">
      <td class="p-3 text-xs text-gray-600 whitespace-nowrap">${startTime}</td>
      <td class="p-3 text-xs text-gray-600 whitespace-nowrap">${endTime}</td>
      <td class="p-3 text-xs">
        <p class="font-medium text-sd truncate max-w-[160px]">${escapeHtml(s.userName || s.userEmail)}</p>
        <p class="text-[10px] text-gray-400 truncate max-w-[160px]">${escapeHtml(s.userEmail) || ''}</p>
      </td>
      <td class="p-3 text-xs">${escapeHtml(s.userRole || '—')}</td>
      <td class="p-3 text-xs">${escapeHtml(store?.name || s.storeId)}</td>
      <td class="p-3 text-center text-xs font-semibold">${durationLabel}</td>
      <td class="p-3 text-center">${statusBadge}</td>
      <td class="p-3 text-xs text-gray-500 max-w-xs truncate">${escapeHtml(notes)}</td>
      <td class="p-3 text-right">
        <button onclick='viewShift("${s.id}")' class="text-sl hover:underline text-xs">Ver</button>
      </td>
    </tr>`;
  }).join('');
}

/* ============================================================
   EXPORTAR TURNOS A EXCEL
   ============================================================ */
async function exportShiftsExcel() {
  if (!window.ExcelJS) {
    alert('⚠️ La librería de Excel no ha cargado. Espera unos segundos y vuelve a intentar.');
    return;
  }

  const list = getFilteredShifts();
  if (!list.length) {
    alert('No hay turnos para exportar con los filtros actuales.');
    return;
  }

  // ===== Filtros aplicados =====
  const from = $('shift-date-from')?.value || 'todo';
  const to = $('shift-date-to')?.value || 'hoy';
  const storeF = $('shift-store-filter')?.value || 'all';
  const userF = $('shift-user-filter')?.value || 'all';
  const statusF = $('shift-status-filter')?.value || 'all';

  // ===== Estadísticas =====
  const total = list.length;
  const open = list.filter(s => s.status === 'open').length;
  const closed = list.filter(s => s.status === 'closed').length;
  const totalDurationMin = list
    .filter(s => s.status === 'closed' && s.durationMinutes > 0)
    .reduce((sum, s) => sum + Number(s.durationMinutes || 0), 0);
  const avgDuration = closed > 0 ? Math.round(totalDurationMin / closed) : 0;

  // ===== Crear workbook =====
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smartec';
  wb.created = new Date();

  // ============================================================
  // HOJA 1: RESUMEN
  // ============================================================
  const wsR = wb.addWorksheet('Resumen', { properties: { defaultRowHeight: 18 } });

  wsR.mergeCells('A1:B1');
  const titleCell = wsR.getCell('A1');
  titleCell.value = 'SMARTEC · Control de turnos';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2A4A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  wsR.getRow(1).height = 32;

  const addMeta = (row, label, value) => {
    wsR.getCell(`A${row}`).value = label;
    wsR.getCell(`A${row}`).font = { bold: true, color: { argb: 'FF0A2A4A' } };
    wsR.getCell(`B${row}`).value = value;
  };

  addMeta(3, 'Generado', new Date().toLocaleString('es-CO'));
  addMeta(4, 'Total turnos', total);
  addMeta(5, 'Turnos abiertos', open);
  addMeta(6, 'Turnos cerrados', closed);
  addMeta(7, 'Duración promedio', formatShiftDurationFromMinutes(avgDuration));

  wsR.mergeCells('A9:B9');
  const filtrosTitle = wsR.getCell('A9');
  filtrosTitle.value = 'FILTROS APLICADOS';
  filtrosTitle.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  filtrosTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A7A9A' } };
  filtrosTitle.alignment = { horizontal: 'center' };

  addMeta(10, 'Desde', from);
  addMeta(11, 'Hasta', to);
  addMeta(12, 'Tienda', storeF === 'all' ? 'Todas' : (stores.find(s => s.storeId === storeF)?.name || storeF));
  addMeta(13, 'Usuario', userF === 'all' ? 'Todos' : userF);
  addMeta(14, 'Estado', statusF === 'all' ? 'Todos' : (statusF === 'open' ? 'Abiertos' : 'Cerrados'));

  wsR.getColumn(1).width = 24;
  wsR.getColumn(2).width = 45;

  // ============================================================
  // HOJA 2: TURNOS
  // ============================================================
  const wsE = wb.addWorksheet('Turnos', { properties: { defaultRowHeight: 18 } });

  const headers = [
    { header: 'Inicio', width: 22 },
    { header: 'Fin', width: 22 },
    { header: 'Usuario', width: 24 },
    { header: 'Email', width: 30 },
    { header: 'Rol', width: 14 },
    { header: 'Tienda', width: 22 },
    { header: 'Duración', width: 14 },
    { header: 'Estado', width: 12 },
    { header: 'Notas inicio', width: 40 },
    { header: 'Notas cierre', width: 40 }
  ];

  wsE.columns = headers.map(h => ({ width: h.width }));
  const headerRow = wsE.addRow(headers.map(h => h.header));
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2A4A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF08344C' } },
      bottom: { style: 'thin', color: { argb: 'FF08344C' } },
      left: { style: 'thin', color: { argb: 'FF08344C' } },
      right: { style: 'thin', color: { argb: 'FF08344C' } }
    };
  });

  // Filas
  list.forEach(s => {
    const store = stores.find(st => st.storeId === s.storeId);
    const startTime = s.startedAt?.seconds
      ? new Date(s.startedAt.seconds * 1000).toLocaleString('es-CO', {day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'})
      : '—';
    const endTime = s.endedAt?.seconds
      ? new Date(s.endedAt.seconds * 1000).toLocaleString('es-CO', {day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'})
      : '—';

    let durationLabel = '—';
    if (s.status === 'open') {
      durationLabel = formatShiftDuration(Date.now() - (s.startedAt?.seconds || 0) * 1000) + ' (en curso)';
    } else if (s.durationMinutes) {
      durationLabel = formatShiftDurationFromMinutes(s.durationMinutes);
    }

    const isOpen = s.status === 'open';
    const row = wsE.addRow([
      startTime,
      endTime,
      s.userName || '',
      s.userEmail || '',
      s.userRole || '',
      store?.name || s.storeId || '',
      durationLabel,
      isOpen ? 'ABIERTO' : 'CERRADO',
      s.startedNotes || '',
      s.endedNotes || ''
    ]);

    row.eachCell((cell, colIdx) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      cell.alignment = { vertical: 'top', wrapText: colIdx >= 9 };
    });

    // Colorear estado
    const statusCell = row.getCell(8);
    statusCell.alignment = { vertical: 'middle', horizontal: 'center' };
    statusCell.font = { bold: true, color: { argb: isOpen ? 'FF166534' : 'FF6B7280' } };
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isOpen ? 'FFDCFCE7' : 'FFF3F4F6' } };
  });

  // Congelar primera fila
  wsE.views = [{ state: 'frozen', ySplit: 1 }];

  // Auto-filtro
  wsE.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  // ===== Descargar =====
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `smartec_turnos_${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ============================================================
   DETALLE DE TURNO (modal con tarjeta visual)
   ============================================================ */
window.viewShift = (id) => {
  const s = shiftsAll.find(x => x.id === id);
  if (!s) return;

  const store = stores.find(st => st.storeId === s.storeId);
  const isOpen = s.status === 'open';

  const formatTime = (ts) => {
    if (!ts?.seconds) return '—';
    return new Date(ts.seconds * 1000).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
  };
  const formatDateTime = (ts) => {
    if (!ts?.seconds) return '—';
    return new Date(ts.seconds * 1000).toLocaleString('es-CO', {
      day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit'
    });
  };

  const startTime = formatTime(s.startedAt);
  const endTime = isOpen ? 'En curso' : formatTime(s.endedAt);

  let durationLabel = '—';
  if (isOpen) {
    durationLabel = formatShiftDuration(Date.now() - (s.startedAt?.seconds || 0) * 1000) + ' (en curso)';
  } else if (s.durationMinutes) {
    durationLabel = formatShiftDurationFromMinutes(s.durationMinutes);
  }

  const statusBadge = isOpen
    ? '<span class="text-xs px-3 py-1 rounded-full bg-green-100 text-green-700 font-bold">🟢 TURNO ABIERTO</span>'
    : '<span class="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-700 font-bold">✅ TURNO CERRADO</span>';

  // Notas (con saltos de línea si hay varias)
  const notesHtml = [];
  if (s.startedNotes) notesHtml.push(`<div class="text-xs text-gray-600"><b>Entrada:</b> "${escapeHtml(s.startedNotes)}"</div>`);
  if (s.endedNotes) notesHtml.push(`<div class="text-xs text-gray-600 mt-1"><b>Salida:</b> "${escapeHtml(s.endedNotes)}"</div>`);

  $('shift-detail-body').innerHTML = `
    <!-- Encabezado -->
    <div class="text-center mb-5">
      <div class="w-14 h-14 rounded-full ${isOpen ? 'bg-green-100' : 'bg-gray-100'} flex items-center justify-center mx-auto mb-3 text-2xl">
        ${isOpen ? '🟢' : '✅'}
      </div>
      <p class="text-lg font-bold text-sd">${escapeHtml(s.userName || s.userEmail)}</p>
      <p class="text-xs text-gray-500">${escapeHtml(s.userEmail) || ''}</p>
      <div class="mt-3">${statusBadge}</div>
    </div>

    <!-- Info de contexto -->
    <div class="bg-gray-50 rounded-lg p-3 mb-4 text-xs space-y-1">
      <div class="flex justify-between"><span class="text-gray-500">Rol:</span><b>${escapeHtml(s.userRole || '—')}</b></div>
      <div class="flex justify-between"><span class="text-gray-500">Tienda:</span><b>${escapeHtml(store?.name || s.storeId || '—')}</b></div>
      <div class="flex justify-between"><span class="text-gray-500">Fecha:</span><b>${formatDateTime(s.startedAt)}</b></div>
    </div>

    <!-- Tarjeta de tiempo -->
    <div class="bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-200 rounded-xl p-5 mb-4">
      <div class="flex items-center justify-between gap-3">
        <!-- Hora entrada -->
        <div class="text-center flex-1">
          <p class="text-[10px] text-gray-500 uppercase font-semibold mb-1">🕐 Entrada</p>
          <p class="text-xl font-bold text-sd">${startTime}</p>
        </div>

        <!-- Flecha / línea -->
        <div class="flex-1 flex items-center justify-center">
          <div class="w-full h-0.5 bg-gradient-to-r from-sl to-purple-400 relative">
            <span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-2 text-xs font-bold text-purple-600 whitespace-nowrap">
              ${isOpen ? '⏳' : '➜'}
            </span>
          </div>
        </div>

        <!-- Hora salida -->
        <div class="text-center flex-1">
          <p class="text-[10px] text-gray-500 uppercase font-semibold mb-1">🕓 Salida</p>
          <p class="text-xl font-bold ${isOpen ? 'text-green-600' : 'text-sd'}">${endTime}</p>
        </div>
      </div>

      <!-- Duración -->
      <div class="mt-4 pt-4 border-t border-purple-200 text-center">
        <p class="text-[10px] text-gray-500 uppercase font-semibold mb-1">⏱ Total trabajado</p>
        <p class="text-2xl font-bold text-purple-700">${durationLabel}</p>
      </div>
    </div>

    ${notesHtml.length ? `
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
        <p class="text-[10px] text-yellow-700 uppercase font-semibold mb-2">📝 Notas</p>
        ${notesHtml.join('')}
      </div>
    ` : ''}
  `;

  const modal = $('shift-detail-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeShiftDetail = () => {
  const modal = $('shift-detail-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
};

// ESC cierra el modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('shift-detail-modal')?.classList.contains('hidden')) {
    closeShiftDetail();
  }
});

window.exportAccountingPDF = async () => {
  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }
  const { jsPDF } = window.jspdf;
  const list = getFilteredExpenses();
  const salesFiltered = getFilteredSales();

  if (!list.length && !salesFiltered.length) {
    alert('No hay datos para exportar con los filtros actuales.');
    return;
  }

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  // ============================================================
  // Utilidades
  // ============================================================
  const ensureSpace = (needed) => {
    if (y + needed > pageH - 15) {
      doc.addPage();
      y = 20;
    }
  };

  const fmtMoney = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');

  // ============================================================
  // Encabezado
  // ============================================================
  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Análisis Financiero', 14, 13);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Estado consolidado', pageW - 14, 13, { align: 'right' });

  y = 28;

  // ============================================================
  // Filtros aplicados
  // ============================================================
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  const storeLabel = reportFilters?.storeId && reportFilters.storeId !== 'all'
    ? (stores.find(s => s.storeId === reportFilters.storeId)?.name || reportFilters.storeId)
    : 'Todas las tiendas';
  const from = $('acc-date-from')?.value || 'todo';
  const to = $('acc-date-to')?.value || 'hoy';

  doc.text(`Período: ${from} — ${to}`, 14, y); y += 5;
  doc.text(`Tienda: ${storeLabel}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  // ============================================================
  // 1. ESTADO DE RESULTADOS
  // ============================================================
  const totalSales = salesFiltered.reduce((s, x) => {
    const sub = Number(x.subtotal || 0);
    const disc = Number(x.discount || 0);
    const base = (x.commissionBase !== undefined) ? Number(x.commissionBase) : (sub - disc);
    return s + base;
  }, 0);

  const totalCogs = salesFiltered.reduce((sum, s) => {
    if (Number(s.totalCost || 0) > 0) return sum + Number(s.totalCost);
    return sum + (s.items || []).reduce((itSum, it) =>
      itSum + (Number(it.unitCost || 0) * Number(it.qty || 0)), 0);
  }, 0);

  const operatingExpenses = list
    .filter(e => e.status !== 'anulado' && e.type === 'gasto')
    .reduce((s, e) => s + Number(e.total || 0), 0);

  // 🆕 Comisiones financieras (crédito)
  const financialCommissions = salesFiltered.reduce((sum, s) =>
    sum + Number(s.creditCommissionAmount || 0), 0);

  const grossProfit = totalSales - totalCogs;
  const netProfit = totalSales - totalCogs - operatingExpenses - financialCommissions;
  const grossMargin = totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
  const netMargin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;

  ensureSpace(80);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 42, 74);
  doc.text('Estado de Resultados', 14, y);
  y += 6;

  doc.autoTable({
    startY: y,
    head: [['Concepto', 'Valor', '% sobre ventas']],
    body: [
      ['Ingresos por ventas', fmtMoney(totalSales), '100.0%'],
      ['(-) Costo de mercancía vendida', '-' + fmtMoney(totalCogs),
        totalSales > 0 ? '-' + ((totalCogs / totalSales) * 100).toFixed(1) + '%' : '0%'],
      ['= Utilidad bruta', fmtMoney(grossProfit), grossMargin.toFixed(1) + '%'],
      ['(-) Gastos operativos', '-' + fmtMoney(operatingExpenses),
        totalSales > 0 ? '-' + ((operatingExpenses / totalSales) * 100).toFixed(1) + '%' : '0%'],
      ['(-) Comisiones financieras', '-' + fmtMoney(financialCommissions),
        totalSales > 0 ? '-' + ((financialCommissions / totalSales) * 100).toFixed(1) + '%' : '0%'],
      ['= Utilidad neta', fmtMoney(netProfit), netMargin.toFixed(1) + '%']
    ],
    theme: 'grid',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontStyle: 'bold' },
    bodyStyles: { fontSize: 10 },
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 45, halign: 'right', fontStyle: 'bold' },
      2: { cellWidth: 40, halign: 'right' }
    },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const label = data.row.raw[0] || '';
        if (label.startsWith('=')) {
          data.cell.styles.fillColor = [240, 245, 250];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    }
  });
  y = doc.lastAutoTable.finalY + 10;

  // ============================================================
  // 2. CUENTAS POR PAGAR / VENCIDOS
  // ============================================================
  let payable = 0, payableCount = 0;
  let overdueTotal = 0, overdueCount = 0;
  let paidTotal = 0, paidCount = 0;

  list.forEach(e => {
    if (e.status === 'anulado') return;
    const ps = computeAccPaymentStatus(e);
    if (ps === 'paid') { paidTotal += Number(e.total || 0); paidCount++; }
    else if (ps === 'overdue') { overdueTotal += Number(e.total || 0); overdueCount++; payable += Number(e.total || 0); payableCount++; }
    else if (ps === 'pending') { payable += Number(e.total || 0); payableCount++; }
  });

  ensureSpace(60);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 42, 74);
  doc.text('Situación de pagos', 14, y);
  y += 6;

  doc.autoTable({
    startY: y,
    head: [['Concepto', 'Facturas', 'Monto']],
    body: [
      ['Cuentas por pagar (pendientes)', String(payableCount), fmtMoney(payable)],
      ['Vencidas críticas', String(overdueCount), fmtMoney(overdueTotal)],
      ['Pagado del período', String(paidCount), fmtMoney(paidTotal)],
      ['Total movimientos', String(list.length), fmtMoney(list.reduce((s,e) => s + Number(e.total || 0), 0))]
    ],
    theme: 'striped',
    headStyles: { fillColor: [74, 122, 154], textColor: 255 },
    bodyStyles: { fontSize: 10 },
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 35, halign: 'center' },
      2: { cellWidth: 50, halign: 'right', fontStyle: 'bold' }
    },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 10;

  // ============================================================
  // 3. DESGLOSE POR TIENDA
  // ============================================================
  const byStore = {};
  list.forEach(e => {
    if (e.status === 'anulado') return;
    const key = e.storeId || 'general';
    if (!byStore[key]) byStore[key] = { total: 0, count: 0 };
    byStore[key].total += Number(e.total || 0);
    byStore[key].count += 1;
  });

  const storeRows = Object.entries(byStore).map(([sid, v]) => {
    const st = stores.find(s => s.storeId === sid);
    const name = sid === 'general' ? 'General' : (st?.name || sid);
    return [name, String(v.count), fmtMoney(v.total)];
  }).sort((a, b) => Number(b[2].replace(/\D/g, '')) - Number(a[2].replace(/\D/g, '')));

  if (storeRows.length) {
    ensureSpace(50);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(10, 42, 74);
    doc.text('Desglose por tienda', 14, y);
    y += 6;

    doc.autoTable({
      startY: y,
      head: [['Tienda', 'Movimientos', 'Total gastos']],
      body: storeRows,
      theme: 'striped',
      headStyles: { fillColor: [74, 122, 154], textColor: 255 },
      bodyStyles: { fontSize: 10 },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 35, halign: 'center' },
        2: { cellWidth: 50, halign: 'right', fontStyle: 'bold' }
      },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ============================================================
  // 4. DESGLOSE POR CATEGORÍA
  // ============================================================
  const catNames = {
    arriendo:'Arriendo', servicios:'Servicios públicos', nomina:'Nómina',
    papeleria:'Papelería', transporte:'Transporte', publicidad:'Publicidad',
    mantenimiento:'Mantenimiento', impuestos:'Impuestos',
    mercancia:'Compra de mercancía', otros:'Otros'
  };

  const byCat = {};
  list.forEach(e => {
    if (e.status === 'anulado') return;
    const key = e.category || 'otros';
    if (!byCat[key]) byCat[key] = { total: 0, count: 0 };
    byCat[key].total += Number(e.total || 0);
    byCat[key].count += 1;
  });

  const catRows = Object.entries(byCat).map(([slug, v]) => [
    catNames[slug] || slug, String(v.count), fmtMoney(v.total)
  ]).sort((a, b) => Number(b[2].replace(/\D/g, '')) - Number(a[2].replace(/\D/g, '')));

  if (catRows.length) {
    ensureSpace(50);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(10, 42, 74);
    doc.text('Desglose por categoría', 14, y);
    y += 6;

    doc.autoTable({
      startY: y,
      head: [['Categoría', 'Movimientos', 'Total']],
      body: catRows,
      theme: 'striped',
      headStyles: { fillColor: [74, 122, 154], textColor: 255 },
      bodyStyles: { fontSize: 10 },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 35, halign: 'center' },
        2: { cellWidth: 50, halign: 'right', fontStyle: 'bold' }
      },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ============================================================
  // 5. ANÁLISIS POR PROVEEDOR
  // ============================================================
  const bySupplier = {};
  list.forEach(e => {
    if (e.status === 'anulado') return;
    const key = e.supplierName || e.provider || 'Sin proveedor';
    if (!bySupplier[key]) {
      bySupplier[key] = { invoices: 0, total: 0, paid: 0, pending: 0, overdue: 0 };
    }
    const s = bySupplier[key];
    const st = computeAccPaymentStatus(e);
    s.invoices += 1;
    s.total += Number(e.total || 0);
    if (st === 'paid') s.paid += Number(e.total || 0);
    else if (st === 'overdue') { s.overdue += Number(e.total || 0); s.pending += Number(e.total || 0); }
    else if (st === 'pending') s.pending += Number(e.total || 0);
  });

  const supplierRows = Object.entries(bySupplier)
    .map(([name, v]) => [name, String(v.invoices), fmtMoney(v.total), fmtMoney(v.paid), fmtMoney(v.pending), fmtMoney(v.overdue)])
    .sort((a, b) => Number(b[2].replace(/\D/g, '')) - Number(a[2].replace(/\D/g, '')));

  if (supplierRows.length) {
    ensureSpace(60);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(10, 42, 74);
    doc.text('Análisis por proveedor', 14, y);
    y += 6;

    doc.autoTable({
      startY: y,
      head: [['Proveedor', 'Facturas', 'Total', 'Pagado', 'Pendiente', 'Vencido']],
      body: supplierRows,
      theme: 'striped',
      headStyles: { fillColor: [74, 122, 154], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
        3: { cellWidth: 25, halign: 'right' },
        4: { cellWidth: 25, halign: 'right' },
        5: { cellWidth: 25, halign: 'right' }
      },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ============================================================
  // 6. DETALLE DE MOVIMIENTOS
  // ============================================================
  ensureSpace(40);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(10, 42, 74);
  doc.text(`Detalle de movimientos (${list.length})`, 14, y);
  y += 4;

  const detailRows = list.map(e => {
    const st = stores.find(s => s.storeId === e.storeId);
    const status = computeAccPaymentStatus(e);
    const statusLabels = { pending: 'Pendiente', paid: 'Pagado', overdue: 'Vencido', anulado: 'Anulado' };
    return [
      e.date || '',
      e.invoiceNumber || '',
      e.type === 'costo' ? 'Costo' : 'Gasto',
      (e.supplierName || e.provider || '').substring(0, 22),
      (e.concept || '').substring(0, 35),
      e.dueDate || '',
      statusLabels[status] || status,
      fmtMoney(e.total)
    ];
  });

  doc.autoTable({
    startY: y,
    head: [['Fecha','Factura','Tipo','Proveedor','Concepto','Vence','Estado','Total']],
    body: detailRows,
    theme: 'striped',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 7, cellPadding: 1.5 },
    bodyStyles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
    margin: { left: 8, right: 8 },
    tableWidth: 'wrap',
    columnStyles: {
      0: { cellWidth: 16, overflow: 'hidden' },
      1: { cellWidth: 20, overflow: 'hidden' },
      2: { cellWidth: 12, overflow: 'hidden' },
      3: { cellWidth: 30, overflow: 'hidden' },
      4: { cellWidth: 38, overflow: 'hidden' },
      5: { cellWidth: 16, overflow: 'hidden' },
      6: { cellWidth: 16, overflow: 'hidden' },
      7: { cellWidth: 22, halign: 'right', fontStyle: 'bold', overflow: 'hidden' }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        const v = data.cell.raw;
        if (v === 'Vencido') data.cell.styles.textColor = [220, 38, 38];
        else if (v === 'Pagado') data.cell.styles.textColor = [22, 163, 74];
        else if (v === 'Anulado') data.cell.styles.textColor = [120, 120, 120];
      }
    }
  });
  // ============================================================
  // Pie de página
  // ============================================================
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Smartec · Análisis Financiero · Página ${i} de ${totalPages}`,
      pageW / 2,
      pageH - 8,
      { align: 'center' }
    );
  }

  const filename = `smartec_financiero_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
};
/* ============================================================
   SOLICITUDES DE TRASLADO
============================================================ */

window.renderTransfers = () => {
  if (!$('transfers-tbody')) return;

  // Conectar filtros (solo la primera vez)
  const statusF = $('tr-filter-status');
  const typeF = $('tr-filter-type');
  if (statusF && !statusF.dataset.listeners) {
    statusF.dataset.listeners = '1';
    statusF.onchange = renderTransfers;
  }
  if (typeF && !typeF.dataset.listeners) {
    typeF.dataset.listeners = '1';
    typeF.onchange = renderTransfers;
  }

  const filterStatus = statusF?.value || 'pendiente';
  const filterType = typeF?.value || 'all';

  // Recolectar las 3 fuentes
  const transfersList = (transferRequestsAll || []).map(r => ({ ...r, _type: 'transfers' }));
  const devicesList = (deviceRequestsAll || []).map(r => ({ ...r, _type: 'devices' }));
  const attemptsList = (deviceAttemptsAll || []).map(r => ({ ...r, _type: 'attempts' }));

  // Los intentos usan "status" propio: pendiente por defecto si no tienen
  attemptsList.forEach(a => { if (!a.status) a.status = 'pendiente'; });

  const all = [...transfersList, ...devicesList, ...attemptsList];

  // KPIs (sobre TODAS las solicitudes sin filtro)
  const pending = all.filter(r => r.status === 'pendiente').length;
  const approved = all.filter(r => r.status === 'aprobada' || r.status === 'resuelto').length;
  const rejected = all.filter(r => r.status === 'rechazada').length;

  $('tr-kpi-pending').innerText = pending;
  $('tr-kpi-approved').innerText = approved;
  $('tr-kpi-rejected').innerText = rejected;
  $('tr-kpi-total').innerText = all.length;

  // Aplicar filtros
  let list = all.slice();
  if (filterType !== 'all') list = list.filter(r => r._type === filterType);
  if (filterStatus !== 'all') {
    // Normalizar "resuelto" como "aprobada" para el filtro
    const fs = filterStatus;
    list = list.filter(r => {
      const st = (r._type === 'attempts' && r.status === 'resuelto') ? 'aprobada' : r.status;
      return st === fs;
    });
  }

  list.sort((a,b) => {
    const tsA = a.createdAt?.seconds || a.timestamp?.seconds || 0;
    const tsB = b.createdAt?.seconds || b.timestamp?.seconds || 0;
    return tsB - tsA;
  });

  const tb = $('transfers-tbody');
  const empty = $('transfers-empty');

  if (!list.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    updateTransfersBadge();
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = list.slice(0, 300).map(r => {
    const status = r.status || 'pendiente';
    const statusCls = (status === 'aprobada' || status === 'resuelto') ? 'bg-green-100 text-green-700' :
                      status === 'rechazada' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700';
    const statusLbl = status === 'aprobada' ? 'Aprobada' :
                      status === 'resuelto' ? 'Resuelto' :
                      status === 'rechazada' ? 'Rechazada' : 'Pendiente';

    // ===== TRASLADO =====
    if (r._type === 'transfers') {
      const variantLabel = [r.colorName, r.size].filter(Boolean).join(' · ') || 'Estándar';
      return `<tr class="border-b hover:bg-gray-50 ${status === 'pendiente' ? 'bg-yellow-50/40' : ''}">
        <td class="p-3 text-center text-xl">📦</td>
        <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${fmtDate(r.createdAt)}</td>
        <td class="p-3 text-xs">
          <p class="font-semibold text-sd">${escapeHtml(r.productName)}</p>
          <p class="text-[10px] text-gray-400">${escapeHtml(variantLabel)} · ${escapeHtml(r.sku) || ''} · Cant: ${r.quantity}</p>
        </td>
        <td class="p-3 text-xs">
          ${escapeHtml(r.originStoreName)} <span class="text-gray-400">→</span> ${escapeHtml(r.destinationStoreName)}
        </td>
        <td class="p-3 text-xs">
          <p>${escapeHtml(r.requestedByName) || r.requestedByEmail || '-'}</p>
          ${r.note ? `<p class="text-[10px] text-gray-400 italic">"${escapeHtml(r.note)}"</p>` : ''}
        </td>
        <td class="p-3 text-center"><span class="text-[10px] px-2 py-0.5 rounded ${statusCls}">${statusLbl}</span></td>
        <td class="p-3 text-right whitespace-nowrap">
          ${status === 'pendiente' ? `
            <button onclick='approveTransfer("${r.id}")' class="text-green-600 hover:underline text-xs font-semibold mr-2">✅ Aprobar</button>
            <button onclick='rejectTransfer("${r.id}")' class="text-red-500 hover:underline text-xs">⛔ Rechazar</button>
          ` : `<button onclick='viewTransfer("${r.id}")' class="text-sl hover:underline text-xs">Ver</button>`}
        </td>
      </tr>`;
    }

    // ===== SOLICITUD DE DISPOSITIVO =====
    if (r._type === 'devices') {
      return `<tr class="border-b hover:bg-gray-50 ${status === 'pendiente' ? 'bg-blue-50/40' : ''}">
        <td class="p-3 text-center text-xl">📱</td>
        <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${fmtDate(r.createdAt)}</td>
        <td class="p-3 text-xs">
          <p class="font-semibold text-sd">${escapeHtml(r.deviceLabel) || 'Dispositivo'}</p>
          <p class="text-[10px] text-gray-400 font-mono">${escapeHtml((r.fingerprint||'').slice(0,16))}…</p>
          ${r.reason ? `<p class="text-[10px] text-gray-500 italic mt-0.5">"${escapeHtml(r.reason)}"</p>` : ''}
        </td>
        <td class="p-3 text-xs">—</td>
        <td class="p-3 text-xs">
          <p>${escapeHtml(r.userName) || escapeHtml(r.userEmail) || '-'}</p>
          <p class="text-[10px] text-gray-400">${escapeHtml(r.userEmail) || ''}</p>
        </td>
        <td class="p-3 text-center"><span class="text-[10px] px-2 py-0.5 rounded ${statusCls}">${statusLbl}</span></td>
        <td class="p-3 text-right whitespace-nowrap">
          ${status === 'pendiente' ? `
            <button onclick='approveDeviceRequest("${r.id}")' class="text-green-600 hover:underline text-xs font-semibold mr-2">✅ Aprobar</button>
            <button onclick='rejectDeviceRequest("${r.id}")' class="text-red-500 hover:underline text-xs">⛔ Rechazar</button>
          ` : `<button onclick='viewDeviceRequest("${r.id}")' class="text-sl hover:underline text-xs">Ver</button>`}
        </td>
      </tr>`;
    }

    // ===== INTENTO DE ACCESO =====
    if (r._type === 'attempts') {
      const reasonLbl = r.blockReason === 'autoApprove_disabled'
        ? 'Auto-aprobación desactivada'
        : r.blockReason === 'no_capacity'
          ? 'Sin cupo disponible'
          : 'Bloqueado';
      return `<tr class="border-b hover:bg-gray-50 ${status === 'pendiente' ? 'bg-amber-50/40' : ''}">
        <td class="p-3 text-center text-xl">⚠️</td>
        <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${fmtDate(r.timestamp)}</td>
        <td class="p-3 text-xs">
          <p class="font-semibold text-sd">${escapeHtml(r.deviceLabel) || 'Dispositivo desconocido'}</p>
          <p class="text-[10px] text-gray-400 font-mono">${escapeHtml((r.fingerprint||'').slice(0,16))}…</p>
          <p class="text-[10px] text-amber-700 mt-0.5">⚠️ ${reasonLbl}</p>
        </td>
        <td class="p-3 text-xs">—</td>
        <td class="p-3 text-xs">
          <p>${escapeHtml(r.userName) || escapeHtml(r.userEmail) || '-'}</p>
          <p class="text-[10px] text-gray-400">${escapeHtml(r.userEmail) || ''}</p>
          <p class="text-[10px] text-gray-400">${r.currentCount || 0} / ${r.maxDevices || 0} dispositivos</p>
        </td>
        <td class="p-3 text-center"><span class="text-[10px] px-2 py-0.5 rounded ${statusCls}">${statusLbl}</span></td>
        <td class="p-3 text-right whitespace-nowrap">
          ${status === 'pendiente' ? `
            <button onclick='resolveDeviceAttempt("${r.id}")' class="text-green-600 hover:underline text-xs font-semibold mr-2">✅ Marcar visto</button>
            <button onclick='viewDeviceAttempt("${r.id}")' class="text-sl hover:underline text-xs">Ver</button>
          ` : `<button onclick='viewDeviceAttempt("${r.id}")' class="text-sl hover:underline text-xs">Ver</button>`}
        </td>
      </tr>`;
    }

    return '';
  }).join('');
};

window.approveTransfer = async (id) => {
  const r = (transferRequestsAll || []).find(x => x.id === id);
  if (!r) return;

  if (!confirm(`¿Aprobar el traslado de ${r.quantity}× ${r.productName} de ${r.originStoreName} a ${r.destinationStoreName}?\n\nSe ejecutará el traslado de inventario inmediatamente.`)) return;

  try {
    // 1. Leer inventario origen y destino
    const originInvId = `${r.originStoreId}_${r.variantId}`;
    const destInvId = `${r.destinationStoreId}_${r.variantId}`;

    const originSnap = await getDoc(doc(db,'inventory',originInvId));
    const destSnap = await getDoc(doc(db,'inventory',destInvId));

    if (!originSnap.exists()) {
      return alert('⛔ No se encontró inventario en la tienda origen.');
    }

    const originStockBefore = Number(originSnap.data().stock || 0);
    if (originStockBefore < r.quantity) {
      return alert(`⛔ Stock insuficiente en origen. Disponible: ${originStockBefore}, solicitado: ${r.quantity}`);
    }

    const destStockBefore = destSnap.exists() ? Number(destSnap.data().stock || 0) : 0;
    const originStockAfter = originStockBefore - r.quantity;
    const destStockAfter = destStockBefore + r.quantity;

    // 2. Actualizar inventario origen
    await updateDoc(doc(db,'inventory',originInvId), {
      stock: originStockAfter,
      updatedAt: serverTimestamp()
    });

    // 3. Actualizar/crear inventario destino
    const originData = originSnap.data();
    if (destSnap.exists()) {
      await updateDoc(doc(db,'inventory',destInvId), {
        stock: destStockAfter,
        updatedAt: serverTimestamp()
      });
    } else {
      await setDoc(doc(db,'inventory',destInvId), {
        storeId: r.destinationStoreId,
        productId: r.productId,
        variantId: r.variantId,
        productName: r.productName,
        sku: r.sku,
        colorName: r.colorName || '',
        size: r.size || '',
        minStock: originData.minStock || 5,
        serials: [],
        stock: destStockAfter,
        updatedAt: serverTimestamp()
      });
    }

    // 4. Registrar movimientos
    await addDoc(collection(db,'inventoryMovements'), {
      storeId: r.originStoreId,
      productId: r.productId,
      variantId: r.variantId,
      sku: r.sku,
      productName: r.productName,
      type: 'traslado-salida',
      qtyBefore: originStockBefore,
      qtyAfter: originStockAfter,
      delta: -r.quantity,
      destinationStoreId: r.destinationStoreId,
      reason: `Solicitud de traslado aprobada (${r.requestedByName || r.requestedByEmail})`,
      transferRequestId: id,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      createdAt: serverTimestamp()
    });

    await addDoc(collection(db,'inventoryMovements'), {
      storeId: r.destinationStoreId,
      productId: r.productId,
      variantId: r.variantId,
      sku: r.sku,
      productName: r.productName,
      type: 'traslado-entrada',
      qtyBefore: destStockBefore,
      qtyAfter: destStockAfter,
      delta: r.quantity,
      originStoreId: r.originStoreId,
      reason: `Solicitud de traslado aprobada`,
      transferRequestId: id,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      createdAt: serverTimestamp()
    });

    // 5. Actualizar solicitud
    await updateDoc(doc(db,'transferRequests',id), {
      status: 'aprobada',
      approvedBy: currentUser.uid,
      approvedByEmail: currentUser.email,
      approvedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'transferRequests',
      docId: id,
      before: { status: r.status },
      after: { status: 'aprobada' },
      note: `Traslado aprobado: ${r.quantity}× ${r.productName} de ${r.originStoreName} a ${r.destinationStoreName}`
    });

        // 6. Invalidar caches (para que las demás pestañas se refresquen)
    window.SmartecCache.invalidate('transferRequests_all');
    window.SmartecCache.invalidate('inventory_all');
    window.SmartecCache.invalidate('inventory');
    window.SmartecCache.invalidate('products');
    window.SmartecCache.invalidatePrefix('inventory_');
    window.SmartecCache.invalidatePrefix('sales_');

    alert('✅ Traslado ejecutado correctamente.');
    await loadAll();

    // Refrescar vistas afectadas
    renderProducts();
    renderInventory();
    renderTransfers();
  } catch(e) {
    console.error(e);
    alert('Error: ' + e.message);
  }
};

window.rejectTransfer = async (id) => {
  const r = (transferRequestsAll || []).find(x => x.id === id);
  if (!r) return;

  const reason = prompt('Motivo del rechazo (obligatorio):');
  if (!reason || !reason.trim()) return alert('Debes escribir el motivo');

  try {
    await updateDoc(doc(db,'transferRequests',id), {
      status: 'rechazada',
      rejectedBy: currentUser.uid,
      rejectedByEmail: currentUser.email,
      rejectedAt: serverTimestamp(),
      rejectionReason: reason.trim()
    });

    await audit({
      action: 'update',
      collection: 'transferRequests',
      docId: id,
      before: { status: r.status },
      after: { status: 'rechazada', rejectionReason: reason.trim() },
      note: `Traslado rechazado: ${r.productName} (${reason.trim()})`
    });

    window.SmartecCache.invalidate('transferRequests_all');
    alert('✅ Solicitud rechazada.');
    await loadAll();
    renderTransfers();
  } catch(e) {
    console.error(e);
    alert('Error: ' + e.message);
  }
};

/* ============================================================
   🆕 APROBAR / RECHAZAR SOLICITUDES DE DISPOSITIVO
============================================================ */
window.approveDeviceRequest = async (id) => {
  const r = (deviceRequestsAll || []).find(x => x.id === id);
  if (!r) return;

  if (!confirm(
    `¿Aprobar la solicitud de dispositivo?\n\n` +
    `Usuario: ${r.userName || r.userEmail}\n` +
    `Dispositivo: ${r.deviceLabel || 'Desconocido'}\n` +
    `Motivo: "${r.reason || 'sin motivo'}"\n\n` +
    `Esto sumará +1 a "Máx. dispositivos" del usuario y autorizará este equipo.`
  )) return;

  try {
    // 1. Leer datos actuales del usuario
    const userRef = doc(db, 'users', r.userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      alert('⛔ El usuario ya no existe.');
      return;
    }
    const userData = userSnap.data();

    const currentMax = Number(userData.maxDevices || 0);
    const currentDevices = userData.authorizedDevices || [];

    // 2. Construir el nuevo dispositivo
    const newDevice = {
      fingerprint: r.fingerprint || 'unknown',
      label: r.deviceLabel || 'Dispositivo autorizado por admin',
      userAgent: r.userAgent || navigator.userAgent,
      registeredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      registeredBy: currentUser.email,
      approvedByAdmin: true,
      approvedFrom: 'deviceRequest'
    };

    // Evitar duplicados: si el fingerprint ya está, no lo agregamos
    const alreadyExists = currentDevices.some(d => d.fingerprint === newDevice.fingerprint);
    const updatedDevices = alreadyExists
      ? currentDevices
      : [...currentDevices, newDevice];

    // 3. Actualizar usuario (+1 al maxDevices)
    await updateDoc(userRef, {
      maxDevices: currentMax + 1,
      authorizedDevices: updatedDevices,
      updatedAt: serverTimestamp()
    });

    // 4. Marcar la solicitud como aprobada
    await updateDoc(doc(db, 'deviceRequests', id), {
      status: 'aprobada',
      approvedBy: currentUser.uid,
      approvedByEmail: currentUser.email,
      approvedAt: serverTimestamp()
    });

    // 5. Auditoría
    await audit({
      action: 'update',
      collection: 'deviceRequests',
      docId: id,
      before: { status: 'pendiente', maxDevices: currentMax },
      after: { status: 'aprobada', maxDevices: currentMax + 1 },
      note: `Dispositivo aprobado para ${userData.name || r.userEmail} · ${newDevice.label}`
    });

    // 6. Invalidar cache
    window.SmartecCache.invalidate('users');
    window.SmartecCache.invalidate('deviceRequests_all');

    alert('✅ Dispositivo autorizado y cupo aumentado.');
    renderTransfers();
  } catch (e) {
    console.error('Error aprobando dispositivo:', e);
    alert('Error: ' + e.message);
  }
};

window.rejectDeviceRequest = async (id) => {
  const r = (deviceRequestsAll || []).find(x => x.id === id);
  if (!r) return;

  const reason = prompt('Motivo del rechazo (obligatorio):');
  if (!reason || !reason.trim()) return alert('Debes escribir el motivo.');

  try {
    await updateDoc(doc(db, 'deviceRequests', id), {
      status: 'rechazada',
      rejectedBy: currentUser.uid,
      rejectedByEmail: currentUser.email,
      rejectedAt: serverTimestamp(),
      rejectionReason: reason.trim()
    });

    await audit({
      action: 'update',
      collection: 'deviceRequests',
      docId: id,
      before: { status: 'pendiente' },
      after: { status: 'rechazada', rejectionReason: reason.trim() },
      note: `Solicitud de dispositivo rechazada para ${r.userName || r.userEmail}: ${reason.trim()}`
    });

    window.SmartecCache.invalidate('deviceRequests_all');
    alert('✅ Solicitud rechazada.');
    renderTransfers();
  } catch (e) {
    console.error('Error rechazando dispositivo:', e);
    alert('Error: ' + e.message);
  }
};

window.viewDeviceRequest = (id) => {
  const r = (deviceRequestsAll || []).find(x => x.id === id);
  if (!r) return;
  alert(
    `Solicitud de dispositivo\n\n` +
    `Usuario: ${r.userName || r.userEmail}\n` +
    `Rol: ${r.userRole || '—'}\n` +
    `Tienda: ${r.storeId || '—'}\n` +
    `Dispositivo: ${r.deviceLabel || '—'}\n` +
    `Fingerprint: ${r.fingerprint || '—'}\n` +
    `Motivo: ${r.reason || '—'}\n` +
    `Estado: ${r.status}\n` +
    `Fecha: ${r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleString('es-CO') : '—'}` +
    (r.rejectionReason ? `\n\nMotivo del rechazo: ${r.rejectionReason}` : '')
  );
};

/* ============================================================
   🆕 INTENTOS DE ACCESO — Ver y marcar como visto
============================================================ */
window.viewDeviceAttempt = (id) => {
  const r = (deviceAttemptsAll || []).find(x => x.id === id);
  if (!r) return;

  const fecha = r.timestamp?.seconds
    ? new Date(r.timestamp.seconds * 1000).toLocaleString('es-CO')
    : (r.timestamp ? new Date(r.timestamp).toLocaleString('es-CO') : '—');

  const reasonLbl = r.blockReason === 'autoApprove_disabled'
    ? 'El usuario no tiene auto-aprobación activada. Todos los dispositivos nuevos requieren aprobación.'
    : r.blockReason === 'no_capacity'
      ? 'El usuario ya alcanzó su límite de dispositivos autorizados.'
      : 'Bloqueado por política de seguridad.';

  const statusLbl = r.status === 'resuelto' ? 'Resuelto' : 'Pendiente';

  alert(
    `⚠️ Intento de acceso bloqueado\n\n` +
    `Usuario: ${r.userName || r.userEmail}\n` +
    `Email: ${r.userEmail || '—'}\n` +
    `Rol: ${r.userRole || '—'}\n` +
    `Tienda: ${r.storeId || '—'}\n\n` +
    `Dispositivo: ${r.deviceLabel || 'Desconocido'}\n` +
    `Fingerprint: ${r.fingerprint || '—'}\n\n` +
    `Motivo del bloqueo: ${reasonLbl}\n` +
    `Dispositivos actuales: ${r.currentCount || 0} / ${r.maxDevices || 0}\n\n` +
    `Fecha del intento: ${fecha}\n` +
    `Estado: ${statusLbl}\n\n` +
    `User Agent: ${r.userAgent || '—'}`
  );
};

window.resolveDeviceAttempt = async (id) => {
  const r = (deviceAttemptsAll || []).find(x => x.id === id);
  if (!r) return;

  if (!confirm(
    `¿Marcar este intento como "visto"?\n\n` +
    `Usuario: ${r.userName || r.userEmail}\n` +
    `Dispositivo: ${r.deviceLabel || 'Desconocido'}\n\n` +
    `No autorizará el dispositivo, solo lo quita de la lista de pendientes.`
  )) return;

  try {
    await updateDoc(doc(db, 'deviceAttempts', id), {
      status: 'resuelto',
      resolvedBy: currentUser.uid,
      resolvedByEmail: currentUser.email,
      resolvedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'deviceAttempts',
      docId: id,
      before: { status: 'pendiente' },
      after: { status: 'resuelto' },
      note: `Intento de acceso marcado como visto: ${r.userName || r.userEmail} · ${r.deviceLabel || 'Dispositivo'}`
    });

    window.SmartecCache.invalidate('deviceAttempts_all');
    alert('✅ Intento marcado como visto.');
    renderTransfers();
  } catch (e) {
    console.error('Error resolviendo intento:', e);
    alert('Error: ' + e.message);
  }
};

window.viewTransfer = (id) => {
  const r = (transferRequestsAll || []).find(x => x.id === id);
  if (!r) return;

  const info = `
    Producto: ${r.productName}
    Variante: ${[r.colorName, r.size].filter(Boolean).join(' · ') || 'Estándar'}
    Cantidad: ${r.quantity}
    Origen: ${r.originStoreName}
    Destino: ${r.destinationStoreName}
    Solicitó: ${r.requestedByName || r.requestedByEmail}
    Estado: ${r.status}
    ${r.note ? `Nota: ${r.note}` : ''}
    ${r.rejectionReason ? `Motivo rechazo: ${r.rejectionReason}` : ''}
  `;
  alert(info);
};

/* ============================================================
   🆕 HISTORIAL DE DISPOSITIVOS (deviceHistory)
   ============================================================ */

// Cache local de eventos cargados
let _deviceHistoryCache = [];

/**
 * Carga y renderiza el historial de dispositivos.
 */
window.renderDeviceHistory = async function () {
  const tbody = document.getElementById('dh-tbody');
  const countEl = document.getElementById('dh-results-count');
  if (!tbody) return;

  // Bloquear durante la carga
  tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-gray-400 text-xs">⏳ Cargando...</td></tr>';
  if (countEl) countEl.innerText = '— eventos';

  try {
    // Solo superadmin puede leer todo el historial
    if (currentUserData?.role !== 'superadmin') {
      tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-gray-400 text-xs">Solo el superadmin puede ver el historial de dispositivos.</td></tr>';
      return;
    }

    // Traer los últimos 500 eventos (ordenados por fecha desc)
    const { orderBy, limit } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
    const q = query(
      collection(db, 'deviceHistory'),
      orderBy('createdAt', 'desc'),
      limit(500)
    );
    const snap = await getDocs(q);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    _deviceHistoryCache = list;

    // Poblar el filtro de usuarios (una sola vez si está vacío)
    populateDeviceHistoryUserFilter(list);

    // Aplicar filtros
    const filtered = applyDeviceHistoryFilters(list);

    // Contador
    if (countEl) {
      countEl.innerText = `${filtered.length} evento${filtered.length !== 1 ? 's' : ''} (de ${list.length} totales)`;
    }

    // Render
    renderDeviceHistoryTable(filtered);

  } catch (e) {
    console.error('Error cargando deviceHistory:', e);
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-red-500 text-xs">Error: ${e.message}</td></tr>`;
  }
};

/**
 * Pobla el selector de usuarios con los usuarios presentes en el historial.
 */
function populateDeviceHistoryUserFilter(list) {
  const sel = document.getElementById('dh-filter-user');
  if (!sel) return;

  // Si ya tiene más de 1 opción, no repoblar
  if (sel.options.length > 1) return;

  const map = new Map();
  list.forEach(ev => {
    if (ev.userEmail && !map.has(ev.userEmail)) {
      map.set(ev.userEmail, ev.userName || ev.userEmail);
    }
  });

  const sorted = Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));

  sorted.forEach(([email, name]) => {
    const opt = document.createElement('option');
    opt.value = email;
    opt.textContent = `${name} — ${email}`;
    sel.appendChild(opt);
  });

  // Listener (una sola vez)
  if (!sel.dataset.listeners) {
    sel.dataset.listeners = '1';
    sel.onchange = () => {
      const filtered = applyDeviceHistoryFilters(_deviceHistoryCache);
      const countEl = document.getElementById('dh-results-count');
      if (countEl) countEl.innerText = `${filtered.length} evento${filtered.length !== 1 ? 's' : ''}`;
      renderDeviceHistoryTable(filtered);
    };
  }
}

/**
 * Aplica los filtros al array de eventos.
 */
function applyDeviceHistoryFilters(list) {
  const actionF = document.getElementById('dh-filter-action')?.value || 'all';
  const userF = document.getElementById('dh-filter-user')?.value || 'all';
  const searchF = (document.getElementById('dh-search')?.value || '').toLowerCase().trim();

  let filtered = list.slice();

  if (actionF !== 'all') {
    filtered = filtered.filter(ev => ev.action === actionF);
  }

  if (userF !== 'all') {
    filtered = filtered.filter(ev => ev.userEmail === userF);
  }

  if (searchF) {
    filtered = filtered.filter(ev =>
      (ev.userName || '').toLowerCase().includes(searchF) ||
      (ev.userEmail || '').toLowerCase().includes(searchF) ||
      (ev.deviceLabel || '').toLowerCase().includes(searchF) ||
      (ev.reason || '').toLowerCase().includes(searchF)
    );
  }

  return filtered;
}

/**
 * Renderiza la tabla de eventos.
 */
function renderDeviceHistoryTable(list) {
  const tbody = document.getElementById('dh-tbody');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-gray-400 text-xs">Sin eventos con esos filtros.</td></tr>';
    return;
  }

  tbody.innerHTML = list.slice(0, 300).map(ev => {
    const action = ev.action || '—';
    const actionMeta = {
      register:      { label: '🆕 Registro', color: 'bg-green-100 text-green-700' },
      're-register': { label: '🔄 Re-registro', color: 'bg-blue-100 text-blue-700' },
      unlock:        { label: '🔐 Desbloqueo', color: 'bg-purple-100 text-purple-700' },
      pin_fallback:  { label: '🔢 PIN', color: 'bg-amber-100 text-amber-700' },
      release:       { label: '🗑 Liberación', color: 'bg-red-100 text-red-700' },
    }[action] || { label: action, color: 'bg-gray-100 text-gray-700' };

    const fecha = ev.createdAt?.seconds
      ? new Date(ev.createdAt.seconds * 1000).toLocaleString('es-CO', {
          day: '2-digit', month: '2-digit', year: '2-digit',
          hour: '2-digit', minute: '2-digit'
        })
      : '—';

    const user = ev.userName || ev.userEmail || '—';
    const device = ev.deviceLabel || '—';
    const reason = ev.reason || '—';

    return `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${fecha}</td>
        <td class="p-3">
          <span class="text-[10px] px-2 py-0.5 rounded ${actionMeta.color} font-semibold whitespace-nowrap">
            ${actionMeta.label}
          </span>
        </td>
        <td class="p-3 text-xs">
          <p class="font-medium text-sd truncate max-w-[180px]">${escapeHtml(user)}</p>
          <p class="text-[10px] text-gray-400 truncate max-w-[180px]">${escapeHtml(ev.userEmail) || ''}</p>
        </td>
        <td class="p-3 text-xs">
          <p class="truncate max-w-[180px]">${escapeHtml(device)}</p>
          <p class="text-[10px] text-gray-400 font-mono truncate max-w-[180px]">${escapeHtml((ev.deviceFingerprint || '').slice(0, 16))}…</p>
        </td>
        <td class="p-3 text-xs text-gray-600 max-w-md truncate">${escapeHtml(reason)}</td>
        <td class="p-3 text-right whitespace-nowrap">
          <button onclick='viewDeviceHistoryDetail("${ev.id}")' class="text-sl hover:underline text-xs">Ver →</button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Muestra el detalle de un evento del historial.
 */
window.viewDeviceHistoryDetail = function (id) {
  const ev = _deviceHistoryCache.find(x => x.id === id);
  if (!ev) return;

  const fecha = ev.createdAt?.seconds
    ? new Date(ev.createdAt.seconds * 1000).toLocaleString('es-CO')
    : '—';

  const actionLabels = {
    register: '🆕 Registro de huella',
    're-register': '🔄 Re-registro de huella',
    unlock: '🔐 Desbloqueo con huella',
    pin_fallback: '🔢 Uso de PIN como fallback',
    release: '🗑 Liberación de cupo'
  };

  const lines = [
    `Acción:       ${actionLabels[ev.action] || ev.action || '—'}`,
    `Fecha:        ${fecha}`,
    `Usuario:      ${ev.userName || ev.userEmail || '—'}`,
    `Email:        ${ev.userEmail || '—'}`,
    `Rol:          ${ev.userRole || '—'}`,
    `Tienda:       ${ev.storeId || '—'}`,
    ``,
    `Dispositivo:  ${ev.deviceLabel || '—'}`,
    `Fingerprint:  ${ev.deviceFingerprint || '—'}`,
    ``,
    `Credencial:   ${ev.credentialId || '—'}`,
    `Motivo:       ${ev.reason || '—'}`,
  ];

  if (ev.releasedBy) {
    lines.push('');
    lines.push(`Liberado por: ${ev.releasedByEmail || ev.releasedBy}`);
  }

  if (ev.userAgent) {
    lines.push('');
    lines.push(`User Agent:   ${ev.userAgent}`);
  }

  alert(lines.join('\n'));
};

/**
 * Configurar listeners de filtros (una sola vez).
 */
function setupDeviceHistoryListeners() {
  const actionSel = document.getElementById('dh-filter-action');
  const searchInput = document.getElementById('dh-search');

  if (actionSel && !actionSel.dataset.listeners) {
    actionSel.dataset.listeners = '1';
    actionSel.onchange = () => {
      const filtered = applyDeviceHistoryFilters(_deviceHistoryCache);
      const countEl = document.getElementById('dh-results-count');
      if (countEl) countEl.innerText = `${filtered.length} evento${filtered.length !== 1 ? 's' : ''}`;
      renderDeviceHistoryTable(filtered);
    };
  }

  if (searchInput && !searchInput.dataset.listeners) {
    searchInput.dataset.listeners = '1';
    let timer = null;
    searchInput.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const filtered = applyDeviceHistoryFilters(_deviceHistoryCache);
        const countEl = document.getElementById('dh-results-count');
        if (countEl) countEl.innerText = `${filtered.length} evento${filtered.length !== 1 ? 's' : ''}`;
        renderDeviceHistoryTable(filtered);
      }, 250);
    };
  }
}

// Configurar listeners apenas carga el script
setupDeviceHistoryListeners();

/* ============================================================
   EXPONER FUNCIONES DE PAGINACIÓN
============================================================ */
window.loadMoreSales = loadMoreSales;
window.loadMoreProducts = loadMoreProducts;
window.loadMoreInventory = loadMoreInventory;
window.loadMoreCashRegisters = loadMoreCashRegisters;
window.loadMoreShifts = loadMoreShifts;
window.loadMoreAudit = loadMoreAudit;