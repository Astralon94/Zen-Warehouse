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

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
