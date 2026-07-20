# Zen-Warehouse · Server MCP (sola lettura)

Permette a un assistente AI (Claude Desktop) di interrogare Zen-Warehouse in
**linguaggio naturale**, in **sola lettura**. Come per Finance/Human/Staff.

## Caratteristiche
- **Zero dipendenze**: nessun `npm install`. Protocollo MCP (JSON-RPC su stdio) a mano.
- **Sola lettura**: legge `GET /api/data` del server locale (porta 4334); non scrive mai.
- **Verità dei dati**: riusa la **logica di dominio reale** dell'app (`src/domain/*`), quindi
  giacenze, avvisi scorta e report coincidono con l'app.

## Strumenti
| Strumento | A cosa serve |
|---|---|
| `lista_locali` | elenco locali (le altre richieste sono per-locale, default: attivo) |
| `riepilogo` | prodotti, fornitori, categorie, ordini, prodotti sotto scorta |
| `cerca_prodotti` | ricerca per nome/categoria/fornitore, con giacenza e soglia |
| `scorte` | stato magazzino (tutti / sotto_scorta / esauriti) |
| `storico_ordini` | ultimi ordini inviati (data, righe, pezzi, fornitori, consegna) |
| `report` | prodotti più ordinati, volumi per fornitore, andamento (per periodo) |
| `fornitori` | elenco fornitori con recapiti |

## Prerequisito
Il server di Zen-Warehouse dev'essere **acceso** (`avvia-zen.command`, porta 4334).
Var opzionale: `ZEN_WAREHOUSE_URL` (default `http://localhost:4334`).

## Collegarlo a Claude Desktop (macOS)
In `~/Library/Application Support/Claude/claude_desktop_config.json`, dentro `mcpServers`:
```json
"zen-warehouse": {
  "command": "node",
  "args": ["/percorso/assoluto/di/Zen-Manager-Apps/Zen-Warehouse/mcp/server.mjs"]
}
```
Poi riavvia Claude Desktop. Esempi: «cosa è sotto scorta?», «ultimi ordini», «prodotti più
ordinati questo mese», «recapiti di [fornitore]».

## Prova rapida (debug)
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"riepilogo","arguments":{}}}' \
 | (cat; sleep 3) | node mcp/server.mjs
```
