// ============ Vista Dashboard (Zen-Warehouse) ============
import { data } from '../../state/store.js';
import { esc, fmtEur, round2 } from '../../domain/util.js';
import { activeLocale, activeLocaleObj, counts, lowStock, ordersOf, product, warehouseValue } from '../../domain/warehouse.js';
import { pendingReceipts, pendingTransfersOf } from '../../domain/stock.js';
import { can } from '../../state/auth.js';
import { go } from '../app.js';
import { requestSheet } from './magazzino.js';

// Avvisi/azioni pendenti gatinati come i bottoni della toolbar Magazzino:
//   ricezioni da ordini = magazzino.ricevi · DDT/trasferimenti = magazzino.trasferimento oppure scarico.
const canReceive = () => can('magazzino.ricevi');
const canDdt = () => can('magazzino.trasferimento') || can('magazzino.scarico');

// spesa di un ordine dallo storico: snapshot di riga (ln.price) → prezzo attuale prodotto → 0
function orderSpend(o) {
  return round2((o.lines || []).reduce((s, ln) => {
    const price = (ln.price != null && ln.price !== '') ? (+ln.price || 0) : (+product(ln.productId)?.price || 0);
    return s + (ln.qty || 0) * price;
  }, 0));
}

export function render() {
  const lid = activeLocale();
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Dashboard</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;

  const c = counts(lid);
  const low = lowStock(lid);
  const recent = ordersOf(lid).slice().sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0)).slice(0, 5);

  const kpi = (lbl, val, sub = '') => `<div class="card kpi"><div class="lbl">${esc(lbl)}</div><div class="val tnum">${val}</div>${sub ? `<div class="muted" style="font-size:11.5px">${esc(sub)}</div>` : ''}</div>`;

  let h = `<div class="pagehead"><h1>Dashboard</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;

  // ---- Avvisi pendenti (azionabili): in evidenza, sopra i KPI. Ogni avviso è visibile solo a chi può
  // compiere l'azione e porta in Magazzino aprendo direttamente la relativa sheet. Nulla di pendente = niente card.
  const alerts = [];
  if (canReceive()) {
    const rec = pendingReceipts(lid);
    if (rec.length) {
      const nOrd = new Set(rec.map(s => s.order.id)).size;
      alerts.push(`<div class="card click" data-open="receipts" style="border-color:var(--accent);cursor:pointer">
        <b>📥 ${rec.length} ricezion${rec.length === 1 ? 'e' : 'i'} in attesa da Carico da ordini</b>
        <div class="muted" style="font-size:12.5px;margin-top:4px">${nOrd} ordin${nOrd === 1 ? 'e' : 'i'} da ricevere · tocca per caricare la merce</div>
      </div>`);
    }
  }
  if (canDdt()) {
    const tr = pendingTransfersOf(lid);
    if (tr.length) {
      alerts.push(`<div class="card click" data-open="transfers" style="border-color:var(--accent);cursor:pointer">
        <b>🚚 ${tr.length} trasferiment${tr.length === 1 ? 'o' : 'i'} da consegnare/convalidare</b>
        <div class="muted" style="font-size:12.5px;margin-top:4px">DDT interni preparati · tocca per convalidare</div>
      </div>`);
    }
  }
  if (alerts.length) h += `<div class="grid" style="gap:10px;margin-bottom:14px">${alerts.join('')}</div>`;

  h += `<div class="grid k4" style="margin-bottom:14px">
    ${kpi('Prodotti', c.prodotti)}
    ${kpi('Fornitori', c.fornitori)}
    ${kpi('Categorie', c.categorie)}
    ${kpi('Ordini inviati', c.ordini)}
  </div>`;

  // Valore complessivo delle giacenze del locale (Feature 1) — metrica in evidenza.
  const wv = warehouseValue(lid);
  h += `<div class="card kpi" style="margin-bottom:14px;border-color:var(--accent)">
    <div class="lbl">💶 Valore magazzino</div>
    <div class="val tnum">${fmtEur(wv)}</div>
    <div class="muted" style="font-size:11.5px">Somma di giacenza × prezzo di tutti i prodotti del locale.</div>
  </div>`;

  if (low.length) {
    h += `<div class="card" style="border-color:var(--accent);margin-bottom:14px">
      <b>⚠️ ${low.length} prodott${low.length === 1 ? 'o' : 'i'} sotto scorta</b>
      <div class="muted" style="font-size:12.5px;margin-top:4px">${esc(low.slice(0, 6).map(p => p.name).join(', '))}${low.length > 6 ? '…' : ''}</div>
    </div>`;
  }

  // Azioni rapide verso le sezioni operative
  h += `<div class="section-title">Azioni rapide</div>
    <div class="btnrow">
      <button class="btn primary" data-go="ord">🛒 Nuovo ordine</button>
      ${canDdt() ? '<button class="btn" data-open="transfers">🚚 Trasferimenti</button>' : ''}
      <button class="btn" data-go="mag">🏬 Magazzino</button>
      <button class="btn" data-go="db">📦 Database</button>
      <button class="btn" data-go="rep">📈 Report</button>
    </div>`;

  h += `<div class="section-title">Ultimi ordini</div>`;
  if (!recent.length) {
    h += `<div class="card empty">Nessun ordine ancora inviato.<br><span class="muted">Lo storico degli ordini comparirà qui.</span></div>`;
  } else {
    h += `<div class="list two">${recent.map(o => {
      const n = (o.lines || []).length;
      const d = o.sentAt ? new Date(o.sentAt).toLocaleDateString('it-IT') : '';
      const sp = orderSpend(o);
      return `<div class="row click" data-go="stor"><div class="emoji">🧾</div>
        <div class="mid"><div class="t1">${esc(o.note || 'Ordine')}</div><div class="t2">${d} · ${n} rig${n === 1 ? 'a' : 'he'}${sp > 0 ? ' · ' + fmtEur(sp) : ''}</div></div></div>`;
    }).join('')}</div>`;
  }

  return h;
}

export function bind(root) {
  root.querySelectorAll('[data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
  // scorciatoie verso Magazzino che aprono direttamente una sheet (ricezioni / trasferimenti)
  root.querySelectorAll('[data-open]').forEach(el => el.onclick = () => { requestSheet(el.dataset.open); go('mag'); });
}
