// ============ Vista Movimenti (Zen-Warehouse) ============
// Punto unico di consultazione di TUTTE le movimentazioni del locale, in ordine cronologico:
//  - ordini fornitori (storico) → tipo 'ordine'
//  - schede di movimento magazzino (carico/prelievo/trasferimento/rettifica, DDT convalidati inclusi)
// Ogni voce dichiara il tipo a colpo d'occhio (emoji + badge) e si può filtrare per tipo/periodo/ricerca.
// I dettagli sono riusati così come sono: openOrder (Rigenera PDF/Ri-ordina/Ricevi/Elimina) e la scheda
// (schedaDetail/confirmDeleteScheda importati dalla vista Magazzino).
import { esc, lineMatches } from '../../domain/util.js';
import { openSheet, closeSheet, toast, confirmDialog, showPdfDownloadSheet, codeTag } from '../dom.js';
import { activeLocale, activeLocaleObj, ordersOf, deliveryPointsOf, loc, warehousesOf, warehouseName, product } from '../../domain/warehouse.js';
import { generateOrderPdfs, orderSummary } from '../../domain/orderpdf.js';
import { deleteOrder, reorderFrom } from '../../domain/orders.js';
import { receiveOrder, schede, schedaById, singleMoves } from '../../domain/stock.js';
import { can } from '../../state/auth.js';
import { go } from '../app.js';
import { schedaDetail, confirmDeleteScheda } from './magazzino.js';

// eliminare/rinominare una scheda = poter scrivere sui movimenti (le stesse guardie della vista Magazzino)
const cDelScheda = () => can('magazzino.massivo') || can('magazzino.rettifica');

let q = '';                                    // ricerca (fornitore/prodotto/nome scheda/nota)
let tipo = 'all';                              // all | ordine | carico | prelievo | transfer | rettifica
let period = 'all';                            // all | 7 | 30 | 90 (giorni)
const PAGE = 40;                               // voci mostrate per volta (rendering incrementale)
let shown = PAGE;                              // quante voci sono visibili ora
const PERIODS = [['all', 'Tutto'], ['7', 'Ultimi 7 giorni'], ['30', 'Ultimo mese'], ['90', 'Ultimi 3 mesi']];
const periodCutoff = v => v === 'all' ? 0 : Date.now() - (+v) * 86400000;

// metadati di tipo: emoji (icona grande) + etichetta del badge riconoscibile a colpo d'occhio
const TYPE_META = {
  ordine:    { emoji: '📦', label: 'Ordine' },
  carico:    { emoji: '📥', label: 'Carico' },
  prelievo:  { emoji: '📤', label: 'Prelievo' },
  transfer:  { emoji: '🔄', label: 'Trasferimento' },
  rettifica: { emoji: '🧮', label: 'Rettifica' },
};
const typeBadge = t => { const m = TYPE_META[t] || TYPE_META.ordine; return `<span class="badge soft" style="font-size:10px">${m.emoji} ${m.label}</span>`; };

function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
const fmtDate = ts => new Date(ts).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
const dpName = (lid, id) => (deliveryPointsOf(lid).find(d => d.id === id)?.name || null);

// tipo di un movimento SINGOLO: le rettifiche via setStock portano il marcatore `batchType:'rettifica'`
// (senza batchId → schede() le ignora) e diventano 🧮 Rettifica; le altre si leggono dal kind. Le rettifiche
// singole FATTE PRIMA dell'introduzione del marcatore restano carico/prelievo (limite accettabile).
const moveType = m => m.batchType === 'rettifica' ? 'rettifica' : m.kind === 'transfer' ? 'transfer' : m.kind === 'in' ? 'carico' : 'prelievo';
const moveName = m => m.name || product(m.productId)?.name || '—';
const moveCode = m => product(m.productId)?.code || '';

// ---- Costruzione della lista unificata (ordini + schede + movimenti singoli) ----
// Ogni voce: { kind:'order'|'scheda'|'move', type, ts, o|s|m }. Il tipo pilota badge, filtro e dettaglio.
// I movimenti singoli (senza batchId) sono i carichi/scarichi/rettifiche/trasferimenti dei bottoni rapidi:
// così la lista è DAVVERO tutte le movimentazioni, non solo ordini e schede multi-prodotto.
function entriesOf(lid) {
  const out = [];
  ordersOf(lid).forEach(o => out.push({ kind: 'order', type: 'ordine', ts: o.sentAt || o.createdAt || 0, o }));
  schede(lid).forEach(s => out.push({ kind: 'scheda', type: s.type, ts: s.ts || 0, s }));
  singleMoves(lid).forEach(m => out.push({ kind: 'move', type: moveType(m), ts: m.ts || 0, m }));
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

function entryMatches(e, term) {
  if (!term) return true;
  if (e.kind === 'order') return (e.o.lines || []).some(ln => lineMatches(ln, term, pid => product(pid)?.code) || (ln.supplierName || '').toLowerCase().includes(term));
  if (e.kind === 'move') { const m = e.m; return moveName(m).toLowerCase().includes(term) || moveCode(m).toLowerCase().includes(term) || (m.note || '').toLowerCase().includes(term); }
  const s = e.s;
  return (s.label || '').toLowerCase().includes(term) || (s.note || '').toLowerCase().includes(term)
    || s.lines.some(ln => (ln.name || '').toLowerCase().includes(term) || (ln.code || '').toLowerCase().includes(term));
}

// riga della lista, per ordine o per scheda (badge di tipo sempre in testa)
function entryRow(lid, e, canDel) {
  const m = TYPE_META[e.type] || TYPE_META.ordine;
  if (e.kind === 'order') {
    const o = e.o, s = orderSummary(o), dp = dpName(lid, o.deliveryPointId);
    return `<div class="row click" data-ord="${o.id}">
      <div class="emoji">${m.emoji}</div>
      <div class="mid"><div class="t1">${typeBadge('ordine')} <span class="muted" style="font-weight:500;font-size:12px">${fmtDateTime(o.sentAt || o.createdAt)}</span></div>
        <div class="t2">${s.righe} rig${s.righe === 1 ? 'a' : 'he'} · ${s.pezzi} pz · ${s.fornitori} fornitor${s.fornitori === 1 ? 'e' : 'i'}${dp ? ' · 📍 ' + esc(dp) : ''}</div></div>
    </div>`;
  }
  if (e.kind === 'move') {
    const m = e.m, mt = moveType(m);
    const route = mt === 'rettifica' ? esc(warehouseName(lid, m.warehouseId))
      : m.kind === 'transfer' ? `${esc(warehouseName(lid, m.fromWarehouseId))} → ${esc(warehouseName(lid, m.warehouseId))}`
      : m.kind === 'in' ? `<span class="muted">esterno</span> → ${esc(warehouseName(lid, m.warehouseId))}`
      : `${esc(warehouseName(lid, m.warehouseId))} → <span class="muted">fuori magazzino</span>`;
    // rettifica: mostra il prima→dopo se disponibile (la nota default "Rettifica" è ridondante col badge)
    const note = (m.note || '').trim(); const showNote = note && note !== 'Rettifica';
    const measure = mt === 'rettifica' && m.before != null && m.after != null ? `${m.before} → ${m.after}` : `${m.qty} pz`;
    return `<div class="row click" data-move="${esc(m.id)}">
      <div class="emoji">${(TYPE_META[mt] || TYPE_META.carico).emoji}</div>
      <div class="mid"><div class="t1">${typeBadge(mt)} ${esc(moveName(m))}${codeTag(moveCode(m))} <span class="muted" style="font-weight:500;font-size:12px">· ${esc(fmtDate(m.ts) || m.date)}</span></div>
        <div class="t2">${route} · ${measure}${showNote ? ' · ' + esc(note) : ''}</div></div>
    </div>`;
  }
  const s = e.s;
  const pezzi = s.lines.reduce((a, ln) => a + (ln.qty || 0), 0);
  const route = s.type === 'transfer' ? `${esc(warehouseName(lid, s.fromWh))} → ${esc(warehouseName(lid, s.toWh))}`
    : s.type === 'carico' ? `<span class="muted">esterno</span> → ${esc(warehouseName(lid, s.toWh))}`
    : s.type === 'rettifica' ? esc(warehouseName(lid, s.toWh))
    : `${esc(warehouseName(lid, s.fromWh))} → <span class="muted">fuori magazzino</span>`;
  const name = (s.label || '').trim() ? ` <b>${esc(s.label.trim())}</b>` : '';
  return `<div class="row click" data-scheda="${esc(s.batchId)}">
    <div class="emoji">${m.emoji}</div>
    <div class="mid"><div class="t1">${typeBadge(s.type)}${name} <span class="muted" style="font-weight:500;font-size:12px">· ${esc(fmtDate(s.ts) || s.date)}</span></div>
      <div class="t2">${route} · ${s.lines.length} rig${s.lines.length === 1 ? 'a' : 'he'} · ${pezzi} pz</div></div>
    ${canDel ? `<button class="btn-icon" data-schedadel="${esc(s.batchId)}" title="Elimina scheda" aria-label="Elimina scheda" style="color:var(--red);flex-shrink:0">🗑</button>` : ''}
  </div>`;
}

export function render() {
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Movimenti</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;
  const lid = activeLocale();

  let h = `<div class="pagehead"><h1>Movimenti</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;

  const all = entriesOf(lid);
  if (!all.length) {
    return h + `<div class="card empty">Nessun movimento ancora registrato.<br><span class="muted">Ordini inviati, carichi, prelievi, trasferimenti e rettifiche compaiono qui.</span></div>`;
  }

  // filtri: tipo (chips) · periodo (select) · ricerca — combinati in AND
  const tipoChip = (v, lbl) => `<button class="chip ${tipo === v ? 'on' : ''}" data-tipo="${v}">${lbl}</button>`;
  h += `<div class="chips" style="margin-bottom:8px">${tipoChip('all', 'Tutti')}${tipoChip('ordine', '📦 Ordini')}${tipoChip('carico', '📥 Carichi')}${tipoChip('prelievo', '📤 Prelievi')}${tipoChip('transfer', '🔄 Trasferimenti')}${tipoChip('rettifica', '🧮 Rettifiche')}</div>`;
  const perOpts = PERIODS.map(([v, lbl]) => `<option value="${v}" ${period === v ? 'selected' : ''}>${esc(lbl)}</option>`).join('');
  h += `<div class="frow" style="margin-bottom:8px">
    <div class="field" style="margin:0;flex:1 1 60%"><input id="mvq" placeholder="Cerca prodotto, fornitore, nome o nota…" value="${esc(q)}"></div>
    <div class="field" style="margin:0"><select id="mvperiod">${perOpts}</select></div>
  </div>`;

  let list = all;
  if (tipo !== 'all') list = list.filter(e => e.type === tipo);
  const cut = periodCutoff(period);
  if (cut) list = list.filter(e => (e.ts || 0) >= cut);
  const term = q.trim().toLowerCase();
  if (term) list = list.filter(e => entryMatches(e, term));

  const anyFilter = !!term || tipo !== 'all' || period !== 'all';
  h += `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
    <span class="muted" style="font-size:12.5px">${all.length} movimen${all.length === 1 ? 'to' : 'ti'} · ${list.length} nel filtro</span>
    ${anyFilter ? '<button class="btn sm" data-reset>Azzera</button>' : ''}
  </div>`;

  if (!list.length) return h + `<div class="card empty">Nessun movimento con questi filtri.</div>`;

  const visible = list.slice(0, shown);
  const canDel = cDelScheda();
  h += `<div class="list">${visible.map(e => entryRow(lid, e, canDel)).join('')}</div>`;
  if (list.length > visible.length) {
    h += `<div class="btnrow" style="justify-content:center;margin-top:10px"><button class="btn" data-more>Mostra altri (restano ${list.length - visible.length})</button></div>`;
  }
  return h;
}

// raggruppa le righe di un ordine per fornitore (mantenendo l'ordine)
function groupBySupplier(order) {
  const groups = [], idx = {};
  (order.lines || []).forEach(ln => {
    const k = ln.supplierId || '__none__';
    if (idx[k] == null) { idx[k] = groups.length; groups.push({ name: ln.supplierName || 'Senza fornitore', items: [] }); }
    groups[idx[k]].items.push(ln);
  });
  return groups;
}

// Dettaglio ordine: identico allo Storico (Rigenera PDF · Ri-ordina · Ricevi carico · Elimina).
function openOrder(id, after) {
  const lid = activeLocale();
  const o = ordersOf(lid).find(x => x.id === id);
  if (!o) return;
  const s = orderSummary(o);
  const dp = dpName(lid, o.deliveryPointId);
  const groups = groupBySupplier(o);
  const groupsHtml = groups.map(g => {
    const rows = g.items.map(it => `<div class="row"><div class="mid"><div class="t1">${esc(it.name)} ${it.format ? `<span class="badge soft" style="font-size:10px">${esc(it.format)}</span>` : ''}${codeTag(it.code || product(it.productId)?.code)}</div>${it.notes ? `<div class="t2">${esc(it.notes)}</div>` : ''}</div><div class="amt tnum" style="font-weight:800">${it.qty}</div></div>`).join('');
    const pezzi = g.items.reduce((a, it) => a + it.qty, 0);
    return `<div class="section-title">🚚 ${esc(g.name)} <span class="muted" style="font-weight:500;font-size:12px">· ${g.items.length} rig${g.items.length === 1 ? 'a' : 'he'} · ${pezzi} pz</span></div><div class="list">${rows}</div>`;
  }).join('');

  openSheet(`
    <h2>Ordine del ${fmtDateTime(o.sentAt || o.createdAt).replace(' · ', ' alle ')}</h2>
    <div class="sheetsub">${s.righe} righe · ${s.pezzi} pezzi · ${s.fornitori} fornitor${s.fornitori === 1 ? 'e' : 'i'}${dp ? ' · 📍 ' + esc(dp) : ''}${o.stockLoad === false ? ' · <span class="muted">senza carico magazzino</span>' : o.status === 'received' ? ' · <b style="color:var(--green,#6b8f80)">✓ ricevuto</b>' : o.status === 'closed' ? ' · <b class="muted">evaso</b>' : ''}</div>
    ${groupsHtml}
    <div class="btnrow" style="margin-top:14px">
      <button class="btn primary" data-reprint>⤓ Rigenera PDF</button>
      ${can('ordini.riordina') ? '<button class="btn" data-reorder>↻ Ri-ordina</button>' : ''}
      ${(o.status === 'received' || o.status === 'closed' || o.stockLoad === false || !can('magazzino.ricevi')) ? '' : '<button class="btn" data-receive>📥 Ricevi (carico)</button>'}
      ${can('ordini.elimina') ? '<button class="btn danger" data-del>Elimina</button>' : ''}
    </div>`,
    sheet => {
      sheet.querySelector('[data-receive]')?.addEventListener('click', () => {
        const whs = warehousesOf(lid);
        const doReceive = whId => { const n = receiveOrder(o, whId); closeSheet(); toast(n ? `${n} prodotti caricati in magazzino ✓` : 'Nessun carico'); after && after(); };
        if (whs.length === 1) {
          confirmDialog('Segnare l\'ordine come ricevuto?', `Le quantità dell'ordine vengono caricate in "${esc(whs[0].name)}" (scorte).`, 'Ricevi', () => doReceive(whs[0].id));
        } else {
          const opts = whs.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
          openSheet(`
            <h2>Ricevi ordine</h2>
            <div class="sheetsub">Le quantità dell'ordine vengono caricate nel magazzino scelto (scorte).</div>
            <div class="field"><label>Magazzino di destinazione</label><select id="r_wh">${opts}</select></div>
            <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Ricevi</button></div>`,
            s2 => {
              s2.querySelector('[data-cancel]').onclick = closeSheet;
              s2.querySelector('[data-ok]').onclick = () => doReceive(s2.querySelector('#r_wh').value);
            });
        }
      });
      sheet.querySelector('[data-reprint]').onclick = () => {
        const dpObj = o.deliveryPointId ? deliveryPointsOf(lid).find(d => d.id === o.deliveryPointId) : null;
        const pdfs = generateOrderPdfs(loc(lid), o, dpObj);
        showPdfDownloadSheet(pdfs, dpObj);
        toast(pdfs.length === 1 ? '1 PDF rigenerato ✓' : `${pdfs.length} PDF rigenerati ✓`);
      };
      sheet.querySelector('[data-reorder]')?.addEventListener('click', () => {
        confirmDialog('Ri-ordinare?', 'Le quantità di questo ordine vengono caricate nell\'ordine in corso (sovrascrive quello attuale).', 'Ri-ordina', () => {
          const n = reorderFrom(o);
          closeSheet();
          toast(n ? `${n} prodotti caricati nell'ordine ✓` : 'Nessun prodotto ancora disponibile');
          go('ord');
        });
      });
      sheet.querySelector('[data-del]')?.addEventListener('click', () => {
        confirmDialog('Eliminare l\'ordine dallo storico?', fmtDateTime(o.sentAt || o.createdAt), 'Elimina', () => {
          deleteOrder(id); closeSheet(); toast('Ordine eliminato'); after && after();
        }, { danger: true });
      });
    });
}

// Dettaglio di un movimento SINGOLO: minimale e in sola lettura, come mostrava la vecchia scheda prodotto
// (i singoli non hanno mai avuto storno: quello resta alle schede con batchId, via schedaDetail).
function openMove(id) {
  const lid = activeLocale();
  const m = singleMoves(lid).find(x => x.id === id);
  if (!m) { toast('Movimento non trovato'); return; }
  const mt = moveType(m);
  const meta = TYPE_META[mt] || TYPE_META.carico;
  const isRett = mt === 'rettifica';
  const route = isRett ? esc(warehouseName(lid, m.warehouseId))
    : m.kind === 'transfer' ? `${esc(warehouseName(lid, m.fromWarehouseId))} → ${esc(warehouseName(lid, m.warehouseId))}`
    : m.kind === 'in' ? `<span class="muted">esterno / fornitore</span> → ${esc(warehouseName(lid, m.warehouseId))}`
    : `${esc(warehouseName(lid, m.warehouseId))} → <span class="muted">fuori magazzino</span>`;
  const note = (m.note || '').trim(); const showNote = note && !(isRett && note === 'Rettifica');
  const amt = isRett && m.before != null && m.after != null
    ? `<span class="tnum" style="font-weight:800">${m.before} → ${m.after}</span>`
    : `<span class="amt tnum" style="font-weight:800">${m.qty}</span>`;
  openSheet(`
    <h2>${meta.emoji} ${meta.label} · ${esc(moveName(m))}${codeTag(moveCode(m))}</h2>
    <div class="sheetsub">${esc(fmtDate(m.ts) || m.date)} · ${route}</div>
    <div class="list"><div class="row">
      <div class="mid"><div class="t1">${esc(moveName(m))}</div>${showNote ? `<div class="t2">${esc(note)}</div>` : ''}</div>
      ${amt}
    </div></div>
    <div class="muted" style="font-size:12px;margin-top:10px">Movimento singolo (bottone rapido della riga prodotto). Per lo storno di gruppo usa le schede multi-prodotto.</div>
    <div class="actions"><button class="btn primary" data-close>Chiudi</button></div>`,
    sheet => { sheet.querySelector('[data-close]').onclick = closeSheet; });
}

export function bind(root) {
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };
  const reset = () => { shown = PAGE; };   // ricomincia dall'inizio quando cambia un filtro

  root.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => { tipo = b.dataset.tipo; reset(); rerender(); });
  const pe = root.querySelector('#mvperiod'); if (pe) pe.onchange = () => { period = pe.value; reset(); rerender(); };
  const qi = root.querySelector('#mvq');
  if (qi) qi.oninput = () => { q = qi.value; reset(); const pos = qi.selectionStart; rerender(); const n = root.querySelector('#mvq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  root.querySelector('[data-reset]')?.addEventListener('click', () => { q = ''; tipo = 'all'; period = 'all'; reset(); rerender(); });
  root.querySelector('[data-more]')?.addEventListener('click', () => { shown += PAGE; rerender(); });

  root.querySelectorAll('[data-ord]').forEach(el => el.onclick = () => openOrder(el.dataset.ord, rerender));
  root.querySelectorAll('[data-scheda]').forEach(el => el.onclick = () => schedaDetail(lid, el.dataset.scheda, null, rerender));
  root.querySelectorAll('[data-move]').forEach(el => el.onclick = () => openMove(el.dataset.move));
  // elimina scheda dalla riga (storno): stopPropagation per non aprire il dettaglio della stessa riga
  root.querySelectorAll('[data-schedadel]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const s = schedaById(lid, b.dataset.schedadel);
    if (s) confirmDeleteScheda(lid, s, rerender);
  });
}
