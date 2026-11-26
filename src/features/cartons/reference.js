import { aliases, cartonAdapter, cartonQuantityAliases, codeKey, createCartonIndex, fields } from '../../domain/carton-verification.js';

export const cartonModes = ['outbound', 'inventory'];
const clean = value => codeKey(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const names = {
 outbound: ['shipmentcartons', 'outboundcartons', '출고박스', '출고박스자료', '출고검수'],
 inventory: ['inventorycartons', 'locationcartons', 'stockcartons', '재고박스', '재고박스자료', '재고실사'],
};
const pickingSheets=['pickingresults','pickingexport','outboundpicks','pickedcartons','피킹결과','피킹실적','피킹내역'];
const inventoryOnly = field => !['external', 'store', 'country', 'das'].includes(field);

export function validateCartonMappings(value = {}) {
 if (!value || typeof value !== 'object' || Array.isArray(value) ||
     Object.keys(value).some(k => !cartonModes.includes(k))) throw Error('Invalid inspection mappings.');
 return Object.fromEntries(Object.entries(value).map(([mode, entry]) => {
  const { sheet, headers, separator = '' } = entry ?? {};
  if (typeof sheet !== 'string' || !sheet || sheet.length > 1024 || !headers ||
      typeof headers !== 'object' || Array.isArray(headers) ||
      Object.entries(headers).some(([k, v]) => !fields.includes(k) || typeof v !== 'string' || !v || v.length > 1024) ||
      new Set(Object.values(headers)).size !== Object.keys(headers).length ||
      typeof separator !== 'string' || separator.length > 6 ||
      (separator && (mode !== 'inventory' || Object.hasOwn(headers, 'id')))) throw Error('Invalid inspection sheet mapping.');
  return [mode, { sheet, headers: { ...headers }, ...(separator ? { separator } : {}) }];
 }));
}

export function cartonSheetChoice(mode, sheets, saved) {
 const explicit = saved && sheets.filter(x => x.name === saved.sheet);
 if (explicit?.length === 1) return { sheet: explicit[0], saved };
 const picking=mode==='outbound'?sheets.filter(x=>pickingSheets.includes(clean(x.name))):[];
 if(picking.length)return picking.length===1?{sheet:picking[0]}:{status:'mapping'};
 const options = sheets.filter(x => names[mode].includes(clean(x.name)));
 return options.length === 1 ? { sheet: options[0] } : { status: options.length || saved ? 'mapping' : 'missing' };
}

export function matchCartonHeaders(mode, rows, saved) {
 const hits = [];
 const adapter = cartonAdapter(mode);
 for (const [headerRow, head] of rows.entries()) {
  const columns = {}, quantityAliases=cartonQuantityAliases(mode,head);
  let ambiguous = false;
  for (const field of fields) {
   if ((mode === 'inventory' && !inventoryOnly(field)) || (saved && !Object.hasOwn(saved.headers, field))) continue;
   const required = ['receipt', 'qty', 'name', 'id', 'sku', 'barcode'].includes(field);
   const indices = head.flatMap((value, i) => (saved ? codeKey(value) === saved.headers[field] :
    field==='receipt'&&mode==='inventory'?['location','로케이션'].includes(clean(value)):
    field==='receipt'?aliases.receipt.filter(x=>x!=='location'&&x!=='로케이션').includes(clean(value)):
    (field==='qty'?quantityAliases:aliases[field]).includes(clean(value))) ? [i] : []);
   if (indices.length === 1) columns[field] = indices[0];
   else if (saved || required && indices.length > 1) ambiguous = true;
  }
  if (!ambiguous) {
   try { adapter.validateColumns('cartonLines', head, columns); hits.push({ headerRow, columns }); } catch {}
  }
 }
 return hits.length === 1 ? hits[0] : null;
}

// Reuse the bounded XLSX reader and never guess between two possible sheets or headers.
export async function prepareCartonReferences(file, mappings, readWorkbook, env) {
 const results = {};
 for (const mode of cartonModes) {
  let chosen, reason = 'invalid';
  const cancel = status => { reason = status; throw Error('Carton link requires review.'); };
  try {
   const adapter = cartonAdapter(mode);
   const { cartonLines } = await readWorkbook(file, 'cartonLines', null, {
    cartonAdapter: { validateColumns: adapter.validateColumns, table: (...args) => cartonAdapter(mode, chosen.saved?.separator).table(...args) },
    selectSheets: ({ sheets }) => {
     chosen = cartonSheetChoice(mode, sheets, mappings?.[mode]);
     if (!chosen.sheet) cancel(chosen.status);
     return [{ kind: 'cartonLines', sheetIndex: chosen.sheet.index }];
    },
    selectColumns: ({ rows }) => {
     const mapping = matchCartonHeaders(mode, rows, chosen.saved);
     if (!mapping) cancel('mapping');
     // A composite Location needs an explicit separator rather than silently counting by the whole field.
     if (mode === 'inventory' && !chosen.saved?.separator && mapping.columns.id === undefined &&
         rows.slice(mapping.headerRow + 1).some(r => /\s\|\s/u.test(codeKey(r[mapping.columns.receipt])))) cancel('mapping');
     return mapping;
    },
   }, env);
   const index = createCartonIndex(cartonLines);
   results[mode] = index.groups.size ? { status: 'ready', index } : { status: 'empty' };
  } catch { results[mode] = { status: reason }; }
 }
 return { file, results };
}
