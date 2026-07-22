// =============================================================================
//  ZEN-WAREHOUSE · CATALOGO PERMESSI — UNICA FONTE DI VERITÀ
// -----------------------------------------------------------------------------
//  Registro centrale di TUTTI i permessi e delle voci di navigazione dell'app.
//  Usato dal backend (guardie API) e servito al frontend (gating menu + schermata
//  permessi utente). Quando si aggiunge una funzione all'app si aggiorna QUI:
//    1) il/i permesso/i in PERMISSIONS
//    2) la voce in NAV (se ha una schermata)
//    3) la guardia nell'endpoint in server.js
//
//  Modello (Livello A): autenticazione + gating UI a GRANA FINE (una particella per
//  entità × azione) + guardia di scrittura GROSSOLANA sul backend (un solo endpoint
//  dati). Nessun filtraggio del dataset per utente: tutti gli autenticati caricano
//  lo stato intero (app locale su un Mac). La grana fine vive nella UI: ogni
//  controllo di scrittura è gatinato dal permesso specifico dell'azione.
//
//  Regole d'oro:
//   - Gli utenti con ruolo 'admin' hanno SEMPRE tutti i permessi.
//   - I permessi con adminOnly:true valgono solo per gli admin (non assegnabili).
//   - I permessi standard sono "particellari": assegnabili singolarmente.
//   - `write:true` marca le azioni che scrivono i DATI (collezioni/doc): alimentano
//     DATA_MANAGE, la guardia grossolana di POST /api/changes.
// =============================================================================

export const RUOLI = { admin: 'Amministratore', standard: 'Operatore' };

// Catalogo permessi (particellari). `group` serve solo a raggrupparli nella UI.
// Vocabolario azioni: .view · .crea · .modifica · .elimina · .esporta (+ dominio).
export const PERMISSIONS = [
  // ---- Riepiloghi ----
  { key: 'dashboard.view',        group: 'Riepiloghi',     label: 'Vedere la Dashboard' },
  { key: 'report.view',          group: 'Riepiloghi',     label: 'Vedere i report' },
  { key: 'report.esporta',       group: 'Riepiloghi',     label: 'Esportare i report in PDF' },

  // ---- Ordini (Ordine + Storico) ----
  { key: 'ordini.view',          group: 'Ordini',         label: 'Vedere Ordine e Storico' },
  { key: 'ordini.componi',       group: 'Ordini',         label: 'Comporre l\'ordine in corso (quantità e note)', write: true },
  { key: 'ordini.invia',         group: 'Ordini',         label: 'Generare il PDF e inviare l\'ordine', write: true },
  { key: 'ordini.elimina',       group: 'Ordini',         label: 'Eliminare ordini dallo storico', write: true },
  { key: 'ordini.riordina',      group: 'Ordini',         label: 'Ri-ordinare da uno storico', write: true },

  // ---- Magazzino ----
  { key: 'magazzino.view',       group: 'Magazzino',      label: 'Consultare le giacenze' },
  { key: 'magazzino.carico',     group: 'Magazzino',      label: 'Registrare carichi', write: true },
  { key: 'magazzino.scarico',    group: 'Magazzino',      label: 'Registrare scarichi', write: true },
  { key: 'magazzino.rettifica',  group: 'Magazzino',      label: 'Rettificare le giacenze', write: true },
  { key: 'magazzino.trasferimento', group: 'Magazzino',   label: 'Trasferire tra magazzini', write: true },
  { key: 'magazzino.massivo',    group: 'Magazzino',      label: 'Eseguire movimenti massivi', write: true },
  { key: 'magazzino.ricevi',     group: 'Magazzino',      label: 'Ricevere e caricare da ordini', write: true },
  { key: 'magazzini.crea',       group: 'Magazzino',      label: 'Creare magazzini', write: true },
  { key: 'magazzini.modifica',   group: 'Magazzino',      label: 'Rinominare magazzini e categorie ammesse', write: true },
  { key: 'magazzini.elimina',    group: 'Magazzino',      label: 'Eliminare magazzini', write: true },

  // ---- Anagrafiche (Database) ----
  { key: 'database.view',        group: 'Anagrafiche',    label: 'Consultare le anagrafiche' },
  { key: 'prodotti.crea',        group: 'Anagrafiche',    label: 'Creare prodotti', write: true },
  { key: 'prodotti.modifica',    group: 'Anagrafiche',    label: 'Modificare e riordinare i prodotti', write: true },
  { key: 'prodotti.elimina',     group: 'Anagrafiche',    label: 'Eliminare prodotti', write: true },
  { key: 'prodotti.massiva',     group: 'Anagrafiche',    label: 'Modificare i prodotti in massa', write: true },
  { key: 'prodotti.importa',     group: 'Anagrafiche',    label: 'Importare prodotti da fatture XML', write: true },
  { key: 'categorie.crea',       group: 'Anagrafiche',    label: 'Creare categorie e sottocategorie', write: true },
  { key: 'categorie.modifica',   group: 'Anagrafiche',    label: 'Modificare e riordinare le categorie', write: true },
  { key: 'categorie.elimina',    group: 'Anagrafiche',    label: 'Eliminare categorie', write: true },
  { key: 'fornitori.crea',       group: 'Anagrafiche',    label: 'Creare fornitori', write: true },
  { key: 'fornitori.modifica',   group: 'Anagrafiche',    label: 'Modificare e riordinare i fornitori', write: true },
  { key: 'fornitori.elimina',    group: 'Anagrafiche',    label: 'Eliminare fornitori', write: true },
  { key: 'consegne.crea',        group: 'Anagrafiche',    label: 'Creare punti di consegna', write: true },
  { key: 'consegne.modifica',    group: 'Anagrafiche',    label: 'Modificare e riordinare i punti di consegna', write: true },
  { key: 'consegne.elimina',     group: 'Anagrafiche',    label: 'Eliminare punti di consegna', write: true },

  // ---- Configurazione ----
  { key: 'locali.crea',          group: 'Configurazione', label: 'Creare locali', write: true },
  { key: 'locali.modifica',      group: 'Configurazione', label: 'Rinominare locali', write: true },
  { key: 'locali.elimina',       group: 'Configurazione', label: 'Eliminare locali', write: true },
  { key: 'impostazioni.manage',  group: 'Configurazione', label: 'Gestire tema e impostazioni' },
  { key: 'software.aggiorna',    group: 'Configurazione', label: 'Aggiornare il software' },
  { key: 'dati.export',          group: 'Configurazione', label: 'Esportare il backup JSON' },
  { key: 'dati.import',          group: 'Configurazione', label: 'Importare/sostituire i dati (operazione totale)' },
  { key: 'dati.reset',           group: 'Configurazione', label: 'Azzerare il database' },
  { key: 'utenti.manage',        group: 'Configurazione', label: 'Gestire utenti e permessi', adminOnly: true },
];

// Voci di navigazione: ognuna richiede un permesso (`perm`). La voce Impostazioni
// è raggiungibile con UNO QUALSIASI dei permessi in `any` (contiene sotto-sezioni
// tema/aggiornamento/export/import/reset/locali gestite da permessi distinti).
export const NAV = [
  { key: 'ord',    icon: '🛒', label: 'Ordine',       perm: 'ordini.view' },
  { key: 'dash',   icon: '◷',  label: 'Dashboard',    perm: 'dashboard.view' },
  { key: 'stor',   icon: '↕',  label: 'Movimenti',    perm: 'ordini.view' },
  { key: 'rep',    icon: '📈', label: 'Report',       perm: 'report.view' },
  { key: 'mag',    icon: '🏬', label: 'Magazzino',    perm: 'magazzino.view' },
  { key: 'db',     icon: '📦', label: 'Database',     perm: 'database.view' },
  { key: 'utenti', icon: '👥', label: 'Utenti',       perm: 'utenti.manage' },
  { key: 'set',    icon: '⚙',  label: 'Impostazioni', perm: 'impostazioni.manage',
    any: ['impostazioni.manage', 'software.aggiorna', 'dati.export', 'dati.import', 'dati.reset', 'locali.crea', 'locali.modifica', 'locali.elimina'] },
];

// Permessi che abilitano la scrittura dei DATI (collezioni). Derivati da `write:true`,
// così il catalogo resta l'unica fonte di verità. Servono alla guardia grossolana su
// POST /api/changes: chi non ne ha nessuno è di sola lettura. Include tutte le azioni
// di ordini/magazzino/magazzini/prodotti/categorie/fornitori/consegne/locali; NON i
// .view/.esporta né impostazioni/software/dati/utenti.
export const DATA_MANAGE = PERMISSIONS.filter((p) => p.write).map((p) => p.key);

const PERM_INDEX = new Map(PERMISSIONS.map((p) => [p.key, p]));

// Un utente possiede un permesso? Gli admin hanno tutto; adminOnly solo agli admin.
export function hasPermission(user, key) {
  if (!user) return false;
  if (user.ruolo === 'admin') return true;
  const p = PERM_INDEX.get(key);
  if (p && p.adminOnly) return false;
  return Array.isArray(user.permessi) && user.permessi.includes(key);
}

// Verifica che almeno uno dei permessi sia posseduto.
export function hasAny(user, keys) {
  return keys.some((k) => hasPermission(user, k));
}

// Può scrivere i dati (ha almeno un permesso di gestione collezioni)? Gli admin sì.
export function canWriteData(user) {
  return hasAny(user, DATA_MANAGE);
}

// Voce di nav accessibile all'utente (usa `any` se presente, altrimenti `perm`).
export function canSeeNav(user, nav) {
  return nav.any ? hasAny(user, nav.any) : hasPermission(user, nav.perm);
}

// Permessi realmente assegnabili a un operatore standard (esclude gli adminOnly).
export function assegnabili() {
  return PERMISSIONS.filter((p) => !p.adminOnly);
}
