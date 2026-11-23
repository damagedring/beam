import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeReceiptCode128 } from '../dist/domain/code128.js';
import { beamInitialKey, trackingExactKey, trackingKey, trackingNumericCore, looksLikeTracking } from '../dist/domain/search-keys.js';
import { readWorkbook } from '../dist/import/workbook.js';
import { XlsxSaxesParser } from '../dist/vendor/xml-parser.js';

test('preserves tracking zeros, separates wrapped candidates, and rejects mismatched wrappers', () => {
  assert.equal(trackingExactKey(' ００１２-３４５６-７８９０ '), '0012-3456-7890');
  assert.equal(trackingKey('0012–3456–7890'), '001234567890');
  assert.equal(trackingNumericCore('X001234567890X'), '001234567890');
  assert.equal(trackingNumericCore('X001234567890Y'), '');
  assert.equal(trackingNumericCore('A01'), '');
  assert.equal(looksLikeTracking('테스트 매장'), false);
  assert.equal(beamInitialKey('ㄱ ㅅ',true),'ㄱㅅ');
  assert.equal(beamInitialKey('가상점'),'ㄱㅅㅈ');
  assert.equal(beamInitialKey('ㄱA',true),'');
});

test('Code 128 checksum, leading zero and unsupported input', () => {
  const x=encodeReceiptCode128('00');
  assert.deepEqual(x.runs.slice(0,6),[2,1,1,2,3,2]); // Start C
  assert.deepEqual(x.runs.slice(6,12),[2,1,2,2,2,2]); // pair 00
  assert.deepEqual(x.runs.slice(12,18),[2,2,2,2,2,1]); // checksum 2
  assert.equal(x.modules,x.runs.reduce((sum,n)=>sum+n,0)+20);
  assert.throws(()=>encodeReceiptCode128('가상'));
  assert.throws(()=>encodeReceiptCode128(''));
});

test('workbook validates mapping hooks, file budget and ZIP framing', async () => {
  const api={Engine:{},MappingCore:{},PhoneOrderCore:{}};
  const hooks={selectSheets(){},selectColumns(){}};
  await assert.rejects(readWorkbook(new Blob(),null,null,null,api),/설정/);
  await assert.rejects(readWorkbook({size:31*1024*1024},null,null,hooks,api),/30MB/);
  await assert.rejects(readWorkbook(new Blob(['not XLSX']),null,null,hooks,api),/유효한/);
});

test('vendored XML boundary validates input', () => {
  const valid=new XlsxSaxesParser({xmlns:true});
  const tags=[]; valid.on('opentag',tag=>tags.push([tag.local,tag.uri])); valid.write('<r xmlns="urn:test"><value>1</value></r>').close();
  assert.deepEqual(tags,[['r','urn:test'],['value','urn:test']]);
  const invalid=new XlsxSaxesParser({xmlns:true});
  assert.throws(()=>invalid.write('<r><value></r>').close());
});
