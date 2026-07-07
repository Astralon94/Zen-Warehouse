// ============ Modello dati e default (Zen-Warehouse) ============
// Versione "profonda" e persistente di Zen-Orders. Principio della famiglia: si memorizzano
// i FATTI (locali, prodotti, fornitori, ordini inviati, movimenti scorte); riepiloghi e report
// sono SEMPRE derivati (vedi domain/).
//
// Organizzazione per LOCALE (come in Orders): ogni locale è un contenitore isolato con la sua
// configurazione (categorie/tipologie e punti di consegna, annidati nel doc del locale) e le sue
// entità (prodotti, fornitori, ordini, movimenti) collegate via localeId.

import { uid } from '../domain/util.js';

export const DATA_VERSION = 1;

// Palette zen desaturata condivisa (per etichette categorie/locali).
export const COLORS = [
  '#8B5060', '#A56850', '#BC8C52', '#B19E77', '#9E8B3D', '#9B9959',
  '#9EB15D', '#65C3A0', '#479485', '#45A0B0', '#6788A8', '#6E9DB9',
  '#5F508B', '#9650A5', '#BC5278', '#B1779B', '#9E3D5E', '#9B6759',
  '#B16E5D', '#C39665', '#948147', '#5CB045', '#A8A867', '#B96E6E'
];

// Formati/unità suggeriti per i prodotti (badge come in Orders).
export const FORMATS = ['Pz', 'Kg', 'Gr', 'Lt', 'Ml', 'Ct', 'Cf', 'Bt', 'Cassa', 'Sacco'];

export const DEFAULT_DATA = () => {
  const loc = defaultLocale('loc1', 'Locale 1');
  return {
    version: DATA_VERSION,
    rev: 0, savedAt: 0,
    settings: { theme: 'auto', activeLocale: loc.id },
    // locale: {id,name,emoji,color,note,order, types:[...], deliveryPoints:[...]}
    locali: [loc],
    // fornitore: {id,localeId,name,contact,phone,email,address,note,order}
    suppliers: [],
    // prodotto: {id,localeId,name,typeId,supplierId,deliveryPointId,format,unit,notes,order,stock,minStock}
    products: [],
    // ordine inviato (STORICO): {id,localeId,createdAt,sentAt,status,note, lines:[{productId,name,qty,format,supplierId}]}
    orders: [],
    // movimento scorte: {id,localeId,productId,date,qty,kind:'in'|'out',note,orderId}
    stockMoves: []
  };
};

// Locale: contenitore isolato. types (categorie/tipologie, sottocategoria via parentId) e
// deliveryPoints (punti di consegna) sono configurazione del locale → annidati nel doc.
export function defaultLocale(id, name) {
  return {
    id, name, emoji: '📦', color: '#7a6a99', note: '', order: 0,
    // categorie/tipologie: {id,name,parentId,order}  (parentId!=null → sottocategoria)
    types: [],
    // punti di consegna: {id,name,address,phone,note,order}
    deliveryPoints: []
  };
}

export function newLocale(name) {
  return defaultLocale(uid(), (name || 'Locale').trim() || 'Locale');
}

// Normalizza/ripara un archivio caricato (difensivo, non distruttivo).
export function migrate(d) {
  if (!d || typeof d !== 'object') return DEFAULT_DATA();
  d.version = DATA_VERSION;
  d.rev = d.rev || 0;
  d.savedAt = d.savedAt || 0;
  d.settings = d.settings || { theme: 'auto', activeLocale: null };

  d.locali = Array.isArray(d.locali) && d.locali.length ? d.locali : [defaultLocale('loc1', 'Locale 1')];
  d.locali.forEach((l, i) => {
    if (!l.id) l.id = uid();
    if (l.emoji == null) l.emoji = '📦';
    if (l.color == null) l.color = '#7a6a99';
    if (l.note == null) l.note = '';
    if (l.order == null) l.order = i;
    if (!Array.isArray(l.types)) l.types = [];
    if (!Array.isArray(l.deliveryPoints)) l.deliveryPoints = [];
    l.types.forEach((t, k) => { if (!t.id) t.id = uid(); if (t.parentId === undefined) t.parentId = null; if (t.order == null) t.order = k; });
    l.deliveryPoints.forEach((p, k) => { if (!p.id) p.id = uid(); if (p.order == null) p.order = k; });
  });

  d.suppliers = Array.isArray(d.suppliers) ? d.suppliers : [];
  d.suppliers.forEach((s, i) => { if (!s.id) s.id = uid(); if (s.order == null) s.order = i; });

  d.products = Array.isArray(d.products) ? d.products : [];
  d.products.forEach((p, i) => {
    if (!p.id) p.id = uid();
    if (p.format == null) p.format = '';
    if (p.notes == null) p.notes = '';
    if (p.order == null) p.order = i;
    if (p.stock == null) p.stock = 0;
    if (p.minStock == null) p.minStock = 0;
  });

  d.orders = Array.isArray(d.orders) ? d.orders : [];
  d.orders.forEach(o => { if (!o.id) o.id = uid(); if (!Array.isArray(o.lines)) o.lines = []; if (o.status == null) o.status = 'sent'; });

  d.stockMoves = Array.isArray(d.stockMoves) ? d.stockMoves : [];
  d.stockMoves.forEach(m => { if (!m.id) m.id = uid(); });

  // locale attivo sempre valido
  if (!d.settings.activeLocale || !d.locali.some(l => l.id === d.settings.activeLocale)) {
    d.settings.activeLocale = d.locali[0]?.id || null;
  }
  return d;
}
