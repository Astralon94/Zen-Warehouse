// ============ Persistenza via server locale (node:sqlite) ============
// Fonte di verità durevole: il DB del server. In memoria: `data`.
//  - boot()  → GET  /api/data     (carica lo stato dal DB)
//  - save()  → POST /api/changes  (GRANULARE: invia solo i record cambiati dall'ultimo save)
//  - setData → PUT /api/data       (sostituzione totale, con backup forzato)
// Il frontend continua a mutare `data` e chiamare save(); il diff lo calcola questo modulo.

import { DEFAULT_DATA, migrate, DATA_VERSION } from './model.js';
import { authFetch } from './auth.js';

export let data = DEFAULT_DATA();

// Collezioni versionate (stesso ordine del modello).
const COLLECTION_KEYS = ['locali', 'suppliers', 'products', 'orders', 'stockMoves'];

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

let lastSavedAt = null;
let saveTimer = null;
let inflight = false;
let snapshot = null;

// ---- Stato del salvataggio (spia AFFIDABILE: riflette l'esito reale lato server) ----
// 'saved' = tutto confermato · 'saving' = modifica non ancora confermata · 'error' = ultima scrittura fallita
// 'conflict' = il server ha rifiutato (409): un'altra scheda ha scritto → attende scelta utente
let dirty = false, errored = false;
let conflict = false;   // il server ha rifiutato (409): un'altra scheda ha scritto → attende scelta utente
let serverRev = null;   // revisione attuale del server comunicata col 409 (per il "forza")
const statusListeners = new Set();
export function onSaveStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }
export const subscribeStatus = onSaveStatus;                 // compat col vecchio nome
export function saveStatus() { return conflict ? 'conflict' : errored ? 'error' : (inflight || dirty) ? 'saving' : 'saved'; }
export const persistStatus = () => ({ lastSnapshotAt: lastSavedAt, lastBackupAt: 0 }); // compat (badge vecchio)
function notifyStatus() { const s = saveStatus(); statusListeners.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } }); }

// ---- Snapshot & diff -------------------------------------------------------
function snapOf(d) {
  const s = {};
  for (const k of COLLECTION_KEYS) {
    const m = new Map();
    for (const rec of (d[k] || [])) if (rec && rec.id != null) m.set(rec.id, JSON.stringify(rec));
    s[k] = m;
  }
  s.__settings = JSON.stringify(d.settings || {});
  return s;
}
function diff(prev, d) {
  const collections = {};
  let any = false;
  for (const k of COLLECTION_KEYS) {
    const pm = prev[k] || new Map();
    const upsert = [], remove = [], seen = new Set();
    for (const rec of (d[k] || [])) {
      if (!rec || rec.id == null) continue;
      seen.add(rec.id);
      if (pm.get(rec.id) !== JSON.stringify(rec)) upsert.push(rec);
    }
    for (const id of pm.keys()) if (!seen.has(id)) remove.push(id);
    if (upsert.length || remove.length) { collections[k] = { upsert, remove }; any = true; }
  }
  const out = { collections };
  if (JSON.stringify(d.settings || {}) !== prev.__settings) { out.settings = d.settings || {}; any = true; }
  return any ? out : null;
}

// ---- Boot ----
export async function boot() {
  try {
    const res = await authFetch('/api/data');
    data = res.ok ? migrate(await res.json()) : DEFAULT_DATA();
  } catch (e) { console.error('Boot: server non raggiungibile', e); data = DEFAULT_DATA(); }
  snapshot = snapOf(data);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }
  emit();
}

// ---- Save: invia solo il diff (debounced) ----
export function save({ silent = false } = {}) {
  // NB: `data.rev` NON si incrementa qui — riflette solo la revisione confermata dal server
  // (aggiornata dalla risposta di /api/changes). È la base della guardia di concorrenza 409.
  data.savedAt = Date.now();
  data.version = DATA_VERSION;
  dirty = true; notifyStatus();          // c'è qualcosa di non ancora confermato dal server
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushChanges, 300);
  if (!silent) emit();
}
export function setTheme(t) { data.settings.theme = t; save(); }

async function flushChanges() {
  if (!snapshot) return;
  if (conflict) return; // in conflitto: si attende la scelta dell'utente (ricarica/forza), niente auto-save
  if (inflight) { clearTimeout(saveTimer); saveTimer = setTimeout(flushChanges, 200); return; }
  const cs = diff(snapshot, data);
  if (!cs) { dirty = false; errored = false; notifyStatus(); return; } // niente da inviare = già in sync
  cs.baseRev = data.rev ?? null; // revisione su cui si basano queste modifiche (guardia 409 lato server)
  const sent = snapOf(data);
  inflight = true; dirty = false; notifyStatus();
  try {
    const res = await authFetch('/api/changes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cs) });
    if (res.ok) { const j = await res.json(); if (j && j.rev) data.rev = j.rev; snapshot = sent; lastSavedAt = Date.now(); errored = false; }
    else if (res.status === 409) { // un'altra scheda ha scritto: NON sovrascrivere, chiedi all'utente
      const j = await res.json().catch(() => ({}));
      serverRev = (j && j.rev != null) ? j.rev : null;
      conflict = true; dirty = true; errored = false; // modifiche locali conservate
      console.warn('Conflitto di concorrenza: il database è stato modificato altrove.');
    }
    else { errored = true; dirty = true; console.error('Salvataggio non riuscito:', res.status); } // NON confermato → resta da salvare
  } catch (e) { errored = true; dirty = true; console.error('Errore di salvataggio:', e); }
  finally {
    inflight = false; notifyStatus();
    if (dirty && !conflict) { clearTimeout(saveTimer); saveTimer = setTimeout(flushChanges, errored ? 3000 : 250); } // riprova (non in conflitto)
  }
}

// Ricarica lo stato dal server SCARTANDO le modifiche locali non salvate (scelta "Ricarica" nel conflitto).
export async function reloadFromServer() {
  try {
    const res = await authFetch('/api/data');
    if (!res.ok) return false;
    data = migrate(await res.json());
    snapshot = snapOf(data);
    conflict = false; dirty = false; errored = false; serverRev = null;
    notifyStatus(); emit();
    return true;
  } catch (e) { return false; }
}

// Forza il salvataggio delle modifiche locali sovrascrivendo l'altra scheda (scelta "Forza" nel conflitto):
// allinea il baseRev alla revisione attuale del server, così il prossimo changeset viene accettato.
export function forceSave() {
  if (serverRev != null) data.rev = serverRev;
  conflict = false; serverRev = null; dirty = true; notifyStatus();
  clearTimeout(saveTimer); saveTimer = setTimeout(flushChanges, 0);
}

// Sostituzione TOTALE (import/wipe): PUT dell'intero stato + backup forzato lato server.
async function putWhole({ force = false } = {}) {
  inflight = true; notifyStatus();
  try {
    const res = await authFetch('/api/data' + (force ? '?force=1' : ''), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (res.ok) { const j = await res.json(); if (j && j.rev) data.rev = j.rev; lastSavedAt = Date.now(); dirty = false; errored = false; }
    else { errored = true; console.error('Salvataggio totale non riuscito:', res.status); }
  } catch (e) { errored = true; console.error('Errore salvataggio totale:', e); }
  finally { inflight = false; notifyStatus(); }
}

export function setData(newData, { persist = true } = {}) {
  data = migrate(newData);
  snapshot = snapOf(data);
  if (persist) putWhole({ force: true });
  emit();
}

export function flush() {
  if (!snapshot || conflict) return;
  const cs = diff(snapshot, data);
  if (!cs) return;
  cs.baseRev = data.rev ?? null; // se un'altra scheda ha già scritto, il server rifiuta (protegge i dati)
  try {
    authFetch('/api/changes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cs), keepalive: true });
  } catch (e) {}
}

// ---- Compat "vault"/FSA: nel modello server lo store durevole è il DB ----
export const fileSupported = () => false;
export const vaultStatus = () => ({ supported: true, active: true, needsPerm: false, name: 'server' });
export async function connectVault() { return { ok: true }; }
export async function reauthorizeVault() { return { ok: true }; }
export async function disconnectVault() { return { ok: false }; }
export async function listRestorePoints() { return []; }
export async function restorePoint() { return { ok: false }; }
