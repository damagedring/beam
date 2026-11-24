import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

const dist = new URL('../dist/',import.meta.url);
const files = ['.nojekyll','app.css','app.js','assets/OFL-Pretendard.txt','assets/pretendard-variable.woff2','domain/browser-recovery.js','domain/code128.js', 'domain/inspection-report.js','domain/reconcile.js','domain/scan-history.js','domain/scanner-input.js','domain/search-keys.js','import/workbook.js','index.html','ui/translations.js','vendor/xml-parser.js'];
const read=(name)=>readFile(new URL(name,dist),'utf8');

test('static distribution allowlist, syntax and all relative module targets', async () => {
  const entries=await readdir(dist,{recursive:true,withFileTypes:true});
  assert.ok(entries.every(entry=>entry.isDirectory()||entry.isFile()));
  const base=decodeURIComponent(dist.pathname);
  assert.deepEqual(entries.filter(entry=>entry.isFile()).map(entry=>relative(fileURLToPath(dist),join(entry.parentPath,entry.name))).sort(),files);
  const html=await read('index.html');
  const moduleRevision=html.match(/src="\.\/app\.js\?v=([a-f0-9]{12})"/)?.[1];
  assert.ok(moduleRevision);
  for(const name of files.filter(x=>x.endsWith('.js'))){
    execFileSync(process.execPath,['--check',new URL(name,dist).pathname]);
    const text=await read(name);
    for(const m of text.matchAll(/^import .* from ["']([^"']+)["']/gm)){
      assert.ok(/^[.]{1,2}\//.test(m[1]));
      const target=new URL(m[1],new URL(name,dist));
      assert.ok(files.includes(target.pathname.slice(base.length)));
      assert.equal(target.search,'?v='+moduleRevision);
    }
  }
});

test('no runtime network submissions, private branding, or external resource links', async () => {
  const html=await read('index.html');
  const css=await read('app.css');
  const js=await read('app.js');
  for(const policy of ["default-src 'none'","connect-src 'none'","form-action 'none'","script-src-attr 'none'","base-uri 'none'"])assert.ok(html.includes(policy));
  assert.match(html,/<script type="module" src="\.\/app\.js\?v=[a-f0-9]{12}"><\/script>/);
  assert.doesNotMatch(html,/\s(?:src|href)=["'](?:https?:)?\/\//i);
  assert.doesNotMatch(css,/@import\b|url\s*\(\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(js,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/);
  for(const source of [html, css, js]){
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
