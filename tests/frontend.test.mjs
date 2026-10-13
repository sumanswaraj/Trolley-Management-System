import test from 'node:test';
import assert from 'node:assert/strict';
import { loginView, workspaceView, fleetTable } from '../public/views.js';

const state = {
  user: { id: 1, name: 'Test Admin', role: 'Admin' },
  locations: [{ id: 'STORE', name: 'Store', external: 0 }],
  products: [], movements: [], audit: [], accounts: [],
  trolleys: [{ id: '<script>alert(1)</script>', type: 'Component', capacity: 100, location: 'STORE', status: 'Available', qty: 0, batch: '' }],
};

test('all workspace views render and untrusted values are escaped', () => {
  for (const page of ['dashboard', 'fleet', 'movement', 'approvals', 'history', 'masters', 'audit', 'users']) {
    const html = workspaceView(state, page);
    assert.ok(html.includes('<main>'));
    assert.ok(html.includes('aria-current="page"'));
    assert.ok(!html.includes('<script>alert'));
  }
  assert.ok(fleetTable(state).includes('&lt;script&gt;'));
});

test('login labels and role-specific navigation are present', () => {
  assert.ok(loginView().includes('autocomplete="current-password"'));
  const operator = { ...state, user: { id: 2, name: 'Operator', role: 'Operator' } };
  assert.ok(!workspaceView(operator, 'dashboard').includes('data-page="users"'));
  assert.ok(workspaceView(operator, 'masters').includes('administrator can configure'));
});
