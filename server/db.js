// ============ Data layer — node:sqlite (nessuna dipendenza esterna) ============
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '..', 'data');
export const DB_PATH = process.env.ZEN_DB || join(DATA_DIR, 'zenwarehouse.db');
const onDisk = DB_PATH !== ':memory:';
if (onDisk) mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

function ddl() {
  let sql = `
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
  `;
  for (const c of COLLECTIONS) {
    const cols = c.cols.map((x) => `${x.n} ${x.type}`).join(', ');
    sql += `CREATE TABLE IF NOT EXISTS ${c.table} (id TEXT PRIMARY KEY${cols ? ', ' + cols : ''}, doc TEXT NOT NULL);\n`;
    for (const ix of c.index || []) sql += `CREATE INDEX IF NOT EXISTS idx_${c.table}_${ix} ON ${c.table}(${ix});\n`;
    for (const ch of c.children || []) {
      const ccols = ch.cols.map((x) => `${x.n} ${x.type}`).join(', ');
      sql += `CREATE TABLE IF NOT EXISTS ${ch.table} (`
        + `seq INTEGER PRIMARY KEY AUTOINCREMENT, `
        + `${ch.fk} TEXT NOT NULL REFERENCES ${c.table}(id) ON DELETE CASCADE, `
        + `id TEXT${ccols ? ', ' + ccols : ''}, doc TEXT NOT NULL);\n`;
      sql += `CREATE INDEX IF NOT EXISTS idx_${ch.table}_fk ON ${ch.table}(${ch.fk});\n`;
    }
  }
  return sql;
}
db.exec(ddl());

const p2 = (n) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

const KEEP_BACKUPS = 20;
const MIN_BACKUP_INTERVAL = 120000; // 2 minuti
let lastBackupAt = 0;
export function backupDb({ force = false } = {}) {
  if (!onDisk || !existsSync(DB_PATH)) return null;
  const now = Date.now();
  if (!force && now - lastBackupAt < MIN_BACKUP_INTERVAL) return null;
  lastBackupAt = now;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
  const dir = join(DATA_DIR, 'backups');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `zenwarehouse-${stamp()}.db`);
  try { copyFileSync(DB_PATH, dest); } catch { return null; }
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
    for (let i = 0; i < files.length - KEEP_BACKUPS; i++) unlinkSync(join(dir, files[i]));
  } catch {}
  return dest;
}
