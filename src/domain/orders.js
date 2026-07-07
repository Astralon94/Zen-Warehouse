// ============ Ordini: quantità in corso + invio nello storico (Zen-Warehouse) ============
// La schermata Ordine imposta le quantità in `locale.currentOrder` (mappa productId→qty).
// "Inviare" un ordine lo salva in `data.orders` (STORICO — la profondità di Warehouse) e
// azzera l'ordine in corso. In Orders l'ordine era effimero; qui resta consultabile.
import { data, save } from '../state/store.js';
import { uid } from './util.js';
import { loc, product, supplierName, orderLines, currentOrderOf } from './warehouse.js';

// ---- storico ----
export function deleteOrder(id) {
  data.orders = data.orders.filter(o => o.id !== id); save();
}
// "Ri-ordina": ricarica le quantità di un ordine passato nell'ordine in corso del suo locale,
// solo per i prodotti ancora esistenti. Ritorna il numero di righe ricaricate.
export function reorderFrom(order) {
  const l = loc(order.localeId); if (!l) return 0;
  const co = {};
  let n = 0;
  (order.lines || []).forEach(ln => { if (product(ln.productId) && ln.qty > 0) { co[ln.productId] = (co[ln.productId] || 0) + ln.qty; n++; } });
  l.currentOrder = co; save();
  return n;
}

export function setQty(localeId, productId, qty) {
  const l = loc(localeId); if (!l) return;
  qty = Math.max(0, Math.floor(+qty) || 0);
  if (qty > 0) l.currentOrder[productId] = qty;
  else delete l.currentOrder[productId];
  save({ silent: true }); // niente emit/re-render globale: la vista Ordine aggiorna la riga da sé
}
export function addQty(localeId, productId, delta) {
  setQty(localeId, productId, (currentOrderOf(localeId)[productId] || 0) + delta);
}
export function clearOrder(localeId) {
  const l = loc(localeId); if (!l) return;
  l.currentOrder = {}; save();
}

// Conteggi rapidi per la barra in basso.
export function orderTotals(localeId) {
  const co = currentOrderOf(localeId);
  const vals = Object.values(co).filter(q => q > 0);
  return { righe: vals.length, pezzi: vals.reduce((s, q) => s + q, 0) };
}

// Invia l'ordine: crea il record nello storico (righe in ordine di visualizzazione,
// annotando nome/formato/fornitore così restano leggibili anche se il prodotto cambia),
// poi azzera l'ordine in corso. Ritorna l'ordine salvato (per generare subito i PDF).
export function sendOrder(localeId, { deliveryPointId = null, note = '' } = {}) {
  const lines = orderLines(localeId).map(({ p, qty }) => ({
    productId: p.id, name: p.name, qty, format: p.format || '',
    supplierId: p.supplierId || null, supplierName: p.supplierId ? supplierName(p.supplierId) : null,
    notes: p.notes || '',
  }));
  if (!lines.length) return null;
  const now = Date.now();
  const order = {
    id: uid(), localeId, createdAt: now, sentAt: now, status: 'sent',
    deliveryPointId: deliveryPointId || null, note: note || '', lines,
  };
  data.orders.push(order);
  const l = loc(localeId); if (l) l.currentOrder = {};
  save();
  return order;
}
