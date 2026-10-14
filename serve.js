'use strict';
/**
 * serve.js: local preview with live reload.
 *
 *   npm run dev      ->  http://localhost:4000
 *
 * Rebuilds (drafts included) whenever content/, static/, lib/, templates.js
 * or site.config.js change, then tells any open tabs to refresh.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { build, ROOT, DIST } = require('./build.js');

const PORT = Number(process.env.PORT) || 4000;
const clients = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
};

function rebuild() {
  try {
    build({ dev: true, drafts: true });
    for (const res of clients) res.write('data: reload\n\n');
  } catch (e) {
    console.error(`build failed: ${e.message}`);
  }
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  // Live-reload channel.
  if (pathname === '/__events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  let file = path.normalize(path.join(DIST, pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  let stat = fs.statSync(file, { throwIfNoEntry: false });
  if (stat && stat.isDirectory()) {
    if (!pathname.endsWith('/')) {
      res.writeHead(301, { Location: pathname + '/' });
      return res.end();
    }
    file = path.join(file, 'index.html');
    stat = fs.statSync(file, { throwIfNoEntry: false });
  }

  if (!stat) {
    const notFound = path.join(DIST, '404.html');
    res.writeHead(404, { 'Content-Type': MIME['.html'] });
    return res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found');
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});

let timer = null;
function watch(rel) {
  const target = path.join(ROOT, rel);
  if (!fs.existsSync(target)) return;
  const isDir = fs.statSync(target).isDirectory();
  fs.watch(target, { recursive: isDir }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  });
}

rebuild();
['content', 'static', 'lib', 'templates.js', 'site.config.js'].forEach(watch);

server.listen(PORT, () => {
  console.log(`Previewing at http://localhost:${PORT}  (drafts shown, live reload on; Ctrl+C to stop)`);
});
