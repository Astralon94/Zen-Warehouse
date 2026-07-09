// ============ Vista Storico ordini (Zen-Warehouse) ============
import { esc } from '../../domain/util.js';
import { openSheet, closeSheet, toast, confirmDialog, showPdfDownloadSheet } from '../dom.js';
import { activeLocale, activeLocaleObj, ordersOf, deliveryPointsOf, loc, warehousesOf } from '../../domain/warehouse.js';
import { generateOrderPdfs, orderSummary } from '../../domain/orderpdf.js';
import { deleteOrder, reorderFrom } from '../../domain/orders.js';
import { receiveOrder } from '../../domain/stock.js';
import { can } from '../../state/auth.js';
import { go } from '../app.js';

let q = '';   // filtro testo (fornitore o prodotto)

function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
const dpName = (lid, id) => (deliveryPointsOf(lid).find(d => d.id === id)?.name || null);
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

export function render() {
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Storico</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;
  const lid = activeLocale();
  let list = ordersOf(lid).slice().sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));

  const term = q.trim().toLowerCase();
  if (term) list = list.filter(o => (o.lines || []).some(ln => (ln.name || '').toLowerCase().includes(term) || (ln.supplierName || '').toLowerCase().includes(term)));

  let h = `<div class="pagehead"><h1>Storico</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;

  const totOrdini = ordersOf(lid).length;
  if (!totOrdini) {
    return h + `<div class="card empty">Nessun ordine ancora inviato.<br><span class="muted">Gli ordini generati dalla schermata Ordine compaiono qui.</span></div>`;
  }

  h += `<div class="field"><input id="stq" placeholder="Cerca prodotto o fornitore…" value="${esc(q)}"></div>`;
  if (!list.length) return h + `<div class="card empty">Nessun ordine per "${esc(q)}".</div>`;

  h += `<div class="card" style="display:flex;justify-content:space-between;margin-bottom:12px"><span><b>${list.length}</b> ordin${list.length === 1 ? 'e' : 'i'}</span></div>`;

  h += `<div class="list two">${list.map(o => {
    const s = orderSummary(o);
    const dp = dpName(lid, o.deliveryPointId);
    return `<div class="row click" data-ord="${o.id}">
      <div class="emoji">🧾</div>
      <div class="mid"><div class="t1">${fmtDateTime(o.sentAt || o.createdAt)}</div>
        <div class="t2">${s.righe} rig${s.righe === 1 ? 'a' : 'he'} · ${s.pezzi} pz · ${s.fornitori} fornitor${s.fornitori === 1 ? 'e' : 'i'}${dp ? ' · 📍 ' + esc(dp) : ''}</div></div>
    </div>`;
  }).join('')}</div>`;
  return h;
}

function openOrder(id) {
  const lid = activeLocale();
  const o = ordersOf(lid).find(x => x.id === id);
  if (!o) return;
  const s = orderSummary(o);
  const dp = dpName(lid, o.deliveryPointId);
  const groups = groupBySupplier(o);
  const groupsHtml = groups.map(g => {
    const rows = g.items.map(it => `<div class="row"><div class="mid"><div class="t1">${esc(it.name)} ${it.format ? `<span class="badge soft" style="font-size:10px">${esc(it.format)}</span>` : ''}</div>${it.notes ? `<div class="t2">${esc(it.notes)}</div>` : ''}</div><div class="amt tnum" style="font-weight:800">${it.qty}</div></div>`).join('');
    const pezzi = g.items.reduce((a, it) => a + it.qty, 0);
    return `<div class="section-title">🚚 ${esc(g.name)} <span class="muted" style="font-weight:500;font-size:12px">· ${g.items.length} rig${g.items.length === 1 ? 'a' : 'he'} · ${pezzi} pz</span></div><div class="list">${rows}</div>`;
  }).join('');

  openSheet(`
    <h2>Ordine del ${fmtDateTime(o.sentAt || o.createdAt).replace(' · ', ' alle ')}</h2>
    <div class="sheetsub">${s.righe} righe · ${s.pezzi} pezzi · ${s.fornitori} fornitor${s.fornitori === 1 ? 'e' : 'i'}${dp ? ' · 📍 ' + esc(dp) : ''}${o.status === 'received' ? ' · <b style="color:var(--green,#6b8f80)">✓ ricevuto</b>' : o.status === 'closed' ? ' · <b class="muted">evaso</b>' : ''}</div>
    ${groupsHtml}
    <div class="btnrow" style="margin-top:14px">
      <button class="btn primary" data-reprint>⤓ Rigenera PDF</button>
      ${can('ordini.manage') ? '<button class="btn" data-reorder>↻ Ri-ordina</button>' : ''}
      ${(o.status === 'received' || o.status === 'closed' || !can('magazzino.manage')) ? '' : '<button class="btn" data-receive>📥 Ricevi (carico)</button>'}
      ${can('ordini.manage') ? '<button class="btn danger" data-del>Elimina</button>' : ''}
    </div>`,
    sheet => {
      sheet.querySelector('[data-receive]')?.addEventListener('click', () => {
        const whs = warehousesOf(lid);
        const doReceive = whId => { const n = receiveOrder(o, whId); closeSheet(); toast(n ? `${n} prodotti caricati in magazzino ✓` : 'Nessun carico'); };
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
          deleteOrder(id); closeSheet(); toast('Ordine eliminato');
        }, { danger: true });
      });
    });
}

export function bind(root) {
  const rerender = () => { root.innerHTML = render(); bind(root); };
  const qi = root.querySelector('#stq');
  if (qi) qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; rerender(); const n = root.querySelector('#stq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  root.querySelectorAll('[data-ord]').forEach(el => el.onclick = () => openOrder(el.dataset.ord));
}
