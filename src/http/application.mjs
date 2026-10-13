import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../database.mjs';
import { fail } from '../errors.mjs';
import { sessionCookie } from '../security.mjs';
import { accountService } from '../services/accounts.mjs';
import { masterService } from '../services/masters.mjs';
import { movementService } from '../services/movements.mjs';
import { readJson } from './body.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const STATIC_FILES = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/api.js': ['api.js', 'text/javascript'],
  '/ui.js': ['ui.js', 'text/javascript'],
  '/views.js': ['views.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/prototype': ['prototype.html', 'text/html'],
};

export function createApp({
  dbPath = join(projectRoot, 'data', 'trolley.sqlite'),
  adminPassword = process.env.ADMIN_PASSWORD,
  secureCookie = process.env.SECURE_COOKIE === 'true',
  logger = record => console.log(JSON.stringify(record)),
} = {}) {
  const repository = openDatabase(dbPath);
  let accounts;
  try { accounts = accountService(repository, adminPassword); }
  catch (error) { repository.close(); throw error; }
  const masters = masterService(repository);
  const movements = movementService(repository);

  const server = http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    let pathname = '/';
    const send = (status, data, headers = {}) => {
      response.writeHead(status, {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers,
      });
      response.end(JSON.stringify(data));
    };
    response.setHeader('X-Request-ID', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.on('finish', () => logger({
      event: 'http_request', requestId, method: request.method, path: pathname,
      status: response.statusCode, durationMs: Date.now() - startedAt,
    }));
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/api/')) {
        if (request.method !== 'GET') fail(405, 'Method not allowed');
        const file = STATIC_FILES[pathname];
        if (!file) fail(404, 'Page not found');
        const content = readFileSync(join(projectRoot, 'public', file[0]));
        response.setHeader('Content-Security-Policy', pathname === '/prototype'
          ? "default-src 'self' https: data: blob:; script-src 'self' https: 'unsafe-inline'; style-src 'self' https: 'unsafe-inline'"
          : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
        response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
        return response.end(content);
      }
      if (!['GET', 'POST'].includes(request.method)) fail(405, 'Method not allowed');
      if (pathname === '/api/health' && request.method === 'GET') {
        repository.get('SELECT 1 AS healthy');
        return send(200, { status: 'ok' });
      }
      // Do not trust forwarded headers. The reverse proxy must preserve Host.
      const expectedOrigin = `${secureCookie ? 'https' : 'http'}://${request.headers.host}`;
      if (request.method === 'POST' && request.headers.origin && request.headers.origin !== expectedOrigin) {
        fail(403, 'Cross-origin request blocked');
      }
      const input = request.method === 'POST' ? await readJson(request) : {};
      if (pathname === '/api/login' && request.method === 'POST') {
        const result = accounts.login(input, request.socket.remoteAddress);
        return send(200, result.user, { 'Set-Cookie': sessionCookie(result.token, secureCookie) });
      }
      const { user, token } = accounts.authenticate(request.headers.cookie);
      if (pathname === '/api/me' && request.method === 'GET') return send(200, user);
      if (pathname === '/api/logout' && request.method === 'POST') {
        accounts.logout(user, token);
        return send(200, { ok: true }, { 'Set-Cookie': sessionCookie('', secureCookie, 0) });
      }
      if (pathname === '/api/state' && request.method === 'GET') return send(200, masters.state(user));
      if (pathname === '/api/users' && request.method === 'GET') return send(200, accounts.list(user));
      if (pathname === '/api/users' && request.method === 'POST') {
        accounts.create(user, input);
        return send(201, { ok: true });
      }
      if (pathname === '/api/users/deactivate' && request.method === 'POST') {
        accounts.deactivate(user, input);
        return send(200, { ok: true });
      }
      const masterRoute = pathname.match(/^\/api\/(locations|products|trolleys)$/);
      if (masterRoute && request.method === 'POST') {
        masters.create(user, masterRoute[1], input);
        return send(201, { ok: true });
      }
      if (pathname === '/api/movements' && request.method === 'POST') {
        return send(201, movements.request(user, input));
      }
      const actionRoute = pathname.match(/^\/api\/movements\/(\d+)\/(approve|reject|receive)$/);
      if (actionRoute && request.method === 'POST') {
        return send(200, movements.transition(user, Number(actionRoute[1]), actionRoute[2]));
      }
      fail(404, 'API route not found');
    } catch (error) {
      const conflict = /UNIQUE constraint/.test(error.message);
      const status = error.status || (conflict ? 409 : 500);
      if (status === 500) logger({ event: 'server_error', requestId, error: error.message });
      send(status, {
        error: status === 500 ? 'Server error' : conflict ? 'This record already exists or the trolley has an open movement' : error.message,
        requestId,
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return { server, db: repository.raw, repository };
}
