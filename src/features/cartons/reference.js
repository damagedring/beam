import { aliases, catalogCasePacks, cartonAdapter, cartonQuantityAliases, codeKey, createCartonIndex, fields } from '../../domain/carton-verification.js';

export const cartonModes = ['outbound', 'inventory'];
const clean = value => codeKey(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const names = {
 outbound: ['shipmentcartons', 'outboundcartons', '출고박스', '출고박스자료', '출고검수'],
 inventory: ['inventorycartons', 'locationcartons', 'stockcartons', '재고박스', '재고박스자료', '재고실사'],
};
const pickingSheets=['pickingresults','pickingexport','outboundpicks','pickedcartons','피킹결과','피킹실적','피킹내역'];
const inventoryOnly = field => !['external', 'store', 'country', 'das', 'verificationUnit', 'unitsPerCase', 'caseBarcode'].includes(field);

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
 const results = {},packs=catalogCasePacks(env?.productCatalog);
 for (const mode of cartonModes) {
  let chosen, reason = 'invalid';
  const cancel = status => { reason = status; throw Error('Carton link requires review.'); };
  try {
   const adapter = cartonAdapter(mode);
   const { cartonLines } = await readWorkbook(file, 'cartonLines', null, {
    cartonAdapter: { validateColumns: adapter.validateColumns, table: (...args) => cartonAdapter(mode, chosen.saved?.separator,packs).table(...args) },
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
 return { file, results, packs };
}


function hexSha256(bytes) {
  return crypto.subtle.digest('SHA-256', bytes).then(result =>
    Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join(''));
}

export function createCartonReferenceIdentity(hash = hexSha256) {
  const files = new WeakMap(), workbookHashes = new WeakMap(), revisions = new WeakMap();
  const encoder = new TextEncoder();
  const hashValue = value => hash(encoder.encode(JSON.stringify(value)));

  async function identify(source, file) {
    let workbookHash = workbookHashes.get(file);
    if (!workbookHash) {
      workbookHash = file.arrayBuffer().then(hash);
      workbookHashes.set(file, workbookHash);
      workbookHash.catch(() => workbookHashes.delete(file));
    }
    const workbookId = await workbookHash;
    const chunks = [];
    let rows = [];
    // Bound temporary serialization while hashing the resolved workbook
    // interpretation, including alias conflicts and verified case sizes.
    for (const g of source.index.groups.values()) {
      rows.push(['group', g.id, g.external, g.das, [...g.stores], [...g.countries]]);
      for (const [box, items] of g.boxes) {
        for (const [key, item] of items) {
          rows.push([box, key, item.name, item.brand, item.expected, item.verification]);
          if (rows.length >= 256) { chunks.push(await hashValue(rows)); rows = []; }
        }
      }
    }
    if (rows.length) chunks.push(await hashValue(rows));
    return { workbookId, referenceId: await hashValue(['carton-reference-v1', workbookId, chunks]) };
  }

  return {
    associate: (source, file) => files.set(source, file),
    reference(source) {
      if (!files.has(source)) return Promise.reject(Error('No completion fingerprint'));
      if (!revisions.has(source)) {
        const revision = identify(source, files.get(source));
        revisions.set(source, revision);
        revision.catch(() => revisions.delete(source));
      }
      return revisions.get(source);
    },
    async legacyScopes(scope, group, keys) {
      const candidates = [];
      for (const key of keys) {
        let parts;
        try { parts = JSON.parse(key); } catch { continue; }
        if (!Array.isArray(parts) || parts.length !== 6 || parts[0] !== 'v1' ||
            parts[1] !== scope.workflow || parts[2] !== scope.workbookId || parts[3] !== group.id) continue;
        const box = parts[4];
        const items = box === null ? (scope.workflow === 'inventory' ? group.totals : null) : group.boxes.get(box);
        if (!items || box === '') continue;
        const legacyManifest = [...items].map(([itemKey, row]) =>
          row.verification?.caseBarcode ?
            [itemKey, row.expected, row.verification.caseBarcode, row.verification.unitsPerCase] : [itemKey, row.expected]);
        if (await hashValue(legacyManifest) === parts[5]) {
          candidates.push({ key, box, referenceId: scope.referenceId, eventPrefix: 'legacy:' + await hashValue(key) });
        }
      }
      return candidates;
    },
  };
}


export function createCartonProfileNamespaces(getStorage = () => localStorage) {
  const keyFor = (workspaceId, profileId) => JSON.stringify(['beam-carton-mappings', workspaceId, profileId]);
  function mappings(workspaceId, profileId) {
    try {
      return validateCartonMappings(JSON.parse(getStorage().getItem(keyFor(workspaceId, profileId)) || '{}'));
    } catch {
      return {};
    }
  }
  return {
    mappings,
    save(workspaceId, profileId, workflow, mapping) {
      const next = validateCartonMappings({ ...mappings(workspaceId, profileId), [workflow]: mapping });
      getStorage().setItem(keyFor(workspaceId, profileId), JSON.stringify(next));
    },
  };
}
