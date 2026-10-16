import { test, expect } from '@playwright/test';
import { fixture, prepare, movement } from '../tests/helpers.mjs';

let application;
let errors;

test.beforeEach(async ({ page }) => {
  application = await fixture(':memory:', { deviceEncryptionKey: '11'.repeat(32) });
  await prepare(application);
  await page.setViewportSize({ width: 1440, height: 1000 });
  errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(async () => {
  await application.close();
  expect(errors).toEqual([]);
});

async function signIn(page, username = 'admin') {
  await page.goto(application.base);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plant overview', exact: true })).toBeVisible();
}

async function navigate(page, destination, heading) {
  const sidebar = page.locator('#sidebar');
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) {
    if (!(await sidebar.evaluate((element) => element.classList.contains('open'))))
      await menu.click();
  }
  await sidebar.getByRole('button', { name: destination }).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

async function downloadedBytes(page, trigger) {
  const event = page.waitForEvent('download');
  await trigger();
  const download = await event;
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { download, bytes: Buffer.concat(chunks) };
}

function seedOverdueAssignment() {
  const operator = application.repository.get("SELECT id FROM users WHERE username = 'operator'");
  const received = Date.now() - 5 * 3600000;
  application.repository.run(
    `INSERT INTO movements(trolley, source, destination, product, batch, qty, state,
      requested_by, created, expected, received, received_by, key, payload, version,
      movement_type, operator_name, occurred_at)
    VALUES ('TR-001', 'STORE', 'LINE', 'P1', 'B-PAST', 25, 'Received', ?, ?, ?, ?, ?,
      'historical-assignment', '{}', 1, 'Production Issue', 'operator', ?)`,
    operator.id,
    received - 60000,
    received,
    received,
    operator.id,
    received - 60000,
  );
  application.repository.run(
    "UPDATE trolleys SET location = 'LINE', product = 'P1', batch = 'B-PAST', qty = 25, status = 'In Use', version = 3, updated = ? WHERE id = 'TR-001'",
    received,
  );
}

test('trolley metadata is registered, edited and found through its RFID and QR identifiers', async ({
  page,
}) => {
  await signIn(page);
  await page.screenshot({ path: '/tmp/trolley-upgrade-shots/dashboard.png', fullPage: true });
  await navigate(page, 'Plant setup', 'Plant setup');
  const registration = page.locator('#trolleys');
  await registration.getByLabel('Trolley ID / QR value', { exact: true }).fill('TR-042');
  await registration.getByLabel('Trolley type', { exact: true }).fill('Assembly trolley');
  await registration
    .getByLabel('Capacity (same units as load quantity)', { exact: true })
    .fill('150');
  await registration.getByLabel('Material type', { exact: true }).fill('Steel components');
  await registration.getByLabel('Department', { exact: true }).fill('Assembly');
  await registration
    .getByRole('combobox', { name: 'Assigned area', exact: true })
    .selectOption('STORE');
  await registration
    .getByRole('combobox', { name: 'Initial location', exact: true })
    .selectOption('STORE');
  await registration.getByLabel('QR value', { exact: true }).fill('QR-ASSEMBLY-042');
  await registration.getByLabel('RFID number', { exact: true }).fill('EPC-042-A');
  await registration.getByRole('button', { name: 'Register trolley', exact: true }).click();
  await expect(page.locator('[data-edit-master="trolleys"][data-id="TR-042"]')).toBeVisible();
  await page.screenshot({ path: '/tmp/trolley-upgrade-shots/master.png', fullPage: true });
  await page.locator('[data-edit-master="trolleys"][data-id="TR-042"]').click();
  const edit = page.locator('#master-edit');
  await expect(edit.getByLabel('Trolley ID / QR value', { exact: true })).toHaveValue('TR-042');
  await edit.getByLabel('RFID number', { exact: true }).fill('EPC-042-B');
  await edit.getByLabel('Department', { exact: true }).fill('Final assembly');
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#master-edit')).toHaveCount(0);

  await navigate(page, 'Scan trolley', 'Scan trolley');
  await page.locator('#scan-lookup input[name="code"]').fill('epc-042-b');
  await page.getByRole('button', { name: 'Find trolley', exact: true }).last().click();
  await expect(page.locator('#scan-result')).toContainText('TR-042');
  await page.getByRole('button', { name: 'View details & history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'TR-042', exact: true }).first()).toBeVisible();
  await expect(page.locator('.detail-list')).toContainText('Final assembly');
  await expect(page.locator('.detail-list')).toContainText('EPC-042-B');
  await expect(page.locator('.detail-list')).toContainText('QR-ASSEMBLY-042');
  const label = await downloadedBytes(page, () =>
    page.getByRole('link', { name: 'Download QR label' }).click(),
  );
  expect(label.download.suggestedFilename()).toBe('TR-042.svg');
  expect(label.bytes.toString()).toContain('<svg');

  await page.locator('#global-code').fill('qr-assembly-042');
  await page.locator('#global-lookup button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'TR-042', exact: true }).first()).toBeVisible();
  expect(
    application.repository.get("SELECT COUNT(*) AS n FROM movements WHERE trolley = 'TR-042'").n,
  ).toBe(0);
});

test('an operational incident is acknowledged, resolved and its notification is marked read', async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, 'Alerts', 'Alerts center');
  await page.getByText('Report an issue', { exact: true }).click();
  const report = page.locator('#incident-report');
  await report.getByRole('combobox', { name: 'Trolley', exact: true }).selectOption('TR-001');
  await report
    .getByRole('combobox', { name: 'Issue type', exact: true })
    .selectOption('Trolley missing');
  await report.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('High');
  await report
    .getByLabel('What happened?', { exact: true })
    .fill('Trolley was absent from the marked store bay at shift handover.');
  await report.getByRole('button', { name: 'Report issue', exact: true }).click();
  const row = page
    .getByRole('row')
    .filter({ hasText: 'Trolley was absent from the marked store bay' });
  await expect(row).toContainText('Open');
  await row.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(row).toContainText('Acknowledged');
  await row.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(row).toContainText('Resolved');
  await expect(row.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(0);
  await page.locator('header [data-page="notifications"]').click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.locator('.notification')).toContainText('Trolley missing: TR-001');
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0 unread', exact: true })).toBeVisible();
  const event = application.repository.get(
    "SELECT status, acknowledged_by, resolved_by FROM alerts WHERE type = 'Trolley missing'",
  );
  expect(event.status).toBe('Resolved');
  expect(event.acknowledged_by).toBeTruthy();
  expect(event.resolved_by).toBeTruthy();
});

test('product mismatches require an independent approver and retain the decision history', async ({
  page,
  browser,
}) => {
  const product = await application.request(
    'products',
    { id: 'P2', name: 'Bearing' },
    application.admin,
  );
  expect(product.status).toBe(201);
  const departure = await application.request(
    'movements',
    movement({ in_transit: false }),
    application.admin,
  );
  expect(departure.body.state).toBe('Received');
  await signIn(page);
  await navigate(page, 'Products & materials', 'Product & material segregation');
  await page.locator('#scan-verify').getByLabel('Trolley ID', { exact: true }).fill('TR-001');
  await page
    .locator('#scan-verify')
    .getByRole('combobox', { name: 'Product scanned', exact: true })
    .selectOption('P2');
  await page.getByRole('button', { name: 'Verify scan', exact: true }).click();
  await expect(page.locator('#verification-result')).toContainText(
    'Scanned product P2 differs from assigned product P1',
  );
  page.once('dialog', (dialog) =>
    dialog.accept('Review this material exception before the trolley is used.'),
  );
  await page.getByRole('button', { name: 'Request supervisor approval', exact: true }).click();
  await expect
    .poll(() => application.repository.get('SELECT COUNT(*) AS n FROM mismatch_approvals').n)
    .toBe(1);
  await navigate(page, 'Approvals', 'Approval queue');
  await expect(page.locator('.approval-card')).toContainText('Awaiting an independent approver');
  await expect(page.locator('.approval-card button')).toHaveCount(0);

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const supervisor = await context.newPage();
    supervisor.on('pageerror', (error) => errors.push(error.message));
    await signIn(supervisor, 'supervisor');
    await navigate(supervisor, 'Approvals', 'Approval queue');
    await expect(supervisor.locator('.approval-card')).toContainText(
      'Review this material exception',
    );
    supervisor.once('dialog', (dialog) =>
      dialog.accept('Material checked with production and exception approved.'),
    );
    await supervisor
      .locator('.approval-card')
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    await expect(supervisor.locator('.approval-card')).toHaveCount(0);
    const decision = supervisor.getByRole('row').filter({ hasText: 'Product verification' });
    await expect(decision).toContainText('Approved');
    await expect(decision).toContainText('supervisor');
    await expect(decision).toContainText('Material checked with production');
  } finally {
    await context.close();
  }
});

test('all eight report previews produce real Excel and PDF downloads', async ({ page }) => {
  test.setTimeout(90000);
  const recorded = await application.request(
    'movements',
    movement({ in_transit: false }),
    application.admin,
  );
  expect(recorded.body.state).toBe('Received');
  await signIn(page);
  await navigate(page, 'Reports', 'Reports & analytics');
  await expect(page.locator('.report-card')).toHaveCount(8);
  const reports = [
    ['daily', 'Daily trolley movement report'],
    ['util', 'Trolley utilization report'],
    ['loc', 'Location-wise trolley report'],
    ['prod', 'Product-wise trolley report'],
    ['over', 'Overdue trolley report'],
    ['hist', 'Trolley history report'],
    ['out', 'Outside plant trolley report'],
    ['exc', 'Movement exception report'],
  ];
  for (const [kind, title] of reports) {
    await page.locator(`[data-report-view="${kind}"]`).click();
    await expect(page.locator('#report-preview-title')).toHaveText(title);
    for (const format of ['xlsx', 'pdf']) {
      const { download, bytes } = await downloadedBytes(page, () =>
        page
          .locator(`.report-preview [data-report-export="${kind}"][data-format="${format}"]`)
          .click(),
      );
      expect(download.suggestedFilename()).toBe(`trolley-${kind}.${format}`);
      expect(bytes.length).toBeGreaterThan(500);
      expect(bytes.subarray(0, format === 'xlsx' ? 2 : 5).toString()).toBe(
        format === 'xlsx' ? 'PK' : '%PDF-',
      );
    }
  }
});

test('analytics charts and theme preferences remain usable through mobile navigation', async ({
  page,
}) => {
  await application.request('movements', movement({ in_transit: false }), application.admin);
  await signIn(page);
  await navigate(page, 'Analytics', 'Analytics');
  await expect(page.locator('.chart-svg')).toHaveCount(7);
  await page.screenshot({ path: '/tmp/trolley-upgrade-shots/analytics.png', fullPage: true });
  await page.getByRole('button', { name: 'Weekly', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Weekly', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('From date', { exact: true }).fill('2020-01-01');
  await page.getByLabel('To date', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Apply period', exact: true }).click();
  await expect(page.getByLabel('From date', { exact: true })).toHaveValue('2020-01-01');
  await navigate(page, 'Settings', 'Settings');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate(page, 'Locations', 'Plant location tracking');
  await page.locator('[data-filter-location="LINE"]').click();
  await expect(page.locator('#location-detail')).toContainText('TR-001');
  await page.screenshot({ path: '/tmp/trolley-upgrade-shots/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('overdue follow-up sends a real reminder and pre-fills a completed return', async ({
  page,
}) => {
  seedOverdueAssignment();
  await signIn(page);
  await navigate(page, 'Overdue trolleys', 'Overdue trolleys');
  await expect(page.getByText('Critical · Escalated', { exact: true })).toBeVisible();
  await page.locator('[data-remind="TR-001"]').click();
  await expect
    .poll(
      () =>
        application.repository.get(
          "SELECT COUNT(*) AS n FROM notifications WHERE title = 'Overdue trolley reminder: TR-001'",
        ).n,
    )
    .toBeGreaterThan(0);
  await page.locator('[data-return="TR-001"]').click();
  await expect(
    page.getByRole('heading', { name: 'Move or scan a trolley', exact: true }),
  ).toBeVisible();
  const form = page.locator('#move');
  await expect(form.getByLabel('Scan / trolley ID', { exact: true })).toHaveValue('TR-001');
  await expect(form.getByRole('combobox', { name: 'Movement type', exact: true })).toHaveValue(
    'Production Return',
  );
  await expect(form.getByRole('combobox', { name: 'Destination', exact: true })).toHaveValue(
    'STORE',
  );
  await expect(form.getByLabel('Quantity (capacity units)', { exact: true })).toHaveValue('0');
  await form.getByLabel('Keep in transit until physical receipt', { exact: true }).uncheck();
  await form.getByRole('button', { name: 'Record movement', exact: true }).click();
  await expect
    .poll(
      () => application.repository.get("SELECT status FROM trolleys WHERE id = 'TR-001'").status,
    )
    .toBe('Available');
  await navigate(page, 'Overdue trolleys', 'Overdue trolleys');
  await expect(page.getByText('Nothing overdue', { exact: true })).toBeVisible();
  await navigate(page, 'Movement history', 'Movement history');
  await expect(page.getByRole('row').filter({ hasText: 'Production Return' })).toContainText(
    'Completed',
  );
});
