# Zen-Warehouse

Versione **profonda e persistente** di Zen-Orders, in linea con Zen-Finance/Human/Staff:
app a **server locale** (Node `node:http` + database `node:sqlite`, zero dipendenze a runtime),
frontend SPA (Vite) servito da `public/index.html`. Gira **solo in locale sul Mac**
(`http://localhost:4334`). Accento di brand: prugna `#7a6a99` (dark `#b39ac9`).

Zen-Orders resta com'è (PWA semplice su Netlify): Warehouse **non** la sostituisce, la affianca
aggiungendo profondità grazie al database (storico ordini, report, riepiloghi, scorte).

## Avvio
```bash
cd Zen-Warehouse && npm start      # = node server.js  (porta 4334)
# oppure il launcher della famiglia: ./avvia-zen.command
```
Build del frontend (dopo modifiche a `src/`): `npm run build` (Vite → `public/index.html`).

## Architettura (come la triade)
```
server.js          server node:http — statico da public/ + API /api
server/            schema.js · db.js (node:sqlite) · serialize.js (import/export + changeset)
src/               frontend Vite: state/ (model, store), domain/, ui/ (app + views)
public/            index.html BUILDATO + manifest/icone
data/              zenwarehouse.db (+ backups/) — DATI LOCALI, NON versionati
```
Persistenza a **changeset granulare** (`POST /api/changes`), **spia di salvataggio** affidabile,
**guardia di concorrenza 409** (multi-scheda) e `Cache-Control: no-cache` ereditati dalla famiglia.

## Dominio (dalla base Zen-Orders)
Organizzazione **per locale**: ogni locale ha `types` (categorie/tipologie con sottocategorie) e
`deliveryPoints` (annidati), più `products`, `suppliers`, `orders` (storico) e `stockMoves` (scorte).

## Stato
- **Fase 1 — fatta**: fondamenta (server + DB + schema + shell: Dashboard, Impostazioni con
  gestione locali, import/export, reset).
- **Fase 2 — in arrivo**: porting di tutte le funzioni di Orders (Database prodotti,
  Fornitori, Punti di consegna, schermata Ordine, generazione PDF per fornitore).
- **Fase 3 — in arrivo**: profondità (Storico ordini, Report/analisi, Scorte/magazzino).
