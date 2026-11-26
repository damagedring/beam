import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { checkDependency, localModuleTarget, moduleReferences, versionModule } from '../tools/module-graph.mjs';

const dist = new URL('../dist/',import.meta.url);
const files = ['.nojekyll','LICENSE.txt','app.css','app.js','app/navigation.js','assets/OFL-Geist.txt','assets/OFL-Pretendard.txt','assets/OFL-SourceCodePro.txt',
  'assets/geist-variable.woff2','assets/pretendard-variable.woff2','assets/source-code-pro.woff2',
  'components/folder-reel/view.js','components/inspection-progress/view.js','components/print/barcode.js','components/print/inspection-report.js','components/product-identity/view.js','components/product-labels/view.js',
  'domain/carton-verification.js','domain/code128.js','domain/expected-inventory-status.js','domain/original-order-lookup.js','domain/product-identity.js','domain/product-labels.js',
  'domain/reconcile.js','domain/return-report.js','domain/scan-history.js','domain/scanner-input.js','domain/search-keys.js','features/cartons/model.js','features/cartons/outbound-cartons.js','features/cartons/outbound-receipts.js','features/cartons/reference.js','features/cartons/workspace.js','features/examples/cry-later-assets.js','features/returns/quantities.js','features/returns/recovery.js','features/returns/scan-commands.js','import/mapping/profiles.js','import/workbook.js','index.html',
  'platform/indexed-recovery.js','platform/inspection-input.js','platform/print.js','platform/reference-fingerprint.js','platform/scan-audio.js',
  'ui/notice-strip.js','ui/translations.js','vendor/xml-parser.js'];
const read=(name)=>readFile(new URL(name,dist),'utf8');

test('static distribution allowlist, syntax and all relative module targets', async () => {
  const entries=await readdir(dist,{recursive:true,withFileTypes:true});
  assert.ok(entries.every(entry=>entry.isDirectory()||entry.isFile()));
  const base=dist.pathname;
  assert.deepEqual(entries.filter(entry=>entry.isFile()).map(entry=>relative(fileURLToPath(dist),join(entry.parentPath,entry.name)).split(sep).join('/')).sort(),files);
  assert.equal(await read('LICENSE.txt'), await readFile(new URL('../LICENSE', import.meta.url), 'utf8'));
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
  for(const notice of files.filter(name=>name.startsWith('assets/OFL-')))assert.match(await read(notice),/SIL OPEN FONT LICENSE/);
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
