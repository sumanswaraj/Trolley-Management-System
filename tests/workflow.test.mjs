import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.mjs';
import { policyService } from '../src/services/policies.mjs';
import { movementService } from '../src/services/movements.mjs';
import { workflowService } from '../src/services/workflow.mjs';

function setup() {
  const repository = openDatabase(':memory:');
  const users = [
    { id: 1, name: 'Administrator', role: 'Admin' },
    { id: 2, name: 'Line operator', role: 'Operator' },
    { id: 3, name: 'Supervisor', role: 'Supervisor' },
    { id: 4, name: 'Quality', role: 'Quality User' },
    { id: 5, name: 'Manager', role: 'Plant Manager' },
    { id: 6, name: 'Stores', role: 'Store User' },
  ];
  for (const user of users)
    repository.run(
      'INSERT INTO users(id,username,name,role,salt,password) VALUES (?,?,?,?,?,?)',
      user.id,
      `user${user.id}`,
      user.name,
      user.role,
      'test-salt',
      'test-hash',
    );
  for (const location of [
    ['STORE', 'Main Store', 'Store', 0, 480],
    ['LINE', 'Production', 'Production', 0, 240],
    ['QUALITY', 'Quality', 'Quality', 0, 90],
    ['OUT', 'Vendor', 'Outside Plant', 1, 1440],
  ])
    repository.run(
      'INSERT INTO locations(id,name,group_name,external,expected_minutes) VALUES (?,?,?,?,?)',
      ...location,
    );
  for (const id of ['P1', 'P2'])
    repository.run(
      'INSERT INTO products(id,name,category,unit,default_batch,allowed_groups) VALUES (?,?,?,?,?,?)',
      id,
      id,
      'Component',
      'pcs',
      'B1',
      '["Store","Production","Quality","Outside Plant"]',
    );
  const now = Date.now();
  repository.run(
    'INSERT INTO trolleys(id,type,capacity,location,unit,qr,created,last_moved,since,assigned_area) VALUES (?,?,?,?,?,?,?,?,?,?)',
    'TR-001',
    'Component',
    100,
    'STORE',
    'pcs',
    'QR-TR-001',
    now,
    now,
    now,
    'STORE',
  );
  const policies = policyService(repository);
  const movements = movementService(repository, policies);
  const workflow = workflowService(repository, policies, movements);
  let sequence = 0;
  const move = (overrides = {}) => ({
    trolley: 'TR-001',
    destination: 'LINE',
    qty: 50,
    product: 'P1',
    batch: 'B1',
    version: 1,
    key: `workflow-${++sequence}`,
    ...overrides,
  });
  return {
    repository,
    policies,
    movements,
    workflow,
    move,
    admin: users[0],
    operator: users[1],
    supervisor: users[2],
    quality: users[3],
    manager: users[4],
    store: users[5],
    close() {
      repository.close();
    },
  };
}

function statusIs(status) {
  return (error) => error.status === status;
}

test('direct completion stores the full movement and updates dwell, quantity, operator and uses', () => {
  const f = setup();
  try {
    const occurred = Date.now() - 60000;
    const moved = f.movements.request(
      f.operator,
      f.move({
        destination: 'QUALITY',
        movement_type: 'Quality Inspection',
        operator_id: f.quality.id,
        department: 'Quality',
        source: 'STORE',
        occurred,
        reason: 'Inspect incoming parts',
        remarks: 'Order 42',
        direct_complete: true,
        status_after: 'Waiting',
      }),
    );
    assert.equal(moved.state, 'Received');
    assert.equal(moved.movement_type, 'Quality Inspection');
    assert.equal(moved.operator_id, f.quality.id);
    assert.equal(moved.department, 'Quality');
    assert.equal(moved.reason, 'Inspect incoming parts');
    assert.equal(moved.remarks, 'Order 42');
    assert.ok(moved.received >= moved.created);
    assert.equal(moved.occurred, occurred);
    const trolley = f.repository.get('SELECT * FROM trolleys WHERE id = ?', 'TR-001');
    assert.equal(trolley.location, 'QUALITY');
    assert.equal(trolley.previous_location, 'STORE');
    assert.equal(trolley.status, 'Waiting');
    assert.equal(trolley.qty, 50);
    assert.equal(trolley.since, occurred);
    assert.equal(trolley.last_moved, occurred);
    assert.equal(trolley.expected, occurred + 90 * 60000);
    assert.equal(trolley.operator_id, f.quality.id);
    assert.equal(trolley.uses, 1);
    assert.equal(trolley.version, 2);
    assert.throws(() => f.repository.run("UPDATE movements SET remarks = 'rewrite'"), /immutable/);
  } finally {
    f.close();
  }
});

test('receipt retains an explicit return deadline and overdue synchronization creates one alert', () => {
  const f = setup();
  const realNow = Date.now;
  try {
    let now = realNow();
    Date.now = () => now;
    const pending = f.movements.request(f.operator, f.move({ expected: now + 60000 }));
    assert.equal(f.repository.get('SELECT location FROM trolleys').location, 'STORE');
    now += 2 * 3600000;
    f.movements.transition(f.operator, pending.id, 'receive');
    const trolley = f.repository.get('SELECT * FROM trolleys');
    assert.equal(trolley.location, 'LINE');
    assert.equal(trolley.since, now);
    assert.equal(trolley.expected, pending.expected);
    f.workflow.synchronize();
    f.workflow.synchronize();
    let alerts = f.workflow.listAlerts(f.admin, { type: 'Trolley overdue' });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].priority, 'High');
    assert.equal(
      f.repository.get(
        "SELECT COUNT(*) AS n FROM notifications WHERE text LIKE 'Trolley overdue:%'",
      ).n,
      1,
    );
    const returned = f.workflow.markReturned(f.operator, 'TR-001');
    assert.equal(returned.state, 'Received');
    assert.equal(returned.movement_type, 'Production Return');
    assert.equal(f.repository.get('SELECT status FROM trolleys').status, 'Available');
    f.workflow.synchronize();
    alerts = f.workflow.listAlerts(f.admin, { type: 'Trolley overdue' });
    assert.equal(alerts[0].status, 'Resolved');
    assert.equal(f.repository.get('SELECT expected FROM trolleys').expected, null);
  } finally {
    Date.now = realNow;
    f.close();
  }
});

test('corrections preserve old requests and resubmit as a separately approved movement', () => {
  const f = setup();
  try {
    const pending = f.movements.request(
      f.operator,
      f.move({ destination: 'OUT', direct_complete: true, remarks: 'Vendor treatment' }),
    );
    const approval = f.repository.get(
      'SELECT * FROM approval_requests WHERE movement_id = ?',
      pending.id,
    );
    assert.throws(
      () => f.workflow.approvalAction(f.operator, approval.id, 'approve'),
      statusIs(403),
    );
    assert.throws(
      () => f.workflow.approvalAction(f.supervisor, approval.id, 'correct'),
      statusIs(400),
    );
    const corrected = f.workflow.approvalAction(f.supervisor, approval.id, 'correct', {
      reason: 'Include the vendor gate pass number',
    });
    assert.equal(corrected.status, 'Correction Requested');
    const original = f.repository.get('SELECT * FROM movements WHERE id = ?', pending.id);
    assert.equal(original.state, 'Rejected');
    assert.equal(original.correction_reason, 'Include the vendor gate pass number');
    assert.throws(
      () => f.workflow.approvalAction(f.store, approval.id, 'resubmit', {}),
      statusIs(403),
    );
    const replacement = f.workflow.approvalAction(f.operator, approval.id, 'resubmit', {
      remarks: 'Gate pass GP-204',
      key: 'corrected-submit',
    });
    assert.notEqual(replacement.id, pending.id);
    assert.equal(replacement.state, 'Pending');
    assert.equal(JSON.parse(replacement.payload).originApproval, approval.id);
    assert.equal(
      f.movements.request(
        f.operator,
        JSON.parse(
          f.repository.get(
            'SELECT payload FROM approval_requests WHERE movement_id = ?',
            replacement.id,
          ).payload,
        ).input,
      ).id,
      replacement.id,
    );
    const nextApproval = f.repository.get(
      'SELECT * FROM approval_requests WHERE movement_id = ?',
      replacement.id,
    );
    f.workflow.approvalAction(f.manager, nextApproval.id, 'approve', {
      reason: 'Gate pass confirmed',
    });
    assert.equal(
      f.repository.get('SELECT state FROM movements WHERE id = ?', replacement.id).state,
      'Received',
    );
    assert.equal(f.repository.get('SELECT location FROM trolleys').location, 'OUT');
    assert.equal(
      f.repository.get('SELECT payload FROM movements WHERE id = ?', pending.id).payload,
      original.payload,
    );
    assert.equal(f.repository.get('SELECT COUNT(*) AS n FROM approval_requests').n, 2);
  } finally {
    f.close();
  }
});

test('standalone product mismatches need independent decisions and retain verification evidence', () => {
  const f = setup();
  try {
    f.movements.request(f.operator, f.move({ direct_complete: true }));
    const verification = f.workflow.verify(f.quality, {
      trolley: 'TR-001',
      product: 'P2',
      batch: 'B2',
    });
    assert.equal(verification.ok, false);
    assert.deepEqual(
      verification.issues.map((row) => row.type),
      ['Wrong product', 'Mixed batch'],
    );
    assert.throws(
      () => f.workflow.verify(f.operator, { trolley: 'TR-001', product: 'P2' }),
      statusIs(403),
    );
    const approval = f.workflow.requestMismatch(f.quality, { verification: verification.id });
    assert.equal(
      f.workflow.requestMismatch(f.quality, { verification: verification.id }).id,
      approval.id,
    );
    assert.throws(
      () =>
        f.workflow.approvalAction(f.quality, approval.id, 'approve', {
          reason: 'Accept temporary product substitution',
        }),
      statusIs(403),
    );
    assert.throws(
      () => f.workflow.approvalAction(f.supervisor, approval.id, 'approve'),
      statusIs(400),
    );
    const decided = f.workflow.approvalAction(f.supervisor, approval.id, 'approve', {
      reason: 'Accept temporary product substitution',
    });
    assert.equal(decided.status, 'Approved');
    assert.equal(f.repository.get('SELECT COUNT(*) AS n FROM movements').n, 1);
    assert.equal(f.repository.get('SELECT product FROM trolleys').product, 'P1');
    assert.equal(f.repository.get('SELECT ok FROM scan_verifications').ok, 0);
    assert.equal(f.workflow.listAlerts(f.admin, { status: 'Active' }).length, 0);
  } finally {
    f.close();
  }
});

test('issue alerts deduplicate, record acknowledgement and resolution, and reopen on recurrence', () => {
  const f = setup();
  try {
    const input = {
      trolley: 'TR-001',
      type: 'Trolley maintenance due',
      message: 'Wheel is damaged',
      priority: 'High',
    };
    const first = f.workflow.reportIssue(f.operator, input);
    const duplicate = f.workflow.reportIssue(f.operator, input);
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.duplicate, true);
    assert.equal(f.workflow.listAlerts(f.admin).length, 1);
    assert.throws(() => f.workflow.alertAction(f.operator, first.id, 'resolve'), statusIs(403));
    const acknowledged = f.workflow.alertAction(f.quality, first.id, 'acknowledge');
    assert.equal(acknowledged.acknowledged_by, f.quality.id);
    assert.equal(acknowledged.status, 'Acknowledged');
    const resolved = f.workflow.alertAction(f.supervisor, first.id, 'resolve', {
      resolution: 'Replaced the wheel and tested the brake',
    });
    assert.equal(resolved.resolved_by, f.supervisor.id);
    assert.equal(resolved.status, 'Resolved');
    assert.equal(resolved.resolution, 'Replaced the wheel and tested the brake');
    const recurrence = f.workflow.reportIssue(f.operator, input);
    assert.equal(recurrence.id, first.id);
    assert.equal(recurrence.status, 'Open');
    assert.equal(recurrence.resolved_by, null);
    assert.equal(recurrence.resolution, '');
    assert.equal(f.repository.get('SELECT COUNT(*) AS n FROM alerts').n, 1);
  } finally {
    f.close();
  }
});

test('notification reads are per user and reminders are delivered to the assigned operator', () => {
  const f = setup();
  try {
    f.workflow.reportIssue(f.operator, {
      trolley: 'TR-001',
      type: 'Wrong location',
      message: 'Unexpected bay',
    });
    const broadcast = f.workflow.notifications(f.operator)[0];
    f.workflow.markRead(f.operator, { ids: [broadcast.id] });
    assert.equal(f.workflow.notifications(f.operator)[0].read, true);
    assert.equal(f.workflow.notifications(f.supervisor)[0].read, false);
    f.movements.request(f.operator, f.move({ direct_complete: true }));
    const reminder = f.workflow.reminder(f.supervisor, 'TR-001');
    assert.equal(reminder.channel, 'in-app');
    assert.equal(reminder.user_id, f.operator.id);
    assert.ok(f.workflow.notifications(f.operator).some((row) => row.id === reminder.notification));
    assert.ok(
      !f.workflow.notifications(f.supervisor).some((row) => row.id === reminder.notification),
    );
    f.workflow.markRead(f.supervisor, { ids: [reminder.notification] });
    assert.equal(
      f.workflow.notifications(f.operator).find((row) => row.id === reminder.notification).read,
      false,
    );
    f.workflow.markRead(f.operator, { all: true });
    assert.ok(f.workflow.notifications(f.operator).every((row) => row.read));
  } finally {
    f.close();
  }
});

test('approval settings are explicit and do not bypass independent quality release', () => {
  const f = setup();
  try {
    assert.equal(f.policies.settings().outside_approval, 1);
    assert.equal(f.policies.settings().mismatch_approval, 1);
    assert.throws(
      () => f.workflow.configure(f.supervisor, { outside_approval: false }),
      statusIs(403),
    );
    assert.throws(() => f.workflow.configure(f.admin, { outside_approval: 0 }), statusIs(400));
    f.workflow.configure(f.admin, { outside_approval: false, mismatch_approval: false });
    f.policies.addRule(f.admin, 'routes', {
      source: 'STORE',
      destination: 'OUT',
      category: 'Component',
      requires_quality: true,
    });
    const pending = f.movements.request(f.operator, f.move({ destination: 'OUT' }));
    assert.equal(pending.state, 'Pending');
    assert.throws(() => f.movements.transition(f.quality, pending.id, 'approve'), statusIs(403));
    f.movements.transition(f.admin, pending.id, 'reject');
    f.policies.addRule(f.admin, 'routes', {
      source: 'STORE',
      destination: 'OUT',
      category: 'Component',
      requires_quality: false,
    });
    assert.equal(
      f.movements.request(f.operator, f.move({ destination: 'OUT' })).state,
      'In Transit',
    );
  } finally {
    f.close();
  }
});

test('movement role types, source mismatches, capacities and stale versions remain enforced', () => {
  const f = setup();
  try {
    assert.throws(
      () => f.movements.request(f.quality, f.move({ movement_type: 'Production Issue' })),
      statusIs(403),
    );
    assert.throws(() => f.movements.request(f.manager, f.move()), statusIs(403));
    assert.throws(
      () => f.movements.request(f.operator, f.move({ source: 'QUALITY' })),
      statusIs(400),
    );
    assert.throws(() => f.movements.request(f.operator, f.move({ qty: 101 })), statusIs(400));
    const pending = f.movements.request(
      f.operator,
      f.move({ source: 'QUALITY', exceptionReason: 'Correct location after manual source scan' }),
    );
    assert.equal(pending.state, 'Pending');
    assert.equal(pending.source, 'STORE');
    assert.ok(JSON.parse(pending.policy_flags).some((flag) => /Declared source/.test(flag)));
    assert.throws(() => f.movements.transition(f.supervisor, pending.id, 'approve'), statusIs(400));
    f.movements.transition(f.supervisor, pending.id, 'approve', {
      reason: 'Source location confirmed at the trolley',
    });
    assert.throws(() => f.movements.request(f.operator, f.move({ version: 1 })), statusIs(409));
  } finally {
    f.close();
  }
});

test('stale verifications are rejected and a pending product exception holds subsequent movements', () => {
  const f = setup();
  try {
    f.movements.request(f.operator, f.move({ direct_complete: true }));
    const stale = f.workflow.verify(f.quality, { trolley: 'TR-001', product: 'P2' });
    f.movements.request(
      f.operator,
      f.move({ destination: 'STORE', version: 2, direct_complete: true }),
    );
    assert.throws(
      () => f.workflow.requestMismatch(f.quality, { verification: stale.id }),
      statusIs(409),
    );
    const fresh = f.workflow.verify(f.quality, { trolley: 'TR-001', product: 'P2' });
    const approval = f.workflow.requestMismatch(f.quality, { verification: fresh.id });
    assert.throws(() => f.movements.request(f.operator, f.move({ version: 3 })), statusIs(409));
    f.workflow.approvalAction(f.supervisor, approval.id, 'correct', {
      reason: 'Check product label again',
    });
    const rechecked = f.workflow.verify(f.quality, { trolley: 'TR-001', product: 'P2' });
    const resubmitted = f.workflow.approvalAction(f.quality, approval.id, 'resubmit', {
      verification: rechecked.id,
      remarks: 'Physical label checked twice',
    });
    assert.notEqual(resubmitted.id, approval.id);
    assert.equal(JSON.parse(resubmitted.payload).originApproval, approval.id);
    assert.equal(
      f.repository.get('SELECT status FROM approval_requests WHERE id = ?', approval.id).status,
      'Correction Requested',
    );
    assert.throws(
      () =>
        f.repository.run(
          "UPDATE approval_requests SET remarks = 'rewrite' WHERE id = ?",
          approval.id,
        ),
      /immutable/,
    );
    assert.throws(
      () => f.repository.run('DELETE FROM approval_requests WHERE id = ?', approval.id),
      /cannot be deleted/,
    );
    assert.throws(
      () => f.repository.run("UPDATE scan_verifications SET issues = '[]' WHERE id = ?", stale.id),
      /immutable/,
    );
    f.workflow.approvalAction(f.supervisor, resubmitted.id, 'approve', {
      reason: 'Accept checked product substitution',
    });
    assert.equal(f.movements.request(f.operator, f.move({ version: 3 })).state, 'In Transit');
  } finally {
    f.close();
  }
});

test('receipt of a migrated pre-workflow movement preserves its explicitly requested deadline', () => {
  const f = setup();
  try {
    const now = Date.now();
    const deadline = now + 30 * 60000;
    const inserted = f.repository.run(
      'INSERT INTO movements(trolley,source,destination,product,batch,qty,state,requested_by,created,expected,key,payload,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      'TR-001',
      'STORE',
      'LINE',
      'P1',
      'B1',
      50,
      'In Transit',
      f.operator.id,
      now,
      deadline,
      'legacy-request',
      JSON.stringify({ expected: deadline }),
      1,
    );
    f.repository.run(
      "UPDATE trolleys SET status = 'In Transit', product = 'P1', batch = 'B1', qty = 50, version = 2",
    );
    f.movements.transition(f.operator, Number(inserted.lastInsertRowid), 'receive');
    assert.equal(f.repository.get('SELECT expected FROM trolleys').expected, deadline);
    assert.equal(f.repository.get('SELECT status FROM trolleys').status, 'In Use');
  } finally {
    f.close();
  }
});
