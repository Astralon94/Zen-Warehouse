// ============ (De)serializzazione DB ⇄ modello JSON dell'app (Zen-Staff) ============
// exportData() ricostruisce l'oggetto `data` nella STESSA forma dell'export dell'app FSA.
// importData() lo carica in transazione all-or-nothing (backup prima, rev monotòno, migrate).
// applyChanges() applica scritture GRANULARI (solo i record cambiati).
import { db, backupDb } from './db.js';
import { COLLECTIONS } from './schema.js';
import { DEFAULT_DATA, migrate, DATA_VERSION } from '../src/state/model.js';

const upMeta = db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
const setMeta = (k, v) => upMeta.run(k, JSON.stringify(v));
const getMeta = (k) => { const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k); return r ? JSON.parse(r.v) : undefined; };
export const currentRev = () => getMeta('rev') || 0;

function readSettings() {
  const out = {};
  for (const r of db.prepare('SELECT k,v FROM settings').all()) out[r.k] = JSON.parse(r.v);
  return out;
}

function colValue(spec, o) {
  let v = o[spec.n];
  if (v === undefined) v = null;
  if (spec.bool) return v ? 1 : 0;
  if (v === null) return null;
  if (spec.type === 'REAL') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (spec.type === 'INTEGER') { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; }
  return typeof v === 'string' ? v : String(v);
}

const childKeys = (c) => (c.children || []).map((ch) => ch.key);
function docOf(c, o) { const clone = { ...o }; for (const k of childKeys(c)) delete clone[k]; return clone; }

function insertMain(c, o) {
  const names = c.cols.map((x) => x.n);
  const cols = ['id', ...names, 'doc'];
  const vals = [o.id ?? null, ...c.cols.map((cs) => colValue(cs, o)), JSON.stringify(docOf(c, o))];
  db.prepare(`INSERT INTO ${c.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
  for (const ch of c.children || []) {
    const arr = Array.isArray(o[ch.key]) ? o[ch.key] : [];
    for (const item of arr) insertChild(ch, o.id, item);
  }
}
function insertChild(ch, fk, item) {
  const names = ch.cols.map((x) => x.n);
  const cols = [ch.fk, 'id', ...names, 'doc'];
  const vals = [fk, item.id ?? null, ...ch.cols.map((cs) => colValue(cs, item)), JSON.stringify(item)];
  db.prepare(`INSERT INTO ${ch.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
}

function clearAll() {
  for (const c of [...COLLECTIONS].reverse()) {
    for (const ch of c.children || []) db.exec(`DELETE FROM ${ch.table}`);
    db.exec(`DELETE FROM ${c.table}`);
  }
  db.exec('DELETE FROM settings');
}

// ---- EXPORT: DB → oggetto `data` (forma app) -------------------------------
export function exportData() {
  const out = {
    version: getMeta('version') ?? DATA_VERSION,
    rev: currentRev(),
    savedAt: getMeta('savedAt') ?? 0,
    settings: readSettings(),
  };
  for (const c of COLLECTIONS) {
    const rows = db.prepare(`SELECT doc, id FROM ${c.table} ORDER BY rowid`).all();
    out[c.key] = rows.map((r) => {
      const o = JSON.parse(r.doc);
      for (const ch of c.children || []) {
        o[ch.key] = db.prepare(`SELECT doc FROM ${ch.table} WHERE ${ch.fk}=? ORDER BY seq`)
          .all(r.id).map((x) => JSON.parse(x.doc));
      }
      return o;
    });
  }
  return out;
}

// ---- IMPORT: oggetto `data` → DB (transazionale, non distruttivo) ----------
export function importData(json, { force = false } = {}) {
  // Guardia sull'input GREZZO (prima di migrate): per Zen-Warehouse il marcatore è `locali`.
  if (!json || typeof json !== 'object' || !Array.isArray(json.locali))
    throw new Error('Struttura dati non valida');
  const d = migrate(json);
  d.rev = Math.max(d.rev || 0, currentRev()) + 1; // rev monotòno
  d.savedAt = Date.now();
  d.version = DATA_VERSION;

  backupDb({ force });

  db.exec('BEGIN IMMEDIATE');
  try {
    clearAll();
    setMeta('version', d.version); setMeta('rev', d.rev); setMeta('savedAt', d.savedAt);
    for (const [k, v] of Object.entries(d.settings || {}))
      db.prepare('INSERT INTO settings(k,v) VALUES(?,?)').run(k, JSON.stringify(v));
    for (const c of COLLECTIONS) {
      const arr = Array.isArray(d[c.key]) ? d[c.key] : [];
      for (const o of arr) insertMain(c, o);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { rev: d.rev, counts: counts() };
}

// ---- APPLY CHANGES: scritture GRANULARI (solo i record cambiati) -----------
const byKey = Object.fromEntries(COLLECTIONS.map((c) => [c.key, c]));
function deleteMain(c, id) { db.prepare(`DELETE FROM ${c.table} WHERE id=?`).run(id); }
function upsertMain(c, obj) {
  if (!obj || obj.id == null) return;
  db.prepare(`DELETE FROM ${c.table} WHERE id=?`).run(obj.id);
  insertMain(c, obj);
}

export function applyChanges(cs) {
  if (!cs || typeof cs !== 'object' || typeof cs.collections !== 'object')
    throw new Error('Changeset non valido');
  // Guardia di concorrenza ottimistica: se il client si basa su una revisione ormai
  // superata (un'altra scheda/dispositivo ha scritto nel frattempo), rifiuta invece di
  // sovrascrivere in silenzio. Il client gestisce il 409 (ricarica o forza).
  // Node è single-thread e applyChanges è sincrona → nessun altro write si interpone tra
  // questo controllo e il COMMIT: nessuna finestra di race reale.
  if (cs.baseRev != null && cs.baseRev !== currentRev())
    throw Object.assign(new Error('conflict'), { conflict: true, rev: currentRev() });
  db.exec('BEGIN IMMEDIATE');
  try {
    setMeta('version', DATA_VERSION);
    setMeta('rev', currentRev() + 1);
    setMeta('savedAt', Date.now());
    if (cs.settings && typeof cs.settings === 'object') {
      db.exec('DELETE FROM settings');
      for (const [k, v] of Object.entries(cs.settings))
        db.prepare('INSERT INTO settings(k,v) VALUES(?,?)').run(k, JSON.stringify(v));
    }
    for (const [key, ch] of Object.entries(cs.collections)) {
      const c = byKey[key];
      if (!c || !ch) continue;
      for (const id of ch.remove || []) deleteMain(c, id);
      for (const obj of ch.upsert || []) upsertMain(c, obj);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { rev: currentRev(), counts: counts() };
}

// ---- Utilità ---------------------------------------------------------------
export function counts() {
  const out = { rev: currentRev() };
  for (const c of COLLECTIONS) out[c.key] = db.prepare(`SELECT COUNT(*) AS n FROM ${c.table}`).get().n;
  return out;
}

export function resetData() { return importData(DEFAULT_DATA(), { force: true }); }

export function seedIfEmpty() {
  const empty = db.prepare('SELECT COUNT(*) AS n FROM meta').get().n === 0;
  if (empty) return resetData();
  return { rev: currentRev(), counts: counts(), seeded: false };
}
