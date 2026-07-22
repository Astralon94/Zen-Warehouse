// ============ PDF SEPARATI per fornitore (Zen-Warehouse) ============
// I PDF servono da INVIARE a ciascun fornitore: quindi generiamo un FILE PDF SEPARATO per
// fornitore (un `new jsPDF()` ciascuno → un blob a testa), scaricabile/condivisibile singolarmente.
// Portato dal comportamento di Zen-Orders, adattato al modello di Warehouse (righe in `order.lines`,
// nota fornitore in `order.supplierNotes[supplierId]`, punto di consegna con {name,address,phone,note}).
// jsPDF è una dipendenza di BUILD (bundlata da Vite nel single-file): NON tocca lo zero-dip del server.
import { jsPDF } from 'jspdf';
import { product } from './warehouse.js';

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
      // codice: dallo snapshot della riga o risolto al volo dal prodotto (utile al fornitore)
      const code = (it.code || product(it.productId)?.code || '').trim();
      doc.setFontSize(9.5); const lines = doc.splitTextToSize(it.name, 118);
      doc.text(lines, ml, y); doc.setFontSize(9); doc.text(it.format || '—', 145, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(String(it.qty), mr, y, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      let rowH = lines.length > 1 ? lines.length * 5 + 1 : 6.5;
      if (code) {
        // sotto-riga sobria col codice, in grigio più piccolo (non ruba spazio al nome)
        doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
        doc.text('Cod. ' + code, ml, y + lines.length * 5 - 1.5);
        doc.setTextColor(15, 23, 42); doc.setFontSize(9);
        rowH = Math.max(rowH, lines.length * 5 + 2.5);
      }
      y += rowH;
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

// ============ Scheda di movimento (DDT interno): trasferimento / prelievo multi-prodotto ============
// Un SOLO jsPDF che accompagna la merce. `scheda` = { type, fromWh, toWh, note, ts, date, lines:[{name,qty,format}] }.
// `warehouses` = elenco magazzini del locale (per risolvere i nomi). Ritorna { supplierName(=etichetta), filename, blob, righe, pezzi }.
// Estensioni per il DDT differito DA CONSEGNARE: `scheda.destLabel` (destinazione libera dell'uscita "fuori
// magazzino") e `scheda.pending` (true → mostra lo stato "DA CONSEGNARE" sotto il titolo).
export function generateMovementSlip(locale, scheda, warehouses) {
  const whName = id => (warehouses || []).find(w => w.id === id)?.name || '—';
  const when = scheda.ts || Date.now();
  const dateStr = new Date(when).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  const isoDate = (scheda.date && /^\d{4}-\d{2}-\d{2}/.test(scheda.date)) ? scheda.date.slice(0, 10) : new Date(when).toISOString().slice(0, 10);
  const isTransfer = scheda.type === 'transfer';
  const isCarico = scheda.type === 'carico';
  const isRettifica = scheda.type === 'rettifica';
  const title = isRettifica ? 'SCHEDA DI RETTIFICA' : isCarico ? 'SCHEDA DI CARICO' : isTransfer ? 'SCHEDA DI TRASFERIMENTO' : 'SCHEDA DI PRELIEVO';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const ml = 18, mr = 192, pw = 210, pageH = 297;

  // Testata: barra accento prugna con nome locale e data.
  doc.setFillColor(0x7a, 0x6a, 0x99); doc.rect(0, 0, pw, 14, 'F');
  doc.setFillColor(0xb3, 0x9a, 0xc9); doc.rect(pw / 2, 0, pw / 2, 14, 'F');
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
  doc.text((locale?.name || 'MAGAZZINO').toUpperCase().slice(0, 45), ml, 9.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(dateStr, mr, 9.5, { align: 'right' });

  // Titolo (con eventuale nome descrittivo della scheda sotto)
  let y = 26;
  doc.setTextColor(15, 23, 42); doc.setFontSize(19); doc.setFont('helvetica', 'bold');
  doc.text(title, ml, y);
  const slipName = (scheda.label || '').trim();
  if (slipName) {
    y += 7; doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(0x5a, 0x4d, 0x74);
    doc.text(doc.splitTextToSize(slipName, mr - ml)[0] || slipName, ml, y);
    doc.setTextColor(15, 23, 42);
  }
  // Stato "DA CONSEGNARE" per il DDT differito (prima della convalida)
  if (scheda.pending) {
    y += 6.5; doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0xb0, 0x8a, 0x4e);
    doc.text('DA CONSEGNARE', ml, y); doc.setTextColor(15, 23, 42);
  }
  y += 4;
  doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.4); doc.line(ml, y + 2, mr, y + 2); y += 11;

  // Box Da / A. Per l'uscita "fuori magazzino" con destinazione libera (destLabel), la mostriamo come "A".
  const destFree = (scheda.destLabel || '').trim();
  const from = isRettifica ? whName(scheda.toWh) : isCarico ? 'Esterno / fornitore' : whName(scheda.fromWh);
  const dest = isRettifica ? 'Rettifica giacenza' : isCarico ? whName(scheda.toWh) : isTransfer ? whName(scheda.toWh) : (destFree || 'Fuori magazzino');
  y = addRouteBox(doc, ml, mr, y, from, dest);

  // Intestazione tabella
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(107, 114, 128);
  doc.text('PRODOTTO', ml, y); doc.text('FORMATO', 145, y); doc.text('QTÀ', mr, y, { align: 'right' });
  y += 3; doc.line(ml, y, mr, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 23, 42);

  const maxY = pageH - 40;
  // per la rettifica mostriamo il segno del delta (+ aumento / − diminuzione)
  const qtyStr = it => isRettifica ? ((it.delta != null ? (it.delta < 0) : (it.kind === 'out')) ? '−' + it.qty : '+' + it.qty) : String(it.qty);
  (scheda.lines || []).forEach(it => {
    const code = (it.code || '').trim();
    doc.setFontSize(9.5); const lines = doc.splitTextToSize(it.name, 118);
    doc.text(lines, ml, y); doc.setFontSize(9); doc.text(it.format || '—', 145, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(qtyStr(it), mr, y, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    let rowH = lines.length > 1 ? lines.length * 5 + 1 : 6.5;
    if (code) {
      // sotto-riga sobria col codice, in grigio più piccolo (coerente col PDF ordine)
      doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
      doc.text('Cod. ' + code, ml, y + lines.length * 5 - 1.5);
      doc.setTextColor(15, 23, 42); doc.setFontSize(9);
      rowH = Math.max(rowH, lines.length * 5 + 2.5);
    }
    y += rowH;
    doc.setDrawColor(245, 245, 245); doc.line(ml, y - 1.5, mr, y - 1.5); doc.setDrawColor(229, 231, 235);
    if (y > maxY) { doc.addPage(); y = 20; }
  });

  // Totali
  const pezzi = (scheda.lines || []).reduce((s, it) => s + (it.qty || 0), 0);
  y += 4; doc.setDrawColor(200, 200, 200); doc.line(ml, y, mr, y); y += 5;
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text(`Totale righe: ${(scheda.lines || []).length}`, ml, y);
  doc.text(`Totale pezzi: ${pezzi}`, mr, y, { align: 'right' });

  // Nota
  const note = (scheda.note || '').trim();
  if (note) {
    y += 10; doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(107, 114, 128);
    doc.text('NOTA:', ml, y); y += 4; doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 23, 42);
    const ls = doc.splitTextToSize(note, mr - ml); doc.text(ls, ml, y); y += ls.length * 4.5;
  }

  // Riga data / firma in fondo
  doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.4);
  const signY = pageH - 22;
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 114, 128);
  doc.text('Data', ml, signY); doc.line(ml + 12, signY, ml + 70, signY);
  doc.text('Firma', 118, signY); doc.line(130, signY, mr, signY);

  const safeType = isRettifica ? 'rettifica' : isCarico ? 'carico' : isTransfer ? 'trasferimento' : 'prelievo';
  const filename = `scheda-${safeType}-${isoDate}.pdf`;
  const label = (isRettifica ? 'Rettifica' : isCarico ? 'Carico' : isTransfer ? 'Trasferimento' : 'Prelievo') + ` · ${from} → ${dest}`;
  return { supplierName: label, filename, blob: doc.output('blob'), righe: (scheda.lines || []).length, pezzi };
}

// ============ Foglio inventario stampabile (Feature 3) ============
// PDF con l'elenco dei prodotti di un magazzino: giacenza attuale + colonna vuota "Contati" da
// compilare a mano durante la conta fisica. Stesso linguaggio visivo delle schede di movimento.
// `products` = [{name, format, stock}] già filtrati/ordinati. Ritorna { supplierName, filename, blob, righe, pezzi }.
export function generateInventorySheet(locale, warehouse, products) {
  const when = Date.now();
  const dateStr = new Date(when).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  const isoDate = new Date(when).toISOString().slice(0, 10);
  const whName = warehouse?.name || 'Magazzino';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const ml = 18, mr = 192, pw = 210, pageH = 297;
  const colFmt = 118, colCur = 150, colCount = mr; // colonne: prodotto · formato · giac. · contati

  // Testata: barra accento prugna con nome locale e data.
  doc.setFillColor(0x7a, 0x6a, 0x99); doc.rect(0, 0, pw, 14, 'F');
  doc.setFillColor(0xb3, 0x9a, 0xc9); doc.rect(pw / 2, 0, pw / 2, 14, 'F');
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
  doc.text((locale?.name || 'MAGAZZINO').toUpperCase().slice(0, 45), ml, 9.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(dateStr, mr, 9.5, { align: 'right' });

  // Titolo + magazzino
  let y = 26;
  doc.setTextColor(15, 23, 42); doc.setFontSize(19); doc.setFont('helvetica', 'bold');
  doc.text('FOGLIO INVENTARIO', ml, y);
  y += 7; doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(0x5a, 0x4d, 0x74);
  doc.text(doc.splitTextToSize(whName, mr - ml)[0] || whName, ml, y);
  doc.setTextColor(15, 23, 42); y += 4;
  doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.4); doc.line(ml, y + 2, mr, y + 2); y += 11;

  // Intestazione tabella
  const header = () => {
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(107, 114, 128);
    doc.text('PRODOTTO', ml, y); doc.text('FORMATO', colFmt, y);
    doc.text('GIAC.', colCur, y, { align: 'right' }); doc.text('CONTATI', colCount, y, { align: 'right' });
    y += 3; doc.line(ml, y, mr, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 23, 42);
  };
  header();

  const maxY = pageH - 24;
  (products || []).forEach(it => {
    const code = (it.code || '').trim();
    doc.setFontSize(9.5); const lines = doc.splitTextToSize(it.name, colFmt - ml - 4);
    doc.text(lines, ml, y); doc.setFontSize(9); doc.text(it.format || '—', colFmt, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(String(it.stock), colCur, y, { align: 'right' });
    // casella vuota per la conta manuale
    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.4); doc.roundedRect(colCount - 22, y - 4, 22, 6.5, 1, 1, 'S');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    let rowH = lines.length > 1 ? lines.length * 5 + 1 : 7.5;
    if (code) {
      // sotto-riga sobria col codice, in grigio più piccolo (coerente con schede e PDF ordine)
      doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
      doc.text('Cod. ' + code, ml, y + lines.length * 5 - 1.5);
      doc.setTextColor(15, 23, 42); doc.setFontSize(9);
      rowH = Math.max(rowH, lines.length * 5 + 3);
    }
    y += rowH;
    doc.setDrawColor(245, 245, 245); doc.line(ml, y - 2, mr, y - 2); doc.setDrawColor(229, 231, 235);
    if (y > maxY) { doc.addPage(); y = 20; header(); }
  });

  y += 4; doc.setDrawColor(200, 200, 200); doc.line(ml, y, mr, y); y += 5;
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text(`Totale prodotti: ${(products || []).length}`, ml, y);

  const safeName = whName.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').replace(/\s+/g, '-') || 'magazzino';
  const filename = `inventario-${safeName}-${isoDate}.pdf`;
  return { supplierName: 'Foglio inventario · ' + whName, filename, blob: doc.output('blob'), righe: (products || []).length, pezzi: (products || []).reduce((s, it) => s + (it.stock || 0), 0) };
}

// Box "DA → A" per la scheda di movimento (prugna).
function addRouteBox(doc, ml, mr, y, from, to) {
  const innerW = mr - ml, boxH = 16;
  doc.setFillColor(238, 234, 245); doc.setDrawColor(0x7a, 0x6a, 0x99); doc.setLineWidth(0.7);
  doc.roundedRect(ml, y, innerW, boxH, 2.6, 2.6, 'FD');
  doc.setFillColor(0x7a, 0x6a, 0x99);
  doc.roundedRect(ml, y, 3, boxH, 1, 1, 'F');
  const colW = innerW / 2;
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(0x5a, 0x4d, 0x74);
  doc.text('DA', ml + 7, y + 5.5); doc.text('A', ml + colW + 5, y + 5.5);
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text(doc.splitTextToSize(from, colW - 12)[0] || '—', ml + 7, y + 11.5);
  doc.text(doc.splitTextToSize(to, colW - 12)[0] || '—', ml + colW + 5, y + 11.5);
  return y + boxH + 8;
}

// riepilogo compatto di un ordine (per liste/righe)
export function orderSummary(order) {
  const lines = order.lines || [];
  const suppliers = new Set(lines.map(l => l.supplierId || '__none__'));
  return { righe: lines.length, pezzi: lines.reduce((s, l) => s + (l.qty || 0), 0), fornitori: suppliers.size };
}
