// ============ Scorte/magazzino: movimenti di carico/scarico (Zen-Warehouse) ============
// Ogni variazione di giacenza è un FATTO in `data.stockMoves` {id,localeId,productId,ts,date,qty,kind,note,orderId}.
// La giacenza corrente (`product.stock`) è mantenuta allineata (denormalizzata) per query/avvisi rapidi.
import { data, save } from '../state/store.js';
import { uid, todayStr } from './util.js';
import { product } from './warehouse.js';

function addMove(localeId, productId, qty, kind, note, orderId) {
  data.stockMoves.push({ id: uid(), localeId, productId, ts: Date.now(), date: todayStr(), qty, kind, note: note || '', orderId: orderId || null });
}

// carico (+): merce in ingresso
export function stockIn(localeId, productId, qty, note) {
  qty = Math.floor(+qty) || 0; if (qty <= 0) return;
  const p = product(productId); if (!p) return;
  p.stock = (p.stock || 0) + qty;
  addMove(localeId, productId, qty, 'in', note);
  save();
}
// scarico (−): merce in uscita (non scende sotto 0)
export function stockOut(localeId, productId, qty, note) {
  qty = Math.floor(+qty) || 0; if (qty <= 0) return;
  const p = product(productId); if (!p) return;
  const eff = Math.min(qty, p.stock || 0);
  p.stock = Math.max(0, (p.stock || 0) - qty);
  addMove(localeId, productId, eff || qty, 'out', note);
  save();
}
// rettifica: imposta la giacenza a un valore esatto, registrando il delta come movimento
export function setStock(localeId, productId, target, note) {
  target = Math.max(0, Math.floor(+target) || 0);
  const p = product(productId); if (!p) return;
  const delta = target - (p.stock || 0);
  if (delta === 0) return;
  p.stock = target;
  addMove(localeId, productId, Math.abs(delta), delta > 0 ? 'in' : 'out', note || 'Rettifica');
  save();
}

// movimenti di un prodotto, dal più recente
export function movesForProduct(productId) {
  return data.stockMoves.filter(m => m.productId === productId).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// Ricezione ordine: carica in magazzino tutte le righe di un ordine (chiude il ciclo
// ordine→ricezione→scorte). Marca l'ordine come ricevuto per evitare doppi carichi.
export function receiveOrder(order) {
  if (!order || order.status === 'received') return 0;
  let n = 0;
  const label = 'Ricezione ordine ' + new Date(order.sentAt || order.createdAt).toLocaleDateString('it-IT');
  (order.lines || []).forEach(ln => {
    if (product(ln.productId) && ln.qty > 0) {
      const p = product(ln.productId);
      p.stock = (p.stock || 0) + ln.qty;
      addMove(order.localeId, ln.productId, ln.qty, 'in', label, order.id);
      n++;
    }
  });
  order.status = 'received';
  order.receivedAt = Date.now();
  save();
  return n;
}
