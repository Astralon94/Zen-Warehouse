// ============ Report/analisi sugli ordini (Zen-Warehouse) ============
// Derivazioni pure sullo storico `data.orders`: top prodotti, volumi per fornitore, andamento
// mensile. Niente stato salvato: tutto ricalcolato dai fatti.
import { ordersOf } from './warehouse.js';

// period: 'all' | '30' | '90' | 'year'
export function ordersInPeriod(localeId, period) {
  const list = ordersOf(localeId);
  if (!period || period === 'all') return list;
  if (period === 'year') { const y = new Date().getFullYear(); return list.filter(o => new Date(o.sentAt || o.createdAt).getFullYear() === y); }
  const days = period === '30' ? 30 : period === '90' ? 90 : 0;
  if (!days) return list;
  const cut = Date.now() - days * 86400000;
  return list.filter(o => (o.sentAt || o.createdAt || 0) >= cut);
}

const MESI_ABBR = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export function monthLabel(ym) { const [y, m] = ym.split('-'); return `${MESI_ABBR[(+m) - 1]} ${y}`; }

export function reportData(localeId, period) {
  const orders = ordersInPeriod(localeId, period);
  const totals = { orders: orders.length, pieces: 0, righe: 0, suppliers: 0 };
  const prodMap = {}, supMap = {}, monthMap = {};

  orders.forEach(o => {
    const mk = new Date(o.sentAt || o.createdAt).toISOString().slice(0, 7);
    const m = monthMap[mk] || (monthMap[mk] = { orders: 0, pieces: 0 });
    m.orders++;
    (o.lines || []).forEach(ln => {
      const qty = ln.qty || 0;
      totals.pieces += qty; totals.righe++; m.pieces += qty;
      const pk = ln.productId || ln.name;
      const p = prodMap[pk] || (prodMap[pk] = { name: ln.name, qty: 0, orders: new Set() });
      p.qty += qty; p.orders.add(o.id);
      const sk = ln.supplierId || '__none__';
      const s = supMap[sk] || (supMap[sk] = { name: ln.supplierName || 'Senza fornitore', pieces: 0, righe: 0, orders: new Set() });
      s.pieces += qty; s.righe++; s.orders.add(o.id);
    });
  });

  const topProducts = Object.values(prodMap).map(p => ({ name: p.name, qty: p.qty, ordini: p.orders.size })).sort((a, b) => b.qty - a.qty);
  const bySupplier = Object.values(supMap).map(s => ({ name: s.name, pieces: s.pieces, righe: s.righe, ordini: s.orders.size })).sort((a, b) => b.pieces - a.pieces);
  const byMonth = Object.entries(monthMap).map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
  totals.suppliers = bySupplier.length;

  return { totals, topProducts, bySupplier, byMonth };
}
