import { readFile } from 'node:fs/promises';
import { createWorkspaceServer } from '../workspaces/server.mjs';

const configFile=process.env.BEAM_WORKSPACE_CONFIG;
if(!configFile)throw Error('Set BEAM_WORKSPACE_CONFIG to an operator-owned file outside the checkout.');
const origin=process.env.BEAM_WORKSPACE_ORIGIN||'http://127.0.0.1:4173';
const url=new URL(origin),port=Number(process.env.PORT||(url.protocol==='http:'?url.port:4173));
if(!Number.isInteger(port)||port<1||port>65535||(url.protocol==='http:'&&Number(url.port)!==port))throw Error('Set a valid local port.');
const config=JSON.parse(await readFile(configFile,'utf8'));
await readFile(new URL('../dist/index.html',import.meta.url));
const server=createWorkspaceServer({origin,config});
server.listen(port,'127.0.0.1',()=>console.log('Beam workspace service listening on loopback. Open '+origin+'/beam/workspaces/'));
