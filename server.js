// Minimal static server: ES modules need an http origin, and this keeps the
// project dependency-free.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = import.meta.dirname;
const port = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const requested = normalize(url === '/' ? '/index.html' : url);
  const path = join(root, requested);
  if (!path.startsWith(root)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden');
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => console.log(`serving http://localhost:${port}`));
