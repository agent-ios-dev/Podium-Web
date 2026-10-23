import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
http.createServer(async (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try {
    const url = new URL(req.url,'http://localhost');
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root,'.'+relative);
    if (!file.startsWith(root+path.sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
    res.writeHead(200).end(bytes);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT||8096),'127.0.0.1',()=>console.log(`Podium Web: http://127.0.0.1:${process.env.PORT||8096}`));
