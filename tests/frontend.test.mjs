import test from 'node:test';
import assert from 'node:assert/strict';
import { shellView, loginView, modalView, NAV } from '../public/experience-shell.js';
import { operationsView, trolleyModal } from '../public/operations-views.js';
import { monitoringView } from '../public/monitoring-views.js';
import { ROLE_ACCESS, accessFor } from '../src/security.mjs';

const state = {
  user: {
    id: 1,
    name: '<script>alert(1)</script>',
    role: 'Admin',
    access: accessFor({ role: 'Admin' }),
  },
  locations: [{ id: 'STORE', name: 'Store', external: 0, group_name: 'Store', capacity: 40 }],
  products: [],
  movements: [],
  activeMovements: [],
  alerts: [],
  approvals: [],
  audit: [],
  accounts: [],
  people: [],
  notifications: [],
  settings: {},
  trolleys: [
    {
      id: '<script>alert(1)</script>',
      type: 'Component',
      capacity: 100,
      location: 'STORE',
      status: 'Available',
      qty: 0,
      batch: '',
      active: 1,
      flags: [],
      version: 1,
    },
  ],
};
const monitoring = new Set([
  'dashboard',
  'live',
  'overdue',
  'locations',
  'history',
  'reports',
  'analytics',
]);

test('all fourteen real workspace screens render populated and empty states with escaped data', () => {
  for (const [page] of NAV) {
    for (const current of [state, { ...state, trolleys: [], locations: [] }]) {
      const content = monitoring.has(page)
        ? monitoringView(page, current, {})
        : operationsView(page, current, {});
      const html = shellView(current, page, content, {});
      assert.ok(html.includes('id="view"'), page);
      assert.ok(html.includes('aria-current="page"'), page);
      assert.ok(!html.includes('<script>alert'), page);
    }
  }
  assert.ok(
    shellView(state, 'dashboard', monitoringView('dashboard', state, {}), {}).includes(
      '&lt;script&gt;',
    ),
  );
});

test('six role navigation and privileged actions follow server access metadata', () => {
  for (const [role, access] of Object.entries(ROLE_ACCESS)) {
    const current = {
      ...state,
      user: { id: 2, name: 'Reader', role, access: accessFor({ role }) },
    };
    const html = shellView(current, 'dashboard', '', {});
    const nav = html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
    assert.equal((nav.match(/data-page=/g) || []).length, access.pages.length, role);
  }
  const operator = { ...state, user: { id: 2, name: 'Operator', role: 'Operator' } };
  assert.ok(!operationsView('master', operator, {}).includes('data-action="add-trolley"'));
  assert.ok(!operationsView('settings', operator, {}).includes('data-form="user"'));
  assert.ok(loginView().includes('autocomplete="current-password"'));
});

test('detail and input dialogs escape identities and connect external submit buttons to real forms', () => {
  for (const kind of [
    'detail',
    'edit',
    'qr',
    'issue',
    'receive',
    'decision',
    'add-location',
    'add-product',
    'resolve-alert',
  ]) {
    const model = trolleyModal(kind, state, { modal: { kind, id: state.trolleys[0].id } });
    assert.ok(model, kind);
    const html = modalView(model);
    assert.ok(!html.includes('<script>alert'), kind);
    assert.ok(html.includes('role="dialog"'), kind);
    if (kind === 'edit') assert.ok(html.includes('form="trolleys"'));
  }
});
