'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'callback');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

http
  .createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const relative =
      pathname === '/' || pathname === '/callback/'
        ? 'index.html'
        : pathname.replace(/^\/callback\//, '');
    const file = path.resolve(root, relative);
    if (
      !file.startsWith(root) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.setHeader(
      'Content-Type',
      contentTypes[path.extname(file)] || 'application/octet-stream'
    );
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    fs.createReadStream(file).pipe(response);
  })
  .listen(8899, '127.0.0.1', () => {
    console.log('Callback test server: http://127.0.0.1:8899/callback/');
    console.log('Local mechanics test only; Meta OAuth must use a deployed HTTPS URL.');
  });
