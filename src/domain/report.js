// ============ Report/analisi sugli ordini (Zen-Warehouse) ============
// Derivazioni pure sullo storico `data.orders`. Metrica PRINCIPALE = la SPESA (€): per riga
// = qty × prezzo di acquisto. Il prezzo è lo snapshot salvato sulla riga all'invio (ln.price);
// per le righe storiche senza prezzo si ricade sul prezzo attuale del prodotto, altrimenti 0
// (e si segnala `partialPrices`). I pezzi restano come metrica secondaria. Niente stato salvato.
// I filtri (periodo/intervallo/fornitore/categoria) sono combinabili e ricalcolano KPI e aggregati.
import { ordersOf, product, type, subTypes, topTypes } from './warehouse.js';
import { round2 } from './util.js';

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

// timestamp inizio/fine giornata locale da una stringa 'YYYY-MM-DD'
function dayStart(s) { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d.getTime(); }
function dayEnd(s) { const d = new Date(s + 'T23:59:59.999'); return isNaN(d) ? null : d.getTime(); }

// insieme dei typeId "in scope" per una categoria (la categoria stessa + le sue sottocategorie)
function categoryScope(localeId, categoryId) {
  const ids = new Set([categoryId]);
  subTypes(localeId, categoryId).forEach(s => ids.add(s.id));
  return ids;
}

// categoria principale (top-level) a cui appartiene un prodotto; ritorna {id,name} o null
function topCategoryOf(localeId, typeId) {
  if (!typeId) return null;
  let t = type(localeId, typeId);
  if (!t) return null;
  while (t.parentId) { const parent = type(localeId, t.parentId); if (!parent) break; t = parent; }
  return { id: t.id, name: t.name };
}

// reportData(localeId, { period, from, to, supplierId, categoryId })
// L'intervallo esplicito (from/to) sovrascrive il preset periodo. Fornitore e categoria filtrano
// per riga. Restituisce KPI derivati + aggregati ordinati.
export function reportData(localeId, opts = {}) {
  const { period = 'all', from = '', to = '', supplierId = '', categoryId = '' } = (typeof opts === 'string' ? { period: opts } : opts);

  // 1) filtro temporale: intervallo esplicito ha precedenza sul preset
  let orders;
  const fromTs = from ? dayStart(from) : null;
  const toTs = to ? dayEnd(to) : null;
  if (fromTs != null || toTs != null) {
    orders = ordersOf(localeId).filter(o => {
      const t = o.sentAt || o.createdAt || 0;
      if (fromTs != null && t < fromTs) return false;
      if (toTs != null && t > toTs) return false;
      return true;
    });
  } else {
    orders = ordersInPeriod(localeId, period);
  }

  // scope della categoria (typeId ammessi), se filtro attivo
  const catScope = categoryId ? categoryScope(localeId, categoryId) : null;
  const lineOk = (ln) => {
    if (supplierId && (ln.supplierId || '__none__') !== supplierId) return false;
    if (catScope) { const tId = product(ln.productId)?.typeId; if (!catScope.has(tId)) return false; }
    return true;
  };

  // prezzo di una riga: snapshot salvato all'invio (ln.price); fallback sul prezzo attuale del
  // prodotto (approssimato) e, se assente, 0. `partialPrices` segnala che alcune righe non
  // avevano lo snapshot → i totali di spesa sono parziali/approssimati.
  let partialPrices = false;
  const priceOf = (ln) => {
    if (ln.price != null && ln.price !== '') return +ln.price || 0;
    partialPrices = true;
    const p = product(ln.productId);
    return p ? (+p.price || 0) : 0;
  };

  const totals = { orders: 0, pieces: 0, righe: 0, suppliers: 0, spend: 0 };
  const prodMap = {}, supMap = {}, monthMap = {}, catMap = {};

  orders.forEach(o => {
    const lines = (o.lines || []).filter(lineOk);
    if (!lines.length) return; // l'ordine non conta se nessuna riga passa i filtri
    totals.orders++;
    const mk = new Date(o.sentAt || o.createdAt).toISOString().slice(0, 7);
    const m = monthMap[mk] || (monthMap[mk] = { orders: 0, pieces: 0, spend: 0 });
    m.orders++;
    lines.forEach(ln => {
      const qty = ln.qty || 0;
      const spend = round2(qty * priceOf(ln));
      totals.pieces += qty; totals.righe++; totals.spend = round2(totals.spend + spend);
      m.pieces += qty; m.spend = round2(m.spend + spend);
      const pk = ln.productId || ln.name;
      const p = prodMap[pk] || (prodMap[pk] = { name: ln.name, qty: 0, spend: 0, orders: new Set() });
      p.qty += qty; p.spend = round2(p.spend + spend); p.orders.add(o.id);
      const sk = ln.supplierId || '__none__';
      const s = supMap[sk] || (supMap[sk] = { name: ln.supplierName || 'Senza fornitore', pieces: 0, spend: 0, righe: 0, orders: new Set() });
      s.pieces += qty; s.spend = round2(s.spend + spend); s.righe++; s.orders.add(o.id);
      // ripartizione per categoria principale (dal catalogo attuale)
      const cat = topCategoryOf(localeId, product(ln.productId)?.typeId);
      const ck = cat?.id || '__none__';
      const c = catMap[ck] || (catMap[ck] = { name: cat?.name || 'Senza categoria', pieces: 0, spend: 0, righe: 0 });
      c.pieces += qty; c.spend = round2(c.spend + spend); c.righe++;
    });
  });

  // aggregati ordinati per SPESA (metrica principale); i pezzi restano come dato secondario
  const topProducts = Object.values(prodMap).map(p => ({ name: p.name, qty: p.qty, spend: p.spend, ordini: p.orders.size })).sort((a, b) => b.spend - a.spend || b.qty - a.qty);
  const bySupplier = Object.values(supMap).map(s => ({ name: s.name, pieces: s.pieces, spend: s.spend, righe: s.righe, ordini: s.orders.size })).sort((a, b) => b.spend - a.spend || b.pieces - a.pieces);
  const byCategory = Object.values(catMap).map(c => ({ name: c.name, pieces: c.pieces, spend: c.spend, righe: c.righe })).sort((a, b) => b.spend - a.spend || b.pieces - a.pieces);
  const byMonth = Object.entries(monthMap).map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
  totals.suppliers = bySupplier.length;

  // KPI derivati aggiuntivi
  const avgPerOrder = totals.orders ? Math.round(totals.pieces / totals.orders) : 0;
  const avgSpendPerOrder = totals.orders ? round2(totals.spend / totals.orders) : 0;
  const topSupplier = bySupplier[0]?.name || '—';
  const topProduct = topProducts[0]?.name || '—';

  return { totals, topProducts, bySupplier, byCategory, byMonth, avgPerOrder, avgSpendPerOrder, topSupplier, topProduct, partialPrices };
}

// lista categorie principali del locale, per popolare il filtro (id/name)
export function reportCategories(localeId) {
  return topTypes(localeId).map(t => ({ id: t.id, name: t.name }));
}
