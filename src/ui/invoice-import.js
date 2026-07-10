// ============ Import prodotti da fattura elettronica (FatturaPA XML/p7m) ============
// Flusso: carica una o più fatture XML → sceglie il fornitore Warehouse a cui applicarle
// (preselezionato per nome dal cedente, o creabile al volo) → scorre i prodotti rilevati
// (DettaglioLinee) uno per uno, con i campi precompilati (nome, prezzo, unità) → l'utente
// completa e Conferma o Salta → riepilogo finale. Le quantità della fattura NON toccano le
// giacenze: l'import crea SOLO anagrafiche prodotto (con il prezzo di acquisto).
import { esc, fmtEur, parseMoney } from '../domain/util.js';
import { FORMATS } from '../state/model.js';
import { openSheet, closeSheet, toast } from './dom.js';
import { can } from '../state/auth.js';
import { productsOf, suppliersOf, topTypes, subTypes } from '../domain/warehouse.js';
import { addProduct, addSupplier } from '../domain/catalog.js';
import { parseFatturaPA } from '../importers/fatturapa.js';
import { extractXmlFromP7m } from '../importers/p7m.js';

// ---- lettura + parsing di un file (XML o p7m) → draft fattura o null ----
async function readInvoice(file) {
  const name = file.name || '';
  const lower = name.toLowerCase();
  if (lower.endsWith('.p7m')) {
    try { const xml = extractXmlFromP7m(new Uint8Array(await file.arrayBuffer())); return xml ? parseFatturaPA(xml, name) : null; }
    catch (e) { return null; }
  }
  let inv = null;
  try { inv = parseFatturaPA(await file.text(), name); } catch (e) { inv = null; }
  if (!inv) { // ricade sul contenitore firmato anche con estensione diversa da .p7m
    try { const xml = extractXmlFromP7m(new Uint8Array(await file.arrayBuffer())); if (xml) inv = parseFatturaPA(xml, name); } catch (e) {}
  }
  return inv;
}

// righe utili: descrizione non vuota + dedup per descrizione (case-insensitive) nella stessa fattura
function usableLines(invoice) {
  const seen = new Set(), out = [];
  (invoice.lines || []).forEach(ln => {
    const desc = (ln.desc || '').trim();
    if (!desc) return;
    const key = desc.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ desc, price: parseMoney(ln.price), um: (ln.um || '').trim() });
  });
  return out;
}

// prodotto già presente nel locale (match per nome, preferendo lo stesso fornitore)
function findExisting(lid, name, supplierId) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return null;
  const list = productsOf(lid).filter(p => (p.name || '').trim().toLowerCase() === n);
  if (!list.length) return null;
  return (supplierId && list.find(p => p.supplierId === supplierId)) || list[0];
}

// somiglianza semplice per la preselezione del fornitore (uguaglianza o inclusione dei nomi normalizzati)
function normName(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function matchSupplier(lid, cedName) {
  const target = normName(cedName);
  if (!target) return null;
  const sups = suppliersOf(lid);
  return sups.find(s => normName(s.name) === target)
    || sups.find(s => { const a = normName(s.name); return a && (a.includes(target) || target.includes(a)); })
    || null;
}

// opzioni formato: FORMATS noti + (se rilevata) l'unità di misura della fattura, preselezionata
function fmtOptions(um) {
  const raw = (um || '').trim();
  const known = FORMATS.slice();
  let sel = '';
  if (raw) { const m = known.find(f => f.toLowerCase() === raw.toLowerCase()); if (m) sel = m; else { known.push(raw); sel = raw; } }
  return '<option value="">—</option>' + known.map(f => `<option value="${esc(f)}" ${f === sel ? 'selected' : ''}>${esc(f)}</option>`).join('');
}
function subOptions(lid, catId, subId) {
  const subs = catId ? subTypes(lid, catId) : [];
  if (!subs.length) return '';
  const opts = '<option value="">— Nessuna —</option>' + subs.map(s => `<option value="${s.id}" ${subId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  return `<div class="field"><label>Sottocategoria</label><select id="i_subcat">${opts}</select></div>`;
}

// piccolo wrapper: apre un foglio e risolve con la scelta dell'utente
function sheetChoice(html, wire) {
  return new Promise(resolve => openSheet(html, sheet => wire(sheet, resolve)));
}

// ---- passo 3: scelta del fornitore Warehouse per l'intera fattura ----
function chooseSupplier(lid, invoice) {
  const cedName = invoice.supplierName || '';
  const matched = matchSupplier(lid, cedName);
  const canCreate = can('fornitori.crea');
  const sups = suppliersOf(lid);
  const preNew = !matched && canCreate;
  const supOpts = `<option value="" ${(!matched && !preNew) ? 'selected' : ''}>— Senza fornitore —</option>`
    + sups.map(s => `<option value="${s.id}" ${matched && matched.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
    + (canCreate ? `<option value="__new__" ${preNew ? 'selected' : ''}>➕ Crea nuovo fornitore…</option>` : '');

  const nLines = usableLines(invoice).length;
  return sheetChoice(`
    <h2>📄 Importa da fattura</h2>
    <div class="sheetsub">Cedente rilevato: <b>${esc(cedName || '—')}</b>${invoice.piva ? ' · P.IVA ' + esc(invoice.piva) : ''}<br>${nLines} prodott${nLines === 1 ? 'o' : 'i'} nella fattura${invoice.number ? ' · n. ' + esc(invoice.number) : ''}.</div>
    <div class="field"><label>Assegna i prodotti al fornitore</label><select id="i_sup">${supOpts}</select></div>
    <div id="i_newslot">${preNew ? newSupField(cedName) : ''}</div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Continua</button></div>`,
    (sheet, resolve) => {
      const g = s => sheet.querySelector(s);
      g('#i_sup').onchange = () => { g('#i_newslot').innerHTML = (g('#i_sup').value === '__new__') ? newSupField(cedName) : ''; };
      g('[data-cancel]').onclick = () => { closeSheet(); resolve(null); };
      g('[data-ok]').onclick = () => {
        const v = g('#i_sup').value;
        if (v === '__new__') {
          const name = (g('#i_newname')?.value || '').trim();
          if (!name) { toast('Inserisci il nome del fornitore'); return; }
          const s = addSupplier(lid, { name });
          resolve({ supplierId: s.id, supplierName: s.name });
        } else if (v) {
          const s = sups.find(x => x.id === v);
          resolve({ supplierId: v, supplierName: s?.name || '' });
        } else {
          resolve({ supplierId: null, supplierName: '' });
        }
      };
    });
}
function newSupField(cedName) {
  return `<div class="field"><label>Nome nuovo fornitore</label><input id="i_newname" value="${esc(cedName)}" placeholder="Nome fornitore"></div>`;
}

// ---- passo 4: scheda del singolo prodotto (precompilata), Conferma / Salta ----
// Risolve con 'add' | 'skip' | 'cancel'; su 'add' la anagrafica è già stata creata.
function productStep(lid, line, ctx) {
  const existing = findExisting(lid, line.desc, ctx.supplierId);
  const catOpts = '<option value="">— Nessuna —</option>' + topTypes(lid).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  // NB: niente selettore "punto di consegna": nel modello attuale il punto di consegna si
  // sceglie PER ORDINE (schermata Ordine); il campo prodotto è vestigiale e nessuno lo legge.
  const priceStr = line.price ? String(line.price).replace('.', ',') : '';

  return sheetChoice(`
    <h2>Prodotto ${ctx.index + 1} di ${ctx.total}</h2>
    <div class="sheetsub">Fornitore: <b>${esc(ctx.supplierName || 'Senza fornitore')}</b>${line.um ? ' · unità fattura: ' + esc(line.um) : ''}
      ${existing ? '<br><span class="badge" style="background:var(--accent-soft);color:var(--accent)">⚠️ già presente</span> — un prodotto con questo nome esiste già.' : ''}</div>
    <div class="field"><label>Nome *</label><input id="i_name" value="${esc(line.desc)}"></div>
    <div class="frow">
      <div class="field"><label>Formato / unità</label><select id="i_fmt">${fmtOptions(line.um)}</select></div>
      <div class="field"><label>Categoria</label><select id="i_cat">${catOpts}</select></div>
    </div>
    <div id="i_subslot"></div>
    <div class="field"><label>Prezzo di acquisto (€)</label><input id="i_price" inputmode="decimal" value="${esc(priceStr)}" placeholder="0,00"></div>
    <div class="field"><label>Note</label><input id="i_notes" value="" placeholder="Note opzionali…"></div>
    <div class="actions">
      <button class="btn" data-cancel>Annulla import</button>
      <button class="btn${existing ? ' primary' : ''}" data-skip>Salta</button>
      <button class="btn${existing ? '' : ' primary'}" data-add>Conferma</button>
    </div>`,
    (sheet, resolve) => {
      const g = s => sheet.querySelector(s);
      g('#i_cat').onchange = () => { g('#i_subslot').innerHTML = subOptions(lid, g('#i_cat').value || null, null); };
      g('[data-cancel]').onclick = () => { closeSheet(); resolve('cancel'); };
      g('[data-skip]').onclick = () => resolve('skip');
      g('[data-add]').onclick = () => {
        const name = g('#i_name').value.trim();
        if (!name) { toast('Il nome è obbligatorio'); return; }
        const catV = g('#i_cat').value || null;
        const subEl = g('#i_subcat');
        const subV = subEl ? (subEl.value || null) : null;
        addProduct(lid, {
          name, format: g('#i_fmt').value, typeId: subV || catV || null,
          supplierId: ctx.supplierId || null,
          notes: g('#i_notes').value.trim(),
          price: parseMoney(g('#i_price').value),
        });
        resolve('add');
      };
    });
}

// ---- riepilogo finale ----
function summarySheet(res) {
  openSheet(`
    <h2>Import completato</h2>
    <div class="sheetsub">Riepilogo dell'operazione.</div>
    <div class="list">
      <div class="row"><div class="emoji">✅</div><div class="mid"><div class="t1">Aggiunti</div></div><div class="amt tnum" style="font-weight:800">${res.added}</div></div>
      <div class="row"><div class="emoji">⏭️</div><div class="mid"><div class="t1">Saltati</div></div><div class="amt tnum" style="font-weight:800">${res.skipped}</div></div>
      <div class="row"><div class="emoji">⚠️</div><div class="mid"><div class="t1">Già presenti (saltati in automatico)</div></div><div class="amt tnum" style="font-weight:800">${res.alreadyPresent}</div></div>
    </div>
    <div class="actions"><button class="btn primary" data-ok>Chiudi</button></div>`,
    sheet => { sheet.querySelector('[data-ok]').onclick = closeSheet; });
}

// ---- orchestrazione: file → fatture → (per fattura) fornitore + prodotti → riepilogo ----
export async function importProductsFromInvoice(lid, files, onDone) {
  const invoices = [];
  let invalid = 0;
  for (const f of files) { const inv = await readInvoice(f); if (inv) invoices.push(inv); else invalid++; }
  if (!invoices.length) { toast(invalid ? 'Nessuna fattura XML valida' : 'Nessun file da importare'); return; }
  if (invalid) toast(`${invalid} file ignorat${invalid === 1 ? 'o' : 'i'} (non valid${invalid === 1 ? 'o' : 'i'})`);

  const res = { added: 0, skipped: 0, alreadyPresent: 0 };
  let cancelled = false;

  for (const invoice of invoices) {
    if (cancelled) break;
    const lines = usableLines(invoice);
    if (!lines.length) { toast(`Fattura ${invoice.number || ''}: nessun prodotto rilevato`); continue; }
    const pick = await chooseSupplier(lid, invoice);
    if (!pick) { cancelled = true; break; } // annullato: interrompe l'intera coda
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Prodotto già presente (stesso nome, stesso locale/fornitore): SALTO AUTOMATICO,
      // senza mostrare la scheda — si contano a parte nel riepilogo.
      if (findExisting(lid, line.desc, pick.supplierId)) { res.alreadyPresent++; continue; }
      const choice = await productStep(lid, line, { ...pick, index: i, total: lines.length });
      if (choice === 'add') res.added++;
      else if (choice === 'skip') res.skipped++;
      else { cancelled = true; break; } // annulla import
    }
  }

  summarySheet(res);
  if (res.added) toast(`${res.added} prodott${res.added === 1 ? 'o' : 'i'} aggiunt${res.added === 1 ? 'o' : 'i'} ✓`);
  onDone?.();
}
