import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { openDatabase } from '../src/database.mjs';
import { operationService } from '../src/services/operations.mjs';
import { policyService } from '../src/services/policies.mjs';
import { readerService } from '../src/services/readers.mjs';

function setup(filename = ':memory:') {
  const repository = openDatabase(filename);
  for (const [id, role] of [
    [1, 'Admin'],
    [2, 'Operator'],
    [3, 'Supervisor'],
    [4, 'Quality User'],
    [5, 'Plant Manager'],
  ]) {
    repository.run(
      'INSERT INTO users(id, username, name, role, salt, password) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      `user${id}`,
      `User ${id}`,
      role,
      'test',
      'test',
    );
  }
  repository.run("INSERT INTO locations(id, name) VALUES ('STORE', 'Store'), ('LINE', 'Line')");
  repository.run(
    "INSERT INTO products(id, name, category, unit) VALUES ('P1', 'Gear', 'Components', 'pcs'), ('P2', 'Bolt', 'Hardware', 'pcs')",
  );
  repository.run(
    `INSERT INTO trolleys(id, type, capacity, location, product, qty, batch)
    VALUES ('TR-001', 'Component', 100, 'STORE', 'P1', 10, 'B1')`,
  );
  const users = Object.fromEntries(
    repository.all('SELECT id, role, name FROM users').map((user) => [user.role, user]),
  );
  return { repository, operations: operationService(repository, policyService(repository)), users };
}

function overdue(repository, expected = Date.now() - 3 * 3600000) {
  return Number(
    repository.run(
      `INSERT INTO movements(trolley, source, destination, product, batch, qty, state,
      requested_by, created, expected, key, payload, version)
      VALUES ('TR-001', 'STORE', 'LINE', 'P1', 'B1', 10, 'In Transit', 2, ?, ?, 'overdue', '{}', 1)`,
      expected - 3600000,
      expected,
    ).lastInsertRowid,
  );
}

const status = (code) => (error) => error.status === code;

test('incident reports deduplicate, enforce alert roles and preserve trolley state', () => {
  const { repository, operations, users } = setup();
  try {
    const before = repository.get('SELECT * FROM trolleys');
    const input = {
      type: 'Trolley missing',
      trolley: 'TR-001',
      priority: 'High',
      message: 'The trolley is absent from its assigned bay.',
    };
    const alert = operations.report(users.Operator, input);
    assert.equal(operations.report(users.Operator, input).id, alert.id);
    assert.equal(repository.get('SELECT count(*) AS count FROM alerts').count, 1);
    assert.throws(
      () => operations.updateAlert(users.Operator, alert.id, { status: 'Resolved' }),
      status(403),
    );
    const acknowledged = operations.updateAlert(users['Quality User'], alert.id, {
      status: 'Acknowledged',
    });
    assert.equal(acknowledged.acknowledged_by, users['Quality User'].id);
    const resolved = operations.updateAlert(users['Plant Manager'], alert.id, {
      status: 'Resolved',
      remarks: 'Located in the adjacent bay.',
    });
    assert.ok(resolved.resolved_at);
    assert.equal(resolved.resolved_by, users['Plant Manager'].id);
    assert.deepEqual(repository.get('SELECT * FROM trolleys'), before);
    assert.equal(
      repository.get("SELECT count(*) AS count FROM audit WHERE action LIKE 'Alert %'").count,
      3,
    );
    assert.throws(
      () => operations.report(users.Operator, { ...input, type: 'Unrecognized incident' }),
      status(400),
    );
  } finally {
    repository.close();
  }
});

test('automatic overdue alerts reopen, escalate and clear without duplicate notifications', () => {
  const { repository, operations, users } = setup();
  try {
    const movementId = overdue(repository);
    const first = operations.state(users.Operator);
    const alert = first.alerts.find((record) => record.type === 'Trolley overdue');
    assert.equal(alert.priority, 'Critical');
    assert.equal(alert.system_key, `overdue:${movementId}`);
    operations.state(users.Operator);
    assert.equal(repository.get('SELECT count(*) AS count FROM alerts').count, 2);
    assert.equal(repository.get('SELECT count(*) AS count FROM notifications').count, 10);
    operations.updateAlert(users.Supervisor, alert.id, { status: 'Resolved' });
    assert.equal(
      operations.state(users.Operator).alerts.find((record) => record.id === alert.id).status,
      'Open',
    );
    assert.equal(repository.get('SELECT count(*) AS count FROM alerts').count, 2);
    repository.run(
      "UPDATE movements SET state = 'Received', received = ? WHERE id = ?",
      Date.now(),
      movementId,
    );
    assert.ok(
      operations.state(users.Operator).alerts.every((record) => record.status === 'Resolved'),
    );
    assert.equal(repository.get('SELECT location FROM trolleys').location, 'STORE');
  } finally {
    repository.close();
  }
});

test('holding deadlines use arrival and location policy while active movement deadlines take precedence', () => {
  const { repository, operations, users } = setup();
  try {
    const now = Date.now();
    repository.run("UPDATE locations SET expected_minutes = 30 WHERE id = 'STORE'");
    repository.run("UPDATE trolleys SET status = 'In Use'");
    const arrived = Number(
      repository.run(
        `INSERT INTO movements(trolley, source, destination, product, batch, qty, state,
      requested_by, created, expected, received, key, payload, version)
      VALUES ('TR-001', 'LINE', 'STORE', 'P1', 'B1', 10, 'Received', 2, ?, ?, ?, 'arrived', '{}', 1)`,
        now - 3 * 3600000,
        now + 86400000,
        now - 3600000,
      ).lastInsertRowid,
    );
    const held = operations.state(users.Operator).alerts[0];
    assert.equal(held.system_key, `held:${arrived}:STORE`);
    assert.equal(held.status, 'Open');
    assert.equal(operations.remind(users.Supervisor, 'TR-001').recipient, users.Operator.id);
    assert.throws(() => operations.remind(users.Supervisor, 'TR-001'), status(429));
    const active = overdue(repository, now + 3600000);
    repository.run("UPDATE movements SET state = 'Pending' WHERE id = ?", active);
    assert.equal(operations.state(users.Operator).alerts[0].status, 'Resolved');
    assert.throws(() => operations.remind(users.Supervisor, 'TR-001'), status(409));
    repository.run("UPDATE movements SET state = 'Rejected' WHERE id = ?", active);
    assert.equal(operations.state(users.Operator).alerts[0].status, 'Open');
    repository.run("UPDATE trolleys SET status = 'Available'");
    assert.equal(operations.state(users.Operator).alerts[0].status, 'Resolved');
  } finally {
    repository.close();
  }
});

test('automatic alert priorities escalate as the overdue time increases', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { repository, operations, users } = setup();
  try {
    overdue(repository, Date.now() - 20 * 60000);
    const priority = () =>
      operations.state(users.Operator).alerts.find((record) => record.type === 'Trolley overdue')
        .priority;
    assert.equal(priority(), 'Medium');
    context.mock.timers.tick(3600000);
    assert.equal(priority(), 'High');
    context.mock.timers.tick(3600000);
    assert.equal(priority(), 'Critical');
    assert.equal(repository.get('SELECT count(*) AS count FROM notifications').count, 10);
    assert.equal(
      repository.get("SELECT count(*) AS count FROM audit WHERE action = 'Automatic alert updated'")
        .count,
      2,
    );
  } finally {
    repository.close();
  }
});

test('legacy held trolleys use creation time and cannot notify an unknown responsible user', () => {
  const { repository, operations, users } = setup();
  try {
    repository.run(
      "UPDATE trolleys SET status = 'Maintenance', created = ?",
      Date.now() - 3 * 3600000,
    );
    const alert = operations
      .state(users.Operator)
      .alerts.find((record) => record.type === 'Trolley overdue');
    assert.equal(alert.system_key, 'initial:TR-001:STORE');
    assert.equal(alert.status, 'Open');
    assert.throws(() => operations.remind(users.Supervisor, 'TR-001'), status(409));
    assert.equal(repository.get('SELECT count(*) AS count FROM reminders').count, 0);
  } finally {
    repository.close();
  }
});

test('tag maintenance alerts reopen after recurrence and product location rules flag scans', () => {
  const { repository, operations, users } = setup();
  try {
    repository.run("UPDATE trolleys SET tag_condition = 'Missing'");
    const alert = operations.state(users.Operator).alerts[0];
    assert.equal(alert.type, 'Trolley maintenance due');
    assert.equal(alert.priority, 'High');
    repository.run("UPDATE trolleys SET tag_condition = 'Good'");
    assert.equal(operations.state(users.Operator).alerts[0].status, 'Resolved');
    repository.run("UPDATE trolleys SET tag_condition = 'Damaged'");
    const reopened = operations.state(users.Operator).alerts[0];
    assert.equal(reopened.id, alert.id);
    assert.equal(reopened.priority, 'Medium');
    assert.equal(reopened.status, 'Open');
    repository.run("INSERT INTO product_locations VALUES ('P1', 'LINE')");
    repository.run("UPDATE products SET active = 0 WHERE id = 'P1'");
    const scan = operations.verify(users['Quality User'], { trolley: 'TR-001', product: 'P1' });
    for (const code of ['Wrong location', 'Tag problem', 'Inactive product']) {
      assert.ok(
        scan.flags.some((flag) => flag.code === code),
        code,
      );
    }
  } finally {
    repository.close();
  }
});

test('outside, maintenance and product-location conditions deduplicate, clear and reopen', () => {
  const { repository, operations, users } = setup();
  try {
    repository.run("INSERT INTO locations(id, name, external) VALUES ('OUT', 'Supplier', 1)");
    repository.run("INSERT INTO product_locations VALUES ('P1', 'LINE')");
    repository.run(
      "UPDATE trolleys SET location = 'OUT', status = 'Maintenance', tag_condition = 'Damaged'",
    );
    const first = operations.state(users.Operator);
    assert.deepEqual(
      new Set(first.alerts.map((alert) => alert.type)),
      new Set(['Outside plant', 'Trolley maintenance due', 'Wrong location']),
    );
    assert.equal(first.alerts.find((alert) => alert.type === 'Outside plant').priority, 'Low');
    assert.equal(first.alerts.find((alert) => alert.type === 'Wrong location').priority, 'High');
    assert.equal(
      first.alerts.filter((alert) => alert.type === 'Trolley maintenance due').length,
      1,
    );
    operations.state(users.Supervisor);
    assert.equal(repository.get('SELECT count(*) AS count FROM notifications').count, 15);
    repository.run(
      "UPDATE trolleys SET location = 'LINE', status = 'Available', tag_condition = 'Good'",
    );
    assert.ok(
      operations.state(users.Operator).alerts.every((alert) => alert.status === 'Resolved'),
    );
    repository.run("UPDATE trolleys SET location = 'OUT', status = 'Maintenance'");
    const recurrent = operations.state(users.Operator);
    assert.equal(recurrent.alerts.length, 3);
    assert.ok(recurrent.alerts.every((alert) => alert.status === 'Open'));
    assert.deepEqual(
      recurrent.alerts.map((alert) => alert.id),
      first.alerts.map((alert) => alert.id),
    );
  } finally {
    repository.close();
  }
});

test('signed reader discrepancies raise evidence alerts and never confirm an unauthorized movement', () => {
  const { repository, operations, users } = setup();
  try {
    const readers = readerService(repository, '11'.repeat(32));
    const line = readers.create(users.Admin, {
      id: 'LINE-READER',
      name: 'Line reader',
      location: 'LINE',
    });
    const store = readers.create(users.Admin, {
      id: 'STORE-READER',
      name: 'Store reader',
      location: 'STORE',
    });
    const observe = (reader, eventId, observedAt) => {
      const timestamp = Date.now();
      const input = { eventId, tag: 'TR-001', observedAt };
      const raw = JSON.stringify(input);
      return readers.ingest(
        {
          'x-device-id': reader.id,
          'x-device-timestamp': String(timestamp),
          'x-device-signature': createHmac('sha256', reader.secret)
            .update(`${timestamp}.${raw}`)
            .digest('hex'),
        },
        raw,
        input,
      );
    };
    const now = Date.now();
    observe(line, 'line-observation', now);
    const first = operations.state(users.Operator);
    const alert = first.alerts.find((record) => record.type === 'Wrong location');
    assert.ok(alert);
    assert.match(alert.message, /Reader LINE-READER observed the tag at LINE/);
    assert.ok(!first.alerts.some((record) => record.type === 'Unauthorized movement'));
    assert.equal(repository.get('SELECT location FROM trolleys').location, 'STORE');
    const movement = overdue(repository, now + 3600000);
    assert.equal(
      operations.state(users.Operator).alerts.find((record) => record.id === alert.id).status,
      'Resolved',
    );
    repository.run("UPDATE movements SET state = 'Rejected' WHERE id = ?", movement);
    assert.equal(
      operations.state(users.Operator).alerts.find((record) => record.id === alert.id).status,
      'Open',
    );
    observe(store, 'store-observation', now + 1);
    assert.equal(
      operations.state(users.Operator).alerts.find((record) => record.id === alert.id).status,
      'Resolved',
    );
    assert.equal(repository.get('SELECT location FROM trolleys').location, 'STORE');
  } finally {
    repository.close();
  }
});

test('state read queries remain bounded as the fleet and active alerts grow', () => {
  const { repository, users } = setup();
  try {
    let reads = 0;
    const counted = {
      ...repository,
      all(...args) {
        reads++;
        return repository.all(...args);
      },
      get(...args) {
        reads++;
        return repository.get(...args);
      },
    };
    const operations = operationService(counted, policyService(counted));
    operations.state(users.Admin);
    const initial = reads;
    for (let index = 2; index <= 100; index++) {
      repository.run(
        "INSERT INTO trolleys(id, type, capacity, location, status) VALUES (?, 'Component', 100, 'STORE', 'Maintenance')",
        `TR-${String(index).padStart(3, '0')}`,
      );
    }
    operations.state(users.Admin);
    reads = 0;
    const state = operations.state(users.Admin);
    assert.equal(state.alerts.length, 99);
    assert.equal(reads, initial);
    assert.ok(reads <= 12);
  } finally {
    repository.close();
  }
});

test('a later receipt supersedes earlier reader evidence even with a fast reader clock', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { repository, operations, users } = setup();
  try {
    const readers = readerService(repository, '11'.repeat(32));
    const reader = readers.create(users.Admin, {
      id: 'FAST-READER',
      name: 'Line reader',
      location: 'LINE',
    });
    const timestamp = Date.now();
    const input = {
      eventId: 'fast-clock-observation',
      tag: 'TR-001',
      observedAt: timestamp + 60000,
    };
    const raw = JSON.stringify(input);
    readers.ingest(
      {
        'x-device-id': reader.id,
        'x-device-timestamp': String(timestamp),
        'x-device-signature': createHmac('sha256', reader.secret)
          .update(`${timestamp}.${raw}`)
          .digest('hex'),
      },
      raw,
      input,
    );
    assert.equal(
      operations.state(users.Operator).alerts.find((alert) => alert.type === 'Wrong location')
        .status,
      'Open',
    );
    context.mock.timers.tick(1000);
    repository.run(
      `INSERT INTO movements(trolley, source, destination, product, batch, qty, state,
      requested_by, created, expected, received, key, payload, version)
      VALUES ('TR-001', 'LINE', 'STORE', 'P1', 'B1', 10, 'Received', 2, ?, ?, ?, 'new-receipt', '{}', 1)`,
      timestamp - 3600000,
      Date.now() + 3600000,
      Date.now(),
    );
    assert.equal(
      operations.state(users.Operator).alerts.find((alert) => alert.type === 'Wrong location')
        .status,
      'Resolved',
    );
    operations.state(users.Operator);
    assert.equal(
      repository.get("SELECT count(*) AS count FROM alerts WHERE status <> 'Resolved'").count,
      0,
    );
  } finally {
    repository.close();
  }
});

test('verification checks scans, capacity, category and batch without changing records', () => {
  const { repository, operations, users } = setup();
  try {
    repository.run("INSERT INTO trolley_categories VALUES ('Component', 'Components')");
    const before = repository.get('SELECT * FROM trolleys');
    const verified = operations.verify(users['Quality User'], {
      trolley: 'TR-001',
      product: 'P2',
      type: 'Finished Goods',
      location: 'LINE',
      qty: 101,
      batch: 'B2',
    });
    assert.equal(verified.status, 'Mismatch');
    for (const code of [
      'Wrong product',
      'Wrong trolley',
      'Wrong location',
      'Capacity exceeded',
      'Load mismatch',
      'Mixed batch',
    ]) {
      assert.ok(
        verified.flags.some((flag) => flag.code === code),
        code,
      );
    }
    assert.deepEqual(repository.get('SELECT * FROM trolleys'), before);
    const matched = operations.verify(users.Supervisor, {
      trolley: 'TR-001',
      product: 'P1',
      type: 'Component',
      location: 'STORE',
      qty: 10,
      batch: 'B1',
    });
    assert.equal(matched.status, 'Matched');
    assert.deepEqual(matched.flags, []);
    assert.throws(() => operations.verify(users.Operator, { trolley: 'TR-001' }), status(403));
    assert.throws(() => repository.run('UPDATE verifications SET flags = ?', '[]'), /immutable/);
    assert.throws(() => repository.run('DELETE FROM verifications'), /cannot be deleted/);
  } finally {
    repository.close();
  }
});

test('mismatch approvals are independent, idempotent, audited and require another approver', () => {
  const { repository, operations, users } = setup();
  try {
    const before = repository.get('SELECT * FROM trolleys');
    const verification = operations.verify(users.Supervisor, { trolley: 'TR-001', product: 'P2' });
    assert.throws(
      () =>
        operations.requestApproval(users.Admin, {
          verification: verification.id,
          reason: 'Scanned product differs.',
        }),
      status(403),
    );
    const input = { verification: verification.id, reason: 'Please review the scanned product.' };
    const request = operations.requestApproval(users.Supervisor, input);
    assert.equal(operations.requestApproval(users.Supervisor, input).id, request.id);
    assert.throws(
      () => operations.decide(users.Supervisor, request.id, { decision: 'Approved' }),
      status(403),
    );
    assert.throws(
      () => operations.decide(users.Operator, request.id, { decision: 'Approved' }),
      status(403),
    );
    const result = operations.decide(users['Plant Manager'], request.id, {
      decision: 'Approved',
      remarks: 'Verified the replacement product.',
    });
    assert.equal(result.status, 'Approved');
    assert.equal(result.decided_by, users['Plant Manager'].id);
    assert.equal(repository.get('SELECT count(*) AS count FROM movements').count, 0);
    assert.deepEqual(repository.get('SELECT * FROM trolleys'), before);
    assert.equal(repository.get('SELECT status FROM alerts').status, 'Resolved');
    assert.ok(
      operations
        .state(users.Supervisor)
        .notifications.some((notification) => notification.entity === `approval:${request.id}`),
    );
    assert.throws(
      () =>
        operations.decide(users.Admin, request.id, {
          decision: 'Rejected',
          remarks: 'Changed my mind.',
        }),
      status(409),
    );
  } finally {
    repository.close();
  }
});

test('verification alerts stay active until every pending mismatch is decided', () => {
  const { repository, operations, users } = setup();
  try {
    const first = operations.verify(users['Quality User'], { trolley: 'TR-001', product: 'P2' });
    const second = operations.verify(users['Quality User'], {
      trolley: 'TR-001',
      product: 'P1',
      location: 'LINE',
    });
    const approval1 = operations.requestApproval(users['Quality User'], {
      verification: first.id,
      reason: 'Review product scan.',
    });
    const approval2 = operations.requestApproval(users['Quality User'], {
      verification: second.id,
      reason: 'Review location scan.',
    });
    operations.decide(users.Admin, approval1.id, { decision: 'Approved' });
    assert.equal(
      repository.get("SELECT count(*) AS count FROM alerts WHERE status = 'Open'").count,
      2,
    );
    operations.decide(users.Admin, approval2.id, { decision: 'Approved' });
    assert.equal(
      repository.get("SELECT count(*) AS count FROM alerts WHERE status = 'Open'").count,
      0,
    );
  } finally {
    repository.close();
  }
});

test('configured location scopes protect reporting and verification without partial writes', () => {
  const { repository, operations, users } = setup();
  try {
    repository.run('UPDATE plant_settings SET scope_operations = 1');
    assert.throws(
      () => operations.verify(users['Quality User'], { trolley: 'TR-001', product: 'P1' }),
      status(403),
    );
    assert.throws(
      () =>
        operations.report(users.Operator, {
          trolley: 'TR-001',
          type: 'Wrong location',
          message: 'Trolley scanned at the wrong area.',
        }),
      status(403),
    );
    assert.equal(repository.get('SELECT count(*) AS count FROM verifications').count, 0);
    assert.equal(repository.get('SELECT count(*) AS count FROM alerts').count, 0);
    repository.run("INSERT INTO user_locations VALUES (4, 'STORE', 0, 1)");
    assert.equal(
      operations.verify(users['Quality User'], { trolley: 'TR-001', product: 'P1' }).status,
      'Matched',
    );
  } finally {
    repository.close();
  }
});

test('correction and rejection require remarks and stale scans cannot be approved', () => {
  const { repository, operations, users } = setup();
  try {
    const verification = operations.verify(users['Quality User'], {
      trolley: 'TR-001',
      product: 'P2',
    });
    const approval = operations.requestApproval(users['Quality User'], {
      verification: verification.id,
      reason: 'Check the scanned item.',
    });
    assert.throws(
      () => operations.decide(users.Admin, approval.id, { decision: 'Rejected' }),
      status(400),
    );
    assert.throws(
      () => operations.decide(users.Admin, approval.id, { decision: 'Correction Required' }),
      status(400),
    );
    repository.run('UPDATE trolleys SET version = version + 1');
    assert.throws(
      () => operations.decide(users.Admin, approval.id, { decision: 'Approved' }),
      status(409),
    );
    const corrected = operations.decide(users.Admin, approval.id, {
      decision: 'Correction Required',
      remarks: 'Scan the correct product and resubmit.',
    });
    assert.equal(corrected.status, 'Correction Required');
    assert.equal(
      operations.state(users['Quality User']).approvals[0].remarks,
      'Scan the correct product and resubmit.',
    );
    assert.equal(operations.state(users.Operator).approvals.length, 0);
    assert.throws(
      () =>
        operations.requestApproval(users['Quality User'], {
          verification: operations.verify(users['Quality User'], {
            trolley: 'TR-001',
            product: 'P1',
          }).id,
          reason: 'No mismatch.',
        }),
      status(400),
    );
  } finally {
    repository.close();
  }
});

test('reminders reach the responsible user and notification ownership is enforced', () => {
  const { repository, operations, users } = setup();
  try {
    overdue(repository);
    const reminder = operations.remind(users.Supervisor, 'TR-001');
    assert.equal(reminder.recipient, users.Operator.id);
    const notification = repository.get('SELECT * FROM notifications');
    assert.throws(
      () => operations.readNotification(users.Supervisor, notification.id),
      status(404),
    );
    assert.equal(operations.readNotification(users.Operator, notification.id).updated, 1);
    assert.equal(operations.readNotification(users.Operator, notification.id).updated, 0);
    const manual = operations.notify(users['Plant Manager'], {
      userId: users.Operator.id,
      title: 'Please check the bay',
      message: 'The trolley requires a visual check.',
    });
    assert.equal(operations.readNotification(users.Operator, 'all').updated, 1);
    assert.ok(repository.get('SELECT read_at FROM notifications WHERE id = ?', manual.id).read_at);
    assert.throws(
      () => operations.notify(users.Operator, { userId: 1, title: 'Test', message: 'Test' }),
      status(403),
    );
    repository.run("UPDATE movements SET state = 'Received'");
    assert.throws(() => operations.remind(users.Operator, 'TR-001'), status(409));
  } finally {
    repository.close();
  }
});

test('operations and per-user read status persist after reopening the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trolley-operations-'));
  const filename = join(directory, 'test.sqlite');
  let repository;
  try {
    const fixture = setup(filename);
    repository = fixture.repository;
    const alert = fixture.operations.report(fixture.users.Operator, {
      trolley: 'TR-001',
      type: 'Unauthorized movement',
      priority: 'High',
      message: 'Observed an unrecorded movement.',
    });
    const notification = repository.get('SELECT id FROM notifications WHERE user_id = 2');
    fixture.operations.readNotification(fixture.users.Operator, notification.id);
    repository.close();
    repository = openDatabase(filename);
    const state = operationService(repository, policyService(repository)).state(
      fixture.users.Operator,
    );
    assert.equal(state.alerts[0].id, alert.id);
    assert.equal(state.notifications[0].read, true);
  } finally {
    repository?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
