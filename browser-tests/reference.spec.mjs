import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fixture } from '../tests/helpers.mjs';

const password = 'test-password-123';
const screens = [
  ['dashboard', 'Dashboard', 'Know what moved, where it is, and when its location changed.'],
  ['master', 'Trolley Master', 'Trolley master'],
  ['scan', 'Scan Trolley', 'Scan trolley'],
  ['live', 'Live Tracking', 'Trolley fleet'],
  ['overdue', 'Overdue Trolleys', 'Overdue trolleys'],
  ['movement', 'Movement', 'Record trolley movement'],
  ['locations', 'Locations', 'Plant location tracking'],
  ['history', 'Movement History', 'Trolley movement history'],
  ['products', 'Products & Materials', 'Product & material segregation'],
  ['alerts', 'Alerts', 'Alerts'],
  ['approvals', 'Approvals', 'Approvals'],
  ['reports', 'Reports', 'Reports & analytics'],
  ['analytics', 'Analytics', 'Analytics'],
  ['settings', 'Settings', 'Settings'],
];
let application;
let cookies;
let browserErrors;

test.beforeEach(async ({ page }) => {
  application = await fixture(':memory:', { deviceEncryptionKey: '11'.repeat(32) });
  expect((await application.request('demo/load', {}, application.admin)).status).toBe(201);
  cookies = { admin: application.admin };
  for (const [username, role] of [
    ['supervisor', 'Supervisor'],
    ['operator', 'Operator'],
    ['manager', 'Plant Manager'],
  ]) {
    expect(
      (
        await application.request(
          'users',
          { username, role, name: `Acceptance ${role}`, password },
          application.admin,
        )
      ).status,
    ).toBe(201);
    cookies[username] = (await application.request('login', { username, password })).cookie;
  }
  browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test.afterEach(async () => {
  await application.close();
  expect(browserErrors).toEqual([]);
});

async function signIn(page, username = 'admin') {
  await page.context().clearCookies();
  await page.goto(application.base);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#nav')).toBeAttached();
  await expect(page.locator('#view h1')).toHaveText(screens[0][2]);
}

async function navigate(page, id) {
  const [, label, heading] = screens.find(([value]) => value === id);
  if (
    page.viewportSize().width <= 900 &&
    !(await page.locator('#side').getAttribute('class')).includes('open')
  )
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page
    .locator('#nav')
    .getByRole('button', {
      name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`),
    })
    .and(page.locator(`[data-page="${id}"]`))
    .click();
  await expect(page.locator('#view h1')).toHaveText(heading);
}

async function api(path, body, username = 'admin') {
  const response = await application.request(path, body, cookies[username]);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBeLessThan(300);
  return response.body;
}

async function move(trolley, destination, overrides = {}, username = 'admin') {
  const state = await api('state');
  const record = state.trolleys.find((item) => item.id === trolley);
  return api(
    'movements',
    {
      trolley,
      destination,
      version: record.version,
      qty: 0,
      batch: '',
      expected: Date.now() + 3600000,
      key: crypto.randomUUID(),
      ...overrides,
    },
    username,
  );
}

async function downloaded(page, action, extension, signature) {
  const pending = page.waitForEvent('download');
  await action();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
  const contents = await readFile(await file.path());
  expect(contents.subarray(0, signature.length).toString()).toBe(signature);
  return contents;
}

test('all reference screens, ten dashboard KPIs, eight reports and seven honest analytics panels work', async ({
  page,
}) => {
  await signIn(page);
  await expect(page.locator('#nav > button')).toHaveCount(14);
  await expect(page.locator('#view .kpis > button.kpi')).toHaveCount(10);
  await expect(
    page.locator('#view .kpi').filter({ hasText: 'Total trolleys' }).locator('.v'),
  ).toHaveText('128');
  for (const [id] of screens.slice(1)) await navigate(page, id);
  await navigate(page, 'reports');
  await expect(page.locator('#view .rep')).toHaveCount(8);
  for (const type of ['daily', 'util', 'loc', 'prod', 'over', 'hist', 'out', 'exc']) {
    await page.locator(`[data-action="report-select"][data-type="${type}"]`).click();
    await expect(page.locator('#report-preview')).toBeVisible();
  }
  await navigate(page, 'analytics');
  await expect(page.locator('#view .grid.g2 > section.card')).toHaveCount(7);
  await expect(page.locator('#view')).toContainText('No simulated values');
  const analytics = await api('analytics');
  expect(analytics.metrics.completedRoundTrips).toBe(0);
  expect(analytics.metrics.averageRoundTripHours).toBeNull();
  expect(analytics.charts.dailyMovements.data.every((value) => value === 0)).toBe(true);
  expect((await api('history')).items).toHaveLength(0);
  await navigate(page, 'settings');
  await page.locator('#view').getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('#view h1')).toHaveText('Settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('master registration, audited editing, activation and permanent QR download work together', async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, 'master');
  await page.getByRole('button', { name: 'Add trolley', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Trolley ID', { exact: true }).fill('TR-900');
  await dialog.getByLabel('QR code', { exact: true }).fill('QR-TR-900');
  await dialog.getByLabel('Trolley type', { exact: true }).selectOption('Component Trolley');
  await dialog.getByLabel('Capacity (same units as load)', { exact: true }).fill('150');
  await dialog.getByLabel('Capacity unit', { exact: true }).fill('pcs');
  await dialog.getByLabel('Material type', { exact: true }).selectOption('Component');
  await dialog.getByLabel('Department', { exact: true }).fill('Stores');
  await dialog.getByLabel('Assigned area', { exact: true }).selectOption('PROD-L01');
  await dialog.getByLabel('RFID number', { exact: true }).fill('RFID-ACCEPTANCE-900');
  await dialog.getByLabel('Starting location', { exact: true }).selectOption('STORE-01');
  await dialog.getByRole('button', { name: 'Save trolley', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel('Search by trolley ID, QR or RFID number', { exact: true }).fill('TR-900');
  let row = page
    .locator('#view tbody tr')
    .filter({ has: page.getByRole('button', { name: 'TR-900', exact: true }) });
  await expect(row).toContainText('RFID-ACCEPTANCE-900');
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByLabel('Trolley ID', { exact: true })).toHaveAttribute('readonly', '');
  await dialog.getByLabel('Capacity (same units as load)', { exact: true }).fill('175');
  await dialog.getByLabel('Department', { exact: true }).fill('Assembly');
  await dialog.getByRole('button', { name: 'Save trolley', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText('175 pcs');
  await row.getByRole('button', { name: 'View details', exact: true }).click();
  await expect(dialog).toContainText('Assembly');
  await expect(dialog).toContainText('Master updated');
  await dialog.getByRole('button', { name: 'Generate QR', exact: true }).click();
  await expect(dialog.getByRole('heading')).toHaveText('QR label · TR-900');
  const contents = await downloaded(
    page,
    () => dialog.getByRole('link', { name: 'Save label', exact: true }).click(),
    'svg',
    '<svg',
  );
  expect(contents.toString()).toContain('<path');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  page.once('dialog', (prompt) => prompt.accept());
  await row.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(row).toContainText('Inactive');
  page.once('dialog', (prompt) => prompt.accept());
  await row.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(row).toContainText('Available');
  expect(
    (await api('trolleys/TR-900')).audit.filter((event) =>
      /Trolley (deactivated|activated)/.test(event.action),
    ),
  ).toHaveLength(2);
});

test('manual, QR and RFID identification show real records and unknown codes leave operations unchanged', async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, 'scan');
  const state = await api('state');
  const trolley = state.trolleys.find((item) => item.id === 'TR-001');
  for (const code of [trolley.id, trolley.qr, trolley.rfid]) {
    await page.getByLabel('Trolley ID, QR or RFID tag', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Identify trolley', exact: true }).click();
    await expect(page.locator('#scan-result')).toContainText('TR-001');
    await expect(page.locator('#scan-result')).toContainText('Main Store');
  }
  await page.getByLabel('Trolley ID, QR or RFID tag', { exact: true }).fill('UNKNOWN-TAG-999');
  await page.getByRole('button', { name: 'Identify trolley', exact: true }).click();
  await expect(page.locator('#scan-result')).toContainText('Trolley not found');
  await page.getByLabel('Find a trolley by ID, QR or RFID', { exact: true }).fill(trolley.rfid);
  await page.getByRole('button', { name: 'Search trolleys', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText(
    'Trolley TR-001',
  );
  expect((await api('history')).items).toHaveLength(0);
});

test('reported issues retain acknowledgement, resolution and per-user notification read state', async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, 'scan');
  await page.getByLabel('Trolley ID, QR or RFID tag', { exact: true }).fill('TR-001');
  await page.getByRole('button', { name: 'Identify trolley', exact: true }).click();
  await page
    .locator('#scan-result')
    .getByRole('button', { name: 'Report issue', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What is wrong?', { exact: true }).selectOption('Trolley missing');
  await dialog.getByLabel('Priority', { exact: true }).selectOption('High');
  await dialog
    .getByLabel('Details', { exact: true })
    .fill('Acceptance inspection: trolley absent from marked bay');
  await dialog.getByRole('button', { name: 'Report issue', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await navigate(page, 'alerts');
  let row = page
    .locator('#view tbody tr')
    .filter({ hasText: 'Acceptance inspection: trolley absent from marked bay' });
  await expect(row).toContainText('Open');
  await row.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(row).toContainText('Acknowledged');
  await row.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect
    .poll(async () => (await dialog.isVisible()) || (await row.textContent()).includes('Resolved'))
    .toBe(true);
  if (await dialog.isVisible()) {
    await dialog
      .getByLabel('Resolution details', { exact: true })
      .fill('Found at the adjacent marked bay');
    await dialog.getByRole('button', { name: 'Resolve alert', exact: true }).click();
  }
  await expect(row).toContainText('Resolved');
  await page.locator('button[data-action="notifications"]').click();
  await expect(page.locator('#bellPop')).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect
    .poll(async () => (await api('notifications')).filter((item) => !item.read).length)
    .toBe(0);
  expect((await api('notifications', undefined, 'operator')).some((item) => !item.read)).toBe(true);
  const detail = await api('trolleys/TR-001');
  expect(detail.audit.some((event) => event.action === 'Alert acknowledge')).toBe(true);
  expect(detail.audit.some((event) => event.action === 'Alert resolve')).toBe(true);
});

test('mismatched product verification requests an independently reviewed approval', async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, 'products');
  const state = await api('state');
  const loaded = state.trolleys.find(
    (item) => item.product && item.unit === 'pcs' && item.location.startsWith('PROD-'),
  );
  const wrongProduct = loaded.product === 'CMP-A01' ? 'CMP-B02' : 'CMP-A01';
  await page
    .locator('[data-form="verify"]')
    .getByLabel('Trolley ID', { exact: true })
    .fill(loaded.id);
  await page.getByLabel('Product scanned', { exact: true }).selectOption(wrongProduct);
  await page.getByRole('button', { name: 'Verify scan', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Product mismatch detected', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Request supervisor approval', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: new RegExp(`Product mismatch awaiting review`) }),
  ).toBeVisible();
  await navigate(page, 'approvals');
  await expect(
    page.locator('.apc').getByRole('button', { name: 'Approve', exact: true }),
  ).toHaveCount(0);
  await signIn(page, 'supervisor');
  await navigate(page, 'approvals');
  const card = page.locator('.apc').filter({ hasText: loaded.id });
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Remarks / approval reason', { exact: true })
    .fill('Load reviewed by independent supervisor');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Approve request', exact: true })
    .click();
  await expect(page.locator('.apc')).toHaveCount(0);
  await expect(page.locator('#view tbody tr').filter({ hasText: loaded.id })).toContainText(
    'Approved',
  );
  const approvals = (await api('state')).approvals;
  expect(approvals[0].requested_by).not.toBe(approvals[0].decided_by);
  expect((await api(`trolleys/${loaded.id}`)).trolley.product).toBe(loaded.product);
});

test('correction requests preserve the original decision and resubmit as a new independently approved move', async ({
  page,
}) => {
  const request = await move('TR-001', 'OUT-01', { reason: 'Sample vendor processing' });
  expect(request.state).toBe('Pending');
  await signIn(page, 'supervisor');
  await navigate(page, 'approvals');
  await page
    .locator('.apc')
    .getByRole('button', { name: 'Request correction', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('Reason and correction instructions', { exact: true })
    .fill('Add the vendor gate pass reference');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Request correction', exact: true })
    .click();
  await expect(page.locator('#view tbody tr').filter({ hasText: 'TR-001' })).toContainText(
    'Correction Requested',
  );
  await signIn(page);
  await navigate(page, 'approvals');
  await page.getByRole('button', { name: 'Correct and resubmit', exact: true }).click();
  await expect(page.locator('#view h1')).toHaveText('Record trolley movement');
  await expect(page.getByLabel('Trolley ID', { exact: true })).toHaveValue('TR-001');
  await expect(page.getByLabel('Destination', { exact: true })).toHaveValue('OUT-01');
  await page.getByLabel('Reason', { exact: true }).fill('Gate pass GP-ACCEPTANCE-01 attached');
  await page.getByRole('button', { name: 'Record movement', exact: true }).click();
  await expect.poll(async () => (await api('state')).approvals.length).toBe(2);
  await signIn(page, 'supervisor');
  await navigate(page, 'approvals');
  await page.locator('.apc').getByRole('button', { name: 'Approve', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Remarks / approval reason', { exact: true })
    .fill('Vendor reference checked');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Approve request', exact: true })
    .click();
  await navigate(page, 'movement');
  await page.getByRole('button', { name: 'Confirm arrival', exact: true }).click();
  await expect
    .poll(async () => (await api('trolleys/TR-001')).trolley.status)
    .toBe('Outside Plant');
  expect((await api('state')).approvals.map((entry) => entry.status).sort()).toEqual([
    'Approved',
    'Correction Requested',
  ]);
});

test('history filters and genuine Excel/PDF/CSV downloads retain records through demo restoration', async ({
  page,
}) => {
  for (const id of ['TR-001', 'TR-002'])
    await move(id, 'PROD-L01', {
      product: 'CMP-A01',
      batch: 'ACCEPT-BATCH',
      qty: 20,
      direct_complete: true,
      movement_type: 'Production Issue',
      reason: `Acceptance history ${id}`,
      department: 'Production',
    });
  await signIn(page);
  await navigate(page, 'history');
  await page.locator('[data-filter="history.trolley"]').fill('TR-001');
  await expect(page.locator('#view tbody tr')).toHaveCount(1);
  await page.locator('[data-filter="history.location"]').selectOption('PROD-L01');
  await page.locator('[data-filter="history.product"]').selectOption('CMP-A01');
  await page.locator('[data-filter="history.type"]').selectOption('Production Issue');
  await page.locator('[data-filter="history.status"]').selectOption('Received');
  await page.locator('[data-filter="history.operator"]').selectOption('1');
  const today = new Date().toISOString().slice(0, 10);
  await page.locator('[data-filter="history.from"]').fill(today);
  await page.locator('[data-filter="history.to"]').fill(today);
  await page.locator('[data-filter="history.q"]').fill('Acceptance history');
  await expect(page.locator('#view tbody tr')).toHaveCount(1);
  await expect(page.locator('#view tbody tr')).toContainText('Acceptance history TR-001');
  await downloaded(
    page,
    () => page.getByRole('button', { name: 'Export Excel', exact: true }).click(),
    'xlsx',
    'PK',
  );
  await downloaded(
    page,
    () => page.getByRole('button', { name: 'Export PDF', exact: true }).click(),
    'pdf',
    '%PDF-',
  );
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await readFile(await (await csvDownload).path(), 'utf8');
  expect(csv).toContain('Acceptance history TR-001');
  expect(csv).not.toContain('Acceptance history TR-002');
  const before = await api('history');
  await navigate(page, 'settings');
  await page.getByRole('button', { name: 'Demo data', exact: true }).click();
  page.once('dialog', (prompt) => prompt.accept('RESET DEMO DATA'));
  await page.getByRole('button', { name: 'Reset demo data', exact: true }).click();
  await expect.poll(async () => (await api('trolleys/TR-001')).trolley.location).toBe('STORE-01');
  expect((await api('history')).items.map((row) => row.id)).toEqual(
    before.items.map((row) => row.id),
  );
  await page.reload();
  await expect(page.locator('#view h1')).toHaveText('Settings');
  expect((await api('state')).trolleys).toHaveLength(128);
});

test('390px operator movement and Plant Manager monitoring remain usable without page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'operator');
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
      false,
    );
  await noOverflow();
  await navigate(page, 'scan');
  await noOverflow();
  await page.getByLabel('Trolley ID, QR or RFID tag', { exact: true }).fill('TR-001');
  await page.getByRole('button', { name: 'Identify trolley', exact: true }).click();
  await page
    .locator('#scan-result')
    .getByRole('button', { name: 'Move trolley', exact: true })
    .click();
  await expect(page.locator('#view h1')).toHaveText('Record trolley movement');
  await noOverflow();
  await page.getByLabel('Destination', { exact: true }).selectOption('PROD-L01');
  await page.getByLabel('Product / material', { exact: true }).selectOption('CMP-A01');
  await page.getByLabel('Batch', { exact: true }).fill('MOBILE-BATCH');
  await page.getByLabel('Quantity (capacity units)', { exact: true }).fill('25');
  await page.getByRole('button', { name: 'Record movement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm arrival', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm arrival', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm arrival', exact: true })).toHaveCount(0);
  await navigate(page, 'live');
  await noOverflow();
  expect((await api('trolleys/TR-001')).trolley.location).toBe('PROD-L01');
  await signIn(page, 'manager');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(page.locator('#nav > button')).toHaveCount(10);
  await expect(page.locator('#nav [data-page="movement"]')).toHaveCount(0);
  await expect(page.locator('#nav [data-page="master"]')).toHaveCount(0);
  await page.locator('#nav [data-page="analytics"]').click();
  await expect(page.locator('#view h1')).toHaveText('Analytics');
  await noOverflow();
});
