// ============ Vista Dashboard (Zen-Warehouse) ============
import { data } from '../../state/store.js';
import { esc } from '../../domain/util.js';
import { activeLocale, activeLocaleObj, counts, lowStock, ordersOf } from '../../domain/warehouse.js';
import { go } from '../app.js';

export function render() {
  const lid = activeLocale();
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Dashboard</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;

  const c = counts(lid);
  const low = lowStock(lid);
  const recent = ordersOf(lid).slice().sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0)).slice(0, 5);

  const kpi = (lbl, val, sub = '') => `<div class="card kpi"><div class="lbl">${esc(lbl)}</div><div class="val tnum">${val}</div>${sub ? `<div class="muted" style="font-size:11.5px">${esc(sub)}</div>` : ''}</div>`;

  let h = `<div class="pagehead"><h1>Dashboard</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;

  h += `<div class="grid k4" style="margin-bottom:14px">
    ${kpi('Prodotti', c.prodotti)}
    ${kpi('Fornitori', c.fornitori)}
    ${kpi('Categorie', c.categorie)}
    ${kpi('Ordini inviati', c.ordini)}
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
      return `<div class="row click" data-go="stor"><div class="emoji">🧾</div>
        <div class="mid"><div class="t1">${esc(o.note || 'Ordine')}</div><div class="t2">${d} · ${n} rig${n === 1 ? 'a' : 'he'}</div></div></div>`;
    }).join('')}</div>`;
  }

  return h;
}

export function bind(root) {
  root.querySelectorAll('[data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
}
