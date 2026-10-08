import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc,
  updateDoc, deleteDoc, serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject }
  from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

/* ============================================================
   CONFIG
   🆕 Config detectada automáticamente por firebase-config.js
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
const functions = getFunctions(app, firebaseConfig.functionsRegion || 'us-central1');

/* ============================================================
   ESTADO
============================================================ */
const EXPENSES_PAGE_SIZE = 100;
let expensesVisibleCount = EXPENSES_PAGE_SIZE;
let currentUser = null;
let currentUserData = null;
let currentStore = null;
let stores = [];
let expenses = [];
let categories = [];
let users = [];
let suppliers = [];
let conSettings = {
  defaultTermsDays: 30,
  defaultAlertDays: 5
};

const DEFAULT_CATEGORIES = [
  { slug:'arriendo', name:'Arriendo', type:'gasto' },
  { slug:'servicios', name:'Servicios públicos', type:'gasto' },
  { slug:'nomina', name:'Nómina', type:'gasto' },
  { slug:'papeleria', name:'Papelería', type:'gasto' },
  { slug:'transporte', name:'Transporte', type:'gasto' },
  { slug:'publicidad', name:'Publicidad', type:'gasto' },
  { slug:'mantenimiento', name:'Mantenimiento', type:'gasto' },
  { slug:'impuestos', name:'Impuestos', type:'gasto' },
  { slug:'mercancia', name:'Compra de mercancía', type:'costo' },
  { slug:'otros', name:'Otros', type:'gasto' }
];

const PAYMENT_TERMS = [
  { slug:'contado', label:'Contado (pago inmediato)', days: 0 },
  { slug:'net_15', label:'Net 15 días', days: 15 },
  { slug:'net_30', label:'Net 30 días', days: 30 },
  { slug:'net_45', label:'Net 45 días', days: 45 },
  { slug:'net_60', label:'Net 60 días', days: 60 },
  { slug:'net_90', label:'Net 90 días', days: 90 },
  { slug:'custom', label:'Personalizado (días específicos)', days: null }
];

const MAX_SUPPORTS = 3;

/* ============================================================
   HELPERS
============================================================ */
const $ = id => document.getElementById(id);
const fmt = n => '$' + Math.round(Number(n||0)).toLocaleString('es-CO');

/* ============================================================
   🆕 CARGA DIFERIDA DE LIBRERÍAS PESADAS (jsPDF, AutoTable)
   Se cargan SOLO cuando se llama a loadLazyLibs().
============================================================ */
const _lazyLoaded = { jspdf: false, autotable: false, exceljs: false };
const _lazyPromises = { jspdf: null, exceljs: null };

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

// Exponer global
window.loadLazyLibs = loadLazyLibs;

/* ============================================================
   🆕 RENDER DEL HEADER-APP
   Se llama desde onAuthStateChanged y desde el onchange del
   selector de tienda (para re-renderizar con la tienda actual).
============================================================ */
function renderHeaderApp() {
  if (!window.SmartecHeaderApp) return;
  if (!currentUser || !currentUserData) return;

  const settingsData = window.__conSettings || {};
  const isSuper = currentUserData.role === 'superadmin';

  // Tiendas activas (solo para superadmin)
  const activeStores = isSuper
    ? (stores || []).filter(s => s.active).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // Título contextual
  let titleText = 'Centro Contable';
  if (currentStore && currentStore.storeId !== 'all') {
    titleText = `Centro Contable · ${currentStore.name}`;
  } else if (isSuper && currentStore?.storeId === 'all') {
    titleText = 'Centro Contable · Todas las tiendas';
  }

  window.SmartecHeaderApp.render({
    settings: settingsData,
    user: {
      uid: currentUser.uid,
      email: currentUser.email,
      name: currentUserData.name || currentUser.email,
      role: currentUserData.role,
      storeId: currentUserData.storeId || null
    },
    stores: activeStores,
    currentStore: currentStore,
    showTitle: true,
    titleText: titleText,
    showRole: true,
    showShiftButton: true,       // 🆕 activado: contabilidad sí maneja turnos
    showSellerInfo: true,
    showHomeLink: true,
    showRefreshButton: true,
    showLogoutButton: true,
    showStoreSelector: isSuper,
    storeSelectorIncludeAll: true,
    extraLinks: [],
    onRefresh: () => { if (window.forceRefresh) window.forceRefresh(); },
    onLogout: async () => {
      if (window.SmartecKiosk) window.SmartecKiosk.disable();
      await audit({ action: 'logout', collection: 'system', note: 'Cierre de sesión' });
      window.SmartecDeviceGuard.clearValidatedToday();
      await signOut(auth);
      window.location.href = 'home.html';
    },
    onStoreChange: async (store) => {
      currentStore = store;
      sessionStorage.setItem('smartec_contab_store', store.storeId);
      await loadExpenses();
      await loadSuppliers();
      if (pucAccounts.length) {
        window.SmartecCache.invalidate('puc_cuentas_all');
        await loadPuc();
        pucVisibleCount = PUC_PAGE_SIZE;
        renderPuc();
      }
      // Recargar módulos si ya se habían cargado
      if (cartera.length) { await loadCartera(); renderCartera(); }
      if (activos.length) { await loadActivos(); renderActivos(); }
      if (empleados.length) { await loadEmpleados(); renderEmpleados(); }
      if (nominaPeriodos.length) { await loadNominaPeriodos(); renderNominaPeriodos(); }
      renderAll();
      renderHeaderApp();
    }
  });
}

const escapeHtml = window.Smartec?.escapeHtml || (s => String(s||''));
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const fmtDate = (ts) => {
  if (!ts) return '-';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return d.toLocaleDateString('es-CO', { year:'2-digit', month:'2-digit', day:'2-digit' });
};
const addDays = (dateStr, days) => {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const daysBetween = (dateStr1, dateStr2) => {
  const d1 = new Date(dateStr1 + 'T12:00:00');
  const d2 = new Date(dateStr2 + 'T12:00:00');
  return Math.round((d2 - d1) / (1000*60*60*24));
};

/* Determina el estado efectivo de un gasto al vuelo */
function computePaymentStatus(e) {
  if (e.status === 'anulado') return 'anulado';
  if (e.paidAt) return 'paid';
  if (!e.dueDate) return 'pending';
  const today = todayStr();
  if (e.dueDate < today) return 'overdue';
  return 'pending';
}

function paymentStatusBadge(status) {
  const map = {
    pending:  { cls: 'bg-amber-100 text-amber-700', lbl: '⏳ Pendiente' },
    paid:     { cls: 'bg-green-100 text-green-700', lbl: '✅ Pagado' },
    overdue:  { cls: 'bg-red-100 text-red-700',    lbl: '🔴 Vencido' },
    anulado:  { cls: 'bg-gray-200 text-gray-600',   lbl: '⚪ Anulado' }
  };
  const m = map[status] || map.pending;
  return `<span class="text-[10px] px-2 py-0.5 rounded ${m.cls} font-semibold whitespace-nowrap">${m.lbl}</span>`;
}

async function audit(entry) {
  try {
    await addDoc(collection(db,'auditLog'), {
      ...entry,
      userId: currentUser?.uid || null,
      userEmail: currentUser?.email || null,
      userRole: currentUserData?.role || null,
      storeId: currentStore?.storeId || null,
      timestamp: serverTimestamp()
    });
  } catch(e) { console.warn('audit fail', e); }
}

/* ============================================================
   AUTENTICACIÓN
============================================================ */
$('login-btn').onclick = async () => {
  const err = $('login-error');
  err.classList.add('hidden');
  try {
    await signInWithEmailAndPassword(auth, $('login-email').value.trim(), $('login-pass').value);
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
  document.getElementById('loading-screen').classList.add('hidden');

  if (!user) {
    window.location.href = 'home.html';
    return;
  }

  currentUser = user;
  try {
    const snap = await getDoc(doc(db,'users',user.uid));
    currentUserData = snap.exists() ? snap.data() : null;
  } catch(e) { currentUserData = null; }

  const validRoles = ['superadmin','admin'];
  if (!currentUserData || !validRoles.includes(currentUserData.role)) {
    alert('⛔ No tienes permisos para el centro contable.');
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
  await audit({ action:'login', collection:'system', note:'Inicio de sesión contabilidad' });

  $('login-screen').classList.add('hidden');
  $('panel-screen').classList.remove('hidden');

  // Cargar settings (logo)
  let settingsData = {};
  try {
    const setSnap = await getDoc(doc(db, 'settings', 'general'));
    settingsData = setSnap.exists() ? setSnap.data() : {};
  } catch (e) { console.warn('No se pudo cargar settings:', e); }

  window.__conSettings = settingsData;
  window.__conUserData = currentUserData;

  renderHeaderApp();

  await loadAll();
});

/* ============================================================
   SIDEBAR (control de apertura/cierre)
============================================================ */

/**
 * Abre/cierra el sidebar en móvil (por clase .open)
 * y el backdrop asociado.
 */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const isOpen = sidebar.classList.contains('open');

  if (isOpen) {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  } else {
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }
}

/**
 * Colapsa/expande el sidebar en desktop (por clase .collapsed).
 * En móvil no aplica (solo en pantallas grandes).
 */
function toggleSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');

  // Persistir la preferencia del usuario
  try {
    localStorage.setItem(
      'smartec_contab_sidebar_collapsed',
      sidebar.classList.contains('collapsed') ? '1' : '0'
    );
  } catch (e) { /* ignore */ }
}

/**
 * Restaura el estado del sidebar (colapsado o no) guardado
 * en localStorage. Se llama al cargar la página.
 */
function restoreSidebarState() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  try {
    const collapsed = localStorage.getItem('smartec_contab_sidebar_collapsed');
    if (collapsed === '1') sidebar.classList.add('collapsed');
  } catch (e) { /* ignore */ }
}

// Exponer en window para que los onclick del HTML las encuentren
window.toggleSidebar = toggleSidebar;
window.toggleSidebarCollapse = toggleSidebarCollapse;
window.restoreSidebarState = restoreSidebarState;

// Restaurar al cargar
document.addEventListener('DOMContentLoaded', restoreSidebarState);
if (document.readyState !== 'loading') restoreSidebarState();

/* ============================================================
   SIDEBAR · manejo de items como tabs
============================================================ */
/* ============================================================
   TABS (sidebar)
============================================================ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = async () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('tab-active');
    });
    btn.classList.add('tab-active');
    document.querySelectorAll('.tab-con-content').forEach(c => c.classList.add('hidden'));
    $('tab-' + btn.dataset.tab).classList.remove('hidden');

    // Cerrar el sidebar en móvil al cambiar de tab
    if (window.innerWidth < 1024) {
      const sidebar = document.getElementById('sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (backdrop) backdrop.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
      }
    }

    if (btn.dataset.tab === 'puc') {
      if (!pucAccounts.length) await loadPuc();
      renderPuc();
    }
    if (btn.dataset.tab === 'comprobantes') {
      if (!comprobantes.length) await loadComprobantes();
      renderComps();
    }
    if (btn.dataset.tab === 'mayor') {
      if (!comprobantes.length) await loadComprobantes();
      if (!pucAccounts.length) await loadPuc();
      if (!$('mayor-date-from').value) setMayorRange('month');
      else renderMayor();
    }
    if (btn.dataset.tab === 'balance') {
      if (!comprobantes.length) await loadComprobantes();
      if (!pucAccounts.length) await loadPuc();
      if (!$('bal-date-from').value) setBalRange('month');
      else renderBalance();
    }
    if (btn.dataset.tab === 'estado') {
      if (!comprobantes.length) await loadComprobantes();
      if (!pucAccounts.length) await loadPuc();
      if (!$('est-date').value) setEstDate('today');
      else renderEstado();
    }
    if (btn.dataset.tab === 'conciliacion') {
      if (!comprobantes.length) await loadComprobantes();
      if (!pucAccounts.length) await loadPuc();
      if (!conciliaciones.length) await loadConciliaciones();
      populateConcFilters();
      renderConciliaciones();
    }
    if (btn.dataset.tab === 'cartera') {
      if (!cartera.length) await loadCartera();
      renderCartera();
    }
    if (btn.dataset.tab === 'activos') {
      if (!pucAccounts.length) await loadPuc();
      if (!activos.length) await loadActivos();
      renderActivos();
    }
    if (btn.dataset.tab === 'nomina') {
      if (!pucAccounts.length) await loadPuc();
      await loadNominaParams();
      if (!empleados.length) await loadEmpleados();
      if (!nominaPeriodos.length) await loadNominaPeriodos();
      renderEmpleados();
      renderNominaPeriodos();
      switchNomSubtab('emp');
    }
    if (btn.dataset.tab === 'auxiliares') {
      if (!pucAccounts.length) await loadPuc();
      if (!comprobantes.length) await loadComprobantes();
      populateAuxAccountSelect();
      if (!$('aux-date-from').value) setAuxRange('month');
      else renderAux();
    }
    if (btn.dataset.tab === 'suppliers') renderSuppliers();
    if (btn.dataset.tab === 'mayoristas') renderWholesale();
    if (btn.dataset.tab === 'cotizaciones') {
      if (!wholesaleQuotes.length) await loadWholesaleQuotes();
      renderQuotes();
    }
    if (btn.dataset.tab === 'settings') renderSettingsTab();
  };
});

/* ============================================================
   MAYORISTAS — ESTADO
============================================================ */
let wholesaleCustomers = [];   // Clientes con isWholesale === true

let wholesaleQuotes = [];      // Cotizaciones de mayoristas
let _cotDetailId = null;       // ID de la cotización abierta en modal

let editingWholesaleId = null;   // ID del cliente que se está editando (null = nuevo)

/* Condiciones de pago (reutiliza las ya existentes PAYMENT_TERMS) */
const MAY_PAYMENT_TERMS = PAYMENT_TERMS; // alias por claridad

/* ============================================================
   MAYORISTAS — CARGA
   Trae todos los clientes mayoristas (isWholesale: true) desde customers.
   Filtra por tienda actual si no es superadmin en "all".
============================================================ */
async function loadWholesaleCustomers() {
  const C = window.SmartecCache;

  const all = await C.wrap('customers_all', async () => {
    const s = await getDocs(collection(db, 'customers'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  // Filtrar solo mayoristas
  let list = all.filter(c => c.isWholesale === true);

  // Filtro por tienda (igual que hace expenses/cartera)
  const isSuper = currentUserData.role === 'superadmin';
  const isAllStores = isSuper && currentStore?.storeId === 'all';

  if (!isAllStores) {
    list = list.filter(c =>
      c.storeId === currentStore.storeId || c.storeId === 'general' || !c.storeId
    );
  }
  wholesaleCustomers = list;

  // 🧪 DEBUG temporal: expone la lista a window para verificarla desde consola
  window.__wholesaleCustomers = wholesaleCustomers;
}

/* ============================================================
   COTIZACIONES MAYORISTAS — Carga
============================================================ */
async function loadWholesaleQuotes() {
  const C = window.SmartecCache;

  try {
    const all = await C.wrap('wholesaleQuotes_all', async () => {
      const s = await getDocs(collection(db, 'wholesaleQuotes'));
      return s.docs.map(d => ({ id: d.id, ...d.data() }));
    });

    // Ordenar por fecha desc
    wholesaleQuotes = all.sort((a, b) => {
      const ta = a.createdAt?.seconds || 0;
      const tb = b.createdAt?.seconds || 0;
      return tb - ta;
    });

    // Actualizar badge del sidebar
    updateQuotesBadge();

  } catch (e) {
    console.warn('[Contab] No se pudieron cargar cotizaciones:', e);
    wholesaleQuotes = [];
  }
}

/**
 * Actualiza el badge rojo del sidebar con el # de pendientes.
 */
function updateQuotesBadge() {
  const badge = document.getElementById('cotizaciones-badge');
  if (!badge) return;

  const pending = wholesaleQuotes.filter(q => q.status === 'pendiente').length;
  if (pending > 0) {
    badge.classList.remove('hidden');
    badge.innerText = pending > 99 ? '99+' : pending;
  } else {
    badge.classList.add('hidden');
  }
}

/* ============================================================
   COTIZACIONES MAYORISTAS — Render
============================================================ */

/**
 * Renderiza los KPIs arriba de la tabla.
 */
function renderQuotesKPIs() {
  const el = document.getElementById('cot-kpis');
  if (!el) return;

  const total = wholesaleQuotes.length;
  const pendientes = wholesaleQuotes.filter(q => q.status === 'pendiente').length;
  const aprobadas = wholesaleQuotes.filter(q => q.status === 'aprobada' || q.status === 'convertida').length;
  const rechazadas = wholesaleQuotes.filter(q => q.status === 'rechazada').length;

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">📋 Total cotizaciones</p>
      <p class="text-2xl font-bold text-[#0071E3] mt-1">${total}</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">⏳ Pendientes</p>
      <p class="text-2xl font-bold text-[#FF9F0A] mt-1">${pendientes}</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">✅ Aprobadas</p>
      <p class="text-2xl font-bold text-[#30D158] mt-1">${aprobadas}</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">⛔ Rechazadas</p>
      <p class="text-2xl font-bold text-[#0A2A4A] mt-1">${rechazadas}</p>
    </div>
  `;
}

/**
 * Badge de estado de la cotización.
 */
function quoteStatusBadge(status) {
  const map = {
    pendiente:  { cls: 'bg-amber-100 text-amber-700',  lbl: '⏳ Pendiente' },
    aprobada:   { cls: 'bg-green-100 text-green-700',  lbl: '✅ Aprobada' },
    rechazada:  { cls: 'bg-red-100 text-red-700',      lbl: '⛔ Rechazada' },
    convertida: { cls: 'bg-blue-100 text-blue-700',    lbl: '💰 Convertida' }
  };
  const m = map[status] || map.pendiente;
  return `<span class="text-[10px] px-2 py-0.5 rounded ${m.cls} font-semibold whitespace-nowrap">${m.lbl}</span>`;
}

/**
 * Renderiza la tabla de cotizaciones.
 */
function renderQuotesTable() {
  const tb = document.getElementById('cot-tbody');
  const empty = document.getElementById('cot-empty');
  if (!tb) return;

  // Filtros
  const statusF = document.getElementById('cot-filter-status')?.value || 'all';
  const fromF = document.getElementById('cot-date-from')?.value || '';
  const toF = document.getElementById('cot-date-to')?.value || '';
  const searchF = (document.getElementById('cot-search')?.value || '').toLowerCase().trim();

  let list = wholesaleQuotes.slice();

  if (statusF !== 'all') {
    list = list.filter(q => q.status === statusF);
  }

  if (fromF) {
    const fromTs = new Date(fromF + 'T00:00:00').getTime() / 1000;
    list = list.filter(q => (q.createdAt?.seconds || 0) >= fromTs);
  }
  if (toF) {
    const toTs = new Date(toF + 'T23:59:59').getTime() / 1000;
    list = list.filter(q => (q.createdAt?.seconds || 0) <= toTs);
  }

  if (searchF) {
    list = list.filter(q =>
      (q.companyName || '').toLowerCase().includes(searchF) ||
      (q.nit || '').toLowerCase().includes(searchF) ||
      (q.customerName || '').toLowerCase().includes(searchF) ||
      (q.email || '').toLowerCase().includes(searchF)
    );
  }

  if (!list.length) {
    tb.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  tb.innerHTML = list.slice(0, 200).map(q => {
    const fecha = q.createdAt?.seconds
      ? new Date(q.createdAt.seconds * 1000).toLocaleString('es-CO', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '—';

    const deliveryLabel = q.deliveryDate
      ? new Date(q.deliveryDate + 'T12:00:00').toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit' })
      : '—';

    return `<tr class="border-b hover:bg-gray-50 ${q.status === 'pendiente' ? 'bg-amber-50/30' : ''}">
      <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${fecha}</td>
      <td class="p-3 text-xs">
        <p class="font-semibold text-sd">${escapeHtml(q.companyName) || '—'}</p>
        <p class="text-[10px] text-gray-400 font-mono">${escapeHtml(q.nit) || '—'}</p>
      </td>
      <td class="p-3 text-xs">
        <p>${escapeHtml(q.customerName) || '—'}</p>
        <p class="text-[10px] text-gray-400">${escapeHtml(q.phone) || ''}</p>
      </td>
      <td class="p-3 text-center text-xs font-semibold">${q.totalQty || 0}</td>
      <td class="p-3 text-right text-xs font-bold text-sd">${fmt(q.totalAmount || 0)}</td>
      <td class="p-3 text-center text-xs">${deliveryLabel}</td>
      <td class="p-3 text-center">${quoteStatusBadge(q.status)}</td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewQuoteDetail("${q.id}")' class="text-sl hover:underline text-xs font-semibold">Ver</button>
      </td>
    </tr>`;
  }).join('');
}

/**
 * Render principal.
 */
function renderQuotes() {
  renderQuotesKPIs();
  renderQuotesTable();
}

window.renderQuotes = renderQuotes;
window.loadWholesaleQuotes = loadWholesaleQuotes;

/**
 * Limpiar filtros.
 */
window.clearCotFilters = () => {
  const ids = ['cot-search', 'cot-filter-status', 'cot-date-from', 'cot-date-to'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'cot-filter-status') el.value = 'all';
    else el.value = '';
  });
  renderQuotes();
};

/* ============================================================
   COTIZACIONES MAYORISTAS — Modal detalle
============================================================ */
window.viewQuoteDetail = (id) => {
  const q = wholesaleQuotes.find(x => x.id === id);
  if (!q) return;

  _cotDetailId = id;

  const fecha = q.createdAt?.seconds
    ? new Date(q.createdAt.seconds * 1000).toLocaleString('es-CO')
    : '—';

  const itemsHtml = (q.items || []).map(it => {
    const variantParts = [it.colorName, it.size].filter(Boolean).join(' · ');
    return `
      <div class="flex justify-between items-start gap-2 border-b border-gray-100 py-2 last:border-0">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-sd">${escapeHtml(it.name)}</p>
          <p class="text-[10px] text-gray-400 font-mono">${escapeHtml(it.sku) || '—'}</p>
          ${variantParts ? `<p class="text-[10px] text-gray-400">${escapeHtml(variantParts)}</p>` : ''}
        </div>
        <div class="text-right whitespace-nowrap">
          <p class="text-[10px] text-gray-500">${it.qty} × ${fmt(it.unitPrice)}</p>
          <p class="text-xs font-bold text-sl">${fmt(it.subtotal)}</p>
        </div>
      </div>
    `;
  }).join('');

  const isPending = q.status === 'pendiente';

  document.getElementById('cot-detail-body').innerHTML = `
    <!-- Header -->
    <div class="flex justify-between items-start mb-4 flex-wrap gap-3">
      <div>
        <p class="text-xs text-gray-400 font-mono">${fecha}</p>
        <p class="text-lg font-bold text-sd">${escapeHtml(q.companyName) || '—'}</p>
        <p class="text-xs text-gray-500 font-mono">NIT: ${escapeHtml(q.nit) || '—'}</p>
      </div>
      ${quoteStatusBadge(q.status)}
    </div>

    <!-- Info -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
      <div><p class="text-xs text-gray-400">Contacto</p><p class="font-semibold">${escapeHtml(q.customerName) || '—'}</p></div>
      <div><p class="text-xs text-gray-400">Teléfono</p><p class="font-semibold">${escapeHtml(q.phone) || '—'}</p></div>
      <div><p class="text-xs text-gray-400">Email</p><p class="font-semibold text-xs break-all">${escapeHtml(q.email) || '—'}</p></div>
      <div><p class="text-xs text-gray-400">Entrega deseada</p><p class="font-semibold">${q.deliveryDate || '—'}</p></div>
    </div>

    <!-- Items -->
    <div class="border border-gray-200 rounded-2xl p-3 mb-4">
      <p class="text-xs font-bold text-sd mb-2">📦 Productos (${(q.items || []).length})</p>
      ${itemsHtml}
      <div class="border-t border-gray-200 pt-2 mt-2 flex justify-between items-center">
        <span class="text-sm font-semibold">TOTAL</span>
        <span class="text-lg font-bold text-sl">${fmt(q.totalAmount || 0)}</span>
      </div>
    </div>

    <!-- Notas -->
    ${q.notes ? `
      <div class="bg-yellow-50 border border-yellow-200 rounded-2xl p-3 text-xs mb-4">
        <p class="font-bold text-yellow-700 mb-1">📝 Notas del mayorista</p>
        <p class="text-yellow-800">${escapeHtml(q.notes)}</p>
      </div>
    ` : ''}

    <!-- Acciones -->
    ${isPending ? `
      <div class="border-t pt-4">
        <p class="text-xs font-semibold text-sd mb-2">Acciones</p>
        <textarea id="cot-action-reason" rows="2" placeholder="Motivo (obligatorio si rechazas)" class="w-full px-3 py-2 border rounded-lg text-sm mb-3"></textarea>
        <div class="grid grid-cols-2 gap-3">
          <button onclick="approveQuote('${q.id}')" class="bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 font-semibold text-sm">
            ✅ Aprobar cotización
          </button>
          <button onclick="rejectQuote('${q.id}')" class="bg-red-500 text-white py-2.5 rounded-lg hover:bg-red-600 font-semibold text-sm">
            ⛔ Rechazar
          </button>
        </div>
      </div>
    ` : `
      <div class="border-t pt-4 text-xs text-gray-500">
        ${q.reviewedBy ? `<p>Revisada por: <b>${escapeHtml(q.reviewedBy)}</b></p>` : ''}
        ${q.reviewedAt ? `<p>Fecha: ${q.reviewedAt.seconds ? new Date(q.reviewedAt.seconds * 1000).toLocaleString('es-CO') : '—'}</p>` : ''}
        ${q.reviewNotes ? `<p class="mt-2 italic">"${escapeHtml(q.reviewNotes)}"</p>` : ''}
      </div>
    `}
  `;

  const modal = document.getElementById('cot-detail-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
};

window.closeCotDetail = () => {
  const modal = document.getElementById('cot-detail-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  _cotDetailId = null;
};

/* ============================================================
   COTIZACIONES MAYORISTAS — Acciones
============================================================ */
window.approveQuote = async (id) => {
  const q = wholesaleQuotes.find(x => x.id === id);
  if (!q) return;

  const reason = (document.getElementById('cot-action-reason')?.value || '').trim();

  if (!confirm(`¿Aprobar la cotización de ${q.companyName}?\n\nTotal: ${fmt(q.totalAmount)}\n\nSe marcará como aprobada.`)) return;

  try {
    await updateDoc(doc(db, 'wholesaleQuotes', id), {
      status: 'aprobada',
      reviewedBy: currentUser?.email || null,
      reviewedAt: serverTimestamp(),
      reviewNotes: reason || 'Aprobada sin observaciones',
      updatedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'wholesaleQuotes',
      docId: id,
      before: { status: q.status },
      after: { status: 'aprobada' },
      note: `Cotización aprobada: ${q.companyName} · ${fmt(q.totalAmount)}`
    });

    window.SmartecCache.invalidate('wholesaleQuotes_all');
    await loadWholesaleQuotes();
    renderQuotes();
    closeCotDetail();

    alert('✅ Cotización aprobada');
  } catch (e) {
    console.error('Error aprobando cotización:', e);
    alert('Error: ' + e.message);
  }
};

window.rejectQuote = async (id) => {
  const q = wholesaleQuotes.find(x => x.id === id);
  if (!q) return;

  const reason = (document.getElementById('cot-action-reason')?.value || '').trim();

  if (!reason) {
    alert('Debes escribir el motivo del rechazo.');
    return;
  }

  if (!confirm(`¿Rechazar la cotización de ${q.companyName}?\n\nMotivo: ${reason}`)) return;

  try {
    await updateDoc(doc(db, 'wholesaleQuotes', id), {
      status: 'rechazada',
      reviewedBy: currentUser?.email || null,
      reviewedAt: serverTimestamp(),
      reviewNotes: reason,
      updatedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'wholesaleQuotes',
      docId: id,
      before: { status: q.status },
      after: { status: 'rechazada', reviewNotes: reason },
      note: `Cotización rechazada: ${q.companyName} · Motivo: ${reason}`
    });

    window.SmartecCache.invalidate('wholesaleQuotes_all');
    await loadWholesaleQuotes();
    renderQuotes();
    closeCotDetail();

    alert('⛔ Cotización rechazada');
  } catch (e) {
    console.error('Error rechazando cotización:', e);
    alert('Error: ' + e.message);
  }
};

/* ============================================================
   MAYORISTAS — RENDER: KPIs
============================================================ */
function renderWholesaleStats() {
  const el = $('may-kpis');
  if (!el) return;

  const list = wholesaleCustomers;

  const total = list.length;
  const activos = list.filter(c => (c.wholesale?.status || 'activo') === 'activo').length;
  const suspendidos = list.filter(c => c.wholesale?.status === 'suspendido').length;
  const morosos = list.filter(c => c.wholesale?.status === 'moroso').length;

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">🏢 Total mayoristas</p>
      <p class="text-2xl font-bold text-[#0071E3] mt-1">${total}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Registrados en el sistema</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">✅ Activos</p>
      <p class="text-2xl font-bold text-[#30D158] mt-1">${activos}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Con acceso al catálogo</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">⏸️ Suspendidos</p>
      <p class="text-2xl font-bold text-[#FF9F0A] mt-1">${suspendidos}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Acceso bloqueado</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">🔴 Morosos</p>
      <p class="text-2xl font-bold text-[#0A2A4A] mt-1">${morosos}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Con cartera vencida</p>
    </div>
  `;
}

/* ============================================================
   MAYORISTAS — RENDER: Tabla
============================================================ */
function renderWholesaleTable() {
  const tb = $('may-tbody');
  const empty = $('may-empty');
  if (!tb) return;

  // Aplicar filtros
  const statusF = $('may-filter-status')?.value || 'all';
  const termsF = $('may-filter-terms')?.value || 'all';
  const orderF = $('may-filter-order')?.value || 'date';
  const searchF = ($('may-search')?.value || '').toLowerCase().trim();

  let list = wholesaleCustomers.slice();

  // Filtro por estado
  if (statusF !== 'all') {
    list = list.filter(c => (c.wholesale?.status || 'activo') === statusF);
  }

  // Filtro por condición de pago
  if (termsF !== 'all') {
    list = list.filter(c => c.wholesale?.paymentTerms === termsF);
  }

  // Búsqueda
  if (searchF) {
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(searchF) ||
      (c.wholesale?.companyName || '').toLowerCase().includes(searchF) ||
      (c.wholesale?.nit || '').toLowerCase().includes(searchF) ||
      (c.email || '').toLowerCase().includes(searchF)
    );
  }

  // Ordenar
  if (orderF === 'name') {
    list.sort((a, b) => (a.wholesale?.companyName || a.name || '').localeCompare(b.wholesale?.companyName || b.name || ''));
  } else if (orderF === 'total') {
    list.sort((a, b) => Number(b.totalSpent || 0) - Number(a.totalSpent || 0));
  } else {
    // date (más recientes primero)
    list.sort((a, b) => {
      const ta = a.wholesale?.approvedAt?.seconds || a.createdAt?.seconds || 0;
      const tb2 = b.wholesale?.approvedAt?.seconds || b.createdAt?.seconds || 0;
      return tb2 - ta;
    });
  }

  // Empty
  if (!list.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    empty.innerText = wholesaleCustomers.length
      ? 'Sin mayoristas que coincidan con los filtros.'
      : 'Sin mayoristas registrados. Haz clic en "+ Nuevo mayorista" para crear el primero.';
    return;
  }
  empty.classList.add('hidden');

  // Badges
  const statusBadge = (status) => {
    const map = {
      activo:     { cls: 'bg-green-100 text-green-700',   lbl: '✅ Activo' },
      suspendido: { cls: 'bg-amber-100 text-amber-700',   lbl: '⏸️ Suspendido' },
      moroso:     { cls: 'bg-red-100 text-red-700',       lbl: '🔴 Moroso' }
    };
    const m = map[status] || map.activo;
    return `<span class="text-[10px] px-2 py-0.5 rounded ${m.cls} font-semibold whitespace-nowrap">${m.lbl}</span>`;
  };

  const termsLabel = (slug, customDays) => {
    if (slug === 'custom' && customDays) return `Personalizado (${customDays}d)`;
    const map = {
      contado: 'Contado',
      net_15: 'Net 15',
      net_30: 'Net 30',
      net_45: 'Net 45',
      net_60: 'Net 60',
      net_90: 'Net 90'
    };
    return map[slug] || (slug || '—');
  };

  tb.innerHTML = list.map(c => {
    const w = c.wholesale || {};
    const status = w.status || 'activo';
    const company = w.companyName || c.name || '—';
    const nit = w.nit || '—';
    const contactName = c.name || '—';
    const phone = c.phone || '';
    const email = c.email || '';
    const totalSpent = Number(c.totalSpent || 0);
    const purchaseCount = Number(c.purchaseCount || 0);

    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs">
        <div class="font-semibold text-sd">${escapeHtml(company)}</div>
        ${w.companyName && c.name ? `<div class="text-[10px] text-gray-400">${escapeHtml(c.name)}</div>` : ''}
      </td>
      <td class="p-3 text-xs font-mono">${escapeHtml(nit)}</td>
      <td class="p-3 text-xs">
        ${contactName && contactName !== company ? `<div class="font-medium">${escapeHtml(contactName)}</div>` : ''}
        ${phone ? `<div class="text-[10px] text-gray-500">📞 ${escapeHtml(phone)}</div>` : ''}
        ${email ? `<div class="text-[10px] text-gray-500">✉️ ${escapeHtml(email)}</div>` : ''}
      </td>
      <td class="p-3 text-center text-xs">${escapeHtml(termsLabel(w.paymentTerms, w.customTermsDays))}</td>
      <td class="p-3 text-right text-xs font-mono font-bold text-sd">${fmt(totalSpent)}</td>
      <td class="p-3 text-center text-xs">${purchaseCount}</td>
      <td class="p-3 text-center">${statusBadge(status)}</td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewWholesale("${c.id}")' class="text-sl hover:underline text-xs mr-2">Ver</button>
        <button onclick='editWholesale("${c.id}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
        <button onclick='toggleWholesaleStatus("${c.id}")' class="text-${status === 'activo' ? 'orange' : 'green'}-500 hover:underline text-xs mr-2">${status === 'activo' ? 'Suspender' : 'Activar'}</button>
        <button onclick='deleteWholesale("${c.id}")' class="text-red-500 hover:underline text-xs">Eliminar</button>
      </td>
    </tr>`;
  }).join('');
}

/* ============================================================
   MAYORISTAS — Render principal
============================================================ */
function renderWholesale() {
  renderWholesaleStats();
  renderWholesaleTable();
}

window.renderWholesale = renderWholesale;

/* Limpiar filtros */
window.clearMayFilters = () => {
  const ids = ['may-search', 'may-filter-status', 'may-filter-terms', 'may-filter-order'];
  ids.forEach(id => {
    const el = $(id);
    if (!el) return;
    if (id === 'may-search') el.value = '';
    else if (id === 'may-filter-status') el.value = 'all';
    else if (id === 'may-filter-terms') el.value = 'all';
    else if (id === 'may-filter-order') el.value = 'date';
  });
  renderWholesale();
};

/* ============================================================
   MAYORISTAS — Formulario (crear / editar)
============================================================ */

window.openWholesaleForm = () => {
  if (!canEditPuc()) return;   // misma restricción que PUC: no en "Todas las tiendas"
  editingWholesaleId = null;
  $('may-modal-title').innerText = 'Nuevo mayorista';
  $('may-modal-subtitle').innerText = 'Se creará la cuenta de acceso al catálogo B2B';
  renderWholesaleForm({});
  const m = $('may-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeWholesaleForm = () => {
  const m = $('may-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingWholesaleId = null;
};

window.editWholesale = (id) => {
  const c = wholesaleCustomers.find(x => x.id === id);
  if (!c) return;
  if (!canEditPuc()) return;
  editingWholesaleId = id;
  $('may-modal-title').innerText = 'Editar mayorista';
  $('may-modal-subtitle').innerText = escapeHtml(c.wholesale?.companyName || c.name || 'Mayorista');
  renderWholesaleForm(c);
  const m = $('may-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

function renderWholesaleForm(v) {
  const w = v.wholesale || {};
  const isNew = !editingWholesaleId;

  const termsOpts = MAY_PAYMENT_TERMS.map(t =>
    `<option value="${t.slug}" ${(w.paymentTerms || 'net_30') === t.slug ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  const statusOpts = ['activo','suspendido','moroso'].map(s => {
    const lbl = { activo: '✅ Activo', suspendido: '⏸️ Suspendido', moroso: '🔴 Moroso' }[s];
    return `<option value="${s}" ${(w.status || 'activo') === s ? 'selected' : ''}>${lbl}</option>`;
  }).join('');

  $('may-modal-body').innerHTML = `
    ${isNew ? `
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
        <p class="font-semibold mb-1">📧 La cuenta de acceso se creará automáticamente</p>
        <p class="text-blue-600">Se enviará al correo un usuario Firebase Auth con la contraseña que definas.</p>
      </div>
    ` : `
      <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-xs text-gray-700">
        <p class="font-semibold mb-1">📧 Cuenta existente</p>
        <p>Email de acceso: <b>${escapeHtml(v.email) || '—'}</b> (no se puede cambiar desde aquí)</p>
      </div>
    `}

    <!-- Empresa -->
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Razón social / Empresa *</label>
        <input id="may-company" type="text" value="${escapeHtml(w.companyName) || ''}" placeholder="Ej: Distribuidora XYZ S.A.S." class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">NIT *</label>
        <input id="may-nit" type="text" value="${escapeHtml(w.nit) || ''}" placeholder="900123456-7" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono">
      </div>
    </div>

    <!-- Contacto -->
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Nombre del contacto *</label>
        <input id="may-name" type="text" value="${escapeHtml(v.name) || ''}" placeholder="Ej: Juan Pérez" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Teléfono *</label>
        <input id="may-phone" type="text" value="${escapeHtml(v.phone) || ''}" placeholder="3001234567" class="w-full px-3 py-2 border rounded-lg mt-1">
        <p class="text-[10px] text-gray-400 mt-1">Se usa como ID único del cliente.</p>
      </div>
    </div>

    <!-- Email + Password (solo en nuevo) -->
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Email de acceso *</label>
        <input id="may-email" type="email" value="${escapeHtml(v.email) || ''}" placeholder="contacto@empresa.com" class="w-full px-3 py-2 border rounded-lg mt-1" ${!isNew ? 'disabled' : ''}>
        ${!isNew ? '<p class="text-[10px] text-gray-400 mt-1">No editable</p>' : '<p class="text-[10px] text-gray-400 mt-1">Será su usuario para entrar al catálogo.</p>'}
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">${isNew ? 'Contraseña inicial *' : 'Contraseña'}</label>
        <input id="may-password" type="text" placeholder="${isNew ? 'Mínimo 6 caracteres' : 'Dejar vacío para no cambiar'}" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono" ${!isNew ? '' : ''}>
        <p class="text-[10px] text-gray-400 mt-1">${isNew ? 'El mayorista podrá cambiarla después.' : 'Solo si deseas resetearla.'}</p>
      </div>
    </div>

    <!-- Ciudad + Dirección -->
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Ciudad</label>
        <input id="may-city" type="text" value="${escapeHtml(v.city) || ''}" placeholder="Bogotá" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Dirección</label>
        <input id="may-address" type="text" value="${escapeHtml(v.address) || ''}" placeholder="Calle 45 #12-34" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <!-- Condiciones comerciales -->
    <div class="border border-gray-200 rounded-lg p-3 mb-3 bg-blue-50/30">
      <p class="text-xs font-semibold text-sd mb-2">💳 Condiciones comerciales</p>

      <div class="grid grid-cols-2 gap-3 mb-2">
        <div>
          <label class="text-[10px] font-semibold text-sd">Condición de pago</label>
          <select id="may-paymentTerms" class="w-full px-3 py-2 border rounded-lg text-sm mt-1" onchange="onMayTermsChange()">
            ${termsOpts}
          </select>
        </div>
        <div id="may-custom-days-wrap" class="${w.paymentTerms === 'custom' ? '' : 'hidden'}">
          <label class="text-[10px] font-semibold text-sd">Días personalizados</label>
          <input id="may-custom-days" type="number" min="1" max="365" value="${w.customTermsDays || ''}" class="w-full px-3 py-2 border rounded-lg text-sm mt-1 border-blue-400 bg-white">
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-[10px] font-semibold text-sd">Estado</label>
          <select id="may-status" class="w-full px-3 py-2 border rounded-lg text-sm mt-1">
            ${statusOpts}
          </select>
        </div>
        <div>
          <label class="text-[10px] font-semibold text-sd">% Descuento base (opcional)</label>
          <input id="may-discountBase" type="number" step="0.01" min="0" max="100" value="${((w.discountBase || 0) * 100).toFixed(2)}" class="w-full px-3 py-2 border rounded-lg text-sm mt-1">
          <p class="text-[9px] text-gray-400 mt-0.5">Se aplica sobre el precio mayorista.</p>
        </div>
      </div>
    </div>

    <!-- Notas -->
    <label class="text-xs font-semibold text-sd">Notas internas</label>
    <textarea id="may-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-4 text-sm" placeholder="Observaciones sobre este mayorista...">${escapeHtml(w.notes) || ''}</textarea>

    <!-- Botones -->
    <div class="flex gap-3">
      <button onclick="closeWholesaleForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveWholesale()" id="may-save-btn" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">
        ${isNew ? '💾 Crear mayorista' : '💾 Guardar cambios'}
      </button>
    </div>
  `;
}

window.onMayTermsChange = () => {
  const terms = $('may-paymentTerms')?.value;
  const wrap = $('may-custom-days-wrap');
  if (!wrap) return;
  if (terms === 'custom') wrap.classList.remove('hidden');
  else wrap.classList.add('hidden');
};

/* ============================================================
   MAYORISTAS — Guardar (crear o editar)
============================================================ */
window.saveWholesale = async () => {
  const companyName = $('may-company').value.trim();
  const nit = $('may-nit').value.trim();
  const name = $('may-name').value.trim();
  const phone = $('may-phone').value.trim();
  const email = $('may-email').value.trim();
  const password = $('may-password').value.trim();
  const city = $('may-city').value.trim();
  const address = $('may-address').value.trim();
  const paymentTerms = $('may-paymentTerms').value;
  const customTermsDays = paymentTerms === 'custom'
    ? Number($('may-custom-days').value || 0)
    : null;
  const status = $('may-status').value;
  const discountBase = (Number($('may-discountBase').value) || 0) / 100;
  const notes = $('may-notes').value.trim();

  /* ============ VALIDACIONES ============ */
  if (!companyName) return alert('La razón social es obligatoria.');
  if (!nit) return alert('El NIT es obligatorio.');
  if (!name) return alert('El nombre del contacto es obligatorio.');
  if (!phone) return alert('El teléfono es obligatorio.');

  // Limpiar teléfono
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 7) return alert('El teléfono debe tener al menos 7 dígitos.');

  const isNew = !editingWholesaleId;

  if (isNew) {
    if (!email) return alert('El email es obligatorio para crear la cuenta.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert('Email inválido.');
    if (!password) return alert('La contraseña es obligatoria.');
    if (password.length < 6) return alert('La contraseña debe tener al menos 6 caracteres.');

    // Verificar que no exista ya un cliente con ese teléfono en customers
    const existingDoc = wholesaleCustomers.find(c => c.id === cleanPhone);
    if (existingDoc) {
      return alert(`⚠️ Ya existe un cliente con el teléfono ${cleanPhone}.\n\nSi quieres convertirlo en mayorista, edítalo desde admin o agrégalo manualmente.`);
    }

    // Verificar email no duplicado entre mayoristas
    const emailExists = wholesaleCustomers.find(c => (c.email || '').toLowerCase() === email.toLowerCase());
    if (emailExists) {
      return alert(`⚠️ Ya existe un mayorista con el email ${email}.`);
    }
  }

  if (paymentTerms === 'custom' && (!customTermsDays || customTermsDays <= 0)) {
    return alert('Debes indicar los días personalizados.');
  }

  /* ============ CONFIRMAR ============ */
  if (isNew) {
    if (!confirm(
      `¿Crear mayorista?\n\n` +
      `Empresa: ${companyName}\n` +
      `NIT: ${nit}\n` +
      `Contacto: ${name}\n` +
      `Email: ${email}\n\n` +
      `Se creará la cuenta de acceso al catálogo.`
    )) return;
  }

  const btn = $('may-save-btn');
  if (btn) { btn.disabled = true; btn.innerText = '⏳ Guardando...'; }

  try {
    /* ============ CREAR USUARIO EN FIREBASE AUTH ============ */
    let linkedUserId = editingWholesaleId
      ? wholesaleCustomers.find(c => c.id === editingWholesaleId)?.wholesale?.linkedUserId || null
      : null;

    if (isNew) {
      // Llamar a la Cloud Function
      const createUserFn = httpsCallable(functions, 'createUserAdmin');
      const result = await createUserFn({
        email,
        password,
        name,                             // Nombre del contacto
        role: 'mayorista',                // 🆕 rol nuevo
        storeId: currentStore.storeId,    // Asignado a la tienda actual
        commissionRate: 0,
        goalAmount: 0,
        bonusRate: 0,
        maxDevices: 3,                    // Le permitimos 3 dispositivos (por si usa varias oficinas)
        pin: null,
        kioskMode: false,
        deviceAutoApprove: true,          // Auto-aprobar dispositivos
        active: true
      });

      if (!result.data?.success) {
        throw new Error('La función no confirmó la creación del usuario.');
      }

      linkedUserId = result.data.uid || null;
    } else {
      // Si es edición y cambiaron la contraseña → resetearla
      if (password) {
        if (password.length < 6) {
          alert('La nueva contraseña debe tener al menos 6 caracteres. Se omite el cambio.');
        } else {
          try {
            const resetFn = httpsCallable(functions, 'resetUserPassword');
            await resetFn({ uid: linkedUserId, newPassword: password });
          } catch (e) {
            console.warn('No se pudo resetear contraseña:', e);
            alert('⚠️ No se pudo cambiar la contraseña: ' + e.message);
          }
        }
      }
    }

    /* ============ GUARDAR / ACTUALIZAR DOC EN customers ============ */
    const now = serverTimestamp();

    if (isNew) {
      // Doc nuevo con el teléfono como ID
      const ref = doc(db, 'customers', cleanPhone);
      await setDoc(ref, {
        // Datos base del cliente (retail + mayorista)
        name,
        phone: cleanPhone,
        email,
        address,
        city,
        notes: '',                        // notas retail (por separado)
        tags: ['Mayorista'],
        totalSpent: 0,
        purchaseCount: 0,
        firstPurchaseAt: null,
        lastPurchaseAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser.email,
        storeId: currentStore.storeId,

        // 🆕 Bloque mayorista
        isWholesale: true,
        wholesale: {
          companyName,
          nit,
          paymentTerms,
          customTermsDays,
          status,
          discountBase,
          notes,
          linkedUserId,
          approvedBy: currentUser.email,
          approvedAt: now
        }
      });

      await audit({
        action: 'create',
        collection: 'customers',
        docId: cleanPhone,
        after: { companyName, nit, email, isWholesale: true },
        note: `Mayorista creado: ${companyName} (${nit}) · ${email}`
      });
    } else {
      // Editar mayorista existente
      const existing = wholesaleCustomers.find(c => c.id === editingWholesaleId);
      if (!existing) {
        alert('No se encontró el mayorista a editar.');
        if (btn) { btn.disabled = false; btn.innerText = '💾 Guardar cambios'; }
        return;
      }

      const updatedWholesale = {
        ...(existing.wholesale || {}),
        companyName,
        nit,
        paymentTerms,
        customTermsDays,
        status,
        discountBase,
        notes,
        linkedUserId,
        updatedAt: now
      };

      await updateDoc(doc(db, 'customers', editingWholesaleId), {
        name,
        phone: cleanPhone,
        address,
        city,
        isWholesale: true,
        wholesale: updatedWholesale,
        updatedAt: now
      });

      await audit({
        action: 'update',
        collection: 'customers',
        docId: editingWholesaleId,
        before: existing,
        after: { companyName, nit, status },
        note: `Mayorista editado: ${companyName} (${nit})`
      });
    }

    /* ============ CERRAR + RECARGAR ============ */
    window.SmartecCache.invalidate('customers_all');
    await loadWholesaleCustomers();
    renderWholesale();
    closeWholesaleForm();

    alert(`✅ Mayorista ${isNew ? 'creado' : 'actualizado'} correctamente.`);
  } catch (e) {
    console.error('Error guardando mayorista:', e);
    alert('❌ Error: ' + (e.message || 'desconocido'));
    if (btn) { btn.disabled = false; btn.innerText = isNew ? '💾 Crear mayorista' : '💾 Guardar cambios'; }
  }
};

/* ============================================================
   MAYORISTAS — Ver detalle
============================================================ */
window.viewWholesale = (id) => {
  const c = wholesaleCustomers.find(x => x.id === id);
  if (!c) return;
  const w = c.wholesale || {};

  const termsLabel = (slug, customDays) => {
    if (slug === 'custom' && customDays) return `Personalizado (${customDays} días)`;
    const map = {
      contado: 'Contado',
      net_15: 'Net 15 días',
      net_30: 'Net 30 días',
      net_45: 'Net 45 días',
      net_60: 'Net 60 días',
      net_90: 'Net 90 días'
    };
    return map[slug] || (slug || '—');
  };

  const statusBadge = (status) => {
    const map = {
      activo:     { cls: 'bg-green-100 text-green-700',  lbl: '✅ Activo' },
      suspendido: { cls: 'bg-amber-100 text-amber-700',  lbl: '⏸️ Suspendido' },
      moroso:     { cls: 'bg-red-100 text-red-700',      lbl: '🔴 Moroso' }
    };
    const m = map[status] || map.activo;
    return `<span class="text-xs px-3 py-1 rounded-full ${m.cls} font-semibold">${m.lbl}</span>`;
  };

  const fmtDate = (ts) => {
    if (!ts) return '—';
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return d.toLocaleString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  };

  alert(
    `🏢 ${w.companyName || c.name || '—'}\n\n` +
    `NIT: ${w.nit || '—'}\n` +
    `Contacto: ${c.name || '—'}\n` +
    `Teléfono: ${c.phone || '—'}\n` +
    `Email: ${c.email || '—'}\n` +
    `Ciudad: ${c.city || '—'}\n` +
    `Dirección: ${c.address || '—'}\n\n` +
    `Estado: ${w.status || 'activo'}\n` +
    `Condición de pago: ${termsLabel(w.paymentTerms, w.customTermsDays)}\n` +
    `Descuento base: ${((w.discountBase || 0) * 100).toFixed(2)}%\n\n` +
    `Total comprado: ${fmt(c.totalSpent || 0)}\n` +
    `Compras: ${c.purchaseCount || 0}\n` +
    `Registrado por: ${w.approvedBy || '—'}\n` +
    `Fecha registro: ${fmtDate(w.approvedAt || c.createdAt)}\n\n` +
    `Notas: ${w.notes || '—'}`
  );
};

/* ============================================================
   MAYORISTAS — Cambiar estado (suspender/reactivar)
============================================================ */
window.toggleWholesaleStatus = async (id) => {
  const c = wholesaleCustomers.find(x => x.id === id);
  if (!c) return;
  const w = c.wholesale || {};
  const currentStatus = w.status || 'activo';

  const willActivate = currentStatus !== 'activo';
  const newStatus = willActivate ? 'activo' : 'suspendido';

  const msg = willActivate
    ? `¿Reactivar a "${w.companyName || c.name}"?\n\nVolverá a tener acceso al catálogo B2B.`
    : `¿Suspender a "${w.companyName || c.name}"?\n\nYa no podrá acceder al catálogo B2B.\n\nLos datos históricos se conservan.`;

  if (!confirm(msg)) return;

  try {
    await updateDoc(doc(db, 'customers', id), {
      'wholesale.status': newStatus,
      updatedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'customers',
      docId: id,
      before: { 'wholesale.status': currentStatus },
      after: { 'wholesale.status': newStatus },
      note: `Mayorista ${willActivate ? 'reactivado' : 'suspendido'}: ${w.companyName || c.name}`
    });

    window.SmartecCache.invalidate('customers_all');
    await loadWholesaleCustomers();
    renderWholesale();
    alert(`✅ Mayorista ${willActivate ? 'reactivado' : 'suspendido'}.`);
  } catch (e) {
    console.error('Error cambiando estado:', e);
    alert('❌ Error: ' + e.message);
  }
};

/* ============================================================
   MAYORISTAS — Eliminar
============================================================ */
window.deleteWholesale = async (id) => {
  const c = wholesaleCustomers.find(x => x.id === id);
  if (!c) return;
  const w = c.wholesale || {};

  // Verificar si tiene compras registradas
  const hasPurchases = Number(c.purchaseCount || 0) > 0;

  let confirmMsg =
    `⚠️ ELIMINAR MAYORISTA\n\n` +
    `Empresa: ${w.companyName || c.name}\n` +
    `NIT: ${w.nit || '—'}\n` +
    `Email: ${c.email || '—'}\n\n`;

  if (hasPurchases) {
    confirmMsg +=
      `🔴 Este mayorista tiene ${c.purchaseCount} compra(s) registrada(s) por ${fmt(c.totalSpent || 0)}.\n\n` +
      `Recomendación: SUSPENDER en lugar de eliminar, para conservar el historial.\n\n` +
      `Si eliminas, los documentos de venta quedarán huérfanos.\n\n`;
  }

  confirmMsg +=
    `Se desactivará su cuenta de acceso al catálogo B2B.\n\n` +
    `Escribe "ELIMINAR" para confirmar:`;

  const typed = prompt(confirmMsg);
  if (typed !== 'ELIMINAR') {
    if (typed !== null) alert('Cancelado. No se escribió "ELIMINAR" correctamente.');
    return;
  }

  try {
    // 1. Desactivar la cuenta Firebase Auth (si existe la Cloud Function)
    const linkedUserId = w.linkedUserId;
    if (linkedUserId) {
      try {
        const disableFn = httpsCallable(functions, 'disableUser');
        await disableFn({ uid: linkedUserId, disabled: true });
      } catch (e) {
        console.warn('No se pudo desactivar la cuenta Auth:', e);
        // No bloqueamos el flujo si falla
      }
    }

    // 2. Borrar el documento de customers
    await deleteDoc(doc(db, 'customers', id));

    await audit({
      action: 'delete',
      collection: 'customers',
      docId: id,
      before: { companyName: w.companyName, nit: w.nit, email: c.email },
      note: `Mayorista eliminado: ${w.companyName || c.name}${linkedUserId ? ' · Cuenta Auth desactivada' : ''}`
    });

    window.SmartecCache.invalidate('customers_all');
    await loadWholesaleCustomers();
    renderWholesale();
    alert('✅ Mayorista eliminado.');
  } catch (e) {
    console.error('Error eliminando mayorista:', e);
    alert('❌ Error: ' + e.message);
  }
};

/* ============================================================
   CARGA DE DATOS
============================================================ */
async function loadAll() {
  const C = window.SmartecCache;

  stores = await C.wrap('stores', async () => {
    const s = await getDocs(collection(db,'stores'));
    return s.docs.map(d => ({id:d.id, ...d.data()}));
  });

  const isSuper = currentUserData.role === 'superadmin';
  const myStoreId = currentUserData.storeId;

  // Configurar tienda actual (el selector lo maneja header-app.js)
  if (isSuper) {
    const activeStores = stores.filter(s => s.active).sort((a,b) => a.name.localeCompare(b.name));
    if (!activeStores.length) {
      alert('⛔ No hay tiendas activas.');
      return;
    }
    // Recuperar tienda guardada o mostrar "Todas"
    const saved = sessionStorage.getItem('smartec_contab_store') || 'all';
    if (saved === 'all') {
      currentStore = { storeId: 'all', name: 'Todas las tiendas' };
    } else {
      currentStore = activeStores.find(s => s.storeId === saved)
                  || { storeId: 'all', name: 'Todas las tiendas' };
    }
    sessionStorage.setItem('smartec_contab_store', currentStore.storeId);
  } else {
    // Admin: solo su tienda asignada
    currentStore = stores.find(s => s.storeId === myStoreId);
    if (!currentStore) {
      alert('⛔ Tu tienda asignada no existe.');
      await signOut(auth);
      window.location.href = 'home.html';
      return;
    }
  }

  categories = await C.wrap('expenseCategories', async () => {
    const s = await getDocs(collection(db,'expenseCategories'));
    const list = s.docs.map(d => ({id:d.id, ...d.data()}));
    return list.length ? list : DEFAULT_CATEGORIES.map(c => ({id:c.slug, ...c}));
  });

  users = await C.wrap('users', async () => {
    const s = await getDocs(collection(db,'users'));
    return s.docs.map(d => ({id:d.id, ...d.data()}));
  });

  // Config contable
  try {
    const snap = await getDoc(doc(db, 'settings', 'accounting'));
    if (snap.exists()) {
      const data = snap.data();
      conSettings.defaultTermsDays = Number(data.defaultTermsDays ?? 30);
      conSettings.defaultAlertDays = Number(data.defaultAlertDays ?? 5);
    }
  } catch(e) { /* ignore */ }

  await loadExpenses();
  await loadSuppliers();
  await loadWholesaleCustomers();
  await loadWholesaleQuotes();
  populateCategoryFilter();
  setRange('month');
  renderAll();s

  // 🆕 Re-render del header ahora que tenemos tiendas + currentStore
  renderHeaderApp();
}

async function loadExpenses() {
  const C = window.SmartecCache;
  const isSuper = currentUserData.role === 'superadmin';

  const all = await C.wrap(`expenses_all`, async () => {
    const s = await getDocs(collection(db,'expenses'));
    return s.docs.map(d => ({id:d.id, ...d.data()}));
  });

  if (isSuper && currentStore.storeId === 'all') {
    // Superadmin viendo TODAS las tiendas
    expenses = all.slice();
  } else {
    // Tienda específica (superadmin o admin)
    expenses = all.filter(e =>
      e.storeId === currentStore.storeId || e.storeId === 'general'
    );
  }
}

async function loadSuppliers() {
  const C = window.SmartecCache;
  suppliers = await C.wrap(`suppliers_all`, async () => {
    const s = await getDocs(collection(db,'suppliers'));
    return s.docs.map(d => ({id:d.id, ...d.data()}));
  });
  suppliers.sort((a,b) => (a.name||'').localeCompare(b.name||''));
}

/* ============================================================
   FILTROS
============================================================ */
function populateCategoryFilter() {
  const sel = $('f-category');
  sel.innerHTML = '<option value="all">Todas</option>' +
    categories.map(c => `<option value="${c.slug}">${c.name}</option>`).join('');
}

window.setRange = (range) => {
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
      from = new Date(now.getFullYear(), now.getMonth()-1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case 'year': from = new Date(now.getFullYear(), 0, 1); to = now; break;
    default: return;
  }
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  $('f-date-from').value = fmtD(from);
  $('f-date-to').value = fmtD(to);
  renderAll();
};

window.clearFilters = () => {
  $('f-date-from').value = '';
  $('f-date-to').value = '';
  $('f-type').value = 'all';
  $('f-category').value = 'all';
  $('f-payment-status').value = 'all';
  $('f-due-filter').value = 'all';
  $('f-provider').value = '';
  $('f-search').value = '';
  renderAll();
};

['f-date-from','f-date-to','f-type','f-category','f-payment-status','f-due-filter','f-provider','f-search'].forEach(id => {
  const el = $(id);
  if (el) {
    const handler = () => {
      expensesVisibleCount = EXPENSES_PAGE_SIZE; // reset paginación
      renderAll();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  }
});

function getFiltered() {
  let list = expenses.slice();

  const from = $('f-date-from').value;
  const to = $('f-date-to').value;
  if (from) list = list.filter(e => e.date >= from);
  if (to) list = list.filter(e => e.date <= to);

  const typeF = $('f-type').value;
  if (typeF !== 'all') list = list.filter(e => e.type === typeF);

  const catF = $('f-category').value;
  if (catF !== 'all') list = list.filter(e => e.category === catF);

  const statusF = $('f-payment-status').value;
  if (statusF !== 'all') {
    list = list.filter(e => computePaymentStatus(e) === statusF);
  }

  const dueF = $('f-due-filter').value;
  if (dueF !== 'all') {
    const today = todayStr();
    if (dueF === 'next7') {
      list = list.filter(e => {
        const ps = computePaymentStatus(e);
        if (ps === 'paid' || ps === 'anulado') return false;
        if (!e.dueDate) return false;
        const diff = daysBetween(today, e.dueDate);
        return diff >= 0 && diff <= 7;
      });
    } else if (dueF === 'next30') {
      list = list.filter(e => {
        const ps = computePaymentStatus(e);
        if (ps === 'paid' || ps === 'anulado') return false;
        if (!e.dueDate) return false;
        const diff = daysBetween(today, e.dueDate);
        return diff >= 0 && diff <= 30;
      });
    } else if (dueF === 'overdue') {
      list = list.filter(e => computePaymentStatus(e) === 'overdue');
    }
  }

  const provF = ($('f-provider').value || '').toLowerCase().trim();
  if (provF) list = list.filter(e =>
    (e.provider||'').toLowerCase().includes(provF) ||
    (e.supplierName||'').toLowerCase().includes(provF)
  );

  const searchF = ($('f-search').value || '').toLowerCase().trim();
  if (searchF) list = list.filter(e =>
    (e.concept||'').toLowerCase().includes(searchF) ||
    (e.invoiceNumber||'').toLowerCase().includes(searchF)
  );

  return list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
}

/* ============================================================
   RENDER
============================================================ */
function renderAll() {
  renderAlerts();
  renderKPIs();
  renderTable();
}

function renderAlerts() {
  const panel = $('alerts-panel');
  if (!panel) return;

  const today = todayStr();
  const activeExpenses = expenses.filter(e => computePaymentStatus(e) !== 'anulado' && computePaymentStatus(e) !== 'paid');

  const overdue = activeExpenses.filter(e => computePaymentStatus(e) === 'overdue');
  const soon = activeExpenses.filter(e => {
    if (!e.dueDate) return false;
    const diff = daysBetween(today, e.dueDate);
    const alertDays = Number(e.alertDaysBefore ?? conSettings.defaultAlertDays);
    return diff >= 0 && diff <= alertDays;
  });

  const totalOverdue = overdue.reduce((s, e) => s + Number(e.total||0), 0);
  const totalSoon = soon.reduce((s, e) => s + Number(e.total||0), 0);

  if (!overdue.length && !soon.length) {
    panel.innerHTML = '';
    return;
  }

  let html = '<div class="space-y-2">';

  if (overdue.length) {
    html += `
      <button onclick="filterByStatus('overdue')" class="w-full text-left bg-red-50 border-l-4 border-red-500 rounded-lg p-3 hover:bg-red-100 transition flex justify-between items-center">
        <div>
          <p class="font-semibold text-red-700 text-sm">🔴 ${overdue.length} factura${overdue.length !== 1 ? 's' : ''} vencida${overdue.length !== 1 ? 's' : ''}</p>
          <p class="text-[10px] text-red-600">Requieren atención inmediata</p>
        </div>
        <p class="text-lg font-bold text-red-700">${fmt(totalOverdue)}</p>
      </button>
    `;
  }

  if (soon.length) {
    html += `
      <button onclick="filterByDueSoon()" class="w-full text-left bg-amber-50 border-l-4 border-amber-400 rounded-lg p-3 hover:bg-amber-100 transition flex justify-between items-center">
        <div>
          <p class="font-semibold text-amber-700 text-sm">🟡 ${soon.length} factura${soon.length !== 1 ? 's' : ''} próxima${soon.length !== 1 ? 's' : ''} a vencer</p>
          <p class="text-[10px] text-amber-600">Vencen en los próximos ${conSettings.defaultAlertDays} días</p>
        </div>
        <p class="text-lg font-bold text-amber-700">${fmt(totalSoon)}</p>
      </button>
    `;
  }

  html += '</div>';
  panel.innerHTML = html;
}

window.filterByStatus = (status) => {
  $('f-payment-status').value = status;
  $('f-due-filter').value = 'all';
  renderAll();
};

window.filterByDueSoon = () => {
  $('f-payment-status').value = 'all';
  $('f-due-filter').value = 'next7';
  renderAll();
};

function renderKPIs() {
  const list = getFiltered();
  let total = 0, payable = 0, payableCount = 0, paid = 0, paidCount = 0, overdue = 0, overdueCount = 0;

  list.forEach(e => {
    if (e.status === 'anulado') return;

    total += Number(e.total || 0);

    const ps = computePaymentStatus(e);
    if (ps === 'paid') { paid += Number(e.total||0); paidCount++; }
    else if (ps === 'overdue') { overdue += Number(e.total||0); overdueCount++; payable += Number(e.total||0); payableCount++; }
    else if (ps === 'pending') { payable += Number(e.total||0); payableCount++; }
  });

  $('kpi-total').innerText = fmt(total);
  $('kpi-count').innerText = `${list.length} movimiento${list.length !== 1 ? 's' : ''}`;
  $('kpi-payable').innerText = fmt(payable);
  $('kpi-payable-count').innerText = `${payableCount} factura${payableCount !== 1 ? 's' : ''} pendiente${payableCount !== 1 ? 's' : ''}`;
  $('kpi-paid').innerText = fmt(paid);
  $('kpi-paid-count').innerText = `${paidCount} pago${paidCount !== 1 ? 's' : ''} registrado${paidCount !== 1 ? 's' : ''}`;
  $('kpi-overdue').innerText = fmt(overdue);
  $('kpi-overdue-count').innerText = `${overdueCount} factura${overdueCount !== 1 ? 's' : ''} vencida${overdueCount !== 1 ? 's' : ''}`;
}

function renderTable() {
  const tb = $('expenses-tbody');
  const empty = $('expenses-empty');
  const all = getFiltered();

  if (!all.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderExpensesFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  const today = todayStr();
  const visible = all.slice(0, expensesVisibleCount);

  tb.innerHTML = visible.map(e => {
    const cat = categories.find(c => c.slug === e.category);
    const store = stores.find(s => s.storeId === e.storeId);
    const ps = computePaymentStatus(e);
    const rowClass = ps === 'anulado' ? 'bg-gray-50 opacity-60'
                    : ps === 'overdue' ? 'bg-red-50/40'
                    : ps === 'pending' && e.dueDate && daysBetween(today, e.dueDate) <= Number(e.alertDaysBefore ?? conSettings.defaultAlertDays) ? 'bg-amber-50/40'
                    : '';

    const typeBadge = e.type === 'costo'
      ? '<span class="text-[10px] px-2 py-0.5 rounded bg-orange-100 text-orange-700 font-semibold">Costo</span>'
      : '<span class="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">Gasto</span>';

    let dueCell = '<span class="text-gray-300 text-xs">—</span>';
    if (e.dueDate) {
      const diff = daysBetween(today, e.dueDate);
      const diffLabel = ps === 'paid' ? '' : diff < 0 ? `(${Math.abs(diff)}d vencida)` : diff === 0 ? '(hoy)' : `(${diff}d)`;
      const diffCls = ps === 'paid' ? 'text-gray-400' : diff < 0 ? 'text-red-600 font-bold' : diff <= 7 ? 'text-amber-600 font-semibold' : 'text-gray-500';
      dueCell = `<div class="text-xs text-gray-600">${e.dueDate}</div><div class="${diffCls} text-[10px]">${diffLabel}</div>`;
    }

    const supportsCount = (e.supports || []).length + (e.supportUrl && !(e.supports||[]).length ? 1 : 0);

    return `<tr class="border-b hover:bg-gray-50 ${rowClass}">
      <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${e.date || '-'}</td>
      <td class="p-3 text-xs font-mono">${escapeHtml(e.invoiceNumber) || '<span class="text-gray-300">—</span>'}</td>
      <td class="p-3">${typeBadge}</td>
      <td class="p-3 text-xs">${escapeHtml(e.supplierName || e.provider) || '-'}</td>
      <td class="p-3 text-xs max-w-xs truncate">${escapeHtml(e.concept) || '-'}</td>
      <td class="p-3 text-xs">${e.storeId === 'general' ? 'General' : escapeHtml(store?.name) || e.storeId || '-'}</td>
      <td class="p-3 text-right text-xs font-bold text-sd">${fmt(e.total)}</td>
      <td class="p-3 text-center">${dueCell}</td>
      <td class="p-3 text-center">${paymentStatusBadge(ps)}</td>
      <td class="p-3 text-center text-xs">
        ${supportsCount > 0
          ? `<span class="text-sl">📎 ${supportsCount}</span>`
          : '<span class="text-gray-300">—</span>'}
      </td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewDetail("${e.id}")' class="text-sl hover:underline text-xs mr-2">Ver</button>
        ${ps === 'pending' || ps === 'overdue' ? `
          <button onclick='openPayModal("${e.id}")' class="text-green-600 hover:underline text-xs mr-2 font-semibold">💰 Pagar</button>
        ` : ''}
        ${ps !== 'anulado' ? `
          <button onclick='editExpense("${e.id}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
          <button onclick='anularExpense("${e.id}")' class="text-red-500 hover:underline text-xs">Anular</button>
        ` : '<span class="text-[10px] text-gray-400 italic">Anulado</span>'}
      </td>
    </tr>`;
  }).join('');

  renderExpensesFooter(visible.length, all.length);
}

function renderExpensesFooter(shown, total) {
  let footer = $('expenses-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'expenses-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('expenses-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }

  if (total === 0) { footer.innerHTML = ''; return; }

  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">
      Mostrando <b>${shown}</b> de <b>${total}</b> movimientos
    </p>
    ${hasMore ? `
      <button onclick="loadMoreExpenses()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">
        ⬇️ Cargar 100 más
      </button>
    ` : `<p class="text-[10px] text-gray-400">— Fin de la lista —</p>`}
  `;
}

window.loadMoreExpenses = () => {
  expensesVisibleCount += EXPENSES_PAGE_SIZE;
  renderTable();
};

/* ============================================================
   PUC · RENDER
============================================================ */
let pucCustomAccounts = [];      // Cuentas custom de Firestore (todas las tiendas)
let editingPucCode = null;       // Código de la cuenta que se está editando (null = nueva)
const PUC_PAGE_SIZE = 100;      // Cuántas cuentas mostrar por página
let pucVisibleCount = PUC_PAGE_SIZE;  // Cuántas se muestran actualmente

// Estado local del PUC (lo que se muestra en pantalla)
let pucAccounts = [];

/* Carga el PUC base + las cuentas custom de Firestore.
   Las custom se filtran por tienda actual (o todas si es superadmin en "all"). */
async function loadPuc() {
  const base = window.SmartecPUC.getBase();

  // 1. Traer TODAS las cuentas custom (con cache)
  const C = window.SmartecCache;
  const allCustom = await C.wrap('puc_cuentas_all', async () => {
    const s = await getDocs(collection(db, 'puc_cuentas'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  pucCustomAccounts = allCustom;

  // 2. Filtrar por tienda actual
  const isSuper = currentUserData.role === 'superadmin';
  const isAllStores = isSuper && currentStore?.storeId === 'all';

  let customForCurrent;
  if (isAllStores) {
    // Superadmin viendo "Todas": mostrar todas las custom
    customForCurrent = allCustom;
  } else {
    // Tienda específica: solo custom de esa tienda + 'general'
    customForCurrent = allCustom.filter(c =>
      c.storeId === currentStore.storeId || c.storeId === 'general'
    );
  }

  // 3. Normalizar custom (agregar campos que usa el render)
  const customNorm = customForCurrent.map(c => ({
    code: c.code,
    name: c.name,
    parentCode: c.parentCode || window.SmartecPUC.findByCode(c.code)?.parentCode || null,
    nature: c.nature || 'D',
    level: c.level || window.SmartecPUC.findByCode(c.code)?.level || c.code.length,
    acceptsMovement: c.acceptsMovement !== false,
    isBase: false,
    active: c.active !== false,
    origin: 'custom',
    storeId: c.storeId || 'general',
    storeName: c.storeName || null,
    id: c.id
  }));

  // 4. Fusionar (base + custom, sin duplicados por código)
  const baseNorm = base.map(c => ({ ...c, origin: 'base' }));
  const codesCustom = new Set(customNorm.map(c => c.code));
  const baseFiltered = baseNorm.filter(c => !codesCustom.has(c.code));

  pucAccounts = [...baseFiltered, ...customNorm];
}

/* Badge de naturaleza D/C */
function pucNatureBadge(nature) {
  if (nature === 'D') {
    return `<span class="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold" title="Naturaleza débito">D</span>`;
  }
  return `<span class="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold" title="Naturaleza crédito">C</span>`;
}

/* Badge de nivel */
function pucLevelBadge(level) {
  const labels = { 1:'Clase', 2:'Grupo', 3:'Cuenta', 4:'Subcuenta', 5:'Auxiliar' };
  const colors = {
    1: 'bg-red-100 text-red-700',
    2: 'bg-orange-100 text-orange-700',
    3: 'bg-amber-100 text-amber-700',
    4: 'bg-green-100 text-green-700',
    5: 'bg-teal-100 text-teal-700'
  };
  const lbl = labels[level] || '—';
  const cls = colors[level] || 'bg-gray-100 text-gray-700';
  return `<span class="text-[10px] px-2 py-0.5 rounded ${cls} font-semibold whitespace-nowrap">${lbl}</span>`;
}

/* Badge movimiento sí/no */
function pucMovementBadge(accepts) {
  if (accepts) {
    return `<span class="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 font-semibold">✓ Sí</span>`;
  }
  return `<span class="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-500 font-semibold">— Agrupa</span>`;
}

/* Badge origen */
function pucOriginBadge(origin) {
  if (origin === 'custom') {
    return `<span class="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">Custom</span>`;
  }
  return `<span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">Base</span>`;
}

/* Render de las estadísticas */
function renderPucStats() {
  const el = $('puc-stats');
  if (!el) return;

  const total = pucAccounts.length;
  const movable = pucAccounts.filter(c => c.acceptsMovement).length;
  const custom = pucAccounts.filter(c => c.origin === 'custom').length;
  const active = pucAccounts.filter(c => c.active !== false).length;

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Total cuentas</p>
      <p class="text-xl font-bold text-[#1D1D1F] mt-0.5">${total}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Aceptan movimiento</p>
      <p class="text-xl font-bold text-[#30D158] mt-0.5">${movable}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Activas</p>
      <p class="text-xl font-bold text-[#0071E3] mt-0.5">${active}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Personalizadas</p>
      <p class="text-xl font-bold text-indigo-600 mt-0.5">${custom}</p>
    </div>
  `;
}


/* Trae la cuenta a mostrar en la tabla (con filtro de búsqueda)
   NOTA: esta lista NO se recorta — devuelve todas las coincidencias.
   El recorte de paginación se hace en renderPuc. */
function getFilteredPuc() {
  const term = ($('puc-search')?.value || '').toLowerCase().trim();
  let list = pucAccounts.slice();

  if (term) {
    list = list.filter(c =>
      c.code.toLowerCase().includes(term) ||
      c.name.toLowerCase().includes(term)
    );
  }

  // Ordenar por código (jerárquico natural)
  list.sort((a, b) => a.code.localeCompare(b.code));
  return list;
}

/* Render de la tabla PUC (con paginación visual de 100) */
function renderPuc() {
  renderPucStats();

  const tb = $('puc-tbody');
  const empty = $('puc-empty');
  if (!tb) return;

  const all = getFilteredPuc();
  const total = all.length;
  const visible = all.slice(0, pucVisibleCount);

  // Empty state
  if (!total) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderPucFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  // Filas visibles
  tb.innerHTML = visible.map(c => {
    const indentPx = (c.level - 1) * 16;
    const nameStyle = c.level >= 4
      ? 'font-semibold text-[#1D1D1F]'
      : 'font-medium text-[#3A3A3C]';

    return `<tr class="border-b hover:bg-gray-50 ${c.active === false ? 'opacity-50' : ''}">
      <td class="p-3 text-xs font-mono text-[#1D1D1F] whitespace-nowrap">${escapeHtml(c.code)}</td>
      <td class="p-3 text-xs ${nameStyle}" style="padding-left:${16 + indentPx}px">
        ${escapeHtml(c.name)}
      </td>
      <td class="p-3 text-center">${pucLevelBadge(c.level)}</td>
      <td class="p-3 text-center">${pucNatureBadge(c.nature)}</td>
      <td class="p-3 text-center">${pucMovementBadge(c.acceptsMovement)}</td>
      <td class="p-3 text-center">${pucOriginBadge(c.origin)}</td>
      <td class="p-3 text-right whitespace-nowrap">
        ${c.origin === 'custom' ? `
          <button onclick='editPucAccount("${c.code}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
          <button onclick='deletePucAccount("${c.code}")' class="text-red-500 hover:underline text-xs">Eliminar</button>
        ` : '<span class="text-[10px] text-gray-400 italic">Oficial</span>'}
      </td>
    </tr>`;
  }).join('');

  renderPucFooter(visible.length, total);
}

/* Footer de paginación del PUC */
function renderPucFooter(shown, total) {
  let footer = $('puc-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'puc-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('puc-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }

  if (total === 0) {
    footer.innerHTML = '';
    return;
  }

  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">
      Mostrando <b>${shown}</b> de <b>${total}</b> cuentas
    </p>
    ${hasMore ? `
      <button onclick="loadMorePuc()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">
        ⬇️ Cargar 100 más
      </button>
    ` : `<p class="text-[10px] text-gray-400">— Fin de la lista —</p>`}
  `;
}

/* Cargar más cuentas (paginación) */
window.loadMorePuc = () => {
  pucVisibleCount += PUC_PAGE_SIZE;
  renderPuc();
};

/* ============================================================
   PUC · CRUD (cuentas personalizadas por tienda)
============================================================ */

/* Abre el formulario de creación */
window.openPucForm = () => {
  if (!canEditPuc()) return;
  editingPucCode = null;
  $('puc-title').innerText = 'Nueva cuenta PUC';
  renderPucForm({});
  const m = $('puc-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

/* Abre el formulario en modo edición */
window.editPucAccount = (code) => {
  if (!canEditPuc()) return;
  const acc = pucAccounts.find(c => c.code === code && c.origin === 'custom');
  if (!acc) return;
  editingPucCode = code;
  $('puc-title').innerText = 'Editar cuenta PUC';
  renderPucForm(acc);
  const m = $('puc-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

/* Cierra el formulario */
window.closePucForm = () => {
  const m = $('puc-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingPucCode = null;
};

/* Verifica si el usuario actual puede editar PUC.
   Si está en "Todas las tiendas" no se puede (debe elegir una). */
function canEditPuc() {
  const isSuper = currentUserData.role === 'superadmin';
  if (isSuper && currentStore?.storeId === 'all') {
    alert('⚠️ Para crear/editar cuentas PUC debes elegir una tienda específica en el selector del header.\n\nActualmente estás viendo "Todas las tiendas".');
    return false;
  }
  return true;
}

/* Determina la tienda que se usará en el formulario */
function getPucStoreContext() {
  const isSuper = currentUserData.role === 'superadmin';
  if (isSuper) {
    return { storeId: currentStore.storeId, storeName: currentStore.name };
  }
  return {
    storeId: currentUserData.storeId,
    storeName: currentStore.name
  };
}

/* Render del formulario (crear o editar) */
function renderPucForm(v) {
  const isSuper = currentUserData.role === 'superadmin';
  const ctx = getPucStoreContext();

  // Sugerir padre según el código
  const codeValue = v.code || '';

  // Naturaleza
  const natureD = v.nature === 'D' || !v.nature ? 'selected' : '';
  const natureC = v.nature === 'C' ? 'selected' : '';

  // Nivel sugerido según longitud del código
  const levelHint = codeValue.length === 6 ? 'Subcuenta (nivel 4)'
                  : codeValue.length >= 8 ? 'Auxiliar (nivel 5+)'
                  : codeValue.length === 4 ? 'Cuenta (nivel 3) — no acepta movimiento'
                  : codeValue.length === 2 ? 'Grupo (nivel 2) — no acepta movimiento'
                  : codeValue.length === 1 ? 'Clase (nivel 1) — no acepta movimiento'
                  : '—';

  // Lista de posibles padres (solo niveles 3 y 4, para colgar auxiliares)
  const possibleParents = pucAccounts
    .filter(c => c.level >= 3 && c.level <= 4)
    .sort((a, b) => a.code.localeCompare(b.code));

  const parentOpts = possibleParents.map(c => {
    const isSelected = v.parentCode === c.code;
    return `<option value="${c.code}" ${isSelected ? 'selected' : ''}>${c.code} · ${escapeHtml(c.name)}</option>`;
  }).join('');

  $('puc-body').innerHTML = `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-800">
      <p><b>Tienda:</b> ${escapeHtml(ctx.storeName)} ${isSuper ? '(superadmin)' : ''}</p>
      <p class="mt-1 text-blue-600">Esta cuenta quedará asociada a esta tienda y no afecta a las demás.</p>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Código *</label>
        <input id="puc-code" type="text" value="${escapeHtml(codeValue)}" placeholder="Ej: 11050501" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono" ${editingPucCode ? 'disabled' : ''} oninput="onPucCodeInput()">
        <p class="text-[10px] text-gray-500 mt-1">Debe tener 6+ dígitos. Ej: 11050501 (auxiliar de 110505)</p>
        <p class="text-[10px] text-blue-600 mt-0.5">Nivel estimado: <span id="puc-level-hint">${levelHint}</span></p>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Naturaleza *</label>
        <select id="puc-nature" class="w-full px-3 py-2 border rounded-lg mt-1">
          <option value="D" ${natureD}>Débito (Activo / Gasto / Costo)</option>
          <option value="C" ${natureC}>Crédito (Pasivo / Patrimonio / Ingreso)</option>
        </select>
      </div>
    </div>

    <label class="text-xs font-semibold text-sd">Nombre de la cuenta *</label>
    <input id="puc-name" type="text" value="${escapeHtml(v.name) || ''}" placeholder="Ej: Caja general - Sede Norte" class="w-full px-3 py-2 border rounded-lg mt-1 mb-3">

    <label class="text-xs font-semibold text-sd">Cuenta padre (opcional)</label>
    <select id="puc-parent" class="w-full px-3 py-2 border rounded-lg mt-1 mb-3">
      <option value="">— Sin padre (cuenta raíz custom) —</option>
      ${parentOpts}
    </select>
    <p class="text-[10px] text-gray-500 -mt-2 mb-3">Se usa para saber bajo qué cuenta se agrupa en reportes.</p>

    <label class="flex items-center gap-2 text-sm mb-3">
      <input id="puc-active" type="checkbox" ${v.active !== false ? 'checked' : ''} class="w-4 h-4">
      Cuenta activa
    </label>

    <label class="text-xs font-semibold text-sd">Notas (opcional)</label>
    <textarea id="puc-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-4 text-sm">${escapeHtml(v.notes) || ''}</textarea>

    <div class="flex gap-3">
      <button onclick="closePucForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="savePucAccount()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">Guardar</button>
    </div>
  `;
}

/* Recalcula el hint de nivel mientras escribe el código */
window.onPucCodeInput = () => {
  const code = ($('puc-code')?.value || '').trim();
  const hint = code.length === 6 ? 'Subcuenta (nivel 4)'
             : code.length >= 8 ? 'Auxiliar (nivel 5+)'
             : code.length === 4 ? 'Cuenta (nivel 3) — no acepta movimiento'
             : code.length === 2 ? 'Grupo (nivel 2) — no acepta movimiento'
             : code.length === 1 ? 'Clase (nivel 1) — no acepta movimiento'
             : '—';
  const el = $('puc-level-hint');
  if (el) el.innerText = hint;
};

/* Guardar (crear o actualizar) */
window.savePucAccount = async () => {
  const code = ($('puc-code')?.value || '').trim();
  const name = ($('puc-name')?.value || '').trim();
  const nature = $('puc-nature')?.value || 'D';
  const parentCode = $('puc-parent')?.value || null;
  const active = $('puc-active')?.checked !== false;
  const notes = ($('puc-notes')?.value || '').trim();

  // Validaciones
  if (!code) return alert('El código es obligatorio');
  if (!name) return alert('El nombre es obligatorio');
  if (code.length < 6) return alert('El código debe tener al menos 6 dígitos (nivel subcuenta o superior)');
  if (!/^\d+$/.test(code)) return alert('El código solo puede contener números');

  // Validar padre si se indicó
  if (parentCode) {
    const parent = pucAccounts.find(c => c.code === parentCode);
    if (!parent) return alert('Cuenta padre no encontrada');
    if (!code.startsWith(parentCode)) {
      return alert(`⚠️ El código "${code}" debe empezar con el código del padre "${parentCode}".\n\nEj: si el padre es 1105, el hijo debe ser 110505 o 11050501.`);
    }
  }

  // Validar que no exista ya (en base ni en custom de otra tienda)
  const ctx = getPucStoreContext();
  const existsInBase = window.SmartecPUC.findByCode(code);
  if (existsInBase && !editingPucCode) {
    return alert(`⛔ El código "${code}" ya existe en el PUC oficial.\n\nElige otro código o edita la cuenta oficial (no permitido).`);
  }

  // Validar que no exista en custom de la MISMA tienda (si es nuevo)
  if (!editingPucCode) {
    const existsInCustom = pucCustomAccounts.find(c =>
      c.code === code && c.storeId === ctx.storeId
    );
    if (existsInCustom) {
      return alert(`⛔ Ya existe una cuenta con el código "${code}" en esta tienda.`);
    }
  }

  // Calcular nivel y acceptsMovement
  const level = code.length === 6 ? 4 : code.length >= 8 ? 5 : code.length === 4 ? 3 : code.length === 2 ? 2 : 1;
  const acceptsMovement = level >= 4;

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Guardando...';

  try {
    const data = {
      code,
      name,
      nature,
      parentCode,
      level,
      acceptsMovement,
      active,
      notes,
      storeId: ctx.storeId,
      storeName: ctx.storeName,
      isCustom: true,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };

    if (editingPucCode) {
      // Actualizar
      const existing = pucCustomAccounts.find(c =>
        c.code === editingPucCode && c.storeId === ctx.storeId
      );
      if (!existing) {
        alert('No se encontró la cuenta a editar');
        btn.disabled = false; btn.innerText = 'Guardar';
        return;
      }

      await updateDoc(doc(db, 'puc_cuentas', existing.id), data);

      await audit({
        action: 'update',
        collection: 'puc_cuentas',
        docId: existing.id,
        before: existing,
        after: data,
        note: `PUC editado: ${code} · ${name} · ${ctx.storeName}`
      });
    } else {
      // Crear
      data.createdAt = serverTimestamp();
      data.createdBy = currentUser.email;

      const ref = await addDoc(collection(db, 'puc_cuentas'), data);

      await audit({
        action: 'create',
        collection: 'puc_cuentas',
        docId: ref.id,
        after: data,
        note: `PUC creado: ${code} · ${name} · ${ctx.storeName}`
      });
    }

    // Invalidar cache y recargar
    window.SmartecCache.invalidate('puc_cuentas_all');
    await loadPuc();
    pucVisibleCount = PUC_PAGE_SIZE;
    renderPuc();
    closePucForm();

    alert('✅ Cuenta guardada correctamente');
  } catch (e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = 'Guardar';
  }
};

/* Eliminar (solo custom) */
window.deletePucAccount = async (code) => {
  if (!canEditPuc()) return;
  const ctx = getPucStoreContext();
  const existing = pucCustomAccounts.find(c =>
    c.code === code && c.storeId === ctx.storeId
  );
  if (!existing) return;

  if (!confirm(`⚠️ ¿Eliminar la cuenta "${code} · ${existing.name}"?\n\nEsta acción no se puede deshacer.`)) return;

  try {
    await deleteDoc(doc(db, 'puc_cuentas', existing.id));

    await audit({
      action: 'delete',
      collection: 'puc_cuentas',
      docId: existing.id,
      before: existing,
      note: `PUC eliminado: ${code} · ${existing.name} · ${ctx.storeName}`
    });

    window.SmartecCache.invalidate('puc_cuentas_all');
    await loadPuc();
    renderPuc();
    alert('✅ Cuenta eliminada');
  } catch (e) {
    alert('Error: ' + e.message);
  }
};


/* Listener de búsqueda (resetea la paginación al buscar) */
function attachPucSearchListener() {
  const search = $('puc-search');
  if (!search) return;
  search.addEventListener('input', () => {
    pucVisibleCount = PUC_PAGE_SIZE;  // volver a mostrar solo 100
    renderPuc();
  });
}

document.addEventListener('DOMContentLoaded', attachPucSearchListener);
if ($('puc-search')) attachPucSearchListener();


/* ============================================================
   COMPROBANTES DE DIARIO
============================================================ */

let comprobantes = [];
let editingCompId = null;
const COMP_PAGE_SIZE = 100;
let compVisibleCount = COMP_PAGE_SIZE;

/* Carga los comprobantes visibles para la tienda actual */
async function loadComprobantes() {
  const C = window.SmartecCache;
  const all = await C.wrap('comprobantes_all', async () => {
    const s = await getDocs(collection(db, 'comprobantes'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  const isSuper = currentUserData.role === 'superadmin';
  if (isSuper && currentStore?.storeId === 'all') {
    comprobantes = all.slice();
  } else {
    comprobantes = all.filter(c =>
      c.storeId === currentStore.storeId || c.storeId === 'general'
    );
  }
}

/* Genera el siguiente número de comprobante para la tienda */
async function nextCompNumber(storeId) {
  const year = new Date().getFullYear();
  const prefix = `COMP-${year}-`;

  // Buscar el mayor en la lista cargada (más rápido que consultar Firestore)
  let maxNum = 0;
  comprobantes.forEach(c => {
    if (!c.number || !c.number.startsWith(prefix)) return;
    const n = parseInt(c.number.replace(prefix, ''), 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });

  const next = maxNum + 1;
  return prefix + String(next).padStart(4, '0');
}

/* Badge de tipo */
function compTypeBadge(type) {
  const map = {
    diario:  { cls: 'bg-blue-100 text-blue-700',    lbl: '📘 Diario' },
    ingreso: { cls: 'bg-green-100 text-green-700',  lbl: '💰 Ingreso' },
    egreso:  { cls: 'bg-orange-100 text-orange-700',lbl: '💸 Egreso' },
    ajuste:  { cls: 'bg-purple-100 text-purple-700',lbl: '🔧 Ajuste' },
    apertura:{ cls: 'bg-amber-100 text-amber-700',  lbl: '🚀 Apertura' },
    cierre:  { cls: 'bg-gray-200 text-gray-700',    lbl: '🏁 Cierre' }
  };
  const m = map[type] || map.diario;
  return `<span class="text-[10px] px-2 py-0.5 rounded ${m.cls} font-semibold whitespace-nowrap">${m.lbl}</span>`;
}

/* Badge de estado */
function compStatusBadge(status) {
  if (status === 'anulado') {
    return `<span class="text-[10px] px-2 py-0.5 rounded bg-gray-200 text-gray-600 font-semibold">⚪ Anulado</span>`;
  }
  return `<span class="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 font-semibold">✅ Activo</span>`;
}

/* Filtros */
function getFilteredComps() {
  let list = comprobantes.slice();
  const from = $('comp-date-from').value;
  const to = $('comp-date-to').value;
  const typeF = $('comp-type').value;
  const statusF = $('comp-status').value;
  const search = ($('comp-search').value || '').toLowerCase().trim();

  if (from) list = list.filter(c => c.date >= from);
  if (to) list = list.filter(c => c.date <= to);
  if (typeF !== 'all') list = list.filter(c => c.type === typeF);
  if (statusF !== 'all') {
    list = list.filter(c => statusF === 'anulado' ? c.status === 'anulado' : c.status !== 'anulado');
  }
  if (search) {
    list = list.filter(c =>
      (c.number||'').toLowerCase().includes(search) ||
      (c.concept||'').toLowerCase().includes(search)
    );
  }
  return list.sort((a,b) => (b.date||'').localeCompare(a.date||'') || (b.number||'').localeCompare(a.number||''));
}

/* Render de stats */
function renderCompStats() {
  const el = $('comp-stats');
  if (!el) return;
  const list = getFilteredComps();
  const active = list.filter(c => c.status !== 'anulado');
  const totalDebit = active.reduce((s,c) => s + Number(c.totalDebit||0), 0);
  const totalCredit = active.reduce((s,c) => s + Number(c.totalCredit||0), 0);
  const anulados = list.filter(c => c.status === 'anulado').length;

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Comprobantes</p>
      <p class="text-xl font-bold text-[#1D1D1F] mt-0.5">${list.length}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Total débitos</p>
      <p class="text-xl font-bold text-blue-600 mt-0.5">${fmt(totalDebit)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Total créditos</p>
      <p class="text-xl font-bold text-purple-600 mt-0.5">${fmt(totalCredit)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Anulados</p>
      <p class="text-xl font-bold text-gray-500 mt-0.5">${anulados}</p>
    </div>
  `;
}

/* Render de la tabla */
function renderComps() {
  renderCompStats();
  const tb = $('comp-tbody');
  const empty = $('comp-empty');
  if (!tb) return;

  const all = getFilteredComps();
  const visible = all.slice(0, compVisibleCount);

  if (!all.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderCompFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = visible.map(c => {
    const store = stores.find(s => s.storeId === c.storeId);
    const storeLabel = c.storeId === 'general' ? 'General' : (store?.name || c.storeId || '-');
    const linesCount = (c.items || []).length;
    const rowCls = c.status === 'anulado' ? 'bg-gray-50 opacity-60' : '';

    return `<tr class="border-b hover:bg-gray-50 ${rowCls}">
      <td class="p-3 text-xs font-mono">${escapeHtml(c.number) || '—'}</td>
      <td class="p-3 text-xs text-gray-600 whitespace-nowrap">${c.date || '-'}</td>
      <td class="p-3">${compTypeBadge(c.type)}</td>
      <td class="p-3 text-xs max-w-xs truncate">${escapeHtml(c.concept) || '-'}</td>
      <td class="p-3 text-xs">${escapeHtml(storeLabel)}</td>
      <td class="p-3 text-right text-xs font-bold text-blue-600">${fmt(c.totalDebit)}</td>
      <td class="p-3 text-right text-xs font-bold text-purple-600">${fmt(c.totalCredit)}</td>
      <td class="p-3 text-center text-xs text-gray-600">${linesCount}</td>
      <td class="p-3 text-center">${compStatusBadge(c.status)}</td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewCompDetail("${c.id}")' class="text-sl hover:underline text-xs mr-2">Ver</button>
        ${c.status !== 'anulado' ? `
          <button onclick='editComp("${c.id}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
          <button onclick='anularComp("${c.id}")' class="text-orange-500 hover:underline text-xs">Anular</button>
        ` : '<span class="text-[10px] text-gray-400 italic">Anulado</span>'}
      </td>
    </tr>`;
  }).join('');

  renderCompFooter(visible.length, all.length);
}

/* Footer paginación */
function renderCompFooter(shown, total) {
  let footer = $('comp-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'comp-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('comp-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }
  if (total === 0) { footer.innerHTML = ''; return; }
  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">Mostrando <b>${shown}</b> de <b>${total}</b> comprobantes</p>
    ${hasMore ? `<button onclick="loadMoreComps()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">⬇️ Cargar 100 más</button>` : `<p class="text-[10px] text-gray-400">— Fin de la lista —</p>`}
  `;
}

window.loadMoreComps = () => {
  compVisibleCount += COMP_PAGE_SIZE;
  renderComps();
};

/* Rangos rápidos */
window.setCompRange = (range) => {
  const now = new Date();
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let from, to;
  if (range === 'today') { from = to = now; }
  else if (range === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = now; }
  else if (range === 'year') { from = new Date(now.getFullYear(), 0, 1); to = now; }
  else return;
  $('comp-date-from').value = fmtD(from);
  $('comp-date-to').value = fmtD(to);
  compVisibleCount = COMP_PAGE_SIZE;
  renderComps();
};

window.clearCompFilters = () => {
  $('comp-date-from').value = '';
  $('comp-date-to').value = '';
  $('comp-type').value = 'all';
  $('comp-status').value = 'all';
  $('comp-search').value = '';
  compVisibleCount = COMP_PAGE_SIZE;
  renderComps();
};

['comp-date-from','comp-date-to','comp-type','comp-status','comp-search'].forEach(id => {
  const el = $(id);
  if (el) {
    const handler = () => { compVisibleCount = COMP_PAGE_SIZE; renderComps(); };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  }
});

/* ============================================================
   FORMULARIO DE COMPROBANTE
============================================================ */

/* Estado temporal de las líneas mientras se edita */
let compLines = [];

window.openCompForm = async () => {
  if (!canEditPuc()) return;  // misma restricción: no en "Todas las tiendas"

  // 🆕 Asegurar que el PUC esté cargado antes de abrir el form
  if (!pucAccounts.length) {
    await loadPuc();
  }

  editingCompId = null;
  compLines = [
    { accountCode: '', accountName: '', type: 'D', amount: 0, note: '' },
    { accountCode: '', accountName: '', type: 'C', amount: 0, note: '' }
  ];
  $('comp-title').innerText = 'Nuevo comprobante';
  renderCompForm({
    date: todayStr(),
    type: 'diario',
    concept: '',
    storeId: currentStore.storeId,
    notes: ''
  });
  const m = $('comp-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.editComp = async (id) => {
  const c = comprobantes.find(x => x.id === id);
  if (!c) return;
  if (c.status === 'anulado') return alert('No se puede editar un comprobante anulado.');
  if (!canEditPuc()) return;

  // 🆕 Asegurar que el PUC esté cargado
  if (!pucAccounts.length) {
    await loadPuc();
  }

  editingCompId = id;
  compLines = (c.items || []).map(it => ({ ...it }));
  if (!compLines.length) {
    compLines = [
      { accountCode: '', accountName: '', type: 'D', amount: 0, note: '' },
      { accountCode: '', accountName: '', type: 'C', amount: 0, note: '' }
    ];
  }
  $('comp-title').innerText = `Editar comprobante ${c.number || ''}`;
  renderCompForm(c);
  const m = $('comp-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeCompForm = () => {
  const m = $('comp-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingCompId = null;
  compLines = [];
};

/* Render del formulario */
function renderCompForm(v) {
  const storeOpts = stores.filter(s => s.active).map(s =>
    `<option value="${s.storeId}" ${v.storeId === s.storeId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
  ).join('');

  $('comp-body').innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Fecha *</label>
        <input id="c-date" type="date" value="${v.date || todayStr()}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Tipo *</label>
        <select id="c-type" class="w-full px-3 py-2 border rounded-lg mt-1">
          <option value="diario" ${v.type === 'diario' ? 'selected' : ''}>📘 Diario</option>
          <option value="ingreso" ${v.type === 'ingreso' ? 'selected' : ''}>💰 Ingreso</option>
          <option value="egreso" ${v.type === 'egreso' ? 'selected' : ''}>💸 Egreso</option>
          <option value="ajuste" ${v.type === 'ajuste' ? 'selected' : ''}>🔧 Ajuste</option>
          <option value="apertura" ${v.type === 'apertura' ? 'selected' : ''}>🚀 Apertura</option>
          <option value="cierre" ${v.type === 'cierre' ? 'selected' : ''}>🏁 Cierre</option>
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Tienda</label>
        <select id="c-store" class="w-full px-3 py-2 border rounded-lg mt-1" ${currentUserData.role === 'superadmin' ? '' : 'disabled'}>
          ${storeOpts}
        </select>
      </div>
    </div>

    <label class="text-xs font-semibold text-sd">Concepto *</label>
    <input id="c-concept" type="text" value="${escapeHtml(v.concept) || ''}" placeholder="Ej: Compra de mercancía a crédito" class="w-full px-3 py-2 border rounded-lg mt-1 mb-3">

    <div class="flex justify-between items-center mb-2">
      <p class="text-xs font-semibold text-sd">📋 Líneas del comprobante</p>
      <button type="button" onclick="addCompLine()" class="text-xs bg-sl text-white px-3 py-1.5 rounded-lg hover:bg-sd font-semibold">+ Agregar línea</button>
    </div>

    <div class="border border-gray-200 rounded-lg overflow-hidden mb-3">
      <table class="w-full text-xs">
        <thead class="bg-gray-50">
          <tr>
            <th class="p-2 text-left text-[10px] uppercase font-bold w-[30%]">Cuenta</th>
            <th class="p-2 text-center text-[10px] uppercase font-bold w-[70px]">Tipo</th>
            <th class="p-2 text-right text-[10px] uppercase font-bold w-[130px]">Valor</th>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Nota</th>
            <th class="p-2 w-[40px]"></th>
          </tr>
        </thead>
        <tbody id="c-lines-body"></tbody>
        <tfoot class="bg-gray-50 border-t">
          <tr>
            <td colspan="2" class="p-2 text-right font-semibold text-xs">Totales:</td>
            <td class="p-2 text-right">
              <div class="text-[10px] text-blue-600">D: <b id="c-total-d">$0</b></div>
              <div class="text-[10px] text-purple-600">C: <b id="c-total-c">$0</b></div>
            </td>
            <td colspan="2" class="p-2">
              <div id="c-balance-status" class="text-[10px] font-semibold"></div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <label class="text-xs font-semibold text-sd">Notas</label>
    <textarea id="c-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-4 text-sm">${escapeHtml(v.notes) || ''}</textarea>

    <div class="flex gap-3">
      <button onclick="closeCompForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveComp()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">Guardar</button>
    </div>
  `;

  renderCompLines();
}

/* Render de las líneas */
function renderCompLines() {
  const tb = $('c-lines-body');
  if (!tb) return;

  if (!compLines.length) {
    tb.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400 py-4 text-xs">Sin líneas</td></tr>';
    updateCompTotals();
    return;
  }

  // Cuentas que aceptan movimiento
  const movableAccounts = pucAccounts
    .filter(a => a.acceptsMovement && a.active !== false)
    .sort((a,b) => a.code.localeCompare(b.code));

  tb.innerHTML = compLines.map((line, i) => {
    const options = movableAccounts.map(a => {
      const selected = line.accountCode === a.code ? 'selected' : '';
      const label = `${a.code} · ${escapeHtml(a.name)}`;
      return `<option value="${a.code}" ${selected}>${label}</option>`;
    }).join('');

    return `<tr class="border-b">
      <td class="p-2">
        <select onchange="updateCompLine(${i},'accountCode',this.value)" class="w-full px-2 py-1.5 border rounded text-xs">
          <option value="">— Cuenta —</option>
          ${options}
        </select>
        ${line.accountCode && !line.accountName ? '' : ''}
        <div class="text-[9px] text-gray-500 mt-0.5" id="c-line-name-${i}">${escapeHtml(line.accountName||'')}</div>
      </td>
      <td class="p-2">
        <select onchange="updateCompLine(${i},'type',this.value)" class="w-full px-2 py-1.5 border rounded text-xs font-bold ${line.type === 'D' ? 'text-blue-600' : 'text-purple-600'}">
          <option value="D" ${line.type === 'D' ? 'selected' : ''}>D</option>
          <option value="C" ${line.type === 'C' ? 'selected' : ''}>C</option>
        </select>
      </td>
      <td class="p-2">
        <input type="number" min="0" step="1" value="${line.amount || ''}" onchange="updateCompLine(${i},'amount',this.value)" oninput="updateCompLine(${i},'amount',this.value)" class="w-full px-2 py-1.5 border rounded text-xs text-right font-mono" placeholder="0">
      </td>
      <td class="p-2">
        <input type="text" value="${escapeHtml(line.note) || ''}" onchange="updateCompLine(${i},'note',this.value)" class="w-full px-2 py-1.5 border rounded text-xs" placeholder="Opcional">
      </td>
      <td class="p-2 text-center">
        <button type="button" onclick="removeCompLine(${i})" class="text-red-500 hover:text-red-700 text-xs">✕</button>
      </td>
    </tr>`;
  }).join('');

  updateCompTotals();
}

window.addCompLine = () => {
  compLines.push({ accountCode: '', accountName: '', type: 'D', amount: 0, note: '' });
  renderCompLines();
};

window.removeCompLine = (i) => {
  if (compLines.length <= 2) return alert('Debe haber al menos 2 líneas (una de débito y una de crédito).');
  compLines.splice(i, 1);
  renderCompLines();
};

window.updateCompLine = (i, field, value) => {
  if (!compLines[i]) return;
  if (field === 'amount') value = Number(value) || 0;
  if (field === 'accountCode') {
    const acc = pucAccounts.find(a => a.code === value);
    compLines[i].accountCode = value;
    compLines[i].accountName = acc ? acc.name : '';
    const nameEl = $(`c-line-name-${i}`);
    if (nameEl) nameEl.innerText = acc ? acc.name : '';
  } else {
    compLines[i][field] = value;
  }
  updateCompTotals();
};

/* Actualiza totales y valida el balance */
function updateCompTotals() {
  let d = 0, c = 0;
  compLines.forEach(l => {
    const amt = Number(l.amount || 0);
    if (l.type === 'D') d += amt; else c += amt;
  });

  const dEl = $('c-total-d');
  const cEl = $('c-total-c');
  const stEl = $('c-balance-status');

  if (dEl) dEl.innerText = fmt(d);
  if (cEl) cEl.innerText = fmt(c);

  if (stEl) {
    const diff = Math.round(d - c);
    if (diff === 0 && d > 0) {
      stEl.innerHTML = '<span class="text-green-600">✓ Cuadrado</span>';
    } else if (diff === 0 && d === 0) {
      stEl.innerHTML = '<span class="text-gray-400">Sin valores</span>';
    } else {
      stEl.innerHTML = `<span class="text-red-600">✗ Descuadrado en ${fmt(Math.abs(diff))}</span>`;
    }
  }
}

/* Guardar comprobante */
window.saveComp = async () => {
  const date = $('c-date').value;
  const type = $('c-type').value;
  const concept = $('c-concept').value.trim();
  const storeId = $('c-store').value || currentStore.storeId;
  const notes = $('c-notes').value.trim();

  if (!date) return alert('La fecha es obligatoria');
  if (!concept) return alert('El concepto es obligatorio');
  if (compLines.length < 2) return alert('Debe haber al menos 2 líneas');

  // Validar líneas
  for (let i = 0; i < compLines.length; i++) {
    const l = compLines[i];
    if (!l.accountCode) return alert(`Línea ${i+1}: debes elegir una cuenta`);
    if (!l.amount || Number(l.amount) <= 0) return alert(`Línea ${i+1}: el valor debe ser mayor a 0`);
  }

  // Validar cuadrado
  let totalDebit = 0, totalCredit = 0;
  compLines.forEach(l => {
    const amt = Number(l.amount || 0);
    if (l.type === 'D') totalDebit += amt; else totalCredit += amt;
  });

  if (Math.round(totalDebit) !== Math.round(totalCredit)) {
    const diff = Math.abs(totalDebit - totalCredit);
    return alert(`⛔ El comprobante está descuadrado por ${fmt(diff)}.\n\nDébitos: ${fmt(totalDebit)}\nCréditos: ${fmt(totalCredit)}`);
  }

  // Resolver nombre de tienda
  const store = stores.find(s => s.storeId === storeId);
  const storeName = storeId === 'general' ? 'General' : (store?.name || storeId);

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Guardando...';

  try {
    const data = {
      date,
      type,
      concept,
      storeId,
      storeName,
      notes,
      items: compLines.map(l => ({
        accountCode: l.accountCode,
        accountName: l.accountName,
        type: l.type,
        amount: Number(l.amount),
        note: l.note || ''
      })),
      totalDebit,
      totalCredit,
      status: 'activo',
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };

    if (editingCompId) {
      const prev = comprobantes.find(c => c.id === editingCompId);
      await updateDoc(doc(db, 'comprobantes', editingCompId), data);
      await audit({
        action: 'update', collection: 'comprobantes', docId: editingCompId,
        before: prev, after: data,
        note: `Comprobante editado: ${prev?.number || ''} · ${concept}`
      });
    } else {
      // Generar número
      const number = await nextCompNumber(storeId);
      data.number = number;
      data.createdAt = serverTimestamp();
      data.createdBy = currentUser.email;

      const ref = await addDoc(collection(db, 'comprobantes'), data);
      await audit({
        action: 'create', collection: 'comprobantes', docId: ref.id,
        after: data,
        note: `Comprobante creado: ${number} · ${concept} · ${fmt(totalDebit)}`
      });
    }

    window.SmartecCache.invalidate('comprobantes_all');
    await loadComprobantes();
    renderComps();
    closeCompForm();
    alert('✅ Comprobante guardado');
  } catch (e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = 'Guardar';
  }
};

/* Anular */
window.anularComp = async (id) => {
  const c = comprobantes.find(x => x.id === id);
  if (!c) return;
  if (c.status === 'anulado') return alert('Ya está anulado.');

  const motivo = prompt(
    `Anular comprobante ${c.number}\n"${c.concept}" · ${fmt(c.totalDebit)}\n\n` +
    `El comprobante NO se borra (queda para auditoría).\n\nMotivo (obligatorio):`
  );
  if (!motivo || !motivo.trim()) return alert('Debes escribir el motivo.');

  try {
    await updateDoc(doc(db, 'comprobantes', id), {
      status: 'anulado',
      anuladoPor: currentUser.email,
      anuladoAt: serverTimestamp(),
      motivoAnulacion: motivo.trim(),
      updatedAt: serverTimestamp()
    });

    await audit({
      action: 'update', collection: 'comprobantes', docId: id,
      before: { status: c.status },
      after: { status: 'anulado', motivoAnulacion: motivo.trim() },
      note: `Comprobante anulado: ${c.number} · Motivo: ${motivo.trim()}`
    });

    window.SmartecCache.invalidate('comprobantes_all');
    await loadComprobantes();
    renderComps();
    alert('✅ Comprobante anulado');
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

/* Detalle */
window.viewCompDetail = (id) => {
  const c = comprobantes.find(x => x.id === id);
  if (!c) return;
  const store = stores.find(s => s.storeId === c.storeId);
  const storeLabel = c.storeId === 'general' ? 'General' : (store?.name || c.storeId);

  const linesHtml = (c.items || []).map(l => `
    <tr class="border-b">
      <td class="p-2 font-mono text-xs">${escapeHtml(l.accountCode)}</td>
      <td class="p-2 text-xs">${escapeHtml(l.accountName) || '—'}</td>
      <td class="p-2 text-center">
        <span class="text-[10px] px-2 py-0.5 rounded ${l.type === 'D' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'} font-semibold">${l.type}</span>
      </td>
      <td class="p-2 text-right text-xs font-mono font-bold">${fmt(l.amount)}</td>
      <td class="p-2 text-xs text-gray-500">${escapeHtml(l.note) || ''}</td>
    </tr>
  `).join('');

  $('comp-detail-body').innerHTML = `
    <div class="flex justify-between items-start mb-4">
      <div>
        <p class="text-xs text-gray-400">${escapeHtml(c.number) || 'Sin número'}</p>
        <p class="text-lg font-bold text-sd">${escapeHtml(c.concept)}</p>
      </div>
      ${compStatusBadge(c.status)}
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
      <div><p class="text-xs text-gray-400">Fecha</p><p class="font-semibold">${c.date}</p></div>
      <div><p class="text-xs text-gray-400">Tipo</p><p class="font-semibold">${compTypeBadge(c.type)}</p></div>
      <div><p class="text-xs text-gray-400">Tienda</p><p class="font-semibold">${escapeHtml(storeLabel)}</p></div>
      <div><p class="text-xs text-gray-400">Registró</p><p class="font-semibold text-xs">${escapeHtml(c.createdBy) || '-'}</p></div>
    </div>

    <div class="border border-gray-200 rounded-lg overflow-hidden mb-4">
      <table class="w-full text-xs">
        <thead class="bg-gray-50">
          <tr>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Cuenta</th>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Nombre</th>
            <th class="p-2 text-center text-[10px] uppercase font-bold w-[50px]">Tipo</th>
            <th class="p-2 text-right text-[10px] uppercase font-bold w-[120px]">Valor</th>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Nota</th>
          </tr>
        </thead>
        <tbody>${linesHtml}</tbody>
        <tfoot class="bg-gray-50 border-t">
          <tr>
            <td colspan="3" class="p-2 text-right font-semibold">Totales:</td>
            <td class="p-2 text-right">
              <div class="text-[10px] text-blue-600">D: <b>${fmt(c.totalDebit)}</b></div>
              <div class="text-[10px] text-purple-600">C: <b>${fmt(c.totalCredit)}</b></div>
            </td>
            <td class="p-2"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    ${c.notes ? `<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm mb-4"><p class="text-xs text-yellow-700 font-semibold mb-1">Notas</p><p>${escapeHtml(c.notes)}</p></div>` : ''}

    ${c.status === 'anulado' ? `
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
        <p class="font-bold text-red-700 mb-1">Comprobante anulado</p>
        <p class="text-xs text-red-600">Motivo: ${escapeHtml(c.motivoAnulacion) || '-'}</p>
        <p class="text-xs text-gray-500 mt-1">Por: ${escapeHtml(c.anuladoPor) || '-'}</p>
      </div>
    ` : ''}
  `;

  const m = $('comp-detail-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeCompDetail = () => {
  const m = $('comp-detail-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

/* ============================================================
   LIBRO MAYOR
============================================================ */

let mayorData = [];        // Resultado del cálculo (una fila por cuenta)
const MAYOR_PAGE_SIZE = 100;
let mayorVisibleCount = MAYOR_PAGE_SIZE;

/* Calcula el libro mayor para el rango actual */
function computeMayor() {
  const from = $('mayor-date-from')?.value || '';
  const to = $('mayor-date-to')?.value || '';

  if (!from || !to) {
    mayorData = [];
    return;
  }
  if (from > to) {
    mayorData = [];
    return;
  }

  const isSuper = currentUserData.role === 'superadmin';
  const isAllStores = isSuper && currentStore?.storeId === 'all';

  // Filtrar comprobantes por tienda
  const compsForStore = comprobantes.filter(c => {
    if (c.status === 'anulado') return false;
    if (isAllStores) return true;
    return c.storeId === currentStore.storeId || c.storeId === 'general';
  });

  // Acumuladores por cuenta
  const acc = new Map();  // code -> { openingD, openingC, periodD, periodC, moves[] }

  compsForStore.forEach(comp => {
    const items = comp.items || [];
    const isBefore = comp.date < from;
    const isInRange = comp.date >= from && comp.date <= to;

    items.forEach(it => {
      const code = it.accountCode;
      if (!code) return;

      if (!acc.has(code)) {
        acc.set(code, {
          code,
          openingD: 0, openingC: 0,
          periodD: 0, periodC: 0,
          moves: []
        });
      }
      const a = acc.get(code);
      const amt = Number(it.amount || 0);

      if (isBefore) {
        if (it.type === 'D') a.openingD += amt;
        else a.openingC += amt;
      } else if (isInRange) {
        if (it.type === 'D') a.periodD += amt;
        else a.periodC += amt;
        a.moves.push({
          date: comp.date,
          number: comp.number,
          concept: comp.concept,
          type: it.type,
          amount: amt,
          note: it.note || '',
          compId: comp.id
        });
      }
    });
  });

  // Convertir a array con datos enriquecidos
  const showAll = $('mayor-show')?.value === 'all';
  const natureF = $('mayor-nature')?.value || 'all';

  const rows = [];
  acc.forEach(a => {
    const pucAcc = pucAccounts.find(p => p.code === a.code);
    if (!pucAcc) return;  // cuenta no encontrada (raro)
    const nature = pucAcc.nature;

    // Calcular saldo inicial según naturaleza
    let openingBalance = 0;
    if (nature === 'D') openingBalance = a.openingD - a.openingC;
    else openingBalance = a.openingC - a.openingD;

    // Saldo final
    let finalBalance = 0;
    if (nature === 'D') finalBalance = openingBalance + a.periodD - a.periodC;
    else finalBalance = openingBalance + a.periodC - a.periodD;

    const hasMovement = a.periodD > 0 || a.periodC > 0 || a.openingD > 0 || a.openingC > 0;

    rows.push({
      code: a.code,
      name: pucAcc.name,
      nature,
      openingD: a.openingD,
      openingC: a.openingC,
      openingBalance,
      periodD: a.periodD,
      periodC: a.periodC,
      finalBalance,
      movesCount: a.moves.length,
      moves: a.moves.sort((x,y) => (x.date||'').localeCompare(y.date||''))
    });
  });

  // Filtrar según "mostrar"
  let filtered = rows;
  if (!showAll) {
    filtered = filtered.filter(r => r.periodD > 0 || r.periodC > 0);
  }

  // Filtrar por naturaleza
  if (natureF !== 'all') {
    filtered = filtered.filter(r => r.nature === natureF);
  }

  // Filtrar por búsqueda
  const term = ($('mayor-search')?.value || '').toLowerCase().trim();
  if (term) {
    filtered = filtered.filter(r =>
      r.code.toLowerCase().includes(term) ||
      r.name.toLowerCase().includes(term)
    );
  }

  // Ordenar por código
  filtered.sort((a,b) => a.code.localeCompare(b.code));

  mayorData = filtered;
}

/* Badge naturaleza */
function mayorNatureBadge(nature) {
  if (nature === 'D') {
    return `<span class="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">D</span>`;
  }
  return `<span class="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">C</span>`;
}

/* Stats del mayor */
function renderMayorStats() {
  const el = $('mayor-stats');
  if (!el) return;

  const totalD = mayorData.reduce((s,r) => s + Number(r.periodD||0), 0);
  const totalC = mayorData.reduce((s,r) => s + Number(r.periodC||0), 0);
  const diff = Math.round(totalD - totalC);
  const cuentasConMov = mayorData.filter(r => r.periodD > 0 || r.periodC > 0).length;

  const diffClass = diff === 0 ? 'text-green-600' : 'text-red-600';

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Cuentas con movimiento</p>
      <p class="text-xl font-bold text-[#1D1D1F] mt-0.5">${cuentasConMov}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Total débitos</p>
      <p class="text-xl font-bold text-blue-600 mt-0.5">${fmt(totalD)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Total créditos</p>
      <p class="text-xl font-bold text-purple-600 mt-0.5">${fmt(totalC)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Descuadre</p>
      <p class="text-xl font-bold ${diffClass} mt-0.5">${diff === 0 ? '✓ $0' : fmt(Math.abs(diff))}</p>
    </div>
  `;
}

/* Render del mayor */
function renderMayor() {
  computeMayor();
  renderMayorStats();

  const tb = $('mayor-tbody');
  const empty = $('mayor-empty');
  if (!tb) return;

  const total = mayorData.length;
  const visible = mayorData.slice(0, mayorVisibleCount);

  if (!total) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderMayorFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = visible.map(r => {
    const finalColor = r.finalBalance === 0 ? 'text-gray-400'
                     : r.nature === 'D'
                       ? (r.finalBalance > 0 ? 'text-blue-700' : 'text-red-600')
                       : (r.finalBalance > 0 ? 'text-purple-700' : 'text-red-600');

    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs font-mono whitespace-nowrap">${escapeHtml(r.code)}</td>
      <td class="p-3 text-xs font-semibold">${escapeHtml(r.name)}</td>
      <td class="p-3 text-center">${mayorNatureBadge(r.nature)}</td>
      <td class="p-3 text-right text-xs font-mono ${r.openingBalance === 0 ? 'text-gray-300' : 'text-gray-600'}">${fmt(r.openingBalance)}</td>
      <td class="p-3 text-right text-xs font-mono ${r.periodD === 0 ? 'text-gray-300' : 'text-blue-600'}">${fmt(r.periodD)}</td>
      <td class="p-3 text-right text-xs font-mono ${r.periodC === 0 ? 'text-gray-300' : 'text-purple-600'}">${fmt(r.periodC)}</td>
      <td class="p-3 text-right text-xs font-mono font-bold ${finalColor}">${fmt(r.finalBalance)}</td>
      <td class="p-3 text-center text-xs text-gray-500">${r.movesCount}</td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewMayorDetail("${r.code}")' class="text-sl hover:underline text-xs">Ver movs.</button>
      </td>
    </tr>`;
  }).join('');

  renderMayorFooter(visible.length, total);
}

/* Footer paginación */
function renderMayorFooter(shown, total) {
  let footer = $('mayor-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'mayor-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('mayor-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }
  if (total === 0) { footer.innerHTML = ''; return; }
  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">Mostrando <b>${shown}</b> de <b>${total}</b> cuentas</p>
    ${hasMore ? `<button onclick="loadMoreMayor()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">⬇️ Cargar 100 más</button>` : `<p class="text-[10px] text-gray-400">— Fin de la lista —</p>`}
  `;
}

window.loadMoreMayor = () => {
  mayorVisibleCount += MAYOR_PAGE_SIZE;
  renderMayor();
};

/* Rangos rápidos */
window.setMayorRange = (range) => {
  const now = new Date();
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let from, to;
  if (range === 'today') { from = to = now; }
  else if (range === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = now; }
  else if (range === 'lastmonth') {
    from = new Date(now.getFullYear(), now.getMonth()-1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0);
  }
  else if (range === 'year') { from = new Date(now.getFullYear(), 0, 1); to = now; }
  else return;
  $('mayor-date-from').value = fmtD(from);
  $('mayor-date-to').value = fmtD(to);
  mayorVisibleCount = MAYOR_PAGE_SIZE;
  renderMayor();
};

window.clearMayorFilters = () => {
  $('mayor-date-from').value = '';
  $('mayor-date-to').value = '';
  $('mayor-nature').value = 'all';
  $('mayor-show').value = 'withMovement';
  $('mayor-search').value = '';
  mayorVisibleCount = MAYOR_PAGE_SIZE;
  mayorData = [];
  renderMayor();
};

['mayor-date-from','mayor-date-to','mayor-nature','mayor-show','mayor-search'].forEach(id => {
  const el = $(id);
  if (el) {
    const handler = () => { mayorVisibleCount = MAYOR_PAGE_SIZE; renderMayor(); };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  }
});

/* Detalle de una cuenta */
window.viewMayorDetail = (code) => {
  const r = mayorData.find(x => x.code === code);
  if (!r) return;

  const movesHtml = r.moves.length ? r.moves.map(m => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 text-xs text-gray-600 whitespace-nowrap">${m.date || '-'}</td>
      <td class="p-2 text-xs font-mono">${escapeHtml(m.number) || '—'}</td>
      <td class="p-2 text-xs max-w-xs truncate">${escapeHtml(m.concept) || '-'}</td>
      <td class="p-2 text-center">
        <span class="text-[10px] px-2 py-0.5 rounded ${m.type === 'D' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'} font-semibold">${m.type}</span>
      </td>
      <td class="p-2 text-right text-xs font-mono font-bold">${fmt(m.amount)}</td>
      <td class="p-2 text-xs text-gray-500">${escapeHtml(m.note) || ''}</td>
    </tr>
  `).join('') : '<tr><td colspan="6" class="text-center text-gray-400 py-4 text-xs">Sin movimientos en el período</td></tr>';

  $('mayor-detail-body').innerHTML = `
    <div class="mb-4">
      <p class="text-xs text-gray-400 font-mono">${escapeHtml(r.code)}</p>
      <p class="text-lg font-bold text-sd">${escapeHtml(r.name)}</p>
      <p class="text-xs text-gray-500 mt-1">Naturaleza: <b>${r.nature === 'D' ? 'Débito' : 'Crédito'}</b></p>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
      <div class="bg-gray-50 rounded-lg p-3">
        <p class="text-[10px] text-gray-400">Saldo inicial</p>
        <p class="font-bold text-gray-700">${fmt(r.openingBalance)}</p>
      </div>
      <div class="bg-blue-50 rounded-lg p-3">
        <p class="text-[10px] text-blue-600">Débitos</p>
        <p class="font-bold text-blue-700">${fmt(r.periodD)}</p>
      </div>
      <div class="bg-purple-50 rounded-lg p-3">
        <p class="text-[10px] text-purple-600">Créditos</p>
        <p class="font-bold text-purple-700">${fmt(r.periodC)}</p>
      </div>
      <div class="bg-green-50 rounded-lg p-3">
        <p class="text-[10px] text-green-600">Saldo final</p>
        <p class="font-bold text-green-700">${fmt(r.finalBalance)}</p>
      </div>
    </div>

    <div class="border border-gray-200 rounded-lg overflow-hidden">
      <table class="w-full text-xs">
        <thead class="bg-gray-50">
          <tr>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Fecha</th>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Nº</th>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Concepto</th>
            <th class="p-2 text-center text-[10px] uppercase font-bold w-[50px]">Tipo</th>
            <th class="p-2 text-right text-[10px] uppercase font-bold w-[120px]">Valor</th>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Nota</th>
          </tr>
        </thead>
        <tbody>${movesHtml}</tbody>
      </table>
    </div>
  `;

  const m = $('mayor-detail-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeMayorDetail = () => {
  const m = $('mayor-detail-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

/* Exportar mayor a PDF */
window.exportMayorPDF = async () => {
  if (!mayorData.length) return alert('No hay datos para exportar. Ajusta el rango de fechas.');

  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Libro Mayor', 14, 13);

  y = 28;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  doc.text(`Período: ${$('mayor-date-from').value} — ${$('mayor-date-to').value}`, 14, y); y += 5;
  const storeLabel = currentStore?.storeId === 'all' ? 'Todas las tiendas' : (currentStore?.name || 'General');
  doc.text(`Tienda: ${storeLabel}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  const rows = mayorData.map(r => [
    r.code,
    r.name.substring(0, 40),
    r.nature,
    '$' + Number(r.openingBalance||0).toLocaleString('es-CO'),
    '$' + Number(r.periodD||0).toLocaleString('es-CO'),
    '$' + Number(r.periodC||0).toLocaleString('es-CO'),
    '$' + Number(r.finalBalance||0).toLocaleString('es-CO')
  ]);

  doc.autoTable({
    startY: y,
    head: [['Código','Cuenta','Nat','Saldo ini.','Débitos','Créditos','Saldo fin.']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    margin: { left: 10, right: 10 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 70 },
      2: { cellWidth: 12, halign: 'center' },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 30 },
      5: { halign: 'right', cellWidth: 30 },
      6: { halign: 'right', cellWidth: 32, fontStyle: 'bold' }
    }
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Smartec · Libro Mayor · Página ${i} de ${pages}`, pageW / 2, pageH - 8, { align: 'center' });
  }

  doc.save(`smartec_mayor_${new Date().toISOString().split('T')[0]}.pdf`);
};

/* ============================================================
   BALANCE DE COMPROBACIÓN
============================================================ */

let balanceData = [];
const BAL_PAGE_SIZE = 200;
let balVisibleCount = BAL_PAGE_SIZE;

/* Calcula el balance para el rango actual */
function computeBalance() {
  const from = $('bal-date-from')?.value || '';
  const to = $('bal-date-to')?.value || '';

  if (!from || !to || from > to) {
    balanceData = [];
    return;
  }

  const isSuper = currentUserData.role === 'superadmin';
  const isAllStores = isSuper && currentStore?.storeId === 'all';

  // Filtrar comprobantes por tienda
  const compsForStore = comprobantes.filter(c => {
    if (c.status === 'anulado') return false;
    if (isAllStores) return true;
    return c.storeId === currentStore.storeId || c.storeId === 'general';
  });

  // Acumuladores por cuenta
  const acc = new Map();

  compsForStore.forEach(comp => {
    if (comp.date < from || comp.date > to) return;
    (comp.items || []).forEach(it => {
      const code = it.accountCode;
      if (!code) return;

      if (!acc.has(code)) {
        acc.set(code, { code, sumD: 0, sumC: 0 });
      }
      const a = acc.get(code);
      const amt = Number(it.amount || 0);
      if (it.type === 'D') a.sumD += amt;
      else a.sumC += amt;
    });
  });

  // Convertir a array con saldos netos
  const rows = [];
  acc.forEach(a => {
    const pucAcc = pucAccounts.find(p => p.code === a.code);
    if (!pucAcc) return;
    const nature = pucAcc.nature;

    // Saldo neto según naturaleza
    let saldoDebito = 0;
    let saldoCredito = 0;

    if (nature === 'D') {
      const net = a.sumD - a.sumC;
      if (net >= 0) saldoDebito = net;
      else saldoCredito = Math.abs(net);
    } else {
      const net = a.sumC - a.sumD;
      if (net >= 0) saldoCredito = net;
      else saldoDebito = Math.abs(net);
    }

    rows.push({
      code: a.code,
      name: pucAcc.name,
      nature,
      sumD: a.sumD,
      sumC: a.sumC,
      saldoDebito,
      saldoCredito,
      level: pucAcc.level
    });
  });

  // Filtrar por nivel
  const levelF = $('bal-level')?.value || '4';
  if (levelF !== 'all') {
    const minLevel = Number(levelF);
    // Mostrar cuentas de nivel >= minLevel (nivel 4 = subcuentas)
    // pero también las de nivel superior si tienen movimientos directos
    // Simplificación: mostrar todas con movimiento y su nivel >= minLevel
    // Para no ocultar cuentas que sí tienen movimiento
    // (esto es una decisión de diseño: preferimos ver TODO lo que tenga movimiento)
    // Dejamos pasar todas y solo filtramos las agrupadoras sin movimiento
    // → en este caso mostramos todas; el filtro nivel es solo informativo
  }

  // Filtrar por naturaleza
  const natureF = $('bal-nature')?.value || 'all';
  let filtered = rows;
  if (natureF !== 'all') {
    filtered = filtered.filter(r => r.nature === natureF);
  }

  // Filtrar por búsqueda
  const term = ($('bal-search')?.value || '').toLowerCase().trim();
  if (term) {
    filtered = filtered.filter(r =>
      r.code.toLowerCase().includes(term) ||
      r.name.toLowerCase().includes(term)
    );
  }

  filtered.sort((a,b) => a.code.localeCompare(b.code));
  balanceData = filtered;
}

/* Badge naturaleza */
function balNatureBadge(nature) {
  if (nature === 'D') {
    return `<span class="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">D</span>`;
  }
  return `<span class="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">C</span>`;
}

/* Banner de cuadre */
function renderBalStatus() {
  const banner = $('bal-status-banner');
  if (!banner) return;

  const totalD = balanceData.reduce((s,r) => s + Number(r.saldoDebito||0), 0);
  const totalC = balanceData.reduce((s,r) => s + Number(r.saldoCredito||0), 0);
  const diff = Math.round(totalD - totalC);

  if (!balanceData.length) {
    banner.innerHTML = '';
    return;
  }

  if (diff === 0) {
    banner.innerHTML = `
      <div class="bg-green-50 border-l-4 border-green-500 rounded-lg p-4 flex justify-between items-center">
        <div>
          <p class="font-bold text-green-700">✓ BALANCE CUADRADO</p>
          <p class="text-xs text-green-600 mt-0.5">Débitos = Créditos = ${fmt(totalD)}</p>
        </div>
        <p class="text-2xl font-bold text-green-700">✓</p>
      </div>
    `;
  } else {
    banner.innerHTML = `
      <div class="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 flex justify-between items-center">
        <div>
          <p class="font-bold text-red-700">✗ BALANCE DESCUADRADO</p>
          <p class="text-xs text-red-600 mt-0.5">Diferencia: ${fmt(Math.abs(diff))} (${diff > 0 ? 'más débitos' : 'más créditos'})</p>
        </div>
        <p class="text-2xl font-bold text-red-700">✗</p>
      </div>
    `;
  }
}

/* Stats */
function renderBalStats() {
  const el = $('bal-stats');
  if (!el) return;

  const totalD = balanceData.reduce((s,r) => s + Number(r.saldoDebito||0), 0);
  const totalC = balanceData.reduce((s,r) => s + Number(r.saldoCredito||0), 0);
  const cuentaConSaldoD = balanceData.filter(r => r.saldoDebito > 0).length;
  const cuentaConSaldoC = balanceData.filter(r => r.saldoCredito > 0).length;

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Total cuentas</p>
      <p class="text-xl font-bold text-[#1D1D1F] mt-0.5">${balanceData.length}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Con saldo débito</p>
      <p class="text-xl font-bold text-blue-600 mt-0.5">${cuentaConSaldoD}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Con saldo crédito</p>
      <p class="text-xl font-bold text-purple-600 mt-0.5">${cuentaConSaldoC}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Total débitos</p>
      <p class="text-xl font-bold text-[#1D1D1F] mt-0.5">${fmt(totalD)}</p>
      <p class="text-[10px] text-gray-500 mt-0.5">Créditos: ${fmt(totalC)}</p>
    </div>
  `;
}

/* Render del balance */
function renderBalance() {
  computeBalance();
  renderBalStatus();
  renderBalStats();

  const tb = $('bal-tbody');
  const empty = $('bal-empty');
  if (!tb) return;

  const total = balanceData.length;
  const visible = balanceData.slice(0, balVisibleCount);

  // Totales globales (sobre TODAS las cuentas, no solo las visibles)
  const totalD = balanceData.reduce((s,r) => s + Number(r.saldoDebito||0), 0);
  const totalC = balanceData.reduce((s,r) => s + Number(r.saldoCredito||0), 0);
  $('bal-total-d').innerText = fmt(totalD);
  $('bal-total-c').innerText = fmt(totalC);

  if (!total) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderBalFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = visible.map(r => {
    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs font-mono whitespace-nowrap">${escapeHtml(r.code)}</td>
      <td class="p-3 text-xs font-semibold">${escapeHtml(r.name)}</td>
      <td class="p-3 text-center">${balNatureBadge(r.nature)}</td>
      <td class="p-3 text-right text-xs font-mono ${r.saldoDebito === 0 ? 'text-gray-300' : 'text-blue-700 font-bold'}">${r.saldoDebito === 0 ? '—' : fmt(r.saldoDebito)}</td>
      <td class="p-3 text-right text-xs font-mono ${r.saldoCredito === 0 ? 'text-gray-300' : 'text-purple-700 font-bold'}">${r.saldoCredito === 0 ? '—' : fmt(r.saldoCredito)}</td>
    </tr>`;
  }).join('');

  renderBalFooter(visible.length, total);
}

/* Footer paginación */
function renderBalFooter(shown, total) {
  let footer = $('bal-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'bal-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('bal-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }
  if (total === 0) { footer.innerHTML = ''; return; }
  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">Mostrando <b>${shown}</b> de <b>${total}</b> cuentas</p>
    ${hasMore ? `<button onclick="loadMoreBal()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">⬇️ Cargar 200 más</button>` : `<p class="text-[10px] text-gray-400">— Fin de la lista —</p>`}
  `;
}

window.loadMoreBal = () => {
  balVisibleCount += BAL_PAGE_SIZE;
  renderBalance();
};

/* Rangos rápidos */
window.setBalRange = (range) => {
  const now = new Date();
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let from, to;
  if (range === 'today') { from = to = now; }
  else if (range === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = now; }
  else if (range === 'lastmonth') {
    from = new Date(now.getFullYear(), now.getMonth()-1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0);
  }
  else if (range === 'year') { from = new Date(now.getFullYear(), 0, 1); to = now; }
  else return;
  $('bal-date-from').value = fmtD(from);
  $('bal-date-to').value = fmtD(to);
  balVisibleCount = BAL_PAGE_SIZE;
  renderBalance();
};

window.clearBalFilters = () => {
  $('bal-date-from').value = '';
  $('bal-date-to').value = '';
  $('bal-nature').value = 'all';
  $('bal-level').value = '4';
  $('bal-search').value = '';
  balVisibleCount = BAL_PAGE_SIZE;
  balanceData = [];
  renderBalance();
};

['bal-date-from','bal-date-to','bal-nature','bal-level','bal-search'].forEach(id => {
  const el = $(id);
  if (el) {
    const handler = () => { balVisibleCount = BAL_PAGE_SIZE; renderBalance(); };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  }
});

/* Exportar PDF */
window.exportBalancePDF = async () => {
  if (!balanceData.length) return alert('No hay datos. Ajusta el rango de fechas.');

  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Balance de Comprobación', 14, 13);

  y = 28;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  doc.text(`Período: ${$('bal-date-from').value} — ${$('bal-date-to').value}`, 14, y); y += 5;
  const storeLabel = currentStore?.storeId === 'all' ? 'Todas las tiendas' : (currentStore?.name || 'General');
  doc.text(`Tienda: ${storeLabel}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  const totalD = balanceData.reduce((s,r) => s + Number(r.saldoDebito||0), 0);
  const totalC = balanceData.reduce((s,r) => s + Number(r.saldoCredito||0), 0);
  const diff = Math.round(totalD - totalC);

  // Banner de cuadre
  if (diff === 0) {
    doc.setFillColor(220, 252, 231);
    doc.rect(14, y, pageW - 28, 10, 'F');
    doc.setTextColor(21, 128, 61);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`✓ BALANCE CUADRADO  ·  Débitos = Créditos = $${totalD.toLocaleString('es-CO')}`, 18, y + 7);
  } else {
    doc.setFillColor(254, 226, 226);
    doc.rect(14, y, pageW - 28, 10, 'F');
    doc.setTextColor(185, 28, 28);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`✗ DESCUADRADO por $${Math.abs(diff).toLocaleString('es-CO')}`, 18, y + 7);
  }
  y += 16;

  // Tabla
  const rows = balanceData.map(r => [
    r.code,
    r.name.substring(0, 45),
    r.nature,
    r.saldoDebito === 0 ? '' : '$' + Number(r.saldoDebito).toLocaleString('es-CO'),
    r.saldoCredito === 0 ? '' : '$' + Number(r.saldoCredito).toLocaleString('es-CO')
  ]);

  // Totales al final
  rows.push([
    { content: 'TOTALES', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right', fillColor: [230, 230, 230] } },
    { content: '$' + totalD.toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right', textColor: [29, 78, 216], fillColor: [230, 230, 230] } },
    { content: '$' + totalC.toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right', textColor: [126, 34, 206], fillColor: [230, 230, 230] } }
  ]);

  doc.autoTable({
    startY: y,
    head: [['Código','Cuenta','Nat','Saldo débito','Saldo crédito']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 80 },
      2: { cellWidth: 12, halign: 'center' },
      3: { halign: 'right', cellWidth: 35 },
      4: { halign: 'right', cellWidth: 35 }
    }
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Smartec · Balance de Comprobación · Página ${i} de ${pages}`, pageW / 2, pageH - 8, { align: 'center' });
  }

  doc.save(`smartec_balance_${new Date().toISOString().split('T')[0]}.pdf`);
};

/* ============================================================
   ESTADO DE SITUACIÓN FINANCIERA
============================================================ */

let estadoData = {
  activo: [],
  pasivo: [],
  patrimonio: [],
  resultadoEjercicio: 0,
  totalActivo: 0,
  totalPasivo: 0,
  totalPatrimonio: 0,
  totalPasivoPatrimonio: 0,
  cuadra: false,
  diferencia: 0
};

/* Calcula el estado a una fecha de corte */
function computeEstado() {
  const cutoff = $('est-date')?.value || '';
  if (!cutoff) {
    estadoData = {
      activo: [], pasivo: [], patrimonio: [],
      resultadoEjercicio: 0,
      totalActivo: 0, totalPasivo: 0, totalPatrimonio: 0,
      totalPasivoPatrimonio: 0, cuadra: false, diferencia: 0
    };
    return;
  }

  const isSuper = currentUserData.role === 'superadmin';
  const isAllStores = isSuper && currentStore?.storeId === 'all';

  // Filtrar comprobantes por tienda
  const compsForStore = comprobantes.filter(c => {
    if (c.status === 'anulado') return false;
    if (isAllStores) return true;
    return c.storeId === currentStore.storeId || c.storeId === 'general';
  });

  // Acumuladores: code -> {D, C}
  const acc = new Map();

  compsForStore.forEach(comp => {
    if (comp.date > cutoff) return;
    (comp.items || []).forEach(it => {
      const code = it.accountCode;
      if (!code) return;
      if (!acc.has(code)) acc.set(code, { D: 0, C: 0 });
      const a = acc.get(code);
      const amt = Number(it.amount || 0);
      if (it.type === 'D') a.D += amt;
      else a.C += amt;
    });
  });

  // Clasificar cuentas por clase (primer dígito)
  const bucket = {
    activo: [],       // clase 1
    pasivo: [],       // clase 2
    patrimonio: [],   // clase 3
    ingresos: [],     // clase 4
    gastos: [],       // clase 5
    costos: [],       // clase 6
    ordenD: [],       // clase 8
    ordenC: []        // clase 9
  };

  acc.forEach((v, code) => {
    const pucAcc = pucAccounts.find(p => p.code === code);
    if (!pucAcc) return;

    // Saldo neto según naturaleza
    let saldo = 0;
    if (pucAcc.nature === 'D') saldo = v.D - v.C;
    else saldo = v.C - v.D;

    // Ignorar cuentas en cero
    if (Math.round(saldo) === 0) return;

    const firstDigit = code[0];
    const item = {
      code,
      name: pucAcc.name,
      nature: pucAcc.nature,
      level: pucAcc.level,
      saldo
    };

    if (firstDigit === '1') bucket.activo.push(item);
    else if (firstDigit === '2') bucket.pasivo.push(item);
    else if (firstDigit === '3') bucket.patrimonio.push(item);
    else if (firstDigit === '4') bucket.ingresos.push(item);
    else if (firstDigit === '5') bucket.gastos.push(item);
    else if (firstDigit === '6') bucket.costos.push(item);
    else if (firstDigit === '8') bucket.ordenD.push(item);
    else if (firstDigit === '9') bucket.ordenC.push(item);
  });

  // Calcular resultado del ejercicio
  // Ingresos (saldo C) - Gastos (saldo D) - Costos (saldo D)
  const totalIngresos = bucket.ingresos.reduce((s,i) => s + Math.abs(i.saldo), 0);
  const totalGastos = bucket.gastos.reduce((s,i) => s + Math.abs(i.saldo), 0);
  const totalCostos = bucket.costos.reduce((s,i) => s + Math.abs(i.saldo), 0);
  const resultadoEjercicio = totalIngresos - totalGastos - totalCostos;

  // Aplicar filtro de nivel y "solo con saldo"
  const levelF = Number($('est-level')?.value || 4);
  const showAll = $('est-show')?.value === 'all';

  function filterList(list) {
    let out = list.filter(i => i.level >= levelF);
    if (!showAll) out = out.filter(i => Math.round(i.saldo) !== 0);
    out.sort((a,b) => a.code.localeCompare(b.code));
    return out;
  }

  const activo = filterList(bucket.activo);
  const pasivo = filterList(bucket.pasivo);
  const patrimonio = filterList(bucket.patrimonio);

  // Totales
  const totalActivo = activo.reduce((s,i) => s + i.saldo, 0);
  const totalPasivo = pasivo.reduce((s,i) => s + Math.abs(i.saldo), 0);
  const totalPatrimonioBase = patrimonio.reduce((s,i) => s + Math.abs(i.saldo), 0);
  // Sumamos el resultado del ejercicio al patrimonio
  const totalPatrimonio = totalPatrimonioBase + resultadoEjercicio;
  const totalPasivoPatrimonio = totalPasivo + totalPatrimonio;
  const diferencia = Math.round(totalActivo - totalPasivoPatrimonio);

  estadoData = {
    activo,
    pasivo,
    patrimonio,
    resultadoEjercicio,
    totalIngresos,
    totalGastos,
    totalCostos,
    totalActivo,
    totalPasivo,
    totalPatrimonioBase,
    totalPatrimonio,
    totalPasivoPatrimonio,
    cuadra: diferencia === 0,
    diferencia
  };
}

/* Render del banner de ecuación */
function renderEstEquation() {
  const el = $('est-equation');
  if (!el) return;

  const d = estadoData;
  const color = d.cuadra ? 'green' : 'red';
  const icon = d.cuadra ? '✓' : '✗';
  const label = d.cuadra ? 'ECUACIÓN CUADRADA' : `DESCUADRE DE ${fmt(Math.abs(d.diferencia))}`;

  el.innerHTML = `
    <div class="bg-${color}-50 border-l-4 border-${color}-500 rounded-lg p-4">
      <div class="flex justify-between items-center flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <span class="text-2xl font-bold text-${color}-700">${icon}</span>
          <div>
            <p class="font-bold text-${color}-700 text-sm">${label}</p>
            <p class="text-xs text-${color}-600 mt-0.5">Activo = Pasivo + Patrimonio</p>
          </div>
        </div>
        <div class="flex gap-4 items-center text-sm flex-wrap">
          <div class="text-right">
            <p class="text-[10px] text-gray-500 font-semibold">ACTIVO</p>
            <p class="font-bold text-blue-700">${fmt(d.totalActivo)}</p>
          </div>
          <p class="text-gray-400 font-bold">=</p>
          <div class="text-right">
            <p class="text-[10px] text-gray-500 font-semibold">PASIVO</p>
            <p class="font-bold text-orange-700">${fmt(d.totalPasivo)}</p>
          </div>
          <p class="text-gray-400 font-bold">+</p>
          <div class="text-right">
            <p class="text-[10px] text-gray-500 font-semibold">PATRIMONIO</p>
            <p class="font-bold text-purple-700">${fmt(d.totalPatrimonio)}</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* Genera el HTML de una sección (Activo, Pasivo, Patrimonio) */
function renderEstSection(title, emoji, items, total, colorCls, extraHtml = '') {
  if (!items.length && !extraHtml) {
    return `
      <div class="glass-strong rounded-2xl shadow-apple-lg p-4 border border-white/60 mb-4">
        <h3 class="font-bold text-${colorCls}-700 mb-3 text-sm uppercase tracking-wider">${emoji} ${title}</h3>
        <p class="text-xs text-gray-400 text-center py-4">Sin movimientos en el período</p>
        <div class="border-t pt-3 flex justify-between font-bold text-${colorCls}-700">
          <span>TOTAL ${title.toUpperCase()}</span>
          <span>${fmt(total)}</span>
        </div>
      </div>
    `;
  }

  const rowsHtml = items.map(i => {
    const indent = (i.level - 3) * 12;
    const isAgrupadora = i.level < 4;
    return `
      <div class="flex justify-between items-center py-1.5 border-b border-gray-100 last:border-0">
        <div class="flex items-center gap-2 flex-1 min-w-0" style="padding-left:${indent}px">
          <span class="text-[10px] font-mono text-gray-400 flex-shrink-0">${escapeHtml(i.code)}</span>
          <span class="text-xs ${isAgrupadora ? 'font-semibold text-gray-600' : 'text-gray-700'} truncate">${escapeHtml(i.name)}</span>
        </div>
        <span class="text-xs font-mono font-semibold text-${colorCls}-700 whitespace-nowrap ml-2">${fmt(i.saldo)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="glass-strong rounded-2xl shadow-apple-lg p-4 border border-white/60 mb-4">
      <h3 class="font-bold text-${colorCls}-700 mb-3 text-sm uppercase tracking-wider">${emoji} ${title}</h3>
      <div class="max-h-[400px] overflow-y-auto scrollbar-thin">
        ${rowsHtml || '<p class="text-xs text-gray-400 text-center py-4">Sin movimientos</p>'}
      </div>
      ${extraHtml}
      <div class="border-t-2 border-${colorCls}-300 mt-3 pt-3 flex justify-between font-bold text-${colorCls}-700 text-sm">
        <span>TOTAL ${title.toUpperCase()}</span>
        <span class="font-mono">${fmt(total)}</span>
      </div>
    </div>
  `;
}

/* Render del estado completo */
function renderEstado() {
  computeEstado();
  renderEstEquation();

  const el = $('est-content');
  if (!el) return;

  const d = estadoData;

  if (!d.activo.length && !d.pasivo.length && !d.patrimonio.length && d.resultadoEjercicio === 0) {
    el.innerHTML = '<p class="text-center py-8 text-[#6E6E73]">Sin movimientos hasta la fecha de corte.</p>';
    return;
  }

  // HTML del resultado del ejercicio (línea extra en patrimonio)
  let resultadoHtml = '';
  if (Math.round(d.resultadoEjercicio) !== 0) {
    const color = d.resultadoEjercicio >= 0 ? 'green' : 'red';
    const label = d.resultadoEjercicio >= 0 ? 'Utilidad del ejercicio' : 'Pérdida del ejercicio';
    resultadoHtml = `
      <div class="flex justify-between items-center py-1.5 border-b border-gray-100 bg-${color}-50/50 -mx-2 px-2 rounded">
        <div class="flex items-center gap-2 flex-1">
          <span class="text-[10px] font-mono text-gray-400">—</span>
          <span class="text-xs font-semibold text-${color}-700">${label} (Ingresos − Gastos − Costos)</span>
        </div>
        <span class="text-xs font-mono font-semibold text-${color}-700 whitespace-nowrap ml-2">${fmt(d.resultadoEjercicio)}</span>
      </div>
    `;
  }

  // Detalle del cálculo del resultado (informativo)
  const detalleResultadoHtml = `
    <div class="mt-3 pt-3 border-t border-gray-200">
      <details class="text-xs">
        <summary class="cursor-pointer text-gray-500 hover:text-gray-700 font-semibold">📊 Ver detalle del resultado</summary>
        <div class="mt-2 space-y-1 text-gray-600">
          <div class="flex justify-between"><span>Ingresos (clase 4)</span><span class="font-mono text-green-700">${fmt(d.totalIngresos)}</span></div>
          <div class="flex justify-between"><span>− Gastos (clase 5)</span><span class="font-mono text-red-600">${fmt(d.totalGastos)}</span></div>
          <div class="flex justify-between"><span>− Costos (clase 6)</span><span class="font-mono text-orange-600">${fmt(d.totalCostos)}</span></div>
          <div class="flex justify-between border-t pt-1 font-bold"><span>= Resultado</span><span class="font-mono ${d.resultadoEjercicio >= 0 ? 'text-green-700' : 'text-red-600'}">${fmt(d.resultadoEjercicio)}</span></div>
        </div>
      </details>
    </div>
  `;

  el.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        ${renderEstSection('Activo', '💰', d.activo, d.totalActivo, 'blue')}
      </div>
      <div>
        ${renderEstSection('Pasivo', '📤', d.pasivo, d.totalPasivo, 'orange')}
        ${renderEstSection('Patrimonio', '🏛️', d.patrimonio, d.totalPatrimonio, 'purple', resultadoHtml + detalleResultadoHtml)}
      </div>
    </div>

    <div class="glass-strong rounded-2xl shadow-apple-lg p-4 border-2 border-${d.cuadra ? 'green' : 'red'}-300 mt-4">
      <div class="flex justify-between items-center flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <span class="text-3xl">${d.cuadra ? '✓' : '✗'}</span>
          <div>
            <p class="font-bold text-${d.cuadra ? 'green' : 'red'}-700">${d.cuadra ? 'ECUACIÓN CUADRADA' : 'ECUACIÓN DESCUADRADA'}</p>
            <p class="text-xs text-gray-500 mt-0.5">Activo = Pasivo + Patrimonio</p>
          </div>
        </div>
        <div class="text-right">
          <div class="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p class="text-[10px] text-gray-500 font-semibold">ACTIVO</p>
              <p class="font-bold text-blue-700 font-mono">${fmt(d.totalActivo)}</p>
            </div>
            <div>
              <p class="text-[10px] text-gray-500 font-semibold">PASIVO + PAT.</p>
              <p class="font-bold text-purple-700 font-mono">${fmt(d.totalPasivoPatrimonio)}</p>
            </div>
            <div>
              <p class="text-[10px] text-gray-500 font-semibold">DIFERENCIA</p>
              <p class="font-bold ${d.cuadra ? 'text-green-700' : 'text-red-700'} font-mono">${d.cuadra ? '$0' : fmt(Math.abs(d.diferencia))}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* Rangos rápidos de fecha */
window.setEstDate = (range) => {
  const now = new Date();
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let date;
  if (range === 'today') date = now;
  else if (range === 'endmonth') date = new Date(now.getFullYear(), now.getMonth()+1, 0);
  else if (range === 'endlastmonth') date = new Date(now.getFullYear(), now.getMonth(), 0);
  else if (range === 'endyear') date = new Date(now.getFullYear(), 11, 31);
  else return;
  $('est-date').value = fmtD(date);
  renderEstado();
};

['est-date','est-show','est-level'].forEach(id => {
  const el = $(id);
  if (el) {
    el.addEventListener('input', renderEstado);
    el.addEventListener('change', renderEstado);
  }
});

/* Exportar PDF */
window.exportEstadoPDF = async () => {
  computeEstado();
  const d = estadoData;
  if (!d.activo.length && !d.pasivo.length && !d.patrimonio.length && d.resultadoEjercicio === 0) {
    return alert('No hay datos para exportar.');
  }

  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  // Header
  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Estado de Situación Financiera', 14, 13);

  y = 28;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  doc.text(`Fecha de corte: ${$('est-date').value}`, 14, y); y += 5;
  const storeLabel = currentStore?.storeId === 'all' ? 'Todas las tiendas' : (currentStore?.name || 'General');
  doc.text(`Tienda: ${storeLabel}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  // Banner ecuación
  if (d.cuadra) {
    doc.setFillColor(220, 252, 231);
    doc.rect(14, y, pageW - 28, 10, 'F');
    doc.setTextColor(21, 128, 61);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`CUADRADO · Activo = Pasivo + Patrimonio = $${d.totalActivo.toLocaleString('es-CO')}`, 18, y + 7);
  } else {
    doc.setFillColor(254, 226, 226);
    doc.rect(14, y, pageW - 28, 10, 'F');
    doc.setTextColor(185, 28, 28);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`DESCUADRADO por $${Math.abs(d.diferencia).toLocaleString('es-CO')}`, 18, y + 7);
  }
  y += 16;

  // ACTIVO
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(29, 78, 216);
  doc.text('ACTIVO', 14, y); y += 2;

  const activoRows = d.activo.map(i => [i.code, i.name.substring(0, 60), '$' + i.saldo.toLocaleString('es-CO')]);
  if (activoRows.length) {
    doc.autoTable({
      startY: y,
      head: [['Código','Cuenta','Saldo']],
      body: activoRows,
      foot: [[{ content: 'TOTAL ACTIVO', colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } }, { content: '$' + d.totalActivo.toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right' } }]],
      theme: 'grid',
      headStyles: { fillColor: [29, 78, 216], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      footStyles: { fillColor: [219, 234, 254], textColor: [29, 78, 216], fontSize: 9 },
      margin: { left: 14, right: 14 },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 120 }, 2: { halign: 'right', cellWidth: 40 } }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // PASIVO
  if (y > pageH - 60) { doc.addPage(); y = 20; }
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(194, 65, 12);
  doc.text('PASIVO', 14, y); y += 2;

  const pasivoRows = d.pasivo.map(i => [i.code, i.name.substring(0, 60), '$' + Math.abs(i.saldo).toLocaleString('es-CO')]);
  if (pasivoRows.length) {
    doc.autoTable({
      startY: y,
      head: [['Código','Cuenta','Saldo']],
      body: pasivoRows,
      foot: [[{ content: 'TOTAL PASIVO', colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } }, { content: '$' + d.totalPasivo.toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right' } }]],
      theme: 'grid',
      headStyles: { fillColor: [194, 65, 12], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      footStyles: { fillColor: [254, 215, 170], textColor: [194, 65, 12], fontSize: 9 },
      margin: { left: 14, right: 14 },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 120 }, 2: { halign: 'right', cellWidth: 40 } }
    });
    y = doc.lastAutoTable.finalY + 8;
  } else {
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120, 120, 120);
    doc.text('Sin movimientos', 18, y + 5);
    y += 10;
  }

  // PATRIMONIO
  if (y > pageH - 60) { doc.addPage(); y = 20; }
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(126, 34, 206);
  doc.text('PATRIMONIO', 14, y); y += 2;

  const patRows = d.patrimonio.map(i => [i.code, i.name.substring(0, 60), '$' + Math.abs(i.saldo).toLocaleString('es-CO')]);
  if (Math.round(d.resultadoEjercicio) !== 0) {
    patRows.push(['—', d.resultadoEjercicio >= 0 ? 'Utilidad del ejercicio' : 'Pérdida del ejercicio', '$' + d.resultadoEjercicio.toLocaleString('es-CO')]);
  }
  if (patRows.length) {
    doc.autoTable({
      startY: y,
      head: [['Código','Cuenta','Saldo']],
      body: patRows,
      foot: [[{ content: 'TOTAL PATRIMONIO', colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } }, { content: '$' + d.totalPatrimonio.toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right' } }]],
      theme: 'grid',
      headStyles: { fillColor: [126, 34, 206], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      footStyles: { fillColor: [233, 213, 255], textColor: [126, 34, 206], fontSize: 9 },
      margin: { left: 14, right: 14 },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 120 }, 2: { halign: 'right', cellWidth: 40 } }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // Total general
  if (y > pageH - 40) { doc.addPage(); y = 20; }
  doc.setFillColor(240, 240, 240);
  doc.rect(14, y, pageW - 28, 14, 'F');
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(10, 42, 74);
  doc.text('TOTAL PASIVO + PATRIMONIO', 18, y + 9);
  doc.text('$' + d.totalPasivoPatrimonio.toLocaleString('es-CO'), pageW - 18, y + 9, { align: 'right' });

  // Footer
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Smartec · Estado Financiero · Página ${i} de ${pages}`, pageW / 2, pageH - 8, { align: 'center' });
  }

  doc.save(`smartec_estado_financiero_${new Date().toISOString().split('T')[0]}.pdf`);
};

/* ============================================================
   CONCILIACIÓN BANCARIA
============================================================ */

let conciliaciones = [];
let editingConcId = null;
const CONC_PAGE_SIZE = 100;
let concVisibleCount = CONC_PAGE_SIZE;
let concLines = [];  // Líneas de partidas conciliatorias en el form

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/* Cuentas bancarias (clase 11: 1110 Bancos, 1120 Cuentas de ahorro) */
function getBankAccounts() {
  return pucAccounts
    .filter(a => a.acceptsMovement && (a.code.startsWith('1110') || a.code.startsWith('1120')))
    .sort((a,b) => a.code.localeCompare(b.code));
}

/* Carga conciliaciones */
async function loadConciliaciones() {
  const C = window.SmartecCache;
  const all = await C.wrap('conciliaciones_all', async () => {
    const s = await getDocs(collection(db, 'conciliaciones'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  const isSuper = currentUserData.role === 'superadmin';
  if (isSuper && currentStore?.storeId === 'all') {
    conciliaciones = all.slice();
  } else {
    conciliaciones = all.filter(c =>
      c.storeId === currentStore.storeId || c.storeId === 'general'
    );
  }
}

/* Calcular saldo según libros (contabilidad) para una cuenta y período */
function calcSaldoLibros(accountCode, year, month) {
  // Todos los movimientos HASTA el último día del mes
  const lastDay = new Date(year, month, 0).getDate();
  const cutoff = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  const isSuper = currentUserData.role === 'superadmin';
  const isAllStores = isSuper && currentStore?.storeId === 'all';

  let saldoD = 0, saldoC = 0;

  comprobantes.forEach(comp => {
    if (comp.status === 'anulado') return;
    if (comp.date > cutoff) return;
    if (!isAllStores && comp.storeId !== currentStore.storeId && comp.storeId !== 'general') return;

    (comp.items || []).forEach(it => {
      if (it.accountCode !== accountCode) return;
      const amt = Number(it.amount || 0);
      if (it.type === 'D') saldoD += amt;
      else saldoC += amt;
    });
  });

  // Para cuentas de activo (naturaleza D), el saldo es D - C
  const pucAcc = pucAccounts.find(a => a.code === accountCode);
  const nature = pucAcc?.nature || 'D';
  return nature === 'D' ? (saldoD - saldoC) : (saldoC - saldoD);
}

/* Badge estado */
function concStatusBadge(status) {
  if (status === 'conciliado') {
    return `<span class="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 font-semibold">✓ Conciliado</span>`;
  }
  return `<span class="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">✗ Descuadrado</span>`;
}

/* Filtros */
function getFilteredConc() {
  let list = conciliaciones.slice();
  const accountF = $('conc-filter-account').value;
  const yearF = $('conc-filter-year').value;
  const statusF = $('conc-filter-status').value;
  const monthF = $('conc-filter-month').value;
  const search = ($('conc-search').value || '').toLowerCase().trim();

  if (accountF !== 'all') list = list.filter(c => c.accountCode === accountF);
  if (yearF !== 'all') list = list.filter(c => String(c.year) === yearF);
  if (monthF !== 'all') list = list.filter(c => String(c.month) === monthF);
  if (statusF !== 'all') list = list.filter(c => c.status === statusF);
  if (search) {
    list = list.filter(c =>
      (c.accountCode||'').toLowerCase().includes(search) ||
      (c.accountName||'').toLowerCase().includes(search) ||
      (c.bankName||'').toLowerCase().includes(search)
    );
  }
  return list.sort((a,b) => (b.year - a.year) || (b.month - a.month));
}

/* Stats */
function renderConcStats() {
  const el = $('conc-stats');
  if (!el) return;
  const list = getFilteredConc();
  const conciliadas = list.filter(c => c.status === 'conciliado').length;
  const descuadradas = list.filter(c => c.status !== 'conciliado').length;
  const totalDiferencias = list.reduce((s,c) => s + Math.abs(c.diferencia || 0), 0);

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Total</p>
      <p class="text-xl font-bold text-[#1D1D1F] mt-0.5">${list.length}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">✓ Conciliadas</p>
      <p class="text-xl font-bold text-green-600 mt-0.5">${conciliadas}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">✗ Descuadradas</p>
      <p class="text-xl font-bold text-red-600 mt-0.5">${descuadradas}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Σ Diferencias</p>
      <p class="text-xl font-bold text-orange-600 mt-0.5">${fmt(totalDiferencias)}</p>
    </div>
  `;
}

/* Render tabla */
function renderConciliaciones() {
  renderConcStats();
  const tb = $('conc-tbody');
  const empty = $('conc-empty');
  if (!tb) return;

  const all = getFilteredConc();
  const visible = all.slice(0, concVisibleCount);

  if (!all.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderConcFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = visible.map(c => {
    return `<tr class="border-b hover:bg-gray-50 ${c.status !== 'conciliado' ? 'bg-red-50/30' : ''}">
      <td class="p-3 text-xs font-mono whitespace-nowrap">${escapeHtml(c.accountCode)}</td>
      <td class="p-3 text-xs whitespace-nowrap">${MONTH_NAMES[(c.month||1)-1]} ${c.year}</td>
      <td class="p-3 text-xs">${escapeHtml(c.accountName) || '—'}</td>
      <td class="p-3 text-right text-xs font-mono">${fmt(c.saldoLibros)}</td>
      <td class="p-3 text-right text-xs font-mono">${fmt(c.saldoExtracto)}</td>
      <td class="p-3 text-right text-xs font-mono font-bold text-sd">${fmt(c.saldoConciliado)}</td>
      <td class="p-3 text-center">${concStatusBadge(c.status)}</td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewConcDetail("${c.id}")' class="text-sl hover:underline text-xs mr-2">Ver</button>
        <button onclick='editConc("${c.id}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
        <button onclick='deleteConc("${c.id}")' class="text-red-500 hover:underline text-xs">Eliminar</button>
      </td>
    </tr>`;
  }).join('');

  renderConcFooter(visible.length, all.length);
}

function renderConcFooter(shown, total) {
  let footer = $('conc-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'conc-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('conc-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }
  if (total === 0) { footer.innerHTML = ''; return; }
  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">Mostrando <b>${shown}</b> de <b>${total}</b> conciliaciones</p>
    ${hasMore ? `<button onclick="loadMoreConc()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">⬇️ Cargar 100 más</button>` : `<p class="text-[10px] text-gray-400">— Fin —</p>`}
  `;
}

window.loadMoreConc = () => {
  concVisibleCount += CONC_PAGE_SIZE;
  renderConciliaciones();
};

/* Poblar selects de filtros */
function populateConcFilters() {
  const accSel = $('conc-filter-account');
  const yearSel = $('conc-filter-year');
  if (!accSel || !yearSel) return;

  const banks = getBankAccounts();
  accSel.innerHTML = '<option value="all">Todas</option>' +
    banks.map(b => `<option value="${b.code}">${b.code} · ${escapeHtml(b.name)}</option>`).join('');

  // Años únicos
  const years = [...new Set(conciliaciones.map(c => c.year))].sort((a,b) => b - a);
  yearSel.innerHTML = '<option value="all">Todos</option>' +
    years.map(y => `<option value="${y}">${y}</option>`).join('');
}

['conc-filter-account','conc-filter-year','conc-filter-status','conc-filter-month','conc-search'].forEach(id => {
  const el = $(id);
  if (el) {
    const handler = () => { concVisibleCount = CONC_PAGE_SIZE; renderConciliaciones(); };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  }
});

/* ============================================================
   FORMULARIO DE CONCILIACIÓN
============================================================ */

window.openConcForm = async () => {
  if (!canEditPuc()) return;
  if (!pucAccounts.length) await loadPuc();
  if (!comprobantes.length) await loadComprobantes();

  editingConcId = null;
  concLines = [];
  const now = new Date();
  $('conc-title').innerText = 'Nueva conciliación';
  renderConcForm({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    accountCode: '',
    saldoExtracto: 0,
    notes: ''
  });
  const m = $('conc-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.editConc = async (id) => {
  const c = conciliaciones.find(x => x.id === id);
  if (!c) return;
  if (!canEditPuc()) return;
  if (!pucAccounts.length) await loadPuc();
  if (!comprobantes.length) await loadComprobantes();

  editingConcId = id;
  concLines = (c.lines || []).map(l => ({ ...l }));
  $('conc-title').innerText = 'Editar conciliación';
  renderConcForm(c);
  const m = $('conc-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeConcForm = () => {
  const m = $('conc-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingConcId = null;
  concLines = [];
};

/* Render del formulario */
function renderConcForm(v) {
  const banks = getBankAccounts();
  const bankOpts = banks.map(b =>
    `<option value="${b.code}" ${v.accountCode === b.code ? 'selected' : ''}>${b.code} · ${escapeHtml(b.name)}</option>`
  ).join('');

  const yearOpts = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 3; y <= currentYear + 1; y++) {
    yearOpts.push(`<option value="${y}" ${v.year === y ? 'selected' : ''}>${y}</option>`);
  }

  const monthOpts = MONTH_NAMES.map((n, i) =>
    `<option value="${i+1}" ${v.month === i+1 ? 'selected' : ''}>${n}</option>`
  ).join('');

  $('conc-body').innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
      <div>
        <label class="text-xs font-semibold text-sd">Cuenta bancaria *</label>
        <select id="cc-account" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm" onchange="onConcAccountChange()" ${editingConcId ? 'disabled' : ''}>
          <option value="">— Selecciona —</option>
          ${bankOpts}
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Mes *</label>
        <select id="cc-month" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm" onchange="onConcPeriodChange()" ${editingConcId ? 'disabled' : ''}>
          ${monthOpts}
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Año *</label>
        <select id="cc-year" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm" onchange="onConcPeriodChange()" ${editingConcId ? 'disabled' : ''}>
          ${yearOpts.join('')}
        </select>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p class="text-[10px] text-blue-700 font-semibold uppercase">📚 Saldo según libros</p>
        <p id="cc-libros" class="text-2xl font-bold text-blue-700 mt-1 font-mono">$0</p>
        <p class="text-[10px] text-blue-600 mt-0.5">Calculado del mayor hasta el fin de mes</p>
      </div>
      <div class="bg-orange-50 border border-orange-200 rounded-lg p-3">
        <p class="text-[10px] text-orange-700 font-semibold uppercase">🏦 Saldo según extracto</p>
        <input id="cc-extracto" type="number" step="1" value="${v.saldoExtracto || ''}" placeholder="0" class="w-full px-2 py-1.5 border rounded-lg text-sm mt-1 font-mono font-bold text-orange-700" oninput="recalcConc()">
        <p class="text-[10px] text-orange-600 mt-0.5">Ingresa el saldo final del extracto bancario</p>
      </div>
    </div>

    <div class="flex justify-between items-center mb-2">
      <p class="text-xs font-semibold text-sd">📋 Partidas conciliatorias</p>
      <button type="button" onclick="addConcLine()" class="text-xs bg-sl text-white px-3 py-1.5 rounded-lg hover:bg-sd font-semibold">+ Agregar partida</button>
    </div>

    <div class="border border-gray-200 rounded-lg overflow-hidden mb-4">
      <table class="w-full text-xs">
        <thead class="bg-gray-50">
          <tr>
            <th class="p-2 text-left text-[10px] uppercase font-bold w-[200px]">Tipo</th>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Descripción</th>
            <th class="p-2 text-right text-[10px] uppercase font-bold w-[130px]">Valor</th>
            <th class="p-2 w-[40px]"></th>
          </tr>
        </thead>
        <tbody id="cc-lines-body"></tbody>
      </table>
    </div>

    <div class="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
      <div class="flex justify-between"><span class="text-gray-600">Saldo según libros:</span><span id="cc-calc-libros" class="font-mono">$0</span></div>
      <div class="flex justify-between"><span class="text-gray-600">(+) Partidas que suman:</span><span id="cc-calc-plus" class="font-mono text-green-600">$0</span></div>
      <div class="flex justify-between"><span class="text-gray-600">(−) Partidas que restan:</span><span id="cc-calc-minus" class="font-mono text-red-600">$0</span></div>
      <div class="flex justify-between border-t pt-2 font-bold"><span>Saldo conciliado:</span><span id="cc-calc-conciliado" class="font-mono text-sd">$0</span></div>
      <div class="flex justify-between"><span class="text-gray-600">Saldo según extracto:</span><span id="cc-calc-extracto" class="font-mono">$0</span></div>
      <div class="flex justify-between border-t pt-2"><span class="font-semibold">Diferencia:</span><span id="cc-calc-dif" class="font-mono font-bold">$0</span></div>
    </div>

    <label class="text-xs font-semibold text-sd">Notas</label>
    <textarea id="cc-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-4 text-sm">${escapeHtml(v.notes) || ''}</textarea>

    <div class="flex gap-3">
      <button onclick="closeConcForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveConc()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">Guardar</button>
    </div>
  `;

  renderConcLines();
  onConcAccountChange();
}

/* TIPOS DE PARTIDAS */
const CONC_LINE_TYPES = [
  { slug: 'consignacion_pendiente', label: 'Consignación pendiente',     sign: +1 },
  { slug: 'nota_credito',           label: 'Nota crédito no registrada', sign: +1 },
  { slug: 'cheque_pendiente',       label: 'Cheque girado y no cobrado', sign: -1 },
  { slug: 'nota_debito',            label: 'Nota débito no registrada',  sign: -1 },
  { slug: 'comision_no_reg',        label: 'Comisión no registrada',     sign: -1 },
  { slug: 'error_contable',         label: 'Error contable',             sign: -1 },
  { slug: 'otra',                   label: 'Otra partida',               sign: +1 }
];

/* Render de las líneas */
function renderConcLines() {
  const tb = $('cc-lines-body');
  if (!tb) return;

  if (!concLines.length) {
    tb.innerHTML = '<tr><td colspan="4" class="text-center text-gray-400 py-4 text-xs">Sin partidas conciliatorias</td></tr>';
    recalcConc();
    return;
  }

  const typeOpts = CONC_LINE_TYPES.map(t => `<option value="${t.slug}">${t.label} (${t.sign > 0 ? '+' : '−'})</option>`).join('');

  tb.innerHTML = concLines.map((line, i) => {
    return `<tr class="border-b">
      <td class="p-2">
        <select onchange="updateConcLine(${i},'type',this.value)" class="w-full px-2 py-1.5 border rounded text-xs">
          ${CONC_LINE_TYPES.map(t => `<option value="${t.slug}" ${line.type === t.slug ? 'selected' : ''}>${t.label} (${t.sign > 0 ? '+' : '−'})</option>`).join('')}
        </select>
      </td>
      <td class="p-2">
        <input type="text" value="${escapeHtml(line.note) || ''}" onchange="updateConcLine(${i},'note',this.value)" class="w-full px-2 py-1.5 border rounded text-xs" placeholder="Detalle de la partida">
      </td>
      <td class="p-2">
        <input type="number" min="0" step="1" value="${line.amount || ''}" oninput="updateConcLine(${i},'amount',this.value)" class="w-full px-2 py-1.5 border rounded text-xs text-right font-mono" placeholder="0">
      </td>
      <td class="p-2 text-center">
        <button type="button" onclick="removeConcLine(${i})" class="text-red-500 hover:text-red-700 text-xs">✕</button>
      </td>
    </tr>`;
  }).join('');

  recalcConc();
}

window.addConcLine = () => {
  concLines.push({ type: 'consignacion_pendiente', note: '', amount: 0 });
  renderConcLines();
};

window.removeConcLine = (i) => {
  concLines.splice(i, 1);
  renderConcLines();
};

window.updateConcLine = (i, field, value) => {
  if (!concLines[i]) return;
  if (field === 'amount') value = Number(value) || 0;
  concLines[i][field] = value;
  recalcConc();
};

/* Al cambiar la cuenta, recalcular el saldo libros */
window.onConcAccountChange = () => {
  recalcConc();
};

/* Al cambiar el período, recalcular el saldo libros */
window.onConcPeriodChange = () => {
  recalcConc();
};

/* Recalcular todos los totales */
window.recalcConc = () => {
  const accountCode = $('cc-account')?.value || '';
  const year = Number($('cc-year')?.value || 0);
  const month = Number($('cc-month')?.value || 0);
  const extracto = Number($('cc-extracto')?.value || 0);

  let libros = 0;
  if (accountCode && year && month) {
    libros = calcSaldoLibros(accountCode, year, month);
  }

  // Sumar partidas
  let plus = 0, minus = 0;
  concLines.forEach(l => {
    const t = CONC_LINE_TYPES.find(x => x.slug === l.type);
    if (!t) return;
    const amt = Number(l.amount || 0);
    if (t.sign > 0) plus += amt;
    else minus += amt;
  });

  const conciliado = libros + plus - minus;
  const dif = Math.round(conciliado - extracto);

  // Actualizar UI
  const setText = (id, val) => { const el = $(id); if (el) el.innerText = fmt(val); };
  setText('cc-libros', libros);
  setText('cc-calc-libros', libros);
  setText('cc-calc-plus', plus);
  setText('cc-calc-minus', minus);
  setText('cc-calc-conciliado', conciliado);
  setText('cc-calc-extracto', extracto);

  const difEl = $('cc-calc-dif');
  if (difEl) {
    difEl.innerText = (dif === 0 ? '✓ ' : '') + fmt(Math.abs(dif));
    difEl.className = 'font-mono font-bold ' + (dif === 0 ? 'text-green-600' : 'text-red-600');
  }
};

/* Guardar */
window.saveConc = async () => {
  const accountCode = $('cc-account').value;
  const month = Number($('cc-month').value);
  const year = Number($('cc-year').value);
  const saldoExtracto = Number($('cc-extracto').value || 0);
  const notes = $('cc-notes').value.trim();

  if (!accountCode) return alert('Debes elegir una cuenta bancaria');
  if (!month || !year) return alert('Debes elegir mes y año');

  // Validar duplicado
  if (!editingConcId) {
    const exists = conciliaciones.find(c =>
      c.accountCode === accountCode && c.month === month && c.year === year &&
      c.storeId === currentStore.storeId
    );
    if (exists) return alert('Ya existe una conciliación para esa cuenta y período en esta tienda.');
  }

  const pucAcc = pucAccounts.find(a => a.code === accountCode);
  const accountName = pucAcc?.name || accountCode;

  const saldoLibros = calcSaldoLibros(accountCode, year, month);

  // Recalcular partidas
  let plus = 0, minus = 0;
  concLines.forEach(l => {
    const t = CONC_LINE_TYPES.find(x => x.slug === l.type);
    if (!t) return;
    const amt = Number(l.amount || 0);
    if (t.sign > 0) plus += amt; else minus += amt;
  });
  const saldoConciliado = saldoLibros + plus - minus;
  const diferencia = Math.round(saldoConciliado - saldoExtracto);
  const status = diferencia === 0 ? 'conciliado' : 'descuadrado';

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Guardando...';

  try {
    const data = {
      accountCode,
      accountName,
      month,
      year,
      storeId: currentStore.storeId,
      storeName: currentStore.name,
      saldoLibros,
      saldoExtracto,
      lines: concLines.map(l => ({
        type: l.type,
        note: l.note || '',
        amount: Number(l.amount || 0)
      })),
      saldoConciliado,
      diferencia,
      status,
      notes,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };

    if (editingConcId) {
      const prev = conciliaciones.find(c => c.id === editingConcId);
      await updateDoc(doc(db, 'conciliaciones', editingConcId), data);
      await audit({
        action: 'update', collection: 'conciliaciones', docId: editingConcId,
        before: prev, after: data,
        note: `Conciliación editada: ${accountCode} · ${MONTH_NAMES[month-1]} ${year}`
      });
    } else {
      data.createdAt = serverTimestamp();
      data.createdBy = currentUser.email;
      const ref = await addDoc(collection(db, 'conciliaciones'), data);
      await audit({
        action: 'create', collection: 'conciliaciones', docId: ref.id,
        after: data,
        note: `Conciliación creada: ${accountCode} · ${MONTH_NAMES[month-1]} ${year} · ${status}`
      });
    }

    window.SmartecCache.invalidate('conciliaciones_all');
    await loadConciliaciones();
    populateConcFilters();
    renderConciliaciones();
    closeConcForm();
    alert(`✅ Conciliación guardada (${status === 'conciliado' ? 'CUADRADA' : 'DESCUADRADA por ' + fmt(Math.abs(diferencia))})`);
  } catch (e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = 'Guardar';
  }
};

/* Eliminar */
window.deleteConc = async (id) => {
  const c = conciliaciones.find(x => x.id === id);
  if (!c) return;
  if (currentUserData.role !== 'superadmin') return alert('Solo superadmin puede eliminar conciliaciones.');
  if (!confirm(`⚠️ ¿Eliminar la conciliación de ${c.accountCode} · ${MONTH_NAMES[(c.month||1)-1]} ${c.year}?`)) return;

  try {
    await deleteDoc(doc(db, 'conciliaciones', id));
    await audit({
      action: 'delete', collection: 'conciliaciones', docId: id,
      before: c,
      note: `Conciliación eliminada: ${c.accountCode} · ${MONTH_NAMES[(c.month||1)-1]} ${c.year}`
    });
    window.SmartecCache.invalidate('conciliaciones_all');
    await loadConciliaciones();
    populateConcFilters();
    renderConciliaciones();
    alert('✅ Conciliación eliminada');
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

/* Detalle */
window.viewConcDetail = (id) => {
  const c = conciliaciones.find(x => x.id === id);
  if (!c) return;

  const plusLines = (c.lines || []).filter(l => {
    const t = CONC_LINE_TYPES.find(x => x.slug === l.type);
    return t && t.sign > 0;
  });
  const minusLines = (c.lines || []).filter(l => {
    const t = CONC_LINE_TYPES.find(x => x.slug === l.type);
    return t && t.sign < 0;
  });

  const renderLine = l => {
    const t = CONC_LINE_TYPES.find(x => x.slug === l.type);
    return `<div class="flex justify-between py-1.5 border-b border-gray-100 text-xs">
      <span class="text-gray-600">${escapeHtml(t?.label || l.type)}${l.note ? ' · ' + escapeHtml(l.note) : ''}</span>
      <span class="font-mono font-semibold">${fmt(l.amount)}</span>
    </div>`;
  };

  const plusTotal = plusLines.reduce((s,l) => s + Number(l.amount||0), 0);
  const minusTotal = minusLines.reduce((s,l) => s + Number(l.amount||0), 0);

  $('conc-detail-body').innerHTML = `
    <div class="flex justify-between items-start mb-4">
      <div>
        <p class="text-xs text-gray-400 font-mono">${escapeHtml(c.accountCode)}</p>
        <p class="text-lg font-bold text-sd">${escapeHtml(c.accountName)}</p>
        <p class="text-xs text-gray-500 mt-0.5">${MONTH_NAMES[(c.month||1)-1]} ${c.year}</p>
      </div>
      ${concStatusBadge(c.status)}
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
      <div class="bg-blue-50 rounded-lg p-3">
        <p class="text-[10px] text-blue-600">S/ Libros</p>
        <p class="font-bold text-blue-700 font-mono">${fmt(c.saldoLibros)}</p>
      </div>
      <div class="bg-green-50 rounded-lg p-3">
        <p class="text-[10px] text-green-600">(+) Sumas</p>
        <p class="font-bold text-green-700 font-mono">${fmt(plusTotal)}</p>
      </div>
      <div class="bg-red-50 rounded-lg p-3">
        <p class="text-[10px] text-red-600">(−) Restas</p>
        <p class="font-bold text-red-700 font-mono">${fmt(minusTotal)}</p>
      </div>
      <div class="bg-purple-50 rounded-lg p-3">
        <p class="text-[10px] text-purple-600">S/ Conciliado</p>
        <p class="font-bold text-purple-700 font-mono">${fmt(c.saldoConciliado)}</p>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-4 text-sm">
      <div class="bg-orange-50 rounded-lg p-3">
        <p class="text-[10px] text-orange-600">S/ Extracto bancario</p>
        <p class="font-bold text-orange-700 font-mono">${fmt(c.saldoExtracto)}</p>
      </div>
      <div class="${c.status === 'conciliado' ? 'bg-green-50' : 'bg-red-50'} rounded-lg p-3">
        <p class="text-[10px] ${c.status === 'conciliado' ? 'text-green-600' : 'text-red-600'}">Diferencia</p>
        <p class="font-bold ${c.status === 'conciliado' ? 'text-green-700' : 'text-red-700'} font-mono">${fmt(c.diferencia)}</p>
      </div>
    </div>

    ${plusLines.length ? `
      <div class="mb-4">
        <p class="text-xs font-semibold text-green-700 mb-1">(+) Partidas que suman</p>
        <div class="border border-green-200 rounded-lg p-2">
          ${plusLines.map(renderLine).join('')}
          <div class="flex justify-between pt-2 mt-1 border-t border-green-200 font-bold text-xs text-green-700">
            <span>Total (+)</span><span class="font-mono">${fmt(plusTotal)}</span>
          </div>
        </div>
      </div>
    ` : ''}

    ${minusLines.length ? `
      <div class="mb-4">
        <p class="text-xs font-semibold text-red-700 mb-1">(−) Partidas que restan</p>
        <div class="border border-red-200 rounded-lg p-2">
          ${minusLines.map(renderLine).join('')}
          <div class="flex justify-between pt-2 mt-1 border-t border-red-200 font-bold text-xs text-red-700">
            <span>Total (−)</span><span class="font-mono">${fmt(minusTotal)}</span>
          </div>
        </div>
      </div>
    ` : ''}

    ${c.notes ? `<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm mb-4"><p class="text-xs text-yellow-700 font-semibold mb-1">Notas</p><p>${escapeHtml(c.notes)}</p></div>` : ''}

    <div class="text-xs text-gray-400 mt-2">
      Creada por: ${escapeHtml(c.createdBy) || '-'}
    </div>
  `;

  const m = $('conc-detail-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeConcDetail = () => {
  const m = $('conc-detail-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

/* ============================================================
   CARTERA (Cuentas por Cobrar)
============================================================ */

let cartera = [];
let editingCarId = null;
let currentCarAbonoId = null;
const CAR_PAGE_SIZE = 100;
let carVisibleCount = CAR_PAGE_SIZE;

/* Tabla de provisión por antigüedad (fiscal Colombia) */
const PROVISION_RANGES = [
  { slug: '0-30',      from: 0,    to: 30,    pct: 0,   label: '0-30 días' },
  { slug: '31-90',     from: 31,   to: 90,    pct: 0.05,label: '31-90 días' },
  { slug: '91-180',    from: 91,   to: 180,   pct: 0.10,label: '91-180 días' },
  { slug: '181-360',   from: 181,  to: 360,   pct: 0.15,label: '181-360 días' },
  { slug: '361-720',   from: 361,  to: 720,   pct: 0.25,label: '361-720 días' },
  { slug: '721-1080',  from: 721,  to: 1080,  pct: 0.50,label: '721-1080 días' },
  { slug: '1080+',     from: 1081, to: 99999, pct: 1.00,label: 'Más de 1080 días' }
];

/* Carga cartera */
async function loadCartera() {
  const C = window.SmartecCache;
  const all = await C.wrap('cartera_all', async () => {
    const s = await getDocs(collection(db, 'cartera'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  const isSuper = currentUserData.role === 'superadmin';
  if (isSuper && currentStore?.storeId === 'all') {
    cartera = all.slice();
  } else {
    cartera = all.filter(c =>
      c.storeId === currentStore.storeId || c.storeId === 'general'
    );
  }
}

/* Calcula saldo, días vencidos, rango, provisión */
function computeCarMetrics(c) {
  const monto = Number(c.amount || 0);
  const abonos = (c.payments || []).reduce((s,p) => s + Number(p.amount || 0), 0);
  const saldo = monto - abonos;

  let diasVencidos = 0;
  let rangoSlug = null;
  let provPct = 0;
  let provValor = 0;

  if (saldo > 0 && c.dueDate) {
    const today = todayStr();
    const diff = daysBetween(c.dueDate, today);  // días desde vencimiento hasta hoy
    diasVencidos = diff > 0 ? diff : 0;

    if (diasVencidos > 0) {
      const range = PROVISION_RANGES.find(r => diasVencidos >= r.from && diasVencidos <= r.to);
      if (range) {
        rangoSlug = range.slug;
        provPct = range.pct;
        provValor = saldo * range.pct;
      }
    } else {
      rangoSlug = '0-30';
      provPct = 0;
      provValor = 0;
    }
  }

  let status = 'pending';
  if (saldo <= 0) status = 'paid';
  else if (diasVencidos > 0) status = 'overdue';

  return { monto, abonos, saldo, diasVencidos, rangoSlug, provPct, provValor, status };
}

/* Badge estado */
function carStatusBadge(status) {
  const map = {
    pending: { cls: 'bg-amber-100 text-amber-700', lbl: '⏳ Pendiente' },
    overdue: { cls: 'bg-red-100 text-red-700',     lbl: '🔴 Vencida' },
    paid:    { cls: 'bg-green-100 text-green-700', lbl: '✅ Pagada' }
  };
  const m = map[status] || map.pending;
  return `<span class="text-[10px] px-2 py-0.5 rounded ${m.cls} font-semibold whitespace-nowrap">${m.lbl}</span>`;
}

/* Badge rango */
function carRangoBadge(slug) {
  if (!slug) return '<span class="text-gray-300 text-xs">—</span>';
  const range = PROVISION_RANGES.find(r => r.slug === slug);
  if (!range) return '<span class="text-gray-300 text-xs">—</span>';
  const colors = {
    '0-30': 'bg-gray-100 text-gray-600',
    '31-90': 'bg-yellow-100 text-yellow-700',
    '91-180': 'bg-orange-100 text-orange-700',
    '181-360': 'bg-red-100 text-red-700',
    '361-720': 'bg-red-200 text-red-800',
    '721-1080': 'bg-red-300 text-red-900',
    '1080+': 'bg-red-500 text-white'
  };
  return `<span class="text-[10px] px-2 py-0.5 rounded ${colors[slug] || 'bg-gray-100 text-gray-600'} font-semibold whitespace-nowrap">${range.label}</span>`;
}

/* Filtros */
function getFilteredCartera() {
  let list = cartera.slice();
  const clientF = ($('car-filter-client')?.value || '').toLowerCase().trim();
  const statusF = $('car-filter-status')?.value || 'all';
  const rangeF = $('car-filter-range')?.value || 'all';
  const dueF = $('car-filter-due')?.value || 'all';
  const search = ($('car-search')?.value || '').toLowerCase().trim();

  if (clientF) list = list.filter(c => (c.clientName||'').toLowerCase().includes(clientF));
  if (statusF !== 'all') list = list.filter(c => computeCarMetrics(c).status === statusF);
  if (rangeF !== 'all') list = list.filter(c => computeCarMetrics(c).rangoSlug === rangeF);

  if (dueF !== 'all') {
    const today = todayStr();
    if (dueF === 'next7') {
      list = list.filter(c => {
        const m = computeCarMetrics(c);
        if (m.status === 'paid') return false;
        if (!c.dueDate) return false;
        const diff = daysBetween(today, c.dueDate);
        return diff >= 0 && diff <= 7;
      });
    } else if (dueF === 'next30') {
      list = list.filter(c => {
        const m = computeCarMetrics(c);
        if (m.status === 'paid') return false;
        if (!c.dueDate) return false;
        const diff = daysBetween(today, c.dueDate);
        return diff >= 0 && diff <= 30;
      });
    } else if (dueF === 'overdue') {
      list = list.filter(c => computeCarMetrics(c).status === 'overdue');
    }
  }

  if (search) {
    list = list.filter(c =>
      (c.clientName||'').toLowerCase().includes(search) ||
      (c.invoiceNumber||'').toLowerCase().includes(search) ||
      (c.clientNit||'').toLowerCase().includes(search)
    );
  }

  return list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
}

/* KPIs */
function renderCarKpis() {
  const el = $('car-kpis');
  if (!el) return;

  let totalCartera = 0, totalVencida = 0, totalPorVencer = 0, totalProvision = 0, countVencida = 0;

  cartera.forEach(c => {
    const m = computeCarMetrics(c);
    if (m.status === 'paid') return;
    totalCartera += m.saldo;
    if (m.status === 'overdue') { totalVencida += m.saldo; countVencida++; }
    else totalPorVencer += m.saldo;
    totalProvision += m.provValor;
  });

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">💳 Cartera total</p>
      <p class="text-2xl font-bold text-[#0071E3] mt-1">${fmt(totalCartera)}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Saldo pendiente de cobro</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">🔴 Vencida</p>
      <p class="text-2xl font-bold text-[#0A2A4A] mt-1">${fmt(totalVencida)}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">${countVencida} factura${countVencida !== 1 ? 's' : ''}</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">⏳ Por vencer</p>
      <p class="text-2xl font-bold text-[#FF9F0A] mt-1">${fmt(totalPorVencer)}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Aún en plazo</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">🛡️ Provisión</p>
      <p class="text-2xl font-bold text-red-700 mt-1">${fmt(totalProvision)}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Estimación de no cobro</p>
    </div>
  `;
}

/* Render tabla */
function renderCartera() {
  renderCarKpis();
  renderProvisionTable();

  const tb = $('car-tbody');
  const empty = $('car-empty');
  if (!tb) return;

  const all = getFilteredCartera();
  const visible = all.slice(0, carVisibleCount);

  if (!all.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderCarFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = visible.map(c => {
    const m = computeCarMetrics(c);
    const rowCls = m.status === 'paid' ? 'bg-gray-50 opacity-60'
                  : m.status === 'overdue' ? 'bg-red-50/30'
                  : '';

    return `<tr class="border-b hover:bg-gray-50 ${rowCls}">
      <td class="p-3 text-xs text-gray-600 whitespace-nowrap">${c.date || '-'}</td>
      <td class="p-3 text-xs font-mono">${escapeHtml(c.invoiceNumber) || '—'}</td>
      <td class="p-3 text-xs">
        <div class="font-semibold">${escapeHtml(c.clientName) || '—'}</div>
        ${c.clientNit ? `<div class="text-[10px] text-gray-400 font-mono">${escapeHtml(c.clientNit)}</div>` : ''}
      </td>
      <td class="p-3 text-xs text-gray-600 whitespace-nowrap">${c.dueDate || '—'}</td>
      <td class="p-3 text-right text-xs font-mono">${fmt(m.monto)}</td>
      <td class="p-3 text-right text-xs font-mono text-green-600">${m.abonos > 0 ? fmt(m.abonos) : '—'}</td>
      <td class="p-3 text-right text-xs font-mono font-bold text-sd">${fmt(m.saldo)}</td>
      <td class="p-3 text-center text-xs ${m.diasVencidos > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}">${m.diasVencidos > 0 ? m.diasVencidos : '—'}</td>
      <td class="p-3 text-center">${carRangoBadge(m.rangoSlug)}</td>
      <td class="p-3 text-right text-xs font-mono text-red-600 font-semibold">${m.provValor > 0 ? fmt(m.provValor) : '—'}</td>
      <td class="p-3 text-center">${carStatusBadge(m.status)}</td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewCarDetail("${c.id}")' class="text-sl hover:underline text-xs mr-2">Ver</button>
        ${m.status !== 'paid' ? `
          <button onclick='openCarAbonoModal("${c.id}")' class="text-green-600 hover:underline text-xs mr-2 font-semibold">💵 Abonar</button>
        ` : ''}
        ${c.status !== 'anulado' ? `
          <button onclick='editCar("${c.id}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
          <button onclick='deleteCar("${c.id}")' class="text-red-500 hover:underline text-xs">Eliminar</button>
        ` : ''}
      </td>
    </tr>`;
  }).join('');

  renderCarFooter(visible.length, all.length);
}

function renderCarFooter(shown, total) {
  let footer = $('car-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'car-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('car-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }
  if (total === 0) { footer.innerHTML = ''; return; }
  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">Mostrando <b>${shown}</b> de <b>${total}</b> registros</p>
    ${hasMore ? `<button onclick="loadMoreCar()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">⬇️ Cargar 100 más</button>` : `<p class="text-[10px] text-gray-400">— Fin —</p>`}
  `;
}

window.loadMoreCar = () => {
  carVisibleCount += CAR_PAGE_SIZE;
  renderCartera();
};

/* Tabla de provisión agregada */
function renderProvisionTable() {
  const tb = $('car-provision-tbody');
  if (!tb) return;

  // Sumar por rango
  const totals = {};
  PROVISION_RANGES.forEach(r => totals[r.slug] = { saldo: 0, prov: 0 });
  totals['no-rango'] = { saldo: 0, prov: 0 };

  cartera.forEach(c => {
    const m = computeCarMetrics(c);
    if (m.status === 'paid') return;
    if (m.rangoSlug && totals[m.rangoSlug]) {
      totals[m.rangoSlug].saldo += m.saldo;
      totals[m.rangoSlug].prov += m.provValor;
    } else {
      totals['no-rango'].saldo += m.saldo;
      totals['no-rango'].prov += m.provValor;
    }
  });

  const rows = PROVISION_RANGES.map(r => {
    const t = totals[r.slug];
    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs font-semibold">${r.label}</td>
      <td class="p-3 text-right text-xs font-mono">${(r.pct * 100).toFixed(0)}%</td>
      <td class="p-3 text-right text-xs font-mono">${fmt(t.saldo)}</td>
      <td class="p-3 text-right text-xs font-mono font-bold text-red-700">${fmt(t.prov)}</td>
    </tr>`;
  });

  // Línea sin rango (por vencer)
  if (totals['no-rango'].saldo > 0) {
    rows.push(`<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs font-semibold text-gray-500">Aún sin vencer</td>
      <td class="p-3 text-right text-xs font-mono">0%</td>
      <td class="p-3 text-right text-xs font-mono">${fmt(totals['no-rango'].saldo)}</td>
      <td class="p-3 text-right text-xs font-mono text-gray-400">—</td>
    </tr>`);
  }

  tb.innerHTML = rows.join('');

  // Totales
  const totalSaldo = Object.values(totals).reduce((s,t) => s + t.saldo, 0);
  const totalProv = Object.values(totals).reduce((s,t) => s + t.prov, 0);
  $('car-prov-total-saldo').innerText = fmt(totalSaldo);
  $('car-prov-total-prov').innerText = fmt(totalProv);
}

/* Filtros listeners */
['car-filter-client','car-filter-status','car-filter-range','car-filter-due','car-search'].forEach(id => {
  const el = $(id);
  if (el) {
    const handler = () => { carVisibleCount = CAR_PAGE_SIZE; renderCartera(); };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  }
});

/* ============================================================
   MAYORISTAS — Listeners de filtros
============================================================ */
['may-search','may-filter-status','may-filter-terms','may-filter-order'].forEach(id => {
  const el = $(id);
  if (el && !el.dataset.listeners) {
    el.dataset.listeners = '1';
    el.addEventListener('input', renderWholesale);
    el.addEventListener('change', renderWholesale);
  }
});

/* ============================================================
   COTIZACIONES — Listeners de filtros
============================================================ */
['cot-search','cot-filter-status','cot-date-from','cot-date-to'].forEach(id => {
  const el = document.getElementById(id);
  if (el && !el.dataset.listeners) {
    el.dataset.listeners = '1';
    el.addEventListener('input', renderQuotes);
    el.addEventListener('change', renderQuotes);
  }
});

window.clearCarFilters = () => {
  $('car-filter-client').value = '';
  $('car-filter-status').value = 'all';
  $('car-filter-range').value = 'all';
  $('car-filter-due').value = 'all';
  $('car-search').value = '';
  carVisibleCount = CAR_PAGE_SIZE;
  renderCartera();
};

/* ============================================================
   FORMULARIO CxC
============================================================ */

window.openCarForm = async () => {
  if (!canEditPuc()) return;
  editingCarId = null;
  $('car-title').innerText = 'Nueva cuenta por cobrar';
  renderCarForm({
    date: todayStr(),
    dueDate: todayStr(),
    amount: 0,
    clientName: '',
    clientNit: '',
    invoiceNumber: '',
    notes: ''
  });
  const m = $('car-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.editCar = (id) => {
  const c = cartera.find(x => x.id === id);
  if (!c) return;
  if (!canEditPuc()) return;
  editingCarId = id;
  $('car-title').innerText = 'Editar cuenta por cobrar';
  renderCarForm(c);
  const m = $('car-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeCarForm = () => {
  const m = $('car-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingCarId = null;
};

function renderCarForm(v) {
  $('car-body').innerHTML = `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Fecha emisión *</label>
        <input id="cr-date" type="date" value="${v.date || todayStr()}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Fecha vencimiento *</label>
        <input id="cr-dueDate" type="date" value="${v.dueDate || todayStr()}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Cliente *</label>
        <input id="cr-clientName" type="text" value="${escapeHtml(v.clientName) || ''}" placeholder="Nombre / Razón social" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">NIT / Cédula</label>
        <input id="cr-clientNit" type="text" value="${escapeHtml(v.clientNit) || ''}" placeholder="900123456-7" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Nº Factura</label>
        <input id="cr-invoice" type="text" value="${escapeHtml(v.invoiceNumber) || ''}" placeholder="FAC-001" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Monto *</label>
        <input id="cr-amount" type="number" min="0" step="1" value="${v.amount || ''}" placeholder="0" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono">
      </div>
    </div>

    <label class="text-xs font-semibold text-sd">Notas</label>
    <textarea id="cr-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-4 text-sm">${escapeHtml(v.notes) || ''}</textarea>

    <div class="flex gap-3">
      <button onclick="closeCarForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveCar()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">Guardar</button>
    </div>
  `;
}

window.saveCar = async () => {
  const date = $('cr-date').value;
  const dueDate = $('cr-dueDate').value;
  const clientName = $('cr-clientName').value.trim();
  const clientNit = $('cr-clientNit').value.trim();
  const invoiceNumber = $('cr-invoice').value.trim();
  const amount = Number($('cr-amount').value || 0);
  const notes = $('cr-notes').value.trim();

  if (!date) return alert('La fecha es obligatoria');
  if (!dueDate) return alert('La fecha de vencimiento es obligatoria');
  if (!clientName) return alert('El cliente es obligatorio');
  if (amount <= 0) return alert('El monto debe ser mayor a 0');

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Guardando...';

  try {
    const data = {
      date, dueDate, clientName, clientNit,
      invoiceNumber, amount, notes,
      storeId: currentStore.storeId,
      storeName: currentStore.name,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };

    if (editingCarId) {
      const prev = cartera.find(c => c.id === editingCarId);
      await updateDoc(doc(db, 'cartera', editingCarId), data);
      await audit({
        action: 'update', collection: 'cartera', docId: editingCarId,
        before: prev, after: data,
        note: `CxC editada: ${clientName} · ${fmt(amount)}`
      });
    } else {
      data.payments = [];
      data.createdAt = serverTimestamp();
      data.createdBy = currentUser.email;
      const ref = await addDoc(collection(db, 'cartera'), data);
      await audit({
        action: 'create', collection: 'cartera', docId: ref.id,
        after: data,
        note: `CxC creada: ${clientName} · ${fmt(amount)}`
      });
    }

    window.SmartecCache.invalidate('cartera_all');
    await loadCartera();
    renderCartera();
    closeCarForm();
    alert('✅ Cuenta por cobrar guardada');
  } catch (e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = 'Guardar';
  }
};

/* ============================================================
   ABONO A CARTERA
============================================================ */

window.openCarAbonoModal = (id) => {
  const c = cartera.find(x => x.id === id);
  if (!c) return;
  currentCarAbonoId = id;

  const m = computeCarMetrics(c);
  $('car-abono-subtitle').innerText = `${c.clientName} · Saldo: ${fmt(m.saldo)}`;

  $('car-abono-body').innerHTML = `
    <label class="text-xs font-semibold text-sd block mb-1">Monto del abono *</label>
    <input id="ca-amount" type="number" min="1" step="1" value="${m.saldo}" class="w-full px-3 py-2 border rounded-lg mb-3 font-mono" oninput="validateCarAbono(${m.saldo})">
    <p id="ca-warn" class="text-xs text-red-500 hidden mb-3">⚠️ El abono no puede ser mayor al saldo.</p>

    <label class="text-xs font-semibold text-sd block mb-1">Fecha del abono *</label>
    <input id="ca-date" type="date" value="${todayStr()}" class="w-full px-3 py-2 border rounded-lg mb-3">

    <label class="text-xs font-semibold text-sd block mb-1">Nota (opcional)</label>
    <textarea id="ca-note" rows="2" class="w-full px-3 py-2 border rounded-lg text-sm mb-4" placeholder="Ej: Transferencia Bancolombia"></textarea>

    <div class="flex gap-3">
      <button onclick="closeCarAbonoModal()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="submitCarAbono()" class="flex-1 bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 font-semibold">✅ Registrar abono</button>
    </div>
  `;

  const modal = $('car-abono-modal');
  modal.classList.remove('hidden'); modal.classList.add('flex');
};

window.validateCarAbono = (saldo) => {
  const amount = Number($('ca-amount').value || 0);
  const warn = $('ca-warn');
  if (warn) warn.classList.toggle('hidden', amount <= saldo);
};

window.closeCarAbonoModal = () => {
  const m = $('car-abono-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  currentCarAbonoId = null;
};

window.submitCarAbono = async () => {
  if (!currentCarAbonoId) return;
  const c = cartera.find(x => x.id === currentCarAbonoId);
  if (!c) return;

  const amount = Number($('ca-amount').value || 0);
  const date = $('ca-date').value;
  const note = $('ca-note').value.trim();

  const m = computeCarMetrics(c);

  if (amount <= 0) return alert('El monto debe ser mayor a 0');
  if (amount > m.saldo) return alert(`El abono no puede ser mayor al saldo (${fmt(m.saldo)})`);
  if (!date) return alert('La fecha es obligatoria');

  try {
    const newPayment = {
      amount,
      date,
      note: note || '',
      registeredBy: currentUser.email,
      registeredAt: new Date().toISOString()
    };

    const payments = [...(c.payments || []), newPayment];

    await updateDoc(doc(db, 'cartera', currentCarAbonoId), {
      payments,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    });

    await audit({
      action: 'update', collection: 'cartera', docId: currentCarAbonoId,
      before: { payments: c.payments || [] },
      after: { payments },
      note: `Abono a CxC: ${c.clientName} · ${fmt(amount)} · ${date}`
    });

    window.SmartecCache.invalidate('cartera_all');
    await loadCartera();
    renderCartera();
    closeCarAbonoModal();
    alert('✅ Abono registrado');
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

/* Eliminar */
window.deleteCar = async (id) => {
  const c = cartera.find(x => x.id === id);
  if (!c) return;
  if (currentUserData.role !== 'superadmin') return alert('Solo superadmin puede eliminar.');
  if (!confirm(`⚠️ ¿Eliminar la CxC de "${c.clientName}" por ${fmt(c.amount)}?`)) return;

  try {
    await deleteDoc(doc(db, 'cartera', id));
    await audit({
      action: 'delete', collection: 'cartera', docId: id,
      before: c,
      note: `CxC eliminada: ${c.clientName}`
    });
    window.SmartecCache.invalidate('cartera_all');
    await loadCartera();
    renderCartera();
    alert('✅ CxC eliminada');
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

/* Detalle */
window.viewCarDetail = (id) => {
  const c = cartera.find(x => x.id === id);
  if (!c) return;
  const m = computeCarMetrics(c);

  const paymentsHtml = (c.payments || []).length ? c.payments.map(p => `
    <div class="flex justify-between items-center py-2 border-b border-gray-100 text-xs">
      <div>
        <p class="font-semibold text-green-700">+ ${fmt(p.amount)}</p>
        <p class="text-[10px] text-gray-500">${p.date} · ${escapeHtml(p.registeredBy) || ''}</p>
        ${p.note ? `<p class="text-[10px] text-gray-400 italic">"${escapeHtml(p.note)}"</p>` : ''}
      </div>
    </div>
  `).join('') : '<p class="text-xs text-gray-400 text-center py-3">Sin abonos registrados</p>';

  $('car-detail-body').innerHTML = `
    <div class="flex justify-between items-start mb-4">
      <div>
        <p class="text-xs text-gray-400 font-mono">${escapeHtml(c.invoiceNumber) || 'Sin factura'}</p>
        <p class="text-lg font-bold text-sd">${escapeHtml(c.clientName)}</p>
        ${c.clientNit ? `<p class="text-xs text-gray-500 font-mono">NIT: ${escapeHtml(c.clientNit)}</p>` : ''}
      </div>
      ${carStatusBadge(m.status)}
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
      <div class="bg-gray-50 rounded-lg p-3">
        <p class="text-[10px] text-gray-400">Monto</p>
        <p class="font-bold text-gray-700 font-mono">${fmt(m.monto)}</p>
      </div>
      <div class="bg-green-50 rounded-lg p-3">
        <p class="text-[10px] text-green-600">Abonado</p>
        <p class="font-bold text-green-700 font-mono">${fmt(m.abonos)}</p>
      </div>
      <div class="bg-blue-50 rounded-lg p-3">
        <p class="text-[10px] text-blue-600">Saldo</p>
        <p class="font-bold text-blue-700 font-mono">${fmt(m.saldo)}</p>
      </div>
      <div class="bg-red-50 rounded-lg p-3">
        <p class="text-[10px] text-red-600">Días vencidos</p>
        <p class="font-bold text-red-700">${m.diasVencidos || '—'}</p>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-3 mb-4 text-sm">
      <div><p class="text-xs text-gray-400">Fecha emisión</p><p class="font-semibold">${c.date}</p></div>
      <div><p class="text-xs text-gray-400">Fecha vencimiento</p><p class="font-semibold">${c.dueDate}</p></div>
      <div><p class="text-xs text-gray-400">Registró</p><p class="font-semibold text-xs">${escapeHtml(c.createdBy) || '-'}</p></div>
    </div>

    ${m.rangoSlug ? `
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 text-sm">
        <p class="text-xs font-semibold text-yellow-700 mb-1">🛡️ Provisión calculada</p>
        <div class="flex justify-between text-xs">
          <span>Rango: <b>${PROVISION_RANGES.find(r => r.slug === m.rangoSlug)?.label || '—'}</b></span>
          <span>%: <b>${(m.provPct * 100).toFixed(0)}%</b></span>
          <span>Valor: <b class="text-red-700">${fmt(m.provValor)}</b></span>
        </div>
      </div>
    ` : ''}

    <div class="border border-gray-200 rounded-lg p-3 mb-4">
      <p class="text-xs font-semibold text-sd mb-2">💵 Abonos (${(c.payments||[]).length})</p>
      ${paymentsHtml}
    </div>

    ${c.notes ? `<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm mb-4"><p class="text-xs text-yellow-700 font-semibold mb-1">Notas</p><p>${escapeHtml(c.notes)}</p></div>` : ''}
  `;

  const modal = $('car-detail-modal');
  modal.classList.remove('hidden'); modal.classList.add('flex');
};

window.closeCarDetail = () => {
  const m = $('car-detail-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

/* ============================================================
   EXPORTAR PDF
============================================================ */

window.exportCarteraPDF = async () => {
  const list = getFilteredCartera();
  if (!list.length) return alert('No hay cartera para exportar.');

  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Cartera / Cuentas por Cobrar', 14, 13);

  y = 28;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  const storeLabel = currentStore?.storeId === 'all' ? 'Todas las tiendas' : (currentStore?.name || 'General');
  doc.text(`Tienda: ${storeLabel}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  const rows = list.map(c => {
    const m = computeCarMetrics(c);
    return [
      c.date || '',
      c.invoiceNumber || '',
      (c.clientName || '').substring(0, 30),
      c.dueDate || '',
      '$' + m.monto.toLocaleString('es-CO'),
      '$' + m.abonos.toLocaleString('es-CO'),
      '$' + m.saldo.toLocaleString('es-CO'),
      m.diasVencidos > 0 ? String(m.diasVencidos) : '—',
      m.provValor > 0 ? '$' + m.provValor.toLocaleString('es-CO') : '—',
      m.status === 'paid' ? 'Pagada' : (m.status === 'overdue' ? 'VENCIDA' : 'Pendiente')
    ];
  });

  doc.autoTable({
    startY: y,
    head: [['Fecha','Factura','Cliente','Vence','Monto','Abonos','Saldo','Días','Provisión','Estado']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    margin: { left: 10, right: 10 },
    columnStyles: {
      0: { cellWidth: 20 },
      2: { cellWidth: 45 },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' },
      7: { halign: 'center', cellWidth: 12 },
      8: { halign: 'right' }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 9) {
        const v = data.cell.raw;
        if (v === 'VENCIDA') data.cell.styles.textColor = [220, 38, 38];
        else if (v === 'Pagada') data.cell.styles.textColor = [22, 163, 74];
      }
    }
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Smartec · Cartera · Página ${i} de ${pages}`, pageW / 2, pageH - 8, { align: 'center' });
  }
  doc.save(`smartec_cartera_${new Date().toISOString().split('T')[0]}.pdf`);
};

window.exportProvisionPDF = async () => {
  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Provisión de Cartera', 14, 13);

  y = 28;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  const storeLabel = currentStore?.storeId === 'all' ? 'Todas las tiendas' : (currentStore?.name || 'General');
  doc.text(`Tienda: ${storeLabel}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  // Calcular totales por rango
  const totals = {};
  PROVISION_RANGES.forEach(r => totals[r.slug] = { saldo: 0, prov: 0 });
  totals['no-rango'] = { saldo: 0, prov: 0 };

  cartera.forEach(c => {
    const m = computeCarMetrics(c);
    if (m.status === 'paid') return;
    if (m.rangoSlug && totals[m.rangoSlug]) {
      totals[m.rangoSlug].saldo += m.saldo;
      totals[m.rangoSlug].prov += m.provValor;
    } else {
      totals['no-rango'].saldo += m.saldo;
    }
  });

  const rows = PROVISION_RANGES.map(r => [
    r.label,
    (r.pct * 100).toFixed(0) + '%',
    '$' + totals[r.slug].saldo.toLocaleString('es-CO'),
    '$' + totals[r.slug].prov.toLocaleString('es-CO')
  ]);

  const totalSaldo = Object.values(totals).reduce((s,t) => s + t.saldo, 0);
  const totalProv = Object.values(totals).reduce((s,t) => s + t.prov, 0);

  doc.autoTable({
    startY: y,
    head: [['Rango','% Provisión','Saldo','Provisión']],
    body: rows,
    foot: [[{ content: 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } },
            { content: '$' + totalSaldo.toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right' } },
            { content: '$' + totalProv.toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right', textColor: [185, 28, 28] } }]],
    theme: 'grid',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    footStyles: { fillColor: [240, 240, 240], fontSize: 10 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { halign: 'center', cellWidth: 30 },
      2: { halign: 'right', cellWidth: 45 },
      3: { halign: 'right', cellWidth: 45 }
    }
  });

  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Smartec · Provisión Cartera · ${new Date().toLocaleString('es-CO')}`, pageW / 2, pageH - 8, { align: 'center' });

  doc.save(`smartec_provision_${new Date().toISOString().split('T')[0]}.pdf`);
};

/* ============================================================
   ACTIVOS FIJOS + DEPRECIACIÓN
============================================================ */

let activos = [];
let editingActId = null;
let currentDepActId = null;
const ACT_PAGE_SIZE = 100;
let actVisibleCount = ACT_PAGE_SIZE;

/* Categorías predefinidas: nombre + cuenta activo + cuenta dep. acumulada + cuenta gasto */
const ACT_CATEGORIES = [
  { slug: 'equipo_computo',  name: 'Equipo de cómputo',            activo: '152805', depAcum: '159220', gasto: '516005' },
  { slug: 'muebles',         name: 'Muebles y enseres',            activo: '152405', depAcum: '159215', gasto: '516005' },
  { slug: 'vehiculos',       name: 'Flota y equipo de transporte', activo: '154005', depAcum: '159225', gasto: '516005' },
  { slug: 'maquinaria',      name: 'Maquinaria y equipo',          activo: '152005', depAcum: '159210', gasto: '516005' },
  { slug: 'construcciones',  name: 'Construcciones y edificaciones',activo: '151605', depAcum: '159205', gasto: '516005' },
  { slug: 'otros',           name: 'Otros activos',                activo: '152405', depAcum: '159215', gasto: '516005' }
];

/* Carga activos */
async function loadActivos() {
  const C = window.SmartecCache;
  const all = await C.wrap('activos_fijos_all', async () => {
    const s = await getDocs(collection(db, 'activos_fijos'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  const isSuper = currentUserData.role === 'superadmin';
  if (isSuper && currentStore?.storeId === 'all') {
    activos = all.slice();
  } else {
    activos = all.filter(a =>
      a.storeId === currentStore.storeId || a.storeId === 'general'
    );
  }
}

/* Calcula meses transcurridos desde fecha compra hasta hoy (o hasta una fecha) */
function mesesTranscurridos(dateStr, untilStr = null) {
  if (!dateStr) return 0;
  const d1 = new Date(dateStr + 'T12:00:00');
  const d2 = untilStr ? new Date(untilStr + 'T12:00:00') : new Date();
  let months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
  if (d2.getDate() < d1.getDate()) months -= 1;
  return Math.max(0, months);
}

/* Calcula métricas del activo */
function computeActMetrics(a) {
  const costo = Number(a.cost || 0);
  const residual = Number(a.residualValue || 0);
  const vidaUtil = Number(a.usefulLifeMonths || 0);

  const baseDepreciable = Math.max(0, costo - residual);
  const depMensual = vidaUtil > 0 ? baseDepreciable / vidaUtil : 0;

  const meses = mesesTranscurridos(a.purchaseDate);
  const mesesEfectivos = Math.min(meses, vidaUtil);
  const depAcumulada = Math.min(baseDepreciable, depMensual * mesesEfectivos);
  const valorLibros = Math.max(0, costo - depAcumulada);
  const mesesRestantes = Math.max(0, vidaUtil - mesesEfectivos);
  const totalmenteDepreciado = mesesRestantes === 0 && vidaUtil > 0;

  return {
    costo, residual, vidaUtil, baseDepreciable,
    depMensual, mesesTranscurridos: meses, mesesEfectivos,
    depAcumulada, valorLibros, mesesRestantes, totalmenteDepreciado
  };
}

/* Badge categoría */
function actCatBadge(slug) {
  const cat = ACT_CATEGORIES.find(c => c.slug === slug);
  const label = cat?.name || 'Otros';
  return `<span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold whitespace-nowrap">${label}</span>`;
}

/* Badge estado */
function actStatusBadge(status) {
  const map = {
    activo:  { cls: 'bg-green-100 text-green-700',  lbl: '✓ Activo' },
    baja:    { cls: 'bg-gray-200 text-gray-600',    lbl: '⛔ Baja' },
    vendido: { cls: 'bg-orange-100 text-orange-700',lbl: '💰 Vendido' }
  };
  const m = map[status] || map.activo;
  return `<span class="text-[10px] px-2 py-0.5 rounded ${m.cls} font-semibold whitespace-nowrap">${m.lbl}</span>`;
}

/* Filtros */
function getFilteredActivos() {
  let list = activos.slice();
  const catF = $('act-filter-cat')?.value || 'all';
  const statusF = $('act-filter-status')?.value || 'all';
  const alertF = $('act-filter-alert')?.value || 'all';
  const orderF = $('act-filter-order')?.value || 'date';
  const search = ($('act-search')?.value || '').toLowerCase().trim();

  if (catF !== 'all') list = list.filter(a => a.category === catF);
  if (statusF !== 'all') list = list.filter(a => (a.status || 'activo') === statusF);

  if (alertF !== 'all') {
    list = list.filter(a => {
      const m = computeActMetrics(a);
      if (alertF === 'almost') return m.mesesRestantes > 0 && m.mesesRestantes <= 6;
      if (alertF === 'fully') return m.totalmenteDepreciado;
      return true;
    });
  }

  if (search) {
    list = list.filter(a =>
      (a.name||'').toLowerCase().includes(search) ||
      (a.serialNumber||'').toLowerCase().includes(search) ||
      (a.location||'').toLowerCase().includes(search)
    );
  }

  // Orden
  if (orderF === 'date') list.sort((a,b) => (b.purchaseDate||'').localeCompare(a.purchaseDate||''));
  else if (orderF === 'value') {
    list.sort((a,b) => computeActMetrics(b).valorLibros - computeActMetrics(a).valorLibros);
  }
  else if (orderF === 'name') list.sort((a,b) => (a.name||'').localeCompare(b.name||''));

  return list;
}

/* KPIs */
function renderActKpis() {
  const el = $('act-kpis');
  if (!el) return;

  let totalCosto = 0, totalDep = 0, totalLibros = 0, countActivos = 0;

  activos.forEach(a => {
    if ((a.status || 'activo') !== 'activo') return;
    const m = computeActMetrics(a);
    totalCosto += m.costo;
    totalDep += m.depAcumulada;
    totalLibros += m.valorLibros;
    countActivos++;
  });

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">🏗️ Activos</p>
      <p class="text-2xl font-bold text-[#0071E3] mt-1">${countActivos}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Registrados y activos</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">💰 Costo total</p>
      <p class="text-2xl font-bold text-[#1D1D1F] mt-1">${fmt(totalCosto)}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Inversión original</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">📉 Dep. acumulada</p>
      <p class="text-2xl font-bold text-[#0A2A4A] mt-1">${fmt(totalDep)}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Valor perdido</p>
    </div>
    <div class="glass-strong rounded-2xl p-5 border border-white/60">
      <p class="text-xs text-[#6E6E73] font-medium">📊 Valor en libros</p>
      <p class="text-2xl font-bold text-[#30D158] mt-1">${fmt(totalLibros)}</p>
      <p class="text-[10px] text-[#6E6E73] mt-1">Valor neto actual</p>
    </div>
  `;
}

/* Render tabla */
function renderActivos() {
  renderActKpis();
  const tb = $('act-tbody');
  const empty = $('act-empty');
  if (!tb) return;

  const all = getFilteredActivos();
  const visible = all.slice(0, actVisibleCount);

  if (!all.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderActFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = visible.map(a => {
    const m = computeActMetrics(a);
    const rowCls = (a.status || 'activo') !== 'activo' ? 'bg-gray-50 opacity-60'
                  : m.totalmenteDepreciado ? 'bg-gray-50'
                  : '';
    const restColor = m.totalmenteDepreciado ? 'text-gray-400' : m.mesesRestantes <= 6 ? 'text-amber-600 font-bold' : 'text-gray-600';

    return `<tr class="border-b hover:bg-gray-50 ${rowCls}">
      <td class="p-3 text-xs">
        <div class="font-semibold text-sd">${escapeHtml(a.name) || '—'}</div>
        ${a.serialNumber ? `<div class="text-[10px] text-gray-400 font-mono">S/N: ${escapeHtml(a.serialNumber)}</div>` : ''}
        ${a.location ? `<div class="text-[10px] text-gray-400">📍 ${escapeHtml(a.location)}</div>` : ''}
      </td>
      <td class="p-3">${actCatBadge(a.category)}</td>
      <td class="p-3 text-xs text-gray-600 whitespace-nowrap">${a.purchaseDate || '—'}</td>
      <td class="p-3 text-right text-xs font-mono">${fmt(m.costo)}</td>
      <td class="p-3 text-right text-xs font-mono text-orange-600">${fmt(m.depMensual)}</td>
      <td class="p-3 text-right text-xs font-mono text-red-600">${fmt(m.depAcumulada)}</td>
      <td class="p-3 text-right text-xs font-mono font-bold text-sd">${fmt(m.valorLibros)}</td>
      <td class="p-3 text-center text-xs ${restColor}">${m.mesesRestantes || '—'}</td>
      <td class="p-3 text-center">${actStatusBadge(a.status || 'activo')}</td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewActDetail("${a.id}")' class="text-sl hover:underline text-xs mr-2">Ver</button>
        ${(a.status || 'activo') === 'activo' && !m.totalmenteDepreciado ? `
          <button onclick='openActDepModal("${a.id}")' class="text-orange-600 hover:underline text-xs mr-2 font-semibold">📉 Depreciar</button>
        ` : ''}
        <button onclick='editAct("${a.id}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
        <button onclick='deleteAct("${a.id}")' class="text-red-500 hover:underline text-xs">Eliminar</button>
      </td>
    </tr>`;
  }).join('');

  renderActFooter(visible.length, all.length);
}

function renderActFooter(shown, total) {
  let footer = $('act-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'act-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('act-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }
  if (total === 0) { footer.innerHTML = ''; return; }
  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">Mostrando <b>${shown}</b> de <b>${total}</b> activos</p>
    ${hasMore ? `<button onclick="loadMoreAct()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">⬇️ Cargar 100 más</button>` : `<p class="text-[10px] text-gray-400">— Fin —</p>`}
  `;
}

window.loadMoreAct = () => {
  actVisibleCount += ACT_PAGE_SIZE;
  renderActivos();
};

['act-filter-cat','act-filter-status','act-filter-order','act-filter-alert','act-search'].forEach(id => {
  const el = $(id);
  if (el) {
    const handler = () => { actVisibleCount = ACT_PAGE_SIZE; renderActivos(); };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  }
});

window.clearActFilters = () => {
  $('act-filter-cat').value = 'all';
  $('act-filter-status').value = 'all';
  $('act-filter-order').value = 'date';
  $('act-filter-alert').value = 'all';
  $('act-search').value = '';
  actVisibleCount = ACT_PAGE_SIZE;
  renderActivos();
};

/* ============================================================
   FORMULARIO DE ACTIVO
============================================================ */

window.openActForm = async () => {
  if (!canEditPuc()) return;
  if (!pucAccounts.length) await loadPuc();
  editingActId = null;
  $('act-title').innerText = 'Nuevo activo fijo';
  renderActForm({
    purchaseDate: todayStr(),
    cost: 0,
    residualValue: 0,
    usefulLifeMonths: 60,
    category: 'equipo_computo',
    status: 'activo'
  });
  const m = $('act-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.editAct = (id) => {
  const a = activos.find(x => x.id === id);
  if (!a) return;
  if (!canEditPuc()) return;
  editingActId = id;
  $('act-title').innerText = 'Editar activo fijo';
  renderActForm(a);
  const m = $('act-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeActForm = () => {
  const m = $('act-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingActId = null;
};

function renderActForm(v) {
  const catOpts = ACT_CATEGORIES.map(c =>
    `<option value="${c.slug}" ${v.category === c.slug ? 'selected' : ''}>${c.name}</option>`
  ).join('');

  const cat = ACT_CATEGORIES.find(c => c.slug === (v.category || 'equipo_computo'));

  $('act-body').innerHTML = `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Nombre del activo *</label>
        <input id="ac-name" type="text" value="${escapeHtml(v.name) || ''}" placeholder="Ej: Laptop Dell Latitude" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Nº de serie / placa</label>
        <input id="ac-serial" type="text" value="${escapeHtml(v.serialNumber) || ''}" placeholder="Opcional" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Categoría *</label>
        <select id="ac-category" class="w-full px-3 py-2 border rounded-lg mt-1" onchange="onActCatChange()">
          ${catOpts}
        </select>
        <p class="text-[10px] text-gray-500 mt-1">Define las cuentas PUC automáticamente.</p>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Ubicación</label>
        <input id="ac-location" type="text" value="${escapeHtml(v.location) || ''}" placeholder="Ej: Oficina principal" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <div class="grid grid-cols-3 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Fecha de compra *</label>
        <input id="ac-purchaseDate" type="date" value="${v.purchaseDate || todayStr()}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Costo *</label>
        <input id="ac-cost" type="number" min="0" step="1" value="${v.cost || ''}" placeholder="0" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono" oninput="recalcActPreview()">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Valor residual</label>
        <input id="ac-residual" type="number" min="0" step="1" value="${v.residualValue || 0}" placeholder="0" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono" oninput="recalcActPreview()">
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Vida útil (meses) *</label>
        <input id="ac-usefulLife" type="number" min="1" max="600" value="${v.usefulLifeMonths || 60}" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono" oninput="recalcActPreview()">
        <p class="text-[10px] text-gray-500 mt-1">Ej: 60 = 5 años.</p>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Estado</label>
        <select id="ac-status" class="w-full px-3 py-2 border rounded-lg mt-1">
          <option value="activo" ${(v.status||'activo') === 'activo' ? 'selected' : ''}>✓ Activo</option>
          <option value="baja" ${v.status === 'baja' ? 'selected' : ''}>⛔ Dado de baja</option>
          <option value="vendido" ${v.status === 'vendido' ? 'selected' : ''}>💰 Vendido</option>
        </select>
      </div>
    </div>

    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
      <p class="text-xs font-semibold text-blue-700 mb-2">📊 Vista previa de depreciación</p>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div>
          <p class="text-[10px] text-gray-500">Base depreciable</p>
          <p id="ac-preview-base" class="font-mono font-bold text-blue-700">$0</p>
        </div>
        <div>
          <p class="text-[10px] text-gray-500">Depreciación mensual</p>
          <p id="ac-preview-monthly" class="font-mono font-bold text-orange-600">$0</p>
        </div>
        <div>
          <p class="text-[10px] text-gray-500">Depreciación anual</p>
          <p id="ac-preview-annual" class="font-mono font-bold text-red-600">$0</p>
        </div>
        <div>
          <p class="text-[10px] text-gray-500">Meses totales</p>
          <p id="ac-preview-months" class="font-mono font-bold text-gray-700">0</p>
        </div>
      </div>
    </div>

    <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 text-xs">
      <p class="text-[10px] font-semibold text-sd mb-2">Cuentas PUC asignadas (según categoría)</p>
      <div class="grid grid-cols-3 gap-2">
        <div>
          <p class="text-[9px] text-gray-500">Activo</p>
          <p id="ac-puc-activo" class="font-mono text-[11px] font-semibold">${cat?.activo || '—'}</p>
        </div>
        <div>
          <p class="text-[9px] text-gray-500">Dep. acumulada</p>
          <p id="ac-puc-dep" class="font-mono text-[11px] font-semibold">${cat?.depAcum || '—'}</p>
        </div>
        <div>
          <p class="text-[9px] text-gray-500">Gasto</p>
          <p id="ac-puc-gasto" class="font-mono text-[11px] font-semibold">${cat?.gasto || '—'}</p>
        </div>
      </div>
    </div>

    <label class="text-xs font-semibold text-sd">Notas</label>
    <textarea id="ac-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-4 text-sm">${escapeHtml(v.notes) || ''}</textarea>

    <div class="flex gap-3">
      <button onclick="closeActForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveAct()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">Guardar</button>
    </div>
  `;

  recalcActPreview();
}

window.onActCatChange = () => {
  const catSlug = $('ac-category')?.value;
  const cat = ACT_CATEGORIES.find(c => c.slug === catSlug);
  if (!cat) return;
  $('ac-puc-activo').innerText = cat.activo;
  $('ac-puc-dep').innerText = cat.depAcum;
  $('ac-puc-gasto').innerText = cat.gasto;
};

window.recalcActPreview = () => {
  const cost = Number($('ac-cost')?.value || 0);
  const residual = Number($('ac-residual')?.value || 0);
  const months = Number($('ac-usefulLife')?.value || 0);

  const base = Math.max(0, cost - residual);
  const monthly = months > 0 ? base / months : 0;

  $('ac-preview-base').innerText = fmt(base);
  $('ac-preview-monthly').innerText = fmt(monthly);
  $('ac-preview-annual').innerText = fmt(monthly * 12);
  $('ac-preview-months').innerText = months;
};

window.saveAct = async () => {
  const name = $('ac-name').value.trim();
  const serialNumber = $('ac-serial').value.trim();
  const category = $('ac-category').value;
  const location = $('ac-location').value.trim();
  const purchaseDate = $('ac-purchaseDate').value;
  const cost = Number($('ac-cost').value || 0);
  const residualValue = Number($('ac-residual').value || 0);
  const usefulLifeMonths = Number($('ac-usefulLife').value || 0);
  const status = $('ac-status').value;
  const notes = $('ac-notes').value.trim();

  if (!name) return alert('El nombre es obligatorio');
  if (!purchaseDate) return alert('La fecha de compra es obligatoria');
  if (cost <= 0) return alert('El costo debe ser mayor a 0');
  if (usefulLifeMonths <= 0) return alert('La vida útil debe ser mayor a 0');
  if (residualValue < 0 || residualValue >= cost) return alert('El valor residual debe ser menor al costo');

  const cat = ACT_CATEGORIES.find(c => c.slug === category);

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Guardando...';

  try {
    const data = {
      name, serialNumber, category, location,
      purchaseDate, cost, residualValue, usefulLifeMonths,
      status, notes,
      pucActivo: cat?.activo || '152405',
      pucDepAcum: cat?.depAcum || '159215',
      pucGasto: cat?.gasto || '516005',
      storeId: currentStore.storeId,
      storeName: currentStore.name,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };

    if (editingActId) {
      const prev = activos.find(a => a.id === editingActId);
      await updateDoc(doc(db, 'activos_fijos', editingActId), data);
      await audit({
        action: 'update', collection: 'activos_fijos', docId: editingActId,
        before: prev, after: data,
        note: `Activo editado: ${name} · ${fmt(cost)}`
      });
    } else {
      data.depRecords = [];
      data.createdAt = serverTimestamp();
      data.createdBy = currentUser.email;
      const ref = await addDoc(collection(db, 'activos_fijos'), data);
      await audit({
        action: 'create', collection: 'activos_fijos', docId: ref.id,
        after: data,
        note: `Activo creado: ${name} · ${fmt(cost)}`
      });
    }

    window.SmartecCache.invalidate('activos_fijos_all');
    await loadActivos();
    renderActivos();
    closeActForm();
    alert('✅ Activo guardado');
  } catch (e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = 'Guardar';
  }
};

/* ============================================================
   GENERAR DEPRECIACIÓN
============================================================ */

window.openActDepModal = (id) => {
  const a = activos.find(x => x.id === id);
  if (!a) return;
  currentDepActId = id;

  const m = computeActMetrics(a);
  $('act-dep-subtitle').innerText = `${a.name} · Valor en libros: ${fmt(m.valorLibros)}`;

  const suggestedMonths = Math.min(m.mesesRestantes, 1);  // 1 mes por defecto
  const amount = m.depMensual * suggestedMonths;

  $('act-dep-body').innerHTML = `
    <div class="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 text-xs">
      <div class="flex justify-between"><span class="text-gray-600">Valor en libros hoy:</span><span class="font-mono font-bold">${fmt(m.valorLibros)}</span></div>
      <div class="flex justify-between"><span class="text-gray-600">Depreciación mensual:</span><span class="font-mono font-bold text-orange-600">${fmt(m.depMensual)}</span></div>
      <div class="flex justify-between"><span class="text-gray-600">Meses restantes:</span><span class="font-mono font-bold">${m.mesesRestantes}</span></div>
    </div>

    <label class="text-xs font-semibold text-sd block mb-1">Meses a depreciar *</label>
    <input id="ad-months" type="number" min="1" max="${m.mesesRestantes}" value="${suggestedMonths}" class="w-full px-3 py-2 border rounded-lg mb-3 font-mono" oninput="recalcActDep(${m.depMensual}, ${m.valorLibros})">
    <p class="text-[10px] text-gray-500 -mt-2 mb-3">Máximo: ${m.mesesRestantes} meses (vida útil restante).</p>

    <label class="text-xs font-semibold text-sd block mb-1">Fecha del asiento *</label>
    <input id="ad-date" type="date" value="${todayStr()}" class="w-full px-3 py-2 border rounded-lg mb-3">

    <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-xs">
      <p class="text-[10px] font-semibold text-sd mb-2">Asiento a generar:</p>
      <div class="flex justify-between text-xs mb-1">
        <span class="font-mono">${escapeHtml(a.pucGasto)} · Gasto depreciación</span>
        <span class="font-mono text-blue-700 font-bold">D <span id="ad-amount-d">${fmt(amount)}</span></span>
      </div>
      <div class="flex justify-between text-xs">
        <span class="font-mono">${escapeHtml(a.pucDepAcum)} · Dep. acumulada</span>
        <span class="font-mono text-purple-700 font-bold">C <span id="ad-amount-c">${fmt(amount)}</span></span>
      </div>
    </div>

    <label class="text-xs font-semibold text-sd block mb-1">Nota (opcional)</label>
    <input id="ad-note" type="text" value="Depreciación ${suggestedMonths} mes(es)" class="w-full px-3 py-2 border rounded-lg mb-4 text-sm">

    <div class="flex gap-3">
      <button onclick="closeActDepModal()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="submitActDep()" class="flex-1 bg-orange-600 text-white py-2.5 rounded-lg hover:bg-orange-700 font-semibold">📉 Generar asiento</button>
    </div>
  `;

  const modal = $('act-dep-modal');
  modal.classList.remove('hidden'); modal.classList.add('flex');
};

window.recalcActDep = (depMensual, valorLibros) => {
  const months = Number($('ad-months')?.value || 1);
  let amount = depMensual * months;
  if (amount > valorLibros) amount = valorLibros;  // no depreciar más que el valor en libros
  $('ad-amount-d').innerText = fmt(amount);
  $('ad-amount-c').innerText = fmt(amount);
};

window.closeActDepModal = () => {
  const m = $('act-dep-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  currentDepActId = null;
};

window.submitActDep = async () => {
  if (!currentDepActId) return;
  const a = activos.find(x => x.id === currentDepActId);
  if (!a) return;

  const months = Number($('ad-months').value || 1);
  const date = $('ad-date').value;
  const note = $('ad-note').value.trim();

  if (months <= 0) return alert('Los meses deben ser mayor a 0');
  if (!date) return alert('La fecha es obligatoria');

  const m = computeActMetrics(a);
  let amount = m.depMensual * months;
  if (amount > m.valorLibros) amount = m.valorLibros;
  amount = Math.round(amount);

  if (amount <= 0) return alert('El valor a depreciar es 0.');

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Generando...';

  try {
    // 1. Crear comprobante de depreciación
    const nextNum = await nextCompNumber(a.storeId || currentStore.storeId);

    const compData = {
      number: nextNum,
      date,
      type: 'ajuste',
      concept: `Depreciación: ${a.name} (${months} mes${months !== 1 ? 'es' : ''})`,
      storeId: a.storeId || currentStore.storeId,
      storeName: a.storeName || currentStore.name,
      notes: `Generado automáticamente desde Activos Fijos`,
      items: [
        { accountCode: a.pucGasto, accountName: 'Gasto depreciación', type: 'D', amount, note: note || '' },
        { accountCode: a.pucDepAcum, accountName: 'Depreciación acumulada', type: 'C', amount, note: note || '' }
      ],
      totalDebit: amount,
      totalCredit: amount,
      status: 'activo',
      sourceType: 'depreciacion',
      sourceRef: a.id,
      createdAt: serverTimestamp(),
      createdBy: currentUser.email,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };

    const compRef = await addDoc(collection(db, 'comprobantes'), compData);

    // 2. Guardar registro de depreciación en el activo
    const depRecord = {
      date,
      months,
      amount,
      compId: compRef.id,
      compNumber: nextNum,
      note: note || '',
      registeredBy: currentUser.email,
      registeredAt: new Date().toISOString()
    };

    const depRecords = [...(a.depRecords || []), depRecord];

    await updateDoc(doc(db, 'activos_fijos', currentDepActId), {
      depRecords,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    });

    // 3. Auditoría
    await audit({
      action: 'create', collection: 'activos_fijos', docId: currentDepActId,
      before: { depRecords: a.depRecords || [] },
      after: { depRecords },
      note: `Depreciación: ${a.name} · ${months} mes(es) · ${fmt(amount)} · Comprobante ${nextNum}`
    });

    window.SmartecCache.invalidate('activos_fijos_all');
    window.SmartecCache.invalidate('comprobantes_all');
    await loadActivos();
    renderActivos();
    closeActDepModal();
    alert(`✅ Depreciación generada\n\nComprobante: ${nextNum}\nValor: ${fmt(amount)}`);
  } catch (e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = '📉 Generar asiento';
  }
};

/* Eliminar */
window.deleteAct = async (id) => {
  const a = activos.find(x => x.id === id);
  if (!a) return;
  if (currentUserData.role !== 'superadmin') return alert('Solo superadmin puede eliminar.');
  if (!confirm(`⚠️ ¿Eliminar el activo "${a.name}"?`)) return;

  try {
    await deleteDoc(doc(db, 'activos_fijos', id));
    await audit({
      action: 'delete', collection: 'activos_fijos', docId: id,
      before: a,
      note: `Activo eliminado: ${a.name}`
    });
    window.SmartecCache.invalidate('activos_fijos_all');
    await loadActivos();
    renderActivos();
    alert('✅ Activo eliminado');
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

/* Detalle */
window.viewActDetail = (id) => {
  const a = activos.find(x => x.id === id);
  if (!a) return;
  const m = computeActMetrics(a);

  const depHistory = (a.depRecords || []).length ? a.depRecords.map(d => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 text-xs">${d.date}</td>
      <td class="p-2 text-xs text-center">${d.months}</td>
      <td class="p-2 text-xs font-mono font-bold text-right">${fmt(d.amount)}</td>
      <td class="p-2 text-xs font-mono">${escapeHtml(d.compNumber) || '—'}</td>
      <td class="p-2 text-xs text-gray-500">${escapeHtml(d.note) || ''}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="text-center text-gray-400 py-3 text-xs">Sin depreciaciones registradas</td></tr>';

  $('act-detail-body').innerHTML = `
    <div class="flex justify-between items-start mb-4">
      <div>
        <p class="text-xs text-gray-400">${actCatBadge(a.category)}</p>
        <p class="text-lg font-bold text-sd mt-1">${escapeHtml(a.name)}</p>
        ${a.serialNumber ? `<p class="text-xs text-gray-500 font-mono">S/N: ${escapeHtml(a.serialNumber)}</p>` : ''}
        ${a.location ? `<p class="text-xs text-gray-500">📍 ${escapeHtml(a.location)}</p>` : ''}
      </div>
      ${actStatusBadge(a.status || 'activo')}
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
      <div class="bg-gray-50 rounded-lg p-3">
        <p class="text-[10px] text-gray-400">Costo</p>
        <p class="font-bold text-gray-700 font-mono">${fmt(m.costo)}</p>
      </div>
      <div class="bg-orange-50 rounded-lg p-3">
        <p class="text-[10px] text-orange-600">Dep. acumulada</p>
        <p class="font-bold text-orange-700 font-mono">${fmt(m.depAcumulada)}</p>
      </div>
      <div class="bg-green-50 rounded-lg p-3">
        <p class="text-[10px] text-green-600">Valor en libros</p>
        <p class="font-bold text-green-700 font-mono">${fmt(m.valorLibros)}</p>
      </div>
      <div class="bg-blue-50 rounded-lg p-3">
        <p class="text-[10px] text-blue-600">Dep. mensual</p>
        <p class="font-bold text-blue-700 font-mono">${fmt(m.depMensual)}</p>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
      <div><p class="text-gray-400">Fecha compra</p><p class="font-semibold">${a.purchaseDate}</p></div>
      <div><p class="text-gray-400">Vida útil</p><p class="font-semibold">${a.usefulLifeMonths} meses</p></div>
      <div><p class="text-gray-400">Meses transcurridos</p><p class="font-semibold">${m.mesesTranscurridos}</p></div>
      <div><p class="text-gray-400">Meses restantes</p><p class="font-semibold ${m.mesesRestantes <= 6 ? 'text-amber-600' : ''}">${m.mesesRestantes}</p></div>
    </div>

    <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 text-xs">
      <p class="text-[10px] font-semibold text-sd mb-2">Cuentas PUC</p>
      <div class="grid grid-cols-3 gap-2">
        <div><p class="text-[9px] text-gray-500">Activo</p><p class="font-mono text-[11px]">${escapeHtml(a.pucActivo)}</p></div>
        <div><p class="text-[9px] text-gray-500">Dep. acum.</p><p class="font-mono text-[11px]">${escapeHtml(a.pucDepAcum)}</p></div>
        <div><p class="text-[9px] text-gray-500">Gasto</p><p class="font-mono text-[11px]">${escapeHtml(a.pucGasto)}</p></div>
      </div>
    </div>

    <div class="border border-gray-200 rounded-lg p-3 mb-4">
      <p class="text-xs font-semibold text-sd mb-2">📉 Historial de depreciaciones (${(a.depRecords||[]).length})</p>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="bg-gray-50">
            <tr>
              <th class="p-2 text-left text-[10px] uppercase font-bold">Fecha</th>
              <th class="p-2 text-center text-[10px] uppercase font-bold w-[60px]">Meses</th>
              <th class="p-2 text-right text-[10px] uppercase font-bold w-[120px]">Valor</th>
              <th class="p-2 text-left text-[10px] uppercase font-bold">Comprobante</th>
              <th class="p-2 text-left text-[10px] uppercase font-bold">Nota</th>
            </tr>
          </thead>
          <tbody>${depHistory}</tbody>
        </table>
      </div>
    </div>

    ${a.notes ? `<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm mb-4"><p class="text-xs text-yellow-700 font-semibold mb-1">Notas</p><p>${escapeHtml(a.notes)}</p></div>` : ''}

    <div class="text-xs text-gray-400">
      Creado por: ${escapeHtml(a.createdBy) || '-'}
    </div>
  `;

  const modal = $('act-detail-modal');
  modal.classList.remove('hidden'); modal.classList.add('flex');
};

window.closeActDetail = () => {
  const m = $('act-detail-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

/* Exportar PDF */
window.exportActivosPDF = async () => {
  const list = getFilteredActivos();
  if (!list.length) return alert('No hay activos para exportar.');

  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Activos Fijos', 14, 13);

  y = 28;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  const storeLabel = currentStore?.storeId === 'all' ? 'Todas las tiendas' : (currentStore?.name || 'General');
  doc.text(`Tienda: ${storeLabel}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  const rows = list.map(a => {
    const m = computeActMetrics(a);
    const cat = ACT_CATEGORIES.find(c => c.slug === a.category);
    return [
      (a.name || '').substring(0, 35),
      cat?.name || '—',
      a.purchaseDate || '',
      '$' + m.costo.toLocaleString('es-CO'),
      '$' + Math.round(m.depAcumulada).toLocaleString('es-CO'),
      '$' + Math.round(m.valorLibros).toLocaleString('es-CO'),
      String(m.mesesRestantes),
      (a.status || 'activo') === 'activo' ? 'Activo' : (a.status === 'vendido' ? 'Vendido' : 'Baja')
    ];
  });

  // Totales
  const totalCosto = list.reduce((s,a) => s + Number(a.cost||0), 0);
  const totalDep = list.reduce((s,a) => s + computeActMetrics(a).depAcumulada, 0);
  const totalLibros = list.reduce((s,a) => s + computeActMetrics(a).valorLibros, 0);

  rows.push([
    { content: 'TOTALES', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right', fillColor: [230, 230, 230] } },
    { content: '$' + totalCosto.toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right', fillColor: [230, 230, 230] } },
    { content: '$' + Math.round(totalDep).toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right', fillColor: [230, 230, 230], textColor: [185, 28, 28] } },
    { content: '$' + Math.round(totalLibros).toLocaleString('es-CO'), styles: { fontStyle: 'bold', halign: 'right', fillColor: [230, 230, 230], textColor: [21, 128, 61] } },
    { content: '', colSpan: 2, styles: { fillColor: [230, 230, 230] } }
  ]);

  doc.autoTable({
    startY: y,
    head: [['Activo','Categoría','Compra','Costo','Dep. acumulada','Valor libros','Meses rest.','Estado']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    margin: { left: 10, right: 10 },
    columnStyles: {
      0: { cellWidth: 45 },
      2: { cellWidth: 22, halign: 'center' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
      6: { halign: 'center', cellWidth: 20 },
      7: { halign: 'center', cellWidth: 18 }
    }
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Smartec · Activos Fijos · Página ${i} de ${pages}`, pageW / 2, pageH - 8, { align: 'center' });
  }
  doc.save(`smartec_activos_${new Date().toISOString().split('T')[0]}.pdf`);
};

/* ============================================================
   NÓMINA
============================================================ */

let empleados = [];
let nominaPeriodos = [];
let editingNomEmpId = null;
let editingNomPerId = null;
const NOM_PAGE_SIZE = 100;
let nomEmpVisibleCount = NOM_PAGE_SIZE;
let nomPerVisibleCount = NOM_PAGE_SIZE;

/* Parámetros de nómina Colombia 2025 (editables desde settings) */
const NOMINA_DEFAULTS = {
  smmlv: 1423500,
  auxilioTransporte: 200000,
  saludEmpleado: 0.04,
  saludEmpleador: 0.085,
  pensionEmpleado: 0.04,
  pensionEmpleador: 0.12,
  cajaCompensacion: 0.04,
  sena: 0.02,
  icbf: 0.03,
  cesantias: 0.0833,
  prima: 0.0833,
  vacaciones: 0.0417,
  interesesCesantias: 0.12
};

const ARL_LEVELS = [
  { level: 'I',    pct: 0.00522, label: 'Nivel I — Riesgo mínimo (0.522%)' },
  { level: 'II',   pct: 0.01044, label: 'Nivel II — Riesgo bajo (1.044%)' },
  { level: 'III',  pct: 0.02436, label: 'Nivel III — Riesgo medio (2.436%)' },
  { level: 'IV',   pct: 0.04350, label: 'Nivel IV — Riesgo alto (4.350%)' },
  { level: 'V',    pct: 0.06960, label: 'Nivel V — Riesgo máximo (6.960%)' }
];

let nominaParams = { ...NOMINA_DEFAULTS };

/* Carga parámetros de nómina (con cache) */
async function loadNominaParams() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'nomina'));
    if (snap.exists()) {
      nominaParams = { ...NOMINA_DEFAULTS, ...snap.data() };
    }
  } catch(e) { console.warn('No se pudo cargar params nómina:', e); }
}

/* ============================================================
   EMPLEADOS
============================================================ */

async function loadEmpleados() {
  const C = window.SmartecCache;
  const all = await C.wrap('empleados_all', async () => {
    const s = await getDocs(collection(db, 'empleados'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  const isSuper = currentUserData.role === 'superadmin';
  if (isSuper && currentStore?.storeId === 'all') {
    empleados = all.slice();
  } else {
    empleados = all.filter(e =>
      e.storeId === currentStore.storeId || e.storeId === 'general'
    );
  }
  empleados.sort((a,b) => (a.name||'').localeCompare(b.name||''));
}

function nomEmpStatusBadge(status) {
  const map = {
    activo:    { cls: 'bg-green-100 text-green-700',  lbl: '✓ Activo' },
    retirado:  { cls: 'bg-gray-200 text-gray-600',    lbl: '⛔ Retirado' },
    vacaciones:{ cls: 'bg-blue-100 text-blue-700',    lbl: '🏖️ Vacaciones' },
    licencia:  { cls: 'bg-amber-100 text-amber-700',  lbl: '📋 Licencia' }
  };
  const m = map[status] || map.activo;
  return `<span class="text-[10px] px-2 py-0.5 rounded ${m.cls} font-semibold whitespace-nowrap">${m.lbl}</span>`;
}

function getFilteredEmpleados() {
  let list = empleados.slice();
  const search = ($('nom-emp-search')?.value || '').toLowerCase().trim();
  if (search) {
    list = list.filter(e =>
      (e.name||'').toLowerCase().includes(search) ||
      (e.documentNumber||'').toLowerCase().includes(search) ||
      (e.position||'').toLowerCase().includes(search)
    );
  }
  return list;
}

function renderNomEmpStats() {
  const el = $('nom-emp-stats');
  if (!el) return;
  const activos = empleados.filter(e => (e.status||'activo') === 'activo');
  const totalSalarios = activos.reduce((s,e) => s + Number(e.baseSalary||0), 0);
  const totalAuxilio = activos.filter(e => e.auxilioTransporte).reduce((s,e) => s + nominaParams.auxilioTransporte, 0);
  const totalNomina = totalSalarios + totalAuxilio;

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Empleados activos</p>
      <p class="text-xl font-bold text-[#0071E3] mt-0.5">${activos.length}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Total salarios base</p>
      <p class="text-xl font-bold text-[#1D1D1F] mt-0.5">${fmt(totalSalarios)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Auxilios transporte</p>
      <p class="text-xl font-bold text-[#FF9F0A] mt-0.5">${fmt(totalAuxilio)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Costo mensual nómina</p>
      <p class="text-xl font-bold text-[#30D158] mt-0.5">${fmt(totalNomina)}</p>
    </div>
  `;
}

function renderEmpleados() {
  renderNomEmpStats();
  const tb = $('nom-emp-tbody');
  const empty = $('nom-emp-empty');
  if (!tb) return;

  const all = getFilteredEmpleados();
  const visible = all.slice(0, nomEmpVisibleCount);

  if (!all.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderNomEmpFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = visible.map(e => {
    const arl = ARL_LEVELS.find(a => a.level === e.arlLevel) || ARL_LEVELS[0];
    return `<tr class="border-b hover:bg-gray-50 ${(e.status||'activo') !== 'activo' ? 'opacity-60' : ''}">
      <td class="p-3 text-xs font-semibold text-sd">${escapeHtml(e.name) || '—'}</td>
      <td class="p-3 text-xs font-mono">${escapeHtml(e.documentNumber) || '—'}</td>
      <td class="p-3 text-xs">${escapeHtml(e.position) || '—'}</td>
      <td class="p-3 text-right text-xs font-mono font-bold text-sd">${fmt(e.baseSalary)}</td>
      <td class="p-3 text-center text-xs">${e.auxilioTransporte ? '<span class="text-green-600 font-semibold">✓</span>' : '<span class="text-gray-300">—</span>'}</td>
      <td class="p-3 text-center text-xs font-mono">${arl.level}</td>
      <td class="p-3 text-center">${nomEmpStatusBadge(e.status || 'activo')}</td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='editNomEmp("${e.id}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
        <button onclick='toggleNomEmp("${e.id}")' class="text-${(e.status||'activo') === 'activo' ? 'orange' : 'green'}-500 hover:underline text-xs mr-2">${(e.status||'activo') === 'activo' ? 'Retirar' : 'Reactivar'}</button>
        <button onclick='deleteNomEmp("${e.id}")' class="text-red-500 hover:underline text-xs">Eliminar</button>
      </td>
    </tr>`;
  }).join('');

  renderNomEmpFooter(visible.length, all.length);
}

function renderNomEmpFooter(shown, total) {
  let footer = $('nom-emp-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'nom-emp-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('nom-emp-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }
  if (total === 0) { footer.innerHTML = ''; return; }
  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">Mostrando <b>${shown}</b> de <b>${total}</b> empleados</p>
    ${hasMore ? `<button onclick="loadMoreNomEmp()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">⬇️ Cargar 100 más</button>` : `<p class="text-[10px] text-gray-400">— Fin —</p>`}
  `;
}

window.loadMoreNomEmp = () => {
  nomEmpVisibleCount += NOM_PAGE_SIZE;
  renderEmpleados();
};

$('nom-emp-search')?.addEventListener('input', () => {
  nomEmpVisibleCount = NOM_PAGE_SIZE;
  renderEmpleados();
});

/* Formulario de empleado */
window.openNomEmpForm = async () => {
  if (!canEditPuc()) return;
  if (!pucAccounts.length) await loadPuc();
  editingNomEmpId = null;
  $('nom-emp-title').innerText = 'Nuevo empleado';
  renderNomEmpForm({
    status: 'activo',
    baseSalary: nominaParams.smmlv,
    auxilioTransporte: true,
    arlLevel: 'I',
    startDate: todayStr()
  });
  const m = $('nom-emp-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.editNomEmp = (id) => {
  const e = empleados.find(x => x.id === id);
  if (!e) return;
  if (!canEditPuc()) return;
  editingNomEmpId = id;
  $('nom-emp-title').innerText = 'Editar empleado';
  renderNomEmpForm(e);
  const m = $('nom-emp-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeNomEmpForm = () => {
  const m = $('nom-emp-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingNomEmpId = null;
};

function renderNomEmpForm(v) {
  const statusOpts = ['activo','vacaciones','licencia','retirado'].map(s =>
    `<option value="${s}" ${v.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
  ).join('');

  const arlOpts = ARL_LEVELS.map(a =>
    `<option value="${a.level}" ${v.arlLevel === a.level ? 'selected' : ''}>${a.label}</option>`
  ).join('');

  $('nom-emp-body').innerHTML = `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Nombre completo *</label>
        <input id="ne-name" type="text" value="${escapeHtml(v.name) || ''}" placeholder="Ej: Juan Pérez" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Cédula *</label>
        <input id="ne-doc" type="text" value="${escapeHtml(v.documentNumber) || ''}" placeholder="1234567890" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono">
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Cargo *</label>
        <input id="ne-position" type="text" value="${escapeHtml(v.position) || ''}" placeholder="Ej: Vendedor" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Fecha de ingreso *</label>
        <input id="ne-start" type="date" value="${v.startDate || todayStr()}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <div class="grid grid-cols-3 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Salario base *</label>
        <input id="ne-salary" type="number" min="0" step="1000" value="${v.baseSalary || ''}" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono">
        <p class="text-[10px] text-gray-500 mt-1">SMMLV: ${fmt(nominaParams.smmlv)}</p>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Nivel ARL *</label>
        <select id="ne-arl" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm">
          ${arlOpts}
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Estado</label>
        <select id="ne-status" class="w-full px-3 py-2 border rounded-lg mt-1">
          ${statusOpts}
        </select>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Email</label>
        <input id="ne-email" type="email" value="${escapeHtml(v.email) || ''}" placeholder="opcional@email.com" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Teléfono</label>
        <input id="ne-phone" type="text" value="${escapeHtml(v.phone) || ''}" placeholder="3101234567" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
      <label class="flex items-center gap-2 text-xs">
        <input id="ne-auxilio" type="checkbox" ${v.auxilioTransporte !== false ? 'checked' : ''} class="w-4 h-4">
        <span class="font-semibold text-sd">Recibe auxilio de transporte</span>
        <span class="text-gray-500">(${fmt(nominaParams.auxilioTransporte)}/mes)</span>
      </label>
      <p class="text-[10px] text-gray-500 mt-1 ml-6">Aplica si el salario es ≤ 2 SMMLV.</p>
    </div>

    <div class="grid grid-cols-3 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Banco</label>
        <input id="ne-bank" type="text" value="${escapeHtml(v.bank) || ''}" placeholder="Bancolombia" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Tipo cuenta</label>
        <select id="ne-accountType" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm">
          <option value="ahorros" ${v.accountType === 'ahorros' ? 'selected' : ''}>Ahorros</option>
          <option value="corriente" ${v.accountType === 'corriente' ? 'selected' : ''}>Corriente</option>
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Nº cuenta</label>
        <input id="ne-accountNumber" type="text" value="${escapeHtml(v.accountNumber) || ''}" placeholder="Opcional" class="w-full px-3 py-2 border rounded-lg mt-1 font-mono">
      </div>
    </div>

    <label class="text-xs font-semibold text-sd">Notas</label>
    <textarea id="ne-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-4 text-sm">${escapeHtml(v.notes) || ''}</textarea>

    <div class="flex gap-3">
      <button onclick="closeNomEmpForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveNomEmp()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">Guardar</button>
    </div>
  `;
}

window.saveNomEmp = async () => {
  const name = $('ne-name').value.trim();
  const documentNumber = $('ne-doc').value.trim();
  const position = $('ne-position').value.trim();
  const startDate = $('ne-start').value;
  const baseSalary = Number($('ne-salary').value || 0);
  const arlLevel = $('ne-arl').value;
  const status = $('ne-status').value;
  const email = $('ne-email').value.trim();
  const phone = $('ne-phone').value.trim();
  const auxilioTransporte = $('ne-auxilio').checked;
  const bank = $('ne-bank').value.trim();
  const accountType = $('ne-accountType').value;
  const accountNumber = $('ne-accountNumber').value.trim();
  const notes = $('ne-notes').value.trim();

  if (!name) return alert('El nombre es obligatorio');
  if (!documentNumber) return alert('La cédula es obligatoria');
  if (!position) return alert('El cargo es obligatorio');
  if (baseSalary <= 0) return alert('El salario debe ser mayor a 0');

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Guardando...';

  try {
    const data = {
      name, documentNumber, position, startDate,
      baseSalary, arlLevel, status, email, phone,
      auxilioTransporte, bank, accountType, accountNumber, notes,
      storeId: currentStore.storeId,
      storeName: currentStore.name,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };

    if (editingNomEmpId) {
      const prev = empleados.find(e => e.id === editingNomEmpId);
      await updateDoc(doc(db, 'empleados', editingNomEmpId), data);
      await audit({
        action: 'update', collection: 'empleados', docId: editingNomEmpId,
        before: prev, after: data,
        note: `Empleado editado: ${name}`
      });
    } else {
      data.createdAt = serverTimestamp();
      data.createdBy = currentUser.email;
      const ref = await addDoc(collection(db, 'empleados'), data);
      await audit({
        action: 'create', collection: 'empleados', docId: ref.id,
        after: data,
        note: `Empleado creado: ${name} · ${fmt(baseSalary)}`
      });
    }

    window.SmartecCache.invalidate('empleados_all');
    await loadEmpleados();
    renderEmpleados();
    closeNomEmpForm();
    alert('✅ Empleado guardado');
  } catch (e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = 'Guardar';
  }
};

window.toggleNomEmp = async (id) => {
  const e = empleados.find(x => x.id === id);
  if (!e) return;
  const isActive = (e.status || 'activo') === 'activo';
  const newStatus = isActive ? 'retirado' : 'activo';
  if (!confirm(`¿${isActive ? 'Retirar' : 'Reactivar'} a ${e.name}?`)) return;

  try {
    await updateDoc(doc(db, 'empleados', id), {
      status: newStatus,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    });
    await audit({
      action: 'update', collection: 'empleados', docId: id,
      before: { status: e.status || 'activo' },
      after: { status: newStatus },
      note: `Empleado ${isActive ? 'retirado' : 'reactivado'}: ${e.name}`
    });
    window.SmartecCache.invalidate('empleados_all');
    await loadEmpleados();
    renderEmpleados();
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

window.deleteNomEmp = async (id) => {
  const e = empleados.find(x => x.id === id);
  if (!e) return;
  if (currentUserData.role !== 'superadmin') return alert('Solo superadmin puede eliminar.');
  if (!confirm(`⚠️ ¿Eliminar definitivamente a "${e.name}"?`)) return;

  try {
    await deleteDoc(doc(db, 'empleados', id));
    await audit({
      action: 'delete', collection: 'empleados', docId: id,
      before: e,
      note: `Empleado eliminado: ${e.name}`
    });
    window.SmartecCache.invalidate('empleados_all');
    await loadEmpleados();
    renderEmpleados();
    alert('✅ Empleado eliminado');
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

/* ============================================================
   PERÍODOS DE NÓMINA
============================================================ */

async function loadNominaPeriodos() {
  const C = window.SmartecCache;
  const all = await C.wrap('nomina_periodos_all', async () => {
    const s = await getDocs(collection(db, 'nomina_periodos'));
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  const isSuper = currentUserData.role === 'superadmin';
  if (isSuper && currentStore?.storeId === 'all') {
    nominaPeriodos = all.slice();
  } else {
    nominaPeriodos = all.filter(p =>
      p.storeId === currentStore.storeId || p.storeId === 'general'
    );
  }
  nominaPeriodos.sort((a,b) => (b.periodLabel||'').localeCompare(a.periodLabel||''));
}

function renderNomPerStats() {
  const el = $('nom-per-stats');
  if (!el) return;
  const count = nominaPeriodos.length;
  const totalNeto = nominaPeriodos.reduce((s,p) => s + Number(p.totalNeto||0), 0);
  const totalAportes = nominaPeriodos.reduce((s,p) => s + Number(p.totalAportesEmpleador||0), 0);
  const totalCosto = totalNeto + totalAportes;

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Liquidaciones</p>
      <p class="text-xl font-bold text-[#1D1D1F] mt-0.5">${count}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Neto pagado</p>
      <p class="text-xl font-bold text-[#30D158] mt-0.5">${fmt(totalNeto)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Aportes empleador</p>
      <p class="text-xl font-bold text-[#FF9F0A] mt-0.5">${fmt(totalAportes)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Costo total</p>
      <p class="text-xl font-bold text-[#0071E3] mt-0.5">${fmt(totalCosto)}</p>
    </div>
  `;
}

function renderNominaPeriodos() {
  renderNomPerStats();
  const tb = $('nom-per-tbody');
  const empty = $('nom-per-empty');
  if (!tb) return;

  const search = ($('nom-per-search')?.value || '').toLowerCase().trim();
  let list = nominaPeriodos.slice();
  if (search) {
    list = list.filter(p => (p.periodLabel||'').toLowerCase().includes(search));
  }

  const visible = list.slice(0, nomPerVisibleCount);

  if (!list.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    renderNomPerFooter(0, 0);
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = visible.map(p => {
    const typeLabel = p.periodType === 'quincenal' ? '📅 Quincenal' : '📆 Mensual';
    const totalEmp = (p.items || []).length;
    const hasComp = p.comprobanteNumber ? `✓ ${p.comprobanteNumber}` : '—';

    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs font-semibold text-sd">${escapeHtml(p.periodLabel) || '—'}</td>
      <td class="p-3 text-xs">${typeLabel}</td>
      <td class="p-3 text-center text-xs">${totalEmp}</td>
      <td class="p-3 text-right text-xs font-mono">${fmt(p.totalDevengos)}</td>
      <td class="p-3 text-right text-xs font-mono text-red-600">${fmt(p.totalDeducciones)}</td>
      <td class="p-3 text-right text-xs font-mono font-bold text-green-700">${fmt(p.totalNeto)}</td>
      <td class="p-3 text-right text-xs font-mono text-orange-600">${fmt(p.totalAportesEmpleador)}</td>
      <td class="p-3 text-center text-xs font-mono ${p.comprobanteNumber ? 'text-green-600 font-semibold' : 'text-gray-300'}">${hasComp}</td>
      <td class="p-3 text-center">
        <span class="text-[10px] px-2 py-0.5 rounded ${p.status === 'anulado' ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'} font-semibold">
          ${p.status === 'anulado' ? '⚪ Anulado' : '✓ Activo'}
        </span>
      </td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='viewNomPerDetail("${p.id}")' class="text-sl hover:underline text-xs mr-2">Ver</button>
        ${p.status !== 'anulado' ? `
          <button onclick='editNomPer("${p.id}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
          <button onclick='anularNomPer("${p.id}")' class="text-orange-500 hover:underline text-xs">Anular</button>
        ` : '<span class="text-[10px] text-gray-400 italic">Anulado</span>'}
      </td>
    </tr>`;
  }).join('');

  renderNomPerFooter(visible.length, list.length);
}

function renderNomPerFooter(shown, total) {
  let footer = $('nom-per-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'nom-per-footer';
    footer.className = 'flex flex-col items-center justify-center gap-2 py-4';
    const tableWrap = $('nom-per-tbody')?.closest('.glass-strong');
    if (tableWrap) tableWrap.parentNode.insertBefore(footer, tableWrap.nextSibling);
  }
  if (total === 0) { footer.innerHTML = ''; return; }
  const hasMore = shown < total;
  footer.innerHTML = `
    <p class="text-xs text-[#6E6E73]">Mostrando <b>${shown}</b> de <b>${total}</b> liquidaciones</p>
    ${hasMore ? `<button onclick="loadMoreNomPer()" class="btn-glass px-4 py-2 rounded-full text-sm font-semibold">⬇️ Cargar 100 más</button>` : `<p class="text-[10px] text-gray-400">— Fin —</p>`}
  `;
}

window.loadMoreNomPer = () => {
  nomPerVisibleCount += NOM_PAGE_SIZE;
  renderNominaPeriodos();
};

$('nom-per-search')?.addEventListener('input', () => {
  nomPerVisibleCount = NOM_PAGE_SIZE;
  renderNominaPeriodos();
});

/* Sub-tabs switch */
window.switchNomSubtab = (which) => {
  const isEmp = which === 'emp';
  $('nom-sec-emp').classList.toggle('hidden', !isEmp);
  $('nom-sec-per').classList.toggle('hidden', isEmp);

  const btnEmp = $('nom-subtab-emp');
  const btnPer = $('nom-subtab-per');
  const activeCls = ['bg-sd', 'text-white'];
  const inactiveCls = ['text-[#6E6E73]', 'hover:text-[#1D1D1F]'];

  if (isEmp) {
    btnEmp.classList.add(...activeCls); btnEmp.classList.remove(...inactiveCls);
    btnPer.classList.remove(...activeCls); btnPer.classList.add(...inactiveCls);
  } else {
    btnPer.classList.add(...activeCls); btnPer.classList.remove(...inactiveCls);
    btnEmp.classList.remove(...activeCls); btnEmp.classList.add(...inactiveCls);
  }
};

/* ============================================================
   FORMULARIO DE PERÍODO DE NÓMINA
============================================================ */

window.openNomPerForm = async () => {
  if (!canEditPuc()) return;
  if (!pucAccounts.length) await loadPuc();
  if (!empleados.length) await loadEmpleados();
  await loadNominaParams();

  editingNomPerId = null;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  $('nom-per-title').innerText = 'Nueva liquidación de nómina';
  renderNomPerForm({
    periodYear: year,
    periodMonth: month,
    periodType: 'mensual',
    status: 'activo',
    items: []
  });
  const m = $('nom-per-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.editNomPer = async (id) => {
  const p = nominaPeriodos.find(x => x.id === id);
  if (!p) return;
  if (p.status === 'anulado') return alert('No se puede editar una liquidación anulada.');
  if (!canEditPuc()) return;
  if (!pucAccounts.length) await loadPuc();
  if (!empleados.length) await loadEmpleados();
  await loadNominaParams();

  editingNomPerId = id;
  $('nom-per-title').innerText = 'Editar liquidación';
  renderNomPerForm(p);
  const m = $('nom-per-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeNomPerForm = () => {
  const m = $('nom-per-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingNomPerId = null;
};

/* Calcula la nómina de un empleado para un período */
function calcularNominaEmpleado(emp, periodType, diasTrabajados = 30) {
  const salarioBase = Number(emp.baseSalary || 0);
  const diasBase = periodType === 'quincenal' ? 15 : 30;
  const factorDias = diasTrabajados / diasBase;

  const salarioDevengado = Math.round(salarioBase * factorDias);
  const auxilioTransporte = emp.auxilioTransporte ? Math.round(nominaParams.auxilioTransporte * factorDias) : 0;
  const totalDevengos = salarioDevengado + auxilioTransporte;

  // Base de cotización (sin auxilio transporte)
  const baseCotizacion = salarioDevengado;

  // Deducciones empleado
  const saludEmp = Math.round(baseCotizacion * nominaParams.saludEmpleado);
  const pensionEmp = Math.round(baseCotizacion * nominaParams.pensionEmpleado);
  const totalDeducciones = saludEmp + pensionEmp;

  const netoPagar = totalDevengos - totalDeducciones;

  // Aportes empleador
  const saludEmpr = Math.round(baseCotizacion * nominaParams.saludEmpleador);
  const pensionEmpr = Math.round(baseCotizacion * nominaParams.pensionEmpleador);
  const arl = ARL_LEVELS.find(a => a.level === emp.arlLevel) || ARL_LEVELS[0];
  const arlVal = Math.round(baseCotizacion * arl.pct);
  const caja = Math.round(baseCotizacion * nominaParams.cajaCompensacion);
  const sena = Math.round(baseCotizacion * nominaParams.sena);
  const icbf = Math.round(baseCotizacion * nominaParams.icbf);
  const totalAportesEmpleador = saludEmpr + pensionEmpr + arlVal + caja + sena + icbf;

  // Provisiones
  const cesantias = Math.round(salarioDevengado * nominaParams.cesantias);
  const interesesCesantias = Math.round(cesantias * nominaParams.interesesCesantias / 12);
  const prima = Math.round(salarioDevengado * nominaParams.prima);
  const vacaciones = Math.round(salarioDevengado * nominaParams.vacaciones);
  const totalProvisiones = cesantias + interesesCesantias + prima + vacaciones;

  return {
    employeeId: emp.id,
    employeeName: emp.name,
    employeeDoc: emp.documentNumber,
    position: emp.position,
    arlLevel: emp.arlLevel,
    baseSalary: salarioBase,
    diasTrabajados,
    salarioDevengado,
    auxilioTransporte,
    totalDevengos,
    saludEmp,
    pensionEmp,
    totalDeducciones,
    netoPagar,
    saludEmpr,
    pensionEmpr,
    arlVal,
    caja,
    sena,
    icbf,
    totalAportesEmpleador,
    cesantias,
    interesesCesantias,
    prima,
    vacaciones,
    totalProvisiones
  };
}

function renderNomPerForm(v) {
  const yearOpts = [];
  const cy = new Date().getFullYear();
  for (let y = cy - 2; y <= cy + 1; y++) {
    yearOpts.push(`<option value="${y}" ${v.periodYear === y ? 'selected' : ''}>${y}</option>`);
  }

  const monthOpts = MONTH_NAMES.map((n, i) =>
    `<option value="${i+1}" ${v.periodMonth === i+1 ? 'selected' : ''}>${n}</option>`
  ).join('');

  $('nom-per-body').innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div>
        <label class="text-xs font-semibold text-sd">Año *</label>
        <select id="np-year" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm" ${editingNomPerId ? 'disabled' : ''}>
          ${yearOpts.join('')}
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Mes *</label>
        <select id="np-month" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm" ${editingNomPerId ? 'disabled' : ''}>
          ${monthOpts}
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Tipo *</label>
        <select id="np-type" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm" ${editingNomPerId ? 'disabled' : ''}>
          <option value="mensual" ${v.periodType === 'mensual' ? 'selected' : ''}>📆 Mensual</option>
          <option value="quincenal" ${v.periodType === 'quincenal' ? 'selected' : ''}>📅 Quincenal</option>
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Estado</label>
        <select id="np-status" class="w-full px-3 py-2 border rounded-lg mt-1 text-sm">
          <option value="activo" ${(v.status||'activo') === 'activo' ? 'selected' : ''}>✓ Activo</option>
          <option value="anulado" ${v.status === 'anulado' ? 'selected' : ''}>⚪ Anulado</option>
        </select>
      </div>
    </div>

    <div class="flex justify-between items-center mb-2">
      <p class="text-xs font-semibold text-sd">👥 Empleados del período</p>
      <button type="button" onclick="recomputeNomPerItems()" class="text-xs bg-sl text-white px-3 py-1.5 rounded-lg hover:bg-sd font-semibold">🔄 Recalcular</button>
    </div>

    <div id="np-items-container" class="border border-gray-200 rounded-lg overflow-hidden mb-4">
      <!-- Tabla de items renderizada aquí -->
    </div>

    <div id="np-totals" class="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
      <!-- Totales renderizados aquí -->
    </div>

    <label class="text-xs font-semibold text-sd">Notas</label>
    <textarea id="np-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-4 text-sm">${escapeHtml(v.notes) || ''}</textarea>

    <div class="flex gap-3">
      <button onclick="closeNomPerForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveNomPer()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">Guardar</button>
    </div>
  `;

  // Inicializar items
  if (v.items && v.items.length) {
    window.__nomPerItems = v.items.map(it => ({ ...it }));
  } else {
    window.__nomPerItems = [];
    recomputeNomPerItems();
  }
  renderNomPerItems();
}

window.recomputeNomPerItems = () => {
  const year = Number($('np-year')?.value || new Date().getFullYear());
  const month = Number($('np-month')?.value || new Date().getMonth() + 1);
  const periodType = $('np-type')?.value || 'mensual';

  const activeEmps = empleados.filter(e => (e.status||'activo') === 'activo');

  // Mantener días personalizados si el empleado ya estaba en la lista
  const prevMap = new Map();
  (window.__nomPerItems || []).forEach(it => prevMap.set(it.employeeId, it));

  window.__nomPerItems = activeEmps.map(emp => {
    const prev = prevMap.get(emp.id);
    const dias = prev?.diasTrabajados ?? (periodType === 'quincenal' ? 15 : 30);
    const calc = calcularNominaEmpleado(emp, periodType, dias);
    return calc;
  });

  renderNomPerItems();
};

function renderNomPerItems() {
  const container = $('np-items-container');
  if (!container) return;

  const items = window.__nomPerItems || [];
  const periodType = $('np-type')?.value || 'mensual';

  if (!items.length) {
    container.innerHTML = '<p class="text-center text-gray-400 py-4 text-xs">No hay empleados activos</p>';
    renderNomPerTotals();
    return;
  }

  container.innerHTML = `
    <div class="overflow-x-auto scrollbar-thin">
      <table class="w-full text-xs min-w-[1100px]">
        <thead class="bg-gray-50">
          <tr>
            <th class="p-2 text-left text-[10px] uppercase font-bold">Empleado</th>
            <th class="p-2 text-center text-[10px] uppercase font-bold w-[70px]">Días</th>
            <th class="p-2 text-right text-[10px] uppercase font-bold">Devengos</th>
            <th class="p-2 text-right text-[10px] uppercase font-bold">Deducciones</th>
            <th class="p-2 text-right text-[10px] uppercase font-bold">Neto</th>
            <th class="p-2 text-right text-[10px] uppercase font-bold">Aportes</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, i) => `
            <tr class="border-b hover:bg-gray-50">
              <td class="p-2 text-xs">
                <div class="font-semibold text-sd">${escapeHtml(it.employeeName)}</div>
                <div class="text-[10px] text-gray-400">${escapeHtml(it.position)}</div>
              </td>
              <td class="p-2 text-center">
                <input type="number" min="0" max="30" value="${it.diasTrabajados}" class="w-14 px-1 py-1 border rounded text-xs text-center font-mono" onchange="updateNomPerItemDays(${i}, this.value)">
              </td>
              <td class="p-2 text-right font-mono">${fmt(it.totalDevengos)}</td>
              <td class="p-2 text-right font-mono text-red-600">${fmt(it.totalDeducciones)}</td>
              <td class="p-2 text-right font-mono font-bold text-green-700">${fmt(it.netoPagar)}</td>
              <td class="p-2 text-right font-mono text-orange-600">${fmt(it.totalAportesEmpleador)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  renderNomPerTotals();
}

window.updateNomPerItemDays = (idx, value) => {
  if (!window.__nomPerItems || !window.__nomPerItems[idx]) return;
  const item = window.__nomPerItems[idx];
  const emp = empleados.find(e => e.id === item.employeeId);
  if (!emp) return;

  const dias = Math.max(0, Math.min(30, Number(value) || 0));
  const periodType = $('np-type')?.value || 'mensual';
  const calc = calcularNominaEmpleado(emp, periodType, dias);
  window.__nomPerItems[idx] = calc;

  renderNomPerItems();
};

function renderNomPerTotals() {
  const el = $('np-totals');
  if (!el) return;

  const items = window.__nomPerItems || [];
  const t = items.reduce((acc, it) => ({
    devengos: acc.devengos + it.totalDevengos,
    deducciones: acc.deducciones + it.totalDeducciones,
    neto: acc.neto + it.netoPagar,
    saludEmpr: acc.saludEmpr + it.saludEmpr,
    pensionEmpr: acc.pensionEmpr + it.pensionEmpr,
    arl: acc.arl + it.arlVal,
    caja: acc.caja + it.caja,
    sena: acc.sena + it.sena,
    icbf: acc.icbf + it.icbf,
    aportes: acc.aportes + it.totalAportesEmpleador,
    cesantias: acc.cesantias + it.cesantias,
    intereses: acc.intereses + it.interesesCesantias,
    prima: acc.prima + it.prima,
    vacaciones: acc.vacaciones + it.vacaciones,
    provisiones: acc.provisiones + it.totalProvisiones
  }), { devengos:0, deducciones:0, neto:0, saludEmpr:0, pensionEmpr:0, arl:0, caja:0, sena:0, icbf:0, aportes:0, cesantias:0, intereses:0, prima:0, vacaciones:0, provisiones:0 });

  el.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
      <div class="bg-white rounded p-2 border">
        <p class="text-[10px] text-gray-500">Total devengos</p>
        <p class="font-mono font-bold text-sd">${fmt(t.devengos)}</p>
      </div>
      <div class="bg-white rounded p-2 border">
        <p class="text-[10px] text-gray-500">Total deducciones</p>
        <p class="font-mono font-bold text-red-600">${fmt(t.deducciones)}</p>
      </div>
      <div class="bg-white rounded p-2 border">
        <p class="text-[10px] text-gray-500">Neto a pagar</p>
        <p class="font-mono font-bold text-green-700">${fmt(t.neto)}</p>
      </div>
      <div class="bg-white rounded p-2 border">
        <p class="text-[10px] text-gray-500">Aportes empleador</p>
        <p class="font-mono font-bold text-orange-600">${fmt(t.aportes)}</p>
      </div>
    </div>
    <details class="text-xs">
      <summary class="cursor-pointer text-gray-500 hover:text-gray-700 font-semibold">📊 Ver desglose</summary>
      <div class="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
        <div class="flex justify-between"><span>Salud empleador (8.5%)</span><span class="font-mono">${fmt(t.saludEmpr)}</span></div>
        <div class="flex justify-between"><span>Pensión empleador (12%)</span><span class="font-mono">${fmt(t.pensionEmpr)}</span></div>
        <div class="flex justify-between"><span>ARL</span><span class="font-mono">${fmt(t.arl)}</span></div>
        <div class="flex justify-between"><span>Caja compensación (4%)</span><span class="font-mono">${fmt(t.caja)}</span></div>
        <div class="flex justify-between"><span>SENA (2%)</span><span class="font-mono">${fmt(t.sena)}</span></div>
        <div class="flex justify-between"><span>ICBF (3%)</span><span class="font-mono">${fmt(t.icbf)}</span></div>
        <div class="flex justify-between border-t pt-1 col-span-full mt-1"><span class="font-semibold">Provisiones</span><span class="font-mono font-bold">${fmt(t.provisiones)}</span></div>
        <div class="flex justify-between"><span>Cesantías (8.33%)</span><span class="font-mono">${fmt(t.cesantias)}</span></div>
        <div class="flex justify-between"><span>Intereses cesantías</span><span class="font-mono">${fmt(t.intereses)}</span></div>
        <div class="flex justify-between"><span>Prima (8.33%)</span><span class="font-mono">${fmt(t.prima)}</span></div>
        <div class="flex justify-between"><span>Vacaciones (4.17%)</span><span class="font-mono">${fmt(t.vacaciones)}</span></div>
      </div>
    </details>
  `;
}

window.saveNomPer = async () => {
  const year = Number($('np-year').value);
  const month = Number($('np-month').value);
  const periodType = $('np-type').value;
  const status = $('np-status').value;
  const notes = $('np-notes').value.trim();
  const items = window.__nomPerItems || [];

  if (!items.length) return alert('No hay empleados activos para liquidar');

  // Validar duplicado
  if (!editingNomPerId) {
    const exists = nominaPeriodos.find(p =>
      p.periodYear === year && p.periodMonth === month &&
      p.periodType === periodType && p.storeId === currentStore.storeId
    );
    if (exists) return alert('Ya existe una liquidación para ese período y tipo en esta tienda.');
  }

  const totals = items.reduce((acc, it) => ({
    devengos: acc.devengos + it.totalDevengos,
    deducciones: acc.deducciones + it.totalDeducciones,
    neto: acc.neto + it.netoPagar,
    aportes: acc.aportes + it.totalAportesEmpleador,
    provisiones: acc.provisiones + it.totalProvisiones
  }), { devengos:0, deducciones:0, neto:0, aportes:0, provisiones:0 });

  const periodLabel = `${MONTH_NAMES[month-1]} ${year}${periodType === 'quincenal' ? ' (Q)' : ''}`;

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Guardando...';

  try {
    const data = {
      periodYear: year,
      periodMonth: month,
      periodType,
      periodLabel,
      items: items.map(it => ({ ...it })),
      totalDevengos: totals.devengos,
      totalDeducciones: totals.deducciones,
      totalNeto: totals.neto,
      totalAportesEmpleador: totals.aportes,
      totalProvisiones: totals.provisiones,
      paramsUsed: { ...nominaParams },
      status,
      notes,
      storeId: currentStore.storeId,
      storeName: currentStore.name,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };

    let savedId = editingNomPerId;

    if (editingNomPerId) {
      const prev = nominaPeriodos.find(p => p.id === editingNomPerId);
      await updateDoc(doc(db, 'nomina_periodos', editingNomPerId), data);
      await audit({
        action: 'update', collection: 'nomina_periodos', docId: editingNomPerId,
        before: prev, after: data,
        note: `Nómina editada: ${periodLabel} · Neto: ${fmt(totals.neto)}`
      });
    } else {
      data.createdAt = serverTimestamp();
      data.createdBy = currentUser.email;
      const ref = await addDoc(collection(db, 'nomina_periodos'), data);
      savedId = ref.id;
      await audit({
        action: 'create', collection: 'nomina_periodos', docId: ref.id,
        after: data,
        note: `Nómina creada: ${periodLabel} · ${items.length} empleados · Neto: ${fmt(totals.neto)}`
      });
    }

    window.SmartecCache.invalidate('nomina_periodos_all');
    await loadNominaPeriodos();
    renderNominaPeriodos();
    closeNomPerForm();
    alert(`✅ Nómina guardada\n\nNeto a pagar: ${fmt(totals.neto)}\nEmpleados: ${items.length}`);
  } catch (e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = 'Guardar';
  }
};

/* Anular */
window.anularNomPer = async (id) => {
  const p = nominaPeriodos.find(x => x.id === id);
  if (!p) return;
  if (p.status === 'anulado') return alert('Ya está anulada.');

  const motivo = prompt(`Anular la liquidación "${p.periodLabel}"\n\nMotivo (obligatorio):`);
  if (!motivo || !motivo.trim()) return;

  try {
    await updateDoc(doc(db, 'nomina_periodos', id), {
      status: 'anulado',
      anuladoPor: currentUser.email,
      anuladoAt: serverTimestamp(),
      motivoAnulacion: motivo.trim(),
      updatedAt: serverTimestamp()
    });
    await audit({
      action: 'update', collection: 'nomina_periodos', docId: id,
      before: { status: p.status },
      after: { status: 'anulado', motivoAnulacion: motivo.trim() },
      note: `Nómina anulada: ${p.periodLabel}`
    });
    window.SmartecCache.invalidate('nomina_periodos_all');
    await loadNominaPeriodos();
    renderNominaPeriodos();
    alert('✅ Liquidación anulada');
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

/* Detalle */
window.viewNomPerDetail = (id) => {
  const p = nominaPeriodos.find(x => x.id === id);
  if (!p) return;
  const items = p.items || [];

  const rowsHtml = items.map(it => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 text-xs">
        <div class="font-semibold text-sd">${escapeHtml(it.employeeName)}</div>
        <div class="text-[10px] text-gray-400">${escapeHtml(it.position)} · ${escapeHtml(it.employeeDoc)}</div>
      </td>
      <td class="p-2 text-center text-xs">${it.diasTrabajados}</td>
      <td class="p-2 text-right font-mono text-xs">${fmt(it.salarioDevengado)}</td>
      <td class="p-2 text-right font-mono text-xs">${fmt(it.auxilioTransporte)}</td>
      <td class="p-2 text-right font-mono text-xs text-red-600">${fmt(it.saludEmp)}</td>
      <td class="p-2 text-right font-mono text-xs text-red-600">${fmt(it.pensionEmp)}</td>
      <td class="p-2 text-right font-mono text-xs font-bold text-green-700">${fmt(it.netoPagar)}</td>
      <td class="p-2 text-center">
        <button onclick='viewNomColilla("${p.id}", "${it.employeeId}")' class="text-sl hover:underline text-[10px]">Ver colilla</button>
      </td>
    </tr>
  `).join('');

  $('nom-per-detail-body').innerHTML = `
    <div class="flex justify-between items-start mb-4">
      <div>
        <p class="text-xs text-gray-400">${p.periodType === 'quincenal' ? '📅 Quincenal' : '📆 Mensual'}</p>
        <p class="text-lg font-bold text-sd">${escapeHtml(p.periodLabel)}</p>
        <p class="text-xs text-gray-500">${items.length} empleados</p>
      </div>
      <span class="text-[10px] px-2 py-0.5 rounded ${p.status === 'anulado' ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'} font-semibold">
        ${p.status === 'anulado' ? '⚪ Anulado' : '✓ Activo'}
      </span>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
      <div class="bg-blue-50 rounded-lg p-3">
        <p class="text-[10px] text-blue-600">Total devengos</p>
        <p class="font-bold text-blue-700 font-mono">${fmt(p.totalDevengos)}</p>
      </div>
      <div class="bg-red-50 rounded-lg p-3">
        <p class="text-[10px] text-red-600">Total deducciones</p>
        <p class="font-bold text-red-700 font-mono">${fmt(p.totalDeducciones)}</p>
      </div>
      <div class="bg-green-50 rounded-lg p-3">
        <p class="text-[10px] text-green-600">Neto pagado</p>
        <p class="font-bold text-green-700 font-mono">${fmt(p.totalNeto)}</p>
      </div>
      <div class="bg-orange-50 rounded-lg p-3">
        <p class="text-[10px] text-orange-600">Aportes empleador</p>
        <p class="font-bold text-orange-700 font-mono">${fmt(p.totalAportesEmpleador)}</p>
      </div>
    </div>

    <div class="border border-gray-200 rounded-lg overflow-hidden mb-4">
      <div class="overflow-x-auto">
        <table class="w-full text-xs min-w-[900px]">
          <thead class="bg-gray-50">
            <tr>
              <th class="p-2 text-left text-[10px] uppercase font-bold">Empleado</th>
              <th class="p-2 text-center text-[10px] uppercase font-bold w-[50px]">Días</th>
              <th class="p-2 text-right text-[10px] uppercase font-bold">Salario</th>
              <th class="p-2 text-right text-[10px] uppercase font-bold">Auxilio</th>
              <th class="p-2 text-right text-[10px] uppercase font-bold">Salud</th>
              <th class="p-2 text-right text-[10px] uppercase font-bold">Pensión</th>
              <th class="p-2 text-right text-[10px] uppercase font-bold">Neto</th>
              <th class="p-2 text-center text-[10px] uppercase font-bold"></th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>

    ${p.notes ? `<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm mb-4"><p class="text-xs text-yellow-700 font-semibold mb-1">Notas</p><p>${escapeHtml(p.notes)}</p></div>` : ''}

    ${p.status === 'anulado' ? `
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
        <p class="font-bold text-red-700 mb-1">Liquidación anulada</p>
        <p class="text-xs text-red-600">Motivo: ${escapeHtml(p.motivoAnulacion) || '-'}</p>
      </div>
    ` : ''}
  `;

  const m = $('nom-per-detail-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeNomPerDetail = () => {
  const m = $('nom-per-detail-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

/* Colilla */
window.viewNomColilla = (periodId, empId) => {
  const p = nominaPeriodos.find(x => x.id === periodId);
  if (!p) return;
  const it = (p.items || []).find(i => i.employeeId === empId);
  if (!it) return;

  $('nom-colilla-body').innerHTML = `
    <div class="text-center mb-4 pb-4 border-b">
      <p class="text-lg font-bold text-sd">SMARTEC</p>
      <p class="text-xs text-gray-500">Colilla de pago · ${escapeHtml(p.periodLabel)}</p>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-4 text-xs">
      <div><p class="text-gray-400">Empleado</p><p class="font-semibold">${escapeHtml(it.employeeName)}</p></div>
      <div><p class="text-gray-400">Cédula</p><p class="font-semibold font-mono">${escapeHtml(it.employeeDoc)}</p></div>
      <div><p class="text-gray-400">Cargo</p><p class="font-semibold">${escapeHtml(it.position)}</p></div>
      <div><p class="text-gray-400">Días trabajados</p><p class="font-semibold">${it.diasTrabajados}</p></div>
    </div>

    <div class="grid grid-cols-2 gap-4 mb-4">
      <div>
        <p class="text-xs font-bold text-green-700 mb-2">DEVENGOS</p>
        <div class="space-y-1 text-xs">
          <div class="flex justify-between"><span>Salario básico</span><span class="font-mono">${fmt(it.salarioDevengado)}</span></div>
          ${it.auxilioTransporte > 0 ? `<div class="flex justify-between"><span>Auxilio transporte</span><span class="font-mono">${fmt(it.auxilioTransporte)}</span></div>` : ''}
          <div class="flex justify-between border-t pt-1 font-bold"><span>TOTAL</span><span class="font-mono">${fmt(it.totalDevengos)}</span></div>
        </div>
      </div>
      <div>
        <p class="text-xs font-bold text-red-700 mb-2">DEDUCCIONES</p>
        <div class="space-y-1 text-xs">
          <div class="flex justify-between"><span>Salud (4%)</span><span class="font-mono">${fmt(it.saludEmp)}</span></div>
          <div class="flex justify-between"><span>Pensión (4%)</span><span class="font-mono">${fmt(it.pensionEmp)}</span></div>
          <div class="flex justify-between border-t pt-1 font-bold"><span>TOTAL</span><span class="font-mono">${fmt(it.totalDeducciones)}</span></div>
        </div>
      </div>
    </div>

    <div class="bg-green-50 border-2 border-green-300 rounded-lg p-4 mb-4">
      <div class="flex justify-between items-center">
        <span class="text-sm font-bold text-green-800">NETO A PAGAR</span>
        <span class="text-2xl font-bold font-mono text-green-800">${fmt(it.netoPagar)}</span>
      </div>
    </div>

    <div class="bg-gray-50 rounded-lg p-3 text-xs">
      <p class="font-semibold text-gray-700 mb-2">Aportes del empleador (informativo)</p>
      <div class="grid grid-cols-2 gap-1">
        <div class="flex justify-between"><span>Salud</span><span class="font-mono">${fmt(it.saludEmpr)}</span></div>
        <div class="flex justify-between"><span>Pensión</span><span class="font-mono">${fmt(it.pensionEmpr)}</span></div>
        <div class="flex justify-between"><span>ARL (Nivel ${it.arlLevel})</span><span class="font-mono">${fmt(it.arlVal)}</span></div>
        <div class="flex justify-between"><span>Caja compensación</span><span class="font-mono">${fmt(it.caja)}</span></div>
        <div class="flex justify-between"><span>SENA</span><span class="font-mono">${fmt(it.sena)}</span></div>
        <div class="flex justify-between"><span>ICBF</span><span class="font-mono">${fmt(it.icbf)}</span></div>
      </div>
    </div>

    <div class="mt-4 pt-4 border-t text-center text-xs text-gray-400">
      Generado: ${new Date().toLocaleString('es-CO')}
    </div>
  `;

  const m = $('nom-colilla-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeNomColilla = () => {
  const m = $('nom-colilla-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

/* ============================================================
   LIBROS AUXILIARES
============================================================ */

let auxData = {
  accountCode: null,
  accountName: null,
  openingD: 0,
  openingC: 0,
  openingBalance: 0,
  movements: [],
  thirdParties: [],
  totalD: 0,
  totalC: 0,
  finalBalance: 0
};

/* Poblar selector de cuentas con las que aceptan movimiento */
function populateAuxAccountSelect() {
  const sel = $('aux-account');
  if (!sel) return;
  const movable = pucAccounts
    .filter(a => a.acceptsMovement && a.active !== false)
    .sort((a,b) => a.code.localeCompare(b.code));

  sel.innerHTML = '<option value="">— Selecciona una cuenta —</option>' +
    movable.map(a => `<option value="${a.code}">${a.code} · ${escapeHtml(a.name)}</option>`).join('');
}

/* Filtrar las opciones del select según el texto del buscador */
window.filterAuxAccounts = () => {
  const term = ($('aux-account-search')?.value || '').toLowerCase().trim();
  const sel = $('aux-account');
  if (!sel) return;

  const movable = pucAccounts
    .filter(a => a.acceptsMovement && a.active !== false)
    .filter(a => !term || a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term))
    .sort((a,b) => a.code.localeCompare(b.code));

  const currentVal = sel.value;
  sel.innerHTML = '<option value="">— Selecciona una cuenta —</option>' +
    movable.map(a => `<option value="${a.code}" ${currentVal === a.code ? 'selected' : ''}>${a.code} · ${escapeHtml(a.name)}</option>`).join('');
};

/* Calcular el auxiliar */
function computeAux() {
  const accountCode = $('aux-account')?.value || '';
  const from = $('aux-date-from')?.value || '';
  const to = $('aux-date-to')?.value || '';
  const search = ($('aux-search')?.value || '').toLowerCase().trim();

  if (!accountCode || !from || !to || from > to) {
    auxData = {
      accountCode: null, accountName: null,
      openingD: 0, openingC: 0, openingBalance: 0,
      movements: [], thirdParties: [], totalD: 0, totalC: 0, finalBalance: 0
    };
    return;
  }

  const pucAcc = pucAccounts.find(a => a.code === accountCode);
  if (!pucAcc) return;

  const isSuper = currentUserData.role === 'superadmin';
  const isAllStores = isSuper && currentStore?.storeId === 'all';

  const compsForStore = comprobantes.filter(c => {
    if (c.status === 'anulado') return false;
    if (isAllStores) return true;
    return c.storeId === currentStore.storeId || c.storeId === 'general';
  });

  let openingD = 0, openingC = 0;
  let totalD = 0, totalC = 0;
  const movements = [];

  compsForStore.forEach(comp => {
    (comp.items || []).forEach((it, idx) => {
      if (it.accountCode !== accountCode) return;
      const amt = Number(it.amount || 0);

      // Saldo inicial: comprobantes anteriores al rango
      if (comp.date < from) {
        if (it.type === 'D') openingD += amt;
        else openingC += amt;
        return;
      }
      // Fuera del rango (posterior)
      if (comp.date > to) return;

      // Buscar filtro de texto
      if (search) {
        const haystack = `${comp.concept||''} ${comp.number||''} ${it.note||''}`.toLowerCase();
        if (!haystack.includes(search)) return;
      }

      // Es movimiento en el rango
      if (it.type === 'D') totalD += amt;
      else totalC += amt;

      movements.push({
        date: comp.date,
        compId: comp.id,
        compNumber: comp.number,
        compType: comp.type,
        concept: comp.concept,
        note: it.note || '',
        type: it.type,
        amount: amt,
        // Tercero (si existe)
        thirdParty: comp.clientName || comp.supplierName || it.thirdPartyName || null,
        thirdPartyDoc: comp.clientNit || comp.supplierNit || it.thirdPartyDoc || null
      });
    });
  });

  // Saldo inicial según naturaleza
  let openingBalance = 0;
  if (pucAcc.nature === 'D') openingBalance = openingD - openingC;
  else openingBalance = openingC - openingD;

  // Saldo final
  let finalBalance = 0;
  if (pucAcc.nature === 'D') finalBalance = openingBalance + totalD - totalC;
  else finalBalance = openingBalance + totalC - totalD;

  // Agrupar por tercero
  const tpMap = new Map();
  movements.forEach(m => {
    const key = m.thirdParty || '__none__';
    if (!tpMap.has(key)) {
      tpMap.set(key, {
        name: m.thirdParty || '— Sin tercero —',
        doc: m.thirdPartyDoc || '',
        totalD: 0,
        totalC: 0,
        count: 0
      });
    }
    const t = tpMap.get(key);
    if (m.type === 'D') t.totalD += m.amount;
    else t.totalC += m.amount;
    t.count++;
  });

  const thirdParties = Array.from(tpMap.values()).sort((a,b) => (a.name||'').localeCompare(b.name||''));

  auxData = {
    accountCode,
    accountName: pucAcc.name,
    accountNature: pucAcc.nature,
    openingD, openingC, openingBalance,
    movements: movements.sort((a,b) => (a.date||'').localeCompare(b.date||'')),
    thirdParties,
    totalD, totalC, finalBalance
  };
}

/* Render info de la cuenta seleccionada */
function renderAuxAccountInfo() {
  const el = $('aux-account-info');
  if (!el) return;
  if (!auxData.accountCode) {
    el.innerHTML = '';
    return;
  }
  const natureLabel = auxData.accountNature === 'D' ? 'Débito' : 'Crédito';
  el.innerHTML = `
    <div class="bg-blue-50 border-l-4 border-blue-500 rounded-lg p-3">
      <p class="text-[10px] text-blue-600 font-mono">${escapeHtml(auxData.accountCode)}</p>
      <p class="text-sm font-bold text-blue-800">${escapeHtml(auxData.accountName)}</p>
      <p class="text-[10px] text-blue-600 mt-0.5">Naturaleza: ${natureLabel}</p>
    </div>
  `;
}

/* Render stats */
function renderAuxStats() {
  const el = $('aux-stats');
  if (!el) return;
  const d = auxData;
  const finalColor = d.finalBalance === 0 ? 'text-gray-400'
                    : d.accountNature === 'D'
                      ? (d.finalBalance > 0 ? 'text-blue-700' : 'text-red-600')
                      : (d.finalBalance > 0 ? 'text-purple-700' : 'text-red-600');

  el.innerHTML = `
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Saldo inicial</p>
      <p class="text-xl font-bold text-gray-700 mt-0.5">${fmt(d.openingBalance)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Débitos del período</p>
      <p class="text-xl font-bold text-blue-600 mt-0.5">${fmt(d.totalD)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Créditos del período</p>
      <p class="text-xl font-bold text-purple-600 mt-0.5">${fmt(d.totalC)}</p>
    </div>
    <div class="glass-strong rounded-2xl p-4 border border-white/60">
      <p class="text-[10px] text-[#6E6E73] font-medium">Saldo final</p>
      <p class="text-xl font-bold ${finalColor} mt-0.5">${fmt(d.finalBalance)}</p>
    </div>
  `;
}

/* Render del contenido (tabla) */
function renderAuxContent() {
  const el = $('aux-content');
  if (!el) return;

  if (!auxData.accountCode) {
    el.innerHTML = '<p class="text-center py-8 text-[#6E6E73]">Selecciona una cuenta y un rango de fechas para ver el auxiliar.</p>';
    return;
  }

  const view = $('aux-view')?.value || 'movements';

  if (view === 'movements') {
    renderAuxMovements(el);
  } else {
    renderAuxThirdParties(el);
  }
}

function renderAuxMovements(el) {
  const movements = auxData.movements;

  if (!movements.length) {
    el.innerHTML = '<p class="text-center py-8 text-[#6E6E73]">Sin movimientos en el período seleccionado.</p>';
    return;
  }

  const rows = movements.map(m => `
    <tr class="border-b hover:bg-gray-50 cursor-pointer" onclick="viewCompFromAux('${m.compId}')">
      <td class="p-3 text-xs text-gray-600 whitespace-nowrap">${m.date}</td>
      <td class="p-3 text-xs font-mono">${escapeHtml(m.compNumber) || '—'}</td>
      <td class="p-3 text-xs max-w-md truncate">${escapeHtml(m.concept) || '—'}</td>
      <td class="p-3 text-xs">${escapeHtml(m.thirdParty) || '—'}</td>
      <td class="p-3 text-xs text-gray-500">${escapeHtml(m.note) || ''}</td>
      <td class="p-3 text-center">
        <span class="text-[10px] px-2 py-0.5 rounded ${m.type === 'D' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'} font-semibold">${m.type}</span>
      </td>
      <td class="p-3 text-right text-xs font-mono font-bold">${fmt(m.amount)}</td>
    </tr>
  `).join('');

  el.innerHTML = `
    <div class="glass-strong rounded-2xl shadow-apple-lg overflow-hidden border border-white/60">
      <div class="overflow-x-auto scrollbar-thin">
        <table class="w-full text-sm min-w-[900px]">
          <thead class="bg-white/50 text-[#1D1D1F] backdrop-blur">
            <tr>
              <th class="p-3 text-left text-[10px] uppercase tracking-wider font-bold">Fecha</th>
              <th class="p-3 text-left text-[10px] uppercase tracking-wider font-bold">Comprobante</th>
              <th class="p-3 text-left text-[10px] uppercase tracking-wider font-bold">Concepto</th>
              <th class="p-3 text-left text-[10px] uppercase tracking-wider font-bold">Tercero</th>
              <th class="p-3 text-left text-[10px] uppercase tracking-wider font-bold">Nota</th>
              <th class="p-3 text-center text-[10px] uppercase tracking-wider font-bold">Tipo</th>
              <th class="p-3 text-right text-[10px] uppercase tracking-wider font-bold">Valor</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot class="bg-gray-100 border-t-2 border-gray-300">
            <tr>
              <td colspan="6" class="p-3 text-right font-bold text-sd text-xs uppercase">Totales del período</td>
              <td class="p-3 text-right text-sm">
                <div class="text-[10px] text-blue-600 font-semibold">D: <b>${fmt(auxData.totalD)}</b></div>
                <div class="text-[10px] text-purple-600 font-semibold">C: <b>${fmt(auxData.totalC)}</b></div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    <p class="text-[10px] text-gray-400 mt-2 text-center">Click en una fila para ver el comprobante completo.</p>
  `;
}

function renderAuxThirdParties(el) {
  const tps = auxData.thirdParties;

  if (!tps.length) {
    el.innerHTML = '<p class="text-center py-8 text-[#6E6E73]">Sin terceros en el período seleccionado.</p>';
    return;
  }

  const rows = tps.map(t => {
    const net = t.totalD - t.totalC;
    const netColor = net === 0 ? 'text-gray-400' : net > 0 ? 'text-blue-700' : 'text-purple-700';
    return `<tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-xs font-semibold text-sd">${escapeHtml(t.name)}</td>
      <td class="p-3 text-xs font-mono">${escapeHtml(t.doc) || '—'}</td>
      <td class="p-3 text-center text-xs">${t.count}</td>
      <td class="p-3 text-right text-xs font-mono text-blue-600">${fmt(t.totalD)}</td>
      <td class="p-3 text-right text-xs font-mono text-purple-600">${fmt(t.totalC)}</td>
      <td class="p-3 text-right text-xs font-mono font-bold ${netColor}">${fmt(net)}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="glass-strong rounded-2xl shadow-apple-lg overflow-hidden border border-white/60">
      <div class="overflow-x-auto scrollbar-thin">
        <table class="w-full text-sm min-w-[800px]">
          <thead class="bg-white/50 text-[#1D1D1F] backdrop-blur">
            <tr>
              <th class="p-3 text-left text-[10px] uppercase tracking-wider font-bold">Tercero</th>
              <th class="p-3 text-left text-[10px] uppercase tracking-wider font-bold">NIT/Cédula</th>
              <th class="p-3 text-center text-[10px] uppercase tracking-wider font-bold">Movs.</th>
              <th class="p-3 text-right text-[10px] uppercase tracking-wider font-bold">Débitos</th>
              <th class="p-3 text-right text-[10px] uppercase tracking-wider font-bold">Créditos</th>
              <th class="p-3 text-right text-[10px] uppercase tracking-wider font-bold">Neto</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

/* Ver comprobante desde el auxiliar */
window.viewCompFromAux = (compId) => {
  const comp = comprobantes.find(c => c.id === compId);
  if (!comp) return alert('Comprobante no encontrado. Recarga la página.');
  viewCompDetail(compId);
};

/* ============================================================
   RANGOS Y FILTROS
============================================================ */

window.setAuxRange = (range) => {
  const now = new Date();
  const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let from, to;
  if (range === 'today') { from = to = now; }
  else if (range === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = now; }
  else if (range === 'lastmonth') {
    from = new Date(now.getFullYear(), now.getMonth()-1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0);
  }
  else if (range === 'year') { from = new Date(now.getFullYear(), 0, 1); to = now; }
  else return;
  $('aux-date-from').value = fmtD(from);
  $('aux-date-to').value = fmtD(to);
  renderAux();
};

window.clearAuxFilters = () => {
  $('aux-account-search').value = '';
  $('aux-account').value = '';
  $('aux-date-from').value = '';
  $('aux-date-to').value = '';
  $('aux-view').value = 'movements';
  $('aux-search').value = '';
  filterAuxAccounts();
  renderAux();
};

/* Render principal */
function renderAux() {
  computeAux();
  renderAuxAccountInfo();
  renderAuxStats();
  renderAuxContent();
}

/* Event listeners */
function attachAuxListeners() {
  const search = $('aux-account-search');
  if (search) {
    search.addEventListener('input', filterAuxAccounts);
  }
  ['aux-account','aux-date-from','aux-date-to','aux-view','aux-search'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', renderAux);
      el.addEventListener('change', renderAux);
    }
  });
}

document.addEventListener('DOMContentLoaded', attachAuxListeners);
if ($('aux-account')) attachAuxListeners();

/* ============================================================
   EXPORTAR PDF
============================================================ */

window.exportAuxPDF = async () => {
  if (!auxData.accountCode) return alert('Selecciona una cuenta primero.');
  if (!auxData.movements.length && auxData.openingBalance === 0 && auxData.finalBalance === 0) {
    return alert('Sin datos para exportar.');
  }

  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Libro Auxiliar', 14, 13);

  y = 28;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  doc.text(`Cuenta: ${auxData.accountCode} · ${auxData.accountName}`, 14, y); y += 5;
  doc.text(`Período: ${$('aux-date-from').value} — ${$('aux-date-to').value}`, 14, y); y += 5;
  const storeLabel = currentStore?.storeId === 'all' ? 'Todas las tiendas' : (currentStore?.name || 'General');
  doc.text(`Tienda: ${storeLabel}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  // Totales
  const d = auxData;
  doc.setFillColor(240, 240, 240);
  doc.rect(14, y, pageW - 28, 18, 'F');
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(10, 42, 74);
  doc.text('RESUMEN', 18, y + 6);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 60);
  doc.text(`Saldo inicial: $${d.openingBalance.toLocaleString('es-CO')}`, 18, y + 11);
  doc.text(`Débitos: $${d.totalD.toLocaleString('es-CO')}`, 70, y + 11);
  doc.text(`Créditos: $${d.totalC.toLocaleString('es-CO')}`, 115, y + 11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Saldo final: $${d.finalBalance.toLocaleString('es-CO')}`, 165, y + 11);
  y += 22;

  // Tabla de movimientos
  const rows = d.movements.map(m => [
    m.date,
    m.compNumber || '',
    (m.concept || '').substring(0, 40),
    (m.thirdParty || '').substring(0, 20),
    m.type,
    '$' + m.amount.toLocaleString('es-CO')
  ]);

  doc.autoTable({
    startY: y,
    head: [['Fecha','Nº','Concepto','Tercero','D/C','Valor']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 22 },
      2: { cellWidth: 60 },
      3: { cellWidth: 35 },
      4: { cellWidth: 12, halign: 'center' },
      5: { halign: 'right', cellWidth: 30, fontStyle: 'bold' }
    }
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Smartec · Auxiliar ${auxData.accountCode} · Página ${i} de ${pages}`, pageW / 2, pageH - 8, { align: 'center' });
  }
  doc.save(`smartec_auxiliar_${auxData.accountCode}_${new Date().toISOString().split('T')[0]}.pdf`);
};

/* ============================================================
   RENDER PROVEEDORES
============================================================ */
function renderSuppliers() {
  const tb = $('suppliers-tbody');
  const empty = $('suppliers-empty');
  const term = ($('sup-search')?.value || '').toLowerCase().trim();

  let list = suppliers.slice();
  if (term) {
    list = list.filter(s =>
      (s.name||'').toLowerCase().includes(term) ||
      (s.nit||'').toLowerCase().includes(term) ||
      (s.email||'').toLowerCase().includes(term)
    );
  }

  if (!list.length) {
    tb.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tb.innerHTML = list.map(s => {
    const terms = PAYMENT_TERMS.find(t => t.slug === s.defaultPaymentTerms);
    let termsLabel;
    if (s.defaultPaymentTerms === 'custom' && s.customTermsDays) {
      termsLabel = `Personalizado (${s.customTermsDays} días)`;
    } else {
      termsLabel = terms ? terms.label : (s.defaultPaymentTerms || '—');
    }
    const alertDays = Number(s.defaultAlertDaysBefore ?? conSettings.defaultAlertDays);

    return `<tr class="border-b hover:bg-gray-50 ${s.active === false ? 'opacity-60' : ''}">
      <td class="p-3 text-xs font-semibold text-sd">${escapeHtml(s.name)}</td>
      <td class="p-3 text-xs font-mono">${escapeHtml(s.nit) || '—'}</td>
      <td class="p-3 text-xs">
        ${s.phone ? `📞 ${escapeHtml(s.phone)}<br>` : ''}
        ${s.email ? `✉️ ${escapeHtml(s.email)}<br>` : ''}
        ${s.contactName ? `👤 ${escapeHtml(s.contactName)}` : ''}
      </td>
      <td class="p-3 text-center text-xs">${termsLabel}</td>
      <td class="p-3 text-center text-xs">${alertDays} días</td>
      <td class="p-3 text-center">
        <span class="text-[10px] px-2 py-0.5 rounded ${s.active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'} font-semibold">
          ${s.active !== false ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td class="p-3 text-right whitespace-nowrap">
        <button onclick='editSupplier("${s.id}")' class="text-sl hover:underline text-xs mr-2">Editar</button>
        <button onclick='toggleSupplier("${s.id}")' class="text-${s.active !== false ? 'orange' : 'green'}-500 hover:underline text-xs mr-2">${s.active !== false ? 'Desactivar' : 'Activar'}</button>
        <button onclick='deleteSupplier("${s.id}")' class="text-red-500 hover:underline text-xs">Eliminar</button>
      </td>
    </tr>`;
  }).join('');
}

$('sup-search')?.addEventListener('input', renderSuppliers);

/* ============================================================
   RENDER CONFIG TAB
============================================================ */
function renderSettingsTab() {
  $('cfg-default-terms').value = conSettings.defaultTermsDays;
  $('cfg-default-alert').value = conSettings.defaultAlertDays;
}

$('save-settings-btn').onclick = async () => {
  const termsDays = Number($('cfg-default-terms').value) || 30;
  const alertDays = Number($('cfg-default-alert').value) || 5;

  try {
    await setDoc(doc(db, 'settings', 'accounting'), {
      defaultTermsDays: termsDays,
      defaultAlertDays: alertDays,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    }, { merge: true });

    conSettings.defaultTermsDays = termsDays;
    conSettings.defaultAlertDays = alertDays;

    await audit({
      action: 'update',
      collection: 'settings',
      docId: 'accounting',
      after: { defaultTermsDays: termsDays, defaultAlertDays: alertDays },
      note: `Config contable actualizada: vencimiento ${termsDays}d · alerta ${alertDays}d`
    });

    window.SmartecCache.invalidate('settings_accounting');
    renderAlerts();
    alert('✅ Configuración guardada');
  } catch(e) {
    alert('Error: ' + e.message);
  }
};

/* ============================================================
   FORMULARIO DE GASTO
============================================================ */
let editingId = null;

window.openExpenseForm = () => {
  editingId = null;
  $('expense-title').innerText = 'Nuevo movimiento';
  renderForm({});
  const m = $('expense-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeExpenseForm = () => {
  const m = $('expense-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingId = null;
};

window.editExpense = (id) => {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  editingId = id;
  $('expense-title').innerText = 'Editar movimiento';
  renderForm(e);
  const m = $('expense-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

function renderForm(v) {
  const isSuper = currentUserData.role === 'superadmin';
  const storeOpts = stores.filter(s => s.active).map(s =>
    `<option value="${s.storeId}" ${v.storeId === s.storeId ? 'selected' : ''}>${s.name}</option>`
  ).join('');

  const catOpts = categories.map(c =>
    `<option value="${c.slug}" data-type="${c.type}" ${v.category === c.slug ? 'selected' : ''}>${c.name}</option>`
  ).join('');

  const activeSuppliers = suppliers.filter(s => s.active !== false);
  const supplierOpts = activeSuppliers.map(s =>
    `<option value="${s.id}" ${v.supplierId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}${s.nit ? ' · ' + s.nit : ''}</option>`
  ).join('');

  const termsOpts = PAYMENT_TERMS.map(t =>
    `<option value="${t.slug}" ${v.paymentTerms === t.slug ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  const existingSupports = (v.supports || []).length ? v.supports
    : (v.supportUrl ? [{ url: v.supportUrl, name: v.supportName || 'soporte' }] : []);

  $('expense-body').innerHTML = `
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Fecha *</label>
        <input id="x-date" type="date" value="${v.date || todayStr()}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Tipo *</label>
        <select id="x-type" class="w-full px-3 py-2 border rounded-lg mt-1">
          <option value="costo" ${v.type === 'costo' ? 'selected' : ''}>Costo (mercancía)</option>
          <option value="gasto" ${v.type === 'gasto' || !v.type ? 'selected' : ''}>Gasto operativo</option>
        </select>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Categoría *</label>
        <select id="x-category" class="w-full px-3 py-2 border rounded-lg mt-1">
          ${catOpts}
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Tienda</label>
        <select id="x-store" class="w-full px-3 py-2 border rounded-lg mt-1" ${isSuper ? '' : 'disabled'}>
          <option value="general" ${v.storeId === 'general' ? 'selected' : ''}>— General (sin tienda) —</option>
          ${storeOpts}
        </select>
      </div>
    </div>

    <!-- Proveedor + Nº Factura -->
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Proveedor</label>
        <div class="flex gap-2 mt-1">
          <select id="x-supplier" class="flex-1 px-3 py-2 border rounded-lg" onchange="onSupplierSelected()">
            <option value="">— Selecciona o crea uno —</option>
            ${supplierOpts}
          </select>
          <button type="button" onclick="quickCreateSupplier()" class="bg-sl text-white px-3 py-2 rounded-lg hover:bg-sd text-sm" title="Nuevo proveedor">➕</button>
        </div>
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Nº Factura</label>
        <input id="x-invoice" type="text" value="${escapeHtml(v.invoiceNumber) || ''}" placeholder="Ej: FAC-001-2026" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <label class="text-xs font-semibold text-sd">Concepto *</label>
    <input id="x-concept" type="text" value="${escapeHtml(v.concept) || ''}" placeholder="Ej: Compra de neveras" class="w-full px-3 py-2 border rounded-lg mt-1 mb-3">

    <div class="grid grid-cols-3 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Valor base *</label>
        <input id="x-amount" type="number" value="${v.amount || ''}" placeholder="0" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">IVA (%)</label>
        <input id="x-taxRate" type="number" step="0.01" value="${((v.taxRate||0)*100).toFixed(2)}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Retención (%)</label>
        <input id="x-retentionRate" type="number" step="0.01" value="${((v.retentionRate||0)*100).toFixed(2)}" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <div class="bg-gray-50 rounded-lg p-3 mb-3 text-sm space-y-1">
      <div class="flex justify-between"><span class="text-gray-500">IVA:</span><span id="x-taxAmount" class="font-semibold">$0</span></div>
      <div class="flex justify-between"><span class="text-gray-500">Retención:</span><span id="x-retentionAmount" class="font-semibold text-red-500">$0</span></div>
      <div class="flex justify-between border-t pt-1"><span class="font-semibold text-sd">Total:</span><span id="x-total" class="font-bold text-sl">$0</span></div>
    </div>

    <!-- Condiciones de pago -->
    <div class="border border-gray-200 rounded-lg p-3 mb-3 bg-blue-50/30">
      <p class="text-xs font-semibold text-sd mb-2">💳 Condiciones de pago</p>

      <div id="x-terms-grid" class="grid grid-cols-2 gap-3 mb-2">
        <div>
          <label class="text-[10px] font-semibold text-sd">Condición</label>
          <select id="x-paymentTerms" class="w-full px-3 py-2 border rounded-lg text-sm mt-1" onchange="recalcDueDate()">
            ${termsOpts}
          </select>
        </div>
        <div id="x-custom-days-wrap" class="hidden">
          <label class="text-[10px] font-semibold text-sd">Días personalizados *</label>
          <input id="x-custom-days" type="number" min="1" max="365" placeholder="Ej: 20" value="${v.customTermsDays || ''}" class="w-full px-3 py-2 border rounded-lg text-sm mt-1 border-blue-400 bg-white" oninput="recalcDueDate()">
          <p class="text-[9px] text-blue-600 mt-0.5">Escribe los días exactos de crédito</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-[10px] font-semibold text-sd">Fecha de vencimiento</label>
          <input id="x-dueDate" type="date" value="${v.dueDate || ''}" class="w-full px-3 py-2 border rounded-lg text-sm mt-1">
          <p class="text-[9px] text-gray-400 mt-0.5">Se calcula automáticamente. Puedes editarla.</p>
        </div>
        <div>
          <label class="text-[10px] font-semibold text-sd">Alerta (días antes)</label>
          <input id="x-alertDays" type="number" min="0" max="90" value="${v.alertDaysBefore ?? conSettings.defaultAlertDays}" class="w-full px-3 py-2 border rounded-lg text-sm mt-1">
        </div>
      </div>

      <label class="flex items-center gap-2 text-xs mt-3">
        <input id="x-markPaid" type="checkbox" ${v.paidAt ? 'checked' : ''} class="w-4 h-4" onchange="togglePaidFields()">
        Marcar como ya pagado
      </label>
      <div id="x-paid-fields" class="${v.paidAt ? '' : 'hidden'} mt-2 grid grid-cols-2 gap-3">
        <div>
          <label class="text-[10px] font-semibold text-sd">Fecha de pago</label>
          <input id="x-paidAt" type="date" value="${v.paidAt || todayStr()}" class="w-full px-3 py-2 border rounded-lg text-sm mt-1">
        </div>
        <div>
          <label class="text-[10px] font-semibold text-sd">Nota de pago</label>
          <input id="x-paymentNotes" type="text" value="${escapeHtml(v.paymentNotes) || ''}" placeholder="Ej: Transferencia Bancolombia" class="w-full px-3 py-2 border rounded-lg text-sm mt-1">
        </div>
      </div>
    </div>

    <label class="text-xs font-semibold text-sd">Notas</label>
    <textarea id="x-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-3 text-sm">${escapeHtml(v.notes) || ''}</textarea>

    <!-- Adjuntos -->
    <div class="border border-gray-200 rounded-lg p-3 mb-3">
      <p class="text-xs font-semibold text-sd mb-2">📎 Adjuntos (máx ${MAX_SUPPORTS} archivos)</p>
      <div id="x-existing-supports" class="space-y-1 mb-2">
        ${existingSupports.length ? existingSupports.map((s, i) => `
          <div class="flex justify-between items-center text-xs bg-gray-50 rounded p-2">
            <a href="${s.url}" target="_blank" class="text-sl hover:underline truncate">📎 ${escapeHtml(s.name) || 'soporte'}</a>
            <button type="button" onclick="removeSupportField('${v.id || ''}', ${i})" class="text-red-500 hover:text-red-700 text-xs ml-2">✕</button>
          </div>
        `).join('') : '<p class="text-[10px] text-gray-400">Sin adjuntos aún.</p>'}
      </div>
      <input id="x-files" type="file" accept="image/*,application/pdf" multiple class="w-full px-3 py-2 border rounded-lg text-sm">
      <p class="text-[10px] text-gray-400 mt-1">Puedes seleccionar varios archivos. Máximo ${MAX_SUPPORTS} en total.</p>
    </div>

    <div class="flex gap-3">
      <button onclick="closeExpenseForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveExpense()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">Guardar</button>
    </div>
  `;

  // Listeners para recálculo
  ['x-amount','x-taxRate','x-retentionRate'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', recalcTotals);
  });
  recalcTotals();

  // Ajustar UI según condiciones
  const termsSel = $('x-paymentTerms');
  if (termsSel) {
    // Si ya está en custom (al editar), mostrarlo
    if (termsSel.value === 'custom') {
      $('x-custom-days-wrap').classList.remove('hidden');
      // Auto-focus al input de días
      setTimeout(() => {
        const inp = $('x-custom-days');
        if (inp && !inp.value) inp.focus();
      }, 100);
    }
    termsSel.dataset.listeners = '1';
  }

  // Recalcular vencimiento al cargar (por si viene editando)
  recalcDueDate();

  // Guardar soportes temporales en un estado
  window.__tempSupports = existingSupports.slice();
}

window.removeSupportField = (expenseId, index) => {
  if (!window.__tempSupports) return;
  const removed = window.__tempSupports.splice(index, 1)[0];
  if (removed) window.__removedSupports = window.__removedSupports || [];
  window.__removedSupports.push(removed);
  // Re-render quick
  const container = $('x-existing-supports');
  if (container) {
    container.innerHTML = window.__tempSupports.length ? window.__tempSupports.map((s, i) => `
      <div class="flex justify-between items-center text-xs bg-gray-50 rounded p-2">
        <a href="${s.url}" target="_blank" class="text-sl hover:underline truncate">📎 ${escapeHtml(s.name) || 'soporte'}</a>
        <button type="button" onclick="removeSupportField('${expenseId}', ${i})" class="text-red-500 hover:text-red-700 text-xs ml-2">✕</button>
      </div>
    `).join('') : '<p class="text-[10px] text-gray-400">Sin adjuntos aún.</p>';
  }
};

window.recalcDueDate = () => {
  const terms = $('x-paymentTerms')?.value;
  const date = $('x-date')?.value || todayStr();
  const customDaysRaw = $('x-custom-days')?.value;
  const customDays = Number(customDaysRaw || 0);

  const wrap = $('x-custom-days-wrap');
  if (terms === 'custom') {
    wrap?.classList.remove('hidden');
  } else {
    wrap?.classList.add('hidden');
  }

  let days = 0;
  if (terms === 'custom') {
    // Si es custom y aún no escribieron días, no calcular la fecha
    if (!customDaysRaw || customDays <= 0) {
      if ($('x-dueDate')) $('x-dueDate').value = '';
      return;
    }
    days = customDays;
  } else {
    const t = PAYMENT_TERMS.find(x => x.slug === terms);
    days = t ? Number(t.days || 0) : conSettings.defaultTermsDays;
  }

  const due = addDays(date, days);
  if ($('x-dueDate')) $('x-dueDate').value = due;
};

window.togglePaidFields = () => {
  const checked = $('x-markPaid')?.checked;
  $('x-paid-fields')?.classList.toggle('hidden', !checked);
};

window.onSupplierTermsChange = () => {
  const terms = $('s-terms')?.value;
  const wrap = $('s-custom-days-wrap');
  if (!wrap) return;

  if (terms === 'custom') {
    wrap.classList.remove('hidden');
    setTimeout(() => {
      const inp = $('s-custom-days');
      if (inp && !inp.value) inp.focus();
    }, 100);
  } else {
    wrap.classList.add('hidden');
  }
};

window.onSupplierSelected = () => {
  const supplierId = $('x-supplier')?.value;
  if (!supplierId) return;

  const sup = suppliers.find(s => s.id === supplierId);
  if (!sup) return;

  // Aplicar condición de pago por defecto
  if (sup.defaultPaymentTerms) {
    const sel = $('x-paymentTerms');
    if (sel) {
      sel.value = sup.defaultPaymentTerms;
    }
  }

  // Aplicar días personalizados si aplica
  if (sup.defaultPaymentTerms === 'custom' && sup.customTermsDays) {
    const inp = $('x-custom-days');
    if (inp) inp.value = sup.customTermsDays;
  }

  // Aplicar días de alerta por defecto
  if (sup.defaultAlertDaysBefore !== undefined) {
    const alertInp = $('x-alertDays');
    if (alertInp) alertInp.value = sup.defaultAlertDaysBefore;
  }

  // Recalcular vencimiento
  recalcDueDate();
};

function recalcTotals() {
  const amount = Number($('x-amount').value) || 0;
  const taxRate = (Number($('x-taxRate').value) || 0) / 100;
  const retRate = (Number($('x-retentionRate').value) || 0) / 100;

  const taxAmount = amount * taxRate;
  const retentionAmount = amount * retRate;
  const total = amount + taxAmount - retentionAmount;

  $('x-taxAmount').innerText = fmt(taxAmount);
  $('x-retentionAmount').innerText = fmt(retentionAmount);
  $('x-total').innerText = fmt(total);
}

/* ============================================================
   GUARDAR GASTO
============================================================ */
window.saveExpense = async () => {
  const date = $('x-date').value;
  const type = $('x-type').value;
  const category = $('x-category').value;
  const storeId = $('x-store').value;
  const supplierId = $('x-supplier').value || null;
  const invoiceNumber = $('x-invoice').value.trim();
  const concept = $('x-concept').value.trim();
  const amount = Number($('x-amount').value);
  const taxRate = (Number($('x-taxRate').value) || 0) / 100;
  const retentionRate = (Number($('x-retentionRate').value) || 0) / 100;
  const paymentTerms = $('x-paymentTerms').value;
  const customTermsDays = paymentTerms === 'custom' ? Number($('x-custom-days').value) : null;
  const dueDate = $('x-dueDate').value;
  const alertDaysBefore = Number($('x-alertDays').value) || conSettings.defaultAlertDays;
  const markPaid = $('x-markPaid').checked;
  const paidAt = markPaid ? $('x-paidAt').value : null;
  const paymentNotes = $('x-paymentNotes')?.value.trim() || '';
  const notes = $('x-notes').value.trim();

  if (!date) return alert('La fecha es obligatoria');
  if (!concept) return alert('El concepto es obligatorio');
  if (!amount || amount <= 0) return alert('El valor debe ser mayor a 0');

  const taxAmount = amount * taxRate;
  const retentionAmount = amount * retentionRate;
  const total = amount + taxAmount - retentionAmount;

  // Resolver proveedor (nombre y NIT)
  let supplierName = '';
  let supplierNit = '';
  if (supplierId) {
    const sup = suppliers.find(s => s.id === supplierId);
    if (sup) {
      supplierName = sup.name || '';
      supplierNit = sup.nit || '';
    }
  }

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Guardando...';

  try {
    // 1. Subir archivos nuevos
    const newSupports = [];
    const fileInput = $('x-files');
    const files = fileInput ? Array.from(fileInput.files || []) : [];

    const existingSupports = (window.__tempSupports || []).slice();
    const remainingSlots = MAX_SUPPORTS - existingSupports.length;

    if (files.length > remainingSlots) {
      alert(`⚠️ Solo puedes tener máximo ${MAX_SUPPORTS} archivos. Ya tienes ${existingSupports.length}. Se subirán solo los primeros ${remainingSlots}.`);
    }

    const filesToUpload = files.slice(0, Math.max(0, remainingSlots));

    for (const file of filesToUpload) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `expenses/${storeId}/${Date.now()}_${safeName}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      newSupports.push({ url, name: file.name, type: file.type });
    }

    const allSupports = [...existingSupports, ...newSupports];

    // 2. Borrar archivos removidos
    if (window.__removedSupports && window.__removedSupports.length) {
      for (const s of window.__removedSupports) {
        try {
          const fileRef = storageRef(storage, s.url);
          await deleteObject(fileRef);
        } catch(err) { console.warn('No se pudo borrar archivo:', err); }
      }
    }

    // 3. Datos finales
    const data = {
      date, type, category, storeId,
      supplierId: supplierId || null,
      supplierName: supplierName || null,
      supplierNit: supplierNit || null,
      // Legacy
      provider: supplierName || '',
      providerNit: supplierNit || '',
      invoiceNumber,
      concept,
      amount, taxRate, taxAmount,
      retentionRate, retentionAmount,
      total,
      paymentTerms,
      customTermsDays,
      paymentTermsLabel: (PAYMENT_TERMS.find(t => t.slug === paymentTerms) || {}).label || paymentTerms,
      dueDate: dueDate || null,
      alertDaysBefore,
      supports: allSupports,
      // Legacy
      supportUrl: allSupports[0]?.url || null,
      supportName: allSupports[0]?.name || null,
      notes,
      updatedAt: serverTimestamp()
    };

    if (markPaid) {
      data.paidAt = paidAt || todayStr();
      data.paidBy = currentUser.email;
      data.paymentNotes = paymentNotes || null;
    } else {
      // Si estaba pagado antes y ahora no, limpiar
      data.paidAt = null;
      data.paidBy = null;
      data.paymentNotes = null;
    }

    if (editingId) {
      const prev = expenses.find(e => e.id === editingId);
      await updateDoc(doc(db,'expenses',editingId), data);
      await audit({
        action:'update', collection:'expenses', docId: editingId,
        before: prev, after: data,
        note:`Editado movimiento: ${concept} · ${fmt(total)}`
      });
    } else {
      data.createdBy = currentUser.email;
      data.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db,'expenses'), data);
      await audit({
        action:'create', collection:'expenses', docId: ref.id,
        after: data,
        note:`Creado ${type}: ${concept} · ${fmt(total)}${invoiceNumber ? ' · Factura ' + invoiceNumber : ''}`
      });
    }

    // Limpiar estado temporal
    window.__tempSupports = null;
    window.__removedSupports = null;

    window.SmartecCache.invalidate('expenses_all');
    closeExpenseForm();
    await loadExpenses();
    renderAll();
    alert('✅ Guardado correctamente');
  } catch(e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = 'Guardar';
  }
};

/* ============================================================
   DETALLE DE GASTO
============================================================ */
window.viewDetail = (id) => {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  const cat = categories.find(c => c.slug === e.category);
  const store = stores.find(s => s.storeId === e.storeId);
  const ps = computePaymentStatus(e);
  const today = todayStr();

  const supports = (e.supports && e.supports.length) ? e.supports
    : (e.supportUrl ? [{ url: e.supportUrl, name: e.supportName || 'soporte', type: '' }] : []);

  // Datos de vencimiento
  let dueInfo = '';
  if (e.dueDate) {
    const diff = daysBetween(today, e.dueDate);
    const diffLabel = ps === 'paid' ? 'Pagado a tiempo'
      : diff < 0 ? `Venció hace ${Math.abs(diff)} días`
      : diff === 0 ? 'Vence hoy'
      : `Vence en ${diff} días`;
    dueInfo = `
      <div><p class="text-xs text-gray-400">Vencimiento</p><p class="font-semibold">${e.dueDate}</p></div>
      <div><p class="text-xs text-gray-400">Estado</p><p class="font-semibold">${diffLabel}</p></div>
    `;
  }

  $('detail-body').innerHTML = `
    <div class="flex justify-between items-start mb-4">
      <div>
        <p class="text-xs text-gray-400">${e.invoiceNumber ? 'Factura ' + escapeHtml(e.invoiceNumber) : 'Sin número de factura'}</p>
        <p class="text-lg font-bold text-sd">${escapeHtml(e.concept)}</p>
      </div>
      ${paymentStatusBadge(ps)}
    </div>

    <div class="grid grid-cols-2 gap-3 text-sm mb-4">
      <div><p class="text-xs text-gray-400">Fecha</p><p class="font-semibold">${e.date}</p></div>
      <div><p class="text-xs text-gray-400">Tipo</p><p class="font-semibold capitalize">${e.type}</p></div>
      <div><p class="text-xs text-gray-400">Categoría</p><p class="font-semibold">${escapeHtml(cat?.name || e.category)}</p></div>
      <div><p class="text-xs text-gray-400">Tienda</p><p class="font-semibold">${e.storeId === 'general' ? 'General' : escapeHtml(store?.name) || e.storeId}</p></div>
      <div><p class="text-xs text-gray-400">Proveedor</p><p class="font-semibold">${escapeHtml(e.supplierName || e.provider) || '—'}</p></div>
      <div><p class="text-xs text-gray-400">NIT</p><p class="font-semibold">${escapeHtml(e.supplierNit || e.providerNit) || '—'}</p></div>
      ${dueInfo}
      <div><p class="text-xs text-gray-400">Condición de pago</p><p class="font-semibold">${escapeHtml(e.paymentTermsLabel) || '—'}</p></div>
    </div>

    <div class="bg-gray-50 p-3 rounded-lg mb-4 text-sm space-y-1">
      <div class="flex justify-between"><span class="text-gray-500">Base</span><span>${fmt(e.amount)}</span></div>
      <div class="flex justify-between"><span class="text-gray-500">IVA (${((e.taxRate||0)*100).toFixed(2)}%)</span><span>${fmt(e.taxAmount)}</span></div>
      <div class="flex justify-between"><span class="text-gray-500">Retención (${((e.retentionRate||0)*100).toFixed(2)}%)</span><span class="text-red-500">-${fmt(e.retentionAmount)}</span></div>
      <div class="flex justify-between border-t pt-2 font-bold text-sd"><span>TOTAL</span><span>${fmt(e.total)}</span></div>
    </div>

    ${e.paidAt ? `
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm">
        <p class="text-xs text-green-700 font-semibold mb-1">✅ Pago registrado</p>
        <p class="text-xs text-gray-600">Fecha: <b>${e.paidAt}</b> · Por: ${escapeHtml(e.paidBy) || '-'}</p>
        ${e.paymentNotes ? `<p class="text-xs text-gray-600 mt-1 italic">"${escapeHtml(e.paymentNotes)}"</p>` : ''}
      </div>
    ` : ''}

    <div class="mb-4">
      <p class="text-xs text-gray-400 mb-1">Registró</p>
      <p class="text-xs">${escapeHtml(e.createdBy) || '-'}</p>
    </div>

    ${e.notes ? `<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm mb-4"><p class="text-xs text-yellow-700 font-semibold mb-1">Notas</p><p>${escapeHtml(e.notes)}</p></div>` : ''}

    <div class="border-t pt-4">
      <p class="text-xs font-semibold text-sd mb-2">📎 Adjuntos (${supports.length})</p>
      ${supports.length ? supports.map(s => `
        <a href="${s.url}" target="_blank" class="block text-center bg-sl text-white py-2 rounded-lg hover:bg-sd font-semibold text-sm mb-1">
          📎 ${escapeHtml(s.name) || 'Ver archivo'}
        </a>
      `).join('') : '<p class="text-xs text-gray-400 text-center py-3">Sin adjuntos</p>'}
    </div>

    ${ps === 'anulado' ? `
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm mt-4">
        <p class="font-bold text-red-700 mb-1">Movimiento anulado</p>
        <p class="text-xs text-red-600">Motivo: ${escapeHtml(e.motivoAnulacion) || '-'}</p>
        <p class="text-xs text-gray-500 mt-1">Por: ${escapeHtml(e.anuladoPor) || '-'}</p>
      </div>
    ` : ''}

    ${ps === 'pending' || ps === 'overdue' ? `
      <button onclick="closeDetail(); openPayModal('${e.id}');" class="w-full bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 font-semibold text-sm mt-4">
        💰 Marcar como pagado
      </button>
    ` : ''}
  `;

  const m = $('detail-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeDetail = () => {
  const m = $('detail-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
};

/* ============================================================
   MARCAR COMO PAGADO
============================================================ */
let currentPayId = null;

window.openPayModal = (id) => {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  currentPayId = id;

  $('pay-subtitle').innerText = `${e.concept} · ${fmt(e.total)}`;
  $('pay-body').innerHTML = `
    <label class="text-xs font-semibold text-sd block mb-1">Fecha de pago *</label>
    <input id="pay-date" type="date" value="${todayStr()}" class="w-full px-3 py-2 border rounded-lg mb-3">

    <label class="text-xs font-semibold text-sd block mb-1">Nota (opcional)</label>
    <textarea id="pay-notes" rows="2" class="w-full px-3 py-2 border rounded-lg text-sm mb-4" placeholder="Ej: Transferencia Bancolombia, cheque #123..."></textarea>

    <div class="flex gap-3">
      <button onclick="closePayModal()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="submitPay()" class="flex-1 bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 font-semibold">✅ Confirmar pago</button>
    </div>
  `;

  const m = $('pay-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closePayModal = () => {
  const m = $('pay-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  currentPayId = null;
};

window.submitPay = async () => {
  if (!currentPayId) return;
  const e = expenses.find(x => x.id === currentPayId);
  if (!e) return;

  const paidAt = $('pay-date').value;
  const paymentNotes = $('pay-notes').value.trim();

  if (!paidAt) return alert('La fecha de pago es obligatoria');

  try {
    await updateDoc(doc(db, 'expenses', currentPayId), {
      paidAt,
      paidBy: currentUser.email,
      paymentNotes: paymentNotes || null,
      updatedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'expenses',
      docId: currentPayId,
      before: { paidAt: e.paidAt || null },
      after: { paidAt, paymentNotes },
      note: `Pago registrado: ${e.concept} · ${fmt(e.total)} · ${paidAt}`
    });

    window.SmartecCache.invalidate('expenses_all');
    closePayModal();
    await loadExpenses();
    renderAll();
    alert('✅ Pago registrado');
  } catch(err) {
    alert('Error: ' + err.message);
  }
};

/* ============================================================
   ANULAR / ELIMINAR
============================================================ */
window.anularExpense = async (id) => {
  const e = expenses.find(x => x.id === id);
  if (!e) return;

  const motivo = prompt(
    `Anular el movimiento:\n"${e.concept}" · ${fmt(e.total)}\n\n` +
    `El movimiento NO se borra (queda en auditoría), pero se excluye de los totales.\n\n` +
    `Motivo de la anulación (obligatorio):`
  );

  if (!motivo || !motivo.trim()) {
    return alert('⚠️ Debes escribir el motivo de la anulación.');
  }

  try {
    await updateDoc(doc(db,'expenses',id), {
      status: 'anulado',
      anuladoPor: currentUser.email,
      anuladoAt: serverTimestamp(),
      motivoAnulacion: motivo.trim(),
      updatedAt: serverTimestamp()
    });

    await audit({
      action: 'update',
      collection: 'expenses',
      docId: id,
      before: { status: e.status || 'activo' },
      after: { status: 'anulado', motivoAnulacion: motivo.trim() },
      note: `Gasto anulado: ${e.concept} · ${fmt(e.total)} · Motivo: ${motivo.trim()}`
    });

    window.SmartecCache.invalidate('expenses_all');
    await loadExpenses();
    renderAll();
    alert('✅ Movimiento anulado correctamente (queda registrado en auditoría).');
  } catch(err) {
    console.error(err);
    alert('Error al anular: ' + err.message);
  }
};

/* ============================================================
   PROVEEDORES - CRUD
============================================================ */
let editingSupplierId = null;
let returnToExpense = false;

window.openSupplierForm = (supplier = null, fromExpense = false) => {
  editingSupplierId = supplier?.id || null;
  returnToExpense = !!fromExpense;

  const v = supplier || {
    name: '', nit: '', phone: '', email: '', address: '',
    contactName: '', defaultPaymentTerms: 'net_30',
    defaultAlertDaysBefore: conSettings.defaultAlertDays,
    active: true, notes: ''
  };

  $('supplier-title').innerText = supplier ? 'Editar proveedor' : 'Nuevo proveedor';

  const termsOpts = PAYMENT_TERMS.map(t =>
    `<option value="${t.slug}" ${v.defaultPaymentTerms === t.slug ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  $('supplier-body').innerHTML = `
    <label class="text-xs font-semibold text-sd">Nombre / Razón social *</label>
    <input id="s-name" type="text" value="${escapeHtml(v.name) || ''}" placeholder="Ej: Ferretería XYZ S.A.S." class="w-full px-3 py-2 border rounded-lg mt-1 mb-3">

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">NIT / Cédula</label>
        <input id="s-nit" type="text" value="${escapeHtml(v.nit) || ''}" placeholder="900123456-7" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Contacto</label>
        <input id="s-contactName" type="text" value="${escapeHtml(v.contactName) || ''}" placeholder="Nombre del contacto" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="text-xs font-semibold text-sd">Teléfono</label>
        <input id="s-phone" type="text" value="${escapeHtml(v.phone) || ''}" placeholder="3101234567" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
      <div>
        <label class="text-xs font-semibold text-sd">Email</label>
        <input id="s-email" type="email" value="${escapeHtml(v.email) || ''}" placeholder="ventas@proveedor.com" class="w-full px-3 py-2 border rounded-lg mt-1">
      </div>
    </div>

    <label class="text-xs font-semibold text-sd">Dirección</label>
    <input id="s-address" type="text" value="${escapeHtml(v.address) || ''}" placeholder="Calle 45 #12-34, Bogotá" class="w-full px-3 py-2 border rounded-lg mt-1 mb-3">

    <div class="border border-gray-200 rounded-lg p-3 mb-3 bg-blue-50/30">
      <p class="text-xs font-semibold text-sd mb-2">💳 Condiciones por defecto</p>

      <div id="s-terms-grid" class="grid grid-cols-2 gap-3 mb-2">
        <div>
          <label class="text-[10px] font-semibold text-sd">Condición de pago</label>
          <select id="s-terms" class="w-full px-3 py-2 border rounded-lg text-sm mt-1" onchange="onSupplierTermsChange()">
            ${termsOpts}
          </select>
        </div>
        <div id="s-custom-days-wrap" class="hidden">
          <label class="text-[10px] font-semibold text-sd">Días personalizados *</label>
          <input id="s-custom-days" type="number" min="1" max="365" placeholder="Ej: 20" value="${v.customTermsDays || ''}" class="w-full px-3 py-2 border rounded-lg text-sm mt-1 border-blue-400 bg-white">
          <p class="text-[9px] text-blue-600 mt-0.5">Días exactos de crédito</p>
        </div>
      </div>

      <div>
        <label class="text-[10px] font-semibold text-sd">Días de alerta antes del vencimiento</label>
        <input id="s-alertDays" type="number" min="0" max="90" value="${v.defaultAlertDaysBefore ?? conSettings.defaultAlertDays}" class="w-full px-3 py-2 border rounded-lg text-sm mt-1">
      </div>
    </div>

    <label class="text-xs font-semibold text-sd">Notas</label>
    <textarea id="s-notes" rows="2" class="w-full px-3 py-2 border rounded-lg mt-1 mb-3 text-sm">${escapeHtml(v.notes) || ''}</textarea>

    <label class="flex items-center gap-2 text-sm mb-3">
      <input id="s-active" type="checkbox" ${v.active !== false ? 'checked' : ''} class="w-4 h-4">
      Proveedor activo
    </label>

    <div class="flex gap-3">
      <button onclick="closeSupplierForm()" class="flex-1 bg-gray-100 text-sd py-2.5 rounded-lg hover:bg-gray-200 font-semibold">Cancelar</button>
      <button onclick="saveSupplier()" class="flex-1 bg-sd text-white py-2.5 rounded-lg hover:bg-sl font-semibold">Guardar</button>
    </div>
  `;

  // Si ya está en custom, mostrar el input desde el inicio
  if (v.defaultPaymentTerms === 'custom') {
    $('s-custom-days-wrap')?.classList.remove('hidden');
  }

  const m = $('supplier-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
};

window.closeSupplierForm = () => {
  const m = $('supplier-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
  editingSupplierId = null;
  returnToExpense = false;
};

window.editSupplier = (id) => {
  const s = suppliers.find(x => x.id === id);
  if (s) openSupplierForm(s, false);
};

window.saveSupplier = async () => {
  const name = $('s-name').value.trim();
  if (!name) return alert('El nombre es obligatorio');

  const paymentTerms = $('s-terms').value;
  const customTermsDays = paymentTerms === 'custom'
    ? (Number($('s-custom-days').value) || 0)
    : null;

  if (paymentTerms === 'custom' && (!customTermsDays || customTermsDays <= 0)) {
    return alert('⚠️ Debes indicar los días personalizados');
  }

  const data = {
    name,
    nit: $('s-nit').value.trim(),
    contactName: $('s-contactName').value.trim(),
    phone: $('s-phone').value.trim(),
    email: $('s-email').value.trim(),
    address: $('s-address').value.trim(),
    defaultPaymentTerms: paymentTerms,
    customTermsDays,
    defaultAlertDaysBefore: Number($('s-alertDays').value) || conSettings.defaultAlertDays,
    notes: $('s-notes').value.trim(),
    active: $('s-active').checked,
    updatedAt: serverTimestamp()
  };

  const btn = event.target;
  btn.disabled = true; btn.innerText = '⏳ Guardando...';

  try {
    if (editingSupplierId) {
      const before = suppliers.find(s => s.id === editingSupplierId);
      await updateDoc(doc(db, 'suppliers', editingSupplierId), data);
      await audit({
        action: 'update',
        collection: 'suppliers',
        docId: editingSupplierId,
        before, after: data,
        note: `Proveedor editado: ${name}`
      });
    } else {
      data.createdBy = currentUser.email;
      data.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'suppliers'), data);
      await audit({
        action: 'create',
        collection: 'suppliers',
        docId: ref.id,
        after: data,
        note: `Proveedor creado: ${name}`
      });
    }

    window.SmartecCache.invalidate('suppliers_all');
    await loadSuppliers();
    renderSuppliers();

    closeSupplierForm();

    // Si venía del formulario de gasto, refrescar el selector
    if (returnToExpense && !$('expense-modal').classList.contains('hidden')) {
      const newId = editingSupplierId || (suppliers[suppliers.length - 1]?.id);
      renderForm(expenses.find(e => e.id === editingId) || {});
      if (newId) {
        setTimeout(() => {
          const sel = $('x-supplier');
          if (sel) sel.value = newId;
        }, 100);
      }
    }

    alert('✅ Proveedor guardado');
  } catch(e) {
    console.error(e);
    alert('Error: ' + e.message);
    btn.disabled = false; btn.innerText = 'Guardar';
  }
};

window.toggleSupplier = async (id) => {
  const s = suppliers.find(x => x.id === id);
  if (!s) return;
  const willActivate = s.active === false;
  if (!confirm(`¿${willActivate ? 'Activar' : 'Desactivar'} a ${s.name}?`)) return;

  try {
    await updateDoc(doc(db, 'suppliers', id), {
      active: willActivate,
      updatedAt: serverTimestamp()
    });
    await audit({
      action: 'update',
      collection: 'suppliers',
      docId: id,
      before: { active: s.active },
      after: { active: willActivate },
      note: `Proveedor ${willActivate ? 'activado' : 'desactivado'}: ${s.name}`
    });
    window.SmartecCache.invalidate('suppliers_all');
    await loadSuppliers();
    renderSuppliers();
  } catch(e) {
    alert('Error: ' + e.message);
  }
};

window.deleteSupplier = async (id) => {
  const s = suppliers.find(x => x.id === id);
  if (!s) return;

  // Verificar si tiene gastos asociados
  const hasExpenses = expenses.some(e => e.supplierId === id);
  if (hasExpenses) {
    alert(`⛔ No se puede eliminar: "${s.name}" tiene gastos asociados.\n\nEn su lugar, usa "Desactivar".`);
    return;
  }

  if (!confirm(`⚠️ ¿Eliminar definitivamente el proveedor "${s.name}"?\n\nEsta acción no se puede deshacer.`)) return;

  try {
    await deleteDoc(doc(db, 'suppliers', id));
    await audit({
      action: 'delete',
      collection: 'suppliers',
      docId: id,
      before: s,
      note: `Proveedor eliminado: ${s.name}`
    });
    window.SmartecCache.invalidate('suppliers_all');
    await loadSuppliers();
    renderSuppliers();
    alert('✅ Proveedor eliminado');
  } catch(e) {
    alert('Error: ' + e.message);
  }
};

/* ============================================================
   EXPORTAR PDF
============================================================ */
window.exportPDF = async () => {
  if (!window.jspdf) {
    try { await loadLazyLibs('jspdf'); }
    catch (e) { alert('⚠️ No se pudo cargar la librería de PDF.\n\n' + e.message); return; }
  }
  const { jsPDF } = window.jspdf;
  const list = getFiltered();
  if (!list.length) return alert('No hay movimientos para exportar.');

  const doc = new jsPDF('l', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 15;

  doc.setFillColor(10, 42, 74);
  doc.rect(0, 0, pageW, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('SMARTEC · Centro Contable', 14, 13);

  y = 28;
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  doc.text(`Período: ${$('f-date-from').value || 'todo'} — ${$('f-date-to').value || 'hoy'}`, 14, y); y += 5;
  const storeLabelPDF = currentStore?.storeId === 'all'
    ? 'Todas las tiendas'
    : (currentStore?.name || 'General');
  doc.text(`Tienda: ${storeLabelPDF}`, 14, y); y += 5;
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, y); y += 8;

  const total = list.filter(e => e.status !== 'anulado').reduce((s,e) => s + Number(e.total||0), 0);
  const cost = list.filter(e => e.status !== 'anulado' && e.type === 'costo').reduce((s,e) => s + Number(e.total||0), 0);
  const expense = list.filter(e => e.status !== 'anulado' && e.type === 'gasto').reduce((s,e) => s + Number(e.total||0), 0);
  const payable = list.filter(e => ['pending','overdue'].includes(computePaymentStatus(e))).reduce((s,e) => s + Number(e.total||0), 0);
  const paid = list.filter(e => computePaymentStatus(e) === 'paid').reduce((s,e) => s + Number(e.total||0), 0);
  const overdue = list.filter(e => computePaymentStatus(e) === 'overdue').reduce((s,e) => s + Number(e.total||0), 0);

  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(10,42,74);
  doc.text('Resumen', 14, y); y += 3;

  doc.autoTable({
    startY: y,
    head: [['Total', 'Costos', 'Gastos', 'Por pagar', 'Pagado', 'Vencido']],
    body: [[
      '$' + total.toLocaleString('es-CO'),
      '$' + cost.toLocaleString('es-CO'),
      '$' + expense.toLocaleString('es-CO'),
      '$' + payable.toLocaleString('es-CO'),
      '$' + paid.toLocaleString('es-CO'),
      '$' + overdue.toLocaleString('es-CO')
    ]],
    theme: 'grid',
    headStyles: { fillColor: [74, 122, 154], textColor: 255, halign: 'center' },
    bodyStyles: { halign: 'center', fontSize: 9 },
    margin: { left: 14, right: 14 }
  });
  y = doc.lastAutoTable.finalY + 10;

  const rows = list.map(e => {
    const cat = categories.find(c => c.slug === e.category);
    const store = stores.find(s => s.storeId === e.storeId);
    const ps = computePaymentStatus(e);
    const psLabel = { pending: 'Pendiente', paid: 'Pagado', overdue: 'VENCIDO', anulado: 'Anulado' }[ps] || ps;

    return [
      e.date,
      e.invoiceNumber || '',
      e.type === 'costo' ? 'Costo' : 'Gasto',
      (e.supplierName || e.provider || '').substring(0, 25),
      (e.concept || '').substring(0, 40),
      e.dueDate || '',
      psLabel,
      '$' + Number(e.total||0).toLocaleString('es-CO')
    ];
  });

  doc.setFontSize(11); doc.setFont('helvetica','bold');
  doc.text(`Detalle de movimientos (${rows.length})`, 14, y); y += 3;

  doc.autoTable({
    startY: y,
    head: [['Fecha','Factura','Tipo','Proveedor','Concepto','Vence','Estado','Total']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [10, 42, 74], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
    columnStyles: {
      4: { cellWidth: 60 },
      7: { halign: 'right', fontStyle: 'bold' }
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        const v = data.cell.raw;
        if (v === 'VENCIDO') data.cell.styles.textColor = [220, 38, 38];
        else if (v === 'Pagado') data.cell.styles.textColor = [22, 163, 74];
      }
    }
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Smartec · Centro Contable · Página ${i} de ${pages}`,
      pageW / 2, pageH - 8, { align: 'center' }
    );
  }

  doc.save(`smartec_contabilidad_${new Date().toISOString().split('T')[0]}.pdf`);
};

/* ============================================================
   REFRESCAR
============================================================ */
window.forceRefresh = async () => {
  window.SmartecCache.clear();
  await loadAll();
  alert('✅ Datos actualizados desde el servidor');
};

/* Cerrar con ESC */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('may-modal')?.classList.contains('hidden')) return closeWholesaleForm();
    if (!$('nom-colilla-modal').classList.contains('hidden')) return closeNomColilla();
    if (!$('nom-per-detail-modal').classList.contains('hidden')) return closeNomPerDetail();
    if (!$('nom-per-modal').classList.contains('hidden')) return closeNomPerForm();
    if (!$('nom-emp-modal').classList.contains('hidden')) return closeNomEmpForm();
    if (!$('act-dep-modal').classList.contains('hidden')) return closeActDepModal();
    if (!$('act-detail-modal').classList.contains('hidden')) return closeActDetail();
    if (!$('act-modal').classList.contains('hidden')) return closeActForm();
    if (!$('car-detail-modal').classList.contains('hidden')) return closeCarDetail();
    if (!$('car-abono-modal').classList.contains('hidden')) return closeCarAbonoModal();
    if (!$('car-modal').classList.contains('hidden')) return closeCarForm();
    if (!$('conc-detail-modal').classList.contains('hidden')) return closeConcDetail();
    if (!$('conc-modal').classList.contains('hidden')) return closeConcForm();
    if (!$('mayor-detail-modal').classList.contains('hidden')) return closeMayorDetail();
    if (!$('comp-detail-modal').classList.contains('hidden')) return closeCompDetail();
    if (!$('comp-modal').classList.contains('hidden')) return closeCompForm();
    if (!$('puc-modal').classList.contains('hidden')) return closePucForm();
    if (!$('pay-modal').classList.contains('hidden')) return closePayModal();
    if (!$('supplier-modal').classList.contains('hidden')) return closeSupplierForm();
    if (!$('expense-modal').classList.contains('hidden')) return closeExpenseForm();
    if (!$('detail-modal').classList.contains('hidden')) return closeDetail();
    if (!$('cot-detail-modal')?.classList.contains('hidden')) return closeCotDetail();
  }
  
});

