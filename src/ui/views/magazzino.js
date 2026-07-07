// ============ Vista Magazzino/scorte (Zen-Warehouse) ============
// Multi-magazzino: lo stesso prodotto ha scorte separate per magazzino fisico dentro il locale.
import { esc } from '../../domain/util.js';
import { openSheet, closeSheet, toast, confirmDialog } from '../dom.js';
import {
  activeLocale, activeLocaleObj, productsOf, product, supplierName,
  warehousesOf, warehouse, warehouseName, stockOf, totalStock,
} from '../../domain/warehouse.js';
import {
  stockIn, stockOut, setStock, transfer, movesForProduct,
  addWarehouse, renameWarehouse, deleteWarehouse, reorderWarehouses,
} from '../../domain/stock.js';
import { makeSortable } from '../sortable.js';

let q = '';
let filter = 'all';    // all | low | out
let scope = 'all';     // 'all' (totale) | warehouseId

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
  const lid = activeLocale();
  const whs = warehousesOf(lid);
  if (scope !== 'all' && !whs.some(w => w.id === scope)) scope = 'all'; // scope non più valido → totale
  const all = productsOf(lid);

  let h = `<div class="pagehead"><h1>Magazzino</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;

  // selettore magazzino + gestione
  const whChip = (v, lbl) => `<button class="chip ${scope === v ? 'on' : ''}" data-scope="${v}">${esc(lbl)}</button>`;
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
    <div class="chips" style="margin:0">${whChip('all', 'Tutti i magazzini')}${whs.map(w => whChip(w.id, w.name)).join('')}</div>
    <button class="btn sm" data-managewh>⚙︎ Gestisci magazzini</button>
  </div>`;

  if (!all.length) return h + `<div class="card empty">Nessun prodotto.<br><span class="muted">Aggiungi prodotti dal Database per gestirne le scorte.</span></div>`;

  const nLow = all.filter(p => status(p) === 'low').length;
  const nOut = all.filter(p => status(p) === 'out').length;
  const chip = (v, lbl, n) => `<button class="chip ${filter === v ? 'on' : ''}" data-filter="${v}">${lbl}${n != null ? ' · ' + n : ''}</button>`;
  h += `<div class="chips" style="margin-bottom:10px">${chip('all', 'Tutti', all.length)}${chip('low', 'Sotto scorta', nLow)}${chip('out', 'Esauriti', nOut)}</div>`;
  h += `<div class="field"><input id="mq" placeholder="Cerca prodotto…" value="${esc(q)}"></div>`;

  let list = all;
  const term = q.trim().toLowerCase();
  if (term) list = list.filter(p => p.name.toLowerCase().includes(term));
  if (filter === 'low') list = list.filter(p => status(p) === 'low');
  else if (filter === 'out') list = list.filter(p => status(p) === 'out');

  if (!list.length) return h + `<div class="card empty">Nessun prodotto con questo filtro.</div>`;

  h += `<div class="list">${list.map(p => `<div class="row click" data-prod="${p.id}">
    <div class="mid"><div class="t1">${esc(p.name)}${p.format ? ` <span class="badge soft" style="font-size:10px">${esc(p.format)}</span>` : ''}</div>
      <div class="t2">${esc(supplierName(p.supplierId))}${scope !== 'all' && whs.length > 1 ? ` · <span class="muted">tot ${totalStock(p)}</span>` : ''}</div></div>
    ${badge(p)}
    <div style="display:flex;gap:3px;flex-shrink:0;margin-left:8px">
      <button class="btn sm danger" data-out="${p.id}">− Scarico</button>
      <button class="btn sm primary" data-in="${p.id}">+ Carico</button>
    </div>
  </div>`).join('')}</div>`;
  return h;
}

// se lo scope è "Tutti", chiedi in quale magazzino operare, poi esegui fn(whId)
function withWarehouse(lid, title, fn) {
  const whs = warehousesOf(lid);
  if (scope !== 'all') return fn(scope);
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
  const fromOpts = whs.map(w => `<option value="${w.id}" ${w.id === from0 ? 'selected' : ''}>${esc(w.name)} (${stockOf(p, w.id)})</option>`).join('');
  const toOpts = whs.map(w => `<option value="${w.id}" ${w.id !== from0 && w.id === whs.find(x => x.id !== from0)?.id ? 'selected' : ''}>${esc(w.name)} (${stockOf(p, w.id)})</option>`).join('');
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
    <div class="btnrow" style="margin:6px 0 14px">
      <button class="btn primary" data-in>➕ Carico</button>
      <button class="btn danger" data-out>➖ Scarico</button>
      ${whs.length > 1 ? '<button class="btn" data-transfer>↔ Trasferisci</button>' : ''}
      <button class="btn" data-adj>✎ Rettifica</button>
    </div>
    <div class="section-title">Giacenza per magazzino</div>
    ${breakdown}
    <div class="section-title">Movimenti</div>
    ${movesHtml}`,
    sheet => {
      const reopen = () => openProduct(id, after);
      sheet.querySelector('[data-in]').onclick = () => withWarehouse(lid, 'Carico · scegli magazzino', wh => moveModal(lid, p, 'in', wh, reopen));
      sheet.querySelector('[data-out]').onclick = () => withWarehouse(lid, 'Scarico · scegli magazzino', wh => moveModal(lid, p, 'out', wh, reopen));
      sheet.querySelector('[data-transfer]')?.addEventListener('click', () => transferModal(lid, p, reopen));
      sheet.querySelector('[data-adj]').onclick = () => withWarehouse(lid, 'Rettifica · scegli magazzino', wh => adjustModal(lid, p, wh, reopen));
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

// sheet gestione magazzini (aggiungi/rinomina/elimina/riordina)
function manageWarehouses(lid, after) {
  const whs = warehousesOf(lid);
  const HANDLE = '<span class="drag-handle" title="Trascina per riordinare" draggable="false">⋮⋮</span>';
  openSheet(`
    <h2>Gestisci magazzini</h2>
    <div class="btnrow" style="margin-bottom:12px"><button class="btn primary" data-addwh>+ Magazzino</button></div>
    <div class="list sortwh">${whs.map(w => `<div class="row" data-sortid="${w.id}">
      ${HANDLE}
      <div class="mid"><div class="t1">🏬 ${esc(w.name)}</div></div>
      <div style="display:flex;gap:3px;flex-shrink:0" draggable="false">
        <button class="btn sm" data-whedit="${w.id}">✏️</button>
        <button class="btn sm danger" data-whdel="${w.id}" ${whs.length <= 1 ? 'disabled' : ''}>🗑</button>
      </div></div>`).join('')}</div>
    <div class="actions"><button class="btn primary" data-close>Fatto</button></div>`,
    sheet => {
      const reopen = () => manageWarehouses(lid, after);
      sheet.querySelector('[data-close]').onclick = () => { closeSheet(); after && after(); };
      sheet.querySelector('[data-addwh]').onclick = () => nameModal(lid, null, reopen);
      sheet.querySelectorAll('[data-whedit]').forEach(b => b.onclick = () => nameModal(lid, b.dataset.whedit, reopen));
      sheet.querySelector('.sortwh') && makeSortable(sheet.querySelector('.sortwh'), ids => reorderWarehouses(lid, ids));
      sheet.querySelectorAll('[data-whdel]').forEach(b => b.onclick = () => {
        const w = warehouse(lid, b.dataset.whdel);
        confirmDialog('Eliminare il magazzino?', `${w?.name || ''} — la giacenza viene spostata nel primo magazzino rimasto.`, 'Elimina', () => {
          if (deleteWarehouse(lid, b.dataset.whdel)) { toast('Magazzino eliminato'); if (scope === b.dataset.whdel) scope = 'all'; }
          reopen();
        }, { danger: true });
      });
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

export function bind(root) {
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };
  root.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => { scope = b.dataset.scope; rerender(); });
  root.querySelector('[data-managewh]')?.addEventListener('click', () => manageWarehouses(lid, rerender));
  root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; rerender(); });
  const qi = root.querySelector('#mq');
  if (qi) qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; rerender(); const n = root.querySelector('#mq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  root.querySelectorAll('[data-prod]').forEach(el => el.onclick = () => openProduct(el.dataset.prod, rerender));
  root.querySelectorAll('[data-in]').forEach(b => b.onclick = e => { e.stopPropagation(); withWarehouse(lid, 'Carico · scegli magazzino', wh => moveModal(lid, product(b.dataset.in), 'in', wh, rerender)); });
  root.querySelectorAll('[data-out]').forEach(b => b.onclick = e => { e.stopPropagation(); withWarehouse(lid, 'Scarico · scegli magazzino', wh => moveModal(lid, product(b.dataset.out), 'out', wh, rerender)); });
}
