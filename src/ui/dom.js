// ============ Helper UI: toast, sheet/modal, conferme, stampa, download ============
import { esc } from '../domain/util.js';

let toastTimer;
export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// scrim + sheet condivisi
function ensureSheet() {
  let scrim = document.getElementById('scrim');
  if (!scrim) {
    scrim = document.createElement('div'); scrim.id = 'scrim'; scrim.className = 'scrim';
    const sheet = document.createElement('div'); sheet.id = 'sheet'; sheet.className = 'sheet';
    document.body.append(scrim, sheet);
    scrim.addEventListener('click', closeSheet);
  }
  return { scrim: document.getElementById('scrim'), sheet: document.getElementById('sheet') };
}

export function openSheet(html, onMount, opts = {}) {
  const { scrim, sheet } = ensureSheet();
  sheet.innerHTML = html;
  sheet.classList.toggle('wide', !!opts.wide); // foglio largo (builder multi-prodotto), resettato a ogni apertura
  scrim.classList.add('show'); sheet.classList.add('show');
  if (onMount) onMount(sheet);
  return sheet;
}
export function closeSheet() {
  const scrim = document.getElementById('scrim'), sheet = document.getElementById('sheet');
  if (scrim) scrim.classList.remove('show');
  if (sheet) sheet.classList.remove('show');
}

export function confirmDialog(title, body, okLabel, onOk, { danger = false } = {}) {
  openSheet(`
    <h2>${esc(title)}</h2>
    ${body ? `<div class="sheetsub">${esc(body)}</div>` : ''}
    <div class="actions">
      <button class="btn" data-x="cancel">Annulla</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-x="ok">${esc(okLabel)}</button>
    </div>`, sheet => {
    sheet.querySelector('[data-x="cancel"]').onclick = closeSheet;
    sheet.querySelector('[data-x="ok"]').onclick = () => { closeSheet(); onOk(); };
  });
}

// Stampa un documento isolato (per export PDF via "Salva come PDF" del browser).
export function printDocument(title, bodyHtml) {
  const css = `
    *{box-sizing:border-box} body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:24px}
    h1{font-size:18px;margin:0 0 2px} h2{font-size:14px;margin:18px 0 6px}
    .meta{color:#666;font-size:12px;margin-bottom:16px}
    .notebox{background:#f4f1f8;border:1px solid #d9d0e6;border-left:3px solid #7a6a99;border-radius:6px;padding:8px 12px;margin:0 0 14px;font-size:12.5px;color:#3a3348;white-space:pre-wrap}
    table{width:100%;border-collapse:collapse;margin-bottom:10px} th,td{text-align:left;padding:6px 8px;border:1px solid #ddd;vertical-align:middle}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#666}
    @media print{body{margin:0}}`;
  const ifr = document.createElement('iframe');
  ifr.setAttribute('aria-hidden', 'true');
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(ifr);
  const doc = ifr.contentWindow.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  const fire = () => { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) {} setTimeout(() => ifr.remove(), 1000); };
  if (ifr.contentWindow.document.readyState === 'complete') setTimeout(fire, 150);
  else ifr.onload = () => setTimeout(fire, 150);
}

// Scarica un blob/testo
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  downloadBlob(filename, new Blob(['﻿' + text], { type: mime }));
}

// Modale di download dei PDF per fornitore (uno per fornitore). `pdfs` = [{supplierName,filename,blob,righe,pezzi}].
// Per ciascuno: pulsante Scarica (object URL + download) e, se supportato, Condividi (Web Share API).
// Gli object URL creati vengono revocati alla chiusura del foglio.
export function showPdfDownloadSheet(pdfs, dp) {
  const urls = pdfs.map(p => URL.createObjectURL(p.blob));
  const canShare = (() => {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 't.pdf', { type: 'application/pdf' })] })); }
    catch { return false; }
  })();

  const rows = pdfs.map((p, i) => `
    <div class="row" style="align-items:center">
      <div class="emoji">📄</div>
      <div class="mid"><div class="t1">${esc(p.supplierName)}</div>
        <div class="t2">${p.righe} rig${p.righe === 1 ? 'a' : 'he'} · ${p.pezzi} pz</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${canShare ? `<button class="btn sm" data-share="${i}">Condividi</button>` : ''}
        <a class="btn sm primary" href="${urls[i]}" download="${esc(p.filename)}" data-dl="${i}" style="text-decoration:none">⤓ Scarica</a>
      </div>
    </div>`).join('');

  const sheet = openSheet(`
    <h2>📄 PDF pronti</h2>
    <div class="sheetsub">${pdfs.length === 1 ? '1 PDF generato' : pdfs.length + ' PDF generati'} — un file per fornitore, pronto da inviare.${dp ? ' · 📍 ' + esc(dp.name) : ''}</div>
    <div class="list">${rows}</div>
    <div class="actions"><button class="btn" data-close-pdf>Chiudi</button></div>`,
    s => {
      s.querySelector('[data-close-pdf]').onclick = closeSheet;
      s.querySelectorAll('[data-share]').forEach(b => b.onclick = async () => {
        const p = pdfs[+b.dataset.share];
        const file = new File([p.blob], p.filename, { type: 'application/pdf' });
        try { if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: p.filename }); }
        catch { /* annullato dall'utente: ok */ }
      });
    });

  // revoca gli object URL quando il foglio si chiude (scrim/Esc/pulsante Chiudi)
  const scrim = document.getElementById('scrim');
  const revoke = () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  let done = false;
  const watch = setInterval(() => {
    if (!done && sheet && !sheet.classList.contains('show')) { done = true; clearInterval(watch); revoke(); }
  }, 400);
  scrim?.addEventListener('click', () => { if (!done) { done = true; clearInterval(watch); revoke(); } }, { once: true });
}

// chiude i menù a tendina aperti quando si clicca fuori
document.addEventListener('click', e => {
  document.querySelectorAll('.navmenu.open').forEach(m => {
    if (!m.parentElement.contains(e.target)) m.classList.remove('open');
  });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
