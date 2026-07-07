// ============ Vista Magazzino/scorte (Zen-Warehouse) ============
// Multi-magazzino: lo stesso prodotto ha scorte separate per magazzino fisico dentro il locale.
import { esc } from '../../domain/util.js';
import { openSheet, closeSheet, toast, confirmDialog, showPdfDownloadSheet } from '../dom.js';
import {
  activeLocale, activeLocaleObj, productsOf, product, supplierName,
  warehousesOf, warehouse, warehouseName, stockOf, totalStock,
} from '../../domain/warehouse.js';
import {
  stockIn, stockOut, setStock, transfer, movesForProduct,
  addWarehouse, renameWarehouse, deleteWarehouse, reorderWarehouses,
  pendingReceipts, receiveOrderSupplier, dismissReceiptSupplier,
  applyMovementBatch, schede, schedaById,
} from '../../domain/stock.js';
import { generateMovementSlip } from '../../domain/orderpdf.js';
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
  const nPend = pendingReceipts(lid).length;
  const pendBadge = nPend > 0 ? `<span class="badge" style="margin-left:6px;background:var(--accent)">${nPend}</span>` : '';
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
    <div class="chips" style="margin:0">${whChip('all', 'Tutti i magazzini')}${whs.map(w => whChip(w.id, w.name)).join('')}</div>
    <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap">
      <button class="btn sm primary" data-receipts>📥 Carico da ordini${pendBadge}</button>
      <button class="btn sm" data-batch>⇅ Movimento massivo</button>
      <button class="btn sm" data-schede>🧾 Schede</button>
      <button class="btn sm" data-managewh>⚙︎ Gestisci magazzini</button>
    </div>
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

  h += `<div class="list two">${list.map(p => `<div class="row click" data-prod="${p.id}">
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
    // prodotti mostrati: per il carico tutti (la giacenza può essere 0), altrimenti solo con giacenza in origine
    let list = isCarico ? productsOf(lid) : productsOf(lid).filter(p => stockOf(p, fromWh) > 0);
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
    }).join('') : `<div class="card empty" style="padding:14px">${isCarico ? 'Nessun prodotto nel Database.' : 'Nessun prodotto con giacenza in questo magazzino.'}</div>`;

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

  const wire = sheet => {
    const noteEl = sheet.querySelector('#b_note');
    if (noteEl) noteEl.value = noteVal;
    // ridisegna la modale in-place preservando nota e quantità già inserite
    const redraw = restore => { collect(sheet); if (noteEl) noteVal = noteEl.value; openSheet(render(), s => { wire(s); restore && restore(s); }, { wide: true }); };

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
      if (type === 'carico') { carWh = e.target.value; redraw(); }  // aggiorna la giacenza mostrata
      else toWh = e.target.value;
    });
    const qi = sheet.querySelector('#b_q');
    if (qi) qi.oninput = () => {
      bq = qi.value; const pos = qi.selectionStart;
      redraw(s => { const nq = s.querySelector('#b_q'); if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); } });
    };
    if (noteEl) noteEl.oninput = () => { noteVal = noteEl.value; };
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
      const note = noteVal.trim();
      const lines = Object.entries(qty).filter(([, v]) => v > 0).map(([productId, v]) => ({ productId, qty: v }));
      if (!lines.length) { toast('Inserisci almeno una quantità'); return; }
      if (type === 'transfer' && (!toWh || toWh === fromWh)) { toast('Scegli un magazzino di destinazione diverso'); return; }
      // payload secondo l'operazione (carico entra in carWh; prelievo esce da fromWh; trasferimento fromWh→toWh)
      const payload = type === 'carico' ? { type, fromWh: null, toWh: carWh, note, lines }
        : type === 'transfer' ? { type, fromWh, toWh, note, lines }
        : { type, fromWh, toWh: null, note, lines };
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
function schedeSheet(lid, after) {
  const list = schede(lid);
  const body = !list.length
    ? `<div class="card empty" style="padding:18px">Nessuna scheda.<br><span class="muted">Trasferimenti e prelievi multi-prodotto compaiono qui.</span></div>`
    : `<div class="list">${list.map(s => {
        const pezzi = s.lines.reduce((a, ln) => a + (ln.qty || 0), 0);
        const route = s.type === 'transfer'
          ? `${esc(warehouseName(lid, s.fromWh))} → ${esc(warehouseName(lid, s.toWh))}`
          : s.type === 'carico'
            ? `<span class="muted">esterno</span> → ${esc(warehouseName(lid, s.toWh))}`
            : `${esc(warehouseName(lid, s.fromWh))} → <span class="muted">fuori magazzino</span>`;
        const emoji = s.type === 'transfer' ? '↔️' : s.type === 'carico' ? '⬆️' : '⬇️';
        const label = s.type === 'transfer' ? 'Trasferimento' : s.type === 'carico' ? 'Carico' : 'Prelievo';
        return `<div class="row click" data-scheda="${esc(s.batchId)}">
          <div class="emoji">${emoji}</div>
          <div class="mid"><div class="t1">${label} <span class="muted" style="font-weight:500;font-size:12px">· ${esc(fmtSchedaDate(s))}</span></div>
            <div class="t2">${route} · ${s.lines.length} rig${s.lines.length === 1 ? 'a' : 'he'} · ${pezzi} pz</div></div>
        </div>`;
      }).join('')}</div>`;
  openSheet(`
    <h2>🧾 Schede di movimento</h2>
    <div class="sheetsub">Trasferimenti e prelievi registrati, consultabili e ristampabili.</div>
    ${body}
    <div class="actions"><button class="btn primary" data-close>Chiudi</button></div>`,
    sheet => {
      sheet.querySelector('[data-close]').onclick = () => { closeSheet(); after && after(); };
      sheet.querySelectorAll('[data-scheda]').forEach(el => el.onclick = () => schedaDetail(lid, el.dataset.scheda, () => schedeSheet(lid, after)));
    });
}
function schedaDetail(lid, batchId, back) {
  const s = schedaById(lid, batchId);
  if (!s) { toast('Scheda non trovata'); back && back(); return; }
  const isTransfer = s.type === 'transfer';
  const isCarico = s.type === 'carico';
  const from = isCarico ? '<span class="muted">esterno / fornitore</span>' : esc(warehouseName(lid, s.fromWh));
  const dest = isCarico ? esc(warehouseName(lid, s.toWh)) : isTransfer ? esc(warehouseName(lid, s.toWh)) : '<span class="muted">fuori magazzino</span>';
  const head = isCarico ? '⬆️ Carico' : isTransfer ? '↔️ Trasferimento' : '⬇️ Prelievo';
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
    <div class="actions"><button class="btn" data-back>Indietro</button><button class="btn primary" data-print>⤓ Ristampa scheda</button></div>`,
    sheet => {
      sheet.querySelector('[data-back]').onclick = () => { closeSheet(); back && back(); };
      sheet.querySelector('[data-print]').onclick = () => {
        const l = activeLocaleObj();
        const pdf = generateMovementSlip(l, s, warehousesOf(lid));
        showPdfDownloadSheet([pdf]);
      };
    });
}

export function bind(root) {
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };
  root.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => { scope = b.dataset.scope; rerender(); });
  root.querySelector('[data-receipts]')?.addEventListener('click', () => receiptsSheet(lid, rerender));
  root.querySelector('[data-batch]')?.addEventListener('click', () => batchSheet(lid, rerender));
  root.querySelector('[data-schede]')?.addEventListener('click', () => schedeSheet(lid, rerender));
  root.querySelector('[data-managewh]')?.addEventListener('click', () => manageWarehouses(lid, rerender));
  root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; rerender(); });
  const qi = root.querySelector('#mq');
  if (qi) qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; rerender(); const n = root.querySelector('#mq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  root.querySelectorAll('[data-prod]').forEach(el => el.onclick = () => openProduct(el.dataset.prod, rerender));
  root.querySelectorAll('[data-in]').forEach(b => b.onclick = e => { e.stopPropagation(); withWarehouse(lid, 'Carico · scegli magazzino', wh => moveModal(lid, product(b.dataset.in), 'in', wh, rerender)); });
  root.querySelectorAll('[data-out]').forEach(b => b.onclick = e => { e.stopPropagation(); withWarehouse(lid, 'Scarico · scegli magazzino', wh => moveModal(lid, product(b.dataset.out), 'out', wh, rerender)); });
}
