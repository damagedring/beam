import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

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
});
