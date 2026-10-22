import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, prepare, movement } from './helpers.mjs';

const enforce = (f, overrides = {}) =>
  f.request(
    'policies/settings',
    {
      enforce_routes: false,
      enforce_categories: false,
      scope_operations: false,
      ...overrides,
    },
    f.admin,
  );

test('capacity units and empty-load declarations cannot be bypassed with an exception', async () => {
  const f = await fixture();
  try {
    const { operator } = await prepare(f);
    await f.request('products', { id: 'KG', name: 'Steel', unit: 'kg', category: 'Raw' }, f.admin);
    assert.equal(
      (
        await f.request(
          'movements',
          movement({ product: 'KG', exceptionReason: 'Please allow kilogram load' }),
          operator,
        )
      ).status,
      400,
    );
    assert.equal((await f.request('movements', movement({ qty: 0 }), operator)).status, 400);
    assert.equal((await f.request('state', undefined, operator)).body.movements.length, 0);
  } finally {
    await f.close();
  }
});

test('route exceptions require a reason and independent approval, with immutable policy snapshot', async () => {
  const f = await fixture();
  try {
    const { operator, supervisor } = await prepare(f);
    await enforce(f, { enforce_routes: true });
    assert.equal((await f.request('movements', movement(), operator)).status, 400);
    const request = movement({ exceptionReason: 'Temporary diversion for line repair' });
    const pending = await f.request('movements', request, operator);
    assert.equal(pending.body.state, 'Pending');
    assert.ok(JSON.parse(pending.body.policy_flags).length);
    const state = (await f.request('state', undefined, operator)).body;
    assert.equal(state.trolleys[0].status, 'Available');
    assert.equal(
      (await f.request(`movements/${pending.body.id}/approve`, {}, supervisor)).status,
      400,
    );
    const approved = await f.request(
      `movements/${pending.body.id}/approve`,
      { reason: 'Diversion checked by supervisor' },
      supervisor,
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.decision_reason, 'Diversion checked by supervisor');
    assert.throws(() => f.db.exec("UPDATE movements SET policy_flags = '[]'"), /immutable/);
    assert.equal((await f.request('policies', undefined, operator)).status, 403);
  } finally {
    await f.close();
  }
});

test('compatible quality routes are held until a different quality user releases them', async () => {
  const f = await fixture();
  try {
    const { operator, supervisor } = await prepare(f);
    await f.request(
      'users',
      { username: 'quality', name: 'Quality', role: 'Quality User', password: 'test-password-123' },
      f.admin,
    );
    const quality = (
      await f.request('login', { username: 'quality', password: 'test-password-123' })
    ).cookie;
    await f.request(
      'policies/categories',
      { trolley_type: 'Component', category: 'Unspecified' },
      f.admin,
    );
    await f.request(
      'policies/routes',
      { source: 'STORE', destination: 'LINE', category: 'Unspecified', requires_quality: true },
      f.admin,
    );
    await enforce(f, { enforce_routes: true, enforce_categories: true });
    const pending = await f.request('movements', movement(), operator);
    assert.equal(pending.body.requires_quality, 1);
    assert.deepEqual(JSON.parse(pending.body.policy_flags), []);
    assert.equal(
      (await f.request(`movements/${pending.body.id}/approve`, {}, supervisor)).status,
      403,
    );
    assert.equal(
      (await f.request(`movements/${pending.body.id}/approve`, {}, quality)).status,
      200,
    );
    assert.equal(
      (await f.request(`movements/${pending.body.id}/receive`, {}, operator)).status,
      200,
    );
  } finally {
    await f.close();
  }
});

test('location permissions restrict departure, receipt and approval on the server', async () => {
  const f = await fixture();
  try {
    const { operator, supervisor } = await prepare(f);
    const users = (await f.request('users', undefined, f.admin)).body;
    const operatorId = users.find((user) => user.username === 'operator').id;
    const supervisorId = users.find((user) => user.username === 'supervisor').id;
    await enforce(f, { scope_operations: true });
    assert.equal((await f.request('movements', movement(), operator)).status, 403);
    await f.request(
      'policies/scopes',
      { user_id: operatorId, location: 'STORE', can_depart: true, can_receive: false },
      f.admin,
    );
    const moved = await f.request('movements', movement(), operator);
    assert.equal(moved.status, 201);
    assert.equal((await f.request(`movements/${moved.body.id}/receive`, {}, operator)).status, 403);
    await f.request(
      'policies/scopes',
      { user_id: supervisorId, location: 'LINE', can_depart: false, can_receive: true },
      f.admin,
    );
    assert.equal(
      (await f.request(`movements/${moved.body.id}/receive`, {}, supervisor)).status,
      200,
    );
    assert.equal(
      (await f.request('policies/settings', { scope_operations: false }, supervisor)).status,
      403,
    );
    assert.equal((await f.request('audit', undefined, operator)).status, 403);
    assert.deepEqual((await f.request('state', undefined, operator)).body.audit, []);
  } finally {
    await f.close();
  }
});

test('quality approval alone cannot authorize an outside-plant movement', async () => {
  const f = await fixture();
  try {
    const { operator } = await prepare(f);
    await f.request(
      'users',
      { username: 'quality', name: 'Quality', role: 'Quality User', password: 'test-password-123' },
      f.admin,
    );
    const quality = (
      await f.request('login', { username: 'quality', password: 'test-password-123' })
    ).cookie;
    await f.request(
      'policies/routes',
      { source: 'STORE', destination: 'OUT', category: 'Unspecified', requires_quality: true },
      f.admin,
    );
    const pending = await f.request('movements', movement({ destination: 'OUT' }), operator);
    assert.equal(
      (await f.request(`movements/${pending.body.id}/approve`, {}, quality)).status,
      403,
    );
    assert.equal(
      (await f.request(`movements/${pending.body.id}/approve`, {}, f.admin)).status,
      200,
    );
  } finally {
    await f.close();
  }
});

test('full histories paginate without omissions and reports count real events', async () => {
  const f = await fixture();
  try {
    const { operator } = await prepare(f);
    for (let index = 0; index < 4; index++) {
      const pending = await f.request(
        'movements',
        movement({ key: `history-${index}`, version: 1, destination: 'OUT' }),
        operator,
      );
      assert.equal(
        (await f.request(`movements/${pending.body.id}/reject`, {}, f.admin)).status,
        200,
      );
    }
    const first = (await f.request('history?limit=2', undefined, operator)).body;
    const second = (
      await f.request(`history?limit=2&before=${first.nextCursor}`, undefined, operator)
    ).body;
    assert.equal(first.items.length, 2);
    assert.equal(second.items.length, 2);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map((record) => record.id)).size, 4);
    assert.equal((await f.request('reports/summary', undefined, operator)).status, 403);
    const report = (await f.request('reports/summary', undefined, f.admin)).body;
    assert.equal(report.totals.requested, 4);
    assert.equal(report.totals.rejected, 4);
    assert.equal((await f.request('history?limit=101', undefined, operator)).status, 400);
    assert.equal(
      (await f.request('reports/summary?from=500&to=100', undefined, operator)).status,
      400,
    );
    assert.equal(
      (await f.request('history?trolley=UNKNOWN', undefined, operator)).body.items.length,
      0,
    );
  } finally {
    await f.close();
  }
});
