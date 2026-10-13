import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createApp } from '../server.mjs';

async function fixture(dbPath = ':memory:') {
  const app = createApp({ dbPath, adminPassword: 'test-password-123', logger: () => {} });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, body, cookie = '', extraHeaders = {}) => {
    const response = await fetch(base + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  };
  const admin = (await request('login', { username: 'admin', password: 'test-password-123' })).cookie;
  return { ...app, base, request, admin, async close() {
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    app.repository.close();
  } };
}

async function prepare(fixture) {
  const { request, admin } = fixture;
  for (const location of [{ id: 'STORE', name: 'Store' }, { id: 'LINE', name: 'Line' }, { id: 'OUT', name: 'Supplier', external: true }]) {
    assert.equal((await request('locations', location, admin)).status, 201);
  }
  assert.equal((await request('products', { id: 'P1', name: 'Gear' }, admin)).status, 201);
  assert.equal((await request('trolleys', { id: 'TR-001', type: 'Component', capacity: 100, location: 'STORE' }, admin)).status, 201);
  for (const [username, role] of [['operator', 'Operator'], ['supervisor', 'Supervisor']]) {
    assert.equal((await request('users', { username, role, name: username, password: 'test-password-123' }, admin)).status, 201);
  }
  const operator = (await request('login', { username: 'operator', password: 'test-password-123' })).cookie;
  const supervisor = (await request('login', { username: 'supervisor', password: 'test-password-123' })).cookie;
  return { operator, supervisor };
}
const movement = overrides => ({ trolley: 'TR-001', destination: 'LINE', product: 'P1', batch: 'B1', qty: 50, version: 1, expected: Date.now() + 3600000, key: 'request-1', ...overrides });

test('authenticated workflow persists departure, deduplicates retries and confirms receipt once', async () => {
  const f = await fixture();
  try {
    const { operator } = await prepare(f);
    assert.equal((await f.request('state')).status, 401);
    assert.equal((await f.request('locations', { id: 'NO', name: 'No' }, operator)).status, 403);
    const body = movement();
    const first = await f.request('movements', body, operator);
    assert.equal(first.status, 201);
    assert.equal(first.body.state, 'In Transit');
    const repeat = await f.request('movements', body, operator);
    assert.equal(repeat.body.id, first.body.id);
    assert.equal((await f.request('movements', { ...body, qty: 5 }, operator)).status, 409);
    let state = (await f.request('state', undefined, operator)).body;
    assert.equal(state.trolleys[0].location, 'STORE');
    assert.equal(state.trolleys[0].status, 'In Transit');
    assert.equal((await f.request('movements', { ...body, key: 'another', version: 2 }, operator)).status, 409);
    const receipts = await Promise.all([1, 2].map(() => f.request(`movements/${first.body.id}/receive`, {}, operator)));
    assert.deepEqual(receipts.map(result => result.status).sort(), [200, 409]);
    state = (await f.request('state', undefined, operator)).body;
    assert.equal(state.trolleys[0].location, 'LINE');
    assert.equal(state.trolleys[0].version, 3);
    assert.equal(state.movements.length, 1);
    assert.throws(() => f.db.exec('DELETE FROM audit'), /append-only/);
    assert.throws(() => f.db.exec('DELETE FROM movements'), /cannot be deleted/);
    assert.throws(() => f.db.exec("UPDATE movements SET qty = 2"), /immutable/);
  } finally { await f.close(); }
});

test('outside approval requires another manager and rejects unauthorized or duplicate decisions', async () => {
  const f = await fixture();
  try {
    const { operator, supervisor } = await prepare(f);
    const m = await f.request('movements', movement({ destination: 'OUT' }), f.admin);
    assert.equal(m.body.state, 'Pending');
    assert.equal((await f.request(`movements/${m.body.id}/approve`, {}, f.admin)).status, 403);
    assert.equal((await f.request(`movements/${m.body.id}/approve`, {}, operator)).status, 403);
    assert.equal((await f.request(`movements/${m.body.id}/receive`, {}, operator)).status, 409);
    assert.equal((await f.request(`movements/${m.body.id}/approve`, {}, supervisor)).status, 200);
    assert.equal((await f.request(`movements/${m.body.id}/reject`, {}, supervisor)).status, 409);
    assert.equal((await f.request(`movements/${m.body.id}/receive`, {}, operator)).status, 200);
    assert.equal((await f.request('state', undefined, operator)).body.trolleys[0].status, 'Outside Plant');
  } finally { await f.close(); }
});

test('invalid loads, stale versions, cross-origin mutations and duplicate masters are rejected', async () => {
  const f = await fixture();
  try {
    const { operator } = await prepare(f);
    for (const overrides of [{ qty: 101 }, { product: 'UNKNOWN' }, { batch: '' }, { destination: 'STORE' }, { qty: -1 }, { version: 1.5 }]) {
      assert.equal((await f.request('movements', movement(overrides), operator)).status, 400);
    }
    assert.equal((await f.request('movements', movement({ version: 2 }), operator)).status, 409);
    assert.equal((await f.request('locations', { id: 'STORE', name: 'Store' }, f.admin)).status, 409);
    assert.equal((await f.request('logout', {}, operator, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await f.request('state', undefined, operator)).body.movements.length, 0);
    const response = await fetch(f.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(response.status, 400);
  } finally { await f.close(); }
});

test('account deactivation revokes sessions without deleting history', async () => {
  const f = await fixture();
  try {
    const { operator } = await prepare(f);
    const users = (await f.request('users', undefined, f.admin)).body;
    assert.equal((await f.request('users', undefined, operator)).status, 403);
    assert.equal((await f.request('users/deactivate', { id: 1 }, f.admin)).status, 400);
    const id = users.find(user => user.username === 'operator').id;
    assert.equal((await f.request('users/deactivate', { id }, f.admin)).status, 200);
    assert.equal((await f.request('state', undefined, operator)).status, 401);
    assert.equal((await f.request('login', { username: 'operator', password: 'test-password-123' })).status, 401);
  } finally { await f.close(); }
});

test('restart keeps records, existing password and migration versions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trolley-test-'));
  const path = join(directory, 'database.sqlite');
  let f = await fixture(path);
  try {
    await prepare(f);
    await f.close();
    f = await fixture(path);
    const state = (await f.request('state', undefined, f.admin)).body;
    assert.equal(state.trolleys.length, 1);
    assert.equal(f.repository.all('SELECT * FROM schema_migrations').length, 2);
  } finally { await f.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('login throttling and session security headers', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await f.request('login', { username: 'admin', password: 'incorrect' })).status, 401);
    assert.equal((await f.request('login', { username: 'admin', password: 'test-password-123' })).status, 429);
    const state = await f.request('state', undefined, f.admin);
    assert.equal(state.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(state.headers.get('x-request-id'));
  } finally { await f.close(); }
});

test('production static entrypoint serves frontend modules with restrictive CSP', async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.base + '/');
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
    assert.ok((await response.text()).includes('type="module"'));
    for (const path of ['/app.js', '/api.js', '/views.js', '/ui.js']) {
      const module = await fetch(f.base + path);
      assert.equal(module.status, 200);
      assert.equal(module.headers.get('content-type'), 'text/javascript');
    }
    assert.equal((await fetch(f.base + '/server.mjs')).status, 404);
    assert.equal((await fetch(f.base + '/data/trolley.sqlite')).status, 404);
  } finally { await f.close(); }
});

test('online backup restores masters and movement history', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const directory = mkdtempSync(join(tmpdir(), 'trolley-backup-test-'));
  const source = join(directory, 'source.sqlite');
  const destination = join(directory, 'backup.sqlite');
  const f = await fixture(source);
  let restored;
  try {
    const { operator } = await prepare(f);
    assert.equal((await f.request('movements', movement(), operator)).status, 201);
    const script = fileURLToPath(new URL('../scripts/backup.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, source, destination], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    restored = await fixture(destination);
    const state = (await restored.request('state', undefined, restored.admin)).body;
    assert.equal(state.trolleys.length, 1);
    assert.equal(state.movements.length, 1);
    assert.equal(state.movements[0].state, 'In Transit');
  } finally {
    if (restored) await restored.close();
    await f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
