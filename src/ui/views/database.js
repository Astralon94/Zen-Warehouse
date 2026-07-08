// ============ Vista Database: prodotti, categorie, fornitori, punti di consegna ============
import { data, save } from '../../state/store.js';
import { esc } from '../../domain/util.js';
import { FORMATS } from '../../state/model.js';
import { openSheet, closeSheet, toast, confirmDialog } from '../dom.js';
import {
  activeLocale, activeLocaleObj, productsOf, suppliersOf, supplierName,
  topTypes, subTypes, hasSubtypes, type, typeName, deliveryPointsOf, totalStock,
} from '../../domain/warehouse.js';
import {
  addProduct, updateProduct, deleteProduct, duplicateProduct, reorderProducts,
  addType, updateType, deleteType, moveType,
  addSupplier, updateSupplier, deleteSupplier, reorderSuppliers,
  addDeliveryPoint, updateDeliveryPoint, deleteDeliveryPoint, reorderDeliveryPoints,
} from '../../domain/catalog.js';
import { makeSortable } from '../sortable.js';

const HANDLE = '<span class="drag-handle" title="Trascina per riordinare" draggable="false">⋮⋮</span>';

let tab = 'prodotti';        // prodotti | categorie | fornitori | consegne
let q = '';                  // ricerca prodotti
let catFilter = 'all';       // 'all' | typeId | '__none__'
let selMode = false;         // modalità selezione multipla (Prodotti) — disattiva il drag-drop
const selected = new Set();  // id dei prodotti selezionati per la modifica massiva

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const fmtBadge = f => f ? `<span class="badge soft" style="font-size:10px">${esc(f)}</span>` : '';

export function render() {
  const l = activeLocaleObj();
  if (!l) return `<div class="pagehead"><h1>Database</h1></div><div class="card"><div class="empty">Crea un locale dalle Impostazioni.</div></div>`;

  const seg = (v, label, n) => `<button class="chip ${tab === v ? 'on' : ''}" data-tab="${v}">${label}${n ? ' · ' + n : ''}</button>`;
  const lid = activeLocale();

  let h = `<div class="pagehead"><h1>Database</h1><span class="sub">${esc((l.emoji || '📦') + ' ' + l.name)}</span></div>`;
  h += `<div class="chips" style="margin-bottom:14px">
    ${seg('prodotti', 'Prodotti', productsOf(lid).length)}
    ${seg('categorie', 'Categorie', topTypes(lid).length)}
    ${seg('fornitori', 'Fornitori', suppliersOf(lid).length)}
    ${seg('consegne', 'Consegne', deliveryPointsOf(lid).length)}
  </div>`;

  if (tab === 'prodotti') h += prodottiBody(lid);
  else if (tab === 'categorie') h += categorieBody(lid);
  else if (tab === 'fornitori') h += fornitoriBody(lid);
  else h += consegneBody(lid);
  return h;
}

// ---------- PRODOTTI ----------
// prodotti visibili = ricerca (nome/fornitore) + filtro categoria attivi. Usato dalla vista e da "Seleziona tutti".
function filteredProducts(lid) {
  const term = q.trim().toLowerCase();
  let list = productsOf(lid);
  if (term) list = list.filter(p => p.name.toLowerCase().includes(term) || supplierName(p.supplierId).toLowerCase().includes(term));
  return list.filter(p => {
    if (catFilter === 'all') return true;
    if (catFilter === '__none__') return !type(lid, p.typeId);
    const t = type(lid, p.typeId);
    if (!t) return false;
    return p.typeId === catFilter || t.parentId === catFilter;
  });
}

function prodottiBody(lid) {
  const all = productsOf(lid);
  const term = q.trim().toLowerCase();

  // chip filtro categoria
  const cats = topTypes(lid);
  const noneCount = all.filter(p => !type(lid, p.typeId)).length;
  const chip = (v, label, n) => `<button class="chip ${catFilter === v ? 'on' : ''}" data-cat="${v}">${esc(label)}${n != null ? ' · ' + n : ''}</button>`;
  let h = `<div class="field"><input id="dbq" placeholder="Cerca prodotto o fornitore…" value="${esc(q)}"></div>`;
  h += `<div class="chips" style="margin-bottom:12px">${chip('all', 'Tutti', all.length)}${cats.map(c => chip(c.id, c.name)).join('')}${noneCount ? chip('__none__', 'Senza categoria', noneCount) : ''}</div>`;
  h += `<div class="btnrow" style="margin-bottom:12px">
    <button class="btn primary" data-addprod>+ Prodotto</button>
    ${all.length ? `<button class="btn${selMode ? ' primary' : ''}" data-selmode>${selMode ? '✓ Fine selezione' : '☑ Seleziona'}</button>` : ''}
  </div>`;

  const list = filteredProducts(lid);

  // barra della selezione multipla (mostrata in modalità selezione, anche se il filtro non mostra nulla)
  if (selMode) {
    const visN = list.length;
    const visSel = list.filter(p => selected.has(p.id)).length;
    const allOn = visN > 0 && visSel === visN;
    const total = selected.size;
    h += `<div class="card" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:11px 14px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;margin:0">
        <input type="checkbox" class="selchk" data-selall ${allOn ? 'checked' : ''}> Seleziona tutti${visN ? ` (${visN})` : ''}
      </label>
      <span class="muted" style="font-size:13px">${total} selezionat${total === 1 ? 'o' : 'i'}</span>
      <span class="grow"></span>
      <button class="btn sm" data-selclear ${total ? '' : 'disabled'}>Deseleziona</button>
      <button class="btn sm primary" data-bulkedit ${total ? '' : 'disabled'}>✎ Modifica selezionati…</button>
    </div>`;
  }

  if (!list.length) return h + `<div class="card empty">Nessun prodotto${term ? ' per "' + esc(q) + '"' : ''}.</div>`;

  // raggruppa per tipologia
  const byType = {};
  list.forEach(p => { const k = type(lid, p.typeId) ? p.typeId : '__none__'; (byType[k] = byType[k] || []).push(p); });

  // in modalità selezione niente drag-drop: la lista non è "sortprod"
  const cardOf = items => `<div class="list${selMode ? '' : ' sortprod'}">${items.slice().sort(byOrder).map(p => productRow(lid, p)).join('')}</div>`;
  const section = (title, muted, items) => items.length ? `<div class="section-title" ${muted ? 'style="color:var(--muted)"' : ''}>${esc(title)}</div>${cardOf(items)}` : '';

  const out = [];
  if (catFilter === 'all') {
    cats.forEach(c => {
      let inner = section(c.name, false, byType[c.id] || []);
      subTypes(lid, c.id).forEach(s => { inner += section(c.name + ' › ' + s.name, false, byType[s.id] || []); });
      if (inner) out.push(inner);
    });
    const none = byType['__none__'] || [];
    if (none.length) out.push(section('Senza categoria', true, none));
  } else if (catFilter === '__none__') {
    out.push(cardOf(byType['__none__'] || []));
  } else {
    const c = type(lid, catFilter);
    out.push(section(c ? c.name : '', false, byType[catFilter] || []));
    subTypes(lid, catFilter).forEach(s => { out.push(section((c?.name || '') + ' › ' + s.name, false, byType[s.id] || [])); });
  }
  return h + (out.filter(Boolean).join('') || `<div class="card empty">Nessun prodotto in questa categoria.</div>`);
}

function productRow(lid, p) {
  const tot = totalStock(p);
  const low = (p.minStock || 0) > 0 && tot <= (p.minStock || 0);
  const stockInfo = (p.minStock || 0) > 0 || tot > 0
    ? `<span style="font-size:11px;color:${low ? 'var(--red,#c2685f)' : 'var(--muted)'}">· scorta ${tot}${p.minStock ? '/' + p.minStock : ''}${low ? ' ⚠️' : ''}</span>` : '';
  const mid = `<div class="mid"><div class="t1">${esc(p.name)} ${fmtBadge(p.format)}</div>
      <div class="t2">${esc(supplierName(p.supplierId))}${p.notes ? ' · ' + esc(p.notes) : ''} ${stockInfo}</div></div>`;
  // riga in modalità selezione: checkbox al posto del drag handle, senza pulsanti d'azione
  if (selMode) {
    const on = selected.has(p.id);
    return `<div class="row selrow${on ? ' on' : ''}" data-selrow="${p.id}">
      <input type="checkbox" class="selchk" data-selchk="${p.id}" ${on ? 'checked' : ''} aria-label="Seleziona ${esc(p.name)}">
      ${mid}
    </div>`;
  }
  return `<div class="row" data-sortid="${p.id}">
    ${HANDLE}
    ${mid}
    <div style="display:flex;gap:3px;flex-shrink:0" draggable="false">
      <button class="btn sm" data-dup="${p.id}">⎘</button>
      <button class="btn sm" data-edit="${p.id}">✏️</button>
      <button class="btn sm danger" data-del="${p.id}">🗑</button>
    </div>
  </div>`;
}

// modal prodotto. prefill (solo per nuovo) = {format,typeId,supplierId} per "aggiungi e continua"
function productModal(lid, id, prefill) {
  const p = id ? data.products.find(x => x.id === id) : null;
  const src = p || prefill || {};
  const t0 = src.typeId ? type(lid, src.typeId) : null;
  let catId = null, subId = null;
  if (t0) { if (t0.parentId) { catId = t0.parentId; subId = t0.id; } else { catId = t0.id; } }

  const fmtOpts = `<option value="">—</option>` + FORMATS.map(f => `<option value="${f}" ${src.format === f ? 'selected' : ''}>${f}</option>`).join('');
  const catOpts = `<option value="">— Nessuna —</option>` + topTypes(lid).map(c => `<option value="${c.id}" ${catId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const suppOpts = `<option value="">— Nessuno —</option>` + suppliersOf(lid).map(s => `<option value="${s.id}" ${src.supplierId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const isNew = !id;

  openSheet(`
    <h2>${p ? 'Modifica' : 'Nuovo'} prodotto</h2>
    <div class="field"><label>Nome *</label><input id="p_name" value="${esc(p?.name || '')}" placeholder="Es. Acqua Minerale 1,5L"></div>
    <div class="frow">
      <div class="field"><label>Formato</label><select id="p_fmt">${fmtOpts}</select></div>
      <div class="field"><label>Categoria</label><select id="p_cat">${catOpts}</select></div>
    </div>
    <div id="p_subslot">${subcatField(lid, catId, subId)}</div>
    <div class="field"><label>Fornitore</label><select id="p_sup">${suppOpts}</select></div>
    <div class="field"><label>Soglia minima</label><input id="p_min" inputmode="numeric" value="${p?.minStock ?? ''}" placeholder="0">
      <div class="muted" style="font-size:12px;margin-top:4px">Avviso sotto scorta sul totale tra i magazzini. La giacenza si gestisce in Magazzino.</div></div>
    <div class="field"><label>Note</label><input id="p_notes" value="${esc(p?.notes || '')}" placeholder="Note opzionali…"></div>
    <div class="actions">
      <button class="btn" data-cancel>Annulla</button>
      ${isNew ? `<button class="btn" data-add>Aggiungi e continua</button><button class="btn primary" data-addclose>Aggiungi</button>`
              : `<button class="btn primary" data-save>Salva</button>`}
    </div>`,
    sheet => {
      const g = s => sheet.querySelector(s);
      g('#p_cat').onchange = () => { g('#p_subslot').innerHTML = subcatField(lid, g('#p_cat').value || null, null); };
      const collect = () => {
        const name = g('#p_name').value.trim();
        if (!name) { toast('Il nome è obbligatorio'); return null; }
        const catV = g('#p_cat').value || null;
        const subEl = g('#p_subcat');
        const subV = subEl ? (subEl.value || null) : null;
        return {
          name, format: g('#p_fmt').value, typeId: subV || catV || null,
          supplierId: g('#p_sup').value || null, notes: g('#p_notes').value.trim(),
          minStock: parseInt(g('#p_min').value, 10) || 0,
        };
      };
      g('[data-cancel]').onclick = closeSheet;
      g('[data-save]')?.addEventListener('click', () => { const r = collect(); if (!r) return; updateProduct(id, r); closeSheet(); toast('Prodotto aggiornato ✓'); });
      g('[data-addclose]')?.addEventListener('click', () => { const r = collect(); if (!r) return; addProduct(lid, r); closeSheet(); toast('Prodotto aggiunto ✓'); });
      g('[data-add]')?.addEventListener('click', () => {
        const r = collect(); if (!r) return;
        addProduct(lid, r);
        // riapre con formato/categoria/fornitore mantenuti (inserimento a raffica)
        productModal(lid, null, { format: r.format, typeId: r.typeId, supplierId: r.supplierId });
        toast('Aggiunto ✓ — inserisci il prossimo');
        setTimeout(() => document.getElementById('p_name')?.focus(), 60);
      });
      // Invio in un campo di testo = come il pulsante primario (come Zen-Orders):
      // nuovo → "Aggiungi e continua" (salva e riparte); modifica → "Salva". I <select> mantengono
      // il comportamento nativo dell'Invio; qui non ci sono textarea (Note è un input).
      sheet.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        (isNew ? g('[data-add]') : g('[data-save]'))?.click();
      }));
      setTimeout(() => g('#p_name')?.focus(), 60);
    });
}
function subcatField(lid, catId, subId) {
  const subs = catId ? subTypes(lid, catId) : [];
  if (!subs.length) return '';
  const opts = `<option value="">— Nessuna —</option>` + subs.map(s => `<option value="${s.id}" ${subId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  return `<div class="field"><label>Sottocategoria</label><select id="p_subcat">${opts}</select></div>`;
}

// ---------- MODIFICA MASSIVA ----------
// Applica gli stessi campi a più prodotti. Ogni campo ha "— non modificare —" (default): lasciato così
// NON tocca i prodotti; solo i campi impostati vengono applicati. Dove ha senso è previsto "svuota"
// (togliere formato/categoria/fornitore). Campi: formato, categoria(+sottocategoria), fornitore, soglia minima.
const BULK_KEEP = '__keep__', BULK_CLEAR = '__clear__';
function bulkSubcatField(lid, catId) {
  const subs = subTypes(lid, catId);
  if (!subs.length) return '';
  const opts = `<option value="">— tutte / nessuna sottocategoria —</option>` + subs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  return `<div class="field"><label>Sottocategoria</label><select id="b_subcat">${opts}</select></div>`;
}
function bulkEditModal(lid, ids) {
  if (!ids.length) { toast('Nessun prodotto selezionato'); return; }
  const keepClear = (clearLabel) => `<option value="${BULK_KEEP}" selected>— non modificare —</option><option value="${BULK_CLEAR}">${clearLabel}</option>`;
  const fmtOpts = keepClear('— Nessuno (svuota) —') + FORMATS.map(f => `<option value="${f}">${f}</option>`).join('');
  const catOpts = keepClear('— Nessuna (svuota) —') + topTypes(lid).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const supOpts = keepClear('— Nessuno (svuota) —') + suppliersOf(lid).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

  openSheet(`
    <h2>Modifica ${ids.length} prodott${ids.length === 1 ? 'o' : 'i'}</h2>
    <div class="sheetsub">Solo i campi diversi da "— non modificare —" vengono applicati a tutti i selezionati.</div>
    <div class="frow">
      <div class="field"><label>Formato</label><select id="b_fmt">${fmtOpts}</select></div>
      <div class="field"><label>Categoria</label><select id="b_cat">${catOpts}</select></div>
    </div>
    <div id="b_subslot"></div>
    <div class="field"><label>Fornitore</label><select id="b_sup">${supOpts}</select></div>
    <div class="field">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="b_minchk" class="selchk"> Imposta soglia minima</label>
      <input id="b_min" inputmode="numeric" placeholder="0" disabled style="margin-top:6px">
    </div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Applica</button></div>`,
    sheet => {
      const g = s => sheet.querySelector(s);
      // la sottocategoria compare solo quando si sceglie una categoria reale
      g('#b_cat').onchange = () => {
        const v = g('#b_cat').value;
        g('#b_subslot').innerHTML = (v === BULK_KEEP || v === BULK_CLEAR) ? '' : bulkSubcatField(lid, v);
      };
      const minChk = g('#b_minchk'), minInp = g('#b_min');
      minChk.onchange = () => { minInp.disabled = !minChk.checked; if (minChk.checked) minInp.focus(); };
      g('[data-cancel]').onclick = closeSheet;
      g('[data-ok]').onclick = () => {
        const patch = {};
        const catV = g('#b_cat').value;
        if (catV !== BULK_KEEP) {
          if (catV === BULK_CLEAR) patch.typeId = null;
          else { const subEl = g('#b_subcat'); patch.typeId = (subEl && subEl.value) ? subEl.value : catV; }
        }
        const fmtV = g('#b_fmt').value;
        if (fmtV !== BULK_KEEP) patch.format = fmtV === BULK_CLEAR ? '' : fmtV;
        const supV = g('#b_sup').value;
        if (supV !== BULK_KEEP) patch.supplierId = supV === BULK_CLEAR ? null : supV;
        if (minChk.checked) patch.minStock = parseInt(minInp.value, 10) || 0;

        if (!Object.keys(patch).length) { toast('Nessuna modifica selezionata'); return; }

        // riepilogo leggibile per la conferma
        const parts = [];
        if ('format' in patch) parts.push('formato → ' + (patch.format || 'nessuno'));
        if ('typeId' in patch) parts.push('categoria → ' + (patch.typeId ? typeName(lid, patch.typeId) : 'nessuna'));
        if ('supplierId' in patch) parts.push('fornitore → ' + (patch.supplierId ? supplierName(patch.supplierId) : 'nessuno'));
        if ('minStock' in patch) parts.push('soglia minima → ' + patch.minStock);

        closeSheet();
        confirmDialog(`Applicare a ${ids.length} prodott${ids.length === 1 ? 'o' : 'i'}?`, parts.join(' · '), 'Applica', () => {
          let n = 0;
          ids.forEach(id => { const p = data.products.find(x => x.id === id); if (p) { Object.assign(p, patch); n++; } });
          selected.clear();              // svuota PRIMA di save(): il re-render (via subscribe) mostra la selezione azzerata
          save();                        // un solo changeset granulare (save è debounced) + re-render
          toast(`${n} prodott${n === 1 ? 'o' : 'i'} aggiornat${n === 1 ? 'o' : 'i'} ✓`);
        });
      };
    });
}

// ---------- CATEGORIE ----------
function categorieBody(lid) {
  const cats = topTypes(lid);
  let h = `<div class="btnrow" style="margin-bottom:12px"><button class="btn primary" data-addcat>+ Categoria</button></div>`;
  if (!cats.length) return h + `<div class="card empty">Nessuna categoria. Aggiungine una per organizzare i prodotti.</div>`;
  h += `<div class="list">`;
  cats.forEach(c => {
    h += rowCat(c, cats.length, false);
    subTypes(lid, c.id).forEach((s, i, arr) => { h += rowCat(s, arr.length, true); });
  });
  h += `</div>`;
  return h;
}
function rowCat(t, groupSize, isSub) {
  return `<div class="row" ${isSub ? 'style="padding-left:22px"' : ''}>
    <div class="emoji">${isSub ? '↳' : '🏷'}</div>
    <div class="mid"><div class="t1">${esc(t.name)}</div></div>
    <div style="display:flex;gap:3px;flex-shrink:0">
      ${!isSub ? `<button class="btn sm" data-addsub="${t.id}">+ sott.</button>` : ''}
      <button class="btn sm" data-catup="${t.id}" ${groupSize < 2 ? 'disabled' : ''}>↑</button>
      <button class="btn sm" data-catdown="${t.id}" ${groupSize < 2 ? 'disabled' : ''}>↓</button>
      <button class="btn sm" data-catedit="${t.id}">✏️</button>
      <button class="btn sm danger" data-catdel="${t.id}">🗑</button>
    </div>
  </div>`;
}
function typeModal(lid, id, presetParent) {
  const t = id ? type(lid, id) : null;
  const childCount = t ? topTypes(lid).length && subTypes(lid, t.id).length : 0;
  const curParent = t ? (t.parentId || '') : (presetParent || '');
  const parentOpts = `<option value="">— Nessuna (categoria principale) —</option>` +
    topTypes(lid).filter(c => !t || c.id !== t.id).map(c => `<option value="${c.id}" ${curParent === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const lockParent = childCount > 0;
  const title = t ? 'Modifica categoria' : (presetParent ? 'Nuova sottocategoria' : 'Nuova categoria');
  openSheet(`
    <h2>${title}</h2>
    <div class="field"><label>Nome *</label><input id="t_name" value="${esc(t?.name || '')}" placeholder="Es. Bevande, Vini, Carne…"></div>
    ${lockParent
      ? `<div class="muted" style="font-size:12px">Questa categoria ha sottocategorie, quindi resta principale.</div>`
      : `<div class="field"><label>Categoria padre</label><select id="t_parent">${parentOpts}</select>
         <div class="muted" style="font-size:12px;margin-top:4px">Scegli un padre per creare una sottocategoria (es. Vini › Rossi).</div></div>`}
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>${t ? 'Salva' : 'Aggiungi'}</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-ok]').onclick = () => {
        const name = sheet.querySelector('#t_name').value.trim();
        if (!name) { toast('Il nome è obbligatorio'); return; }
        const pEl = sheet.querySelector('#t_parent');
        const parentId = pEl ? (pEl.value || null) : (t ? t.parentId : (presetParent || null));
        if (id) updateType(lid, id, { name, parentId });
        else addType(lid, { name, parentId });
        closeSheet(); toast(id ? 'Categoria aggiornata ✓' : 'Categoria aggiunta ✓');
      };
      // Invio sul nome = pulsante primario (come Zen-Orders)
      sheet.querySelector('#t_name').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return; e.preventDefault(); sheet.querySelector('[data-ok]').click();
      });
      setTimeout(() => sheet.querySelector('#t_name')?.focus(), 60);
    });
}

// ---------- FORNITORI ----------
function fornitoriBody(lid) {
  const list = suppliersOf(lid);
  let h = `<div class="btnrow" style="margin-bottom:12px"><button class="btn primary" data-addsup>+ Fornitore</button></div>`;
  if (!list.length) return h + `<div class="card empty">Nessun fornitore.</div>`;
  h += `<div class="list sortsup">${list.map(s => `<div class="row" data-sortid="${s.id}">
    ${HANDLE}
    <div class="mid"><div class="t1">🚚 ${esc(s.name)}</div><div class="t2">${[s.phone, s.email].filter(Boolean).map(esc).join(' · ')}${s.note ? ' · ' + esc(s.note) : ''}</div></div>
    <div style="display:flex;gap:3px;flex-shrink:0" draggable="false">
      <button class="btn sm" data-supedit="${s.id}">✏️</button>
      <button class="btn sm danger" data-supdel="${s.id}">🗑</button>
    </div></div>`).join('')}</div>`;
  return h;
}
function supplierModal(lid, id) {
  const s = id ? data.suppliers.find(x => x.id === id) : null;
  openSheet(`
    <h2>${s ? 'Modifica' : 'Nuovo'} fornitore</h2>
    <div class="field"><label>Nome *</label><input id="s_name" value="${esc(s?.name || '')}" placeholder="Es. Distribuzione Rossi Srl"></div>
    <div class="frow">
      <div class="field"><label>Email</label><input id="s_email" value="${esc(s?.email || '')}" placeholder="ordini@…" autocapitalize="off"></div>
      <div class="field"><label>Telefono</label><input id="s_phone" value="${esc(s?.phone || '')}" placeholder="+39…"></div>
    </div>
    <div class="field"><label>Note</label><input id="s_note" value="${esc(s?.note || '')}" placeholder="Note opzionali…"></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>${s ? 'Salva' : 'Aggiungi'}</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-ok]').onclick = () => {
        const name = sheet.querySelector('#s_name').value.trim();
        if (!name) { toast('Il nome è obbligatorio'); return; }
        const rec = { name, email: sheet.querySelector('#s_email').value.trim(), phone: sheet.querySelector('#s_phone').value.trim(), note: sheet.querySelector('#s_note').value.trim() };
        if (id) updateSupplier(id, rec); else addSupplier(lid, rec);
        closeSheet(); toast(id ? 'Fornitore aggiornato ✓' : 'Fornitore aggiunto ✓');
      };
    });
}

// ---------- PUNTI DI CONSEGNA ----------
function consegneBody(lid) {
  const list = deliveryPointsOf(lid);
  let h = `<div class="btnrow" style="margin-bottom:12px"><button class="btn primary" data-adddp>+ Punto di consegna</button></div>`;
  if (!list.length) return h + `<div class="card empty">Nessun punto di consegna.</div>`;
  h += `<div class="list sortdp">${list.map(d => `<div class="row" data-sortid="${d.id}">
    ${HANDLE}
    <div class="mid"><div class="t1">📍 ${esc(d.name)}</div><div class="t2">${[d.address, d.contact, d.phone].filter(Boolean).map(esc).join(' · ')}${d.note ? ' · ' + esc(d.note) : ''}</div></div>
    <div style="display:flex;gap:3px;flex-shrink:0" draggable="false">
      <button class="btn sm" data-dpedit="${d.id}">✏️</button>
      <button class="btn sm danger" data-dpdel="${d.id}">🗑</button>
    </div></div>`).join('')}</div>`;
  return h;
}
function deliveryPointModal(lid, id) {
  const d = id ? (deliveryPointsOf(lid).find(x => x.id === id)) : null;
  openSheet(`
    <h2>${d ? 'Modifica' : 'Nuovo'} punto di consegna</h2>
    <div class="field"><label>Nome *</label><input id="d_name" value="${esc(d?.name || '')}" placeholder="Es. Cucina, Magazzino, Bar"></div>
    <div class="field"><label>Indirizzo</label><input id="d_addr" value="${esc(d?.address || '')}" placeholder="Via, civico, CAP, città"></div>
    <div class="frow">
      <div class="field"><label>Referente</label><input id="d_ref" value="${esc(d?.contact || '')}" placeholder="Nome referente"></div>
      <div class="field"><label>Telefono</label><input id="d_phone" value="${esc(d?.phone || '')}" placeholder="+39…"></div>
    </div>
    <div class="field"><label>Note consegna</label><input id="d_note" value="${esc(d?.note || '')}" placeholder="Orari, citofono, indicazioni…"></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>${d ? 'Salva' : 'Aggiungi'}</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-ok]').onclick = () => {
        const name = sheet.querySelector('#d_name').value.trim();
        if (!name) { toast('Il nome è obbligatorio'); return; }
        const rec = { name, address: sheet.querySelector('#d_addr').value.trim(), contact: sheet.querySelector('#d_ref').value.trim(), phone: sheet.querySelector('#d_phone').value.trim(), note: sheet.querySelector('#d_note').value.trim() };
        if (id) updateDeliveryPoint(lid, id, rec); else addDeliveryPoint(lid, rec);
        closeSheet(); toast(id ? 'Punto aggiornato ✓' : 'Punto aggiunto ✓');
      };
    });
}

// ---------- bind ----------
export function bind(root) {
  const lid = activeLocale();
  const rerender = () => { root.innerHTML = render(); bind(root); };

  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; rerender(); });

  // Prodotti
  const qi = root.querySelector('#dbq');
  if (qi) qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; rerender(); const n = root.querySelector('#dbq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  root.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { catFilter = b.dataset.cat; rerender(); });
  root.querySelector('[data-addprod]')?.addEventListener('click', () => productModal(lid, null, null));
  root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => productModal(lid, b.dataset.edit, null));
  root.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => { duplicateProduct(b.dataset.dup); toast('Duplicato ✓'); rerender(); });
  root.querySelectorAll('.sortprod').forEach(el => makeSortable(el, ids => reorderProducts(ids)));
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const p = data.products.find(x => x.id === b.dataset.del);
    confirmDialog('Eliminare il prodotto?', p?.name || '', 'Elimina', () => { deleteProduct(b.dataset.del); toast('Prodotto eliminato'); rerender(); }, { danger: true });
  });

  // Prodotti — selezione multipla / modifica massiva
  root.querySelector('[data-selmode]')?.addEventListener('click', () => { selMode = !selMode; if (!selMode) selected.clear(); rerender(); });
  root.querySelector('[data-selall]')?.addEventListener('change', e => {
    const vis = filteredProducts(lid).map(p => p.id);
    if (e.target.checked) vis.forEach(id => selected.add(id)); else vis.forEach(id => selected.delete(id));
    rerender();
  });
  root.querySelector('[data-selclear]')?.addEventListener('click', () => { selected.clear(); rerender(); });
  root.querySelectorAll('[data-selchk]').forEach(chk => chk.addEventListener('change', e => {
    e.stopPropagation();
    const id = chk.dataset.selchk;
    if (chk.checked) selected.add(id); else selected.delete(id);
    rerender();
  }));
  root.querySelectorAll('[data-selrow]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('input')) return; // il click diretto sulla checkbox lo gestisce il change
    const id = el.dataset.selrow;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    rerender();
  }));
  root.querySelector('[data-bulkedit]')?.addEventListener('click', () => {
    const ids = [...selected].filter(id => data.products.some(p => p.id === id));
    bulkEditModal(lid, ids);
  });

  // Categorie
  root.querySelector('[data-addcat]')?.addEventListener('click', () => typeModal(lid, null, null));
  root.querySelectorAll('[data-addsub]').forEach(b => b.onclick = () => typeModal(lid, null, b.dataset.addsub));
  root.querySelectorAll('[data-catedit]').forEach(b => b.onclick = () => typeModal(lid, b.dataset.catedit, null));
  root.querySelectorAll('[data-catup]').forEach(b => b.onclick = () => { moveType(lid, b.dataset.catup, -1); rerender(); });
  root.querySelectorAll('[data-catdown]').forEach(b => b.onclick = () => { moveType(lid, b.dataset.catdown, 1); rerender(); });
  root.querySelectorAll('[data-catdel]').forEach(b => b.onclick = () => {
    const t = type(lid, b.dataset.catdel);
    confirmDialog('Eliminare la categoria?', `${t?.name || ''}${t && !t.parentId ? ' — le sottocategorie diventano principali, i prodotti restano senza categoria.' : ''}`, 'Elimina', () => { deleteType(lid, b.dataset.catdel); toast('Categoria eliminata'); rerender(); }, { danger: true });
  });

  // Fornitori
  root.querySelector('[data-addsup]')?.addEventListener('click', () => supplierModal(lid, null));
  root.querySelectorAll('[data-supedit]').forEach(b => b.onclick = () => supplierModal(lid, b.dataset.supedit));
  root.querySelectorAll('.sortsup').forEach(el => makeSortable(el, ids => reorderSuppliers(ids)));
  root.querySelectorAll('[data-supdel]').forEach(b => b.onclick = () => {
    const s = data.suppliers.find(x => x.id === b.dataset.supdel);
    confirmDialog('Eliminare il fornitore?', `${s?.name || ''} — i prodotti collegati restano senza fornitore.`, 'Elimina', () => { deleteSupplier(b.dataset.supdel); toast('Fornitore eliminato'); rerender(); }, { danger: true });
  });

  // Consegne
  root.querySelector('[data-adddp]')?.addEventListener('click', () => deliveryPointModal(lid, null));
  root.querySelectorAll('[data-dpedit]').forEach(b => b.onclick = () => deliveryPointModal(lid, b.dataset.dpedit));
  root.querySelectorAll('.sortdp').forEach(el => makeSortable(el, ids => reorderDeliveryPoints(lid, ids)));
  root.querySelectorAll('[data-dpdel]').forEach(b => b.onclick = () => {
    const d = deliveryPointsOf(lid).find(x => x.id === b.dataset.dpdel);
    confirmDialog('Eliminare il punto di consegna?', d?.name || '', 'Elimina', () => { deleteDeliveryPoint(lid, b.dataset.dpdel); toast('Punto eliminato'); rerender(); }, { danger: true });
  });
}
