import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import { fixture, prepare } from '../tests/helpers.mjs';

let application;
test.beforeEach(async () => {
  application = await fixture(':memory:', { deviceEncryptionKey: '11'.repeat(32) });
  await prepare(application);
});
test.afterEach(async () => {
  await application.close();
});

async function signIn(page, username = 'admin') {
  await page.goto(application.base);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plant overview' })).toBeVisible();
}
async function navigate(page, name, heading) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`sign-in, form validation, movement and receipt at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signIn(page, 'operator');
    await navigate(page, 'Move / scan', 'Move or scan a trolley');
    await page.getByLabel('Scan / trolley ID', { exact: true }).fill('TR-001');
    await page.getByLabel('Destination', { exact: true }).selectOption('LINE');
    await page.getByLabel('Product', { exact: true }).selectOption('P1');
    await page.getByLabel('Batch', { exact: true }).fill('B1');
    await page.getByLabel('Quantity (capacity units)', { exact: true }).fill('50');
    await page.getByLabel('Expected arrival / return', { exact: true }).fill('2030-01-01T12:00');
    await page.getByRole('button', { name: 'Record movement', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm arrival', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm arrival', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm arrival', exact: true })).toHaveCount(0);
    await navigate(page, 'Trolley fleet', 'Trolley fleet');
    if (viewport.width < 850)
      await expect(page.locator('.trolley-cards').getByText('Line', { exact: true })).toBeVisible();
    else await expect(page.getByRole('cell', { name: 'Line', exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/fleet-${viewport.width}.png`, fullPage: true });
  });
}

test('camera fallback decodes a real QR image, fills the form and stops the stream', async ({
  page,
}) => {
  const dataUrl = await QRCode.toDataURL('TR-001', { width: 640, margin: 4 });
  await page.addInitScript(
    ({ dataUrl }) => {
      window.BarcodeDetector = undefined;
      window.stoppedCameraTracks = 0;
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 640;
      const image = new Image();
      const ready = new Promise((resolve) => {
        image.onload = () => {
          canvas.getContext('2d').drawImage(image, 0, 0, 640, 640);
          resolve();
        };
      });
      image.src = dataUrl;
      navigator.mediaDevices.getUserMedia = async () => {
        await ready;
        const stream = canvas.captureStream(10);
        const timer = setInterval(
          () => canvas.getContext('2d').drawImage(image, 0, 0, 640, 640),
          100,
        );
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            window.stoppedCameraTracks += 1;
            clearInterval(timer);
            stop();
          };
        }
        return stream;
      };
    },
    { dataUrl },
  );
  await signIn(page, 'operator');
  await navigate(page, 'Move / scan', 'Move or scan a trolley');
  await page.getByRole('button', { name: 'Scan with camera' }).click();
  await expect(page.getByLabel('Scan / trolley ID', { exact: true })).toHaveValue('TR-001');
  await expect(page.locator('#scan-status')).toContainText('Scanned TR-001');
  await expect.poll(() => page.evaluate(() => window.stoppedCameraTracks)).toBeGreaterThan(0);
  expect(application.repository.get('SELECT COUNT(*) AS n FROM movements').n).toBe(0);
});

test('camera permission rejection preserves USB and manual workflows', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new Error('Camera permission denied');
    };
  });
  await signIn(page);
  await navigate(page, 'Move / scan', 'Move or scan a trolley');
  await page.getByRole('button', { name: 'Scan with camera' }).click();
  await expect(page.locator('#scan-status')).toContainText('Camera permission denied');
  await page.getByLabel('Scan / trolley ID', { exact: true }).fill('TR-001');
  await expect(page.getByLabel('Scan / trolley ID', { exact: true })).toHaveValue('TR-001');
});

test('administrator can configure plant policy and provision a one-time reader credential', async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, 'Plant rules', 'Plant rules');
  await page.getByLabel('Enforce allowed product routes', { exact: true }).check();
  await page.getByRole('button', { name: 'Save enforcement', exact: true }).click();
  await expect(page.getByLabel('Enforce allowed product routes', { exact: true })).toBeChecked();
  await navigate(page, 'Readers & tags', 'Readers & tags');
  await page.getByLabel('Reader ID', { exact: true }).fill('LINE-GATE');
  await page.getByLabel('Reader name', { exact: true }).fill('Line entrance');
  await page.getByLabel('Installed location', { exact: true }).selectOption('LINE');
  await page.getByRole('button', { name: 'Create reader', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save this credential now' })).toBeVisible();
  await page.getByRole('button', { name: 'I have saved it' }).click();
  await expect(page.getByRole('heading', { name: 'Save this credential now' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Line entrance' })).toBeVisible();
});
