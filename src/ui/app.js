// ============ Shell applicativa: topbar, spia salvataggio, selettore Store, nav, router ============
import './styles.css';
import { data, save, subscribe, onSaveStatus, saveStatus, reloadFromServer, forceSave } from '../state/store.js';
import { openSheet, closeSheet, toast } from './dom.js';
import { esc } from '../domain/util.js';

import * as dashboard from './views/dashboard.js';
import * as database from './views/database.js';
import * as impostazioni from './views/impostazioni.js';

// Fase 2: Database (prodotti, categorie, fornitori, consegne). Ordine + PDF, Storico,
// Report e Scorte arrivano nei passi successivi.
const VIEWS = {
  dash: { mod: dashboard, title: 'Dashboard', icon: '📊' },
  db: { mod: database, title: 'Database', icon: '📦' },
  set: { mod: impostazioni, title: 'Impostazioni', icon: '⚙' }
};
const ORDER = ['dash', 'db', 'set'];

let current = 'dash';
let mql = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const t = (data.settings && data.settings.theme) || 'auto';
  const dark = t === 'dark' || (t === 'auto' && mql.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
mql.addEventListener('change', applyTheme);

export function go(view) { current = view; renderApp(); window.scrollTo(0, 0); }

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
  return `<span style="color:${m.c}">${m.dot} ${m.t}</span>`;
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
  const items = ORDER.map(k => {
    const v = VIEWS[k];
    return `<button data-go="${k}" class="${current === k ? 'on' : ''}"><span class="ic">${v.icon}</span>${esc(v.title)}</button>`;
  }).join('');
  return `<div class="navwrap">
    <button class="navbtn" id="navToggle"><span>☰</span><span>${esc(VIEWS[current].title)}</span></button>
    <div class="navmenu" id="navMenu">${items}</div>
  </div>`;
}

export function renderApp() {
  applyTheme();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="topbar">
      ${navMenu()}
      <span class="brand">Zen Warehouse</span>
      <span class="savebadge" id="saveBadge" title="Stato del salvataggio sul database" style="font-size:12px;font-weight:600;white-space:nowrap;margin-left:10px">${saveBadgeInner()}</span>
      <span class="spacer"></span>
      ${localeSelect()}
    </div>
    <main><div id="view"></div></main>`;

  const toggle = app.querySelector('#navToggle');
  const menu = app.querySelector('#navMenu');
  toggle.onclick = e => { e.stopPropagation(); menu.classList.toggle('open'); };
  menu.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { menu.classList.remove('open'); go(b.dataset.go); });

  const sel = app.querySelector('#localeSel');
  if (sel) sel.onchange = () => { data.settings.activeLocale = sel.value; save(); };

  // spia salvataggio: in conflitto è cliccabile per riaprire la scelta ricarica/forza
  const badge = app.querySelector('#saveBadge');
  if (badge) { badge.style.cursor = 'pointer'; badge.onclick = () => { if (saveStatus() === 'conflict') showConflictDialog(); }; }

  const root = app.querySelector('#view');
  const v = VIEWS[current].mod;
  root.innerHTML = v.render();
  if (v.bind) v.bind(root);
}

let booted = false;
export function startUI() {
  if (!booted) { subscribe(() => renderApp()); onSaveStatus(refreshSaveBadge); booted = true; }
  renderApp();
}
