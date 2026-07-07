// ============ Vista Report/analisi (Zen-Warehouse) ============
import { esc } from '../../domain/util.js';
import { printDocument, toast } from '../dom.js';
import { activeLocale, activeLocaleObj, ordersOf } from '../../domain/warehouse.js';
import { reportData, monthLabel } from '../../domain/report.js';

let period = 'all';   // 'all' | '30' | '90' | 'year'
const PERIODS = [['all', 'Tutto'], ['30', '30 giorni'], ['90', '90 giorni'], ['year', 'Anno']];

// barra orizzontale proporzionale (label a sinistra, valore a destra)
function bar(label, value, max, sub = '') {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return `<div style="margin-bottom:9px">
    <div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-bottom:3px">
      <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</span>
      <span class="tnum" style="flex-shrink:0"><b>${value}</b>${sub ? ` <span class="muted" style="font-size:11px">${esc(sub)}</span>` : ''}</span>
    </div>
    <div style="height:8px;background:var(--accent-soft);border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent);border-radius:6px"></div></div>
  </div>`;
}

export function render() {
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Report</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;
  const lid = activeLocale();

  let h = `<div class="pagehead"><h1>Report</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;

  if (!ordersOf(lid).length) {
    return h + `<div class="card empty">Nessun ordine da analizzare.<br><span class="muted">I report si popolano man mano che invii ordini.</span></div>`;
  }

  h += `<div class="chips" style="margin-bottom:14px">${PERIODS.map(([v, lbl]) => `<button class="chip ${period === v ? 'on' : ''}" data-period="${v}">${lbl}</button>`).join('')}</div>`;

  const r = reportData(lid, period);
  if (!r.totals.orders) return h + `<div class="card empty">Nessun ordine nel periodo selezionato.</div>`;

  // KPI
  h += `<div class="grid k4" style="margin-bottom:16px">
    <div class="card kpi"><div class="lbl">Ordini</div><div class="val tnum">${r.totals.orders}</div></div>
    <div class="card kpi"><div class="lbl">Pezzi ordinati</div><div class="val tnum">${r.totals.pieces}</div></div>
    <div class="card kpi"><div class="lbl">Righe</div><div class="val tnum">${r.totals.righe}</div></div>
    <div class="card kpi"><div class="lbl">Fornitori</div><div class="val tnum">${r.totals.suppliers}</div></div>
  </div>`;

  // Top prodotti
  const topN = r.topProducts.slice(0, 12);
  const maxP = topN[0]?.qty || 0;
  h += `<div class="section-title">Prodotti più ordinati</div><div class="card">${topN.map(p => bar(p.name, p.qty, maxP, `pz · ${p.ordini} ord.`)).join('') || '<div class="empty">—</div>'}</div>`;

  // Volumi per fornitore
  const maxS = r.bySupplier[0]?.pieces || 0;
  h += `<div class="section-title" style="margin-top:16px">Volumi per fornitore</div><div class="card">${r.bySupplier.map(s => bar(s.name, s.pieces, maxS, `pz · ${s.ordini} ord.`)).join('')}</div>`;

  // Andamento mensile
  if (r.byMonth.length > 1) {
    const maxM = Math.max(...r.byMonth.map(m => m.pieces));
    h += `<div class="section-title" style="margin-top:16px">Andamento mensile (pezzi)</div><div class="card">${r.byMonth.map(m => bar(monthLabel(m.month), m.pieces, maxM, `${m.orders} ord.`)).join('')}</div>`;
  }

  h += `<div class="btnrow" style="margin-top:16px"><button class="btn" data-export>⤓ Esporta report PDF</button></div>`;
  return h;
}

export function bind(root) {
  const rerender = () => { root.innerHTML = render(); bind(root); };
  root.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { period = b.dataset.period; rerender(); });
  root.querySelector('[data-export]')?.addEventListener('click', () => exportReport());
}

function exportReport() {
  const lid = activeLocale();
  const l = activeLocaleObj();
  const r = reportData(lid, period);
  const plabel = PERIODS.find(p => p[0] === period)?.[1] || 'Tutto';
  const rows = (arr, cols) => arr.map(o => `<tr>${cols.map(c => `<td${c.r ? ' style="text-align:right"' : ''}>${esc(String(c.v(o)))}</td>`).join('')}</tr>`).join('');
  const body = `
    <h1>Report ordini — ${esc(l?.name || '')}</h1>
    <div class="meta">Periodo: ${esc(plabel)} · ${r.totals.orders} ordini · ${r.totals.pieces} pezzi · ${r.totals.suppliers} fornitori · generato il ${new Date().toLocaleDateString('it-IT')}</div>
    <h2>Prodotti più ordinati</h2>
    <table><thead><tr><th>Prodotto</th><th style="text-align:right">Pezzi</th><th style="text-align:right">Ordini</th></tr></thead>
      <tbody>${rows(r.topProducts, [{ v: o => o.name }, { v: o => o.qty, r: 1 }, { v: o => o.ordini, r: 1 }])}</tbody></table>
    <h2>Volumi per fornitore</h2>
    <table><thead><tr><th>Fornitore</th><th style="text-align:right">Pezzi</th><th style="text-align:right">Righe</th><th style="text-align:right">Ordini</th></tr></thead>
      <tbody>${rows(r.bySupplier, [{ v: o => o.name }, { v: o => o.pieces, r: 1 }, { v: o => o.righe, r: 1 }, { v: o => o.ordini, r: 1 }])}</tbody></table>
    ${r.byMonth.length > 1 ? `<h2>Andamento mensile</h2>
    <table><thead><tr><th>Mese</th><th style="text-align:right">Ordini</th><th style="text-align:right">Pezzi</th></tr></thead>
      <tbody>${rows(r.byMonth, [{ v: o => monthLabel(o.month) }, { v: o => o.orders, r: 1 }, { v: o => o.pieces, r: 1 }])}</tbody></table>` : ''}`;
  printDocument('Report ordini', body);
  toast('Report pronto per la stampa');
}
