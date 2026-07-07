// ============ Scorte/magazzino: movimenti di carico/scarico/trasferimento (Zen-Warehouse) ============
// Ogni variazione di giacenza è un FATTO in `data.stockMoves`
//   {id,localeId,productId,warehouseId,ts,date,qty,kind,note,orderId}
// I trasferimenti hanno kind:'transfer' con fromWarehouseId (origine) e warehouseId (destinazione).
// La giacenza corrente è per magazzino (`product.stockByWh[whId]`), mantenuta allineata ai movimenti.
import { data, save } from '../state/store.js';
import { uid, todayStr } from './util.js';
import { loc, product, warehousesOf } from './warehouse.js';

function addMove(localeId, productId, warehouseId, qty, kind, note, orderId, extra) {
  data.stockMoves.push({ id: uid(), localeId, productId, warehouseId, ts: Date.now(), date: todayStr(), qty, kind, note: note || '', orderId: orderId || null, ...(extra || {}) });
}
// giacenza corrente di un prodotto in un magazzino
const cur = (p, whId) => (p.stockByWh && p.stockByWh[whId]) || 0;
function setWh(p, whId, val) {
  if (!p.stockByWh || typeof p.stockByWh !== 'object') p.stockByWh = {};
  p.stockByWh[whId] = Math.max(0, Math.floor(val));
}

// carico (+): merce in ingresso in un magazzino
export function stockIn(localeId, productId, whId, qty, note) {
  qty = Math.floor(+qty) || 0; if (qty <= 0 || !whId) return;
  const p = product(productId); if (!p) return;
  setWh(p, whId, cur(p, whId) + qty);
  addMove(localeId, productId, whId, qty, 'in', note);
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

// Ricezione ordine: carica in un magazzino tutte le righe di un ordine (chiude il ciclo
// ordine→ricezione→scorte). Marca l'ordine come ricevuto per evitare doppi carichi.
export function receiveOrder(order, whId) {
  if (!order || order.status === 'received') return 0;
  if (!whId) return 0;
  let n = 0;
  const label = 'Ricezione ordine ' + new Date(order.sentAt || order.createdAt).toLocaleDateString('it-IT');
  (order.lines || []).forEach(ln => {
    const p = product(ln.productId);
    if (p && ln.qty > 0) {
      setWh(p, whId, cur(p, whId) + ln.qty);
      addMove(order.localeId, ln.productId, whId, ln.qty, 'in', label, order.id);
      n++;
    }
  });
  order.status = 'received';
  order.receivedAt = Date.now();
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
