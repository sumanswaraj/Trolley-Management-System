import { test, expect } from '@playwright/test';
import { fixture, prepare, movement } from '../tests/helpers.mjs';

test('a requester revises a corrected movement without overwriting its history', async ({
  page,
}) => {
  const app = await fixture();
  try {
    const { operator, supervisor } = await prepare(app);
    const original = await app.request(
      'movements',
      movement({ destination: 'OUT', product: null, batch: 'EMPTY', qty: 0 }),
      operator,
    );
    expect(original.status).toBe(201);
    expect(
      (
        await app.request(
          `movements/${original.body.id}/correct`,
          { reason: 'Please provide the vendor reference.' },
          supervisor,
        )
      ).status,
    ).toBe(200);
    await page.goto(app.base);
    await page.getByLabel('Username', { exact: true }).fill('operator');
    await page.getByLabel('Password', { exact: true }).fill('test-password-123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Plant overview', exact: true })).toBeVisible();
    await page
      .locator('#sidebar')
      .getByRole('button', { name: 'Movement history', exact: true })
      .click();
    await page.getByRole('button', { name: 'Revise request', exact: true }).click();
    await expect(page.getByLabel('Destination', { exact: true })).toHaveValue('OUT');
    await page.getByLabel('Reason', { exact: true }).fill('Vendor reference V-2026 confirmed.');
    await page.getByRole('button', { name: 'Record movement', exact: true }).click();
    await expect.poll(() => app.repository.all('SELECT id FROM movements').length).toBe(2);
    const rows = app.repository.all('SELECT * FROM movements ORDER BY id');
    expect(rows[0].state).toBe('Rejected');
    expect(rows[1].revision_of).toBe(rows[0].id);
    expect(rows[1].state).toBe('Pending');
    expect(rows[1].reason).toBe('Vendor reference V-2026 confirmed.');
    expect(app.repository.all('SELECT * FROM correction_requests')).toHaveLength(1);
  } finally {
    await app.close();
  }
});
