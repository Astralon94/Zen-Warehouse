// ============ Vista Report/analisi (Zen-Warehouse) ============
// Filtri combinabili (periodo / intervallo date / fornitore / categoria) + grafici SVG a mano
// (zero dipendenze): andamento mensile a barre, quota fornitore a ciambella, categorie a barre.
import { esc } from '../../domain/util.js';
import { printDocument, toast } from '../dom.js';
import { activeLocale, activeLocaleObj, ordersOf, suppliersOf } from '../../domain/warehouse.js';
import { reportData, reportCategories, monthLabel } from '../../domain/report.js';
import { can } from '../../state/auth.js';

// Stato filtri (persistente tra i re-render della sessione)
const F = { period: 'all', from: '', to: '', supplierId: '', categoryId: '' };
const PERIODS = [['all', 'Tutto'], ['30', '30 giorni'], ['90', '90 giorni'], ['year', 'Anno']];

// palette per torta/legenda: derivata dall'accento con opacità decrescenti (coerente col tema)
const SLICE_ALPHA = [1, 0.78, 0.58, 0.42, 0.30, 0.22, 0.16];
const sliceColor = i => i < SLICE_ALPHA.length
  ? `color-mix(in srgb, var(--accent) ${Math.round(SLICE_ALPHA[i] * 100)}%, var(--card))`
  : `color-mix(in srgb, var(--accent) 12%, var(--card))`;

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

// ---- grafico a barre verticali SVG (andamento mensile) ----
// months: [{month,pieces,orders}]. Asse X = mesi, Y = pezzi; valore sopra ogni barra.
function barChart(months) {
  const W = Math.max(320, months.length * 64 + 48), H = 220;
  const padL = 34, padR = 12, padT = 22, padB = 34;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...months.map(m => m.pieces));
  const bw = iw / months.length;
  const barW = Math.min(38, bw * 0.6);
  // gridline e etichette asse Y (0, metà, max)
  const yTicks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const yFor = v => padT + ih - (v / max) * ih;
  let g = '';
  yTicks.forEach(v => {
    const y = yFor(v);
    g += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`;
    g += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--sub)">${v}</text>`;
  });
  months.forEach((m, i) => {
    const cx = padL + bw * i + bw / 2;
    const bh = (m.pieces / max) * ih;
    const y = padT + ih - bh;
    g += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="3" fill="var(--accent)"><title>${esc(monthLabel(m.month))}: ${m.pieces} pz · ${m.orders} ord.</title></rect>`;
    if (m.pieces > 0) g += `<text x="${cx.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--txt)">${m.pieces}</text>`;
    const lbl = monthLabel(m.month);
    g += `<text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="var(--sub)">${esc(lbl)}</text>`;
  });
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%;height:auto;display:block" role="img" aria-label="Andamento mensile pezzi">${g}</svg></div>`;
}

// ---- ciambella SVG (quota pezzi per fornitore) ----
// data: [{name,pieces}] già ordinata desc. Accorpa la coda oltre 6 voci in "Altri".
function donutChart(rows, total) {
  if (!total) return '';
  const top = rows.slice(0, 6);
  const restPieces = rows.slice(6).reduce((a, r) => a + r.pieces, 0);
  const items = restPieces > 0 ? [...top, { name: 'Altri', pieces: restPieces }] : top;
  const S = 160, cx = S / 2, cy = S / 2, r = 66, sw = 26; // raggio linea mediana anello
  const C = 2 * Math.PI * r;
  let off = 0;
  let arcs = '';
  items.forEach((it, i) => {
    const frac = it.pieces / total;
    const len = frac * C;
    const pct = Math.round(frac * 100);
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${sliceColor(i)}" stroke-width="${sw}"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"><title>${esc(it.name)}: ${it.pieces} pz (${pct}%)</title></circle>`;
    off += len;
  });
  const legend = items.map((it, i) => {
    const pct = Math.round((it.pieces / total) * 100);
    return `<div style="display:flex;align-items:center;gap:7px;font-size:12.5px;margin-bottom:5px">
      <span style="width:11px;height:11px;border-radius:3px;flex-shrink:0;background:${sliceColor(i)};border:1px solid var(--line)"></span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.name)}</span>
      <span class="tnum muted" style="flex-shrink:0"><b style="color:var(--txt)">${pct}%</b> · ${it.pieces} pz</span>
    </div>`;
  }).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:18px;align-items:center">
    <svg viewBox="0 0 ${S} ${S}" width="${S}" style="max-width:100%;height:auto;flex-shrink:0" role="img" aria-label="Quota pezzi per fornitore">
      ${arcs}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="20" font-weight="600" fill="var(--txt)">${total}</text>
      <text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="10" fill="var(--sub)">pezzi</text>
    </svg>
    <div style="flex:1;min-width:180px">${legend}</div>
  </div>`;
}

function filtersBar() {
  const lid = activeLocale();
  const sups = suppliersOf(lid);
  const cats = reportCategories(lid);
  const dateActive = !!(F.from || F.to);
  return `
    <div class="chips" style="margin-bottom:10px">${PERIODS.map(([v, lbl]) => `<button class="chip ${!dateActive && F.period === v ? 'on' : ''}" data-period="${v}">${lbl}</button>`).join('')}</div>
    <div class="card" style="margin-bottom:16px;padding:12px 14px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        <div class="field" style="margin:0"><label>Da</label><input type="date" data-from value="${esc(F.from)}"></div>
        <div class="field" style="margin:0"><label>A</label><input type="date" data-to value="${esc(F.to)}"></div>
        <div class="field" style="margin:0"><label>Fornitore</label><select data-supplier>
          <option value="">Tutti</option>
          ${sups.map(s => `<option value="${esc(s.id)}" ${F.supplierId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select></div>
        <div class="field" style="margin:0"><label>Categoria</label><select data-category>
          <option value="">Tutte</option>
          ${cats.map(c => `<option value="${esc(c.id)}" ${F.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>
      </div>
      ${(dateActive || F.supplierId || F.categoryId) ? `<div style="margin-top:10px"><button class="btn" data-clear>↺ Azzera filtri</button></div>` : ''}
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

  h += filtersBar();

  const r = reportData(lid, F);
  if (!r.totals.orders) return h + `<div class="card empty">Nessun ordine per i filtri selezionati.</div>`;

  // KPI
  h += `<div class="grid k4" style="margin-bottom:12px">
    <div class="card kpi"><div class="lbl">Ordini</div><div class="val tnum">${r.totals.orders}</div></div>
    <div class="card kpi"><div class="lbl">Pezzi ordinati</div><div class="val tnum">${r.totals.pieces}</div></div>
    <div class="card kpi"><div class="lbl">Righe</div><div class="val tnum">${r.totals.righe}</div></div>
    <div class="card kpi"><div class="lbl">Fornitori</div><div class="val tnum">${r.totals.suppliers}</div></div>
  </div>`;
  h += `<div class="grid k3" style="margin-bottom:16px">
    <div class="card kpi"><div class="lbl">Pezzi medi / ordine</div><div class="val tnum">${r.avgPerOrder}</div></div>
    <div class="card kpi"><div class="lbl">Fornitore più attivo</div><div class="val" style="font-size:15px;font-weight:600" title="${esc(r.topSupplier)}">${esc(r.topSupplier)}</div></div>
    <div class="card kpi"><div class="lbl">Prodotto più ordinato</div><div class="val" style="font-size:15px;font-weight:600" title="${esc(r.topProduct)}">${esc(r.topProduct)}</div></div>
  </div>`;

  // Andamento mensile (grafico a barre SVG)
  if (r.byMonth.length > 1) {
    h += `<div class="section-title">Andamento mensile (pezzi)</div><div class="card">${barChart(r.byMonth)}</div>`;
  }

  // Quota per fornitore (ciambella + legenda)
  if (r.bySupplier.length) {
    h += `<div class="section-title" style="margin-top:16px">Quota per fornitore</div><div class="card">${donutChart(r.bySupplier, r.totals.pieces)}</div>`;
  }

  // Ripartizione per categoria (barre)
  if (r.byCategory.length) {
    const maxC = r.byCategory[0]?.pieces || 0;
    h += `<div class="section-title" style="margin-top:16px">Ripartizione per categoria</div><div class="card">${r.byCategory.map(c => bar(c.name, c.pieces, maxC, `pz · ${c.righe} righe`)).join('')}</div>`;
  }

  // Top prodotti (barre)
  const topN = r.topProducts.slice(0, 12);
  const maxP = topN[0]?.qty || 0;
  h += `<div class="section-title" style="margin-top:16px">Prodotti più ordinati</div><div class="card">${topN.map(p => bar(p.name, p.qty, maxP, `pz · ${p.ordini} ord.`)).join('') || '<div class="empty">—</div>'}</div>`;

  // Volumi per fornitore (barre)
  const maxS = r.bySupplier[0]?.pieces || 0;
  h += `<div class="section-title" style="margin-top:16px">Volumi per fornitore</div><div class="card">${r.bySupplier.map(s => bar(s.name, s.pieces, maxS, `pz · ${s.ordini} ord.`)).join('')}</div>`;

  if (can('report.esporta')) h += `<div class="btnrow" style="margin-top:16px"><button class="btn" data-export>⤓ Esporta report PDF</button></div>`;
  return h;
}

export function bind(root) {
  const rerender = () => { root.innerHTML = render(); bind(root); };
  root.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { F.period = b.dataset.period; F.from = ''; F.to = ''; rerender(); });
  root.querySelector('[data-from]')?.addEventListener('change', e => { F.from = e.target.value; rerender(); });
  root.querySelector('[data-to]')?.addEventListener('change', e => { F.to = e.target.value; rerender(); });
  root.querySelector('[data-supplier]')?.addEventListener('change', e => { F.supplierId = e.target.value; rerender(); });
  root.querySelector('[data-category]')?.addEventListener('change', e => { F.categoryId = e.target.value; rerender(); });
  root.querySelector('[data-clear]')?.addEventListener('click', () => { F.from = ''; F.to = ''; F.supplierId = ''; F.categoryId = ''; rerender(); });
  root.querySelector('[data-export]')?.addEventListener('click', () => exportReport());
}

// descrive i filtri attivi per intestazione PDF
function filterSummary() {
  const lid = activeLocale();
  const parts = [];
  if (F.from || F.to) parts.push(`Intervallo: ${F.from ? new Date(F.from + 'T00:00:00').toLocaleDateString('it-IT') : '…'} – ${F.to ? new Date(F.to + 'T00:00:00').toLocaleDateString('it-IT') : '…'}`);
  else parts.push(`Periodo: ${PERIODS.find(p => p[0] === F.period)?.[1] || 'Tutto'}`);
  if (F.supplierId) parts.push(`Fornitore: ${suppliersOf(lid).find(s => s.id === F.supplierId)?.name || '—'}`);
  if (F.categoryId) parts.push(`Categoria: ${reportCategories(lid).find(c => c.id === F.categoryId)?.name || '—'}`);
  return parts.join(' · ');
}

function exportReport() {
  const lid = activeLocale();
  const l = activeLocaleObj();
  const r = reportData(lid, F);
  const rows = (arr, cols) => arr.map(o => `<tr>${cols.map(c => `<td${c.r ? ' style="text-align:right"' : ''}>${esc(String(c.v(o)))}</td>`).join('')}</tr>`).join('');
  const body = `
    <h1>Report ordini — ${esc(l?.name || '')}</h1>
    <div class="meta">${esc(filterSummary())} · ${r.totals.orders} ordini · ${r.totals.pieces} pezzi · ${r.totals.suppliers} fornitori · pezzi medi/ordine ${r.avgPerOrder} · generato il ${new Date().toLocaleDateString('it-IT')}</div>
    ${r.byMonth.length > 1 ? `<h2>Andamento mensile</h2>
    <table><thead><tr><th>Mese</th><th style="text-align:right">Ordini</th><th style="text-align:right">Pezzi</th></tr></thead>
      <tbody>${rows(r.byMonth, [{ v: o => monthLabel(o.month) }, { v: o => o.orders, r: 1 }, { v: o => o.pieces, r: 1 }])}</tbody></table>` : ''}
    <h2>Quota per fornitore</h2>
    <table><thead><tr><th>Fornitore</th><th style="text-align:right">Pezzi</th><th style="text-align:right">%</th><th style="text-align:right">Ordini</th></tr></thead>
      <tbody>${rows(r.bySupplier, [{ v: o => o.name }, { v: o => o.pieces, r: 1 }, { v: o => (r.totals.pieces ? Math.round(o.pieces / r.totals.pieces * 100) : 0) + '%', r: 1 }, { v: o => o.ordini, r: 1 }])}</tbody></table>
    <h2>Ripartizione per categoria</h2>
    <table><thead><tr><th>Categoria</th><th style="text-align:right">Pezzi</th><th style="text-align:right">Righe</th></tr></thead>
      <tbody>${rows(r.byCategory, [{ v: o => o.name }, { v: o => o.pieces, r: 1 }, { v: o => o.righe, r: 1 }])}</tbody></table>
    <h2>Prodotti più ordinati</h2>
    <table><thead><tr><th>Prodotto</th><th style="text-align:right">Pezzi</th><th style="text-align:right">Ordini</th></tr></thead>
      <tbody>${rows(r.topProducts, [{ v: o => o.name }, { v: o => o.qty, r: 1 }, { v: o => o.ordini, r: 1 }])}</tbody></table>`;
  printDocument('Report ordini', body);
  toast('Report pronto per la stampa');
}
