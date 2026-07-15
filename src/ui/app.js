// ============ Shell applicativa: topbar, spia salvataggio, selettore Store, nav, router ============
import './styles.css';
import { data, save, subscribe, onSaveStatus, saveStatus, reloadFromServer, forceSave } from '../state/store.js';
import { logout, can, canSeeNav, changePassword, user, meta } from '../state/auth.js';
import { openSheet, closeSheet, toast, isDesktop } from './dom.js';
import { esc } from '../domain/util.js';

import * as ordine from './views/ordine.js';
import * as dashboard from './views/dashboard.js';
import * as storico from './views/storico.js';
import * as report from './views/report.js';
import * as magazzino from './views/magazzino.js';
import * as database from './views/database.js';
import * as impostazioni from './views/impostazioni.js';
import * as utenti from './views/utenti.js';

// Registro delle viste: Ordine · Dashboard · Storico · Report · Magazzino · Database · Utenti · Impostazioni.
const VIEWS = {
  ord: { mod: ordine, title: 'Ordine', icon: '🛒' },
  dash: { mod: dashboard, title: 'Dashboard', icon: '📊' },
  stor: { mod: storico, title: 'Storico', icon: '🕘' },
  rep: { mod: report, title: 'Report', icon: '📈' },
  mag: { mod: magazzino, title: 'Magazzino', icon: '🏬' },
  db: { mod: database, title: 'Database', icon: '📦' },
  utenti: { mod: utenti, title: 'Utenti', icon: '👥' },
  set: { mod: impostazioni, title: 'Impostazioni', icon: '⚙' }
};
const ORDER = ['ord', 'dash', 'stor', 'rep', 'mag', 'db', 'utenti', 'set'];

let current = 'ord';
let mql = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const t = (data.settings && data.settings.theme) || 'auto';
  const dark = t === 'dark' || (t === 'auto' && mql.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
mql.addEventListener('change', applyTheme);

export function go(view) { current = view; renderApp(); window.scrollTo(0, 0); }

// ---- Gating della navigazione (multiutenza) ----
// Le voci visibili = quelle di ORDER accessibili all'utente secondo il registro
// `meta.nav`. Se il registro manca (backend in bypass: auth disattivata, meta null)
// mostriamo tutto: in quel caso non c'è multiutenza da far rispettare.
function visibleViews() {
  const nav = meta?.nav;
  if (!nav || !nav.length) return ORDER.slice();
  return ORDER.filter(k => { const n = nav.find(x => x.key === k); return n && canSeeNav(n); });
}
// Reindirizza `current` alla prima voce accessibile se quella corrente non lo è.
// current = null → l'utente non ha alcuna sezione (stato vuoto gentile).
function ensureAccessible() {
  const vis = visibleViews();
  if (!vis.length) { current = null; return; }
  if (!current || !vis.includes(current)) current = vis[0];
}

/* Logo (icona famiglia Zen) */
const ICON = `<svg viewBox="0 0 1024 1024" width="66" height="66" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="92" y="92" width="840" height="840" rx="208" ry="208" fill="#7a6a99"/>
  <rect x="286" y="430" width="150" height="130" rx="14" fill="#ffffff" opacity="0.92"/>
  <g fill="none" stroke="#ffffff" stroke-width="46" stroke-linecap="round" stroke-linejoin="round">
    <rect x="278" y="300" width="468" height="424" rx="52"/>
    <line x1="278" y1="430" x2="746" y2="430"/><line x1="434" y1="430" x2="434" y2="724"/>
    <line x1="590" y1="430" x2="590" y2="724"/><line x1="278" y1="560" x2="746" y2="560"/>
  </g></svg>`;

// Spia di salvataggio: riflette lo stato reale confermato dal server.
function saveBadgeInner() {
  const conf = {
    saved:    { c: '#6b8f80', dot: '●', t: 'Salvato' },
    saving:   { c: '#b08a4e', dot: '◍', t: 'Salvataggio…' },
    error:    { c: '#c2685f', dot: '▲', t: 'Non salvato' },
    conflict: { c: '#c2685f', dot: '⚠', t: 'Conflitto — risolvi' },
  };
  const m = conf[saveStatus()] || conf.saved;
  return `<span style="color:${m.c}">${m.dot} <span class="sb-txt">${m.t}</span></span>`;
}
function refreshSaveBadge() {
  const el = document.getElementById('saveBadge');
  if (el) el.innerHTML = saveBadgeInner();
  if (saveStatus() === 'conflict') showConflictDialog();
}

// Conflitto di concorrenza (409): un'altra scheda/dispositivo ha modificato i dati.
// Non si sovrascrive in silenzio: si chiede all'utente se ricaricare o forzare.
function showConflictDialog() {
  openSheet(`
    <h2>⚠️ Modifiche in un'altra scheda</h2>
    <div class="sheetsub">Il database è stato aggiornato altrove (un'altra scheda o dispositivo) mentre lavoravi qui. Per non sovrascrivere quei dati, il salvataggio è in pausa.</div>
    <div class="list" style="margin:12px 0;gap:8px">
      <div class="muted" style="font-size:13px">🔄 <b>Ricarica</b>: riprende i dati aggiornati dal database. Le modifiche non salvate di <b>questa</b> scheda vengono perse.</div>
      <div class="muted" style="font-size:13px">⤴️ <b>Forza salvataggio</b>: sovrascrive col contenuto di questa scheda (l'altra scheda perde le sue modifiche).</div>
    </div>
    <div class="actions">
      <button class="btn" data-force>Forza salvataggio</button>
      <button class="btn primary" data-reload>Ricarica (consigliato)</button>
    </div>`,
    sheet => {
      sheet.querySelector('[data-reload]').onclick = async () => { const ok = await reloadFromServer(); closeSheet(); toast(ok ? 'Dati ricaricati dal database' : 'Ricarica non riuscita'); };
      sheet.querySelector('[data-force]').onclick = () => { forceSave(); closeSheet(); toast('Salvataggio forzato — l\'altra scheda è stata sovrascritta'); };
    });
}

function localeSelect() {
  const cur = data.settings.activeLocale;
  if (!data.locali.length) return '';
  const opts = data.locali.map(l => `<option value="${l.id}" ${cur === l.id ? 'selected' : ''}>${esc((l.emoji || '📦') + ' ' + l.name)}</option>`);
  return `<select class="selbox" id="localeSel" aria-label="Locale attivo">${opts.join('')}</select>`;
}

function navMenu() {
  const items = visibleViews().map(k => {
    const v = VIEWS[k];
    return `<button data-go="${k}" class="${current === k ? 'on' : ''}"><span class="ic">${v.icon}</span>${esc(v.title)}</button>`;
  }).join('');
  const label = current ? VIEWS[current].title : 'Zen Warehouse';
  return `<div class="navwrap">
    <button class="navbtn" id="navToggle"><span>☰</span><span>${esc(label)}</span></button>
    <div class="navmenu" id="navMenu">${items}</div>
  </div>`;
}

// Menu utente compatto in topbar: nome + ruolo, con Cambia password ed Esci.
function userMenu() {
  const nome = user?.nome || user?.username || 'Utente';
  const ruolo = user ? ((meta?.ruoli && meta.ruoli[user.ruolo]) || (user.ruolo === 'admin' ? 'Amministratore' : 'Operatore')) : '';
  return `<div class="navwrap usermenu" style="margin-left:8px">
    <button class="navbtn" id="userToggle" title="Account"><span class="ic">👤</span><span class="u-name">${esc(nome)}</span><span style="opacity:.6">▾</span></button>
    <div class="navmenu" id="userMenu">
      <div class="muted" style="padding:6px 11px;font-size:12px">${esc(nome)}${ruolo ? ' · ' + esc(ruolo) : ''}</div>
      <button data-chpw><span class="ic">🔑</span>Cambia password</button>
      <button data-logout><span class="ic">⎋</span>Esci</button>
    </div>
  </div>`;
}

// Sheet per il cambio password dell'utente corrente.
function openChangePassword() {
  openSheet(`
    <h2>Cambia password</h2>
    <div class="field"><label>Password attuale</label><input id="cp_old" type="password" autocomplete="current-password"></div>
    <div class="field"><label>Nuova password</label><input id="cp_new" type="password" autocomplete="new-password"></div>
    <div class="field"><label>Ripeti nuova password</label><input id="cp_new2" type="password" autocomplete="new-password"></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-save>Salva</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-save]').onclick = async () => {
        const attuale = sheet.querySelector('#cp_old').value;
        const nuova = sheet.querySelector('#cp_new').value;
        const nuova2 = sheet.querySelector('#cp_new2').value;
        if (!nuova) { toast('Inserisci la nuova password'); return; }
        if (nuova !== nuova2) { toast('Le password non coincidono'); return; }
        const btn = sheet.querySelector('[data-save]'); btn.disabled = true;
        try { await changePassword(attuale, nuova); closeSheet(); toast('Password aggiornata ✓'); }
        catch (e) { toast(e.message || 'Cambio password non riuscito'); btn.disabled = false; }
      };
    });
}

export function renderApp() {
  applyTheme();
  ensureAccessible();   // reindirizza se `current` non è accessibile a questo utente
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="topbar">
      ${navMenu()}
      <span class="brand">Zen Warehouse</span>
      <span class="savebadge" id="saveBadge" title="Stato del salvataggio sul database" style="font-size:12px;font-weight:600;white-space:nowrap;margin-left:10px">${saveBadgeInner()}</span>
      <span class="spacer"></span>
      ${localeSelect()}
      ${userMenu()}
    </div>
    <main><div id="view"></div></main>`;

  const toggle = app.querySelector('#navToggle');
  const menu = app.querySelector('#navMenu');
  toggle.onclick = e => { e.stopPropagation(); menu.classList.toggle('open'); };
  menu.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { menu.classList.remove('open'); go(b.dataset.go); });

  const sel = app.querySelector('#localeSel');
  if (sel) sel.onchange = () => { data.settings.activeLocale = sel.value; save(); };

  // menu utente: cambia password / esci
  const uToggle = app.querySelector('#userToggle');
  const uMenu = app.querySelector('#userMenu');
  if (uToggle && uMenu) {
    uToggle.onclick = e => { e.stopPropagation(); uMenu.classList.toggle('open'); };
    uMenu.querySelector('[data-chpw]')?.addEventListener('click', () => { uMenu.classList.remove('open'); openChangePassword(); });
    uMenu.querySelector('[data-logout]')?.addEventListener('click', async () => { uMenu.classList.remove('open'); await logout(); location.reload(); });
  }

  // spia salvataggio: in conflitto è cliccabile per riaprire la scelta ricarica/forza
  const badge = app.querySelector('#saveBadge');
  if (badge) { badge.style.cursor = 'pointer'; badge.onclick = () => { if (saveStatus() === 'conflict') showConflictDialog(); }; }

  // view (o stato vuoto se l'utente non ha alcuna sezione accessibile)
  const root = app.querySelector('#view');
  if (!current) {
    root.innerHTML = `<div class="card empty" style="margin-top:40px">Nessuna sezione disponibile.<br><span class="muted">Contatta l'amministratore per farti assegnare i permessi.</span></div>`;
    return;
  }
  // Segnala l'INGRESSO reale nella vista (navigazione), distinto dai re-render di stato/ricerca:
  // la vista lo consuma via consumeViewEntry() per l'autofocus "una tantum" all'apertura.
  pendingEntry = current !== renderedView;
  renderedView = current;
  const v = VIEWS[current].mod;
  root.innerHTML = v.render();
  if (v.bind) v.bind(root);
}

// ---- Ingresso vista (per autofocus solo all'apertura, non a ogni re-render) ----
let renderedView = null, pendingEntry = false;
export function consumeViewEntry() { const e = pendingEntry; pendingEntry = false; return e; }

// Scorciatoia da tastiera "/" (solo desktop): focalizza la casella di ricerca della vista corrente.
// Non scatta mentre si digita in un campo, se una sheet è aperta, o su touch.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!isDesktop()) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || '')) return;
    if (a && a.isContentEditable) return;
    if (document.querySelector('.sheet.show')) return;
    const box = document.querySelector('#view input[placeholder^="Cerca"]');
    if (box) { e.preventDefault(); box.focus(); try { box.select(); } catch {} }
  });
}

let booted = false;
export function startUI() {
  if (!booted) { subscribe(() => renderApp()); onSaveStatus(refreshSaveBadge); booted = true; }
  renderApp();
}
