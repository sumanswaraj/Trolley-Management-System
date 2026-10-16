import test from 'node:test';
import assert from 'node:assert/strict';
import {
  overdueView,
  locationsView,
  productsView,
  alertsView,
  notificationsView,
  scanView,
  trolleyDetailView,
  effectiveStatus,
  trolleyFlags,
} from '../public/operations-views.js';

const clock = 2000000000000;

function fixture() {
  return {
    now: clock,
    user: { id: 1, role: 'Admin', name: 'Plant administrator' },
    locations: [
      {
        id: 'STORE',
        name: 'Main store',
        group_name: 'Store',
        department: 'Stores',
        bay_capacity: 1,
        expected_minutes: 120,
      },
      {
        id: 'LINE',
        name: 'Assembly line',
        group_name: 'Production',
        department: 'Production',
        bay_capacity: 4,
        expected_minutes: 60,
      },
      {
        id: 'OUT',
        name: 'External vendor',
        external: 1,
        group_name: 'Outside Plant',
        bay_capacity: 10,
        expected_minutes: 480,
      },
    ],
    products: [
      { id: 'STEEL', name: 'Steel bracket', unit: 'kg', allowed_locations: ['STORE', 'LINE'] },
      { id: 'BOLT', name: 'Hex bolt', unit: 'pcs' },
    ],
    trolleys: [
      {
        id: 'TR-001',
        active: 1,
        type: 'Component',
        capacity: 100,
        unit: 'kg',
        location: 'STORE',
        product: 'STEEL',
        qty: 12,
        batch: 'B-01',
        status: 'In Use',
        version: 2,
        expected: clock - 3 * 3600000,
        since: clock - 5 * 3600000,
        operator_name: 'Asha',
      },
      {
        id: 'TR-002',
        active: 1,
        type: 'Component',
        capacity: 100,
        unit: 'kg',
        location: 'STORE',
        product: 'STEEL',
        qty: 8,
        batch: 'B-02',
        status: 'In Use',
        version: 3,
        expected: clock + 10 * 60000,
        since: clock - 2 * 3600000,
        operator_name: 'Ravi',
      },
      {
        id: 'TR-003',
        active: 1,
        type: 'Small parts',
        capacity: 100,
        unit: 'pcs',
        location: 'STORE',
        product: 'BOLT',
        qty: 30,
        batch: 'C-01',
        status: 'Available',
        version: 1,
      },
    ],
    movements: [],
    activeMovements: [],
    alerts: [],
    approvals: [],
    verifications: [],
    notifications: [],
    audit: [],
  };
}

test('late returns show escalation and exclude deactivated trolleys from follow-up', () => {
  const state = fixture();
  state.trolleys.push({ ...state.trolleys[0], id: 'INACTIVE-TROLLEY', active: 0 });
  const html = overdueView(state);
  assert.match(html, /Critical · Escalated/);
  assert.match(html, /data-remind="TR-001"/);
  assert.match(html, /data-return="TR-001"/);
  assert.match(html, /data-trolley-detail="TR-002"/);
  assert.doesNotMatch(html, /data-remind="TR-002"/);
  assert.doesNotMatch(html, /INACTIVE-TROLLEY/);
  assert.equal(effectiveStatus(state, state.trolleys[0]), 'Overdue');
  assert.equal(effectiveStatus(state, state.trolleys.at(-1)), 'Inactive');
});

test('held-use deadlines come from receipt and location duration; active movement takes precedence', () => {
  const state = fixture();
  const trolley = { ...state.trolleys[0], expected: undefined, status: 'In Use', location: 'LINE' };
  state.trolleys = [trolley];
  state.movements = [
    {
      id: 1,
      trolley: trolley.id,
      created: clock - 5 * 3600000,
      received: clock - 2 * 3600000,
      expected: clock - 10 * 3600000,
      state: 'Received',
    },
  ];
  assert.equal(effectiveStatus(state, trolley), 'Overdue');
  state.activeMovements = [
    { id: 2, trolley: trolley.id, created: clock, expected: clock + 3600000, state: 'Pending' },
  ];
  assert.equal(effectiveStatus(state, trolley), 'In Use');
  trolley.status = 'Available';
  state.activeMovements[0].expected = clock - 60000;
  assert.equal(effectiveStatus(state, trolley), 'Overdue');
});

test('location drilldown shows bay capacity without mixing different material units', () => {
  const state = fixture();
  const html = locationsView(state);
  assert.match(html, /300% of 1 trolley bays · Over capacity/);
  assert.match(html, /20 kg · 30 pcs/);
  assert.doesNotMatch(html, /50 units/);
  assert.match(html, /data-filter-location="STORE" aria-pressed="true"/);
  assert.match(html, /Beyond the plant gate/);
  state.locationFilter = 'LINE';
  assert.match(locationsView(state), /No trolleys here/);
});

test('product assignments preserve distinct batches and filter warnings from current verifications', () => {
  const state = fixture();
  state.verifications = [
    {
      id: 6,
      trolley: 'TR-001',
      trolley_version: 2,
      status: 'Mismatch',
      flags: [{ code: 'Mixed batch', message: 'Wrong batch scanned' }],
    },
  ];
  state.productFilters = { flag: 'Mixed batch' };
  const html = productsView(state);
  assert.match(html, /B-01/);
  assert.match(html, /B-02/);
  assert.match(html, /Mixed batch/);
  const assignments = html.split('<h3>Current material assignments</h3>')[1];
  assert.match(assignments, /data-trolley-detail="TR-001"/);
  assert.doesNotMatch(assignments, /data-trolley-detail="TR-002"/);
  state.approvals = [{ verification: 6, status: 'Approved' }];
  assert.deepEqual(trolleyFlags(state, state.trolleys[0]), []);
  state.approvals = [];
  state.trolleys[0].version = 3;
  assert.deepEqual(trolleyFlags(state, state.trolleys[0]), []);
});

test('verification output renders backend flags and exposes the approval request control', () => {
  const state = fixture();
  state.lastVerification = {
    id: 4,
    status: 'Mismatch',
    flags: [{ code: 'Wrong product', message: 'Scanned material does not match the trolley' }],
  };
  const html = productsView(state);
  assert.match(html, /Scanned material does not match the trolley/);
  assert.match(html, /data-request-verification="4"/);
  state.lastVerification = { id: 5, status: 'Matched', flags: [] };
  assert.match(productsView(state), /Match confirmed/);
  assert.doesNotMatch(productsView(state), /data-request-verification/);
});

test('alert filtering preserves active acknowledgements and restricts resolution actions by role', () => {
  const state = fixture();
  state.alerts = [
    {
      id: 1,
      trolley: 'TR-001',
      location: 'STORE',
      type: 'Wrong product',
      priority: 'Critical',
      status: 'Open',
      message: 'Current critical alert',
      created: clock,
    },
    {
      id: 2,
      trolley: 'TR-002',
      location: 'STORE',
      type: 'Wrong product',
      priority: 'Critical',
      status: 'Acknowledged',
      message: 'Owned critical alert',
      created: clock,
    },
    {
      id: 3,
      trolley: 'TR-003',
      location: 'STORE',
      type: 'Wrong product',
      priority: 'Critical',
      status: 'Resolved',
      message: 'Closed critical alert',
      created: clock,
    },
  ];
  state.alertFilters = { status: 'Active', priority: 'Critical', type: 'Wrong product' };
  const html = alertsView(state);
  assert.match(html, /Current critical alert/);
  assert.match(html, /Owned critical alert/);
  assert.doesNotMatch(html, /Closed critical alert/);
  assert.match(html, /data-alert-id="1" data-alert-status="Acknowledged"/);
  assert.match(html, /data-alert-id="2" data-alert-status="Resolved"/);
  state.user.role = 'Operator';
  assert.doesNotMatch(alertsView(state), /data-alert-status=/);
  assert.doesNotMatch(productsView(state), /id="scan-verify"/);
});

test('notifications distinguish unread records and offer individual and bulk read controls', () => {
  const state = fixture();
  state.notifications = [
    {
      id: 10,
      kind: 'warn',
      title: 'Return reminder',
      message: 'Check TR-001',
      created: clock,
      read: false,
      read_at: null,
    },
    {
      id: 9,
      kind: 'info',
      title: 'Movement complete',
      message: 'TR-002 arrived',
      created: clock - 1,
      read: true,
      read_at: clock,
    },
  ];
  const html = notificationsView(state);
  assert.match(html, /1 unread/);
  assert.match(html, /data-notification-read="all"/);
  assert.match(html, /data-notification-read="10"/);
  assert.doesNotMatch(html, /data-notification-read="9"/);
});

test('scan results expose the correct trolley and only offer receipt for in-transit movements', () => {
  const state = fixture();
  state.scanResult = { trolley: state.trolleys[0], source: 'RFID reader' };
  state.activeMovements = [
    {
      id: 12,
      trolley: 'TR-001',
      destination: 'LINE',
      state: 'In Transit',
      expected: clock + 60000,
    },
  ];
  const html = scanView(state);
  assert.match(html, /name="code"/);
  assert.match(html, /RFID reader/);
  assert.match(html, /data-prefill-move="TR-001"/);
  assert.match(html, /data-receive="12"/);
  assert.match(html, /data-trolley-detail="TR-001"/);
  state.activeMovements[0].state = 'Pending';
  assert.doesNotMatch(scanView(state), /data-receive=/);
  state.scanResult = { code: 'UNKNOWN' };
  assert.match(scanView(state), /No trolley matches UNKNOWN/);
});

test('a scan result uses refreshed trolley data after movements update the fleet', () => {
  const state = fixture();
  state.scanResult = { trolley: { ...state.trolleys[0], location: 'OUT' } };
  state.trolleys[0].location = 'LINE';
  const html = scanView(state);
  assert.match(html, /Assembly line/);
  assert.doesNotMatch(html, /External vendor/);
});

test('plant managers can inspect trolleys while movement and master controls stay restricted', () => {
  const state = fixture();
  state.user.role = 'Plant Manager';
  state.scanResult = { trolley: state.trolleys[0] };
  state.activeMovements = [{ id: 12, trolley: 'TR-001', state: 'In Transit', expected: clock - 1 }];
  for (const html of [scanView(state), overdueView(state), trolleyDetailView(state, 'TR-001')]) {
    assert.doesNotMatch(html, /data-prefill-move=/);
    assert.doesNotMatch(html, /data-return=/);
    assert.doesNotMatch(html, /data-receive=/);
    assert.doesNotMatch(html, /data-edit-master=/);
    assert.doesNotMatch(html, /data-page="readers"/);
  }
  assert.match(scanView(state), /data-trolley-detail="TR-001"/);
});

test('trolley detail includes full loaded history, identifiers and label downloads', () => {
  const state = fixture();
  const trolley = state.trolleys[0];
  trolley.qr_value = 'QR-001';
  trolley.rfid = 'RFID-001';
  state.movements = [
    {
      id: 9,
      trolley: trolley.id,
      source: 'STORE',
      destination: 'LINE',
      created: clock - 1,
      state: 'Received',
      requester: 'Asha',
    },
  ];
  state.trolleyHistory = {
    items: [
      {
        id: 1,
        trolley: trolley.id,
        source: 'OUT',
        destination: 'STORE',
        created: clock - 4 * 3600000,
        state: 'Received',
        requester: 'Earlier operator',
      },
    ],
    nextCursor: 1,
  };
  const html = trolleyDetailView(state, trolley.id);
  assert.match(html, /Earlier operator/);
  assert.match(html, /QR-001/);
  assert.match(html, /RFID-001/);
  assert.match(html, /download="TR-001.svg"/);
  assert.match(html, /data-history-more="TR-001"/);
  assert.match(html, /2 loaded/);
});

test('all operation views escape values from API data and leave input state intact', () => {
  const state = fixture();
  const unsafe = '<img src=x onerror="alert(1)">';
  state.trolleys[0].id = unsafe;
  state.trolleys[0].type = unsafe;
  state.locations[0].name = unsafe;
  state.products[0].name = unsafe;
  state.productFilters = { q: unsafe, flag: '' };
  state.alerts = [
    {
      id: unsafe,
      trolley: unsafe,
      type: unsafe,
      message: unsafe,
      priority: unsafe,
      location: 'STORE',
      created: clock,
      status: 'Open',
    },
  ];
  state.notifications = [
    { id: unsafe, title: unsafe, message: unsafe, kind: unsafe, created: clock, read: false },
  ];
  state.scanResult = { trolley: state.trolleys[0], source: unsafe };
  state.lastVerification = { id: unsafe, status: 'Mismatch', flags: [{ message: unsafe }] };
  const original = structuredClone(state);
  for (const view of [
    overdueView,
    locationsView,
    productsView,
    alertsView,
    notificationsView,
    scanView,
    (value) => trolleyDetailView(value, unsafe),
  ]) {
    const html = view(state);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /data-[\w-]+="<img/);
    assert.match(html, /&lt;img/);
  }
  assert.deepEqual(state, original);
});
