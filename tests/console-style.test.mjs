import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const css=await readFile(new URL('../src/styles/workspace.css',import.meta.url),'utf8');
const styles=css.slice(css.indexOf('/* Inspection glass: neutral outer material'));
const readToken=name=>styles.match(new RegExp('--'+name+':(#[0-9a-f]{6})(?:;|\\s)'))?.[1];
const luminance=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255)
 .map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const l=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (l[0]+.05)/(l[1]+.05);};

test('scanner and ledger keep legible status and text over their neutral dark surfaces',()=>{
 assert.match(styles,/@media screen and \(forced-colors:none\)/);
 for(const [ink,bg] of [['scan-text','scan-well'],['scan-hint','scan-well'],['neon-cyan','scan-well']]){
  assert.ok(contrast(readToken(ink),readToken(bg))>=4.5,ink);
 }
 for(const [ink,swatch,panel] of [
  ['complete-ink','neon-lime','#293624'],['lemon-ink','neon-yellow','#353621'],['coral-ink','neon-red','#412d2d'],
 ]){
  assert.match(styles,new RegExp('--'+ink+':var\\(--'+swatch+'\\)'));
  assert.ok(contrast(readToken(swatch),panel)>=4.5,swatch);
 }
 assert.match(styles,/--shortage-ink:var\(--lemon-ink\)/);
 assert.match(styles,/--excess-ink:var\(--coral-ink\)/);
 assert.match(styles,/#scanActivitySection \.compact-activity td\.sheet-status\[data-cell-state=accepted\]\{[^}]*background:var\(--recent-surface\)!important;color:var\(--neon-lime\)!important/);
 assert.match(styles,/--tui-dim:var\(--term-dim\);--muted:var\(--term-dim\)/);
 assert.ok(contrast(readToken('neon-lime'),readToken('recent-surface'))>=4.5);
 assert.ok(contrast('#bdbdbd',readToken('recent-surface'))>=4.5);
});


test('last scan shows a visible quantity, with shortage, equality or surplus spelled out',async()=>{
 const src=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 const fn=src.slice(src.indexOf('function lastScannedCountLabel('),src.indexOf('function drawLastScanned('));
 const label=runInNewContext(fn+'\nlastScannedCountLabel');
 assert.equal(label(1,6,false).quantity,'1 / 6 EA');
 assert.equal(label(1,6,false).detail,'5개 남음');
 assert.equal(label(6,6,false).detail,'수량 일치');
 assert.equal(label(7,6,false).detail,'1개 초과');
 assert.equal(label(1,6,true).detail,'5 remaining');
});


test('normal displays do not paint focus glows while forced contrast and selected cards stay supported',async()=>{
 const glass=await readFile(new URL('../src/styles/glass.css',import.meta.url),'utf8');
 const joined=css+'\n'+glass;
 assert.doesNotMatch(joined,/:focus(?:-visible|-within)?[^{}]*\{[^{}]*(?:box-shadow|filter):\s*(?!none)[^{}]*drop-shadow/);
 assert.match(css,/\(forced-colors:none\)\{\s*html\[data-theme\] body :focus\{outline:none!important/);
 assert.match(css,/\(forced-colors:active\)[^\n]*Highlight/);
 assert.match(glass,/\[data-center=true\] \.beam-file-caption>strong\{font-size:clamp\(24px,3.2vw,38px\)!important/);
});


test('folder captions wrap long store names without trimming them',()=>{
 const caption=css.match(/#beamSearch \.beam-file-caption>strong\{([^}]+)\}/)?.[1]??'';
 assert.match(caption,/white-space:normal/);
 assert.match(caption,/overflow-wrap:anywhere/);
 assert.doesNotMatch(caption,/text-overflow:ellipsis|line-clamp/);
});
