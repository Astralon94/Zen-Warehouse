# Zen Warehouse

Ordini fornitori e magazzino **self-hosted e 100% locale**, pensato per attività con più punti vendita: catalogo prodotti, ordini per fornitore con PDF pronti da inviare, storico, report e scorte. Niente cloud, niente abbonamenti: un server Node **senza dipendenze a runtime** e un database SQLite in un singolo file.

## Caratteristiche

- **Organizzazione per locale** — ogni punto vendita ha le sue categorie/tipologie (con sottocategorie), i suoi punti di consegna e il suo giro di ordini; prodotti e fornitori condivisi dove serve.
- **Ordine** — schermata di compilazione rapida per fornitore: quantità sui prodotti, note, generazione del **PDF per fornitore** pronto da inviare.
- **Storico** — tutti gli ordini inviati, ricercabili e riapribili; un ordine passato si può clonare come base per il prossimo.
- **Report** — analisi su ordinato e fornitori per periodo, con riepiloghi e confronti.
- **Magazzino** — scorte con movimenti di carico/scarico e situazione per prodotto, con carico automatico opzionale dagli ordini in consegna e **trasferimenti interni** tramite documento di trasporto (DDT) tra magazzini o verso l'esterno.
- **Database** — anagrafiche di prodotti, categorie, fornitori e punti di consegna con editing rapido.
- **Dashboard** — quadro d'insieme dell'attività recente.
- **Multi-utente** — login con permessi granulari per sezione e azione.
- **Aggiornamenti in-app** — l'app controlla le release di questo repository e si aggiorna da sola (vedi sotto).

## Requisiti

- **Node.js ≥ 22.5** (usa il modulo nativo `node:sqlite`; consigliata l'ultima LTS).
- Nessuna dipendenza a runtime: `npm install` serve solo per lo sviluppo del frontend.

## Avvio rapido

```bash
git clone https://github.com/Astralon94/Zen-Warehouse.git
cd Zen-Warehouse
npm start            # avvia il server su http://localhost:4334
```

Al primo avvio viene creato l'utente **admin / admin**: cambiare subito la password (Impostazioni → Utenti). La porta si cambia con `PORT=8080 npm start`.

I dati vivono in `data/zenwarehouse.db` (creato al primo avvio, con backup automatici in `data/backups/`): la cartella `data/` non è mai versionata e non viene mai toccata dagli aggiornamenti.

> **Nota di sicurezza** — l'app è pensata per uso locale o su rete privata. Se esposta a Internet, va protetta con un livello di autenticazione aggiuntivo (VPN o reverse proxy con access control).

## Aggiornamenti

L'app controlla all'avvio (e ogni 12 ore, o con "Controlla ora" in Impostazioni) il manifest dell'ultima [release](https://github.com/Astralon94/Zen-Warehouse/releases) di questo repository, scarica il pacchetto, salva una copia dei file sovrascritti in `data/updates-backup/` e si riavvia sul nuovo codice. La variabile `ZEN_UPDATE_URL` permette di puntare a un altro manifest, oppure — se vuota — di disattivare gli aggiornamenti.

## Architettura

```
server.js          server node:http — statici da public/ + API /api
server/            schema, DB (node:sqlite, WAL), serializzazione/changeset, auth, updater
src/               frontend (Vite): state/, domain/, ui/ (viste)
public/index.html  SPA buildata, self-contained: è ciò che il server serve
scripts/           utilità: reset DB, reset admin, test round-trip, build pacchetto update
data/              database + backup — locale, mai versionato
```

Principi: il documento JSON di ogni record è la **fonte di verità** (colonne SQL solo per query/indici); il frontend invia **changeset granulari** (`POST /api/changes`) con guardia di concorrenza; i valori derivati (totali, riepiloghi) **non vengono mai salvati** — si salvano solo i fatti.

## Sviluppo

```bash
npm install          # dipendenze di build (Vite)
npm run dev          # frontend in sviluppo
npm run build        # build → public/index.html
npm run test:roundtrip
```

## Licenza

Rilasciato sotto licenza [MIT](LICENSE).

## Famiglia Zen

Zen Warehouse fa parte di una piccola famiglia di app self-hosted con la stessa architettura: [Zen Finance](https://github.com/Astralon94/Zen-Finance) (contabilità e fatture) e [Zen Human](https://github.com/Astralon94/Zen-Human) (presenze e turni del personale).
