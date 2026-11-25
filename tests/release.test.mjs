import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { checkDependency, localModuleTarget, moduleReferences, versionModule } from '../tools/module-graph.mjs';

const dist = new URL('../dist/',import.meta.url);
const files = ['.nojekyll','app.css','app.js','assets/OFL-Pretendard.txt','assets/pretendard-variable.woff2',
  'components/print/barcode.js','components/print/inspection-report.js','components/product-identity/view.js','components/product-labels/view.js',
  'domain/browser-recovery.js','domain/carton-verification.js','domain/code128.js','domain/product-identity.js','domain/product-labels.js',
  'domain/reconcile.js','domain/scan-history.js','domain/scanner-input.js','domain/search-keys.js','import/workbook.js','index.html',
  'ui/carton-workspace.js','ui/outbound-receipts.js','ui/translations.js','vendor/xml-parser.js'];
const read=(name)=>readFile(new URL(name,dist),'utf8');

test('static distribution allowlist, syntax and all relative module targets', async () => {
  const entries=await readdir(dist,{recursive:true,withFileTypes:true});
  assert.ok(entries.every(entry=>entry.isDirectory()||entry.isFile()));
  const base=dist.pathname;
  assert.deepEqual(entries.filter(entry=>entry.isFile()).map(entry=>relative(fileURLToPath(dist),join(entry.parentPath,entry.name)).split(sep).join('/')).sort(),files);
  const html=await read('index.html');
  const moduleRevision=html.match(/src="\.\/app\.js\?v=([a-f0-9]{12})"/)?.[1];
  assert.ok(moduleRevision);
  for(const name of files.filter(x=>x.endsWith('.js'))){
    execFileSync(process.execPath,['--check',fileURLToPath(new URL(name,dist))]);
    const text=await read(name);
    for(const { n } of moduleReferences(text, name)){
      const [specifier, revision] = n.split('?');
      assert.equal(revision, 'v='+moduleRevision);
      const target=new URL(n,new URL(name,dist));
      assert.ok(files.includes(target.pathname.slice(base.length)));
      assert.equal(target.search,'?v='+moduleRevision);
      checkDependency(name, localModuleTarget(name, specifier));
    }
  }
});

test('build revision covers multiline imports, side effects, re-exports and literal lazy imports', () => {
  const source = `import {
    entry
  } from './dep.js';
  import './init.js';
  export * from './dep.js';
  export { entry as value } from './dep.js';
  const lazy = () => import('./init.js');
  const url = import.meta.url;`;
  const modules = new Set(['dep.js', 'init.js']);
  const result = versionModule('app.js', source, modules, 'probe');
  assert.deepEqual(moduleReferences(result, 'app.js').map(entry => entry.n), [
    './dep.js?v=probe', './init.js?v=probe', './dep.js?v=probe', './dep.js?v=probe', './init.js?v=probe',
  ]);
  assert.match(result, /import\.meta\.url/);
  assert.throws(() => versionModule('app.js', 'import(path)', modules, 'probe'), /literal/);
  assert.throws(() => versionModule('app.js', 'import "./omitted.js"', modules, 'probe'), /missing allowlisted/);
  assert.throws(() => checkDependency('domain/rules.js', 'platform/storage.js'), /only import other domain/);
  assert.throws(() => checkDependency('features/returns/view.js', 'features/cartons/model.js'), /cross-feature/);
});

test('no runtime network submissions, private branding, or external resource links', async () => {
  const html=await read('index.html');
  const css=await read('app.css');
  const modules=await Promise.all(files.filter(name=>name.endsWith('.js')).map(read));
  for(const policy of ["default-src 'none'","connect-src 'none'","form-action 'none'","script-src-attr 'none'","base-uri 'none'"])assert.ok(html.includes(policy));
  assert.match(html,/<script type="module" src="\.\/app\.js\?v=[a-f0-9]{12}"><\/script>/);
  assert.doesNotMatch(html,/\s(?:src|href)=["'](?:https?:)?\/\//i);
  assert.doesNotMatch(css,/@import\b|url\s*\(\s*["']?(?:https?:)?\/\//i);
  for(const js of modules)assert.doesNotMatch(js,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/);
  for(const source of [html, css, ...modules]){
    assert.doesNotMatch(source,/googletagmanager|adsbygoogle/i);
  }
  assert.match(html,/id="workSidebarToggle"/);
  assert.match(html,/id="dataProfileDetails"/);
  assert.match(css,/::-webkit-scrollbar-track/);
  assert.match(await read('assets/OFL-Pretendard.txt'),/SIL OPEN FONT LICENSE/);
});

test('style URL changes with the deployed CSS bytes', async () => {
  const css=await read('app.css');
  const revision=createHash('sha256').update(css).digest('hex').slice(0,12);
  assert.ok((await read('index.html')).includes(`href="./app.css?v=${revision}"`));
});

test('satin glass uses filter support rather than requiring a transparency preference signal', async () => {
  const css=await read('app.css');
  const layer=css.slice(css.indexOf('@layer beam-satin{'),css.indexOf('/* Profiles read as documents'));
  assert.match(layer,/@media screen and \(forced-colors:none\)\s*\{/);
  assert.doesNotMatch(layer,/prefers-reduced-transparency\s*:\s*no-preference/);
  assert.match(layer,/@supports \(backdrop-filter:blur\(2px\)\) or \(-webkit-backdrop-filter:blur\(2px\)\)/);
  assert.match(layer,/@media \(prefers-reduced-transparency:reduce\)[\s\S]+background:revert-layer!important;[\s\S]+backdrop-filter:none!important/);
});

test('v0.12 keeps the approved desktop foundation outside the declared mobile and input changes',async()=>{
 const [html,css]=await Promise.all([read('index.html'),read('app.css')]);
 const normalized=html.replace(/src="\.\/app\.js\?v=[0-9a-f]{12}"/,'src="./app.js"').replace(/(app\.css\?v=)[0-9a-f]{12}/,'$1'+baselineCssRevision(css)).replace(' · v0.12',' · v0.10')
  .replace('aria-labelledby="beamSearchTitle" tabindex="-1"','aria-labelledby="beamSearchTitle"')
  .replaceAll(' enterkeyhint="search"','').replaceAll(' autocapitalize="off"','').replaceAll(' enterkeyhint="done"','')
  .replace(/<main id="cartonWorkspace"[\s\S]*?<\/dialog>\n/,'')
  .replace(/<dialog id="productLabelDialog"[\s\S]*?<\/dialog>\n/,'')
  .replace(/<button id="productLabelTrigger"[^\n]+\n/,'')
  .replace(/(id="beamHome(?:Outbound|Inventory)Hint") data-ko="[^"]+" data-en="[^"]+">[^<]+/g,'$1 data-ko="준비 중" data-en="Not yet available">준비 중')
  .replace(/<div id="orderTabs" role="group"[^>]+><\/div>\n/,'')
  .replace('<small id="asnNavigationReason">\n</small>\n</section>\n','<small id="asnNavigationReason">\n</small>\n</section>\n<div id="orderTabs" aria-label="다른 오더 시트">\n</div>\n')
  .replace('<div class="scan-product-identity"><span id="lastScannedBrand" class="scan-brand-badge" hidden></span>\n','')
  .replace('</strong>\n</div>\n<div id="lastScannedProgressGroup"','</strong>\n<div id="lastScannedProgressGroup"')
  .replace('<span id="lastScannedPercent"></span>','')
  .replace(/<section id="orderCoverage"[\s\S]*?<span id="asnCoverageDetails"><\/span>\n<\/section>\n/,'')
  .replace(/(<section id="lastScannedPicking"[^>]+>\n<\/section>\n<\/aside>\n<\/div>\n)/,'$1<div class="asn-coverage">\n<progress id="asnProgressBar" max="100" value="0" aria-label="ASN 예정 수량 확인 진행률">\n</progress>\n<span id="asnCoverage">\n</span>\n</div>\n')
  .replace(/  <div id="beamFolderActions" hidden>\n[\s\S]*?  <button type="button" id="beamFolderReceiptOpen"/,'  <button type="button" id="beamFolderReceiptOpen"')
  .replace('  </div>\n  <div id="beamBrowse" hidden>','  <div id="beamBrowse" hidden>')
  .replace(/<button id="mobileExpectedQuantities"[^\n]+\n/,'')
  .replace(/<dialog id="mobileQuantityDialog"[\s\S]*?<\/dialog>\n/,'');
 const sha=value=>createHash('sha256').update(value).digest('hex');
 assert.equal(sha(normalized),'b9874b80234bdc030c8819ba2934ca25f4b391bb7951e130c5868e90ad5c995d');
 assert.equal(sha(withoutPhoneStyle(css)),'cc1868c74b49a556e8f2a8a23d3d204b462d7395eb30c74b2b3316d4e95c23b6');
});
function withoutPhoneStyle(css){return css.slice(0,css.indexOf('#productLabelDialog{')).replace('min-width:0;gap:2px;touch-action:pan-y pinch-zoom}', 'min-width:0;gap:2px}').replace('grid-auto-columns:minmax(0,1fr);gap:1px;min-width:0}', 'grid-auto-columns:minmax(0,1fr);gap:1px;min-width:0;touch-action:pan-y}').replace(/\n\/\* Phone controls stay[\s\S]*?@media print\{#mobileQuantityDialog,#mobileExpectedQuantities\{display:none!important\}\}\n/,'');}
function baselineCssRevision(css){return createHash('sha256').update(withoutPhoneStyle(css)).digest('hex').slice(0,12);}
