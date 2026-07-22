// Test d'integrità (Zen-Warehouse): import → export lossless + rev monotòno + changeset granulare.
// Gira su DB in memoria per non toccare il file reale.
process.env.ZEN_DB = ':memory:';
import assert from 'node:assert/strict';
const { importData, exportData, applyChanges } = await import('../server/serialize.js');

// Dataset ricco e rappresentativo dello schema REALE di Warehouse:
//  - `locali`: con types[] (categorie/tipologie + sottocategoria via parentId), warehouses[]
//    (magazzini fisici), deliveryPoints[], supplierNotes{} e currentOrder{} ANNIDATI nel doc del locale;
//  - `suppliers`, `products` (con stockByWh{} per magazzino e minStock globale);
//  - `orders`: storico, con lines[] e supplierNotes{} snapshot;
//  - `stockMoves`: movimenti di magazzino (con warehouseId; transfer con fromWarehouseId).
const sample = {
  version: 2, rev: 4, savedAt: 123,
  settings: { theme: 'dark', activeLocale: 'loc1' },
  locali: [{
    id: 'loc1', name: 'Bistrot Centro', emoji: '📦', color: '#7a6a99', note: 'sede principale', order: 0,
    types: [
      { id: 'ty-bev', name: 'Bevande', parentId: null, order: 0 },
      { id: 'ty-vin', name: 'Vini', parentId: 'ty-bev', order: 1 },
      { id: 'ty-food', name: 'Cucina', parentId: null, order: 2 },
    ],
    warehouses: [
      { id: 'wh1', name: 'Magazzino principale', order: 0, typeIds: [] },        // nessun limite = tutte le categorie
      { id: 'wh2', name: 'Cella frigo', order: 1, typeIds: ['ty-food'] },         // solo la categoria "Cucina"
    ],
    deliveryPoints: [
      { id: 'dp1', name: 'Magazzino Retro', address: 'Via Roma 1', phone: '011-123', note: 'suonare due volte', order: 0 },
    ],
    supplierNotes: { 'sup1': 'Consegnare entro le 10', '__none__': 'Nota generica' },
    currentOrder: { 'prod2': 3 },
    // DDT interni differiti DA CONSEGNARE annidati nel doc del locale (come currentOrder/supplierNotes):
    // un trasferimento wh1→wh2 e un'uscita "fuori magazzino" (destLabel), entrambi in attesa di convalida.
    pendingTransfers: [
      { id: 'pt1', createdAt: 1720000200000, type: 'transfer', fromWh: 'wh1', toWh: 'wh2', destLabel: '', note: 'riassortimento', status: 'pending', lines: [{ productId: 'prod1', name: 'Barolo DOCG', code: 'BAR-001', format: 'Bt', qty: 2 }] },
      { id: 'pt2', createdAt: 1720000300000, type: 'out', fromWh: 'wh1', toWh: null, destLabel: 'Evento sala', note: '', status: 'pending', lines: [{ productId: 'prod3', name: 'Sale', format: 'Cf', qty: 1 }] },
    ],
  }],
  suppliers: [
    { id: 'sup1', localeId: 'loc1', name: 'Cantina Rossi', contact: 'Luca', phone: '333-1', email: 'l@r.it', address: 'Via A 2', note: '', order: 0 },
    { id: 'sup2', localeId: 'loc1', name: 'Ortofrutta Bio', contact: '', phone: '', email: '', address: '', note: 'bio certificato', order: 1 },
  ],
  products: [
    { id: 'prod1', localeId: 'loc1', name: 'Barolo DOCG', code: 'BAR-001', typeId: 'ty-vin', supplierId: 'sup1', deliveryPointId: 'dp1', format: 'Bt', unit: '', notes: 'annata 2019', order: 0, stockByWh: { wh1: 8, wh2: 4 }, minStock: 6, targetStock: 12, price: 12.5, priceHistory: [{ ts: 1710000000000, price: 11.9, source: 'manuale' }, { ts: 1720000000000, price: 12.5, source: 'xml' }] },
    { id: 'prod2', localeId: 'loc1', name: 'Pomodori', typeId: 'ty-food', supplierId: 'sup2', deliveryPointId: null, format: 'Kg', unit: '', notes: '', order: 1, stockByWh: {}, minStock: 5, targetStock: 0, price: 2.4, priceHistory: [] },
    { id: 'prod3', localeId: 'loc1', name: 'Sale', typeId: null, supplierId: null, deliveryPointId: null, format: 'Cf', unit: '', notes: '', order: 2, stockByWh: { wh1: 3 }, minStock: 0, targetStock: 0, price: 0, priceHistory: [] },
  ],
  orders: [{
    id: 'ord1', localeId: 'loc1', createdAt: 100, sentAt: 100, status: 'sent',
    deliveryPointId: 'dp1', note: 'urgente',
    supplierNotes: { 'sup1': 'Consegnare entro le 10' },
    receivedSuppliers: { 'sup1': 1720000000000 }, // ricezione per-fornitore: sup1 già ricevuto, sup2/__none__ pendenti
    dismissedSuppliers: { '__none__': 1720000100000 }, // slice-fornitore scartata (non ricevuta, nessun carico)
    lines: [
      { productId: 'prod1', name: 'Barolo DOCG', qty: 6, format: 'Bt', supplierId: 'sup1', supplierName: 'Cantina Rossi', notes: 'annata 2019', price: 12.5 },
      { productId: 'prod2', name: 'Pomodori', qty: 10, format: 'Kg', supplierId: 'sup2', supplierName: 'Ortofrutta Bio', notes: '', price: 2.4 },
      { productId: 'prod3', name: 'Sale', qty: 2, format: 'Cf', supplierId: null, supplierName: null, notes: '', price: 0 },
    ],
  }],
  stockMoves: [
    { id: 'mv1', localeId: 'loc1', productId: 'prod1', warehouseId: 'wh1', date: '2026-07-01', qty: 6, kind: 'in', note: 'ricezione ordine', orderId: 'ord1' },
    { id: 'mv2', localeId: 'loc1', productId: 'prod3', warehouseId: 'wh1', date: '2026-07-02', qty: 1, kind: 'out', note: 'consumo' },
    { id: 'mv3', localeId: 'loc1', productId: 'prod1', warehouseId: 'wh2', fromWarehouseId: 'wh1', date: '2026-07-03', qty: 4, kind: 'transfer', note: 'sposta in cella' },
    // rettifica SINGOLA (setStock): marcatore batchType:'rettifica' SENZA batchId + before/after (prima→dopo)
    { id: 'mv4', localeId: 'loc1', productId: 'prod3', warehouseId: 'wh1', date: '2026-07-04', qty: 2, kind: 'in', note: 'Rettifica', batchType: 'rettifica', before: 1, after: 3 },
  ],
};

const dropMeta = (o) => { const { rev, savedAt, version, ...rest } = o; return rest; };

importData(structuredClone(sample));
const out1 = exportData();
assert.equal(out1.rev, 5, 'rev deve diventare max(4,0)+1 = 5');
assert.deepEqual(dropMeta(out1), dropMeta(sample), 'export deve coincidere col sample (lossless, incl. types/warehouses/deliveryPoints/supplierNotes/currentOrder annidati)');
console.log('✓ round-trip lossless (con nidificazione locale: types, warehouses, deliveryPoints, supplierNotes, currentOrder)');

// Verifica puntuale delle entità annidate/collezioni (oltre alla deepEqual globale).
const l = out1.locali[0];
assert.equal(l.types.length, 3, 'types annidati preservati');
assert.equal(l.types.find(t => t.id === 'ty-vin').parentId, 'ty-bev', 'sottocategoria (parentId) preservata');
assert.equal(l.warehouses.length, 2, 'warehouses annidati preservati');
assert.equal(l.warehouses.find(w => w.id === 'wh2').name, 'Cella frigo', 'nome magazzino preservato');
assert.deepEqual(l.warehouses.find(w => w.id === 'wh2').typeIds, ['ty-food'], 'categorie ammesse del magazzino (typeIds) preservate');
assert.equal(l.deliveryPoints[0].address, 'Via Roma 1', 'deliveryPoint annidato preservato');
assert.equal(l.supplierNotes.sup1, 'Consegnare entro le 10', 'supplierNotes annidate preservate');
assert.equal(l.currentOrder.prod2, 3, 'currentOrder annidato preservato');
assert.equal(l.pendingTransfers.length, 2, 'pendingTransfers (DDT interni differiti) annidati preservati');
assert.equal(l.pendingTransfers.find(r => r.id === 'pt2').destLabel, 'Evento sala', 'destinazione libera dell\'uscita "fuori magazzino" preservata');
assert.equal(l.pendingTransfers.find(r => r.id === 'pt1').lines[0].name, 'Barolo DOCG', 'snapshot nome riga del DDT preservato');
assert.equal(l.pendingTransfers.find(r => r.id === 'pt1').lines[0].code, 'BAR-001', 'snapshot codice riga del DDT preservato');
assert.equal(out1.products.find(p => p.id === 'prod1').code, 'BAR-001', 'codice prodotto preservato');
assert.deepEqual(out1.products.find(p => p.id === 'prod1').stockByWh, { wh1: 8, wh2: 4 }, 'stockByWh per magazzino preservato');
assert.equal(out1.products.find(p => p.id === 'prod1').targetStock, 12, 'targetStock (scorta target) preservato');
assert.equal(out1.products.find(p => p.id === 'prod1').priceHistory.length, 2, 'priceHistory (storico prezzi) preservato');
assert.equal(out1.products.find(p => p.id === 'prod1').priceHistory[1].source, 'xml', 'sorgente voce storico prezzi preservata');
assert.equal(out1.orders[0].lines.length, 3, 'lines[] dell\'ordine preservate');
assert.equal(out1.orders[0].lines[0].supplierName, 'Cantina Rossi', 'snapshot supplierName nella riga preservato');
assert.equal(out1.orders[0].supplierNotes.sup1, 'Consegnare entro le 10', 'snapshot supplierNotes dell\'ordine preservato');
assert.deepEqual(out1.orders[0].receivedSuppliers, { 'sup1': 1720000000000 }, 'ricezione per-fornitore (receivedSuppliers) preservata');
assert.deepEqual(out1.orders[0].dismissedSuppliers, { '__none__': 1720000100000 }, 'slice scartate (dismissedSuppliers) preservate');
assert.equal(out1.stockMoves.length, 4, 'stockMoves preservati');
assert.equal(out1.stockMoves.find(m => m.kind === 'transfer').fromWarehouseId, 'wh1', 'transfer con fromWarehouseId preservato');
const mvRett = out1.stockMoves.find(m => m.id === 'mv4');
assert.equal(mvRett.batchType, 'rettifica', 'marcatore rettifica singola (batchType) preservato');
assert.deepEqual([mvRett.before, mvRett.after], [1, 3], 'before/after (prima→dopo) della rettifica singola preservati');
console.log('✓ entità annidate e collezioni verificate puntualmente (incl. warehouses e stockByWh)');

importData(structuredClone(sample));
assert.equal(exportData().rev, 6, 'secondo import: rev max(4,5)+1 = 6 (monotòno)');
console.log('✓ rev monotòno');

// import di struttura invalida deve essere RIFIUTATO senza toccare i dati.
let rejected = false;
try { importData({ foo: 'bar' }); } catch { rejected = true; }
assert.ok(rejected, 'struttura invalida deve essere rifiutata');
assert.equal(exportData().rev, 6, 'dopo un import rifiutato i dati restano intatti');
console.log('✓ import invalido rifiutato, dati intatti');

// changeset granulare: aggiorna prod1 (stockByWh), aggiunge un ordine, rimuove uno stockMove.
applyChanges({
  collections: {
    products: { upsert: [{ ...sample.products[0], stockByWh: { wh1: 20, wh2: 4 } }] },
    orders: { upsert: [{ id: 'ord2', localeId: 'loc1', createdAt: 200, sentAt: 200, status: 'sent', deliveryPointId: null, note: '', supplierNotes: {}, lines: [{ productId: 'prod2', name: 'Pomodori', qty: 4, format: 'Kg', supplierId: 'sup2', supplierName: 'Ortofrutta Bio', notes: '' }] }] },
    stockMoves: { remove: ['mv2'] },
  },
});
const d2 = exportData();
assert.equal(d2.products.find(p => p.id === 'prod1').stockByWh.wh1, 20, 'prodotto aggiornato via changeset');
const ordIds = new Set(d2.orders.map(o => o.id));
assert.ok(ordIds.has('ord1') && ordIds.has('ord2'), 'ord2 aggiunto, ord1 conservato');
assert.ok(!d2.stockMoves.some(m => m.id === 'mv2'), 'mv2 rimosso');
assert.equal(d2.rev, 7, 'rev incrementato dal changeset');
console.log('✓ changeset granulare (upsert/remove)');

console.log('\nZEN-WAREHOUSE — TUTTI I TEST PASSATI ✅');
