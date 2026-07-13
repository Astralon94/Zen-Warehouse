// ============ Vista Magazzino/scorte (Zen-Warehouse) ============
// Multi-magazzino: lo stesso prodotto ha scorte separate per magazzino fisico dentro il locale.
import { esc } from '../../domain/util.js';
import { openSheet, closeSheet, toast, confirmDialog, showPdfDownloadSheet } from '../dom.js';
import {
  activeLocale, activeLocaleObj, productsOf, product, supplierName,
  warehousesOf, warehouse, warehouseName, stockOf, totalStock,
  topTypes, typeName, warehouseAllowsProduct, compatibleWarehouses,
} from '../../domain/warehouse.js';
import {
  stockIn, stockOut, setStock, transfer, movesForProduct,
  addWarehouse, renameWarehouse, deleteWarehouse, reorderWarehouses, setWarehouseTypes,
  pendingReceipts, receiveOrderSupplier, dismissReceiptSupplier,
  applyMovementBatch, schede, schedaById, renameScheda,
} from '../../domain/stock.js';
import { generateMovementSlip } from '../../domain/orderpdf.js';
import { can } from '../../state/auth.js';
import { makeSortable } from '../sortable.js';

// scritture scorte gatinate per azione (grana fine)
const cIn = () => can('magazzino.carico');
const cOut = () => can('magazzino.scarico');
const cAdj = () => can('magazzino.rettifica');
const cTransfer = () => can('magazzino.trasferimento');
const cBatch = () => can('magazzino.massivo');
const cReceive = () => can('magazzino.ricevi');
const cWhCrea = () => can('magazzini.crea');
const cWhMod = () => can('magazzini.modifica');
const cWhDel = () => can('magazzini.elimina');
const cWhManage = () => cWhCrea() || cWhMod() || cWhDel();   // apre la gestione magazzini
const cMove = () => cIn() || cOut();                          // pulsanti carico/scarico in riga
// rinomina scheda = scrittura sui movimenti: basta uno qualsiasi dei permessi di scrittura magazzino
const cRename = () => cIn() || cOut() || cAdj() || cTransfer() || cBatch();

let q = '';
let filter = 'all';    // all | low | out
let scope = 'all';     // 'all' (totale) | warehouseId

// ---- Visuale Schede (modalità dedicata della vista Magazzino) ----
// Stato dei filtri in memoria di vista (non persistito): si azzera solo con "Azzera".
const SCHEDE_STEP = 50;                         // schede mostrate per volta (rendering incrementale)
const SCHEDE_PERIODS = [['all', 'Tutto'], ['7', 'Ultimi 7 giorni'], ['30', 'Ultimo mese'], ['90', 'Ultimi 3 mesi']];
let mode = 'stock';                             // 'stock' (giacenze) | 'schede'
let sq = '';                                    // ricerca schede: prodotto nelle righe o nota
let sTipo = 'all';                              // all | carico | prelievo | transfer
let sWh = 'all';                                // all | warehouseId (coinvolto come origine O destinazione)
let sPeriod = 'all';                            // all | 7 | 30 | 90 (giorni)
let schedeShown = SCHEDE_STEP;                  // quante schede sono visibili ora
// timestamp minimo per il filtro periodo (0 = nessun limite)
const periodCutoff = v => v === 'all' ? 0 : Date.now() - (+v) * 86400000;

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
  const lid = activeLocale();
  const whs = warehousesOf(lid);
  if (scope !== 'all' && !whs.some(w => w.id === scope)) scope = 'all'; // scope non più valido → totale
  const all = productsOf(lid);

  let h = `<div class="pagehead"><h1>Magazzino</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;

  // selettore magazzino + gestione
  const whChip = (v, lbl) => `<button class="chip ${scope === v ? 'on' : ''}" data-scope="${v}">${esc(lbl)}</button>`;
  const nPend = pendingReceipts(lid).length;
  const pendBadge = nPend > 0 ? `<span class="badge" style="margin-left:6px;background:var(--accent)">${nPend}</span>` : '';
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
    <div class="chips" style="margin:0">${whChip('all', 'Tutti i magazzini')}${whs.map(w => whChip(w.id, w.name)).join('')}</div>
    <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap">
      ${cReceive() ? `<button class="btn sm primary" data-receipts>📥 Carico da ordini${pendBadge}</button>` : ''}
      ${cBatch() ? '<button class="btn sm" data-batch>⇅ Movimento massivo</button>' : ''}
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
  h += `<div class="field"><input id="mq" placeholder="Cerca prodotto…" value="${esc(q)}"></div>`;

  let list = base;
  const term = q.trim().toLowerCase();
  if (term) list = list.filter(p => p.name.toLowerCase().includes(term));
  if (filter === 'low') list = list.filter(p => status(p) === 'low');
  else if (filter === 'out') list = list.filter(p => status(p) === 'out');

  if (!list.length) return h + `<div class="card empty">Nessun prodotto con questo filtro.</div>`;

  h += `<div class="list two">${list.map(p => `<div class="row click" data-prod="${p.id}">
    <div class="mid"><div class="t1">${esc(p.name)}${p.format ? ` <span class="badge soft" style="font-size:10px">${esc(p.format)}</span>` : ''}</div>
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
    <h2>${isIn ? '➕ Carico' : '➖ Scarico'} · ${esc(p.name)}</h2>
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
    });
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
    <h2>↔ Trasferisci · ${esc(p.name)}</h2>
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
    <h2>${esc(p.name)}</h2>
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
  openSheet(`<h2>Rettifica giacenza · ${esc(p.name)}</h2>
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
          <div class="mid"><div class="t1">${esc(ln.name)}${ln.format ? ` <span class="badge soft" style="font-size:10px">${esc(ln.format)}</span>` : ''}</div>${ln.notes ? `<div class="t2">${esc(ln.notes)}</div>` : ''}</div>
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

  const render = () => {
    const isTransfer = type === 'transfer';
    const isCarico = type === 'carico';
    // Prodotti mostrati, filtrati dalle CATEGORIE del magazzino di destinazione (guida morbida):
    //  - carico: prodotti ammessi dalla destinazione (carWh) o che vi hanno già giacenza;
    //  - trasferimento: prodotti con giacenza in origine E ammessi dalla destinazione (o già presenti a dest.);
    //  - prelievo: solo prodotti con giacenza in origine (merce in uscita: nessun vincolo di categoria).
    let list;
    if (isCarico) list = productsOf(lid).filter(p => warehouseAllowsProduct(lid, carWh, p) || stockOf(p, carWh) > 0);
    else if (isTransfer) list = productsOf(lid).filter(p => stockOf(p, fromWh) > 0 && (warehouseAllowsProduct(lid, toWh, p) || stockOf(p, toWh) > 0));
    else list = productsOf(lid).filter(p => stockOf(p, fromWh) > 0);
    const term = bq.trim().toLowerCase();
    if (term) list = list.filter(p => p.name.toLowerCase().includes(term));

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
        <div class="mid"><div class="t1">${esc(p.name)}${p.format ? ` <span class="badge soft" style="font-size:10px">${esc(p.format)}</span>` : ''}</div>
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
    const redraw = restore => { collect(sheet); if (noteEl) noteVal = noteEl.value; if (labelEl) labelVal = labelEl.value; openSheet(render(), s => { wire(s); restore && restore(s); }, { wide: true }); };

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
    if (qi) qi.oninput = () => {
      bq = qi.value; const pos = qi.selectionStart;
      redraw(s => { const nq = s.querySelector('#b_q'); if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); } });
    };
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
    sheet.querySelectorAll('.bq').forEach(inp => inp.oninput = refreshSummary);
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

// ---- Storico schede di movimento (consultazione + ristampa) ----
function fmtSchedaDate(s) {
  return s.ts ? new Date(s.ts).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : (s.date || '');
}
// riga-scheda per la lista (riusata dalla visuale dedicata)
function schedaRow(lid, s) {
  const pezzi = s.lines.reduce((a, ln) => a + (ln.qty || 0), 0);
  const route = s.type === 'transfer'
    ? `${esc(warehouseName(lid, s.fromWh))} → ${esc(warehouseName(lid, s.toWh))}`
    : s.type === 'carico'
      ? `<span class="muted">esterno</span> → ${esc(warehouseName(lid, s.toWh))}`
      : `${esc(warehouseName(lid, s.fromWh))} → <span class="muted">fuori magazzino</span>`;
  const emoji = s.type === 'transfer' ? '↔️' : s.type === 'carico' ? '⬆️' : '⬇️';
  const typeLabel = s.type === 'transfer' ? 'Trasferimento' : s.type === 'carico' ? 'Carico' : 'Prelievo';
  const name = (s.label || '').trim() ? ` · <b>${esc(s.label.trim())}</b>` : '';
  return `<div class="row click" data-scheda="${esc(s.batchId)}">
    <div class="emoji">${emoji}</div>
    <div class="mid"><div class="t1">${typeLabel}${name} <span class="muted" style="font-weight:500;font-size:12px">· ${esc(fmtSchedaDate(s))}</span></div>
      <div class="t2">${route} · ${s.lines.length} rig${s.lines.length === 1 ? 'a' : 'he'} · ${pezzi} pz</div></div>
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
  if (term) list = list.filter(s => (s.label || '').toLowerCase().includes(term) || (s.note || '').toLowerCase().includes(term) || s.lines.some(ln => (ln.name || '').toLowerCase().includes(term)));

  let h = `<div class="pagehead"><h1>🧾 Schede di movimento</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;
  h += `<div class="btnrow" style="margin-bottom:10px"><button class="btn sm" data-back>← Giacenze</button></div>`;

  // filtri: tipo (chips) · magazzino/periodo (select) · ricerca
  const tipoChip = (v, lbl) => `<button class="chip ${sTipo === v ? 'on' : ''}" data-stipo="${v}">${lbl}</button>`;
  h += `<div class="chips" style="margin-bottom:8px">${tipoChip('all', 'Tutte')}${tipoChip('carico', '⬆️ Carichi')}${tipoChip('prelievo', '⬇️ Prelievi')}${tipoChip('transfer', '↔️ Trasferimenti')}</div>`;
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
  h += `<div class="list">${visible.map(s => schedaRow(lid, s)).join('')}</div>`;
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
  // il dettaglio è uno sheet sopra la visuale: chiudendolo si torna qui (nessun back esplicito)
  root.querySelectorAll('[data-scheda]').forEach(el => el.onclick = () => schedaDetail(lid, el.dataset.scheda, null, rerender));
}
function schedaDetail(lid, batchId, back, onChange) {
  const s = schedaById(lid, batchId);
  if (!s) { toast('Scheda non trovata'); back && back(); return; }
  const isTransfer = s.type === 'transfer';
  const isCarico = s.type === 'carico';
  const from = isCarico ? '<span class="muted">esterno / fornitore</span>' : esc(warehouseName(lid, s.fromWh));
  const dest = isCarico ? esc(warehouseName(lid, s.toWh)) : isTransfer ? esc(warehouseName(lid, s.toWh)) : '<span class="muted">fuori magazzino</span>';
  const type = isCarico ? '⬆️ Carico' : isTransfer ? '↔️ Trasferimento' : '⬇️ Prelievo';
  const name = (s.label || '').trim();
  const head = name ? `${type} · ${esc(name)}` : type;
  const pezzi = s.lines.reduce((a, ln) => a + (ln.qty || 0), 0);
  const rows = s.lines.map(ln => `<div class="row">
    <div class="mid"><div class="t1">${esc(ln.name)}</div></div>
    <div class="amt tnum" style="font-weight:800">${ln.qty}</div>
  </div>`).join('');
  openSheet(`
    <h2>${head}</h2>
    <div class="sheetsub">${esc(fmtSchedaDate(s))} · ${from} → ${dest}</div>
    <div class="section-title">Prodotti <span class="muted" style="font-weight:500">· ${s.lines.length} rig${s.lines.length === 1 ? 'a' : 'he'} · ${pezzi} pz</span></div>
    <div class="list">${rows}</div>
    ${s.note ? `<div class="section-title">Nota</div><div class="card" style="padding:12px">${esc(s.note)}</div>` : ''}
    <div class="actions"><button class="btn" data-back>Indietro</button>
      ${cRename() ? '<button class="btn" data-rename>✏️ Rinomina</button>' : ''}
      <button class="btn primary" data-print>⤓ Ristampa scheda</button></div>`,
    sheet => {
      sheet.querySelector('[data-back]').onclick = () => { closeSheet(); back && back(); };
      sheet.querySelector('[data-rename]')?.addEventListener('click', () => renameSchedaModal(lid, s, back, onChange));
      sheet.querySelector('[data-print]').onclick = () => {
        const l = activeLocaleObj();
        const pdf = generateMovementSlip(l, s, warehousesOf(lid));
        showPdfDownloadSheet([pdf]);
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
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };
  root.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => { scope = b.dataset.scope; rerender(); });
  root.querySelector('[data-receipts]')?.addEventListener('click', () => receiptsSheet(lid, rerender));
  root.querySelector('[data-batch]')?.addEventListener('click', () => batchSheet(lid, rerender));
  root.querySelector('[data-schede]')?.addEventListener('click', () => { mode = 'schede'; schedeShown = SCHEDE_STEP; rerender(); });
  root.querySelector('[data-managewh]')?.addEventListener('click', () => manageWarehouses(lid, rerender));
  root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; rerender(); });
  const qi = root.querySelector('#mq');
  if (qi) qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; rerender(); const n = root.querySelector('#mq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  root.querySelectorAll('[data-prod]').forEach(el => el.onclick = () => openProduct(el.dataset.prod, rerender));
  root.querySelectorAll('[data-in]').forEach(b => b.onclick = e => { e.stopPropagation(); const p = product(b.dataset.in); withWarehouse(lid, 'Carico · scegli magazzino', wh => moveModal(lid, p, 'in', wh, rerender), p); });
  root.querySelectorAll('[data-out]').forEach(b => b.onclick = e => { e.stopPropagation(); withWarehouse(lid, 'Scarico · scegli magazzino', wh => moveModal(lid, product(b.dataset.out), 'out', wh, rerender)); });
}
