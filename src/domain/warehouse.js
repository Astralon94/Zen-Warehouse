// ============ Logica di dominio: lookup e scope per locale (Zen-Warehouse) ============
// Solo derivazioni pure sui FATTI in `data`. Niente stato salvato di riepilogo.
import { data } from '../state/store.js';

// ---- locale attivo / lookup ----
export const activeLocale = () => data.settings.activeLocale || (data.locali[0]?.id ?? null);
export const loc = id => data.locali.find(l => l.id === id) || null;
export const activeLocaleObj = () => loc(activeLocale());

export const supplier = id => data.suppliers.find(s => s.id === id) || null;
export const product = id => data.products.find(p => p.id === id) || null;

// categorie/tipologie e punti di consegna sono config del locale (annidati nel doc)
export const typesOf = localeId => (loc(localeId)?.types || []);
export const type = (localeId, id) => typesOf(localeId).find(t => t.id === id) || null;
export const topTypes = localeId => typesOf(localeId).filter(t => !t.parentId).slice().sort(byOrder);
export const subTypes = (localeId, parentId) => typesOf(localeId).filter(t => t.parentId === parentId).slice().sort(byOrder);
export const hasSubtypes = (localeId, id) => typesOf(localeId).some(t => t.parentId === id);
export const deliveryPointsOf = localeId => (loc(localeId)?.deliveryPoints || []).slice().sort(byOrder);

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || '');

// ---- entità in scope (per locale) ----
export const suppliersOf = localeId => data.suppliers.filter(s => s.localeId === localeId).slice().sort(byOrder);
export const productsOf = localeId => data.products.filter(p => p.localeId === localeId).slice().sort(byOrder);
export const ordersOf = localeId => data.orders.filter(o => o.localeId === localeId);
export const movesOf = localeId => data.stockMoves.filter(m => m.localeId === localeId);

export const supplierName = id => supplier(id)?.name || '—';
export const typeName = (localeId, id) => type(localeId, id)?.name || '—';

// ---- conteggi per la dashboard ----
export function counts(localeId) {
  return {
    prodotti: productsOf(localeId).length,
    fornitori: suppliersOf(localeId).length,
    categorie: topTypes(localeId).length,
    ordini: ordersOf(localeId).length,
    puntiConsegna: deliveryPointsOf(localeId).length,
  };
}

// prodotti sotto la soglia minima di scorta (per gli avvisi magazzino)
export function lowStock(localeId) {
  return productsOf(localeId).filter(p => (p.minStock || 0) > 0 && (p.stock || 0) <= (p.minStock || 0));
}

// ---- ordine in corso ----
// Sequenza di visualizzazione della schermata Ordine (e dei PDF): categoria → prodotti diretti
// → sottocategorie, tutto per campo .order; in coda i prodotti senza categoria valida.
export function orderSequence(localeId) {
  const byType = {};
  productsOf(localeId).forEach(p => { const k = type(localeId, p.typeId) ? p.typeId : '__none__'; (byType[k] = byType[k] || []).push(p); });
  const seq = [];
  topTypes(localeId).forEach(c => {
    (byType[c.id] || []).forEach(p => seq.push(p));
    subTypes(localeId, c.id).forEach(s => (byType[s.id] || []).forEach(p => seq.push(p)));
  });
  (byType['__none__'] || []).forEach(p => seq.push(p));
  return seq;
}
export const currentOrderOf = localeId => (loc(localeId)?.currentOrder || {});
export const orderQty = (localeId, productId) => currentOrderOf(localeId)[productId] || 0;
// righe attive (qty>0) nell'ordine di visualizzazione
export function orderLines(localeId) {
  const co = currentOrderOf(localeId);
  return orderSequence(localeId).filter(p => (co[p.id] || 0) > 0).map(p => ({ p, qty: co[p.id] }));
}
