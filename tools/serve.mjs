import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const types = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.woff2','font/woff2'],['.txt','text/plain; charset=utf-8']]);
const base = new URL('../dist/', import.meta.url);
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const relative = path === '/beam/' ? 'index.html' : path.slice('/beam/'.length);
  const contentType = types.get(extname(relative));
  if (!['GET','HEAD'].includes(request.method) || !path.startsWith('/beam/') || !/^[a-zA-Z0-9_/-]+\.[a-z0-9]+$/.test(relative) || !contentType) {
    response.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(new URL(relative, base));
    response.writeHead(200, { 'content-type': contentType, 'x-content-type-options': 'nosniff' });
    response.end(request.method === 'GET' ? data : undefined);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`Beam: http://127.0.0.1:${port}/beam/`));
