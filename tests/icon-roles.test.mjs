import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const read=(name)=>readFile(new URL('../dist/'+name,import.meta.url),'utf8');
test('the functional icon family is local, complete and keeps control semantics',async()=>{
 const [html,js]=await Promise.all(['index.html','app.js'].map(read));
 const definitions=[...html.matchAll(/<symbol id="beam-glyph-([\w-]+)" viewBox="0 0 24 24">/g)].map(m=>m[1]);
 assert.ok(definitions.length>=24);
 assert.equal(new Set(definitions).size,definitions.length);
 const roles=new Set(definitions);
 const directRoles=[...html.matchAll(/<use\b[^>]*href="#beam-glyph-([\w-]+)"\/>/g)].map(m=>m[1]);
 assert.ok(directRoles.length>=35);
 for(const role of directRoles)assert.ok(roles.has(role),role);
 for(const role of [...js.matchAll(/beamIcon\('([\w-]+)'\)/g)].map(m=>m[1]))assert.ok(roles.has(role),role);
 const button=(id)=>html.match(new RegExp('<button\\b[^>]*id="'+id+'"[^>]*>[\\s\\S]*?<\\/button>'))?.[0]??'';
 for(const id of ['workSidebarToggle','beamBack','theme','fileMenuButton','beamPrev','beamNext','receiptBarcode','receiptToggle','activeOrderInfo','asnShare','asnPrevious','asnNext','undo','activityMinimize','activityExpand','dataClose','addRaw']){
  assert.match(button(id),/aria-label="[^"]+"/,id);
  assert.match(button(id),/<svg\b[^>]*aria-hidden="true"[^>]*focusable="false"/,id);
 }
 assert.match(button('availabilityToggle'),/role="switch".*aria-checked="false"/);
 assert.match(button('availabilityToggle'),/beam-glyph-eye-open.*beam-glyph-eye-closed/);
 assert.match(button('theme'),/beam-glyph-moon.*beam-glyph-sun/);
 assert.match(js,/class="status-symbol.*beamIcon\('warning'\)/);
 assert.match(js,/beamIcon\(collapsed\?'add':'minus'\)/);
 assert.match(js,/role="img" aria-label="'\+label[^\n]+beamIcon\('check'\)/);
});
