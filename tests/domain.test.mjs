import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDatabase } from '../src/database.mjs';
import { accountService } from '../src/services/accounts.mjs';
import { masterService, effectiveTrolley } from '../src/services/masters.mjs';
import { demoService } from '../src/services/demo.mjs';
import { movementService } from '../src/services/movements.mjs';
import { policyService } from '../src/services/policies.mjs';
import { readerService } from '../src/services/readers.mjs';
import { canAccessPage, requirePermission, USER_ROLES } from '../src/security.mjs';

function domain() {
  const repository = openDatabase(':memory:');
  const accounts = accountService(repository, 'test-password-123');
  const user = { id: 1, name: 'Administrator', role: 'Admin' };
  return {
    repository,
    accounts,
    user,
    masters: masterService(repository),
    demo: demoService(repository),
  };
}

function initial(f) {
  for (const input of [
    {
      id: 'STORE',
      name: 'Main store',
      group_name: 'Store',
      department: 'Stores',
      capacity: 40,
      expected_minutes: 480,
    },
    {
      id: 'LINE',
      name: 'Production',
      group_name: 'Production',
      department: 'Production',
      capacity: 20,
    },
  ])
    f.masters.create(f.user, 'locations', input);
  f.masters.create(f.user, 'products', {
    id: 'P1',
    name: 'Gear',
    category: 'Component',
    unit: 'pcs',
    default_batch: 'B1',
    allowed_groups: ['Store', 'Production'],
  });
  return f.masters.create(f.user, 'trolleys', {
    id: 'TR-001',
    type: 'Component Trolley',
    capacity: 100,
    location: 'STORE',
    material_type: 'Component',
    department: 'Stores',
    assigned_area: 'LINE',
    rfid: 'RFID-001',
    maintenance_due: Date.now() + 86400000,
  });
}

const status = (number) => (error) => error.status === number;

test('master fields, identity lookup and audited edits persist without exposing account credentials', () => {
  const f = domain();
  try {
    const created = initial(f);
    assert.equal(created.assigned_area, 'LINE');
    assert.equal(created.material_type, 'Component');
    assert.equal(created.department, 'Stores');
    assert.equal(created.qr, 'QR-TR-001');
    assert.equal(created.created, created.since);
    for (const code of ['TR-001', 'qr-tr-001', 'rfid-001'])
      assert.equal(f.masters.lookup(f.user, code).id, created.id);
    assert.throws(
      () =>
        f.masters.create(f.user, 'trolleys', {
          id: 'TR-002',
          type: 'Component',
          capacity: 50,
          location: 'STORE',
          rfid: 'rfid-001',
        }),
      status(409),
    );
    assert.throws(
      () =>
        f.masters.create(f.user, 'trolleys', {
          id: 'QR-TR-001',
          type: 'Component',
          capacity: 50,
          location: 'STORE',
        }),
      status(409),
    );
    const edited = f.masters.update(f.user, 'trolleys', created.id, {
      version: created.version,
      department: 'Assembly',
      capacity: 120,
      rfid: 'RFID-NEW',
    });
    assert.equal(edited.version, 2);
    assert.equal(edited.capacity, 120);
    assert.equal(edited.location, 'STORE');
    assert.equal(f.masters.lookup(f.user, 'RFID-NEW').id, created.id);
    assert.equal(f.masters.lookup(f.user, 'RFID-001').id, created.id);
    assert.throws(
      () => f.masters.update(f.user, 'trolleys', created.id, { version: 1, capacity: 90 }),
      status(409),
    );
    assert.throws(
      () => f.masters.update(f.user, 'trolleys', created.id, { version: 2, qr: 'OTHER' }),
      status(400),
    );
    assert.throws(
      () => f.masters.update(f.user, 'trolleys', created.id, { version: 2, location: 'LINE' }),
      status(400),
    );
    f.masters.update(f.user, 'locations', 'LINE', {
      name: 'Line 2',
      capacity: 30,
      expected_minutes: 90,
    });
    f.masters.update(f.user, 'products', 'P1', {
      name: 'Revised gear',
      allowed_groups: ['Store', 'Production', 'Assembly'],
    });
    const state = f.masters.state(f.user);
    assert.equal(state.locations.find((entry) => entry.id === 'LINE').capacity, 30);
    assert.deepEqual(state.products[0].allowed_groups, ['Store', 'Production', 'Assembly']);
    assert.deepEqual(Object.keys(state.people[0]).sort(), ['active', 'id', 'name', 'role']);
    assert.equal(state.user.access.pages.includes('settings'), true);
    const detail = f.masters.detail(f.user, created.id);
    assert.equal(
      detail.audit.some(
        (event) =>
          event.action === 'Master updated' &&
          JSON.parse(event.detail).changes.department.after === 'Assembly',
      ),
      true,
    );
    assert.equal(detail.tags.length, 3);
  } finally {
    f.repository.close();
  }
});

test('trolley edits and activation cannot bypass movement, load or version safeguards', () => {
  const f = domain();
  try {
    const trolley = initial(f);
    const movements = movementService(f.repository, policyService(f.repository));
    const request = movements.request(f.user, {
      trolley: trolley.id,
      destination: 'LINE',
      product: 'P1',
      batch: 'B1',
      qty: 40,
      version: 1,
      expected: Date.now() + 3600000,
      key: 'domain-loaded',
    });
    assert.throws(
      () => f.masters.update(f.user, 'trolleys', trolley.id, { version: 2, department: 'Quality' }),
      status(409),
    );
    assert.throws(
      () => f.masters.setActive(f.user, trolley.id, { active: false, version: 2 }),
      status(409),
    );
    assert.equal(f.masters.setActive(f.user, trolley.id, { active: true, version: 2 }).version, 2);
    assert.throws(
      () => f.masters.update(f.user, 'locations', 'LINE', { external: true }),
      status(409),
    );
    assert.throws(() => f.masters.update(f.user, 'products', 'P1', { unit: 'kg' }), status(409));
    movements.transition(f.user, request.id, 'receive');
    assert.throws(
      () => f.masters.update(f.user, 'trolleys', trolley.id, { version: 3, capacity: 20 }),
      status(400),
    );
    assert.throws(
      () => f.masters.update(f.user, 'trolleys', trolley.id, { version: 3, unit: 'kg' }),
      status(409),
    );
    assert.throws(
      () => f.masters.setActive(f.user, trolley.id, { active: false, version: 3 }),
      status(409),
    );
    const empty = movements.request(f.user, {
      trolley: trolley.id,
      destination: 'STORE',
      qty: 0,
      batch: '',
      version: 3,
      expected: Date.now() + 3600000,
      key: 'domain-empty',
    });
    movements.transition(f.user, empty.id, 'receive');
    const inactive = f.masters.setActive(f.user, trolley.id, { active: false, version: 5 });
    assert.equal(inactive.effective_status, 'Inactive');
    assert.equal(f.masters.detail(f.user, trolley.id).movements.length, 2);
    assert.throws(
      () =>
        f.masters.create(f.user, 'trolleys', {
          id: trolley.id,
          type: 'Component',
          capacity: 50,
          location: 'STORE',
        }),
      /UNIQUE constraint/,
    );
    assert.equal(
      f.masters.setActive(f.user, trolley.id, { active: true, version: 6 }).effective_status,
      'Available',
    );
  } finally {
    f.repository.close();
  }
});

test('six-role access includes monitoring and approvals for Plant Manager without master or movement writes', () => {
  const f = domain();
  try {
    assert.equal(USER_ROLES.length, 6);
    f.accounts.create(f.user, {
      username: 'manager',
      name: 'Plant manager',
      role: 'Plant Manager',
      password: 'manager-password-123',
    });
    const manager = f.accounts.login(
      { username: 'manager', password: 'manager-password-123' },
      'test-manager',
    ).user;
    assert.equal(canAccessPage(manager, 'analytics'), true);
    assert.equal(canAccessPage(manager, 'movement'), false);
    assert.equal(manager.access.perms.includes('approve'), true);
    assert.doesNotThrow(() => requirePermission(manager, 'approve'));
    assert.throws(() => requirePermission(manager, 'movement'), status(403));
    assert.throws(
      () => f.masters.create(manager, 'locations', { id: 'NO', name: 'No' }),
      status(403),
    );
    assert.throws(() => f.demo.load(manager), status(403));
    const supervisor = { id: 1, role: 'Supervisor' };
    assert.throws(
      () => f.masters.create(supervisor, 'locations', { id: 'LEGACY', name: 'No create' }),
      status(403),
    );
    f.masters.create(f.user, 'locations', { id: 'LEGACY', name: 'Admin-owned master' });
    assert.throws(
      () => f.masters.update(supervisor, 'locations', 'LEGACY', { name: 'No edit' }),
      status(403),
    );
    assert.equal(
      f.masters.state(manager).roles['Quality User'].types.includes('Quality Release'),
      true,
    );
  } finally {
    f.repository.close();
  }
});

test('effective statuses cover loaded, waiting, transit and outside return deadlines with inactive priority', () => {
  for (const state of ['In Use', 'Waiting', 'In Transit', 'Outside Plant']) {
    assert.equal(
      effectiveTrolley({ active: 1, status: state, expected: 500 }, 1000).effective_status,
      'Overdue',
    );
    assert.equal(
      effectiveTrolley({ active: 1, status: state, expected: 1500 }, 1000).effective_status,
      state,
    );
  }
  assert.equal(
    effectiveTrolley({ active: 1, status: 'Maintenance', expected: 500 }, 1000).effective_status,
    'Maintenance',
  );
  assert.equal(
    effectiveTrolley({ active: 0, status: 'In Use', expected: 500 }, 1000).effective_status,
    'Inactive',
  );
});

test('dashboard movement totals cover the whole day beyond the recent history page', () => {
  const f = domain();
  try {
    initial(f);
    const movements = movementService(f.repository, policyService(f.repository));
    for (let index = 0; index < 60; index++) {
      const trolley = f.masters.lookup(f.user, 'TR-001');
      const requested = movements.request(f.user, {
        trolley: trolley.id,
        destination: index % 2 === 0 ? 'LINE' : 'STORE',
        qty: 0,
        batch: '',
        version: trolley.version,
        expected: Date.now() + 3600000,
        key: `dashboard-${index}`,
      });
      movements.transition(f.user, requested.id, 'receive');
    }
    const state = f.masters.state(f.user);
    assert.equal(state.movements.length, 50);
    assert.equal(state.dashboard.movements24h, 60);
    assert.equal(state.dashboard.flows24h.find((flow) => flow.source_group === 'Store').count, 30);
    assert.equal(state.dashboard.arrivals24h.find((row) => row.location === 'STORE').count, 30);
  } finally {
    f.repository.close();
  }
});

test('demo load is explicit and reset preserves histories, users, reader observations and unrelated masters', () => {
  const f = domain();
  try {
    assert.equal(f.masters.state(f.user).trolleys.length, 0);
    assert.deepEqual(f.demo.load(f.user), {
      trolleys: 128,
      locations: 11,
      products: 10,
      history_preserved: true,
    });
    const before = f.masters.state(f.user);
    assert.equal(before.movements.length, 0);
    assert.equal(new Set(before.trolleys.map((trolley) => trolley.type)).size, 5);
    for (const trolley of before.trolleys.filter((entry) => entry.qty > 0))
      assert.equal(
        trolley.unit,
        before.products.find((product) => product.id === trolley.product).unit,
      );
    assert.throws(() => f.demo.load(f.user), status(409));
    assert.throws(() => f.demo.reset(f.user, {}), status(400));
    f.masters.create(f.user, 'locations', { id: 'CUSTOM', name: 'User location' });
    f.masters.create(f.user, 'trolleys', {
      id: 'TR-900',
      type: 'Custom',
      capacity: 80,
      location: 'CUSTOM',
    });
    const readers = readerService(f.repository, '1'.repeat(64));
    const reader = readers.create(f.user, { id: 'RG-01', name: 'Gate', location: 'STORE-01' });
    const observedAt = Date.now();
    const rawBody = JSON.stringify({
      eventId: 'domain-observation',
      tag: before.trolleys[0].rfid,
      observedAt,
    });
    const signature = createHmac('sha256', reader.secret)
      .update(`${observedAt}.${rawBody}`)
      .digest('hex');
    readers.ingest(
      {
        'x-device-id': reader.id,
        'x-device-timestamp': String(observedAt),
        'x-device-signature': signature,
      },
      rawBody,
      JSON.parse(rawBody),
    );
    const movements = movementService(f.repository, policyService(f.repository));
    const move = movements.request(f.user, {
      trolley: 'TR-001',
      destination: 'PROD-L01',
      product: 'CMP-A01',
      batch: 'B1',
      qty: 20,
      version: 1,
      expected: Date.now() + 3600000,
      key: 'demo-check',
    });
    assert.throws(() => f.demo.reset(f.user, { confirm: 'RESET DEMO DATA' }), status(409));
    movements.transition(f.user, move.id, 'receive');
    const auditCount = f.repository.get('SELECT COUNT(*) AS count FROM audit').count;
    const wrapping = f.repository.get(
      'SELECT encrypted_secret FROM readers WHERE id = ?',
      reader.id,
    ).encrypted_secret;
    f.demo.reset(f.user, { confirm: 'RESET DEMO DATA' });
    assert.equal(f.masters.state(f.user).trolleys.length, 129);
    assert.equal(f.masters.lookup(f.user, 'TR-900').location, 'CUSTOM');
    assert.equal(f.masters.detail(f.user, 'TR-001').movements.length, 1);
    assert.equal(f.masters.lookup(f.user, 'TR-001').status, 'Available');
    assert.equal(f.repository.get('SELECT COUNT(*) AS count FROM users').count, 1);
    assert.equal(f.repository.get('SELECT COUNT(*) AS count FROM reader_events').count, 1);
    assert.equal(
      f.repository.get('SELECT encrypted_secret FROM readers WHERE id = ?', reader.id)
        .encrypted_secret,
      wrapping,
    );
    assert.ok(f.repository.get('SELECT COUNT(*) AS count FROM audit').count > auditCount);
  } finally {
    f.repository.close();
  }
});
