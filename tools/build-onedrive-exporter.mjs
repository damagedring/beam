import {lstat,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

function origin(text){
 try{const u=new URL(text);if(u.protocol==='https:'&&u.origin===text&&/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(text))return text;}catch{}
 return '';
}
const env=process.env;
const app=origin(env.BEAM_APP_ORIGIN),own=origin(env.BEAM_ONEDRIVE_EXPORTER_ORIGIN);
if(!app||!own||app===own||own===env.BEAM_DRIVE_EXPORTER_ORIGIN)throw Error('Use distinct canonical HTTPS app, OneDrive exporter and optional Google Drive exporter origins');
const idRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const driveRe=/^(?!\.{1,2}$)[A-Za-z0-9!._-]{1,240}$/;
const publicSettings={appOrigin:app,clientId:env.BEAM_ONEDRIVE_CLIENT_ID||'',kind:env.BEAM_ONEDRIVE_KIND||'',tenantId:env.BEAM_ONEDRIVE_TENANT_ID||'',driveId:env.BEAM_ONEDRIVE_DRIVE_ID||'',folderId:env.BEAM_ONEDRIVE_FOLDER_ID||'',label:env.BEAM_ONEDRIVE_FOLDER_LABEL||''};
const v=publicSettings;
if(!idRe.test(v.clientId)||!['work','personal'].includes(v.kind))throw Error('Set the public Microsoft client ID and personal or work mode');
if(v.kind==='work'&&(!idRe.test(v.tenantId)||!driveRe.test(v.driveId)||!driveRe.test(v.folderId)||!v.label||v.label.trim()!==v.label||v.label.length>160||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(v.label)))throw Error('Set exact work tenant, drive and folder IDs and public destination label');
if(v.kind==='personal'&&(v.tenantId||v.driveId||v.folderId||v.label))throw Error('Personal mode uses only the signed-in account app folder');
async function reviewedBundle(path,hash){
 if(!path||!/^([0-9a-f]{64})$/i.test(hash||''))throw Error('Provide local reviewed standalone MSAL SDK and redirect-bridge bundles with pinned SHA-256');
 const info=await lstat(resolve(path));
 if(!info.isFile()||info.size<15||info.size>10_000_000)throw Error('Invalid reviewed bundle file');
 const data=await readFile(resolve(path));
 if(createHash('sha256').update(data).digest('hex')!==hash.toLowerCase())throw Error('MSAL bundle pin mismatch');
 return data;
}
const sdk=await reviewedBundle(env.BEAM_MSAL_ESM_FILE,env.BEAM_MSAL_ESM_SHA256);
const bridge=await reviewedBundle(env.BEAM_MSAL_BRIDGE_FILE,env.BEAM_MSAL_BRIDGE_SHA256);
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'onedrive-export'),target=join(root,'dist-onedrive-export');
const stage=await mkdtemp(join(root,'.onedrive-export-'));
const esc=text=>text.replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
try{
 for(const f of ['core.mjs','export.mjs','export.css','redirect.html'])await writeFile(join(stage,f),await readFile(join(source,f)));
 let html=await readFile(join(source,'index.html'),'utf8');
 for(const [key,value] of Object.entries(publicSettings)){
  const attr='data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
  if(!html.includes(attr+'=""'))throw Error('Missing configuration marker');
  html=html.replace(attr+'=""',()=>attr+'="'+esc(value)+'"');
 }
 await writeFile(join(stage,'index.html'),html);
 await writeFile(join(stage,'msal-browser.mjs'),sdk);
 await writeFile(join(stage,'msal-redirect-bridge.mjs'),bridge);
 await writeFile(join(stage,'.nojekyll'),'');
 await rm(target,{force:true,recursive:true});await rename(stage,target);
 console.log('Built isolated OneDrive exporter. Do not deploy on the Beam or Google Drive origin.');
}finally{await rm(stage,{force:true,recursive:true});}
