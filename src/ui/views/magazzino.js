// ============ Vista Magazzino/scorte (Zen-Warehouse) ============
// Multi-magazzino: lo stesso prodotto ha scorte separate per magazzino fisico dentro il locale.
import { esc, fmtEur, productMatches, scanTarget, debounce } from '../../domain/util.js';
import { openSheet, closeSheet, toast, confirmDialog, showPdfDownloadSheet, codeTag, gentleAutofocus } from '../dom.js';
import { consumeViewEntry } from '../app.js';
import {
  activeLocale, activeLocaleObj, productsOf, product, supplierName,
  warehousesOf, warehouse, warehouseName, stockOf, totalStock, warehouseValue,
  topTypes, subTypes, type, suppliersOf, typeName, warehouseAllowsProduct, compatibleWarehouses,
} from '../../domain/warehouse.js';
import {
  stockIn, stockOut, setStock, transfer, movesForProduct,
  addWarehouse, renameWarehouse, deleteWarehouse, reorderWarehouses, setWarehouseTypes,
  pendingReceipts, receiveOrderSupplier, dismissReceiptSupplier,
  applyMovementBatch, applyInventoryBatch, schede, schedaById, renameScheda,
  deleteScheda, schedaDeletionPreview,
  pendingTransfersOf, pendingTransfer, createPendingTransfer, cancelPendingTransfer, validatePendingTransfer,
} from '../../domain/stock.js';
import { generateMovementSlip, generateInventorySheet } from '../../domain/orderpdf.js';
import { applyStockThresholds } from '../../domain/catalog.js';
import { can } from '../../state/auth.js';
import { makeSortable } from '../sortable.js';

// scritture scorte gatinate per azione (grana fine)
const cIn = () => can('magazzino.carico');
const cOut = () => can('magazzino.scarico');
const cAdj = () => can('magazzino.rettifica');
const cTransfer = () => can('magazzino.trasferimento');
const cBatch = () => can('magazzino.massivo');
const cReceive = () => can('magazzino.ricevi');
const cThr = () => can('prodotti.modifica');   // editor massivo soglie = anagrafica prodotto
const cWhCrea = () => can('magazzini.crea');
const cWhMod = () => can('magazzini.modifica');
const cWhDel = () => can('magazzini.elimina');
const cWhManage = () => cWhCrea() || cWhMod() || cWhDel();   // apre la gestione magazzini
const cMove = () => cIn() || cOut();                          // pulsanti carico/scarico in riga
// DDT interni differiti (trasferimento magazzino→magazzino o uscita "fuori magazzino"): allineati ai
// permessi dei movimenti — trasferimento richiede magazzino.trasferimento, l'uscita magazzino.scarico.
const cDdt = () => cTransfer() || cOut();
// rinomina scheda = scrittura sui movimenti: basta uno qualsiasi dei permessi di scrittura magazzino
const cRename = () => cIn() || cOut() || cAdj() || cTransfer() || cBatch();
// eliminare una scheda (storno) = poter creare schede: le schede nascono da Movimento massivo
// (magazzino.massivo) o da Inventario/rettifica (magazzino.rettifica).
const cDelScheda = () => cBatch() || cAdj();

let q = '';
let filter = 'all';    // all | low | out
let scope = 'all';     // 'all' (totale) | warehouseId

// ---- Visuale Schede (modalità dedicata della vista Magazzino) ----
// Stato dei filtri in memoria di vista (non persistito): si azzera solo con "Azzera".
const SCHEDE_STEP = 50;                         // schede mostrate per volta (rendering incrementale)
const SCHEDE_PERIODS = [['all', 'Tutto'], ['7', 'Ultimi 7 giorni'], ['30', 'Ultimo mese'], ['90', 'Ultimi 3 mesi']];
let mode = 'stock';                             // 'stock' (giacenze) | 'schede' | 'thresholds' | 'inventory'
let sq = '';                                    // ricerca schede: prodotto nelle righe o nota
let sTipo = 'all';                              // all | carico | prelievo | transfer
let sWh = 'all';                                // all | warehouseId (coinvolto come origine O destinazione)
let sPeriod = 'all';                            // all | 7 | 30 | 90 (giorni)
let schedeShown = SCHEDE_STEP;                  // quante schede sono visibili ora
// timestamp minimo per il filtro periodo (0 = nessun limite)
const periodCutoff = v => v === 'all' ? 0 : Date.now() - (+v) * 86400000;

// ---- Stato delle sezioni dedicate "Soglie di scorta" e "Inventario" (a tutta pagina) ----
// Vive in memoria di vista come lo stato Schede: sopravvive ai redraw interni, si azzera all'ingresso.
// Filtri prodotti condivisi (stessa forma { q, cat, sub, sup }): vedi pfNormalize/pfApply/pfBar/pfBind.
const thrFilter = { q: '', cat: 'all', sub: 'all', sup: 'all' };
let thrVals = {};                               // productId -> { min, target } (accumulati tra i redraw)
let thrStatus = 'all';                          // all | none (senza soglie) | low (sotto soglia) | modified
let thrSort = 'nat';                            // nat (naturale) | stock (giacenza ↑) | none (senza soglie prima)
const invFilter = { q: '', cat: 'all', sub: 'all', sup: 'all' };
let invWh = null;                               // magazzino su cui si sta facendo la conta
let invCounts = {};                             // productId -> contato (accumulati tra i redraw)
let invLabel = '';                              // nome scheda inventario
let invStatus = 'all';                          // all | stock (con giacenza) | out (esauriti) | adjusted (rettificati)

// stato di un prodotto sul TOTALE (coerente con dashboard): out | low | ok
const status = p => { const s = totalStock(p), m = p.minStock || 0; if (s <= 0) return 'out'; if (m > 0 && s <= m) return 'low'; return 'ok'; };
// quantità mostrata secondo lo scope selezionato (totale o magazzino singolo)
const shownQty = p => scope === 'all' ? totalStock(p) : stockOf(p, scope);
const badge = p => {
  const st = status(p);
  const col = st === 'out' ? 'var(--red,#c2685f)' : st === 'low' ? 'var(--orange,#b08a4e)' : 'var(--green,#6b8f80)';
  const min = (p.minStock || 0) > 0 ? `<span style="font-size:11px;color:var(--muted)">/${p.minStock}</span>` : '';
  return `<span class="tnum" style="font-weight:800;color:${col}">${shownQty(p)}${min}${st === 'low' ? ' ⚠️' : st === 'out' ? ' ⛔' : ''}</span>`;
};

export function render() {
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Magazzino</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;
  if (mode === 'schede') return renderSchede(activeLocale(), l);
  if (mode === 'thresholds') return renderThresholds(activeLocale(), l);
  if (mode === 'inventory') return renderInventory(activeLocale(), l);
  const lid = activeLocale();
  const whs = warehousesOf(lid);
  if (scope !== 'all' && !whs.some(w => w.id === scope)) scope = 'all'; // scope non più valido → totale
  const all = productsOf(lid);

  let h = `<div class="pagehead"><h1>Magazzino</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;

  // selettore magazzino + gestione
  const whChip = (v, lbl) => `<button class="chip ${scope === v ? 'on' : ''}" data-scope="${v}">${esc(lbl)}</button>`;
  const nPend = pendingReceipts(lid).length;
  const pendBadge = nPend > 0 ? `<span class="badge" style="margin-left:6px;background:var(--accent)">${nPend}</span>` : '';
  const nDdt = pendingTransfersOf(lid).length;
  const ddtBadge = nDdt > 0 ? `<span class="badge" style="margin-left:6px;background:var(--accent)">${nDdt}</span>` : '';
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
    <div class="chips" style="margin:0">${whChip('all', 'Tutti i magazzini')}${whs.map(w => whChip(w.id, w.name)).join('')}</div>
    <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap">
      ${cReceive() ? `<button class="btn sm primary" data-receipts>📥 Carico da ordini${pendBadge}</button>` : ''}
      ${cDdt() ? `<button class="btn sm" data-transfers>🚚 Trasferimenti${ddtBadge}</button>` : ''}
      ${cBatch() ? '<button class="btn sm" data-batch>⇅ Movimento massivo</button>' : ''}
      ${cAdj() ? '<button class="btn sm" data-inventory>📋 Inventario</button>' : ''}
      ${cThr() ? '<button class="btn sm" data-thresholds>🎯 Soglie scorta</button>' : ''}
      <button class="btn sm" data-schede>🧾 Schede</button>
      ${cWhManage() ? '<button class="btn sm" data-managewh>⚙︎ Gestisci magazzini</button>' : ''}
    </div>
  </div>`;

  if (!all.length) return h + `<div class="card empty">Nessun prodotto.<br><span class="muted">Aggiungi prodotti dal Database per gestirne le scorte.</span></div>`;

  // scope su un magazzino con categorie ammesse: mostra solo quelle categorie, MA i prodotti con
  // giacenza in quel magazzino restano sempre visibili (salvaguardia: non nascondere merce reale).
  const wh = scope !== 'all' ? warehouse(lid, scope) : null;
  const restricted = !!(wh && Array.isArray(wh.typeIds) && wh.typeIds.length);
  const outOfCat = p => restricted && !warehouseAllowsProduct(lid, scope, p);      // fuori categoria per questo magazzino
  const inScope = p => !restricted || warehouseAllowsProduct(lid, scope, p) || stockOf(p, scope) > 0;
  const base = restricted ? all.filter(inScope) : all;

  const nLow = base.filter(p => status(p) === 'low').length;
  const nOut = base.filter(p => status(p) === 'out').length;
  const chip = (v, lbl, n) => `<button class="chip ${filter === v ? 'on' : ''}" data-filter="${v}">${lbl}${n != null ? ' · ' + n : ''}</button>`;
  h += `<div class="chips" style="margin-bottom:10px">${chip('all', 'Tutti', base.length)}${chip('low', 'Sotto scorta', nLow)}${chip('out', 'Esauriti', nOut)}</div>`;
  if (restricted) {
    const catNames = wh.typeIds.map(id => typeName(lid, id)).filter(n => n && n !== '—').join(', ');
    h += `<div class="muted" style="font-size:12px;margin:-2px 2px 10px">Solo categorie: ${esc(catNames || '—')} · i prodotti con giacenza qui restano visibili</div>`;
  }
  // Valore delle giacenze (Feature 1): totale del locale con scope "Tutti", del magazzino selezionato altrimenti.
  const wv = warehouseValue(lid, scope === 'all' ? null : scope);
  const noPrice = base.filter(p => shownQty(p) > 0 && !((+p.price || 0) > 0)).length;
  h += `<div class="muted" style="font-size:12.5px;margin:-2px 2px 10px">💶 Valore giacenze${scope === 'all' ? '' : ' (' + esc(warehouseName(lid, scope)) + ')'}: <b class="tnum" style="color:var(--txt)">${fmtEur(wv)}</b>${noPrice ? ` · ${noPrice} prodott${noPrice === 1 ? 'o senza prezzo' : 'i senza prezzo'}` : ''}</div>`;
  h += `<div class="field"><input id="mq" placeholder="Cerca prodotto…" value="${esc(q)}"></div>`;

  let list = base;
  const term = q.trim().toLowerCase();
  if (term) list = list.filter(p => productMatches(p, term));
  if (filter === 'low') list = list.filter(p => status(p) === 'low');
  else if (filter === 'out') list = list.filter(p => status(p) === 'out');

  if (!list.length) return h + `<div class="card empty">Nessun prodotto con questo filtro.</div>`;

  h += `<div class="list two">${list.map(p => `<div class="row click" data-prod="${p.id}">
    <div class="mid"><div class="t1">${esc(p.name)}${p.format ? ` <span class="badge soft" style="font-size:10px">${esc(p.format)}</span>` : ''}${codeTag(p.code)}</div>
      <div class="t2">${esc(supplierName(p.supplierId))}${outOfCat(p) ? ' · <span class="badge line" style="font-size:9px">fuori categoria</span>' : ''}${scope !== 'all' && whs.length > 1 ? ` · <span class="muted">tot ${totalStock(p)}</span>` : ''}</div></div>
    ${badge(p)}
    ${cMove() ? `<div style="display:flex;gap:3px;flex-shrink:0;margin-left:8px">
      ${cOut() ? `<button class="btn sm danger" data-out="${p.id}">− Scarico</button>` : ''}
      ${cIn() ? `<button class="btn sm primary" data-in="${p.id}">+ Carico</button>` : ''}
    </div>` : ''}
  </div>`).join('')}</div>`;
  return h;
}

// se lo scope è "Tutti", chiedi in quale magazzino operare, poi esegui fn(whId).
// Con `prod` (merce in ingresso), propone solo i magazzini compatibili con la sua categoria
// (guida morbida: la lista non è mai vuota — vedi compatibleWarehouses).
function withWarehouse(lid, title, fn, prod) {
  const whs = prod ? compatibleWarehouses(lid, prod) : warehousesOf(lid);
  if (scope !== 'all' && whs.some(w => w.id === scope)) return fn(scope);
  if (whs.length === 1) return fn(whs[0].id);
  const opts = whs.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  openSheet(`
    <h2>${esc(title)}</h2>
    <div class="field"><label>Magazzino</label><select id="w_pick">${opts}</select></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Continua</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-ok]').onclick = () => { const w = sheet.querySelector('#w_pick').value; closeSheet(); fn(w); };
    });
}

// modal movimento (carico/scarico) su un magazzino specifico
function moveModal(lid, p, kind, whId, after) {
  const isIn = kind === 'in';
  openSheet(`
    <h2>${isIn ? '➕ Carico' : '➖ Scarico'} · ${esc(p.name)}${codeTag(p.code)}</h2>
    <div class="sheetsub">${esc(warehouseName(lid, whId))} · giacenza attuale: <b>${stockOf(p, whId)}</b></div>
    <div class="field"><label>Quantità</label><input id="m_qty" inputmode="numeric" placeholder="0" autofocus></div>
    <div class="field"><label>Nota (opzionale)</label><input id="m_note" placeholder="${isIn ? 'Es. consegna fornitore' : 'Es. reso, rottura, uso'}"></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn ${isIn ? 'primary' : 'danger'}" data-ok>${isIn ? 'Carica' : 'Scarica'}</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-ok]').onclick = () => {
        const qty = parseInt(sheet.querySelector('#m_qty').value, 10) || 0;
        if (qty <= 0) { toast('Inserisci una quantità'); return; }
        const note = sheet.querySelector('#m_note').value.trim();
        if (isIn) stockIn(lid, p.id, whId, qty, note); else stockOut(lid, p.id, whId, qty, note);
        closeSheet(); toast(isIn ? `Caricati ${qty} ✓` : `Scaricati ${qty} ✓`); after && after();
      };
      enterConfirms(sheet);
    });
}

// Invio in un input del foglio = click sul pulsante primario [data-ok]. Non tocca i confirm distruttivi
// (usano confirmDialog, che non chiama questa funzione): quelli restano a click esplicito.
function enterConfirms(sheet) {
  const ok = sheet.querySelector('[data-ok]'); if (!ok) return;
  sheet.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return; e.preventDefault(); ok.click();
  }));
}

// modal trasferimento da magazzino a magazzino
function transferModal(lid, p, after) {
  const whs = warehousesOf(lid);
  if (whs.length < 2) { toast('Servono almeno due magazzini'); return; }
  const from0 = scope !== 'all' ? scope : whs[0].id;
  // destinazioni compatibili con la categoria del prodotto (o che ne detengono già giacenza)
  const dests = compatibleWarehouses(lid, p).filter(w => w.id !== from0);
  if (!dests.length) { toast('Nessun magazzino di destinazione compatibile'); return; }
  const to0 = dests[0].id;
  const fromOpts = whs.map(w => `<option value="${w.id}" ${w.id === from0 ? 'selected' : ''}>${esc(w.name)} (${stockOf(p, w.id)})</option>`).join('');
  const toOpts = dests.map(w => `<option value="${w.id}" ${w.id === to0 ? 'selected' : ''}>${esc(w.name)} (${stockOf(p, w.id)})</option>`).join('');
  openSheet(`
    <h2>↔ Trasferisci · ${esc(p.name)}${codeTag(p.code)}</h2>
    <div class="frow">
      <div class="field"><label>Da</label><select id="t_from">${fromOpts}</select></div>
      <div class="field"><label>A</label><select id="t_to">${toOpts}</select></div>
    </div>
    <div class="field"><label>Quantità</label><input id="t_qty" inputmode="numeric" placeholder="0" autofocus></div>
    <div class="field"><label>Nota (opzionale)</label><input id="t_note" placeholder="Es. riassortimento"></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Trasferisci</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-ok]').onclick = () => {
        const from = sheet.querySelector('#t_from').value;
        const to = sheet.querySelector('#t_to').value;
        if (from === to) { toast('Scegli due magazzini diversi'); return; }
        const qty = parseInt(sheet.querySelector('#t_qty').value, 10) || 0;
        if (qty <= 0) { toast('Inserisci una quantità'); return; }
        const note = sheet.querySelector('#t_note').value.trim();
        const eff = transfer(lid, p.id, from, to, qty, note);
        closeSheet();
        toast(eff ? `Trasferiti ${eff} ✓` : 'Niente da trasferire (giacenza insufficiente)');
        after && after();
      };
      enterConfirms(sheet);
    });
}

// scheda prodotto: ripartizione per magazzino, azioni, rettifica, storico movimenti
function openProduct(id, after) {
  const lid = activeLocale();
  const p = product(id); if (!p) return;
  const whs = warehousesOf(lid);

  const breakdown = `<div class="list">${whs.map(w => `<div class="row">
      <div class="mid"><div class="t1">🏬 ${esc(w.name)}</div></div>
      <div class="amt tnum" style="font-weight:800">${stockOf(p, w.id)}</div>
    </div>`).join('')}</div>`;

  const moves = movesForProduct(id).slice(0, 30);
  const moveLine = m => {
    if (m.kind === 'transfer') {
      return `<div class="row"><div class="emoji">↔️</div>
        <div class="mid"><div class="t1 tnum">${m.qty}</div>
          <div class="t2">${esc(m.date)} · ${esc(warehouseName(lid, m.fromWarehouseId))} → ${esc(warehouseName(lid, m.warehouseId))}${m.note ? ' · ' + esc(m.note) : ''}</div></div>
      </div>`;
    }
    const isIn = m.kind === 'in';
    return `<div class="row"><div class="emoji">${isIn ? '⬆️' : '⬇️'}</div>
      <div class="mid"><div class="t1 tnum ${isIn ? 'pos' : 'neg'}">${isIn ? '+' : '−'}${m.qty}</div>
        <div class="t2">${esc(m.date)} · ${esc(warehouseName(lid, m.warehouseId))}${m.note ? ' · ' + esc(m.note) : ''}</div></div>
    </div>`;
  };
  const movesHtml = moves.length ? `<div class="list">${moves.map(moveLine).join('')}</div>` : `<div class="card empty" style="padding:14px">Nessun movimento.</div>`;

  openSheet(`
    <h2>${esc(p.name)}${codeTag(p.code)}</h2>
    <div class="sheetsub">Giacenza totale <b>${totalStock(p)}</b>${(p.minStock || 0) > 0 ? ` · soglia minima ${p.minStock}` : ''} · ${esc(supplierName(p.supplierId))}</div>
    ${(cIn() || cOut() || cAdj() || (cTransfer() && whs.length > 1)) ? `<div class="btnrow" style="margin:6px 0 14px">
      ${cIn() ? '<button class="btn primary" data-in>➕ Carico</button>' : ''}
      ${cOut() ? '<button class="btn danger" data-out>➖ Scarico</button>' : ''}
      ${(cTransfer() && whs.length > 1) ? '<button class="btn" data-transfer>↔ Trasferisci</button>' : ''}
      ${cAdj() ? '<button class="btn" data-adj>✎ Rettifica</button>' : ''}
    </div>` : ''}
    <div class="section-title">Giacenza per magazzino</div>
    ${breakdown}
    <div class="section-title">Movimenti</div>
    ${movesHtml}`,
    sheet => {
      const reopen = () => openProduct(id, after);
      sheet.querySelector('[data-in]')?.addEventListener('click', () => withWarehouse(lid, 'Carico · scegli magazzino', wh => moveModal(lid, p, 'in', wh, reopen), p));
      sheet.querySelector('[data-out]')?.addEventListener('click', () => withWarehouse(lid, 'Scarico · scegli magazzino', wh => moveModal(lid, p, 'out', wh, reopen)));
      sheet.querySelector('[data-transfer]')?.addEventListener('click', () => transferModal(lid, p, reopen));
      sheet.querySelector('[data-adj]')?.addEventListener('click', () => withWarehouse(lid, 'Rettifica · scegli magazzino', wh => adjustModal(lid, p, wh, reopen), p));
    });
}

// modal rettifica su un magazzino specifico
function adjustModal(lid, p, whId, after) {
  openSheet(`<h2>Rettifica giacenza · ${esc(p.name)}${codeTag(p.code)}</h2>
    <div class="sheetsub">${esc(warehouseName(lid, whId))}</div>
    <div class="field"><label>Giacenza reale</label><input id="a_val" inputmode="numeric" value="${stockOf(p, whId)}"></div>
    <div class="field"><label>Nota</label><input id="a_note" value="Rettifica"></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Salva</button></div>`,
    s2 => {
      s2.querySelector('[data-cancel]').onclick = () => after && after();
      s2.querySelector('[data-ok]').onclick = () => {
        setStock(lid, p.id, whId, s2.querySelector('#a_val').value, s2.querySelector('#a_note').value.trim());
        toast('Giacenza aggiornata ✓'); after && after();
      };
      enterConfirms(s2);
    });
}

// etichetta delle categorie ammesse di un magazzino (per il sottotitolo nella gestione)
function warehouseTypesLabel(lid, w) {
  const ids = Array.isArray(w.typeIds) ? w.typeIds : [];
  if (!ids.length) return 'Tutte le categorie';
  const names = ids.map(id => typeName(lid, id)).filter(n => n && n !== '—');
  return names.length ? '🏷 ' + names.join(', ') : 'Tutte le categorie';
}

// sheet gestione magazzini (aggiungi/rinomina/categorie/elimina/riordina)
function manageWarehouses(lid, after) {
  const whs = warehousesOf(lid);
  const HANDLE = '<span class="drag-handle" title="Trascina per riordinare" draggable="false">⋮⋮</span>';
  const canSort = cWhMod();   // riordino magazzini = magazzini.modifica
  openSheet(`
    <h2>Gestisci magazzini</h2>
    ${cWhCrea() ? '<div class="btnrow" style="margin-bottom:12px"><button class="btn primary" data-addwh>+ Magazzino</button></div>' : ''}
    <div class="list${canSort ? ' sortwh' : ''}">${whs.map(w => `<div class="row"${canSort ? ` data-sortid="${w.id}"` : ''}>
      ${canSort ? HANDLE : ''}
      <div class="mid"><div class="t1">🏬 ${esc(w.name)}</div><div class="t2 muted">${esc(warehouseTypesLabel(lid, w))}</div></div>
      <div style="display:flex;gap:3px;flex-shrink:0" draggable="false">
        ${cWhMod() ? `<button class="btn sm" data-whtypes="${w.id}" title="Categorie ammesse">🏷</button>
        <button class="btn sm" data-whedit="${w.id}" title="Rinomina">✏️</button>` : ''}
        ${cWhDel() ? `<button class="btn sm danger" data-whdel="${w.id}" ${whs.length <= 1 ? 'disabled' : ''}>🗑</button>` : ''}
      </div></div>`).join('')}</div>
    <div class="actions"><button class="btn primary" data-close>Fatto</button></div>`,
    sheet => {
      const reopen = () => manageWarehouses(lid, after);
      sheet.querySelector('[data-close]').onclick = () => { closeSheet(); after && after(); };
      sheet.querySelector('[data-addwh]')?.addEventListener('click', () => nameModal(lid, null, reopen));
      sheet.querySelectorAll('[data-whedit]').forEach(b => b.onclick = () => nameModal(lid, b.dataset.whedit, reopen));
      sheet.querySelectorAll('[data-whtypes]').forEach(b => b.onclick = () => warehouseTypesModal(lid, b.dataset.whtypes, reopen));
      if (canSort && sheet.querySelector('.sortwh')) makeSortable(sheet.querySelector('.sortwh'), ids => reorderWarehouses(lid, ids));
      sheet.querySelectorAll('[data-whdel]').forEach(b => b.onclick = () => {
        const w = warehouse(lid, b.dataset.whdel);
        confirmDialog('Eliminare il magazzino?', `${w?.name || ''} — la giacenza viene spostata nel primo magazzino rimasto.`, 'Elimina', () => {
          if (deleteWarehouse(lid, b.dataset.whdel)) { toast('Magazzino eliminato'); if (scope === b.dataset.whdel) scope = 'all'; }
          reopen();
        }, { danger: true });
      });
    });
}

// modale selezione categorie ammesse per un magazzino (chip multi-selezione; nessuna = tutte)
function warehouseTypesModal(lid, whId, after) {
  const w = warehouse(lid, whId); if (!w) { after && after(); return; }
  const cats = topTypes(lid);
  const cur = new Set(Array.isArray(w.typeIds) ? w.typeIds : []);
  const chipHtml = () => cats.map(c => `<button class="chip ${cur.has(c.id) ? 'on' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
  openSheet(`
    <h2>Categorie ammesse · ${esc(w.name)}</h2>
    <div class="sheetsub">Scegli le categorie che questo magazzino può contenere. <b>Nessuna selezione = tutte le categorie ammesse.</b></div>
    ${cats.length
      ? `<div class="chips" data-catchips>${chipHtml()}</div>`
      : `<div class="card empty" style="padding:14px">Nessuna categoria nel Database.<br><span class="muted">Crea le categorie dal Database per limitare i magazzini.</span></div>`}
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Salva</button></div>`,
    sheet => {
      sheet.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
        const id = b.dataset.cat;
        if (cur.has(id)) { cur.delete(id); b.classList.remove('on'); } else { cur.add(id); b.classList.add('on'); }
      });
      sheet.querySelector('[data-cancel]').onclick = () => after && after();
      sheet.querySelector('[data-ok]').onclick = () => {
        setWarehouseTypes(lid, whId, [...cur]);
        toast(cur.size ? 'Categorie aggiornate ✓' : 'Nessun limite: tutte le categorie ✓');
        after && after();
      };
    });
}
// modal nome magazzino (nuovo/rinomina)
function nameModal(lid, whId, after) {
  const w = whId ? warehouse(lid, whId) : null;
  openSheet(`<h2>${w ? 'Rinomina magazzino' : 'Nuovo magazzino'}</h2>
    <div class="field"><label>Nome *</label><input id="w_name" value="${esc(w?.name || '')}" placeholder="Es. Cella frigo, Cantina" autofocus></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>${w ? 'Salva' : 'Aggiungi'}</button></div>`,
    s2 => {
      s2.querySelector('[data-cancel]').onclick = () => after && after();
      s2.querySelector('[data-ok]').onclick = () => {
        const name = s2.querySelector('#w_name').value.trim();
        if (!name) { toast('Il nome è obbligatorio'); return; }
        if (whId) renameWarehouse(lid, whId, name); else addWarehouse(lid, name);
        toast(whId ? 'Magazzino rinominato ✓' : 'Magazzino aggiunto ✓'); after && after();
      };
    });
}

// ---- Ricezione rapida ordini, per fornitore ----
// data ordine breve per l'intestazione della card
function fmtOrderDate(o) {
  return new Date(o.sentAt || o.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}
// sheet: elenco delle fette pendenti (una card per fornitore-ordine), con quantità modificabili
function receiptsSheet(lid, after) {
  const slices = pendingReceipts(lid);
  const body = !slices.length
    ? `<div class="card empty" style="padding:18px">Nessun ordine da ricevere.<br><span class="muted">Gli ordini inviati dalla schermata Ordine compaiono qui, divisi per fornitore.</span></div>`
    : slices.map((sl, i) => {
        const pezzi = sl.lines.reduce((a, ln) => a + ln.qty, 0);
        const rows = sl.lines.map(ln => `<div class="row">
          <div class="mid"><div class="t1">${esc(ln.name)}${ln.format ? ` <span class="badge soft" style="font-size:10px">${esc(ln.format)}</span>` : ''}${codeTag(ln.code)}</div>${ln.notes ? `<div class="t2">${esc(ln.notes)}</div>` : ''}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <button class="btn sm" data-rminus data-slice="${i}" data-prod="${esc(ln.productId)}" aria-label="Diminuisci">−</button>
            <input class="rq" data-slice="${i}" data-prod="${esc(ln.productId)}" type="number" min="0" inputmode="numeric" value="${ln.qty}" style="width:52px;text-align:center;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--input-bg,var(--surface));color:var(--txt);font-weight:800" aria-label="Quantità arrivata">
            <button class="btn sm primary" data-rplus data-slice="${i}" data-prod="${esc(ln.productId)}" aria-label="Aumenta">+</button>
          </div>
        </div>`).join('');
        return `<div class="card" style="margin-bottom:12px" data-card="${i}">
          <div class="section-title" style="margin-top:0">🚚 ${esc(sl.supplierName)} <span class="muted" style="font-weight:500;font-size:12px">· ${fmtOrderDate(sl.order)} · ${sl.lines.length} rig${sl.lines.length === 1 ? 'a' : 'he'} · ${pezzi} pz</span></div>
          <div class="list">${rows}</div>
          <div class="btnrow" style="margin-top:10px"><button class="btn primary" data-load="${i}">Carica</button><button class="btn danger" data-dismiss="${i}">Scarta</button></div>
        </div>`;
      }).join('');

  openSheet(`
    <h2>📥 Carico da ordini</h2>
    <div class="sheetsub">Ricevi la merce per fornitore, modificando se serve le quantità effettivamente arrivate.</div>
    <div data-receipts-body>${body}</div>
    <div class="actions"><button class="btn primary" data-close>Chiudi</button></div>`,
    sheet => {
      const rebuild = () => { closeSheet(); receiptsSheet(lid, after); };
      sheet.querySelector('[data-close]').onclick = () => { closeSheet(); after && after(); };
      // stepper +/− sulle quantità arrivate (min 0, nessun massimo: può arrivarne più dell'ordinato)
      const stepRq = (btn, delta) => {
        const inp = sheet.querySelector(`.rq[data-slice="${btn.dataset.slice}"][data-prod="${CSS.escape(btn.dataset.prod)}"]`); if (!inp) return;
        let v = (parseInt(inp.value, 10) || 0) + delta; if (v < 0) v = 0;
        inp.value = v;
      };
      sheet.querySelectorAll('[data-rminus]').forEach(b => b.onclick = () => stepRq(b, -1));
      sheet.querySelectorAll('[data-rplus]').forEach(b => b.onclick = () => stepRq(b, +1));
      sheet.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
        const i = +b.dataset.load;
        const sl = slices[i]; if (!sl) return;
        // raccogli le quantità (eventualmente modificate) di QUESTA card
        const qtyById = {};
        sheet.querySelectorAll(`.rq[data-slice="${i}"]`).forEach(inp => { qtyById[inp.dataset.prod] = parseInt(inp.value, 10) || 0; });
        const doLoad = whId => {
          const n = receiveOrderSupplier(sl.order, sl.supplierId, whId, qtyById);
          toast(`${n} prodott${n === 1 ? 'o' : 'i'} caricat${n === 1 ? 'o' : 'i'} in ${warehouseName(lid, whId)} ✓`);
          rebuild(); // la fetta ricevuta sparisce
        };
        withWarehouse(lid, 'Carico da ordine · scegli magazzino', doLoad);
      });
      sheet.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => {
        const i = +b.dataset.dismiss;
        const sl = slices[i]; if (!sl) return;
        confirmDialog('Scartare questa ricezione?', `${esc(sl.supplierName)} · ${fmtOrderDate(sl.order)} — la voce sparisce dall'elenco senza caricare nulla in magazzino.`, 'Scarta', () => {
          dismissReceiptSupplier(sl.order, sl.supplierId);
          toast('Ricezione scartata');
          rebuild();
        }, { danger: true });
      });
    }, { wide: true });
}

// ---- Schede di movimento: builder multi-prodotto (carico / prelievo / trasferimento) ----
// stato transitorio del builder (righe: {productId,qty}). Ancorato al magazzino selezionato (scope):
//   carico → toWh (destinazione); prelievo → fromWh (origine); trasferimento → fromWh→toWh.
function batchSheet(lid, after) {
  const whs = warehousesOf(lid);
  if (!whs.length) { toast('Nessun magazzino'); return; }
  const anchor = scope !== 'all' ? scope : whs[0].id;
  let type = 'carico';                                    // carico | prelievo | transfer
  let fromWh = anchor;                                    // origine (prelievo/trasferimento)
  let toWh = anchor;                                      // destinazione (carico/trasferimento)
  if (toWh === fromWh) toWh = whs.find(w => w.id !== fromWh)?.id || fromWh; // dest. trasferimento ≠ origine
  let carWh = anchor;                                     // destinazione del carico (indipendente dall'origine)
  let bq = '';                                            // ricerca prodotti
  const qty = {};                                         // productId -> quantità inserita
  let searchDeb = null;                                   // debounce della ricerca (ricreato a ogni wire)

  // Prodotti MOVIMENTABILI nel contesto corrente (tipo operazione + magazzini), SENZA il termine di ricerca:
  //  - carico: ammessi dalla destinazione (carWh) o con giacenza lì;
  //  - trasferimento: con giacenza in origine E ammessi/già presenti a destinazione;
  //  - prelievo: solo con giacenza in origine (merce in uscita: nessun vincolo di categoria).
  // È lo "scope" del match barcode: un prodotto non movimentabile qui non è un bersaglio valido.
  const movableBase = () => {
    if (type === 'carico') return productsOf(lid).filter(p => warehouseAllowsProduct(lid, carWh, p) || stockOf(p, carWh) > 0);
    if (type === 'transfer') return productsOf(lid).filter(p => stockOf(p, fromWh) > 0 && (warehouseAllowsProduct(lid, toWh, p) || stockOf(p, toWh) > 0));
    return productsOf(lid).filter(p => stockOf(p, fromWh) > 0);
  };

  const render = () => {
    const isTransfer = type === 'transfer';
    const isCarico = type === 'carico';
    let list = movableBase();
    const term = bq.trim().toLowerCase();
    if (term) list = list.filter(p => productMatches(p, term));

    const typeChip = (v, lbl, dis) => `<button class="chip ${type === v ? 'on' : ''}" data-btype="${v}" ${dis ? 'disabled' : ''}>${lbl}</button>`;
    const opts = (sel) => whs.map(w => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    const toOpts = whs.filter(w => w.id !== fromWh).map(w => `<option value="${w.id}" ${w.id === toWh ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    // riga Da / A secondo l'operazione
    let route;
    if (isCarico) route = `<div class="field"><label>Da</label><input value="Esterno / fornitore" disabled></div>
        <div class="field"><label>A (magazzino)</label><select id="b_to">${opts(carWh)}</select></div>`;
    else if (isTransfer) route = `<div class="field"><label>Da</label><select id="b_from">${opts(fromWh)}</select></div>
        <div class="field"><label>A</label><select id="b_to">${toOpts}</select></div>`;
    else route = `<div class="field"><label>Da</label><select id="b_from">${opts(fromWh)}</select></div>
        <div class="field"><label>A</label><input value="Fuori magazzino" disabled></div>`;

    const rows = list.length ? list.map(p => {
      const av = isCarico ? stockOf(p, carWh) : stockOf(p, fromWh);
      // prelievo/trasferimento clampano al disponibile in origine → il + rispetta quel limite; carico senza limite
      const maxAttr = isCarico ? '' : ` data-max="${av}"`;
      return `<div class="row">
        <div class="mid"><div class="t1">${esc(p.name)}${p.format ? ` <span class="badge soft" style="font-size:10px">${esc(p.format)}</span>` : ''}${codeTag(p.code)}</div>
          <div class="t2 muted">${isCarico ? 'giac.' : 'disp.'} ${av}</div></div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <button class="btn sm" data-bminus="${esc(p.id)}" aria-label="Diminuisci">−</button>
          <input class="bq" data-prod="${esc(p.id)}"${maxAttr} type="number" min="0" inputmode="numeric" placeholder="0" value="${qty[p.id] ? esc(String(qty[p.id])) : ''}" style="width:52px;text-align:center;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--input-bg,var(--surface));color:var(--txt);font-weight:800" aria-label="Quantità">
          <button class="btn sm primary" data-bplus="${esc(p.id)}" aria-label="Aumenta">+</button>
        </div>
      </div>`;
    }).join('') : `<div class="card empty" style="padding:14px">${isCarico ? 'Nessun prodotto ammesso in questo magazzino.' : isTransfer ? 'Nessun prodotto trasferibile qui (categoria non ammessa a destinazione o senza giacenza in origine).' : 'Nessun prodotto con giacenza in questo magazzino.'}</div>`;

    // riepilogo
    const nProd = Object.values(qty).filter(v => v > 0).length;
    const pezzi = Object.values(qty).reduce((a, v) => a + (v > 0 ? v : 0), 0);
    const notePh = isCarico ? 'Es. consegna, inventario iniziale' : isTransfer ? 'Es. riassortimento cella' : 'Es. uso interno, evento';

    return `
      <h2>⇅ Movimento massivo</h2>
      <div class="field"><label>Operazione</label>
        <div class="chips" style="margin:0">${typeChip('carico', 'Carico')}${typeChip('prelievo', 'Prelievo')}${typeChip('transfer', 'Trasferimento', whs.length < 2)}</div>
      </div>
      <div class="frow">${route}</div>
      <div class="field"><label>Nome scheda (facoltativo)</label><input id="b_label" placeholder="Es. Inventario cantina, Rifornimento bancone"></div>
      <div class="field"><input id="b_q" placeholder="Cerca prodotto…" value="${esc(bq)}"></div>
      <div class="list" data-batchlist>${rows}</div>
      <div class="field" style="margin-top:10px"><label>Nota (opzionale)</label><input id="b_note" placeholder="${notePh}"></div>
      <div class="sheetsub" data-summary style="margin-top:6px">${nProd} prodott${nProd === 1 ? 'o' : 'i'} · ${pezzi} pz</div>
      <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Conferma</button></div>`;
  };

  // raccoglie le quantità correnti dagli input nel foglio in `qty`
  const collect = sheet => sheet.querySelectorAll('.bq').forEach(inp => {
    const v = parseInt(inp.value, 10) || 0;
    if (v > 0) qty[inp.dataset.prod] = v; else delete qty[inp.dataset.prod];
  });

  let noteVal = '';   // nota preservata tra i ridisegni della modale
  let labelVal = '';  // nome scheda preservato tra i ridisegni della modale

  const wire = sheet => {
    const noteEl = sheet.querySelector('#b_note');
    const labelEl = sheet.querySelector('#b_label');
    if (noteEl) noteEl.value = noteVal;
    if (labelEl) labelEl.value = labelVal;
    // ridisegna la modale in-place preservando nome, nota e quantità già inserite
    const redraw = restore => { searchDeb?.cancel(); collect(sheet); if (noteEl) noteVal = noteEl.value; if (labelEl) labelVal = labelEl.value; openSheet(render(), s => { wire(s); restore && restore(s); }, { wide: true }); };

    // Flusso barcode: dallo scan/Invio in ricerca → prodotto bersaglio movimentabile → focus sulla sua
    // quantità (.bq) con testo selezionato. Il "filtro" del massivo (tipo op + magazzino) è semantico:
    // se il codice esiste ma non è movimentabile qui, non lo si può forzare → si avvisa e si resta in ricerca.
    const scanBatch = () => {
      const base = movableBase();
      const term = bq.trim().toLowerCase();
      const visible = term ? base.filter(p => productMatches(p, term)) : base;
      const target = scanTarget(bq, base, visible);
      if (target) { redraw(s => { const inp = s.querySelector(`.bq[data-prod="${CSS.escape(target.id)}"]`); if (inp) { inp.focus(); try { inp.select(); } catch {} } else s.querySelector('#b_q')?.focus(); }); return; }
      // codice esatto presente nel locale ma fuori dal contesto movimentabile → messaggio chiaro
      if (scanTarget(bq, productsOf(lid), [])) toast('Prodotto non disponibile per questa operazione');
      redraw(s => s.querySelector('#b_q')?.focus());
    };

    sheet.querySelectorAll('[data-btype]').forEach(b => b.onclick = () => {
      if (b.disabled) return;
      type = b.dataset.btype;
      if (type === 'transfer' && (!toWh || toWh === fromWh)) toWh = whs.find(w => w.id !== fromWh)?.id || null;
      redraw();
    });
    sheet.querySelector('#b_from')?.addEventListener('change', e => {
      fromWh = e.target.value;
      if (type === 'transfer' && toWh === fromWh) toWh = whs.find(w => w.id !== fromWh)?.id || null;
      redraw();
    });
    sheet.querySelector('#b_to')?.addEventListener('change', e => {
      // la lista prodotti dipende dalla destinazione (categorie ammesse) → ridisegna sempre
      if (type === 'carico') carWh = e.target.value; else toWh = e.target.value;
      redraw();
    });
    const qi = sheet.querySelector('#b_q');
    if (qi) {
      const commit = () => { const pos = qi.selectionStart; redraw(s => { const nq = s.querySelector('#b_q'); if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch {} } }); };
      searchDeb = debounce(commit, 130);
      qi.oninput = () => { bq = qi.value; searchDeb(); };
      // Invio = barcode: aggancia il prodotto (codice esatto o risultato unico) e va sulla quantità
      qi.onkeydown = e => { if (e.key !== 'Enter') return; e.preventDefault(); bq = qi.value; searchDeb.cancel(); scanBatch(); };
    }
    if (noteEl) noteEl.oninput = () => { noteVal = noteEl.value; };
    if (labelEl) labelEl.oninput = () => { labelVal = labelEl.value; };
    // aggiorna il contatore "N prodotti · M pz" dagli input correnti (senza ridisegnare la modale)
    const refreshSummary = () => {
      collect(sheet);
      const el = sheet.querySelector('[data-summary]'); if (!el) return;
      const nProd = Object.values(qty).filter(v => v > 0).length;
      const pezzi = Object.values(qty).reduce((a, v) => a + (v > 0 ? v : 0), 0);
      el.textContent = `${nProd} prodott${nProd === 1 ? 'o' : 'i'} · ${pezzi} pz`;
    };
    // stepper +/−: aggiorna l'input rispettando 0 come minimo e il max (disponibile) dove previsto
    const step = (pid, delta) => {
      const inp = sheet.querySelector(`.bq[data-prod="${CSS.escape(pid)}"]`); if (!inp) return;
      let v = (parseInt(inp.value, 10) || 0) + delta;
      if (v < 0) v = 0;
      const max = inp.dataset.max != null ? (parseInt(inp.dataset.max, 10) || 0) : null;
      if (max != null && v > max) v = max;
      inp.value = v || '';
      refreshSummary();
    };
    sheet.querySelectorAll('[data-bminus]').forEach(b => b.onclick = () => step(b.dataset.bminus, -1));
    sheet.querySelectorAll('[data-bplus]').forEach(b => b.onclick = () => step(b.dataset.bplus, +1));
    sheet.querySelectorAll('.bq').forEach(inp => {
      inp.oninput = refreshSummary;
      // Invio: passa alla quantità successiva; a fine lista (o dopo uno scan che filtra a 1 riga)
      // azzera la ricerca e torna alla casella, pronta per il barcode successivo.
      inp.onkeydown = e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        collect(sheet);   // preserva il valore appena digitato in `qty`
        const bqs = [...sheet.querySelectorAll('.bq')];
        const i = bqs.indexOf(inp);
        if (i >= 0 && i < bqs.length - 1) { bqs[i + 1].focus(); try { bqs[i + 1].select(); } catch {} }
        else { bq = ''; redraw(s => s.querySelector('#b_q')?.focus()); }
      };
    });
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    sheet.querySelector('[data-ok]').onclick = () => {
      collect(sheet);
      if (noteEl) noteVal = noteEl.value;
      if (labelEl) labelVal = labelEl.value;
      const note = noteVal.trim();
      const label = labelVal.trim();
      const lines = Object.entries(qty).filter(([, v]) => v > 0).map(([productId, v]) => ({ productId, qty: v }));
      if (!lines.length) { toast('Inserisci almeno una quantità'); return; }
      if (type === 'transfer' && (!toWh || toWh === fromWh)) { toast('Scegli un magazzino di destinazione diverso'); return; }
      // payload secondo l'operazione (carico entra in carWh; prelievo esce da fromWh; trasferimento fromWh→toWh)
      const payload = type === 'carico' ? { type, fromWh: null, toWh: carWh, note, label, lines }
        : type === 'transfer' ? { type, fromWh, toWh, note, label, lines }
        : { type, fromWh, toWh: null, note, label, lines };
      const scheda = applyMovementBatch(lid, payload);
      if (!scheda) { toast(type === 'carico' ? 'Niente da caricare' : 'Niente da spostare (giacenza insufficiente)'); return; }
      closeSheet();
      toast(type === 'carico' ? 'Carico registrato ✓' : type === 'transfer' ? 'Trasferimento registrato ✓' : 'Prelievo registrato ✓');
      const l = activeLocaleObj();
      const pdf = generateMovementSlip(l, scheda, warehousesOf(lid));
      showPdfDownloadSheet([pdf]);
      after && after();
    };
  };

  openSheet(render(), wire, { wide: true });
}

// ---- DDT interni differiti: trasferimenti/uscite DA CONSEGNARE ----
// Flusso: si PREPARA il DDT (righe + stampa PDF) → resta in "Trasferimenti da consegnare" → alla consegna
// si CONVALIDA (quantità effettive) e i movimenti entrano in scorte via applyMovementBatch (clamp/batchId gratis).

// data breve del DDT per intestazioni
function fmtDdtDate(rec) {
  return new Date(rec.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}
// converte un record pendente nell'oggetto scheda atteso da generateMovementSlip (con marcatore pending).
// out → scheda 'prelievo' (esce da fromWh; destLabel mostrata come destinazione "A"); transfer → 'transfer'.
function pendingToScheda(rec) {
  return {
    type: rec.type === 'out' ? 'prelievo' : 'transfer',
    fromWh: rec.fromWh, toWh: rec.toWh, label: '',
    destLabel: (rec.destLabel || '').trim(), note: rec.note || '',
    ts: rec.createdAt, date: '', pending: true,
    lines: rec.lines.map(ln => ({ name: ln.name, format: ln.format, qty: ln.qty })),
  };
}

// Sheet "Nuovo trasferimento": compone un DDT interno (trasferimento tra magazzini o uscita "fuori
// magazzino"). Stessa impronta di batchSheet (chip operazione, rotta Da/A, ricerca + quantità, note),
// ma NON applica: crea un record pendente e ne stampa il PDF. Nessun max sulle quantità (clamp alla convalida).
function newTransferSheet(lid, after) {
  const whs = warehousesOf(lid);
  if (!whs.length) { toast('Nessun magazzino'); return; }
  const canTransfer = cTransfer() && whs.length >= 2;
  const canOut = cOut();
  if (!canTransfer && !canOut) { toast('Servono almeno due magazzini per un trasferimento'); return; }
  let type = canTransfer ? 'transfer' : 'out';           // transfer | out
  let fromWh = (scope !== 'all' && whs.some(w => w.id === scope)) ? scope : whs[0].id;
  let toWh = whs.find(w => w.id !== fromWh)?.id || fromWh;
  let bq = '';                                           // ricerca prodotti
  const qty = {};                                        // productId -> quantità
  let searchDeb = null;
  let noteVal = '', destVal = '';                        // preservati tra i ridisegni

  // prodotti movimentabili: con giacenza in origine; per il trasferimento anche ammessi/già presenti a destinazione
  const movableBase = () => {
    if (type === 'transfer') return productsOf(lid).filter(p => stockOf(p, fromWh) > 0 && (warehouseAllowsProduct(lid, toWh, p) || stockOf(p, toWh) > 0));
    return productsOf(lid).filter(p => stockOf(p, fromWh) > 0);
  };

  const render = () => {
    const isTransfer = type === 'transfer';
    let list = movableBase();
    const term = bq.trim().toLowerCase();
    if (term) list = list.filter(p => productMatches(p, term));

    const typeChip = (v, lbl) => `<button class="chip ${type === v ? 'on' : ''}" data-ttype="${v}">${lbl}</button>`;
    const opts = sel => whs.map(w => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    const toOpts = whs.filter(w => w.id !== fromWh).map(w => `<option value="${w.id}" ${w.id === toWh ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    const route = isTransfer
      ? `<div class="field"><label>Da</label><select id="t_from">${opts(fromWh)}</select></div>
         <div class="field"><label>A</label><select id="t_to">${toOpts}</select></div>`
      : `<div class="field"><label>Da</label><select id="t_from">${opts(fromWh)}</select></div>
         <div class="field"><label>A</label><input value="Fuori magazzino" disabled></div>`;

    const rows = list.length ? list.map(p => {
      const av = stockOf(p, fromWh);   // niente max: si può preparare anche oltre la giacenza (clamp alla convalida)
      return `<div class="row">
        <div class="mid"><div class="t1">${esc(p.name)}${p.format ? ` <span class="badge soft" style="font-size:10px">${esc(p.format)}</span>` : ''}${codeTag(p.code)}</div>
          <div class="t2 muted">disp. ${av}</div></div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <button class="btn sm" data-tminus="${esc(p.id)}" aria-label="Diminuisci">−</button>
          <input class="tq" data-prod="${esc(p.id)}" type="number" min="0" inputmode="numeric" placeholder="0" value="${qty[p.id] ? esc(String(qty[p.id])) : ''}" style="width:52px;text-align:center;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--input-bg,var(--surface));color:var(--txt);font-weight:800" aria-label="Quantità">
          <button class="btn sm primary" data-tplus="${esc(p.id)}" aria-label="Aumenta">+</button>
        </div>
      </div>`;
    }).join('') : `<div class="card empty" style="padding:14px">${isTransfer ? 'Nessun prodotto trasferibile qui (categoria non ammessa a destinazione o senza giacenza in origine).' : 'Nessun prodotto con giacenza in questo magazzino.'}</div>`;

    const nProd = Object.values(qty).filter(v => v > 0).length;
    const pezzi = Object.values(qty).reduce((a, v) => a + (v > 0 ? v : 0), 0);
    const destField = isTransfer ? '' : `<div class="field"><label>Destinazione / causale (facoltativo)</label><input id="t_dest" placeholder="Es. evento, reparto, destinatario"></div>`;
    return `
      <h2>🚚 Nuovo trasferimento</h2>
      <div class="sheetsub">Prepara un DDT interno da consegnare: alla consegna lo convaliderai e la merce verrà spostata (o uscirà dalle scorte).</div>
      <div class="field"><label>Operazione</label>
        <div class="chips" style="margin:0">${canTransfer ? typeChip('transfer', 'Trasferimento') : ''}${canOut ? typeChip('out', 'Fuori magazzino') : ''}</div>
      </div>
      <div class="frow">${route}</div>
      ${destField}
      <div class="field"><input id="t_q" placeholder="Cerca prodotto…" value="${esc(bq)}"></div>
      <div class="list" data-tlist>${rows}</div>
      <div class="field" style="margin-top:10px"><label>Nota (opzionale)</label><input id="t_note" placeholder="${isTransfer ? 'Es. riassortimento sede' : 'Es. uso interno, evento'}"></div>
      <div class="sheetsub" data-summary style="margin-top:6px">${nProd} prodott${nProd === 1 ? 'o' : 'i'} · ${pezzi} pz</div>
      <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Prepara DDT</button></div>`;
  };

  const collect = sheet => sheet.querySelectorAll('.tq').forEach(inp => {
    const v = parseInt(inp.value, 10) || 0;
    if (v > 0) qty[inp.dataset.prod] = v; else delete qty[inp.dataset.prod];
  });

  const wire = sheet => {
    const noteEl = sheet.querySelector('#t_note');
    const destEl = sheet.querySelector('#t_dest');
    if (noteEl) noteEl.value = noteVal;
    if (destEl) destEl.value = destVal;
    const redraw = restore => { searchDeb?.cancel(); collect(sheet); if (noteEl) noteVal = noteEl.value; if (destEl) destVal = destEl.value; openSheet(render(), s => { wire(s); restore && restore(s); }, { wide: true }); };

    // Invio/scan in ricerca → prodotto bersaglio movimentabile → focus sulla sua quantità
    const scanT = () => {
      const base = movableBase();
      const term = bq.trim().toLowerCase();
      const visible = term ? base.filter(p => productMatches(p, term)) : base;
      const target = scanTarget(bq, base, visible);
      if (target) { redraw(s => { const inp = s.querySelector(`.tq[data-prod="${CSS.escape(target.id)}"]`); if (inp) { inp.focus(); try { inp.select(); } catch {} } else s.querySelector('#t_q')?.focus(); }); return; }
      if (scanTarget(bq, productsOf(lid), [])) toast('Prodotto non disponibile per questa operazione');
      redraw(s => s.querySelector('#t_q')?.focus());
    };

    sheet.querySelectorAll('[data-ttype]').forEach(b => b.onclick = () => {
      type = b.dataset.ttype;
      if (type === 'transfer' && (!toWh || toWh === fromWh)) toWh = whs.find(w => w.id !== fromWh)?.id || null;
      redraw();
    });
    sheet.querySelector('#t_from')?.addEventListener('change', e => {
      fromWh = e.target.value;
      if (type === 'transfer' && toWh === fromWh) toWh = whs.find(w => w.id !== fromWh)?.id || null;
      redraw();
    });
    sheet.querySelector('#t_to')?.addEventListener('change', e => { toWh = e.target.value; redraw(); });
    const qi = sheet.querySelector('#t_q');
    if (qi) {
      const commit = () => { const pos = qi.selectionStart; redraw(s => { const nq = s.querySelector('#t_q'); if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch {} } }); };
      searchDeb = debounce(commit, 130);
      qi.oninput = () => { bq = qi.value; searchDeb(); };
      qi.onkeydown = e => { if (e.key !== 'Enter') return; e.preventDefault(); bq = qi.value; searchDeb.cancel(); scanT(); };
    }
    if (noteEl) noteEl.oninput = () => { noteVal = noteEl.value; };
    if (destEl) destEl.oninput = () => { destVal = destEl.value; };
    const refreshSummary = () => {
      collect(sheet);
      const el = sheet.querySelector('[data-summary]'); if (!el) return;
      const nProd = Object.values(qty).filter(v => v > 0).length;
      const pezzi = Object.values(qty).reduce((a, v) => a + (v > 0 ? v : 0), 0);
      el.textContent = `${nProd} prodott${nProd === 1 ? 'o' : 'i'} · ${pezzi} pz`;
    };
    const step = (pid, delta) => {
      const inp = sheet.querySelector(`.tq[data-prod="${CSS.escape(pid)}"]`); if (!inp) return;
      let v = (parseInt(inp.value, 10) || 0) + delta; if (v < 0) v = 0;
      inp.value = v || ''; refreshSummary();
    };
    sheet.querySelectorAll('[data-tminus]').forEach(b => b.onclick = () => step(b.dataset.tminus, -1));
    sheet.querySelectorAll('[data-tplus]').forEach(b => b.onclick = () => step(b.dataset.tplus, +1));
    sheet.querySelectorAll('.tq').forEach(inp => {
      inp.oninput = refreshSummary;
      inp.onkeydown = e => {
        if (e.key !== 'Enter') return; e.preventDefault(); collect(sheet);
        const tqs = [...sheet.querySelectorAll('.tq')];
        const i = tqs.indexOf(inp);
        if (i >= 0 && i < tqs.length - 1) { tqs[i + 1].focus(); try { tqs[i + 1].select(); } catch {} }
        else { bq = ''; redraw(s => s.querySelector('#t_q')?.focus()); }
      };
    });
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    sheet.querySelector('[data-ok]').onclick = () => {
      collect(sheet);
      if (noteEl) noteVal = noteEl.value;
      if (destEl) destVal = destEl.value;
      const lines = Object.entries(qty).filter(([, v]) => v > 0).map(([productId, v]) => ({ productId, qty: v }));
      if (!lines.length) { toast('Inserisci almeno una quantità'); return; }
      if (type === 'transfer' && (!toWh || toWh === fromWh)) { toast('Scegli un magazzino di destinazione diverso'); return; }
      const rec = createPendingTransfer(lid, { type, fromWh, toWh: type === 'transfer' ? toWh : null, destLabel: type === 'out' ? destVal.trim() : '', note: noteVal.trim(), lines });
      if (!rec) { toast('Niente da preparare'); return; }
      closeSheet();
      toast('DDT preparato · da consegnare ✓');
      const pdf = generateMovementSlip(activeLocaleObj(), pendingToScheda(rec), warehousesOf(lid));
      showPdfDownloadSheet([pdf]);
      after && after();
    };
  };

  openSheet(render(), wire, { wide: true });
}

// Sheet "Trasferimenti da consegnare": elenco dei DDT pendenti con rotta/data/righe e azioni per ciascuno
// (ristampa PDF · convalida · annulla). Da qui si prepara anche un nuovo DDT.
function transfersSheet(lid, after) {
  const list = pendingTransfersOf(lid);
  const body = !list.length
    ? `<div class="card empty" style="padding:18px">Nessun trasferimento da consegnare.<br><span class="muted">Prepara un DDT interno per spostare merce tra magazzini o farla uscire dalle scorte.</span></div>`
    : list.map(rec => {
        const isOut = rec.type === 'out';
        const pezzi = rec.lines.reduce((a, ln) => a + (ln.qty || 0), 0);
        const route = isOut
          ? `${esc(warehouseName(lid, rec.fromWh))} → <span class="muted">${esc((rec.destLabel || '').trim() || 'fuori magazzino')}</span>`
          : `${esc(warehouseName(lid, rec.fromWh))} → ${esc(warehouseName(lid, rec.toWh))}`;
        return `<div class="card" style="margin-bottom:12px">
          <div class="section-title" style="margin-top:0">${isOut ? '⬇️' : '↔️'} ${route} <span class="muted" style="font-weight:500;font-size:12px">· ${fmtDdtDate(rec)} · ${rec.lines.length} rig${rec.lines.length === 1 ? 'a' : 'he'} · ${pezzi} pz</span></div>
          ${rec.note ? `<div class="muted" style="font-size:12.5px;margin:-4px 2px 8px">${esc(rec.note)}</div>` : ''}
          <div class="btnrow" style="margin-top:4px">
            <button class="btn sm" data-tprint="${esc(rec.id)}">🖨️ Ristampa</button>
            <button class="btn sm primary" data-tok="${esc(rec.id)}">✅ Convalida</button>
            <button class="btn sm danger" data-tdel="${esc(rec.id)}">🗑️ Annulla</button>
          </div>
        </div>`;
      }).join('');

  openSheet(`
    <h2>🚚 Trasferimenti da consegnare</h2>
    <div class="sheetsub">DDT interni preparati e in attesa di consegna. Alla consegna convalida le quantità: la merce viene spostata (o esce dalle scorte).</div>
    ${cDdt() ? '<div class="btnrow" style="margin-bottom:12px"><button class="btn primary" data-tnew>+ Nuovo trasferimento</button></div>' : ''}
    <div data-transfers-body>${body}</div>
    <div class="actions"><button class="btn primary" data-close>Chiudi</button></div>`,
    sheet => {
      const rebuild = () => { closeSheet(); transfersSheet(lid, after); };
      sheet.querySelector('[data-close]').onclick = () => { closeSheet(); after && after(); };
      sheet.querySelector('[data-tnew]')?.addEventListener('click', () => { closeSheet(); newTransferSheet(lid, () => transfersSheet(lid, after)); });
      sheet.querySelectorAll('[data-tprint]').forEach(b => b.onclick = () => {
        const rec = pendingTransfer(lid, b.dataset.tprint); if (!rec) return;
        const pdf = generateMovementSlip(activeLocaleObj(), pendingToScheda(rec), warehousesOf(lid));
        showPdfDownloadSheet([pdf]);
      });
      sheet.querySelectorAll('[data-tok]').forEach(b => b.onclick = () => {
        const rec = pendingTransfer(lid, b.dataset.tok); if (rec) validateTransferSheet(lid, rec, rebuild);
      });
      sheet.querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => {
        const rec = pendingTransfer(lid, b.dataset.tdel); if (!rec) return;
        const isOut = rec.type === 'out';
        const dest = isOut ? ((rec.destLabel || '').trim() || 'fuori magazzino') : warehouseName(lid, rec.toWh);
        confirmDialog('Annullare il trasferimento?', `${warehouseName(lid, rec.fromWh)} → ${dest} · ${fmtDdtDate(rec)} — il DDT sparisce dall'elenco senza muovere nulla.`, 'Annulla DDT', () => {
          cancelPendingTransfer(lid, rec.id);
          toast('Trasferimento annullato');
          rebuild();
        }, { danger: true });
      });
    }, { wide: true });
}

// Sheet di convalida: mostra la lista di prelievo con quantità MODIFICABILI (default = preparate). All'ok
// esegue via validatePendingTransfer (movimenti reali, clamp al disponibile) e rimuove il DDT dai pendenti.
function validateTransferSheet(lid, rec, after) {
  const isOut = rec.type === 'out';
  const dest = isOut ? ((rec.destLabel || '').trim() || 'Fuori magazzino') : warehouseName(lid, rec.toWh);
  const rows = rec.lines.map(ln => {
    const av = stockOf(product(ln.productId), rec.fromWh);
    return `<div class="row">
      <div class="mid"><div class="t1">${esc(ln.name)}${ln.format ? ` <span class="badge soft" style="font-size:10px">${esc(ln.format)}</span>` : ''}</div>
        <div class="t2 muted">disp. ${av} in ${esc(warehouseName(lid, rec.fromWh))}${ln.qty > av ? ' · <span style="color:var(--orange,#b08a4e)">oltre giacenza</span>' : ''}</div></div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="btn sm" data-vminus data-prod="${esc(ln.productId)}" aria-label="Diminuisci">−</button>
        <input class="vq" data-prod="${esc(ln.productId)}" type="number" min="0" inputmode="numeric" value="${ln.qty}" style="width:52px;text-align:center;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--input-bg,var(--surface));color:var(--txt);font-weight:800" aria-label="Quantità consegnata">
        <button class="btn sm primary" data-vplus data-prod="${esc(ln.productId)}" aria-label="Aumenta">+</button>
      </div>
    </div>`;
  }).join('');
  openSheet(`
    <h2>✅ Convalida consegna</h2>
    <div class="sheetsub">${esc(warehouseName(lid, rec.fromWh))} → ${esc(dest)} · conferma le quantità effettivamente consegnate.</div>
    <div class="list">${rows}</div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Convalida ed esegui</button></div>`,
    sheet => {
      const step = (btn, delta) => { const inp = sheet.querySelector(`.vq[data-prod="${CSS.escape(btn.dataset.prod)}"]`); if (!inp) return; let v = (parseInt(inp.value, 10) || 0) + delta; if (v < 0) v = 0; inp.value = v; };
      sheet.querySelectorAll('[data-vminus]').forEach(b => b.onclick = () => step(b, -1));
      sheet.querySelectorAll('[data-vplus]').forEach(b => b.onclick = () => step(b, +1));
      sheet.querySelector('[data-cancel]').onclick = () => { closeSheet(); after && after(); };
      sheet.querySelector('[data-ok]').onclick = () => {
        const qtyById = {};
        sheet.querySelectorAll('.vq').forEach(inp => { qtyById[inp.dataset.prod] = parseInt(inp.value, 10) || 0; });
        const scheda = validatePendingTransfer(lid, rec.id, qtyById);
        closeSheet();
        if (!scheda) { toast(isOut ? 'Niente da far uscire (giacenza insufficiente)' : 'Niente da trasferire (giacenza insufficiente)'); }
        else toast(isOut ? 'Uscita registrata ✓' : 'Trasferimento eseguito ✓');
        after && after();
      };
    }, { wide: true });
}

// ---- Barra filtri prodotti condivisa (sezioni Soglie e Inventario) ----
// Stato `f` = { q, cat, sub, sup }: ricerca nome + categoria › sottocategoria + fornitore. Le funzioni
// normalizzano lo stato, filtrano una lista, producono la barra e ne cablano gli eventi, così le due
// sezioni condividono il codice. `extra` = slot per un select specifico (stato soglie / stato inventario).
function pfNormalize(lid, f) {
  if (f.cat !== 'all' && !topTypes(lid).some(c => c.id === f.cat)) { f.cat = 'all'; f.sub = 'all'; }
  if (f.cat === 'all') f.sub = 'all';
  else if (f.sub !== 'all' && !subTypes(lid, f.cat).some(s => s.id === f.sub)) f.sub = 'all';
  if (f.sup !== 'all' && f.sup !== '__none__' && !suppliersOf(lid).some(s => s.id === f.sup)) f.sup = 'all';
}
function pfApply(lid, f, list) {
  let out = list;
  const term = f.q.trim().toLowerCase();
  if (term) out = out.filter(p => productMatches(p, term));
  // categoria: prodotto la cui categoria-top O sottocategoria coincide (come nel Database)
  if (f.cat !== 'all') out = out.filter(p => { const t = type(lid, p.typeId); return !!t && (p.typeId === f.cat || t.parentId === f.cat); });
  if (f.sub !== 'all') out = out.filter(p => p.typeId === f.sub);
  if (f.sup === '__none__') out = out.filter(p => !p.supplierId);
  else if (f.sup !== 'all') out = out.filter(p => p.supplierId === f.sup);
  return out;
}
const pfActive = f => !!f.q.trim() || f.cat !== 'all' || f.sub !== 'all' || f.sup !== 'all';
function pfBar(lid, f, extra = '') {
  const catOpts = `<option value="all">Tutte le categorie</option>` + topTypes(lid).map(c => `<option value="${esc(c.id)}" ${f.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const subs = f.cat !== 'all' ? subTypes(lid, f.cat) : [];
  const subField = subs.length ? `<div class="field" style="margin:0;min-width:0"><label>Sottocategoria</label><select id="pf_sub"><option value="all">Tutte</option>${subs.map(s => `<option value="${esc(s.id)}" ${f.sub === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : '';
  const supOpts = `<option value="all">Tutti i fornitori</option>` + suppliersOf(lid).map(s => `<option value="${esc(s.id)}" ${f.sup === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('') + `<option value="__none__" ${f.sup === '__none__' ? 'selected' : ''}>— Senza fornitore —</option>`;
  return `
      <div class="field"><input id="pf_q" placeholder="Cerca prodotto…" value="${esc(f.q)}"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:8px">
        <div class="field" style="margin:0;min-width:0"><label>Categoria</label><select id="pf_cat">${catOpts}</select></div>
        ${subField}
        <div class="field" style="margin:0;min-width:0"><label>Fornitore</label><select id="pf_sup">${supOpts}</select></div>
        ${extra}
      </div>`;
}
// cabla ricerca + select condivisi. `rerender` DEVE raccogliere gli input di sezione prima di ridisegnare
// (così i valori digitati su righe che escono dal filtro non vanno persi).
// `onEnter` (facoltativo): Invio nella ricerca. Se fornito, la ricerca viene prima allineata (rerender)
// e poi si esegue onEnter() — usato dall'Inventario per il flusso barcode (scan → focus conteggio).
function pfBind(root, f, rerender, onEnter) {
  const qi = root.querySelector('#pf_q');
  if (qi) {
    const commit = () => { const pos = qi.selectionStart; rerender(); const n = root.querySelector('#pf_q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } };
    const deb = debounce(commit, 130);
    qi.oninput = () => { f.q = qi.value; deb(); };
    qi.onkeydown = e => {
      if (e.key !== 'Enter') return; e.preventDefault(); f.q = qi.value; deb.cancel();
      if (onEnter) onEnter(); else commit();
    };
  }
  const catSel = root.querySelector('#pf_cat'); if (catSel) catSel.onchange = () => { f.cat = catSel.value; f.sub = 'all'; rerender(); };
  const subSel = root.querySelector('#pf_sub'); if (subSel) subSel.onchange = () => { f.sub = subSel.value; rerender(); };
  const supSel = root.querySelector('#pf_sup'); if (supSel) supSel.onchange = () => { f.sup = supSel.value; rerender(); };
}

// riga numerica compatta (condivisa da Soglie e Inventario)
const NUMBOX = 'width:64px;text-align:center;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--input-bg,var(--surface));color:var(--txt);font-weight:800;flex-shrink:0';
// meta riga (giacenza · fornitore · categoria) per le sezioni a tutta pagina (più spazio della sheet)
function prodMeta(lid, p, first) {
  const sup = supplierName(p.supplierId);
  const cat = p.typeId ? typeName(lid, p.typeId) : '';
  return [first, sup && sup !== '—' ? esc(sup) : null, cat && cat !== '—' ? esc(cat) : null].filter(Boolean).join(' · ');
}

// ---- Inventario: sezione dedicata a tutta pagina (conta fisica per magazzino → rettifica) ----
// Stampa il foglio, inserisci i valori contati: i prodotti con contato ≠ attuale diventano UNA
// scheda 'rettifica' (delta come movimenti). Scelta magazzino inline, filtri prodotti condivisi.
const invDefaultLabel = (lid, whId) => `Inventario ${warehouseName(lid, whId)} ${new Date().toLocaleDateString('it-IT')}`;
// prodotti pertinenti a un magazzino: ammessi dalla categoria O con giacenza qui (come il carico massivo)
const invBase = (lid, whId) => productsOf(lid).filter(p => warehouseAllowsProduct(lid, whId, p) || stockOf(p, whId) > 0);
const invCounted = p => invCounts[p.id] != null ? invCounts[p.id] : null;   // contato (null = riga intatta)
const invAdjusted = p => { const c = invCounted(p); return c != null && c !== stockOf(p, invWh); };

function renderInventory(lid, l) {
  const whs = warehousesOf(lid);
  let h = `<div class="pagehead"><h1>📋 Inventario</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;
  h += `<div class="btnrow" style="margin-bottom:10px"><button class="btn sm" data-back>← Giacenze</button></div>`;
  if (!whs.length) return h + `<div class="card empty">Nessun magazzino.<br><span class="muted">Crea un magazzino per fare l'inventario.</span></div>`;
  if (!invWh || !whs.some(w => w.id === invWh)) invWh = whs[0].id;
  pfNormalize(lid, invFilter);

  const base = invBase(lid, invWh);
  let list = pfApply(lid, invFilter, base);
  if (invStatus === 'stock') list = list.filter(p => stockOf(p, invWh) > 0);
  else if (invStatus === 'out') list = list.filter(p => stockOf(p, invWh) <= 0);
  else if (invStatus === 'adjusted') list = list.filter(invAdjusted);
  const dirtyN = base.filter(invAdjusted).length;

  const whOpts = whs.map(w => `<option value="${w.id}" ${w.id === invWh ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
    <div class="muted" style="font-size:12.5px;min-width:0">Conta fisica per magazzino: stampa il foglio, poi inserisci i valori contati. Le differenze diventano una rettifica.</div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      <button class="btn sm" data-print>⤓ Foglio PDF</button>
      <button class="btn sm primary" data-save ${dirtyN ? '' : 'disabled'}>Conferma rettifica${dirtyN ? ` · ${dirtyN}` : ''}</button>
    </div>
  </div>`;
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:8px">
    <div class="field" style="margin:0;min-width:0"><label>Magazzino</label><select id="inv_wh">${whOpts}</select></div>
    <div class="field" style="margin:0;min-width:0"><label>Nome scheda</label><input id="inv_label" value="${esc(invLabel)}"></div>
  </div>`;

  const statusOpts = [['all', 'Tutti'], ['stock', 'Con giacenza'], ['out', 'Esauriti'], ['adjusted', 'Rettificati']].map(([v, t]) => `<option value="${v}" ${invStatus === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
  h += pfBar(lid, invFilter, `<div class="field" style="margin:0;min-width:0"><label>Stato</label><select id="inv_status">${statusOpts}</select></div>`);
  const anyFilter = pfActive(invFilter) || invStatus !== 'all';
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 2px 8px">
    <span class="muted" style="font-size:12.5px">${list.length} prodott${list.length === 1 ? 'o' : 'i'}${dirtyN ? ` · <span style="color:var(--accent)">${dirtyN} da rettificare</span>` : ''}</span>
    ${anyFilter ? '<button class="btn sm" data-inv-reset>Azzera filtri</button>' : ''}
  </div>`;
  h += `<div style="display:flex;justify-content:flex-end;margin:0 2px 4px 0"><span class="muted" style="width:64px;text-align:center;font-size:11px">contati</span></div>`;
  if (!list.length) return h + `<div class="card empty">${base.length ? 'Nessun prodotto con questi filtri.' : 'Nessun prodotto per questo magazzino.'}</div>`;
  h += `<div class="list" data-invlist>${list.map(p => {
    const av = stockOf(p, invWh);
    const val = invCounted(p) != null ? invCounted(p) : av;
    const diff = (parseInt(val, 10) || 0) !== av;
    return `<div class="row">
      <div class="mid"><div class="t1">${esc(p.name)}${p.format ? ` <span class="badge soft" style="font-size:10px">${esc(p.format)}</span>` : ''}${codeTag(p.code)}</div>
        <div class="t2 muted">${prodMeta(lid, p, 'giac. attuale ' + av)}${diff ? ' · <span style="color:var(--accent)">modificato</span>' : ''}</div></div>
      <input class="iq" data-prod="${esc(p.id)}" type="number" min="0" inputmode="numeric" value="${esc(String(val))}" style="${NUMBOX}" aria-label="Contati">
    </div>`;
  }).join('')}</div>`;
  return h;
}

function bindInventory(root) {
  const lid = activeLocale();
  const collectInv = () => root.querySelectorAll('.iq').forEach(inp => { invCounts[inp.dataset.prod] = parseInt(inp.value, 10) || 0; });
  const dirtyCount = () => { collectInv(); return productsOf(lid).filter(p => { const c = invCounts[p.id]; return c != null && c !== stockOf(p, invWh); }).length; };
  const rerender = () => { collectInv(); root.innerHTML = render(); bind(root); };
  const goStock = () => { mode = 'stock'; root.innerHTML = render(); bind(root); };
  root.querySelector('[data-back]').onclick = () => {
    if (dirtyCount()) confirmDialog('Uscire dall\'inventario?', 'Ci sono conte non salvate: uscendo vengono perse.', 'Esci', () => { invCounts = {}; goStock(); }, { danger: true });
    else goStock();
  };
  const whSel = root.querySelector('#inv_wh');
  if (whSel) whSel.onchange = () => {
    const target = whSel.value;
    const doSwitch = () => { invWh = target; invCounts = {}; invLabel = invDefaultLabel(lid, invWh); rerender(); };
    if (dirtyCount()) { whSel.value = invWh; confirmDialog('Cambiare magazzino?', 'Le conte non salvate di questo magazzino verranno perse.', 'Cambia', doSwitch, { danger: true }); }
    else doSwitch();
  };
  const labelEl = root.querySelector('#inv_label'); if (labelEl) labelEl.oninput = () => { invLabel = labelEl.value; };
  // porta il focus (testo selezionato) sul conteggio di pid, se presente; altrimenti false
  const focusIq = pid => { const inp = root.querySelector(`.iq[data-prod="${CSS.escape(pid)}"]`); if (inp) { inp.focus(); try { inp.select(); } catch {} return true; } return false; };
  // Invio in ricerca = barcode: codice esatto (o risultato unico) → focus sul conteggio del prodotto.
  const scan = () => {
    rerender();
    const scopeList = invBase(lid, invWh);
    const target = scanTarget(invFilter.q, scopeList, pfApply(lid, invFilter, scopeList));
    if (!target) { root.querySelector('#pf_q')?.focus(); return; }
    if (!focusIq(target.id)) {
      invFilter.cat = 'all'; invFilter.sub = 'all'; invFilter.sup = 'all'; invStatus = 'all';
      rerender();
      if (!focusIq(target.id)) root.querySelector('#pf_q')?.focus();
    }
  };
  pfBind(root, invFilter, rerender, scan);
  const stSel = root.querySelector('#inv_status'); if (stSel) stSel.onchange = () => { invStatus = stSel.value; rerender(); };
  root.querySelector('[data-inv-reset]')?.addEventListener('click', () => { invFilter.q = ''; invFilter.cat = 'all'; invFilter.sub = 'all'; invFilter.sup = 'all'; invStatus = 'all'; rerender(); });
  root.querySelectorAll('.iq').forEach(inp => {
    inp.oninput = () => {
      invCounts[inp.dataset.prod] = parseInt(inp.value, 10) || 0;
      const btn = root.querySelector('[data-save]'); if (!btn) return;
      const n = productsOf(lid).filter(p => { const c = invCounts[p.id]; return c != null && c !== stockOf(p, invWh); }).length;
      btn.disabled = !n; btn.textContent = 'Conferma rettifica' + (n ? ` · ${n}` : '');
    };
    // Invio: passa al conteggio successivo (come le Soglie); se non c'è (es. lista ridotta a 1 dopo uno
    // scan) azzera la ricerca e torna alla casella, pronta per il prossimo barcode.
    inp.onkeydown = e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      invCounts[inp.dataset.prod] = parseInt(inp.value, 10) || 0;
      const iqs = [...root.querySelectorAll('.iq')];
      const i = iqs.indexOf(inp);
      if (i >= 0 && i < iqs.length - 1) { iqs[i + 1].focus(); try { iqs[i + 1].select(); } catch {} }
      else { invFilter.q = ''; rerender(); root.querySelector('#pf_q')?.focus(); }
    };
  });
  root.querySelector('[data-print]').onclick = () => {
    const prods = invBase(lid, invWh).map(p => ({ name: p.name, format: p.format || '', stock: stockOf(p, invWh) }));
    const pdf = generateInventorySheet(activeLocaleObj(), warehouse(lid, invWh), prods);
    showPdfDownloadSheet([pdf]);
  };
  root.querySelector('[data-save]').onclick = () => {
    collectInv();
    const scheda = applyInventoryBatch(lid, invWh, invCounts, invLabel.trim());
    if (!scheda) { toast('Nessuna differenza rilevata'); return; }
    const n = scheda.lines.length;
    toast(`Inventario registrato ✓ · ${n} rettific${n === 1 ? 'a' : 'he'}`);
    invCounts = {}; invLabel = invDefaultLabel(lid, invWh);
    root.innerHTML = render(); bind(root);
  };
  if (consumeViewEntry()) gentleAutofocus(root.querySelector('#pf_q'));
}

// ---- Soglie di scorta: sezione dedicata a tutta pagina (soglia minima + scorta target) ----
// Scorri i prodotti del locale, digita i due valori e salva in un colpo solo (una sola save).
// Soglia minima = avviso sotto scorta sul totale; scorta target = obiettivo della proposta d'ordine.
// I valori CORRENTI (sessione) riflettono le modifiche già digitate (thrVals), non solo il salvato.
const thrCurMin = p => thrVals[p.id]?.min != null ? thrVals[p.id].min : (p.minStock || 0);
const thrCurTarget = p => thrVals[p.id]?.target != null ? thrVals[p.id].target : (p.targetStock || 0);
const thrHasThr = p => thrCurMin(p) > 0 || thrCurTarget(p) > 0;                     // ha almeno una soglia impostata
const thrModified = p => thrCurMin(p) !== (p.minStock || 0) || thrCurTarget(p) !== (p.targetStock || 0);

function renderThresholds(lid, l) {
  pfNormalize(lid, thrFilter);
  const all = productsOf(lid);
  let list = pfApply(lid, thrFilter, all);
  if (thrStatus === 'none') list = list.filter(p => !thrHasThr(p));
  else if (thrStatus === 'low') list = list.filter(p => thrCurMin(p) > 0 && totalStock(p) < thrCurMin(p));
  else if (thrStatus === 'modified') list = list.filter(thrModified);
  if (thrSort === 'stock') list = list.slice().sort((a, b) => totalStock(a) - totalStock(b));
  else if (thrSort === 'none') list = list.slice().sort((a, b) => (thrHasThr(a) ? 1 : 0) - (thrHasThr(b) ? 1 : 0));
  const dirtyN = all.filter(thrModified).length;

  let h = `<div class="pagehead"><h1>🎯 Soglie di scorta</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
    <button class="btn sm" data-back>← Giacenze</button>
    <button class="btn sm primary" data-save ${dirtyN ? '' : 'disabled'}>Salva soglie${dirtyN ? ` · ${dirtyN}` : ''}</button>
  </div>`;
  h += `<div class="muted" style="font-size:12.5px;margin:-2px 2px 10px">Soglia minima = avviso sotto scorta sul totale tra i magazzini. Scorta target = obiettivo usato dalla proposta d'ordine. Compila e salva in un colpo solo.</div>`;

  const statusOpts = [['all', 'Tutti'], ['none', 'Senza soglie'], ['low', 'Sotto soglia'], ['modified', 'Modificati']].map(([v, t]) => `<option value="${v}" ${thrStatus === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const sortOpts = [['nat', 'Ordine naturale'], ['stock', 'Giacenza ↑'], ['none', 'Senza soglie prima']].map(([v, t]) => `<option value="${v}" ${thrSort === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
  h += pfBar(lid, thrFilter, `<div class="field" style="margin:0;min-width:0"><label>Stato soglie</label><select id="thr_status">${statusOpts}</select></div>
        <div class="field" style="margin:0;min-width:0"><label>Ordina</label><select id="thr_sort">${sortOpts}</select></div>`);
  const anyFilter = pfActive(thrFilter) || thrStatus !== 'all' || thrSort !== 'nat';
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 2px 8px">
    <span class="muted" style="font-size:12.5px">${list.length} prodott${list.length === 1 ? 'o' : 'i'}${dirtyN ? ` · <span style="color:var(--accent)">${dirtyN} modificat${dirtyN === 1 ? 'o' : 'i'}</span>` : ''}</span>
    ${anyFilter ? '<button class="btn sm" data-thr-reset>Azzera filtri</button>' : ''}
  </div>`;
  h += `<div style="display:flex;justify-content:flex-end;gap:6px;margin:0 2px 4px 0"><span class="muted" style="width:64px;text-align:center;font-size:11px">min</span><span class="muted" style="width:64px;text-align:center;font-size:11px">target</span></div>`;
  if (!list.length) return h + `<div class="card empty">${all.length ? 'Nessun prodotto con questi filtri.' : 'Nessun prodotto.'}</div>`;
  h += `<div class="list" data-thrlist>${list.map((p, i) => {
    const dMin = thrCurMin(p), dTarget = thrCurTarget(p);
    return `<div class="row">
      <div class="mid"><div class="t1">${esc(p.name)}${p.format ? ` <span class="badge soft" style="font-size:10px">${esc(p.format)}</span>` : ''}${codeTag(p.code)}</div>
        <div class="t2 muted">${prodMeta(lid, p, 'giac. ' + totalStock(p))}${thrModified(p) ? ' · <span style="color:var(--accent)">modificato</span>' : ''}</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <input class="thr" data-prod="${esc(p.id)}" data-col="min" data-idx="${i}" type="number" min="0" inputmode="numeric" placeholder="0" value="${dMin > 0 ? esc(String(dMin)) : ''}" style="${NUMBOX}" aria-label="Soglia minima">
        <input class="thr" data-prod="${esc(p.id)}" data-col="target" data-idx="${i}" type="number" min="0" inputmode="numeric" placeholder="0" value="${dTarget > 0 ? esc(String(dTarget)) : ''}" style="${NUMBOX}" aria-label="Scorta target">
      </div>
    </div>`;
  }).join('')}</div>`;
  return h;
}

function bindThresholds(root) {
  const lid = activeLocale();
  // accumula i due valori di ogni riga visibile in thrVals (prima di ogni redraw): le righe che escono
  // dal filtro NON perdono le modifiche, che restano in thrVals e si salvano comunque tutte.
  const collectThr = () => root.querySelectorAll('.thr').forEach(inp => { (thrVals[inp.dataset.prod] || (thrVals[inp.dataset.prod] = {}))[inp.dataset.col] = parseInt(inp.value, 10) || 0; });
  const rerender = () => { collectThr(); root.innerHTML = render(); bind(root); };
  const goStock = () => { mode = 'stock'; root.innerHTML = render(); bind(root); };
  root.querySelector('[data-back]').onclick = () => {
    collectThr();
    if (productsOf(lid).some(thrModified)) confirmDialog('Uscire dalle soglie?', 'Ci sono soglie non salvate: uscendo vengono perse.', 'Esci', () => { thrVals = {}; goStock(); }, { danger: true });
    else goStock();
  };
  pfBind(root, thrFilter, rerender);
  const stSel = root.querySelector('#thr_status'); if (stSel) stSel.onchange = () => { thrStatus = stSel.value; rerender(); };
  const soSel = root.querySelector('#thr_sort'); if (soSel) soSel.onchange = () => { thrSort = soSel.value; rerender(); };
  root.querySelector('[data-thr-reset]')?.addEventListener('click', () => { thrFilter.q = ''; thrFilter.cat = 'all'; thrFilter.sub = 'all'; thrFilter.sup = 'all'; thrStatus = 'all'; thrSort = 'nat'; rerender(); });
  root.querySelectorAll('.thr').forEach(inp => {
    inp.oninput = () => {
      (thrVals[inp.dataset.prod] || (thrVals[inp.dataset.prod] = {}))[inp.dataset.col] = parseInt(inp.value, 10) || 0;
      const btn = root.querySelector('[data-save]'); if (!btn) return;
      const n = productsOf(lid).filter(thrModified).length;
      btn.disabled = !n; btn.textContent = 'Salva soglie' + (n ? ` · ${n}` : '');
    };
    // Invio → passa all'input successivo della stessa colonna
    inp.onkeydown = e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = root.querySelector(`.thr[data-col="${inp.dataset.col}"][data-idx="${(+inp.dataset.idx) + 1}"]`);
      if (next) { next.focus(); next.select(); }
    };
  });
  root.querySelector('[data-save]').onclick = () => {
    collectThr();
    const n = applyStockThresholds(lid, thrVals);
    if (!n) { toast('Nessuna modifica'); return; }
    toast(`Soglie aggiornate ✓ · ${n} prodott${n === 1 ? 'o' : 'i'}`);
    thrVals = {};
    root.innerHTML = render(); bind(root);
  };
}

// ---- Storico schede di movimento (consultazione + ristampa) ----
function fmtSchedaDate(s) {
  return s.ts ? new Date(s.ts).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : (s.date || '');
}
// riga-scheda per la lista (riusata dalla visuale dedicata). `canDel` mostra l'azione Elimina in riga.
function schedaRow(lid, s, canDel) {
  const pezzi = s.lines.reduce((a, ln) => a + (ln.qty || 0), 0);
  const route = s.type === 'transfer'
    ? `${esc(warehouseName(lid, s.fromWh))} → ${esc(warehouseName(lid, s.toWh))}`
    : s.type === 'carico'
      ? `<span class="muted">esterno</span> → ${esc(warehouseName(lid, s.toWh))}`
      : s.type === 'rettifica'
        ? esc(warehouseName(lid, s.toWh))
        : `${esc(warehouseName(lid, s.fromWh))} → <span class="muted">fuori magazzino</span>`;
  const emoji = s.type === 'transfer' ? '↔️' : s.type === 'carico' ? '⬆️' : s.type === 'rettifica' ? '📋' : '⬇️';
  const typeLabel = s.type === 'transfer' ? 'Trasferimento' : s.type === 'carico' ? 'Carico' : s.type === 'rettifica' ? 'Rettifica' : 'Prelievo';
  const name = (s.label || '').trim() ? ` · <b>${esc(s.label.trim())}</b>` : '';
  return `<div class="row click" data-scheda="${esc(s.batchId)}">
    <div class="emoji">${emoji}</div>
    <div class="mid"><div class="t1">${typeLabel}${name} <span class="muted" style="font-weight:500;font-size:12px">· ${esc(fmtSchedaDate(s))}</span></div>
      <div class="t2">${route} · ${s.lines.length} rig${s.lines.length === 1 ? 'a' : 'he'} · ${pezzi} pz</div></div>
    ${canDel ? `<button class="btn-icon" data-schedadel="${esc(s.batchId)}" title="Elimina scheda" aria-label="Elimina scheda" style="color:var(--red);flex-shrink:0">🗑</button>` : ''}
  </div>`;
}

// Visuale dedicata "Schede di movimento": ricerca, filtri rapidi (tipo/magazzino/periodo in AND)
// e rendering incrementale (mai tutto insieme). È una modalità della vista Magazzino.
function renderSchede(lid, l) {
  const whs = warehousesOf(lid);
  if (sWh !== 'all' && !whs.some(w => w.id === sWh)) sWh = 'all';   // magazzino non più valido → tutti
  const all = schede(lid);

  // filtri combinati in AND
  let list = all;
  if (sTipo !== 'all') list = list.filter(s => s.type === sTipo);
  if (sWh !== 'all') list = list.filter(s => s.fromWh === sWh || s.toWh === sWh);
  const cut = periodCutoff(sPeriod);
  if (cut) list = list.filter(s => (s.ts || 0) >= cut);
  const term = sq.trim().toLowerCase();
  if (term) list = list.filter(s => (s.label || '').toLowerCase().includes(term) || (s.note || '').toLowerCase().includes(term) || s.lines.some(ln => (ln.name || '').toLowerCase().includes(term) || (ln.code || '').toLowerCase().includes(term)));

  let h = `<div class="pagehead"><h1>🧾 Schede di movimento</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;
  h += `<div class="btnrow" style="margin-bottom:10px"><button class="btn sm" data-back>← Giacenze</button></div>`;

  // filtri: tipo (chips) · magazzino/periodo (select) · ricerca
  const tipoChip = (v, lbl) => `<button class="chip ${sTipo === v ? 'on' : ''}" data-stipo="${v}">${lbl}</button>`;
  h += `<div class="chips" style="margin-bottom:8px">${tipoChip('all', 'Tutte')}${tipoChip('carico', '⬆️ Carichi')}${tipoChip('prelievo', '⬇️ Prelievi')}${tipoChip('transfer', '↔️ Trasferimenti')}${tipoChip('rettifica', '📋 Rettifiche')}</div>`;
  const whOpts = `<option value="all">Tutti i magazzini</option>` + whs.map(w => `<option value="${w.id}" ${sWh === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
  const perOpts = SCHEDE_PERIODS.map(([v, lbl]) => `<option value="${v}" ${sPeriod === v ? 'selected' : ''}>${esc(lbl)}</option>`).join('');
  h += `<div class="frow" style="margin-bottom:8px">
    <div class="field" style="margin:0"><label>Magazzino</label><select id="s_wh">${whOpts}</select></div>
    <div class="field" style="margin:0"><label>Periodo</label><select id="s_period">${perOpts}</select></div>
  </div>`;
  h += `<div class="field"><input id="s_q" placeholder="Cerca nome, prodotto o nota…" value="${esc(sq)}"></div>`;

  const anyFilter = !!term || sTipo !== 'all' || sWh !== 'all' || sPeriod !== 'all';
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
    <span class="muted" style="font-size:12.5px">${all.length} sched${all.length === 1 ? 'a' : 'e'} · ${list.length} nel filtro</span>
    ${anyFilter ? '<button class="btn sm" data-reset>Azzera</button>' : ''}
  </div>`;

  if (!all.length) return h + `<div class="card empty" style="padding:18px">Nessuna scheda.<br><span class="muted">Carichi, prelievi e trasferimenti multi-prodotto compaiono qui.</span></div>`;
  if (!list.length) return h + `<div class="card empty">Nessuna scheda con questi filtri.</div>`;

  const visible = list.slice(0, schedeShown);
  const canDel = cDelScheda();
  h += `<div class="list">${visible.map(s => schedaRow(lid, s, canDel)).join('')}</div>`;
  if (list.length > visible.length) {
    h += `<div class="btnrow" style="justify-content:center;margin-top:10px"><button class="btn" data-more>Mostra altri (restano ${list.length - visible.length})</button></div>`;
  }
  return h;
}

// interazioni della visuale Schede (chiamata da bind quando mode === 'schede')
function bindSchede(root) {
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };
  const reset = () => { schedeShown = SCHEDE_STEP; };   // ricomincia dall'inizio quando cambia un filtro
  root.querySelector('[data-back]').onclick = () => { mode = 'stock'; rerender(); };
  root.querySelectorAll('[data-stipo]').forEach(b => b.onclick = () => { sTipo = b.dataset.stipo; reset(); rerender(); });
  const whSel = root.querySelector('#s_wh'); if (whSel) whSel.onchange = () => { sWh = whSel.value; reset(); rerender(); };
  const perSel = root.querySelector('#s_period'); if (perSel) perSel.onchange = () => { sPeriod = perSel.value; reset(); rerender(); };
  const qi = root.querySelector('#s_q');
  if (qi) qi.oninput = () => { sq = qi.value; reset(); const pos = qi.selectionStart; rerender(); const n = root.querySelector('#s_q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  root.querySelector('[data-reset]')?.addEventListener('click', () => { sq = ''; sTipo = 'all'; sWh = 'all'; sPeriod = 'all'; reset(); rerender(); });
  root.querySelector('[data-more]')?.addEventListener('click', () => { schedeShown += SCHEDE_STEP; rerender(); });
  // elimina dalla riga (storno): stopPropagation per non aprire il dettaglio della stessa riga
  root.querySelectorAll('[data-schedadel]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const s = schedaById(lid, b.dataset.schedadel);
    if (s) confirmDeleteScheda(lid, s, rerender);
  });
  // il dettaglio è uno sheet sopra la visuale: chiudendolo si torna qui (nessun back esplicito)
  root.querySelectorAll('[data-scheda]').forEach(el => el.onclick = () => schedaDetail(lid, el.dataset.scheda, null, rerender));
}
function schedaDetail(lid, batchId, back, onChange) {
  const s = schedaById(lid, batchId);
  if (!s) { toast('Scheda non trovata'); back && back(); return; }
  const isTransfer = s.type === 'transfer';
  const isCarico = s.type === 'carico';
  const isRettifica = s.type === 'rettifica';
  const from = isRettifica ? esc(warehouseName(lid, s.toWh)) : isCarico ? '<span class="muted">esterno / fornitore</span>' : esc(warehouseName(lid, s.fromWh));
  const dest = isRettifica ? '<span class="muted">rettifica giacenza</span>' : isCarico ? esc(warehouseName(lid, s.toWh)) : isTransfer ? esc(warehouseName(lid, s.toWh)) : '<span class="muted">fuori magazzino</span>';
  const type = isRettifica ? '📋 Rettifica' : isCarico ? '⬆️ Carico' : isTransfer ? '↔️ Trasferimento' : '⬇️ Prelievo';
  const name = (s.label || '').trim();
  const head = name ? `${type} · ${esc(name)}` : type;
  const pezzi = s.lines.reduce((a, ln) => a + (ln.qty || 0), 0);
  // per la rettifica mostriamo il segno del delta (+ aumento / − diminuzione)
  const amt = ln => isRettifica ? `<span class="tnum ${ln.kind === 'out' ? 'neg' : 'pos'}" style="font-weight:800">${ln.kind === 'out' ? '−' : '+'}${ln.qty}</span>` : `<span class="amt tnum" style="font-weight:800">${ln.qty}</span>`;
  const rows = s.lines.map(ln => `<div class="row">
    <div class="mid"><div class="t1">${esc(ln.name)}${codeTag(ln.code)}</div></div>
    ${amt(ln)}
  </div>`).join('');
  openSheet(`
    <h2>${head}</h2>
    <div class="sheetsub">${esc(fmtSchedaDate(s))} · ${from} → ${dest}</div>
    <div class="section-title">Prodotti <span class="muted" style="font-weight:500">· ${s.lines.length} rig${s.lines.length === 1 ? 'a' : 'he'} · ${pezzi} pz</span></div>
    <div class="list">${rows}</div>
    ${s.note ? `<div class="section-title">Nota</div><div class="card" style="padding:12px">${esc(s.note)}</div>` : ''}
    <div class="actions"><button class="btn" data-back>Indietro</button>
      ${cRename() ? '<button class="btn" data-rename>✏️ Rinomina</button>' : ''}
      ${cDelScheda() ? '<button class="btn danger" data-del>🗑 Elimina</button>' : ''}
      <button class="btn primary" data-print>⤓ Ristampa scheda</button></div>`,
    sheet => {
      sheet.querySelector('[data-back]').onclick = () => { closeSheet(); back && back(); };
      sheet.querySelector('[data-rename]')?.addEventListener('click', () => renameSchedaModal(lid, s, back, onChange));
      // Elimina (storno): il confirm sostituisce questo sheet; annullando si torna al dettaglio.
      sheet.querySelector('[data-del]')?.addEventListener('click', () =>
        confirmDeleteScheda(lid, s, () => { onChange && onChange(); back && back(); }, () => schedaDetail(lid, s.batchId, back, onChange)));
      sheet.querySelector('[data-print]').onclick = () => {
        const l = activeLocaleObj();
        const pdf = generateMovementSlip(l, s, warehousesOf(lid));
        showPdfDownloadSheet([pdf]);
      };
    });
}

// Conferma distruttiva dell'eliminazione di una scheda, con riepilogo (tipo, data, magazzini, righe/pezzi,
// effetto sulle giacenze) e avviso se lo storno porterebbe qualche giacenza in negativo (clampata a 0).
// `after` gira dopo l'eliminazione; `onCancel` all'annulla (default: chiudi).
function confirmDeleteScheda(lid, s, after, onCancel = closeSheet) {
  const prev = schedaDeletionPreview(lid, s.batchId);
  const pezzi = s.lines.reduce((a, ln) => a + (ln.qty || 0), 0);
  const isTransfer = s.type === 'transfer', isCarico = s.type === 'carico', isRettifica = s.type === 'rettifica';
  const typeLabel = isTransfer ? 'Trasferimento' : isCarico ? 'Carico' : isRettifica ? 'Rettifica' : 'Prelievo';
  const route = isTransfer ? `${esc(warehouseName(lid, s.fromWh))} → ${esc(warehouseName(lid, s.toWh))}`
    : isCarico ? `esterno → ${esc(warehouseName(lid, s.toWh))}`
    : isRettifica ? esc(warehouseName(lid, s.toWh))
    : `${esc(warehouseName(lid, s.fromWh))} → fuori magazzino`;
  const effetto = isCarico ? 'le quantità caricate verranno tolte dalle giacenze'
    : isRettifica ? 'la rettifica verrà annullata (giacenze riportate al valore precedente il conteggio)'
    : isTransfer ? 'il trasferimento verrà riportato indietro tra i due magazzini'
    : 'le quantità prelevate verranno rimesse in giacenza';
  const neg = prev ? prev.negatives : 0;
  const negWarn = neg > 0 ? `<div class="card" style="padding:11px 13px;margin-top:10px;border-color:color-mix(in srgb,var(--red) 35%,var(--line));background:color-mix(in srgb,var(--red) 8%,var(--card))">
      <b style="color:var(--red)">⚠️ ${neg} prodott${neg === 1 ? 'o andrebbe' : 'i andrebbero'} in negativo</b>
      <div class="muted" style="font-size:12.5px;margin-top:3px">Quella merce è stata movimentata dopo questa scheda: la giacenza verrà fermata a 0 anziché scendere sotto zero. Potrai sistemarla con una rettifica.</div>
    </div>` : '';
  openSheet(`
    <h2>Eliminare la scheda?</h2>
    <div class="sheetsub">Storna le giacenze e rimuove la scheda dallo storico. L'operazione non è reversibile.</div>
    <div class="card" style="padding:12px 14px">
      <div><b>${typeLabel}</b>${(s.label || '').trim() ? ' · ' + esc(s.label.trim()) : ''}</div>
      <div class="muted" style="font-size:12.5px;margin-top:4px">${esc(fmtSchedaDate(s))} · ${route} · ${s.lines.length} rig${s.lines.length === 1 ? 'a' : 'he'} · ${pezzi} pz</div>
      <div class="muted" style="font-size:12.5px;margin-top:6px">Effetto: ${effetto}.</div>
    </div>
    ${negWarn}
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn danger" data-ok>🗑 Elimina scheda</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = () => onCancel();
      sheet.querySelector('[data-ok]').onclick = () => {
        const r = deleteScheda(lid, s.batchId);
        closeSheet();
        if (!r) toast('Scheda non trovata');
        else toast(`Scheda eliminata ✓${r.negatives ? ` · ${r.negatives} giacenz${r.negatives === 1 ? 'a portata' : 'e portate'} a 0` : ''}`);
        after && after();
      };
    });
}

// modal rinomina scheda: apre col nome attuale, salva via renameScheda e riapre il dettaglio aggiornato
function renameSchedaModal(lid, s, back, onChange) {
  openSheet(`<h2>Rinomina scheda</h2>
    <div class="sheetsub">Nome descrittivo (facoltativo). Lascia vuoto per rimuoverlo.</div>
    <div class="field"><label>Nome</label><input id="sc_name" value="${esc(s.label || '')}" placeholder="Es. Inventario cantina" autofocus></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Salva</button></div>`,
    sheet => {
      const reopen = () => schedaDetail(lid, s.batchId, back, onChange);
      sheet.querySelector('[data-cancel]').onclick = reopen;
      sheet.querySelector('[data-ok]').onclick = () => {
        const val = sheet.querySelector('#sc_name').value.trim();
        renameScheda(lid, s.batchId, val);
        toast(val ? 'Scheda rinominata ✓' : 'Nome rimosso ✓');
        onChange && onChange();   // aggiorna la lista sottostante
        reopen();                 // riapre il dettaglio con il nome aggiornato
      };
    });
}

export function bind(root) {
  if (mode === 'schede') return bindSchede(root);
  if (mode === 'thresholds') return bindThresholds(root);
  if (mode === 'inventory') return bindInventory(root);
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };
  root.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => { scope = b.dataset.scope; rerender(); });
  root.querySelector('[data-receipts]')?.addEventListener('click', () => receiptsSheet(lid, rerender));
  root.querySelector('[data-transfers]')?.addEventListener('click', () => transfersSheet(lid, rerender));
  root.querySelector('[data-batch]')?.addEventListener('click', () => batchSheet(lid, rerender));
  root.querySelector('[data-inventory]')?.addEventListener('click', () => {
    const whs = warehousesOf(lid);
    if (!whs.length) { toast('Nessun magazzino'); return; }
    mode = 'inventory'; invCounts = {}; invStatus = 'all';
    invFilter.q = ''; invFilter.cat = 'all'; invFilter.sub = 'all'; invFilter.sup = 'all';
    invWh = (scope !== 'all' && whs.some(w => w.id === scope)) ? scope : whs[0].id;
    invLabel = invDefaultLabel(lid, invWh);
    rerender();
    gentleAutofocus(root.querySelector('#pf_q'));   // desktop: ricerca pronta per lo scan
  });
  root.querySelector('[data-thresholds]')?.addEventListener('click', () => {
    mode = 'thresholds'; thrVals = {}; thrStatus = 'all'; thrSort = 'nat';
    thrFilter.q = ''; thrFilter.cat = 'all'; thrFilter.sub = 'all'; thrFilter.sup = 'all';
    rerender();
  });
  root.querySelector('[data-schede]')?.addEventListener('click', () => { mode = 'schede'; schedeShown = SCHEDE_STEP; rerender(); });
  root.querySelector('[data-managewh]')?.addEventListener('click', () => manageWarehouses(lid, rerender));
  root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; rerender(); });
  const qi = root.querySelector('#mq');
  if (qi) {
    const commitSearch = () => { const pos = qi.selectionStart; rerender(); const n = root.querySelector('#mq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } };
    const deb = debounce(commitSearch, 130);
    qi.oninput = () => { q = qi.value; deb(); };
    // Invio = barcode: codice esatto (o risultato unico) → apre la scheda prodotto (giacenze/movimenti)
    qi.onkeydown = e => {
      if (e.key !== 'Enter') return; e.preventDefault(); q = qi.value; deb.cancel();
      const allProds = productsOf(lid);
      const term = q.trim().toLowerCase();
      const vis = term ? allProds.filter(p => productMatches(p, term)) : allProds;
      const target = scanTarget(q, allProds, vis);
      if (target) openProduct(target.id, rerender); else rerender();
    };
  }
  root.querySelectorAll('[data-prod]').forEach(el => el.onclick = () => openProduct(el.dataset.prod, rerender));
  root.querySelectorAll('[data-in]').forEach(b => b.onclick = e => { e.stopPropagation(); const p = product(b.dataset.in); withWarehouse(lid, 'Carico · scegli magazzino', wh => moveModal(lid, p, 'in', wh, rerender), p); });
  root.querySelectorAll('[data-out]').forEach(b => b.onclick = e => { e.stopPropagation(); withWarehouse(lid, 'Scarico · scegli magazzino', wh => moveModal(lid, product(b.dataset.out), 'out', wh, rerender)); });
  if (consumeViewEntry()) gentleAutofocus(root.querySelector('#mq'));
}
