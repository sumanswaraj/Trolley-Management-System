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
import { labelService } from '../services/labels.mjs';
import { policyService } from '../services/policies.mjs';
import { reportService } from '../services/reports.mjs';
import { readerService } from '../services/readers.mjs';
import { readJson } from './body.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const STATIC_FILES = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/api.js': ['api.js', 'text/javascript'],
  '/ui.js': ['ui.js', 'text/javascript'],
  '/views.js': ['views.js', 'text/javascript'],
  '/scanner.js': ['scanner.js', 'text/javascript'],
  '/policy-views.js': ['policy-views.js', 'text/javascript'],
  '/reader-views.js': ['reader-views.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
};

export function createApp({
  dbPath = join(projectRoot, 'data', 'trolley.sqlite'),
  adminPassword = process.env.ADMIN_PASSWORD,
  secureCookie = process.env.SECURE_COOKIE === 'true',
  deviceEncryptionKey = process.env.DEVICE_ENCRYPTION_KEY,
  logger = (record) => console.log(JSON.stringify(record)),
} = {}) {
  const repository = openDatabase(dbPath);
  let accounts;
  try {
    accounts = accountService(repository, adminPassword);
  } catch (error) {
    repository.close();
    throw error;
  }
  const masters = masterService(repository);
  const policies = policyService(repository);
  const movements = movementService(repository, policies);
  const reports = reportService(repository);
  const labels = labelService(repository);
  let readers;
  try {
    readers = readerService(repository, deviceEncryptionKey);
  } catch (error) {
    repository.close();
    throw error;
  }

  const server = http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    let pathname = '/';
    const send = (status, data, headers = {}) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...headers,
      });
      response.end(JSON.stringify(data));
    };
    response.setHeader('X-Request-ID', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    response.on('finish', () =>
      logger({
        event: 'http_request',
        requestId,
        method: request.method,
        path: pathname,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      }),
    );
    try {
      const url = new URL(request.url, 'http://localhost');
      pathname = url.pathname;
      if (!pathname.startsWith('/api/')) {
        if (request.method !== 'GET') fail(405, 'Method not allowed');
        if (pathname === '/vendor/jsqr.js') {
          const content = readFileSync(join(projectRoot, 'node_modules/jsqr/dist/jsQR.js'));
          response.setHeader('Cache-Control', 'public, max-age=3600');
          response.writeHead(200, { 'Content-Type': 'text/javascript' });
          return response.end(content);
        }
        const file = STATIC_FILES[pathname];
        if (!file) fail(404, 'Page not found');
        const content = readFileSync(join(projectRoot, 'public', file[0]));
        response.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        );
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
      if (
        request.method === 'POST' &&
        request.headers.origin &&
        request.headers.origin !== expectedOrigin
      ) {
        fail(403, 'Cross-origin request blocked');
      }
      const input = request.method === 'POST' ? await readJson(request) : {};
      if (pathname === '/api/login' && request.method === 'POST') {
        const result = accounts.login(input, request.socket.remoteAddress);
        return send(200, result.user, { 'Set-Cookie': sessionCookie(result.token, secureCookie) });
      }
      if (pathname === '/api/reader-events' && request.method === 'POST') {
        return send(201, readers.ingest(request.headers, request.rawBody, input));
      }
      const { user, token } = accounts.authenticate(request.headers.cookie);
      const labelRoute = pathname.match(/^\/api\/trolleys\/([^/]+)\/label$/);
      if (labelRoute && request.method === 'GET') {
        let id;
        try {
          id = decodeURIComponent(labelRoute[1]);
        } catch {
          fail(400, 'Invalid trolley ID');
        }
        const svg = await labels.svg(id);
        response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
        return response.end(svg);
      }
      if (pathname === '/api/me' && request.method === 'GET') return send(200, user);
      if (pathname === '/api/logout' && request.method === 'POST') {
        accounts.logout(user, token);
        return send(200, { ok: true }, { 'Set-Cookie': sessionCookie('', secureCookie, 0) });
      }
      if (pathname === '/api/state' && request.method === 'GET')
        return send(200, masters.state(user));
      if (pathname === '/api/policies' && request.method === 'GET')
        return send(200, policies.describe(user));
      if (pathname === '/api/policies/settings' && request.method === 'POST') {
        policies.configure(user, input);
        return send(200, { ok: true });
      }
      const policyRoute = pathname.match(/^\/api\/policies\/(categories|routes|scopes)$/);
      if (policyRoute && request.method === 'POST') {
        policies.addRule(user, policyRoute[1], input);
        return send(200, { ok: true });
      }
      if (pathname === '/api/history' && request.method === 'GET')
        return send(200, reports.history(user, 'movements', url.searchParams));
      if (pathname === '/api/audit' && request.method === 'GET')
        return send(200, reports.history(user, 'audit', url.searchParams));
      if (pathname === '/api/reports/summary' && request.method === 'GET')
        return send(200, reports.summary(user, url.searchParams));
      if (pathname === '/api/readers' && request.method === 'GET')
        return send(200, readers.list(user));
      if (pathname === '/api/readers' && request.method === 'POST')
        return send(201, readers.create(user, input));
      if (pathname === '/api/readers/rotate' && request.method === 'POST')
        return send(200, readers.rotate(user, input));
      if (pathname === '/api/readers/deactivate' && request.method === 'POST') {
        readers.deactivate(user, input);
        return send(200, { ok: true });
      }
      if (pathname === '/api/tags' && request.method === 'POST') {
        readers.assignTag(user, input);
        return send(200, { ok: true });
      }
      if (pathname === '/api/users' && request.method === 'GET')
        return send(200, accounts.list(user));
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
        return send(200, movements.transition(user, Number(actionRoute[1]), actionRoute[2], input));
      }
      fail(404, 'API route not found');
    } catch (error) {
      const conflict = /UNIQUE constraint/.test(error.message);
      const status = error.status || (conflict ? 409 : 500);
      if (status === 500) logger({ event: 'server_error', requestId, error: error.message });
      send(status, {
        error:
          status === 500
            ? 'Server error'
            : conflict
              ? 'This record already exists or the trolley has an open movement'
              : error.message,
        requestId,
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return { server, db: repository.raw, repository };
}
