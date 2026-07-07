// ============ Scorte/magazzino: movimenti di carico/scarico/trasferimento (Zen-Warehouse) ============
// Ogni variazione di giacenza è un FATTO in `data.stockMoves`
//   {id,localeId,productId,warehouseId,ts,date,qty,kind,note,orderId}
// I trasferimenti hanno kind:'transfer' con fromWarehouseId (origine) e warehouseId (destinazione).
// La giacenza corrente è per magazzino (`product.stockByWh[whId]`), mantenuta allineata ai movimenti.
import { data, save } from '../state/store.js';
import { uid, todayStr } from './util.js';
import { loc, product, warehousesOf, ordersOf, supplierName } from './warehouse.js';

function addMove(localeId, productId, warehouseId, qty, kind, note, orderId, extra) {
  data.stockMoves.push({ id: uid(), localeId, productId, warehouseId, ts: Date.now(), date: todayStr(), qty, kind, note: note || '', orderId: orderId || null, ...(extra || {}) });
}
// giacenza corrente di un prodotto in un magazzino
const cur = (p, whId) => (p.stockByWh && p.stockByWh[whId]) || 0;
function setWh(p, whId, val) {
  if (!p.stockByWh || typeof p.stockByWh !== 'object') p.stockByWh = {};
  p.stockByWh[whId] = Math.max(0, Math.floor(val));
}

// carico (+): merce in ingresso in un magazzino (orderId opzionale: link al movimento di ricezione)
export function stockIn(localeId, productId, whId, qty, note, orderId) {
  qty = Math.floor(+qty) || 0; if (qty <= 0 || !whId) return;
  const p = product(productId); if (!p) return;
  setWh(p, whId, cur(p, whId) + qty);
  addMove(localeId, productId, whId, qty, 'in', note, orderId);
  save();
}
// scarico (−): merce in uscita da un magazzino (non scende sotto 0)
export function stockOut(localeId, productId, whId, qty, note) {
  qty = Math.floor(+qty) || 0; if (qty <= 0 || !whId) return;
  const p = product(productId); if (!p) return;
  const eff = Math.min(qty, cur(p, whId));
  setWh(p, whId, cur(p, whId) - qty);
  addMove(localeId, productId, whId, eff || qty, 'out', note);
  save();
}
// rettifica: imposta la giacenza di un magazzino a un valore esatto, registrando il delta come movimento
export function setStock(localeId, productId, whId, target, note) {
  target = Math.max(0, Math.floor(+target) || 0);
  const p = product(productId); if (!p || !whId) return;
  const delta = target - cur(p, whId);
  if (delta === 0) return;
  setWh(p, whId, target);
  addMove(localeId, productId, whId, Math.abs(delta), delta > 0 ? 'in' : 'out', note || 'Rettifica');
  save();
}
// trasferimento: sposta quantità da un magazzino all'altro (clamp al disponibile in origine)
export function transfer(localeId, productId, fromWh, toWh, qty, note) {
  qty = Math.floor(+qty) || 0;
  const p = product(productId); if (!p || !fromWh || !toWh || fromWh === toWh || qty <= 0) return 0;
  const eff = Math.min(qty, cur(p, fromWh));
  if (eff <= 0) return 0;
  setWh(p, fromWh, cur(p, fromWh) - eff);
  setWh(p, toWh, cur(p, toWh) + eff);
  addMove(localeId, productId, toWh, eff, 'transfer', note, null, { fromWarehouseId: fromWh });
  save();
  return eff;
}

// movimenti di un prodotto, dal più recente
export function movesForProduct(productId) {
  return data.stockMoves.filter(m => m.productId === productId).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// ---- Schede di movimento (DDT interno): trasferimenti/prelievi MULTI-prodotto ----
// Una "scheda" è DERIVATA: raggruppa i movimenti che condividono un `batchId` nel loro doc.
// Nessuna collezione/schema nuovo: i campi extra (`batchId`,`batchType`,`note`,`name`) vivono nel
// doc dei movimenti. Trasferimento → move kind:'transfer' (fromWh−, toWh+); Prelievo → move kind:'out'.
// `payload`: { type:'transfer'|'prelievo', fromWh, toWh, note, lines:[{productId, qty}] }.
// Ritorna la scheda { batchId, type, fromWh, toWh, note, date, ts, lines:[{productId,name,qty,format}] }.
export function applyMovementBatch(localeId, { type, fromWh, toWh, note, lines }) {
  const isTransfer = type === 'transfer';
  if (!fromWh) return null;
  if (isTransfer && (!toWh || toWh === fromWh)) return null;
  const batchId = uid();
  const ts = Date.now();
  const date = todayStr();
  note = (note || '').trim();
  const out = [];
  (lines || []).forEach(ln => {
    const p = product(ln.productId); if (!p) return;
    const want = Math.floor(+ln.qty) || 0; if (want <= 0) return;
    const eff = Math.min(want, cur(p, fromWh)); if (eff <= 0) return; // clamp al disponibile in origine
    const extra = { batchId, batchType: type, note, name: p.name };
    if (isTransfer) {
      setWh(p, fromWh, cur(p, fromWh) - eff);
      setWh(p, toWh, cur(p, toWh) + eff);
      addMove(localeId, p.id, toWh, eff, 'transfer', note, null, { ...extra, fromWarehouseId: fromWh });
    } else {
      setWh(p, fromWh, cur(p, fromWh) - eff);
      addMove(localeId, p.id, fromWh, eff, 'out', note, null, extra);
    }
    out.push({ productId: p.id, name: p.name, format: p.format || '', qty: eff });
  });
  if (!out.length) return null;
  save();
  return { batchId, type, fromWh, toWh: isTransfer ? toWh : null, note, date, ts, lines: out };
}

// ricostruisce le schede del locale dai movimenti con `batchId`, dalla più recente
export function schede(localeId) {
  const byBatch = new Map();
  data.stockMoves.forEach(m => {
    if (m.localeId !== localeId || !m.batchId) return;
    let s = byBatch.get(m.batchId);
    if (!s) {
      const isTransfer = (m.batchType || (m.kind === 'transfer' ? 'transfer' : 'prelievo')) === 'transfer';
      s = {
        batchId: m.batchId,
        type: isTransfer ? 'transfer' : 'prelievo',
        fromWh: isTransfer ? m.fromWarehouseId : m.warehouseId,
        toWh: isTransfer ? m.warehouseId : null,
        note: m.note || '',
        ts: m.ts || 0,
        date: m.date || '',
        lines: [],
      };
      byBatch.set(m.batchId, s);
    }
    s.lines.push({ name: m.name || (product(m.productId)?.name) || '—', qty: m.qty || 0 });
    if ((m.ts || 0) < s.ts) { s.ts = m.ts || 0; s.date = m.date || s.date; }
  });
  return [...byBatch.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export function schedaById(localeId, batchId) {
  return schede(localeId).find(s => s.batchId === batchId) || null;
}

// chiave di raggruppamento per fornitore di una riga d'ordine ('__none__' se senza fornitore)
const supKey = ln => ln.supplierId || '__none__';
// insieme dei gruppi-fornitore presenti in un ordine
const supplierGroupsOf = order => [...new Set((order.lines || []).map(supKey))];
// un ordine è "tutto ricevuto" quando ogni gruppo-fornitore è in receivedSuppliers
function allSuppliersReceived(order) {
  const rec = order.receivedSuppliers || {};
  return supplierGroupsOf(order).every(k => rec[k] != null);
}

// Ricezione ordine INTERA (usata dallo Storico): carica in un magazzino tutte le righe di un
// ordine (chiude il ciclo ordine→ricezione→scorte). Marca l'ordine come ricevuto per evitare
// doppi carichi, e allinea lo stato per-fornitore (tutti i gruppi ricevuti).
export function receiveOrder(order, whId) {
  if (!order || order.status === 'received') return 0;
  if (!whId) return 0;
  let n = 0;
  const now = Date.now();
  const label = 'Ricezione ordine ' + new Date(order.sentAt || order.createdAt).toLocaleDateString('it-IT');
  (order.lines || []).forEach(ln => {
    const p = product(ln.productId);
    if (p && ln.qty > 0) {
      setWh(p, whId, cur(p, whId) + ln.qty);
      addMove(order.localeId, ln.productId, whId, ln.qty, 'in', label, order.id);
      n++;
    }
  });
  if (!order.receivedSuppliers || typeof order.receivedSuppliers !== 'object') order.receivedSuppliers = {};
  supplierGroupsOf(order).forEach(k => { if (order.receivedSuppliers[k] == null) order.receivedSuppliers[k] = now; });
  order.status = 'received';
  order.receivedAt = now;
  save();
  return n;
}

// "Fette" di ricezione ancora pendenti nel locale, per la ricezione rapida per fornitore in Magazzino.
// Per ogni ordine (dal più recente) e per ogni gruppo-fornitore NON ancora in receivedSuppliers,
// una fetta { order, supplierId, supplierName, lines:[{productId,name,format,qty,notes}] }.
export function pendingReceipts(localeId) {
  const orders = ordersOf(localeId).slice().sort((a, b) => (b.sentAt || b.createdAt || 0) - (a.sentAt || a.createdAt || 0));
  const slices = [];
  orders.forEach(order => {
    const rec = order.receivedSuppliers || {};
    // raggruppa le righe per fornitore mantenendo l'ordine di comparsa
    const groups = {}, keys = [];
    (order.lines || []).forEach(ln => {
      const k = supKey(ln);
      if (!groups[k]) { groups[k] = []; keys.push(k); }
      groups[k].push(ln);
    });
    keys.forEach(k => {
      if (rec[k] != null) return; // gruppo-fornitore già ricevuto
      const lines = groups[k].map(ln => ({ productId: ln.productId, name: ln.name, format: ln.format || '', qty: ln.qty, notes: ln.notes || '' }));
      const sName = k === '__none__' ? 'Senza fornitore' : (groups[k][0].supplierName || supplierName(k));
      slices.push({ order, supplierId: k, supplierName: sName, lines });
    });
  });
  return slices;
}

// Ricezione rapida di UN fornitore di un ordine: carica in whId le righe di quel fornitore, usando
// le quantità effettivamente arrivate da qtyById[productId] se presenti (altrimenti la qty ordinata).
// Marca receivedSuppliers[supplierId]; se ora tutti i gruppi sono ricevuti → status:'received'.
// Ritorna il numero di prodotti caricati.
export function receiveOrderSupplier(order, supplierId, whId, qtyById) {
  if (!order || !whId) return 0;
  const rec = (order.receivedSuppliers && typeof order.receivedSuppliers === 'object') ? order.receivedSuppliers : (order.receivedSuppliers = {});
  if (rec[supplierId] != null) return 0; // già ricevuto
  const q = qtyById || {};
  const now = Date.now();
  const label = 'Ricezione ordine ' + new Date(order.sentAt || order.createdAt).toLocaleDateString('it-IT');
  let n = 0;
  (order.lines || []).forEach(ln => {
    if (supKey(ln) !== supplierId) return;
    const qty = q[ln.productId] != null ? (Math.floor(+q[ln.productId]) || 0) : ln.qty;
    stockIn(order.localeId, ln.productId, whId, qty, label, order.id);
    if (qty > 0) n++;
  });
  rec[supplierId] = now;
  if (allSuppliersReceived(order)) { order.status = 'received'; order.receivedAt = now; }
  save();
  return n;
}

// ---- Gestione magazzini (mutazioni annidate nel locale) ----
export function addWarehouse(localeId, name) {
  const l = loc(localeId); if (!l) return null;
  if (!Array.isArray(l.warehouses)) l.warehouses = [];
  const w = { id: uid(), name: (name || '').trim() || 'Magazzino', order: l.warehouses.length };
  l.warehouses.push(w); save(); return w;
}
export function renameWarehouse(localeId, whId, name) {
  const w = warehousesOf(localeId).find(x => x.id === whId); if (!w) return;
  w.name = (name || '').trim() || w.name; save();
}
// elimina un magazzino: impedito se è l'ultimo; la giacenza viene travasata nel primo rimasto
export function deleteWarehouse(localeId, whId) {
  const l = loc(localeId); if (!l) return false;
  const list = warehousesOf(localeId);
  if (list.length <= 1) return false; // non eliminare l'ultimo
  const target = list.find(w => w.id !== whId); // primo magazzino rimasto
  if (!target) return false;
  // travasa la giacenza dei prodotti dal magazzino eliminato al target (nessuna perdita)
  data.products.forEach(p => {
    if (p.localeId !== localeId || !p.stockByWh) return;
    const q = p.stockByWh[whId];
    if (q) { p.stockByWh[target.id] = (p.stockByWh[target.id] || 0) + q; }
    delete p.stockByWh[whId];
  });
  l.warehouses = l.warehouses.filter(w => w.id !== whId);
  save(); return true;
}
export function reorderWarehouses(localeId, ids) {
  const l = loc(localeId); if (!l) return;
  ids.forEach((id, i) => { const w = (l.warehouses || []).find(x => x.id === id); if (w) w.order = i; });
  save();
}
