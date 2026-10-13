import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fixture, prepare } from './helpers.mjs';

async function provision(f) {
  const result = await f.request(
    'readers',
    { id: 'GATE-1', name: 'Line gate', location: 'LINE' },
    f.admin,
  );
  assert.equal(result.status, 201);
  assert.ok(result.body.secret);
  return result.body.secret;
}
async function ingest(f, secret, input, timestamp = Date.now(), overrides = {}) {
  const body = JSON.stringify(input);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const response = await fetch(f.base + '/api/reader-events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': 'GATE-1',
      'X-Device-Timestamp': String(timestamp),
      'X-Device-Signature': signature,
      ...overrides,
    },
    body,
  });
  return { status: response.status, body: await response.json() };
}
const event = (overrides = {}) => ({
  eventId: 'evt-001',
  tag: 'RFID-001',
  observedAt: Date.now(),
  ...overrides,
});

test('reader observation authenticates, maps tags, deduplicates and leaves location unchanged', async () => {
  const f = await fixture(':memory:', { deviceEncryptionKey: '11'.repeat(32) });
  try {
    const { operator } = await prepare(f);
    const secret = await provision(f);
    assert.equal(
      (await f.request('tags', { tag: 'RFID-001', trolley: 'TR-001' }, f.admin)).status,
      200,
    );
    const input = event();
    const first = await ingest(f, secret, input);
    assert.equal(first.status, 201);
    assert.equal(first.body.trolley, 'TR-001');
    assert.equal((await ingest(f, secret, input)).body.duplicate, true);
    assert.equal((await ingest(f, secret, { ...input, tag: 'OTHER' })).status, 409);
    assert.equal(
      (await ingest(f, secret, event({ eventId: 'unknown', tag: 'UNKNOWN' }))).body.trolley,
      null,
    );
    assert.equal(
      (await f.request('state', undefined, operator)).body.trolleys[0].location,
      'STORE',
    );
    const listed = (await f.request('readers', undefined, f.admin)).body;
    assert.equal(listed.events.length, 2);
    assert.ok(!JSON.stringify(listed).includes(secret));
    assert.ok(
      !f.repository.get('SELECT encrypted_secret FROM readers').encrypted_secret.includes(secret),
    );
    assert.equal((await f.request('readers', undefined, operator)).status, 403);
    assert.throws(() => f.db.exec('DELETE FROM reader_events'), /cannot be deleted/);
  } finally {
    await f.close();
  }
});

test('reader signatures reject tampering, stale transmissions and revoked credentials', async () => {
  const f = await fixture(':memory:', { deviceEncryptionKey: '11'.repeat(32) });
  try {
    await prepare(f);
    const secret = await provision(f);
    assert.equal(
      (await ingest(f, secret, event(), Date.now(), { 'X-Device-Signature': '00'.repeat(32) }))
        .status,
      401,
    );
    assert.equal((await ingest(f, secret, event(), Date.now() - 600000)).status, 401);
    assert.equal(
      (await ingest(f, secret, event({ observedAt: Date.now() - 8 * 86400000 }))).status,
      400,
    );
    const rotation = await f.request('readers/rotate', { id: 'GATE-1' }, f.admin);
    assert.equal(rotation.status, 200);
    assert.equal((await ingest(f, secret, event())).status, 401);
    assert.equal((await ingest(f, rotation.body.secret, event())).status, 201);
    assert.equal((await f.request('readers/deactivate', { id: 'GATE-1' }, f.admin)).status, 200);
    assert.equal(
      (await ingest(f, rotation.body.secret, event({ eventId: 'after-revoke' }))).status,
      401,
    );
  } finally {
    await f.close();
  }
});

test('reader provisioning is disabled without a deployment encryption key', async () => {
  const f = await fixture();
  try {
    await prepare(f);
    assert.equal(
      (await f.request('readers', { id: 'GATE-1', name: 'Gate', location: 'LINE' }, f.admin))
        .status,
      503,
    );
    assert.equal((await f.request('readers', undefined, f.admin)).body.configured, false);
    assert.equal((await f.request('state', undefined, f.admin)).status, 200);
  } finally {
    await f.close();
  }
});
