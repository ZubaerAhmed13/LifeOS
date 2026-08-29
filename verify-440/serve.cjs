#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'LifeOS_4_3_Advanced_Calendar'));
const port = Number(process.argv[3] || 4173);
let serviceWorkerBuild = 'pwa1';
let originAvailable = true;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/__test/sw-build' && request.method === 'POST') {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      serviceWorkerBuild = String(body || 'pwa1').replace(/[^a-zA-Z0-9._-]/g, '') || 'pwa1';
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
    });
    return;
  }
  if (url.pathname === '/__test/origin-mode' && request.method === 'POST') {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      originAvailable = !String(body).includes('offline');
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
    });
    return;
  }
  if (!originAvailable) {
    request.socket.destroy();
    return;
  }
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`) && file !== path.join(root, 'index.html')) {
    response.writeHead(403); response.end('Forbidden'); return;
  }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end('Not found'); return; }
    if (relative === 'service-worker.js') {
      data = Buffer.from(data.toString('utf8').replace("const CACHE_BUILD = 'pwa1';", `const CACHE_BUILD = '${serviceWorkerBuild}';`));
    }
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': relative === 'service-worker.js' ? 'no-store' : 'no-cache',
      'Service-Worker-Allowed': '/'
    });
    response.end(data);
  });
});

server.listen(port, '127.0.0.1', () => console.log(`LifeOS test server: http://127.0.0.1:${port}`));
