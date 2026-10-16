import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, prepare, movement } from './helpers.mjs';
import { masterService } from '../src/services/masters.mjs';
import { movementService, MOVEMENT_TYPES } from '../src/services/movements.mjs';
import { policyService } from '../src/services/policies.mjs';

const setup = async () => {
  const f = await fixture();
  await prepare(f);
  const masters = masterService(f.repository);
  const policies = policyService(f.repository);
  return {
    ...f,
    masters,
    policies,
    moves: movementService(f.repository, policies),
    adminUser: f.repository.get("SELECT id, name, role FROM users WHERE username = 'admin'"),
    operatorUser: f.repository.get("SELECT id, name, role FROM users WHERE username = 'operator'"),
    supervisorUser: f.repository.get(
      "SELECT id, name, role FROM users WHERE username = 'supervisor'",
    ),
  };
};
const status = (code) => (error) => error.status === code;

test('master metadata persists, enforces optimistic edits and preserves trolley identities', async () => {
  const f = await setup();
  try {
    const { masters, adminUser } = f;
    const store = masters.update(adminUser, 'locations', 'STORE', {
      version: 1,
      group_name: 'Store',
      department: 'Stores',
      bay_capacity: 30,
      expected_minutes: 480,
    });
    assert.equal(store.version, 2);
    assert.throws(
      () => masters.update(adminUser, 'locations', 'STORE', { version: 2, external: true }),
      status(409),
    );
    const product = masters.update(adminUser, 'products', 'P1', {
      version: 1,
      default_batch: 'B-26',
      allowed_locations: ['STORE', 'LINE', 'STORE'],
    });
    assert.deepEqual(product.allowed_locations, ['LINE', 'STORE']);
    assert.equal(product.default_batch, 'B-26');
    const trolley = masters.update(adminUser, 'trolleys', 'TR-001', {
      version: 1,
      material_type: 'Component',
      department: 'Stores',
      assigned_area: 'LINE',
      rfid: 'RFID-101',
    });
    assert.equal(trolley.version, 2);
    assert.equal(trolley.qr_value, 'TR-001');
    assert.equal(
      f.repository.get('SELECT trolley FROM trolley_tags WHERE tag = ?', 'RFID-101').trolley,
      trolley.id,
    );
    assert.throws(
      () => masters.update(adminUser, 'trolleys', trolley.id, { version: 1, capacity: 200 }),
      status(409),
    );
    assert.throws(
      () => masters.update(adminUser, 'trolleys', trolley.id, { version: 2, location: 'LINE' }),
      /movement/,
    );
    assert.throws(
      () => masters.update(adminUser, 'trolleys', trolley.id, { version: 2, qr_value: 'NEW-QR' }),
      /permanent/,
    );
    assert.throws(
      () =>
        masters.create(adminUser, 'trolleys', {
          id: 'TR-002',
          type: 'Component',
          capacity: 100,
          location: 'STORE',
          rfid: 'rfid-101',
        }),
      status(409),
    );
    assert.equal(f.repository.get('SELECT COUNT(*) AS count FROM trolleys').count, 1);
    const renamed = masters.update(adminUser, 'trolleys', trolley.id, {
      version: 2,
      rfid: 'RFID-102',
    });
    assert.equal(renamed.version, 3);
    assert.equal(
      f.repository.get('SELECT trolley FROM trolley_tags WHERE tag = ?', 'RFID-101'),
      undefined,
    );
    assert.equal(masters.state(f.operatorUser).trolleys[0].assigned_area, 'LINE');
  } finally {
    await f.close();
  }
});

test('deactivation and reassignment cannot bypass open movements or loaded trolley checks', async () => {
  const f = await setup();
  try {
    const { masters, moves, adminUser, operatorUser, supervisorUser } = f;
    const pending = moves.request(operatorUser, movement({ destination: 'OUT' }));
    assert.throws(
      () => masters.setActive(adminUser, 'trolleys', 'TR-001', { version: 1, active: false }),
      status(409),
    );
    assert.throws(
      () => masters.update(adminUser, 'trolleys', 'TR-001', { version: 1, assigned_area: 'LINE' }),
      status(409),
    );
    assert.throws(
      () => masters.setActive(adminUser, 'products', 'P1', { version: 1, active: false }),
      status(409),
    );
    moves.transition(supervisorUser, pending.id, 'reject');
    assert.throws(
      () => masters.setActive(adminUser, 'locations', 'STORE', { version: 1, active: false }),
      status(409),
    );
    moves.request(operatorUser, movement({ key: 'loaded', in_transit: false }));
    assert.throws(
      () => masters.setActive(adminUser, 'trolleys', 'TR-001', { version: 3, active: false }),
      status(409),
    );
    assert.throws(
      () => masters.update(adminUser, 'products', 'P1', { version: 1, unit: 'kg' }),
      status(409),
    );
    moves.request(
      operatorUser,
      movement({
        key: 'empty',
        version: 3,
        destination: 'STORE',
        qty: 0,
        product: null,
        batch: '',
        in_transit: false,
      }),
    );
    const inactive = masters.setActive(adminUser, 'trolleys', 'TR-001', {
      version: 5,
      active: false,
    });
    assert.equal(inactive.active, 0);
    assert.throws(
      () => moves.request(operatorUser, movement({ key: 'inactive', version: 6 })),
      status(400),
    );
    assert.equal(
      masters.setActive(adminUser, 'trolleys', 'TR-001', { version: 6, active: true }).active,
      1,
    );
    assert.equal(f.repository.get('SELECT COUNT(*) AS count FROM movements').count, 3);
  } finally {
    await f.close();
  }
});

test('movement metadata is authentic, immutable and supports immediate receipt with dwell deadlines', async () => {
  const f = await setup();
  try {
    f.masters.update(f.adminUser, 'locations', 'LINE', {
      version: 1,
      group_name: 'Quality',
      expected_minutes: 90,
    });
    const input = movement({
      movement_type: 'Quality Inspection',
      reason: 'Inspect batch',
      remarks: 'Use bay 2',
      department: 'Quality',
      operator_name: 'Forged',
      operator: 'Forged',
      in_transit: false,
    });
    const created = f.moves.request(f.operatorUser, input);
    assert.equal(created.state, 'Received');
    assert.equal(created.operator_name, f.operatorUser.name);
    assert.equal(created.remarks, 'Use bay 2');
    assert.equal(created.reason, 'Inspect batch');
    assert.equal(created.department, 'Quality');
    assert.equal(f.moves.request(f.operatorUser, input).id, created.id);
    const trolley = f.masters.detail(f.operatorUser, 'trolleys', 'TR-001');
    assert.equal(trolley.location, 'LINE');
    assert.equal(trolley.status, 'Waiting');
    assert.equal(trolley.version, 3);
    assert.equal(trolley.since, created.received);
    assert.equal(trolley.expected, created.received + 90 * 60000);
    assert.equal(trolley.previous_location, 'STORE');
    assert.equal(trolley.uses, 1);
    assert.deepEqual(f.masters.state(f.operatorUser).trolleys[0], trolley);
    assert.throws(
      () =>
        f.repository.run(
          'UPDATE movements SET movement_type = ? WHERE id = ?',
          'Dispatch',
          created.id,
        ),
      /immutable/,
    );
    assert.throws(
      () =>
        f.moves.request(
          f.operatorUser,
          movement({
            key: 'badstatus',
            version: 3,
            destination: 'STORE',
            status_after: 'Outside Plant',
          }),
        ),
      status(400),
    );
  } finally {
    await f.close();
  }
});

test('correction decisions preserve original requests and link one durable revision', async () => {
  const f = await setup();
  try {
    const originalInput = movement({ destination: 'OUT', remarks: 'Initial request' });
    const original = f.moves.request(f.operatorUser, originalInput);
    assert.throws(
      () =>
        f.moves.transition(f.operatorUser, original.id, 'correct', { reason: 'Wrong destination' }),
      status(403),
    );
    assert.throws(
      () => f.moves.transition(f.supervisorUser, original.id, 'correct', {}),
      status(400),
    );
    const corrected = f.moves.transition(f.supervisorUser, original.id, 'correct', {
      reason: 'Select the production line',
    });
    assert.equal(corrected.state, 'Rejected');
    assert.equal(corrected.decision, 'Correction Requested');
    assert.equal(corrected.correction_reason, 'Select the production line');
    assert.equal(f.moves.request(f.operatorUser, originalInput).decision, 'Correction Requested');
    assert.throws(
      () => f.repository.run('UPDATE correction_requests SET reason = ?', 'Changed'),
      /immutable/,
    );
    const revised = f.moves.request(
      f.operatorUser,
      movement({
        key: 'revised',
        revision_of: original.id,
        remarks: 'Production destination corrected',
        in_transit: false,
      }),
    );
    assert.equal(revised.state, 'Received');
    assert.equal(revised.revision_of, original.id);
    assert.equal(
      f.repository.get('SELECT destination FROM movements WHERE id = ?', original.id).destination,
      'OUT',
    );
    assert.throws(() => f.moves.transition(f.adminUser, original.id, 'approve'), status(409));
    assert.throws(
      () =>
        f.moves.request(
          f.operatorUser,
          movement({
            key: 'duplicate-revision',
            revision_of: original.id,
            version: 3,
            destination: 'OUT',
          }),
        ),
      status(409),
    );
  } finally {
    await f.close();
  }
});

test('plant managers approve independently without master or movement entry permissions', async () => {
  const f = await setup();
  try {
    assert.equal(
      (
        await f.request(
          'users',
          {
            username: 'manager',
            name: 'Plant manager',
            role: 'Plant Manager',
            password: 'test-password-123',
          },
          f.admin,
        )
      ).status,
      201,
    );
    const manager = f.repository.get("SELECT id, name, role FROM users WHERE username = 'manager'");
    assert.throws(
      () => f.masters.update(manager, 'trolleys', 'TR-001', { version: 1, capacity: 200 }),
      status(403),
    );
    assert.throws(() => f.moves.request(manager, movement()), status(403));
    const request = f.moves.request(f.operatorUser, movement({ destination: 'OUT' }));
    assert.equal(f.moves.transition(manager, request.id, 'approve').state, 'In Transit');
  } finally {
    await f.close();
  }
});

test('approval switches persist and never bypass required quality release or location scopes', async () => {
  const f = await setup();
  try {
    assert.throws(
      () => f.policies.configure(f.supervisorUser, { outside_approval: false }),
      status(403),
    );
    f.policies.configure(f.adminUser, { outside_approval: false, mismatch_approval: false });
    assert.equal(f.policies.settings().outside_approval, 0);
    assert.equal(f.policies.settings().mismatch_approval, 0);
    f.policies.addRule(f.adminUser, 'routes', {
      source: 'STORE',
      destination: 'OUT',
      category: 'Unspecified',
      requires_quality: true,
    });
    const pending = f.moves.request(
      f.operatorUser,
      movement({ destination: 'OUT', in_transit: false }),
    );
    assert.equal(pending.state, 'Pending');
    assert.throws(() => f.moves.transition(f.supervisorUser, pending.id, 'approve'), status(403));
    assert.equal(f.moves.transition(f.adminUser, pending.id, 'approve').state, 'Received');
    f.policies.configure(f.adminUser, { scope_operations: true });
    assert.throws(
      () =>
        f.moves.request(
          f.operatorUser,
          movement({ key: 'scoped', version: 3, destination: 'LINE', in_transit: false }),
        ),
      status(403),
    );
  } finally {
    await f.close();
  }
});

test('product locations become auditable exceptions and all demonstrated movement types are supported', async () => {
  const f = await setup();
  try {
    f.masters.update(f.adminUser, 'products', 'P1', { version: 1, allowed_locations: ['STORE'] });
    assert.throws(() => f.moves.request(f.operatorUser, movement()), /Product is not approved/);
    const request = f.moves.request(
      f.operatorUser,
      movement({ exceptionReason: 'Temporary quality diversion' }),
    );
    assert.equal(request.state, 'Pending');
    assert.deepEqual(JSON.parse(request.policy_flags), [
      'Product is not approved at this destination',
    ]);
    f.moves.transition(f.supervisorUser, request.id, 'reject');
    let version = 1;
    let destination = 'LINE';
    for (const [index, movement_type] of MOVEMENT_TYPES.entries()) {
      const record = f.moves.request(
        f.operatorUser,
        movement({
          key: `type-${index}`,
          movement_type,
          version,
          destination,
          qty: 0,
          product: null,
          batch: '',
          in_transit: false,
        }),
      );
      assert.equal(record.state, 'Received');
      assert.equal(record.movement_type, movement_type);
      version += 2;
      destination = destination === 'LINE' ? 'STORE' : 'LINE';
    }
    const trolley = f.masters.state(f.operatorUser).trolleys[0];
    assert.equal(trolley.uses, MOVEMENT_TYPES.length);
    assert.equal(trolley.location, 'STORE');
    assert.deepEqual(trolley, f.masters.detail(f.operatorUser, 'trolleys', 'TR-001'));
    const quality = { ...f.operatorUser, role: 'Quality User' };
    assert.throws(
      () =>
        f.moves.request(
          quality,
          movement({ key: 'quality-dispatch', movement_type: 'Dispatch', version, destination }),
        ),
      status(403),
    );
  } finally {
    await f.close();
  }
});

test('master and correction HTTP endpoints validate identity, roles and versions', async () => {
  const f = await setup();
  try {
    const operator = (
      await f.request('login', { username: 'operator', password: 'test-password-123' })
    ).cookie;
    const supervisor = (
      await f.request('login', { username: 'supervisor', password: 'test-password-123' })
    ).cookie;
    const edit = await f.request(
      'trolleys/TR-001/update',
      { version: 1, rfid: 'RFID-API' },
      f.admin,
    );
    assert.equal(edit.status, 200);
    assert.equal(edit.body.version, 2);
    assert.equal(
      (await f.request('trolleys/TR-001/update', { version: 1, capacity: 200 }, f.admin)).status,
      409,
    );
    assert.equal(
      (await f.request('trolleys/TR-001/active', { version: 2, active: false }, operator)).status,
      403,
    );
    const request = await f.request(
      'movements',
      movement({ destination: 'OUT', version: 2 }),
      operator,
    );
    assert.equal(request.status, 201);
    const corrected = await f.request(
      `movements/${request.body.id}/correct`,
      { reason: 'Select the correct destination' },
      supervisor,
    );
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.display_status, 'Correction Requested');
    assert.ok(corrected.body.decided_at >= corrected.body.created);
    assert.equal(
      (await f.request('state', undefined, operator)).body.movements[0].display_status,
      'Correction Requested',
    );
  } finally {
    await f.close();
  }
});
