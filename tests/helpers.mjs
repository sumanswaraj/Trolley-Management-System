import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';

export async function fixture(dbPath = ':memory:', options = {}) {
  const app = createApp({
    dbPath,
    adminPassword: 'test-password-123',
    logger: () => {},
    ...options,
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, body, cookie = '', extraHeaders = {}) => {
    const response = await fetch(base + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Cookie: cookie,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      headers: response.headers,
    };
  };
  const admin = (await request('login', { username: 'admin', password: 'test-password-123' }))
    .cookie;
  return {
    ...app,
    base,
    request,
    admin,
    async close() {
      app.server.closeAllConnections();
      await new Promise((resolve) => app.server.close(resolve));
      app.repository.close();
    },
  };
}

export async function prepare(fixture) {
  const { request, admin } = fixture;
  for (const location of [
    { id: 'STORE', name: 'Store' },
    { id: 'LINE', name: 'Line' },
    { id: 'OUT', name: 'Supplier', external: true },
  ]) {
    assert.equal((await request('locations', location, admin)).status, 201);
  }
  assert.equal((await request('products', { id: 'P1', name: 'Gear' }, admin)).status, 201);
  assert.equal(
    (
      await request(
        'trolleys',
        { id: 'TR-001', type: 'Component', capacity: 100, location: 'STORE' },
        admin,
      )
    ).status,
    201,
  );
  for (const [username, role] of [
    ['operator', 'Operator'],
    ['supervisor', 'Supervisor'],
  ]) {
    assert.equal(
      (
        await request(
          'users',
          { username, role, name: username, password: 'test-password-123' },
          admin,
        )
      ).status,
      201,
    );
  }
  const operator = (await request('login', { username: 'operator', password: 'test-password-123' }))
    .cookie;
  const supervisor = (
    await request('login', { username: 'supervisor', password: 'test-password-123' })
  ).cookie;
  return { operator, supervisor };
}
export const movement = (overrides) => ({
  trolley: 'TR-001',
  destination: 'LINE',
  product: 'P1',
  batch: 'B1',
  qty: 50,
  version: 1,
  expected: Date.now() + 3600000,
  key: 'request-1',
  ...overrides,
});
