// Test d'integrità (Zen-Staff): import → export lossless + rev monotòno + changeset granulare.
// Gira su DB in memoria per non toccare il file reale.
process.env.ZEN_DB = ':memory:';
import assert from 'node:assert/strict';
const { importData, exportData, applyChanges } = await import('../server/serialize.js');

// Dataset ricco: store con roles[] e shiftTypes[] ANNIDATI, employees, assignments, leaves, rules, waivers.
const sample = {
  version: 1, rev: 9, savedAt: 111,
  settings: { theme: 'dark', activeStore: 'st1' },
  stores: [{
    id: 'st1', name: 'Store 1', emoji: '🏬', color: '#4f7396', note: 'n',
    roles: [{ id: 'r1', name: 'Cassa', acronym: 'CS', level: 1 }, { id: 'r2', name: 'Banco', acronym: 'BN', level: 2 }],
    shiftTypes: [{ id: 'sh1', name: 'Mattina', color: '#c98a52', start: '06:00', end: '14:00', minStaff: 0, maxStaff: 0 }],
  }],
  employees: [{ id: 'e1', storeId: 'st1', firstName: 'Mario', lastName: 'Rossi', color: '#8B5060', defaultRoleId: 'r1', level: 1, active: true, createdAt: 1000 }],
  assignments: [{ id: 'a1', storeId: 'st1', date: '2026-07-01', shiftId: 'sh1', roleId: 'r1', employeeId: 'e1' }],
  leaves: [{ id: 'lv1', storeId: 'st1', date: '2026-07-02', employeeId: 'e1' }],
  rules: [{ id: 'ru1', storeId: 'st1', type: 'maxConsecutive', enabled: true, days: 6 }],
  waivers: [{ id: 'w1', storeId: 'st1', ruleId: 'ru1', employeeId: 'e1', key: 'k-abc', createdAt: 2000 }],
};

const dropMeta = (o) => { const { rev, savedAt, version, ...rest } = o; return rest; };

importData(structuredClone(sample));
const out1 = exportData();
assert.equal(out1.rev, 10, 'rev max(9,0)+1 = 10');
assert.deepEqual(dropMeta(out1), dropMeta(sample), 'export deve coincidere col sample (lossless, incl. roles/shiftTypes annidati)');
console.log('✓ round-trip lossless (con nidificazione store)');

importData(structuredClone(sample));
assert.equal(exportData().rev, 11, 'secondo import: rev monotòno = 11');
console.log('✓ rev monotòno');

let rejected = false;
try { importData({ foo: 'bar' }); } catch { rejected = true; }
assert.ok(rejected, 'struttura invalida rifiutata');
assert.equal(exportData().rev, 11, 'dati intatti dopo import rifiutato');
console.log('✓ import invalido rifiutato, dati intatti');

// changeset granulare: aggiorna e1, aggiunge a2, rimuove a1.
applyChanges({
  collections: {
    employees: { upsert: [{ ...sample.employees[0], level: 3 }] },
    assignments: { upsert: [{ id: 'a2', storeId: 'st1', date: '2026-07-03', shiftId: 'sh1', roleId: 'r2', employeeId: 'e1' }], remove: ['a1'] },
  },
});
const d2 = exportData();
assert.equal(d2.employees[0].level, 3, 'employee aggiornato via changeset');
const asg = Object.fromEntries(d2.assignments.map((a) => [a.id, a]));
assert.ok(!asg.a1 && asg.a2, 'a1 rimossa, a2 aggiunta');
console.log('✓ changeset granulare (upsert/remove)');

console.log('\nZEN-STAFF — TUTTI I TEST PASSATI ✅');
