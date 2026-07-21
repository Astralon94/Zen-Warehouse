// ============ Vista Ordine: quantità per prodotto → PDF per fornitore + storico ============
import { esc, productMatches, scanTarget, debounce } from '../../domain/util.js';
import { openSheet, closeSheet, toast, confirmDialog, showPdfDownloadSheet, codeTag, gentleAutofocus } from '../dom.js';
import {
  activeLocale, activeLocaleObj, productsOf, suppliersOf, supplierName, orderQty,
  topTypes, subTypes, type, deliveryPointsOf, orderLines, totalStock,
} from '../../domain/warehouse.js';
import { addQty, setQty, clearOrder, orderTotals, sendOrder, proposeRestock, supplierNoteOf, setSupplierNote, clearSupplierNote, lastDeliveryPoint, rememberDeliveryPoint } from '../../domain/orders.js';
import { generateOrderPdfs } from '../../domain/orderpdf.js';
import { can } from '../../state/auth.js';
import { go, consumeViewEntry } from '../app.js';

const fmtBadge = f => f ? `<span class="badge soft" style="font-size:10px">${esc(f)}</span>` : '';

// Stato scorta sul TOTALE tra i magazzini (stessa semantica di Magazzino/Dashboard):
// out = esaurito · low = sotto la soglia minima · ok = a posto.
const stockStatus = p => { const s = totalStock(p), m = p.minStock || 0; if (s <= 0) return 'out'; if (m > 0 && s <= m) return 'low'; return 'ok'; };
// Indicatore compatto di scorta per la riga prodotto: "scorta N[/min]" colorato + icona.
function stockInfo(p) {
  const st = stockStatus(p);
  const col = st === 'out' ? 'var(--red,#c2685f)' : st === 'low' ? 'var(--orange,#b08a4e)' : 'var(--green,#6b8f80)';
  const min = (p.minStock || 0) > 0 ? `<span style="opacity:.6">/${p.minStock}</span>` : '';
  const icon = st === 'low' ? ' ⚠️' : st === 'out' ? ' ⛔' : '';
  return `<span class="tnum" style="font-weight:700;color:${col}">· scorta ${totalStock(p)}${min}${icon}</span>`;
}

// Stato dei filtri della schermata Ordine: SOLO in memoria di vista (non persistito).
const FILT = { q: '', supplierId: '', categoryId: '', lowOnly: false };
const filtersActive = () => !!(FILT.q.trim() || FILT.supplierId || FILT.categoryId || FILT.lowOnly);

// applica i filtri (combinati in AND) a una lista di prodotti
function applyFilters(lid, prods) {
  const term = FILT.q.trim().toLowerCase();
  let list = prods;
  if (term) list = list.filter(p => productMatches(p, term));
  if (FILT.supplierId) list = list.filter(p => (p.supplierId || '') === FILT.supplierId);
  if (FILT.categoryId) list = list.filter(p => {
    if (p.typeId === FILT.categoryId) return true;      // prodotto direttamente sulla categoria
    const t = type(lid, p.typeId);
    return !!t && t.parentId === FILT.categoryId;         // oppure su una sua sottocategoria
  });
  if (FILT.lowOnly) list = list.filter(p => stockStatus(p) !== 'ok'); // sotto scorta o esauriti
  return list;
}

// barra filtri client-side: ricerca nome + fornitore + categoria + azzera
function filtersBar(lid) {
  const sups = suppliersOf(lid);
  const cats = topTypes(lid);
  return `<div class="card" style="margin-bottom:12px;padding:12px 14px">
    <div class="field" style="margin:0 0 10px"><input id="ord_q" placeholder="Cerca prodotto…" value="${esc(FILT.q)}"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
      <div class="field" style="margin:0"><select id="ord_sup"><option value="">Tutti i fornitori</option>${sups.map(s => `<option value="${esc(s.id)}" ${FILT.supplierId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><select id="ord_cat"><option value="">Tutte le categorie</option>${cats.map(c => `<option value="${esc(c.id)}" ${FILT.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="chip ${FILT.lowOnly ? 'on' : ''}" data-flow>⚠️ Solo sotto scorta</button>
      ${filtersActive() ? `<button class="btn sm" data-fclear>↺ Azzera filtri</button>` : ''}
    </div>
  </div>`;
}

export function render() {
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Ordine</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;
  const lid = activeLocale();
  const prods = productsOf(lid);

  let h = `<div class="pagehead"><h1>Ordine</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;
  if (!prods.length) {
    return h + `<div class="card empty">Nessun prodotto nel Database.<br><span class="muted">Aggiungi prodotti per comporre un ordine.</span>
      <div class="btnrow" style="margin-top:12px;justify-content:center"><button class="btn primary" data-godb>Vai al Database</button></div></div>`;
  }

  h += filtersBar(lid);
  // Proposta d'ordine automatica (Feature 2): riempie l'ordine coi prodotti sotto scorta/esauriti.
  // Con filtri attivi agisce solo sui prodotti visibili ("ciò che vedi"): lo dice anche l'etichetta.
  if (canCompose()) h += `<div class="btnrow" style="margin-bottom:12px"><button class="btn" data-restock>⚡ Riordina sotto scorta${filtersActive() ? ' (filtrati)' : ''}</button></div>`;
  const filtered = applyFilters(lid, prods);

  // raggruppa nell'ordine di visualizzazione: categoria → diretti → sottocategorie → Altro
  const byType = {};
  filtered.forEach(p => { const k = type(lid, p.typeId) ? p.typeId : '__none__'; (byType[k] = byType[k] || []).push(p); });
  const rowsBlock = items => `<div class="list two">${items.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(p => orderRow(lid, p)).join('')}</div>`;

  let body = '';
  topTypes(lid).forEach(c => {
    const direct = byType[c.id] || [];
    const subs = subTypes(lid, c.id).map(s => ({ s, items: byType[s.id] || [] })).filter(b => b.items.length);
    if (!direct.length && !subs.length) return;
    body += `<div class="section-title">${esc(c.name)}</div>`;
    if (direct.length) body += rowsBlock(direct);
    subs.forEach(b => { body += `<div class="section-title" style="opacity:.75;font-size:12px">${esc(b.s.name)}</div>` + rowsBlock(b.items); });
  });
  const none = byType['__none__'] || [];
  if (none.length) { body += `<div class="section-title">Altro</div>` + rowsBlock(none); }

  if (!body) body = `<div class="card empty">Nessun prodotto per i filtri selezionati.</div>`;
  h += `<div style="padding-bottom:88px">${body}</div>`;

  // barra fissa in basso: note per fornitore (comporre → ordini.componi) + invio (ordini.invia).
  // Un utente in sola lettura vede le quantità in corso ma non compone/invia. Le due azioni
  // sono particellari: chi ha solo `componi` prepara l'ordine, chi ha `invia` lo genera in PDF.
  const t = orderTotals(lid);
  if (canCompose() || canSend()) {
    h += `<div id="orderbar" style="position:fixed;left:0;right:0;bottom:0;background:var(--card,var(--surface));border-top:1px solid var(--line);padding:10px 14px calc(10px + env(safe-area-inset-bottom,0));z-index:20;max-width:900px;margin:0 auto">
      ${canCompose() ? noteButtonsRow(lid) : ''}
      <div style="display:flex;gap:10px">
        ${canCompose() && t.righe ? `<button class="btn" data-clear>Svuota</button>` : ''}
        ${canSend() ? `<button class="btn primary" style="flex:1" data-gen ${t.righe ? '' : 'disabled'}>${t.righe ? `📄 Genera PDF · ${t.righe} prodotti · ${t.pezzi} pz` : 'Inserisci le quantità'}</button>` : ''}
      </div>
    </div>`;
  }
  return h;
}

const canCompose = () => can('ordini.componi');   // stepper quantità, svuota, nota fornitore
const canSend = () => can('ordini.invia');         // genera PDF + invia a storico

// Fornitori con prodotti attivi nell'ordine in corso (chiave '__none__' = senza fornitore),
// nell'ordine di prima apparizione delle righe.
function activeSuppliers(lid) {
  const seen = new Set(), out = [];
  orderLines(lid).forEach(({ p }) => {
    const key = p.supplierId || '__none__';
    if (!seen.has(key)) { seen.add(key); out.push({ key, name: key === '__none__' ? 'Senza fornitore' : supplierName(p.supplierId) }); }
  });
  return out;
}

// Riga di pulsanti "Nota · <Fornitore>" sopra la barra Genera PDF (evidenziati se la nota è presente).
function noteButtonsRow(lid) {
  const sups = activeSuppliers(lid);
  if (!sups.length) return `<div id="note-btns" style="margin-bottom:8px"></div>`;
  const btns = sups.map(s => {
    const has = supplierNoteOf(lid, s.key === '__none__' ? null : s.key).length > 0;
    return `<button class="btn sm ${has ? 'primary' : ''}" data-note="${esc(s.key)}" style="border-radius:20px">${has ? '📝' : '✏️'} Nota · ${esc(s.name)}</button>`;
  }).join('');
  return `<div id="note-btns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${btns}</div>`;
}

function orderRow(lid, p) {
  const qty = orderQty(lid, p.id);
  // Sola lettura (senza ordini.componi): mostra la quantità in corso senza stepper editabile.
  const control = canCompose()
    ? `<div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
      <button class="btn sm" data-minus="${p.id}">−</button>
      <input class="qtyinp" data-qty="${p.id}" type="number" min="0" inputmode="numeric" value="${qty}" style="width:56px;text-align:center;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--input-bg,var(--surface));color:var(--txt)">
      <button class="btn sm primary" data-plus="${p.id}">+</button>
    </div>`
    : `<div class="amt tnum" style="font-weight:800;flex-shrink:0">${qty}</div>`;
  return `<div class="row ${qty > 0 ? 'sel' : ''}" data-pid="${p.id}">
    <div class="mid"><div class="t1">${esc(p.name)} ${fmtBadge(p.format)}${codeTag(p.code)}</div>
      <div class="t2">${esc(supplierName(p.supplierId))} ${stockInfo(p)}</div></div>
    ${control}
  </div>`;
}

export function bind(root) {
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };

  root.querySelector('[data-godb]')?.addEventListener('click', () => go('db'));

  // Ricerca: debounce (fluida, e robusta con gli scanner che "digitano" veloce) + focus preservato.
  const qi = root.querySelector('#ord_q');
  if (qi) {
    const commitSearch = () => { const pos = qi.selectionStart; rerender(); const n = root.querySelector('#ord_q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } };
    const deb = debounce(commitSearch, 130);
    qi.oninput = () => { FILT.q = qi.value; deb(); };
    // Invio nella ricerca = "spara barcode": match esatto di codice (o risultato unico) → focus quantità.
    qi.onkeydown = e => { if (e.key !== 'Enter') return; e.preventDefault(); FILT.q = qi.value; deb.cancel(); handleScan(); };
  }
  // porta il focus (con testo selezionato) sull'input quantità del prodotto pid, se presente in lista
  const focusQty = pid => {
    const inp = root.querySelector(`.qtyinp[data-qty="${CSS.escape(pid)}"]`);
    if (inp) { inp.focus(); try { inp.select(); } catch {} return true; }
    return false;
  };
  // flusso barcode: dallo scan/Invio in ricerca → prodotto bersaglio → focus sulla sua quantità
  const handleScan = () => {
    rerender();                                   // allinea il DOM alla ricerca corrente
    const scope = productsOf(lid);
    const target = scanTarget(FILT.q, scope, applyFilters(lid, scope));
    if (!target || !canCompose()) { root.querySelector('#ord_q')?.focus(); return; }
    if (!focusQty(target.id)) {
      // bersaglio (codice esatto) nascosto da altri filtri: sganciali mantenendo la ricerca e riprova
      FILT.supplierId = ''; FILT.categoryId = ''; FILT.lowOnly = false;
      rerender();
      if (!focusQty(target.id)) root.querySelector('#ord_q')?.focus();
    }
  };
  root.querySelector('#ord_sup')?.addEventListener('change', e => { FILT.supplierId = e.target.value; rerender(); });
  root.querySelector('#ord_cat')?.addEventListener('change', e => { FILT.categoryId = e.target.value; rerender(); });
  root.querySelector('[data-flow]')?.addEventListener('click', () => { FILT.lowOnly = !FILT.lowOnly; rerender(); });
  root.querySelector('[data-fclear]')?.addEventListener('click', () => { FILT.q = ''; FILT.supplierId = ''; FILT.categoryId = ''; FILT.lowOnly = false; rerender(); });

  if (!canCompose() && !canSend()) return;   // sola lettura: nessun handler di composizione/invio

  // aggiornamento parziale (niente re-render completo a ogni tap)
  const updateRow = pid => {
    const row = root.querySelector(`.row[data-pid="${pid}"]`);
    if (row) {
      const q = orderQty(lid, pid);
      row.classList.toggle('sel', q > 0);
      const inp = row.querySelector('.qtyinp');
      if (inp && document.activeElement !== inp) inp.value = q;
    }
    updateBar();
  };
  const updateBar = () => {
    const t = orderTotals(lid);
    const bar = root.querySelector('#orderbar');
    if (!bar) return;
    const gen = bar.querySelector('[data-gen]');   // presente solo con ordini.invia
    if (gen) {
      gen.disabled = t.righe === 0;
      gen.innerHTML = t.righe ? `📄 Genera PDF · ${t.righe} prodotti · ${t.pezzi} pz` : 'Inserisci le quantità';
    }
    // mostra/nascondi "Svuota" senza rerender completo (solo con ordini.componi)
    if (canCompose()) {
      const actions = bar.querySelector('div[style*="display:flex"]');
      let clr = bar.querySelector('[data-clear]');
      if (t.righe && !clr && actions) { actions.insertAdjacentHTML('afterbegin', `<button class="btn" data-clear>Svuota</button>`); bindClear(); }
      else if (!t.righe && clr) clr.remove();
      // ricostruisci i pulsanti "Nota" (i fornitori attivi possono cambiare a ogni tap)
      const notes = root.querySelector('#note-btns');
      if (notes) { notes.outerHTML = noteButtonsRow(lid); bindNotes(); }
    }
  };
  const bindClear = () => {
    root.querySelector('[data-clear]')?.addEventListener('click', () => {
      confirmDialog('Svuotare l\'ordine?', 'Tutte le quantità inserite verranno azzerate.', 'Svuota', () => { clearOrder(lid); rerender(); }, { danger: true });
    });
  };
  const bindNotes = () => {
    root.querySelectorAll('[data-note]').forEach(b => b.onclick = () => openNoteSheet(lid, b.dataset.note, updateBar));
  };

  if (canCompose()) {
    root.querySelector('[data-restock]')?.addEventListener('click', () => {
      // il riordino agisce su "ciò che vedi": stessa lista visibile (stessi filtri della schermata).
      const active = filtersActive();
      const visible = applyFilters(lid, productsOf(lid));
      const n = proposeRestock(lid, visible);
      if (n) {
        toast(`Aggiunti ${n} prodott${n === 1 ? 'o' : 'i'} alla proposta${active ? ' (filtri attivi)' : ''}`);
      } else {
        // distingui "nessuno sotto scorta nel locale" da "nessuno tra i filtrati"
        const anyLow = productsOf(lid).some(p => stockStatus(p) !== 'ok');
        toast(active && anyLow ? 'Nessun prodotto sotto scorta tra i filtrati' : 'Nessun prodotto sotto scorta');
      }
      rerender();
    });
    root.querySelectorAll('[data-minus]').forEach(b => b.onclick = () => { addQty(lid, b.dataset.minus, -1); updateRow(b.dataset.minus); });
    root.querySelectorAll('[data-plus]').forEach(b => b.onclick = () => { addQty(lid, b.dataset.plus, +1); updateRow(b.dataset.plus); });
    root.querySelectorAll('[data-qty]').forEach(inp => {
      inp.onchange = () => { setQty(lid, inp.dataset.qty, inp.value); updateRow(inp.dataset.qty); };
      // Invio dopo la quantità: conferma e torna alla ricerca AZZERATA, pronta per lo scan successivo.
      inp.onkeydown = e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        setQty(lid, inp.dataset.qty, inp.value);
        FILT.q = '';
        rerender();
        root.querySelector('#ord_q')?.focus();
      };
    });
    bindClear();
    bindNotes();
  }

  if (canSend()) root.querySelector('[data-gen]')?.addEventListener('click', () => startGenerate(lid, rerender));

  // Autofocus della ricerca all'INGRESSO vista (solo desktop; su touch resterebbe la tastiera aperta).
  if (consumeViewEntry()) gentleAutofocus(root.querySelector('#ord_q'));
}

// Editor della nota "permanente" di un fornitore (chiave '__none__' = senza fornitore).
// Salva/elimina la nota; poi aggiorna solo i pulsanti (niente re-render globale).
function openNoteSheet(lid, key, refresh) {
  const supplierId = key === '__none__' ? null : key;
  const name = key === '__none__' ? 'Senza fornitore' : supplierName(supplierId);
  const val = supplierNoteOf(lid, supplierId);
  openSheet(`
    <h2>📝 Nota · ${esc(name)}</h2>
    <div class="sheetsub">Appare in evidenza sul PDF di questo fornitore. Resta salvata per i prossimi ordini.</div>
    <div class="field"><textarea id="sn_txt" rows="5" style="resize:none;line-height:1.5" placeholder="Scrivi qui la nota per ${esc(name)}…">${esc(val)}</textarea></div>
    <div class="actions">
      <button class="btn" data-cancel>Annulla</button>
      ${val ? `<button class="btn danger" data-del>🗑 Elimina</button>` : ''}
      <button class="btn primary" data-ok>Salva nota</button>
    </div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-del]')?.addEventListener('click', () => {
        clearSupplierNote(lid, supplierId); closeSheet(); toast('Nota rimossa'); refresh();
      });
      sheet.querySelector('[data-ok]').onclick = () => {
        const v = sheet.querySelector('#sn_txt').value;
        setSupplierNote(lid, supplierId, v); closeSheet();
        toast(v.trim() ? 'Nota salvata ✓' : 'Nota rimossa'); refresh();
      };
      setTimeout(() => { const f = sheet.querySelector('#sn_txt'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 120);
    });
}

// Sheet di invio: punto di consegna (se più d'uno) + spunta "Carico da ordini", poi genera.
// La spunta è ATTIVA di default e vale solo per QUESTO invio (compresi i riordini): se disattivata
// l'ordine non passerà da "📥 Carico da ordini" in Magazzino (utile per prodotti senza scorte).
// Il punto di consegna viene preselezionato: unico → quello; più d'uno → l'ULTIMO usato (badge "ultimo").
function startGenerate(lid, rerender) {
  const dps = deliveryPointsOf(lid);
  const lastId = lastDeliveryPoint(lid);
  // preselezione punto di consegna in base a quelli disponibili e all'ultimo usato
  let selDp = dps.length === 1 ? dps[0].id
    : (dps.length > 1 && dps.some(d => d.id === lastId)) ? lastId : null;
  // con più punti: elenco selezionabile (ultimo usato in cima) + riga "Senza punto"
  const ordered = lastId ? [...dps].sort((a, b) => (a.id === lastId ? -1 : 0) - (b.id === lastId ? -1 : 0)) : dps;
  const rowBg = id => (id || null) === selDp ? ' style="background:var(--accent-soft)"' : '';
  const dpBlock = dps.length > 1 ? `
    <div class="section-title" style="margin-top:0">📍 Punto di consegna</div>
    <div class="list">${ordered.map(d => `<div class="row click" data-dp="${d.id}"${rowBg(d.id)}><div class="emoji">📍</div>
      <div class="mid"><div class="t1">${esc(d.name)}${d.id === lastId ? ' <span class="badge soft" style="font-size:10px">ultimo</span>' : ''}</div>${d.address ? `<div class="t2">${esc(d.address)}</div>` : ''}</div></div>`).join('')}
      <div class="row click" data-dp=""${rowBg('')}><div class="emoji">✖️</div><div class="mid"><div class="t1">Senza punto</div></div></div></div>` : '';
  openSheet(`
    <h2>📤 Invia ordine</h2>
    <div class="sheetsub">L'ordine viene salvato nello storico e vengono generati i PDF per i fornitori.</div>
    ${dpBlock}
    <label class="row click" style="align-items:flex-start;margin-top:14px;cursor:pointer">
      <input type="checkbox" id="gen_stock" checked style="margin:3px 4px 0 0;flex-shrink:0">
      <div class="mid"><div class="t1">Carica in magazzino alla consegna <span class="muted" style="font-weight:500">(Carico da ordini)</span></div>
        <div class="t2">Disattiva se i prodotti di quest'ordine non hanno conteggio in magazzino.</div></div>
    </label>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>📤 Invia ordine</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      // selezione punto: evidenzia la riga scelta e memorizza selDp
      sheet.querySelectorAll('[data-dp]').forEach(el => el.onclick = () => {
        selDp = el.dataset.dp || null;
        sheet.querySelectorAll('[data-dp]').forEach(r => r.style.background = (r.dataset.dp || null) === selDp ? 'var(--accent-soft)' : '');
      });
      sheet.querySelector('[data-ok]').onclick = () => {
        const stockLoad = sheet.querySelector('#gen_stock').checked;
        rememberDeliveryPoint(lid, selDp);
        closeSheet();
        generate(lid, selDp, stockLoad, rerender);
      };
    });
}

// Invia l'ordine (→ storico), poi genera i PDF SEPARATI (uno per fornitore) e mostra la modale
// di download: ogni file è pronto da inviare al rispettivo fornitore.
function generate(lid, dpId, stockLoad, rerender) {
  const l = activeLocaleObj();
  const order = sendOrder(lid, { deliveryPointId: dpId, stockLoad });
  if (!order) { toast('Nessun prodotto nell\'ordine'); return; }
  const dp = dpId ? deliveryPointsOf(lid).find(d => d.id === dpId) : null;
  rerender();
  const pdfs = generateOrderPdfs(l, order, dp);
  toast(pdfs.length === 1 ? 'Ordine salvato ✓ — 1 PDF pronto' : `Ordine salvato ✓ — ${pdfs.length} PDF pronti`);
  showPdfDownloadSheet(pdfs, dp);
}
