// ============ Vista Ordine: quantità per prodotto → PDF per fornitore + storico ============
import { esc } from '../../domain/util.js';
import { openSheet, closeSheet, toast, confirmDialog, printDocument } from '../dom.js';
import {
  activeLocale, activeLocaleObj, productsOf, supplierName, orderQty,
  topTypes, subTypes, type, deliveryPointsOf,
} from '../../domain/warehouse.js';
import { addQty, setQty, clearOrder, orderTotals, sendOrder } from '../../domain/orders.js';
import { orderDocHtml } from '../../domain/orderpdf.js';
import { go } from '../app.js';

const fmtBadge = f => f ? `<span class="badge soft" style="font-size:10px">${esc(f)}</span>` : '';

export function render() {
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Ordine</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;
  const lid = activeLocale();
  const prods = productsOf(lid);

  let h = `<div class="pagehead"><h1>Ordine</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;
  if (!prods.length) {
    return h + `<div class="card empty">Nessun prodotto nel Database.<br><span class="muted">Aggiungi prodotti per comporre un ordine.</span>
      <div class="btnrow" style="margin-top:12px;justify-content:center"><button class="btn primary" data-godb>Vai al Database</button></div></div>`;
  }

  // raggruppa nell'ordine di visualizzazione: categoria → diretti → sottocategorie → Altro
  const byType = {};
  prods.forEach(p => { const k = type(lid, p.typeId) ? p.typeId : '__none__'; (byType[k] = byType[k] || []).push(p); });
  const rowsBlock = items => `<div class="list">${items.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(p => orderRow(lid, p)).join('')}</div>`;

  let body = '';
  topTypes(lid).forEach(c => {
    const direct = byType[c.id] || [];
    const subs = subTypes(lid, c.id).map(s => ({ s, items: byType[s.id] || [] })).filter(b => b.items.length);
    if (!direct.length && !subs.length) return;
    body += `<div class="section-title">${esc(c.name)}</div>`;
    if (direct.length) body += rowsBlock(direct);
    subs.forEach(b => { body += `<div class="section-title" style="opacity:.75;font-size:12px">${esc(b.s.name)}</div>` + rowsBlock(b.items); });
  });
  const none = byType['__none__'] || [];
  if (none.length) { body += `<div class="section-title">Altro</div>` + rowsBlock(none); }

  h += `<div style="padding-bottom:88px">${body}</div>`;

  // barra fissa in basso
  const t = orderTotals(lid);
  h += `<div id="orderbar" style="position:fixed;left:0;right:0;bottom:0;background:var(--card,var(--surface));border-top:1px solid var(--line);padding:10px 14px calc(10px + env(safe-area-inset-bottom,0));z-index:20;display:flex;gap:10px;max-width:900px;margin:0 auto">
    ${t.righe ? `<button class="btn" data-clear>Svuota</button>` : ''}
    <button class="btn primary" style="flex:1" data-gen ${t.righe ? '' : 'disabled'}>${t.righe ? `📄 Genera PDF · ${t.righe} prodotti · ${t.pezzi} pz` : 'Inserisci le quantità'}</button>
  </div>`;
  return h;
}

function orderRow(lid, p) {
  const qty = orderQty(lid, p.id);
  return `<div class="row ${qty > 0 ? 'sel' : ''}" data-pid="${p.id}">
    <div class="mid"><div class="t1">${esc(p.name)} ${fmtBadge(p.format)}</div>
      <div class="t2">${esc(supplierName(p.supplierId))}</div></div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
      <button class="btn sm" data-minus="${p.id}">−</button>
      <input class="qtyinp" data-qty="${p.id}" type="number" min="0" inputmode="numeric" value="${qty}" style="width:56px;text-align:center;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--input-bg,var(--surface));color:var(--txt)">
      <button class="btn sm primary" data-plus="${p.id}">+</button>
    </div>
  </div>`;
}

export function bind(root) {
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };

  root.querySelector('[data-godb]')?.addEventListener('click', () => go('db'));

  // aggiornamento parziale (niente re-render completo a ogni tap)
  const updateRow = pid => {
    const row = root.querySelector(`.row[data-pid="${pid}"]`);
    if (row) {
      const q = orderQty(lid, pid);
      row.classList.toggle('sel', q > 0);
      const inp = row.querySelector('.qtyinp');
      if (inp && document.activeElement !== inp) inp.value = q;
    }
    updateBar();
  };
  const updateBar = () => {
    const t = orderTotals(lid);
    const bar = root.querySelector('#orderbar');
    if (!bar) return;
    const gen = bar.querySelector('[data-gen]');
    gen.disabled = t.righe === 0;
    gen.innerHTML = t.righe ? `📄 Genera PDF · ${t.righe} prodotti · ${t.pezzi} pz` : 'Inserisci le quantità';
    // mostra/nascondi "Svuota" senza rerender completo
    let clr = bar.querySelector('[data-clear]');
    if (t.righe && !clr) { bar.insertAdjacentHTML('afterbegin', `<button class="btn" data-clear>Svuota</button>`); bindClear(); }
    else if (!t.righe && clr) clr.remove();
  };
  const bindClear = () => {
    root.querySelector('[data-clear]')?.addEventListener('click', () => {
      confirmDialog('Svuotare l\'ordine?', 'Tutte le quantità inserite verranno azzerate.', 'Svuota', () => { clearOrder(lid); rerender(); }, { danger: true });
    });
  };

  root.querySelectorAll('[data-minus]').forEach(b => b.onclick = () => { addQty(lid, b.dataset.minus, -1); updateRow(b.dataset.minus); });
  root.querySelectorAll('[data-plus]').forEach(b => b.onclick = () => { addQty(lid, b.dataset.plus, +1); updateRow(b.dataset.plus); });
  root.querySelectorAll('[data-qty]').forEach(inp => inp.onchange = () => { setQty(lid, inp.dataset.qty, inp.value); updateRow(inp.dataset.qty); });
  bindClear();

  root.querySelector('[data-gen]')?.addEventListener('click', () => startGenerate(lid, rerender));
}

// Scelta punto di consegna (se presenti), poi genera.
function startGenerate(lid, rerender) {
  const dps = deliveryPointsOf(lid);
  if (!dps.length) return generate(lid, null, rerender);
  openSheet(`
    <h2>📍 Punto di consegna</h2>
    <div class="sheetsub">Dove va consegnato questo ordine? Comparirà su tutti i PDF inviati ai fornitori.</div>
    <div class="list">${dps.map(d => `<div class="row click" data-dp="${d.id}"><div class="emoji">📍</div>
      <div class="mid"><div class="t1">${esc(d.name)}</div>${d.address ? `<div class="t2">${esc(d.address)}</div>` : ''}</div></div>`).join('')}</div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn" data-none>Senza punto</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-none]').onclick = () => { closeSheet(); generate(lid, null, rerender); };
      sheet.querySelectorAll('[data-dp]').forEach(el => el.onclick = () => { closeSheet(); generate(lid, el.dataset.dp, rerender); });
    });
}

// Invia l'ordine (→ storico), poi genera il documento PDF (una pagina per fornitore).
function generate(lid, dpId, rerender) {
  const l = activeLocaleObj();
  const order = sendOrder(lid, { deliveryPointId: dpId });
  if (!order) { toast('Nessun prodotto nell\'ordine'); return; }
  const dp = dpId ? deliveryPointsOf(lid).find(d => d.id === dpId) : null;
  rerender();
  toast('Ordine salvato nello storico ✓ — PDF pronto per la stampa');
  // La stampa (window.print) blocca il thread: la ritardiamo così il salvataggio
  // debounced dell'ordine viene confermato dal server PRIMA di aprire la finestra di stampa.
  setTimeout(() => printDocument('Ordine', orderDocHtml(l, order, dp)), 400);
}
