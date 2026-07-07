// ============ Specifica dello schema (Zen-Warehouse) ============
// Modello IBRIDO documento-relazionale, come Finance/Human/Staff:
//  - ogni entità ha una colonna `doc` con il JSON VERBATIM dell'oggetto → fonte di verità
//    (ricostruzione sempre da `doc`: round-trip lossless per costruzione);
//  - le altre colonne sono DERIVATE (sola scrittura) per query/indici.
//
// Dominio (dalla base Zen-Orders, resa persistente e "profonda"):
//  - `locali`: contenitore isolato (come le aziende/store). Porta ANNIDATI nel proprio doc la
//    configurazione per-locale: `types[]` (categorie/tipologie, con sottocategorie via parentId)
//    e `deliveryPoints[]` (punti di consegna). Come Staff annida roles/shiftTypes.
//  - `suppliers`, `products`: collezioni di primo livello con `localeId` (query/report per locale).
//  - `orders`: STORICO degli ordini inviati (righe annidate nel doc). NOVITÀ vs Orders (effimero).
//  - `stockMoves`: movimenti di magazzino (carico/scarico) per la gestione scorte. NOVITÀ.

const col = (n, type = 'TEXT', bool = false) => ({ n, type, bool });

export const COLLECTIONS = [
  // locale: {id,name,emoji,color,note,order, types:[{id,name,parentId,order}], deliveryPoints:[{id,name,address,phone,note,order}]}
  { key: 'locali', table: 'locali', cols: [col('name')] },

  // fornitore: {id,localeId,name,contact,phone,email,address,note,order}
  { key: 'suppliers', table: 'suppliers', index: ['localeId'],
    cols: [col('localeId'), col('name')] },

  // prodotto: {id,localeId,name,typeId,supplierId,deliveryPointId,format,unit,notes,order, stock,minStock}
  { key: 'products', table: 'products', index: ['localeId', 'typeId', 'supplierId'],
    cols: [col('localeId'), col('typeId'), col('supplierId'), col('name')] },

  // ordine inviato (STORICO): {id,localeId,createdAt,sentAt,status,note, lines:[{productId,name,qty,format,supplierId}]}
  { key: 'orders', table: 'orders', index: ['localeId', 'sentAt'],
    cols: [col('localeId'), col('sentAt', 'INTEGER'), col('status')] },

  // movimento scorte (carico/scarico): {id,localeId,productId,date,qty,kind:'in'|'out',note,orderId?}
  { key: 'stockMoves', table: 'stockMoves', index: ['localeId', 'productId', 'date'],
    cols: [col('localeId'), col('productId'), col('date'), col('kind')] },
];
