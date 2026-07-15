// ============ Mutazioni del catalogo (Zen-Warehouse) ============
// CRUD + riordino per prodotti, categorie/tipologie, fornitori, punti di consegna.
// Ogni mutazione lavora su `data` e chiama save(). Le categorie e i punti di consegna
// sono ANNIDATI nel doc del locale; prodotti e fornitori sono collezioni top-level (localeId).
import { data, save } from '../state/store.js';
import { uid, round2, normCode } from './util.js';
import { loc, typesOf, subTypes } from './warehouse.js';

// ---- Storico prezzi (Feature 6) ----
// Registra una voce nello storico del prodotto QUANDO il prezzo cambia davvero (tolleranza 0,005 €).
// Voce = {ts, price, source:'manuale'|'xml'|'massiva'}; cap a 50 voci (si tengono le più recenti).
// Ritorna true se una voce è stata aggiunta. Non tocca p.price: lo imposta il chiamante.
export function recordPriceIfChanged(p, newPrice, source) {
  if (!p) return false;
  const price = round2(newPrice);
  if (Math.abs(price - round2(p.price || 0)) < 0.005) return false; // nessuna variazione significativa
  if (!Array.isArray(p.priceHistory)) p.priceHistory = [];
  p.priceHistory.push({ ts: Date.now(), price, source: source || 'manuale' });
  if (p.priceHistory.length > 50) p.priceHistory = p.priceHistory.slice(-50);
  return true;
}
// Aggiorna il prezzo di un prodotto registrando la variazione nello storico (usata dall'import XML).
export function applyPriceUpdate(id, newPrice, source) {
  const p = data.products.find(x => x.id === id); if (!p) return false;
  const changed = recordPriceIfChanged(p, newPrice, source);
  p.price = round2(newPrice); save();
  return changed;
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
function reorder(list, id, dir) {
  const arr = list.slice().sort(byOrder);
  const i = arr.findIndex(x => x.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= arr.length) return false;
  const a = arr[i], b = arr[j];
  const oa = a.order ?? 0, ob = b.order ?? 0;
  a.order = ob; b.order = oa;
  return true;
}

// ---- Prodotti ----
export function addProduct(localeId, rec, priceSource = 'manuale') {
  const order = data.products.filter(p => p.localeId === localeId).length;
  const p = { id: uid(), localeId, name: '', code: '', format: '', typeId: null, supplierId: null, notes: '', order, stockByWh: {}, minStock: 0, targetStock: 0, price: 0, priceHistory: [], ...rec };
  p.code = normCode(p.code);   // canonicalizza il codice (trim + maiuscolo; '' = nessun codice)
  p.price = round2(+p.price || 0);
  // storico prezzi: se il prodotto nasce con un prezzo, seminiamo la prima voce (salvo storico già passato)
  if (!Array.isArray(p.priceHistory)) p.priceHistory = [];
  if (p.price > 0 && !p.priceHistory.length) p.priceHistory.push({ ts: Date.now(), price: p.price, source: priceSource });
  data.products.push(p); save(); return p;
}
export function updateProduct(id, patch) {
  const p = data.products.find(x => x.id === id); if (!p) return;
  if ('code' in patch) patch.code = normCode(patch.code);   // canonicalizza il codice se presente nel patch
  // storico prezzi: se il patch cambia il prezzo, registra la variazione (modifica manuale dall'editor)
  if ('price' in patch) recordPriceIfChanged(p, patch.price, 'manuale');
  Object.assign(p, patch); save();
}
export function deleteProduct(id) {
  const p = data.products.find(x => x.id === id);
  data.products = data.products.filter(x => x.id !== id);
  if (p) { const l = loc(p.localeId); if (l && l.currentOrder) delete l.currentOrder[id]; } // toglilo dall'ordine in corso
  save();
}
export function duplicateProduct(id) {
  const src = data.products.find(x => x.id === id); if (!src) return;
  const order = data.products.filter(p => p.localeId === src.localeId).length;
  // il codice deve restare UNICO: la copia nasce senza codice (l'utente ne assegnerà uno nuovo)
  const copy = { ...src, id: uid(), name: `${src.name} (copia)`, code: '', order, stockByWh: { ...(src.stockByWh || {}) } };
  data.products.push(copy); save(); return copy;
}
// riordino tra prodotti dello STESSO gruppo (stesso localeId + stessa categoria/tipologia)
export function moveProduct(id, dir) {
  const p = data.products.find(x => x.id === id); if (!p) return;
  const group = data.products.filter(x => x.localeId === p.localeId && (x.typeId || null) === (p.typeId || null));
  if (reorder(group, id, dir)) save();
}

// Editor massivo soglie di scorta: applica soglia minima e scorta target a più prodotti in UN colpo.
// vals = { productId: { min, target } }; valori interi ≥ 0 (0 = non impostato). Applica solo ai prodotti
// del locale indicato e salva UNA sola volta. Ritorna il numero di prodotti effettivamente cambiati.
export function applyStockThresholds(localeId, vals) {
  let n = 0;
  Object.entries(vals || {}).forEach(([id, v]) => {
    const p = data.products.find(x => x.id === id && x.localeId === localeId); if (!p) return;
    const min = Math.max(0, parseInt(v?.min, 10) || 0);
    const target = Math.max(0, parseInt(v?.target, 10) || 0);
    if ((p.minStock || 0) === min && (p.targetStock || 0) === target) return; // nessuna variazione
    p.minStock = min; p.targetStock = target; n++;
  });
  if (n) save();
  return n;
}

// riordino via drag-drop: assegna .order = posizione nella sequenza data (per gruppo/lista)
export function reorderProducts(ids) {
  ids.forEach((id, i) => { const p = data.products.find(x => x.id === id); if (p) p.order = i; });
  save();
}

// ---- Categorie / tipologie (annidate nel locale) ----
export function addType(localeId, rec) {
  const l = loc(localeId); if (!l) return;
  const t = { id: uid(), name: '', parentId: null, order: l.types.length, ...rec };
  l.types.push(t); save(); return t;
}
export function updateType(localeId, id, patch) {
  const t = typesOf(localeId).find(x => x.id === id); if (!t) return;
  Object.assign(t, patch); save();
}
export function deleteType(localeId, id) {
  const l = loc(localeId); if (!l) return;
  const t = l.types.find(x => x.id === id);
  // eliminando una categoria principale, le sue sottocategorie diventano principali
  if (t && !t.parentId) l.types.forEach(x => { if (x.parentId === id) x.parentId = null; });
  l.types = l.types.filter(x => x.id !== id);
  // i prodotti che puntavano a questa tipologia restano senza categoria
  data.products.forEach(p => { if (p.localeId === localeId && p.typeId === id) p.typeId = null; });
  save();
}
export function moveType(localeId, id, dir) {
  const t = typesOf(localeId).find(x => x.id === id); if (!t) return;
  const siblings = typesOf(localeId).filter(x => (x.parentId || null) === (t.parentId || null));
  if (reorder(siblings, id, dir)) save();
}

// ---- Fornitori (top-level, localeId) ----
export function addSupplier(localeId, rec) {
  const order = data.suppliers.filter(s => s.localeId === localeId).length;
  const s = { id: uid(), localeId, name: '', email: '', phone: '', note: '', order, ...rec };
  data.suppliers.push(s); save(); return s;
}
export function updateSupplier(id, patch) {
  const s = data.suppliers.find(x => x.id === id); if (!s) return;
  Object.assign(s, patch); save();
}
export function deleteSupplier(id) {
  const s = data.suppliers.find(x => x.id === id);
  data.suppliers = data.suppliers.filter(x => x.id !== id);
  if (s) data.products.forEach(p => { if (p.supplierId === id) p.supplierId = null; });
  save();
}
export function moveSupplier(localeId, id, dir) {
  const group = data.suppliers.filter(s => s.localeId === localeId);
  if (reorder(group, id, dir)) save();
}
export function reorderSuppliers(ids) {
  ids.forEach((id, i) => { const s = data.suppliers.find(x => x.id === id); if (s) s.order = i; });
  save();
}

// ---- Punti di consegna (annidati nel locale) ----
export function addDeliveryPoint(localeId, rec) {
  const l = loc(localeId); if (!l) return;
  const d = { id: uid(), name: '', address: '', contact: '', phone: '', note: '', order: l.deliveryPoints.length, ...rec };
  l.deliveryPoints.push(d); save(); return d;
}
export function updateDeliveryPoint(localeId, id, patch) {
  const d = (loc(localeId)?.deliveryPoints || []).find(x => x.id === id); if (!d) return;
  Object.assign(d, patch); save();
}
export function deleteDeliveryPoint(localeId, id) {
  const l = loc(localeId); if (!l) return;
  l.deliveryPoints = l.deliveryPoints.filter(x => x.id !== id);
  data.products.forEach(p => { if (p.localeId === localeId && p.deliveryPointId === id) p.deliveryPointId = null; });
  save();
}
export function moveDeliveryPoint(localeId, id, dir) {
  const l = loc(localeId); if (!l) return;
  if (reorder(l.deliveryPoints, id, dir)) save();
}
export function reorderDeliveryPoints(localeId, ids) {
  const l = loc(localeId); if (!l) return;
  ids.forEach((id, i) => { const d = l.deliveryPoints.find(x => x.id === id); if (d) d.order = i; });
  save();
}
