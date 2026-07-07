#!/usr/bin/env node
// ============ Zen-Warehouse · Server MCP (SOLA LETTURA) ============
// Espone i dati di Zen-Warehouse a un assistente AI (es. Claude Desktop) tramite il
// Model Context Protocol, su stdio. Come per la triade:
//   • ZERO dipendenze: protocollo JSON-RPC (newline-delimited) gestito a mano.
//   • SOLA LETTURA: non scrive mai. Legge lo stato via GET /api/data del server locale.
//   • VERITÀ DEI DATI: RIUSA la logica di dominio REALE dell'app (src/domain/*) iniettando
//     il payload del boot nel singleton `data`. Riepiloghi, scorte e report coincidono
//     ESATTAMENTE con quelli dell'app, senza reimplementare formule.
//
// Config env:  ZEN_WAREHOUSE_URL (default http://localhost:4334)

import { data } from '../src/state/store.js';
import { migrate } from '../src/state/model.js';
import { loc, supplierName, typeName, productsOf, suppliersOf, ordersOf, counts, lowStock } from '../src/domain/warehouse.js';
import { reportData, monthLabel } from '../src/domain/report.js';
import { orderSummary } from '../src/domain/orderpdf.js';

const BASE = process.env.ZEN_WAREHOUSE_URL || 'http://localhost:4334';
const VERSION = '0.1.0';

// ---- Caricamento dati: fresh a ogni chiamata (la verità è il DB del server) ----
async function loadData() {
  const res = await fetch(BASE + '/api/data');
  if (!res.ok) throw new Error(`HTTP ${res.status} da ${BASE}/api/data`);
  const payload = migrate(await res.json());
  for (const k of Object.keys(payload)) data[k] = payload[k];
}

// ---- Risoluzione locale: id esatto, nome (match parziale), vuoto → locale attivo ----
function resolveLocale(arg) {
  const list = data.locali || [];
  if (arg == null || String(arg).trim() === '') return data.settings.activeLocale || list[0]?.id || null;
  const byId = list.find(l => l.id === arg);
  if (byId) return byId.id;
  const q = String(arg).trim().toLowerCase();
  const byName = list.find(l => (l.name || '').toLowerCase().includes(q));
  if (byName) return byName.id;
  throw new Error(`Locale non trovato: "${arg}". Disponibili: ${list.map(l => l.name).join(', ')}`);
}
const localeName = id => loc(id)?.name || id;
const dpName = (lid, id) => id ? ((loc(lid)?.deliveryPoints || []).find(d => d.id === id)?.name || null) : null;
const statusOf = p => { const s = p.stock || 0, m = p.minStock || 0; if (s <= 0) return 'esaurito'; if (m > 0 && s <= m) return 'sotto_scorta'; return 'ok'; };

// ============ Strumenti (tutti in sola lettura) ============
const TOOLS = {
  lista_locali: {
    description: 'Elenca i locali gestiti in Zen-Warehouse (id, nome, emoji). Ogni locale ha i suoi prodotti, fornitori, ordini e scorte. Le altre richieste sono per-locale (default: locale attivo).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => data.locali.map(l => ({ id: l.id, nome: l.name, emoji: l.emoji || null, attivo: l.id === data.settings.activeLocale })),
  },

  riepilogo: {
    description: "Riepilogo di un locale: numero di prodotti, fornitori, categorie, punti di consegna, ordini nello storico e prodotti sotto scorta.",
    inputSchema: { type: 'object', properties: { locale: { type: 'string', description: 'nome o id locale; vuoto = locale attivo' } }, additionalProperties: false },
    run: ({ locale } = {}) => {
      const lid = resolveLocale(locale);
      const c = counts(lid);
      const low = lowStock(lid);
      return {
        locale: localeName(lid),
        prodotti: c.prodotti, fornitori: c.fornitori, categorie: c.categorie,
        puntiConsegna: c.puntiConsegna, ordiniInStorico: c.ordini,
        prodottiSottoScorta: low.length,
        elencoSottoScorta: low.slice(0, 10).map(p => `${p.name} (${p.stock || 0}/${p.minStock})`),
      };
    },
  },

  cerca_prodotti: {
    description: 'Cerca prodotti di un locale con filtri (testo su nome, categoria, fornitore). Restituisce categoria, fornitore, formato, giacenza e soglia minima.',
    inputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string' }, testo: { type: 'string' },
        categoria: { type: 'string', description: 'nome categoria/tipologia (match parziale)' },
        fornitore: { type: 'string', description: 'nome fornitore (match parziale)' },
        limite: { type: 'integer', description: 'max risultati (default 50)' },
      },
      additionalProperties: false,
    },
    run: ({ locale, testo, categoria, fornitore, limite = 50 } = {}) => {
      const lid = resolveLocale(locale);
      let list = productsOf(lid);
      if (testo) { const q = testo.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q)); }
      if (fornitore) { const q = fornitore.toLowerCase(); list = list.filter(p => supplierName(p.supplierId).toLowerCase().includes(q)); }
      if (categoria) { const q = categoria.toLowerCase(); list = list.filter(p => typeName(lid, p.typeId).toLowerCase().includes(q)); }
      return {
        locale: localeName(lid), trovati: list.length,
        prodotti: list.slice(0, Math.max(1, limite)).map(p => ({
          nome: p.name, formato: p.format || null, categoria: typeName(lid, p.typeId),
          fornitore: supplierName(p.supplierId), giacenza: p.stock || 0, sogliaMinima: p.minStock || 0,
        })),
      };
    },
  },

  scorte: {
    description: 'Stato del magazzino di un locale: giacenze e soglie minime, con filtro per stato (tutti | sotto_scorta | esauriti).',
    inputSchema: {
      type: 'object',
      properties: {
        locale: { type: 'string' },
        stato: { type: 'string', enum: ['tutti', 'sotto_scorta', 'esauriti'], description: 'default: tutti' },
        limite: { type: 'integer' },
      },
      additionalProperties: false,
    },
    run: ({ locale, stato = 'tutti', limite = 100 } = {}) => {
      const lid = resolveLocale(locale);
      let list = productsOf(lid);
      if (stato === 'sotto_scorta') list = list.filter(p => statusOf(p) === 'sotto_scorta');
      else if (stato === 'esauriti') list = list.filter(p => statusOf(p) === 'esaurito');
      return {
        locale: localeName(lid), conteggio: list.length,
        prodotti: list.slice(0, Math.max(1, limite)).map(p => ({ nome: p.name, giacenza: p.stock || 0, sogliaMinima: p.minStock || 0, stato: statusOf(p) })),
      };
    },
  },

  storico_ordini: {
    description: 'Ultimi ordini inviati di un locale, dal più recente: data, righe, pezzi, fornitori coinvolti, punto di consegna, se ricevuto.',
    inputSchema: { type: 'object', properties: { locale: { type: 'string' }, limite: { type: 'integer', description: 'max ordini (default 20)' } }, additionalProperties: false },
    run: ({ locale, limite = 20 } = {}) => {
      const lid = resolveLocale(locale);
      const all = ordersOf(lid);
      const list = all.slice().sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0)).slice(0, Math.max(1, limite));
      return {
        locale: localeName(lid), totali: all.length,
        ordini: list.map(o => {
          const s = orderSummary(o);
          return {
            data: new Date(o.sentAt || o.createdAt).toISOString().slice(0, 10),
            righe: s.righe, pezzi: s.pezzi, fornitori: s.fornitori,
            puntoConsegna: dpName(lid, o.deliveryPointId), ricevuto: o.status === 'received',
          };
        }),
      };
    },
  },

  report: {
    description: 'Analisi degli ordini di un locale in un periodo (all | 30 | 90 giorni | year=anno corrente): totali, prodotti più ordinati, volumi per fornitore, andamento mensile.',
    inputSchema: {
      type: 'object',
      properties: { locale: { type: 'string' }, periodo: { type: 'string', enum: ['all', '30', '90', 'year'], description: 'default: all' } },
      additionalProperties: false,
    },
    run: ({ locale, periodo = 'all' } = {}) => {
      const lid = resolveLocale(locale);
      const r = reportData(lid, periodo);
      return {
        locale: localeName(lid), periodo, totali: r.totals,
        prodottiPiuOrdinati: r.topProducts.slice(0, 15),
        volumiPerFornitore: r.bySupplier,
        andamentoMensile: r.byMonth.map(m => ({ mese: monthLabel(m.month), ordini: m.orders, pezzi: m.pieces })),
      };
    },
  },

  fornitori: {
    description: 'Elenco dei fornitori di un locale con recapiti (telefono, email, note).',
    inputSchema: { type: 'object', properties: { locale: { type: 'string' } }, additionalProperties: false },
    run: ({ locale } = {}) => {
      const lid = resolveLocale(locale);
      return { locale: localeName(lid), fornitori: suppliersOf(lid).map(s => ({ nome: s.name, telefono: s.phone || null, email: s.email || null, note: s.note || null })) };
    },
  },
};

// ============ Trasporto MCP: JSON-RPC 2.0, messaggi newline-delimited su stdio ============
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'zen-warehouse', version: VERSION },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notifiche: nessuna risposta
    case 'ping':
      return reply(id, {});
    case 'resources/list':
      return reply(id, { resources: [] });
    case 'prompts/list':
      return reply(id, { prompts: [] });
    case 'tools/list':
      return reply(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = params?.name;
      const tool = TOOLS[name];
      if (!tool) return replyError(id, -32602, `Strumento sconosciuto: ${name}`);
      try {
        await loadData();
        const out = await tool.run(params?.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        const hint = /fetch failed|ECONNREFUSED|HTTP \d|networkerror/i.test(String(e.message))
          ? ` — Zen-Warehouse non raggiungibile su ${BASE}. Avvia i server (avvia-zen.command).` : '';
        return reply(id, { content: [{ type: 'text', text: `Errore: ${e.message}${hint}` }], isError: true });
      }
    }
    default:
      if (id !== undefined) return replyError(id, -32601, `Metodo non supportato: ${method}`);
  }
}

// ---- Lettura stdin (newline-delimited) ----
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    Promise.resolve(handle(msg)).catch(e => { if (msg && msg.id !== undefined) replyError(msg.id, -32603, String(e.message)); });
  }
});
process.stdin.on('end', () => process.exit(0));

// Diagnostica SOLO su stderr: qualsiasi output su stdout romperebbe il protocollo.
process.stderr.write(`[zen-warehouse-mcp] avviato · sorgente dati ${BASE}\n`);
