// ============ Mutazioni del catalogo (Zen-Warehouse) ============
// CRUD + riordino per prodotti, categorie/tipologie, fornitori, punti di consegna.
// Ogni mutazione lavora su `data` e chiama save(). Le categorie e i punti di consegna
// sono ANNIDATI nel doc del locale; prodotti e fornitori sono collezioni top-level (localeId).
import { data, save } from '../state/store.js';
import { uid } from './util.js';
import { loc, typesOf, subTypes } from './warehouse.js';

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
export function addProduct(localeId, rec) {
  const order = data.products.filter(p => p.localeId === localeId).length;
  const p = { id: uid(), localeId, name: '', format: '', typeId: null, supplierId: null, notes: '', order, stockByWh: {}, minStock: 0, ...rec };
  data.products.push(p); save(); return p;
}
export function updateProduct(id, patch) {
  const p = data.products.find(x => x.id === id); if (!p) return;
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
  const copy = { ...src, id: uid(), name: `${src.name} (copia)`, order, stockByWh: { ...(src.stockByWh || {}) } };
  data.products.push(copy); save(); return copy;
}
// riordino tra prodotti dello STESSO gruppo (stesso localeId + stessa categoria/tipologia)
export function moveProduct(id, dir) {
  const p = data.products.find(x => x.id === id); if (!p) return;
  const group = data.products.filter(x => x.localeId === p.localeId && (x.typeId || null) === (p.typeId || null));
  if (reorder(group, id, dir)) save();
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
