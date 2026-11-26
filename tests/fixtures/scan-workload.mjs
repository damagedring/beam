import { crc32, deflateRawSync } from 'node:zlib';

export const orderCount = 20_000;
export const storeCount = 800;
const order = index => 'ASN-' + String(index).padStart(5, '0');
const code = (index, item) => String(1100000000000 + index * 3 + item);
const store = index => 'Fictional store ' + index % storeCount;
export const codes = Array.from({ length: 3 }, (_, item) => code(0, item));

export function returnWorkload() {
  const raw = [];
  for (let index = 0; index < orderCount; index++) {
    for (let item = 0; item < 3; item++) {
      raw.push({ receipt: order(index), seller: store(index), external: 'EXT-' + index,
        barcode: code(index, item), sku: 'SKU-' + code(index, item), name: 'Product ' + item, qty: 650 });
    }
  }
  return { name: 'returns-workload.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    version: 1, data: { raw, sku: [], loc: [] }, scans: [], receipt: order(0), store: store(0),
  })) };
}

export function zip(entries) {
  const files = [], directory = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const path = Buffer.from(name), content = Buffer.from(data), compressed = deflateRawSync(content);
    const header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(content), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(path.length, 26);
    central.writeUInt32LE(0x02014b50, 0);
    header.copy(central, 6, 4);
    central.writeUInt32LE(offset, 42);
    offset += header.length + path.length + compressed.length;
    files.push(header, path, compressed);
    directory.push(central, path);
  }
  const tail = Buffer.alloc(22);
  tail.writeUInt32LE(0x06054b50, 0);
  tail.writeUInt16LE(directory.length / 2, 8);
  tail.writeUInt16LE(directory.length / 2, 10);
  tail.writeUInt32LE(directory.reduce((size, bytes) => size + bytes.length, 0), 12);
  tail.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, ...directory, tail]);
}

export function cartonWorkload() {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const row = (number, fields) => `<row r="${number}">${fields.map((text, column) =>
    `<c r="${String.fromCharCode(65 + column)}${number}" t="inlineStr"><is><t>${text}</t></is></c>`).join('')}</row>`;
  const rows = [row(1, ['Order ID', 'Carton ID', 'Barcode', 'SKU', 'Product Name', 'Quantity', 'Destination Store'])];
  for (let index = 0; index < orderCount; index++) {
    for (let item = 0; item < 3; item++) {
      rows.push(row(rows.length + 1, [order(index), 'BOX-' + index, code(index, item), 'SKU-' + code(index, item),
        'Product ' + item, 650, store(index)]));
    }
  }
  return { name: 'carton-workload.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: zip({
      'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="${relationship}"><sheets><sheet name="Outbound Carton" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationship}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><sheetData>${rows.join('')}</sheetData></worksheet>`,
    }) };
}
