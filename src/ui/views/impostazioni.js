// ============ Vista Impostazioni (Zen-Warehouse) ============
import { data, save, setTheme, setData, reloadFromServer } from '../../state/store.js';
import { esc, safeFileName } from '../../domain/util.js';
import { openSheet, closeSheet, toast, confirmDialog, downloadText } from '../dom.js';
import { newLocale } from '../../state/model.js';
import { activeLocale } from '../../domain/warehouse.js';

export function render() {
  const theme = (data.settings && data.settings.theme) || 'auto';
  const themeBtn = (v, label) => `<button class="chip ${theme === v ? 'on' : ''}" data-theme="${v}">${label}</button>`;

  let h = `<div class="pagehead"><h1>Impostazioni</h1></div>`;

  // Tema
  h += `<div class="section-title">Tema</div>
    <div class="chips" style="margin-bottom:16px">${themeBtn('auto', 'Auto')}${themeBtn('light', 'Chiaro')}${themeBtn('dark', 'Scuro')}</div>`;

  // Locali
  h += `<div class="section-title">Locali</div><div class="list">`;
  h += data.locali.map(l => `<div class="row">
      <div class="emoji">${esc(l.emoji || '📦')}</div>
      <div class="mid"><div class="t1">${esc(l.name)}${l.id === activeLocale() ? ' <span class="badge">attivo</span>' : ''}</div></div>
      <button class="btn sm" data-ren="${l.id}">Rinomina</button>
      ${data.locali.length > 1 ? `<button class="btn sm danger" data-dell="${l.id}">Elimina</button>` : ''}
    </div>`).join('');
  h += `</div><div class="btnrow" style="margin:10px 0 18px"><button class="btn" data-newloc>+ Nuovo locale</button></div>`;

  // Backup
  h += `<div class="section-title">Backup dati</div>
    <div class="btnrow" style="margin-bottom:6px">
      <button class="btn" data-export>⤓ Esporta JSON</button>
      <button class="btn" data-import>⤒ Importa JSON</button>
      <input type="file" id="impFile" accept="application/json,.json" style="display:none">
    </div>
    <div class="muted" style="font-size:12px;margin-bottom:18px">L'export contiene l'intero database (locali, prodotti, fornitori, ordini, scorte). L'import sostituisce tutto (con backup automatico lato server).</div>`;

  // Zona pericolo
  h += `<div class="section-title">Zona pericolo</div>
    <div class="btnrow"><button class="btn danger" data-reset>Azzera database</button></div>`;

  return h;
}

export function bind(root) {
  root.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => { setTheme(b.dataset.theme); rerender(root); });

  root.querySelector('[data-newloc]').onclick = () => {
    openSheet(`<h2>Nuovo locale</h2>
      <div class="field"><label>Nome</label><input id="loc_name" placeholder="Es. Bar Centrale"></div>
      <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Crea</button></div>`,
      sheet => {
        sheet.querySelector('[data-cancel]').onclick = closeSheet;
        sheet.querySelector('[data-ok]').onclick = () => {
          const name = sheet.querySelector('#loc_name').value.trim();
          if (!name) { toast('Inserisci un nome'); return; }
          const l = newLocale(name);
          data.locali.push(l); data.settings.activeLocale = l.id; save();
          closeSheet(); toast('Locale creato ✓'); rerender(root);
        };
      });
  };

  root.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => {
    const l = data.locali.find(x => x.id === b.dataset.ren); if (!l) return;
    openSheet(`<h2>Rinomina locale</h2>
      <div class="field"><label>Nome</label><input id="loc_name" value="${esc(l.name)}"></div>
      <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-ok>Salva</button></div>`,
      sheet => {
        sheet.querySelector('[data-cancel]').onclick = closeSheet;
        sheet.querySelector('[data-ok]').onclick = () => {
          const name = sheet.querySelector('#loc_name').value.trim();
          if (!name) { toast('Inserisci un nome'); return; }
          l.name = name; save(); closeSheet(); toast('Rinominato ✓'); rerender(root);
        };
      });
  });

  root.querySelectorAll('[data-dell]').forEach(b => b.onclick = () => {
    const l = data.locali.find(x => x.id === b.dataset.dell); if (!l) return;
    confirmDialog('Eliminare il locale?', `"${l.name}" e tutti i suoi prodotti, fornitori, ordini e scorte.`, 'Elimina', () => {
      const id = l.id;
      data.locali = data.locali.filter(x => x.id !== id);
      data.suppliers = data.suppliers.filter(x => x.localeId !== id);
      data.products = data.products.filter(x => x.localeId !== id);
      data.orders = data.orders.filter(x => x.localeId !== id);
      data.stockMoves = data.stockMoves.filter(x => x.localeId !== id);
      if (data.settings.activeLocale === id) data.settings.activeLocale = data.locali[0]?.id || null;
      save(); toast('Locale eliminato'); rerender(root);
    }, { danger: true });
  });

  // Export: chiede l'intero stato al server (completo).
  root.querySelector('[data-export]').onclick = async () => {
    let payload;
    try { const res = await fetch('/api/data?full=1'); payload = res.ok ? await res.text() : null; } catch (e) { payload = null; }
    if (payload == null) payload = JSON.stringify(data);
    const d = new Date().toISOString().slice(0, 10);
    downloadText(`zen-warehouse-backup-${safeFileName(d)}.json`, payload);
    toast('Backup esportato ✓');
  };

  const impFile = root.querySelector('#impFile');
  root.querySelector('[data-import]').onclick = () => impFile.click();
  impFile.onchange = () => {
    const f = impFile.files[0]; impFile.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let obj;
      try { obj = JSON.parse(r.result); } catch (e) { toast('File JSON non valido'); return; }
      if (!obj || typeof obj !== 'object' || !Array.isArray(obj.locali)) { toast('Backup non valido (manca "locali")'); return; }
      confirmDialog('Importare questo backup?', 'Sostituisce l\'intero database attuale (viene fatto un backup automatico).', 'Importa', () => {
        setData(obj); toast('Backup importato ✓'); rerender(root);
      }, { danger: true });
    };
    r.onerror = () => toast('Lettura file fallita');
    r.readAsText(f);
  };

  root.querySelector('[data-reset]').onclick = () => {
    confirmDialog('Azzerare il database?', 'Tutti i dati vengono cancellati e si riparte da un locale vuoto. Irreversibile (esporta prima un backup).', 'Azzera tutto', async () => {
      try { await fetch('/api/reset', { method: 'POST' }); } catch (e) {}
      await reloadFromServer(); toast('Database azzerato'); rerender(root);
    }, { danger: true });
  };
}

function rerender(root) { root.innerHTML = render(); bind(root); }
