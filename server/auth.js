// ============ Autenticazione — hashing password (scrypt) + sessioni persistenti ============
// Nessuna dipendenza esterna (solo node:crypto e node:fs). Derivato dal modello di Zen-Store.
import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DB_PATH } from './db.js';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const calc = scryptSync(String(password), salt, 64);
  const known = Buffer.from(hash, 'hex');
  return calc.length === known.length && timingSafeEqual(calc, known);
}

// Sessioni PERSISTENTI: token -> { userId, creata, lastSeen }.
// Sono salvate accanto al DB in data/sessions.json (cartella non versionata e mai
// toccata dall'updater): sopravvivono a riavvii e aggiornamenti del server, così un
// aggiornamento in-app non sconnette più gli utenti. Scadenza SCORREVOLE: una sessione
// resta valida finché è usata almeno una volta ogni IDLE_TTL_MS; oltre viene eliminata.
const sessions = new Map();
const IDLE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 giorni di inattività
const WRITE_THROTTLE_MS = 1000 * 60 * 5;      // rinnovo lastSeen: persisti al massimo ogni 5 min

// Il file vive nella stessa cartella del DB (rispetta ZEN_DB in dev/test). Con DB in
// memoria (':memory:') non si persiste nulla.
const PERSIST = DB_PATH !== ':memory:';
const SESSIONS_PATH = PERSIST ? join(dirname(DB_PATH), 'sessions.json') : null;

function isExpired(s, now = Date.now()) {
  return !s || typeof s.lastSeen !== 'number' || now - s.lastSeen > IDLE_TTL_MS;
}

// Rimuove dalla mappa le sessioni scadute per inattività. Ritorna true se ha eliminato qualcosa.
function pruneExpired(now = Date.now()) {
  let changed = false;
  for (const [t, s] of sessions) if (isExpired(s, now)) { sessions.delete(t); changed = true; }
  return changed;
}

// Scrittura ATOMICA: file temporaneo + rename. Prima elimina le sessioni scadute,
// così il file su disco non le contiene mai.
function persist() {
  if (!PERSIST) return;
  pruneExpired();
  const out = { version: 1, sessions: {} };
  for (const [t, s] of sessions) out.sessions[t] = s;
  try {
    mkdirSync(dirname(SESSIONS_PATH), { recursive: true });
    const tmp = `${SESSIONS_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(out));
    renameSync(tmp, SESSIONS_PATH);
  } catch { /* best-effort: se il disco non è scrivibile le sessioni restano in memoria */ }
}

// Caricamento all'avvio: file mancante/corrotto -> si parte vuoti, senza errori. Tollera
// campi extra (formato estendibile): si conserva l'intero record e si normalizza lastSeen.
function load() {
  if (!PERSIST || !existsSync(SESSIONS_PATH)) return;
  try {
    const parsed = JSON.parse(readFileSync(SESSIONS_PATH, 'utf8'));
    const raw = (parsed && typeof parsed.sessions === 'object' && parsed.sessions) || {};
    const now = Date.now();
    for (const [token, rec] of Object.entries(raw)) {
      if (!rec || typeof rec !== 'object' || typeof rec.userId === 'undefined') continue;
      const lastSeen = typeof rec.lastSeen === 'number' ? rec.lastSeen
        : (typeof rec.creata === 'number' ? rec.creata : now);
      const s = { ...rec, userId: rec.userId, creata: rec.creata ?? lastSeen, lastSeen };
      if (!isExpired(s, now)) sessions.set(token, s);
    }
  } catch { /* file illeggibile o JSON invalido: si riparte con zero sessioni */ }
}

load();
if (pruneExpired()) persist(); // pulizia all'avvio: riscrivi solo se ha eliminato scadute

export function createSession(userId) {
  const token = randomUUID();
  const now = Date.now();
  sessions.set(token, { userId, creata: now, lastSeen: now });
  persist();
  return token;
}

export function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (isExpired(s, now)) { sessions.delete(token); persist(); return null; }
  // Rinnovo scorrevole: aggiorna lastSeen e persisti solo se è avanzato oltre la soglia
  // di throttle, per non riscrivere il file a ogni richiesta.
  if (now - s.lastSeen > WRITE_THROTTLE_MS) { s.lastSeen = now; persist(); }
  return s;
}

export function destroySession(token) { if (sessions.delete(token)) persist(); }
export function destroySessionsOfUser(userId) {
  let changed = false;
  for (const [t, s] of sessions) if (s.userId === userId) { sessions.delete(t); changed = true; }
  if (changed) persist();
}
