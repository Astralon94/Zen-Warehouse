// ============ PDF SEPARATI per fornitore (Zen-Warehouse) ============
// I PDF servono da INVIARE a ciascun fornitore: quindi generiamo un FILE PDF SEPARATO per
// fornitore (un `new jsPDF()` ciascuno → un blob a testa), scaricabile/condivisibile singolarmente.
// Portato dal comportamento di Zen-Orders, adattato al modello di Warehouse (righe in `order.lines`,
// nota fornitore in `order.supplierNotes[supplierId]`, punto di consegna con {name,address,phone,note}).
// jsPDF è una dipendenza di BUILD (bundlata da Vite nel single-file): NON tocca lo zero-dip del server.
import { jsPDF } from 'jspdf';

// Genera i PDF di un ordine: uno per fornitore (chiave '__none__' = senza fornitore).
// Ritorna [{ supplierId, supplierName, filename, blob, righe, pezzi }] nell'ordine di apparizione delle righe.
export function generateOrderPdfs(locale, order, dp) {
  const when = order.sentAt || order.createdAt || Date.now();
  const dateStr = new Date(when).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  const isoDate = new Date(when).toISOString().slice(0, 10);
  const supNotes = order.supplierNotes || {};

  // raggruppa le righe per fornitore mantenendo l'ordine di visualizzazione (già in order.lines)
  const groups = [];
  const idx = {};
  (order.lines || []).forEach(ln => {
    const key = ln.supplierId || '__none__';
    if (idx[key] == null) { idx[key] = groups.length; groups.push({ key, name: ln.supplierName || 'Senza fornitore', items: [] }); }
    groups[idx[key]].items.push(ln);
  });

  return groups.map(g => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const ml = 18, mr = 192, pw = 210, pageH = 297;

    // Testata: barra accento prugna (#7a6a99 → dark #b39ac9) con nome locale e data.
    doc.setFillColor(0x7a, 0x6a, 0x99); doc.rect(0, 0, pw, 14, 'F');
    doc.setFillColor(0xb3, 0x9a, 0xc9); doc.rect(pw / 2, 0, pw / 2, 14, 'F');
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
    doc.text((locale?.name || 'ORDINE FORNITORE').toUpperCase().slice(0, 45), ml, 9.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Ordine del ${dateStr}`, mr, 9.5, { align: 'right' });

    // Nome fornitore
    let y = 24;
    doc.setTextColor(15, 23, 42); doc.setFontSize(20); doc.setFont('helvetica', 'bold');
    doc.text(g.name, ml, y); y += 4;
    doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.4); doc.line(ml, y + 2, mr, y + 2); y += 9;

    // Box punto di consegna (se presente)
    if (dp) y = addDeliveryBox(doc, ml, mr, y, dp);

    // Intestazione tabella
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(107, 114, 128);
    doc.text('PRODOTTO', ml, y); doc.text('FORMATO', 145, y); doc.text('QTÀ', mr, y, { align: 'right' });
    y += 3; doc.line(ml, y, mr, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 23, 42);

    // Riserva spazio per la nota fornitore in fondo (footer)
    const supplierNote = (supNotes[g.key] || '').trim();
    const noteLines = supplierNote ? doc.splitTextToSize(supplierNote, mr - ml - 14) : [];
    const noteReserve = supplierNote ? (noteLines.length * 5 + 20) : 0;
    const maxY = pageH - 18 - noteReserve;

    // Righe (nell'ordine di visualizzazione: order.lines è già ordinato)
    g.items.forEach(it => {
      doc.setFontSize(9.5); const lines = doc.splitTextToSize(it.name, 118);
      doc.text(lines, ml, y); doc.setFontSize(9); doc.text(it.format || '—', 145, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(String(it.qty), mr, y, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      y += lines.length > 1 ? lines.length * 5 + 1 : 6.5;
      doc.setDrawColor(245, 245, 245); doc.line(ml, y - 1.5, mr, y - 1.5); doc.setDrawColor(229, 231, 235);
      if (y > maxY) {
        if (supplierNote) addNoteFooter(doc, ml, mr, pageH, supplierNote);
        doc.addPage(); y = 20;
        doc.setFontSize(8); doc.setTextColor(150, 150, 150);
        doc.text(`${g.name} — continua`, ml, 14); doc.line(ml, 16, mr, 16); y = 20;
        doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'normal');
      }
    });

    // Totali
    const pezzi = g.items.reduce((s, it) => s + (it.qty || 0), 0);
    y += 4; doc.setDrawColor(200, 200, 200); doc.line(ml, y, mr, y); y += 5;
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
    doc.text(`Totale righe: ${g.items.length}`, ml, y);
    doc.text(`Totale pezzi: ${pezzi}`, mr, y, { align: 'right' });

    // Note dei singoli prodotti (se presenti)
    const withNotes = g.items.filter(it => it.notes);
    if (withNotes.length) {
      y += 10; doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(107, 114, 128);
      doc.text('NOTE PRODOTTI:', ml, y); y += 4; doc.setFont('helvetica', 'normal');
      withNotes.forEach(it => { const ls = doc.splitTextToSize(`- ${it.name}: ${it.notes}`, mr - ml); doc.text(ls, ml, y); y += ls.length * 4.5; });
    }

    // Nota fornitore in fondo all'ultima pagina
    if (supplierNote) addNoteFooter(doc, ml, mr, pageH, supplierNote);

    const safeName = g.name.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').replace(/\s+/g, '-') || 'Fornitore';
    const filename = `ordine-${safeName}-${isoDate}.pdf`;
    return { supplierId: g.key, supplierName: g.name, filename, blob: doc.output('blob'), righe: g.items.length, pezzi };
  });
}

// Nota "PER IL FORNITORE" in fondo alla pagina — riquadro ambra ben visibile.
function addNoteFooter(doc, ml, mr, pageH, note) {
  const pad = 4, innerW = mr - ml, textW = innerW - pad * 2 - 8;
  const lines = doc.splitTextToSize(note, textW);
  const lineH = 5.2, boxH = lines.length * lineH + pad * 2 + 7;
  const boxY = pageH - 14 - boxH;

  doc.setFillColor(254, 243, 199); doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.8);
  doc.roundedRect(ml, boxY, innerW, boxH, 3, 3, 'FD');
  doc.setFillColor(245, 158, 11);
  doc.roundedRect(ml, boxY, 3, boxH, 1, 1, 'F');

  const headerY = boxY + pad + 4;
  doc.setFillColor(245, 158, 11);
  doc.circle(ml + 9.5, headerY - 1, 1.8, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
  doc.text('!', ml + 9.5, headerY, { align: 'center' });
  doc.setTextColor(120, 53, 15);
  doc.text('NOTA PER IL FORNITORE', ml + 13.5, headerY);

  doc.setDrawColor(251, 191, 36); doc.setLineWidth(0.4);
  doc.line(ml + 8, headerY + 2, mr - pad, headerY + 2);

  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(92, 40, 12);
  doc.text(lines, ml + 8, headerY + 7);
}

// Blocco "CONSEGNARE PRESSO" in alto — ben visibile per il fornitore.
// Punto di consegna Warehouse: {name, address, phone, note}.
function addDeliveryBox(doc, ml, mr, y, dp) {
  const innerW = mr - ml;
  const detail = [];
  if (dp.address) detail.push(dp.address);
  if (dp.phone) detail.push('Tel. ' + dp.phone);
  if (dp.note) detail.push(dp.note);
  doc.setFontSize(9);
  const wrapped = [];
  detail.forEach(t => { doc.splitTextToSize(t, innerW - 14).forEach(l => wrapped.push(l)); });
  const headTop = 6.2, nameH = 6, lineH = 4.6;
  const boxH = headTop + nameH + wrapped.length * lineH + (wrapped.length ? 2.5 : 0) + 2;

  doc.setFillColor(238, 234, 245); doc.setDrawColor(0x7a, 0x6a, 0x99); doc.setLineWidth(0.7);
  doc.roundedRect(ml, y, innerW, boxH, 2.6, 2.6, 'FD');
  doc.setFillColor(0x7a, 0x6a, 0x99);
  doc.roundedRect(ml, y, 3, boxH, 1, 1, 'F');

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0x5a, 0x4d, 0x74);
  doc.text('CONSEGNARE PRESSO', ml + 7, y + headTop - 1);
  doc.setFontSize(12); doc.setTextColor(15, 23, 42);
  doc.text(dp.name, ml + 7, y + headTop + 4.2);
  if (wrapped.length) {
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(51, 65, 85);
    let yy = y + headTop + nameH + 3.5;
    wrapped.forEach(l => { doc.text(l, ml + 7, yy); yy += lineH; });
  }
  return y + boxH + 6;
}

// riepilogo compatto di un ordine (per liste/righe)
export function orderSummary(order) {
  const lines = order.lines || [];
  const suppliers = new Set(lines.map(l => l.supplierId || '__none__'));
  return { righe: lines.length, pezzi: lines.reduce((s, l) => s + (l.qty || 0), 0), fornitori: suppliers.size };
}
