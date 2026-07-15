// ============ Utility di base: date, mesi, id, escaping ============

export const pad2 = n => String(n).padStart(2, '0');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };

export const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
export const GIORNI_LUNGHI = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

// "2026-06" -> "Giugno 2026"
export function fmtMonth(m) {
  if (!m) return '';
  const [y, mm] = m.split('-');
  return `${MESI[parseInt(mm) - 1]} ${y}`;
}
// "2026-06" + offset -> "2026-07"
export function shiftMonth(m, delta) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
// numero di giorni nel mese "YYYY-MM"
export function daysInMonth(m) {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm, 0).getDate();
}
// indice giorno settimana (0=Lun … 6=Dom) per "YYYY-MM-DD"
export function weekdayMon0(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return (d.getDay() + 6) % 7;
}
export const monthOf = dateStr => (dateStr || '').slice(0, 7);
export const dateStr = (month, day) => `${month}-${pad2(day)}`;

// "2026-06-23" -> "23/06/2026"
export function fmtDateFull(d) {
  if (!d) return '';
  const [y, m, g] = d.split('-');
  if (!g) return d;
  return `${g}/${m}/${y}`;
}
// "2026-06-23" -> "23 giu"
export function fmtShort(d) {
  if (!d) return '';
  const [y, m, g] = d.split('-');
  if (!g) return d;
  return `${parseInt(g)} ${MESI[parseInt(m) - 1].slice(0, 3).toLowerCase()}`;
}

// livello normalizzato (intero ≥ 1; default 1)
export const normLevel = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 1 ? n : 1; };

// id univoco (timestamp + random)
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- denaro (prezzi di acquisto dei prodotti, spesa nei report) ----
export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const _eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
export const fmtEur = n => _eur.format(round2(n));
// Parsing tollerante di un importo digitato/importato: accetta virgola o punto come
// separatore decimale. Se è presente la virgola, i punti sono migliaia ("1.234,56"→1234.56);
// altrimenti il punto è decimale ("1.50"→1.5). Mai negativo.
export function parseMoney(v) {
  let s = String(v ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.max(0, round2(n));
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Codice prodotto ----
// Normalizzazione canonica: trim + MAIUSCOLO (leggibilità + unicità case-insensitive). '' = nessun codice.
export const normCode = v => String(v ?? '').trim().toUpperCase();
// Predicato di ricerca UNIFICATO per un prodotto: matcha nome O codice (parziale, case-insensitive).
// `term` va passato GIÀ in minuscolo (com'è d'uso nei filtri, per non ri-abbassarlo a ogni prodotto).
export function productMatches(p, term) {
  if (!term) return true;
  if ((p?.name || '').toLowerCase().includes(term)) return true;
  const code = (p?.code || '').toLowerCase();
  return !!code && code.includes(term);
}
// Variante per le righe d'ordine (storico): il codice può essere nello snapshot della riga
// (`code`) oppure risolto al volo dal prodotto tramite `codeLookup(productId)`.
export function lineMatches(ln, term, codeLookup) {
  if (!term) return true;
  if ((ln?.name || '').toLowerCase().includes(term)) return true;
  const code = (ln?.code || (codeLookup ? codeLookup(ln?.productId) : '') || '').toLowerCase();
  return !!code && code.includes(term);
}

// Bersaglio di uno "scan"/Invio nella ricerca: priorità ASSOLUTA al match ESATTO di codice
// (case-insensitive sul normalizzato) nell'intero insieme `scope`, indipendentemente da quanti
// risultati sono mostrati. In mancanza, se la lista già filtrata `visible` ha UN solo elemento,
// quello. Altrimenti null (ambiguo → nessuna azione automatica). Abilita l'uso del barcode.
export function scanTarget(term, scope, visible) {
  const t = normCode(term);
  if (!t) return null;
  const exact = (scope || []).find(p => normCode(p.code) === t);
  if (exact) return exact;
  return (visible && visible.length === 1) ? visible[0] : null;
}

// Debounce con flush/cancel: rimanda `fn` di `ms`; `.flush()` la esegue subito (usato sull'Invio,
// così l'azione agisce sullo stato più aggiornato), `.cancel()` la annulla.
export function debounce(fn, ms = 130) {
  let t = null, lastArgs = null;
  const wrapped = (...args) => { lastArgs = args; clearTimeout(t); t = setTimeout(() => { t = null; fn(...lastArgs); }, ms); };
  wrapped.flush = () => { if (t) { clearTimeout(t); t = null; fn(...(lastArgs || [])); } };
  wrapped.cancel = () => { clearTimeout(t); t = null; };
  return wrapped;
}

export const fullName = e => `${(e.firstName || '').trim()} ${(e.lastName || '').trim()}`.trim() || 'Senza nome';
export function initials(e) {
  const f = (e.firstName || '').trim(), l = (e.lastName || '').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  const t = fullName(e);
  return t.slice(0, 2).toUpperCase();
}
// acronimo automatico da un nome ruolo (fallback se non impostato a mano)
export function autoAcronym(name) {
  const t = (name || '').trim();
  if (!t) return '?';
  const w = t.split(/\s+/).filter(Boolean);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}
// nome file "sicuro" (per gli export ZIP)
export const safeFileName = n => String(n || 'file').replace(/[^\p{L}\p{N}.\-_ ]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';
