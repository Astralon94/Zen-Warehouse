// ============ Vista Magazzino/scorte (Zen-Warehouse) ============
import { esc } from '../../domain/util.js';
import { openSheet, closeSheet, toast } from '../dom.js';
import { activeLocale, activeLocaleObj, productsOf, product, supplierName } from '../../domain/warehouse.js';
import { stockIn, stockOut, setStock, movesForProduct } from '../../domain/stock.js';

let q = '';
let filter = 'all';   // all | low | out

const status = p => { const s = p.stock || 0, m = p.minStock || 0; if (s <= 0) return 'out'; if (m > 0 && s <= m) return 'low'; return 'ok'; };
const badge = p => {
  const st = status(p);
  const col = st === 'out' ? 'var(--red,#c2685f)' : st === 'low' ? 'var(--orange,#b08a4e)' : 'var(--green,#6b8f80)';
  const min = (p.minStock || 0) > 0 ? `<span style="font-size:11px;color:var(--muted)">/${p.minStock}</span>` : '';
  return `<span class="tnum" style="font-weight:800;color:${col}">${p.stock || 0}${min}${st === 'low' ? ' ⚠️' : st === 'out' ? ' ⛔' : ''}</span>`;
};

export function render() {
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Magazzino</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;
  const lid = activeLocale();
  const all = productsOf(lid);

  let h = `<div class="pagehead"><h1>Magazzino</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;
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
      <div class="t2">${esc(supplierName(p.supplierId))}</div></div>
    ${badge(p)}
    <div style="display:flex;gap:3px;flex-shrink:0;margin-left:8px">
      <button class="btn sm danger" data-out="${p.id}">− Scarico</button>
      <button class="btn sm primary" data-in="${p.id}">+ Carico</button>
    </div>
  </div>`).join('')}</div>`;
  return h;
}

// modal movimento (carico/scarico)
function moveModal(lid, p, kind, after) {
  const isIn = kind === 'in';
  openSheet(`
    <h2>${isIn ? '➕ Carico' : '➖ Scarico'} · ${esc(p.name)}</h2>
    <div class="sheetsub">Giacenza attuale: <b>${p.stock || 0}</b></div>
    <div class="field"><label>Quantità</label><input id="m_qty" inputmode="numeric" placeholder="0" autofocus></div>
    <div class="field"><label>Nota (opzionale)</label><input id="m_note" placeholder="${isIn ? 'Es. consegna fornitore' : 'Es. reso, rottura, uso'}"></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn ${isIn ? 'primary' : 'danger'}" data-ok>${isIn ? 'Carica' : 'Scarica'}</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-ok]').onclick = () => {
        const qty = parseInt(sheet.querySelector('#m_qty').value, 10) || 0;
        if (qty <= 0) { toast('Inserisci una quantità'); return; }
        const note = sheet.querySelector('#m_note').value.trim();
        if (isIn) stockIn(lid, p.id, qty, note); else stockOut(lid, p.id, qty, note);
        closeSheet(); toast(isIn ? `Caricati ${qty} ✓` : `Scaricati ${qty} ✓`); after && after();
      };
    });
}

// scheda prodotto: giacenza, azioni, rettifica, storico movimenti
function openProduct(id, after) {
  const lid = activeLocale();
  const p = product(id); if (!p) return;
  const moves = movesForProduct(id).slice(0, 30);
  const movesHtml = moves.length ? `<div class="list">${moves.map(m => `<div class="row">
      <div class="emoji">${m.kind === 'in' ? '⬆️' : '⬇️'}</div>
      <div class="mid"><div class="t1 tnum ${m.kind === 'in' ? 'pos' : 'neg'}">${m.kind === 'in' ? '+' : '−'}${m.qty}</div><div class="t2">${esc(m.date)}${m.note ? ' · ' + esc(m.note) : ''}</div></div>
    </div>`).join('')}</div>` : `<div class="card empty" style="padding:14px">Nessun movimento.</div>`;

  openSheet(`
    <h2>${esc(p.name)}</h2>
    <div class="sheetsub">Giacenza <b>${p.stock || 0}</b>${(p.minStock || 0) > 0 ? ` · soglia minima ${p.minStock}` : ''} · ${esc(supplierName(p.supplierId))}</div>
    <div class="btnrow" style="margin:6px 0 14px">
      <button class="btn primary" data-in>➕ Carico</button>
      <button class="btn danger" data-out>➖ Scarico</button>
      <button class="btn" data-adj>✎ Rettifica</button>
    </div>
    <div class="section-title">Movimenti</div>
    ${movesHtml}`,
    sheet => {
      const reopen = () => openProduct(id, after);
      sheet.querySelector('[data-in]').onclick = () => moveModal(lid, p, 'in', reopen);
      sheet.querySelector('[data-out]').onclick = () => moveModal(lid, p, 'out', reopen);
      sheet.querySelector('[data-adj]').onclick = () => {
        openSheet(`<h2>Rettifica giacenza · ${esc(p.name)}</h2>
          <div class="field"><label>Giacenza reale</label><input id="a_val" inputmode="numeric" value="${p.stock || 0}"></div>
          <div class="field"><label>Nota</label><input id="a_note" value="Rettifica"></div>
          <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Salva</button></div>`,
          s2 => {
            s2.querySelector('[data-cancel]').onclick = reopen;
            s2.querySelector('[data-ok]').onclick = () => {
              setStock(lid, p.id, s2.querySelector('#a_val').value, s2.querySelector('#a_note').value.trim());
              toast('Giacenza aggiornata ✓'); reopen();
            };
          });
      };
    });
}

export function bind(root) {
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };
  root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; rerender(); });
  const qi = root.querySelector('#mq');
  if (qi) qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; rerender(); const n = root.querySelector('#mq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  root.querySelectorAll('[data-prod]').forEach(el => el.onclick = () => openProduct(el.dataset.prod, rerender));
  root.querySelectorAll('[data-in]').forEach(b => b.onclick = e => { e.stopPropagation(); moveModal(lid, product(b.dataset.in), 'in', rerender); });
  root.querySelectorAll('[data-out]').forEach(b => b.onclick = e => { e.stopPropagation(); moveModal(lid, product(b.dataset.out), 'out', rerender); });
}
