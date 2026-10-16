import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { fixture, prepare, movement } from './helpers.mjs';

test('HTTP operations preserve alert workflow, notification ownership and lookup identities', async () => {
  const app = await fixture();
  try {
    const { operator } = await prepare(app);
    const saved = await app.request(
      'trolleys/TR-001/update',
      { version: 1, rfid: 'RFID-001' },
      app.admin,
    );
    assert.equal(saved.status, 200);
    const found = await app.request('lookup?code=rfid-001', undefined, operator);
    assert.equal(found.body.id, 'TR-001');
    assert.equal(found.body.expected, null);
    const incident = await app.request(
      'incidents',
      {
        type: 'Trolley missing',
        priority: 'High',
        trolley: 'TR-001',
        location: 'STORE',
        message: 'Trolley absent from its assigned bay.',
      },
      operator,
    );
    assert.equal(incident.status, 201);
    const record = incident.body.alert || incident.body;
    assert.equal(
      (await app.request(`alerts/${record.id}`, { status: 'Acknowledged' }, operator)).status,
      403,
    );
    assert.equal(
      (await app.request(`alerts/${record.id}`, { status: 'Acknowledged' }, app.admin)).status,
      200,
    );
    assert.equal(
      (await app.request(`alerts/${record.id}`, { status: 'Resolved' }, app.admin)).status,
      200,
    );
    const state = (await app.request('state', undefined, app.admin)).body;
    assert.equal(state.alerts.find((a) => a.id === record.id).status, 'Resolved');
    assert.ok(state.tags.some((tag) => tag.tag === 'RFID-001'));
    assert.ok(state.notifications.length);
    assert.equal((await app.request('notifications/all', {}, app.admin)).status, 200);
    assert.ok(
      (await app.request('operations', undefined, app.admin)).body.notifications.every(
        (n) => n.read,
      ),
    );
    assert.equal(
      app.repository.get('SELECT location FROM trolleys WHERE id=?', 'TR-001').location,
      'STORE',
    );
  } finally {
    await app.close();
  }
});

test('report downloads contain complete filtered XLSX data and a real PDF document', async () => {
  const app = await fixture();
  try {
    await prepare(app);
    assert.equal(
      (await app.request('movements', movement({ in_transit: false }), app.admin)).status,
      201,
    );
    const catalogue = await app.request('reports', undefined, app.admin);
    assert.equal(catalogue.status, 200);
    assert.equal(catalogue.body.reports.length, 8);
    const report = (await app.request('reports?kind=hist&trolley=TR-001', undefined, app.admin))
      .body;
    const response = await fetch(app.base + '/api/reports/hist/xlsx?trolley=TR-001', {
      headers: { Cookie: app.admin },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /spreadsheetml/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const sheet = workbook.getWorksheet('Report');
    assert.deepEqual(sheet.getRow(1).values.slice(1), report.columns);
    assert.equal(sheet.rowCount, report.rows.length + 1);
    assert.ok(sheet.getRow(2).values.includes('TR-001'));
    const filtered = await fetch(app.base + '/api/reports/hist/xlsx?trolley=NO-MATCH', {
      headers: { Cookie: app.admin },
    });
    const empty = new ExcelJS.Workbook();
    await empty.xlsx.load(Buffer.from(await filtered.arrayBuffer()));
    assert.equal(empty.getWorksheet('Report').rowCount, 1);
    const pdf = await fetch(app.base + '/api/reports/hist/pdf?trolley=TR-001', {
      headers: { Cookie: app.admin },
    });
    assert.equal(pdf.status, 200);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(bytes.length > 1000);
    const anonymous = await fetch(app.base + '/api/reports/hist/xlsx');
    assert.equal(anonymous.status, 401);
    const analytics = (await app.request('analytics', undefined, app.admin)).body;
    assert.equal(analytics.arrivals.find((row) => row.location === 'LINE').count, 1);
  } finally {
    await app.close();
  }
});
