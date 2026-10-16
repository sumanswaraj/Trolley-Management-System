import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.mjs';
import { reportService } from '../src/services/reports.mjs';

const DAY = 86400000;
const HOUR = 3600000;
const admin = { id: 1, role: 'Admin' };
const operator = { id: 2, role: 'Operator' };
const params = (values = {}) => new URLSearchParams(values);

function setup() {
  const repository = openDatabase(':memory:');
  for (const [id, username, name, role] of [
    [1, 'admin', 'Plant administrator', 'Admin'],
    [2, 'jane', 'Jane Rao', 'Operator'],
  ]) {
    repository.run(
      'INSERT INTO users(id, username, name, role, salt, password) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      username,
      name,
      role,
      '',
      '',
    );
  }
  for (const [id, name, external] of [
    ['STORE', 'Main store', 0],
    ['LINE', 'Assembly line', 0],
    ['OUT', 'Supplier yard', 1],
  ]) {
    repository.run(
      'INSERT INTO locations(id, name, external, department, bay_capacity) VALUES (?, ?, ?, ?, ?)',
      id,
      name,
      external,
      'Production',
      10,
    );
  }
  repository.run("INSERT INTO products(id, name) VALUES ('P1', 'Precision gear')");
  for (const [id, location, status] of [
    ['TR-001', 'STORE', 'Available'],
    ['TR-002', 'OUT', 'Outside Plant'],
    ['TR-003', 'LINE', 'In Use'],
  ]) {
    repository.run(
      'INSERT INTO trolleys(id, type, capacity, location, status, product, batch, qty, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      'Component',
      100,
      location,
      status,
      status === 'Available' ? null : 'P1',
      status === 'Available' ? '' : 'B1',
      status === 'Available' ? 0 : 10,
      Date.now() - 10 * DAY,
    );
  }
  let sequence = 0;
  const movement = (overrides = {}) => {
    sequence += 1;
    const row = {
      trolley: 'TR-001',
      source: 'STORE',
      destination: 'LINE',
      product: 'P1',
      batch: 'B1',
      qty: 10,
      state: 'Received',
      requested_by: 2,
      approved_by: 1,
      received_by: 2,
      created: Date.now() - HOUR,
      expected: Date.now() + HOUR,
      received: Date.now(),
      key: `report-${sequence}`,
      payload: '{}',
      version: 1,
      movement_type: 'Transfer',
      operator_name: 'Jane Rao',
      ...overrides,
    };
    row.occurred_at ??= row.created;
    const fields = Object.keys(row);
    const result = repository.run(
      `INSERT INTO movements(${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
      ...Object.values(row),
    );
    return Number(result.lastInsertRowid);
  };
  return { repository, reports: reportService(repository), movement };
}

test('history filters search recorded fields and preserve pagination and audit access', () => {
  const f = setup();
  try {
    const first = f.movement({
      created: Date.parse('2026-10-15T23:59:59.999Z'),
      movement_type: 'Issue',
      reason: 'Scheduled gear issue',
    });
    const second = f.movement({
      source: 'LINE',
      destination: 'STORE',
      created: Date.parse('2026-10-16T00:00:00Z'),
      movement_type: 'Return',
    });
    const third = f.movement({
      trolley: 'TR-003',
      created: Date.parse('2026-10-16T23:59:59.999Z'),
      state: 'Rejected',
      received: null,
      remarks: 'Inventory 100% complete',
    });
    const history = (query) => f.reports.history(operator, 'movements', params(query));
    assert.equal(history({ q: 'precision GEAR' }).items.length, 3);
    assert.equal(history({ q: '100%' }).items[0].id, third);
    assert.equal(history({ q: '_' }).items.length, 0);
    assert.deepEqual(
      history({
        trolley: '001',
        location: 'STORE',
        operator: '2',
        product: 'P1',
        type: 'Return',
        status: 'Completed',
      }).items.map((row) => row.id),
      [second],
    );
    assert.equal(history({ operator: 'Jane Rao' }).items.length, 3);
    assert.equal(history({ operator: 'jane' }).items.length, 3);
    assert.deepEqual(
      history({ from: '2026-10-16', to: '2026-10-16' }).items.map((row) => row.id),
      [third, second],
    );
    assert.deepEqual(
      history({ type: 'Issue' }).items.map((row) => row.id),
      [first],
    );
    const page = history({ trolley: '001', limit: '1' });
    assert.equal(page.nextCursor, second);
    assert.deepEqual(
      history({ trolley: '001', limit: '1', before: page.nextCursor }).items.map((row) => row.id),
      [first],
    );
    assert.throws(() => history({ from: '2026-02-30' }), /Invalid start time/);
    assert.throws(() => history({ from: '2026-10-17', to: '2026-10-16' }), /Start time/);
    f.repository.audit(admin, 'Supervisor override', 'TR-001', {
      reason: 'Urgent material release',
    });
    assert.equal(f.reports.history(admin, 'audit', params({ q: 'urgent' })).items.length, 1);
    assert.equal(f.reports.history(admin, 'audit', params({ q: 'administrator' })).items.length, 1);
    assert.throws(() => f.reports.history(operator, 'audit', params()), /role cannot/);
  } finally {
    f.repository.close();
  }
});

test('eight reports expose complete data, batches, actual exceptions and outside approval', () => {
  const f = setup();
  try {
    f.movement({
      trolley: 'TR-002',
      destination: 'OUT',
      created: Date.now() - 3 * HOUR,
      received: Date.now() - 3 * HOUR,
      expected: Date.now() - HOUR,
    });
    f.repository.run(
      "INSERT INTO alerts(type, priority, trolley, location, message, source, created, created_by, updated) VALUES ('Wrong product', 'High', 'TR-002', 'OUT', 'Observed gear label mismatch', 'Verification', ?, 2, ?)",
      Date.now(),
      Date.now(),
    );
    for (let index = 0; index < 512; index++) f.movement({ state: 'Rejected', received: null });
    const catalogue = f.reports.catalogue(operator);
    assert.equal(catalogue.reports.length, 8);
    for (const { id } of catalogue.reports) {
      const report = f.reports.catalogue(operator, id);
      assert.equal(report.kind, id);
      assert.equal(report.timezone, 'UTC');
      for (const row of report.rows) assert.equal(row.length, report.columns.length);
    }
    assert.equal(f.reports.catalogue(operator, 'hist').rows.length, 513);
    assert.equal(f.reports.catalogue(operator, 'hist', params({ trolley: '002' })).rows.length, 1);
    const outside = f.reports.catalogue(operator, 'out');
    assert.equal(outside.rows[0].at(-1), 'Plant administrator');
    assert.ok(f.reports.catalogue(operator, 'over').rows.some((row) => row[0] === 'TR-002'));
    assert.equal(
      f.reports.catalogue(operator, 'exc').rows[0].at(-1),
      'Observed gear label mismatch',
    );
    assert.equal(f.reports.catalogue(operator, 'prod').rows[0][2], 'B1');
    assert.throws(() => f.reports.catalogue(operator, 'unknown'), /Unknown report/);
  } finally {
    f.repository.close();
  }
});

test('analytics uses confirmed arrivals and completed returns, with no synthetic observations', (t) => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const f = setup();
  try {
    const start = now - 3 * DAY;
    f.movement({ created: start, expected: start + 2 * HOUR, received: start + HOUR });
    f.movement({
      source: 'LINE',
      destination: 'STORE',
      created: start + 4 * HOUR,
      received: start + 5 * HOUR,
      expected: start + 8 * HOUR,
      movement_type: 'Return',
    });
    f.movement({
      trolley: 'TR-002',
      destination: 'OUT',
      created: now - DAY - 2 * HOUR,
      received: now - DAY - HOUR,
      expected: now - 2 * HOUR,
    });
    f.movement({
      trolley: 'TR-003',
      created: now - HOUR,
      expected: now + HOUR,
      received: now - HOUR / 2,
    });
    f.movement({ state: 'Rejected', received: null, created: now - 1 });
    const analytics = f.reports.analytics(operator, params({ from: now - 4 * DAY, to: now }));
    assert.equal(
      analytics.daily.reduce((sum, item) => sum + item.count, 0),
      4,
    );
    assert.equal(
      analytics.weekly.reduce((sum, item) => sum + item.count, 0),
      4,
    );
    assert.equal(
      analytics.arrivals.reduce((sum, item) => sum + item.count, 0),
      1,
    );
    assert.deepEqual(analytics.topTrolleys[0], { trolley: 'TR-001', count: 2 });
    assert.equal(analytics.turnaround.completedCycles, 1);
    assert.equal(analytics.turnaround.meanMs, 5 * HOUR);
    assert.equal(analytics.turnaround.daily.filter((item) => item.meanMs !== null).length, 1);
    assert.equal(analytics.overdue.daily.at(-1).count, 1);
    assert.equal(analytics.fleet.find((item) => item.status === 'Overdue').count, 1);
    assert.equal(
      analytics.distribution.reduce((sum, item) => sum + item.count, 0),
      3,
    );
    assert.deepEqual(analytics.flow, [{ source: 'STORE', destination: 'LINE', count: 1 }]);
    assert.throws(
      () => f.reports.analytics(operator, params({ from: '0', to: String(now) })),
      /ten years/,
    );
  } finally {
    f.repository.close();
  }
});

test('empty analytics reports zero recorded activity and no turnaround estimate', () => {
  const f = setup();
  try {
    f.repository.run(
      "UPDATE trolleys SET status = 'Available', product = NULL, batch = '', qty = 0",
    );
    const analytics = f.reports.analytics(operator);
    assert.ok(analytics.daily.every((item) => item.count === 0));
    assert.ok(analytics.overdue.daily.every((item) => item.count === 0));
    assert.equal(analytics.turnaround.meanMs, null);
    assert.equal(analytics.turnaround.completedCycles, 0);
    assert.deepEqual(analytics.topTrolleys, []);
    assert.deepEqual(analytics.flow, []);
  } finally {
    f.repository.close();
  }
});

test('current overdue honors active request deadlines and location holding limits', (t) => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const f = setup();
  try {
    f.movement({
      trolley: 'TR-002',
      destination: 'OUT',
      created: now - 5 * HOUR,
      received: now - 4 * HOUR,
      expected: now + DAY,
    });
    f.movement({
      trolley: 'TR-003',
      created: now - HOUR,
      received: now - HOUR / 2,
      expected: now - HOUR,
    });
    f.movement({
      trolley: 'TR-001',
      state: 'Pending',
      created: now - 3 * HOUR,
      received: null,
      expected: now - HOUR,
    });
    const rows = f.reports.catalogue(operator, 'over').rows;
    assert.deepEqual(
      rows.map((row) => row[0]),
      ['TR-002', 'TR-001'],
    );
    assert.equal(rows[0][2], new Date(now - 2 * HOUR).toISOString());
    assert.equal(f.reports.analytics(operator).overdue.daily.at(-1).count, 2);
  } finally {
    f.repository.close();
  }
});
