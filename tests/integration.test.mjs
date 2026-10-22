import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, prepare, movement } from './helpers.mjs';

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
    assert.equal(
      (await f.request('movements', { ...body, key: 'another', version: 2 }, operator)).status,
      409,
    );
    const receipts = await Promise.all(
      [1, 2].map(() => f.request(`movements/${first.body.id}/receive`, {}, operator)),
    );
    assert.deepEqual(receipts.map((result) => result.status).sort(), [200, 409]);
    state = (await f.request('state', undefined, operator)).body;
    assert.equal(state.trolleys[0].location, 'LINE');
    assert.equal(state.trolleys[0].version, 3);
    assert.equal(state.movements.length, 1);
    assert.throws(() => f.db.exec('DELETE FROM audit'), /append-only/);
    assert.throws(() => f.db.exec('DELETE FROM movements'), /cannot be deleted/);
    assert.throws(() => f.db.exec('UPDATE movements SET qty = 2'), /immutable/);
  } finally {
    await f.close();
  }
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
    assert.equal(
      (await f.request('state', undefined, operator)).body.trolleys[0].status,
      'Outside Plant',
    );
  } finally {
    await f.close();
  }
});

test('invalid loads, stale versions, cross-origin mutations and duplicate masters are rejected', async () => {
  const f = await fixture();
  try {
    const { operator } = await prepare(f);
    for (const overrides of [
      { qty: 101 },
      { product: 'UNKNOWN' },
      { batch: '' },
      { destination: 'STORE' },
      { qty: -1 },
      { version: 1.5 },
    ]) {
      assert.equal((await f.request('movements', movement(overrides), operator)).status, 400);
    }
    assert.equal((await f.request('movements', movement({ version: 2 }), operator)).status, 409);
    assert.equal(
      (await f.request('locations', { id: 'STORE', name: 'Store' }, f.admin)).status,
      409,
    );
    assert.equal(
      (await f.request('logout', {}, operator, { Origin: 'https://untrusted.example' })).status,
      403,
    );
    assert.equal((await f.request('state', undefined, operator)).body.movements.length, 0);
    const response = await fetch(f.base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });
    assert.equal(response.status, 400);
  } finally {
    await f.close();
  }
});

test('account deactivation revokes sessions without deleting history', async () => {
  const f = await fixture();
  try {
    const { operator } = await prepare(f);
    const users = (await f.request('users', undefined, f.admin)).body;
    assert.equal((await f.request('users', undefined, operator)).status, 403);
    assert.equal((await f.request('users/deactivate', { id: 1 }, f.admin)).status, 400);
    const id = users.find((user) => user.username === 'operator').id;
    assert.equal((await f.request('users/deactivate', { id }, f.admin)).status, 200);
    assert.equal((await f.request('state', undefined, operator)).status, 401);
    assert.equal(
      (await f.request('login', { username: 'operator', password: 'test-password-123' })).status,
      401,
    );
  } finally {
    await f.close();
  }
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
    assert.equal(f.repository.all('SELECT * FROM schema_migrations').length, 5);
  } finally {
    await f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('login throttling and session security headers', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await f.request('login', { username: 'admin', password: 'incorrect' })).status,
        401,
      );
    assert.equal(
      (await f.request('login', { username: 'admin', password: 'test-password-123' })).status,
      429,
    );
    const state = await f.request('state', undefined, f.admin);
    assert.equal(state.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(state.headers.get('x-request-id'));
  } finally {
    await f.close();
  }
});

test('production static entrypoint serves frontend modules with restrictive CSP', async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.base + '/');
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
    assert.ok((await response.text()).includes('type="module"'));
    for (const path of [
      '/app.js',
      '/api.js',
      '/experience.js',
      '/experience-ui.js',
      '/experience-shell.js',
      '/operations-model.js',
      '/operations-views.js',
      '/monitoring-views.js',
    ]) {
      const module = await fetch(f.base + path);
      assert.equal(module.status, 200);
      assert.equal(module.headers.get('content-type'), 'text/javascript');
    }
    assert.equal((await fetch(f.base + '/server.mjs')).status, 404);
    assert.equal((await fetch(f.base + '/data/trolley.sqlite')).status, 404);
  } finally {
    await f.close();
  }
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

test('upgrading a version 0.3 database preserves existing masters and load state', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const { createPassword } = await import('../src/security.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'trolley-upgrade-test-'));
  const path = join(directory, 'legacy.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const name of ['001_initial.sql', '002_account_controls.sql']) {
    db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(name, Date.now());
  }
  const password = createPassword('test-password-123');
  db.prepare('INSERT INTO users(username, name, role, salt, password) VALUES (?, ?, ?, ?, ?)').run(
    'admin',
    'Existing admin',
    'Admin',
    password.salt,
    password.hash,
  );
  db.exec("INSERT INTO locations VALUES ('LEGACY', 'Existing store', 0)");
  db.exec("INSERT INTO products VALUES ('P-OLD', 'Existing product')");
  db.exec(
    "INSERT INTO trolleys(id, type, capacity, location, status, product, batch, qty, version) VALUES ('TR-OLD', 'Component', 100, 'LEGACY', 'In Use', 'P-OLD', 'B-OLD', 12, 5)",
  );
  db.close();
  let f;
  try {
    f = await fixture(path);
    const state = (await f.request('state', undefined, f.admin)).body;
    assert.equal(state.user.name, 'Existing admin');
    assert.equal(state.products[0].unit, 'pcs');
    assert.equal(state.products[0].category, 'Unspecified');
    assert.equal(state.trolleys[0].qty, 12);
    assert.equal(state.trolleys[0].version, 5);
    assert.equal(f.repository.get('SELECT enforce_routes FROM plant_settings').enforce_routes, 0);
  } finally {
    if (f) await f.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('QR labels are authenticated and contain no executable inline content', async () => {
  const f = await fixture();
  try {
    await prepare(f);
    assert.equal((await fetch(f.base + '/api/trolleys/TR-001/label')).status, 401);
    const response = await fetch(f.base + '/api/trolleys/TR-001/label', {
      headers: { Cookie: f.admin },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    assert.ok(!(await response.text()).includes('<script'));
    assert.equal((await fetch(f.base + '/prototype')).status, 404);
  } finally {
    await f.close();
  }
});
