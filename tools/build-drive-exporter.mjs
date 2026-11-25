import {cp,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pinnedOrigin} from '../drive-export/core.mjs';
import {copyBeamLicense} from './copy-license.mjs';

const appOrigin=pinnedOrigin(process.env.BEAM_APP_ORIGIN);
const exporterOrigin=pinnedOrigin(process.env.BEAM_DRIVE_EXPORTER_ORIGIN);
const oauthClient=process.env.BEAM_DRIVE_OAUTH_CLIENT_ID??'';
const pickerKey=process.env.BEAM_DRIVE_PICKER_API_KEY??'',pickerProject=process.env.BEAM_DRIVE_PICKER_PROJECT_NUMBER??'';
if((pickerKey||pickerProject)&&(!/^[A-Za-z0-9_-]{24,100}$/.test(pickerKey)||!/^\d{5,24}$/.test(pickerProject)))throw Error('Set both restricted Picker browser API key and numeric Google Cloud project number, or neither');
if(!appOrigin||!exporterOrigin||appOrigin===exporterOrigin||!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(appOrigin)||!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(exporterOrigin)||!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(oauthClient))throw Error('Set two distinct canonical HTTPS origins and the public Google OAuth web client ID');
const root=fileURLToPath(new URL('../',import.meta.url));
const input=join(root,'drive-export'),destination=join(root,'dist-drive-export');
const stage=await mkdtemp(join(root,'.drive-export-'));
try{
 for(const name of ['export.css','export.mjs','core.mjs'])await cp(join(input,name),join(stage,name),{errorOnExist:true});
 let markup=await readFile(join(input,'index.html'),'utf8');
 const marker='data-app-origin="" data-oauth-client-id="" data-picker-api-key="" data-picker-project=""';
 if(!markup.includes(marker))throw Error('Missing exporter configuration slots');
 markup=markup.replace(marker,`data-app-origin="${appOrigin}" data-oauth-client-id="${oauthClient}" data-picker-api-key="${pickerKey}" data-picker-project="${pickerProject}"`);
 // Picker's loader and iframe are allowed only in configured export builds.
 if(pickerKey)markup=markup
  .replace("https://accounts.google.com/gsi/client;","https://accounts.google.com/gsi/client https://apis.google.com;")
  .replace("https://accounts.google.com/gsi/style;","https://accounts.google.com/gsi/style 'unsafe-inline';")
  .replace("frame-src https://accounts.google.com/gsi/;","frame-src https://accounts.google.com/gsi/ https://docs.google.com;")
  .replace("https://www.googleapis.com/upload/drive/v3/files;","https://www.googleapis.com/upload/drive/v3/files https://www.googleapis.com/drive/v3/files/;");
 await writeFile(join(stage,'index.html'),markup);
 await writeFile(join(stage,'.nojekyll'),'');
 await copyBeamLicense(stage);
 await rm(destination,{force:true,recursive:true});
 await rename(stage,destination);
 console.log('Built standalone Google Drive exporter. Do not publish this on the Beam app origin.');
}finally{await rm(stage,{force:true,recursive:true});}
