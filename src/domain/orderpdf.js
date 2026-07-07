// ============ Documento stampabile di un ordine (Zen-Warehouse) ============
// Costruisce l'HTML per printDocument: UNA SEZIONE/PAGINA per fornitore, con la tabella
// Prodotto/Formato/Qtà, i totali e il box del punto di consegna. Pura: (locale, order, dp) → HTML.
// Usato sia dalla schermata Ordine (generazione) sia dallo Storico (ristampa).
import { esc } from './util.js';

export function orderDocHtml(locale, order, dp) {
  const dateStr = new Date(order.sentAt || order.createdAt || Date.now()).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

  // raggruppa le righe per fornitore mantenendo l'ordine
  const groups = [];
  const idx = {};
  (order.lines || []).forEach(ln => {
    const key = ln.supplierId || '__none__';
    if (idx[key] == null) { idx[key] = groups.length; groups.push({ name: ln.supplierName || 'Senza fornitore', items: [] }); }
    groups[idx[key]].items.push(ln);
  });
  const dpBox = dp ? `<div class="meta"><b>📍 Consegna:</b> ${esc(dp.name)}${dp.address ? ' — ' + esc(dp.address) : ''}${dp.phone ? ' · ' + esc(dp.phone) : ''}</div>` : '';

  return groups.map((g, i) => {
    const rows = g.items.map(it => `<tr><td>${esc(it.name)}${it.notes ? `<br><span style="color:#888;font-size:11px">${esc(it.notes)}</span>` : ''}</td><td>${esc(it.format || '—')}</td><td style="text-align:right;font-weight:700">${it.qty}</td></tr>`).join('');
    const pezzi = g.items.reduce((s, it) => s + it.qty, 0);
    return `<div ${i > 0 ? 'style="page-break-before:always"' : ''}>
      <h1>${esc(g.name)}</h1>
      <div class="meta">${esc(locale?.name || '')} · Ordine del ${dateStr}</div>
      ${dpBox}
      ${order.note ? `<div class="meta"><b>Nota:</b> ${esc(order.note)}</div>` : ''}
      <table><thead><tr><th>Prodotto</th><th>Formato</th><th style="text-align:right">Qtà</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="meta">Totale righe: ${g.items.length} · Totale pezzi: ${pezzi}</div>
    </div>`;
  }).join('');
}

// riepilogo compatto di un ordine (per liste/righe)
export function orderSummary(order) {
  const lines = order.lines || [];
  const suppliers = new Set(lines.map(l => l.supplierId || '__none__'));
  return { righe: lines.length, pezzi: lines.reduce((s, l) => s + (l.qty || 0), 0), fornitori: suppliers.size };
}
