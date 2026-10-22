import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { openDatabase } from '../src/database.mjs';
import { reportService } from '../src/services/reports.mjs';
import { exportService } from '../src/services/exports.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const admin = { id: 1, role: 'Admin' };
const manager = { id: 2, role: 'Plant Manager' };
const operator = { id: 3, role: 'Operator' };
const supervisor = { id: 4, role: 'Supervisor' };

function fixture() {
  const repository = openDatabase(':memory:');
  const now = Date.now();
  const base = Math.floor(now / DAY) * DAY - 4 * DAY;
  for (const [id, username, name, role] of [
    [1, 'admin', 'Administrator', 'Admin'],
    [2, 'manager', 'Plant manager', 'Plant Manager'],
    [3, 'operator', 'Asha Operator', 'Operator'],
    [4, 'supervisor', 'Shift supervisor', 'Supervisor'],
  ])
    repository.run(
      'INSERT INTO users(id,username,name,role,salt,password) VALUES (?,?,?,?,?,?)',
      id,
      username,
      name,
      role,
      'salt',
      'hash',
    );
  for (const [id, name, external, group] of [
    ['STORE', 'Main store', 0, 'Store'],
    ['LINE', 'Production line', 0, 'Production'],
    ['OUT', 'Outside supplier', 1, 'Outside Plant'],
  ])
    repository.run(
      'INSERT INTO locations(id,name,external,group_name,capacity,department) VALUES (?,?,?,?,?,?)',
      id,
      name,
      external,
      group,
      10,
      'Plant',
    );
  repository.run(
    "INSERT INTO products(id,name,category,unit) VALUES ('P1','Gear','Component','pcs'),('P2','Plate','Raw','kg')",
  );
  for (const [id, type, location, state, product, batch, quantity, expected] of [
    ['TR-001', 'Component', 'STORE', 'Available', null, '', 0, null],
    ['TR-002', 'Component', 'LINE', 'In Use', 'P1', 'B-1', 20, now - HOUR],
    ['TR-003', 'Raw', 'OUT', 'Outside Plant', 'P2', 'B-2', 5, now + HOUR],
  ])
    repository.run(
      'INSERT INTO trolleys(id,type,capacity,location,status,product,batch,qty,department,operator_id,expected,since,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id,
      type,
      100,
      location,
      state,
      product,
      batch,
      quantity,
      'Plant',
      3,
      expected,
      now - 5 * HOUR,
      base,
    );
  let sequence = 0;
  const movement = (override = {}) => {
    const m = {
      trolley: 'TR-001',
      source: 'STORE',
      destination: 'LINE',
      product: 'P1',
      batch: 'B-1',
      qty: 20,
      state: 'Received',
      requested_by: 3,
      operator_id: 3,
      created: base + HOUR,
      expected: base + 3 * HOUR,
      received: base + 2 * HOUR,
      movement_type: 'Transfer',
      ...override,
    };
    const result = repository.run(
      `INSERT INTO movements(trolley,source,destination,product,batch,qty,state,requested_by,operator_id,created,expected,received,key,payload,version,movement_type,department,policy_flags,exception_reason,approved_by,direct_complete,occurred,decided_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      m.trolley,
      m.source,
      m.destination,
      m.product,
      m.batch,
      m.qty,
      m.state,
      m.requested_by,
      m.operator_id,
      m.created,
      m.expected,
      m.received,
      `report-${++sequence}`,
      '{}',
      1,
      m.movement_type,
      'Plant',
      m.policy_flags || '[]',
      m.exception_reason || '',
      m.approved_by || null,
      m.direct_complete || 0,
      m.occurred ?? null,
      m.decided_at ?? null,
    );
    return Number(result.lastInsertRowid);
  };
  movement({ movement_type: 'Production Issue' });
  movement({
    source: 'LINE',
    destination: 'STORE',
    movement_type: 'Production Return',
    created: base + 5 * HOUR,
    received: base + 6 * HOUR,
    expected: base + 7 * HOUR,
  });
  movement({
    trolley: 'TR-002',
    created: base + DAY + HOUR,
    received: base + DAY + 3 * HOUR,
    expected: base + DAY + 2 * HOUR,
  });
  movement({
    trolley: 'TR-003',
    destination: 'OUT',
    product: 'P2',
    batch: 'B-2',
    movement_type: 'Outside Dispatch',
    created: base - 3 * HOUR,
    received: base - 2 * HOUR,
    expected: base + HOUR,
    approved_by: 2,
  });
  movement({
    trolley: 'TR-003',
    source: 'OUT',
    destination: 'STORE',
    product: 'P2',
    batch: 'B-2',
    state: 'Pending',
    created: base + DAY + HOUR,
    expected: base + DAY + 4 * HOUR,
    received: null,
  });
  movement({
    trolley: 'TR-002',
    source: 'LINE',
    destination: 'OUT',
    state: 'Rejected',
    requested_by: 4,
    operator_id: 4,
    created: base + 2 * DAY,
    expected: base + 3 * DAY,
    received: null,
    policy_flags: '["Wrong product"]',
    exception_reason: 'Material must be segregated',
  });
  repository.run(
    "INSERT INTO alerts(trolley,location,type,priority,message,created) VALUES ('TR-002','LINE','Wrong product','High','Gear was scanned in the wrong bay',?)",
    base + DAY,
  );
  return {
    repository,
    service: reportService(repository),
    base,
    now,
    movement,
    close: () => repository.close(),
  };
}

test('history combines all filters, searches labels literally and paginates without omissions', () => {
  const f = fixture();
  try {
    const first = f.service.history(operator, 'movements', new URLSearchParams({ limit: '2' }));
    const second = f.service.history(
      operator,
      'movements',
      new URLSearchParams({ limit: '2', before: first.nextCursor }),
    );
    const third = f.service.history(
      operator,
      'movements',
      new URLSearchParams({ limit: '2', before: second.nextCursor }),
    );
    assert.equal(first.total, 6);
    assert.equal(
      new Set([...first.items, ...second.items, ...third.items].map((row) => row.id)).size,
      6,
    );
    assert.equal(third.nextCursor, null);
    const query = new URLSearchParams({
      trolley: 'TR-001',
      location: 'STORE',
      operator: 'Asha',
      product: 'P1',
      type: 'Production Return',
      status: 'Received',
      search: 'Gear',
      from: String(f.base),
      to: String(f.base + DAY - 1),
    });
    const filtered = f.service.history(supervisor, 'movements', query);
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].movement_type, 'Production Return');
    assert.equal(filtered.items[0].operator_name, 'Asha Operator');
    assert.equal(f.service.history(operator, 'movements', { search: '%' }).total, 0);
    assert.equal(f.service.history(operator, 'movements', { operator: '4' }).total, 1);
    assert.throws(() => f.service.history(operator, 'movements', { from: 'invalid' }), {
      status: 400,
    });
    assert.throws(() => f.service.history(operator, 'movements', { from: '200', to: '100' }), {
      status: 400,
    });
    assert.throws(() => f.service.history(operator, 'movements', { limit: '101' }), {
      status: 400,
    });
    f.repository.run(
      "UPDATE movements SET correction_reason = 'Choose the correct destination' WHERE state = 'Rejected'",
    );
    assert.equal(
      f.service.history(operator, 'movements', { status: 'Correction Requested' }).total,
      1,
    );
    assert.equal(f.service.history(operator, 'movements', { status: 'Rejected' }).total, 0);
    assert.equal(f.service.history(operator, 'movements', { status: 'Completed' }).total, 4);
  } finally {
    f.close();
  }
});

test('eight reports derive inventory, capacity, material, outside approval and exceptions from records', () => {
  const f = fixture();
  try {
    const utilization = f.service.build(manager, 'util', {});
    assert.deepEqual(
      utilization.rows.find((row) => row[0] === 'Component'),
      ['Component', 2, 1, 0, 0, 0, 0, 1, 50],
    );
    const location = f.service.build(admin, 'loc', { location: 'LINE' });
    assert.equal(location.rows[0][4], 1);
    assert.equal(location.rows[0][5], 20);
    assert.equal(location.rows[0][7], 10);
    const product = f.service.build(admin, 'prod', { product: 'P1' });
    assert.deepEqual(product.rows[0].slice(0, 7), ['P1', 'Gear', 'Component', 'B-1', 'pcs', 1, 20]);
    assert.equal(f.service.build(admin, 'over', {}).rows[0][0], 'TR-002');
    assert.equal(f.service.build(admin, 'out', {}).rows[0].at(-1), 'Plant manager');
    const daily = f.service.build(admin, 'daily', { from: day(f.base), to: day(f.base) });
    assert.equal(daily.total, 2);
    assert.equal(daily.rows[0][9], 'Production Issue');
    assert.equal(f.service.build(admin, 'hist', { status: 'Rejected' }).total, 1);
    const exceptions = f.service.build(admin, 'exc', {});
    assert.equal(exceptions.total, 2);
    assert.ok(exceptions.rows.some((row) => row.includes('Gear was scanned in the wrong bay')));
    assert.throws(() => f.service.build(operator, 'history', {}), { status: 403 });
    assert.equal(f.service.historyReport(operator, { limit: '2', before: '3' }).total, 6);
    assert.equal(f.service.historyReport(operator, { limit: '2', before: '3' }).rows.length, 6);
    assert.equal(f.service.historyReport(supervisor, { product: 'P2' }).rows.length, 2);
    assert.throws(() => f.service.build(supervisor, 'daily', {}), { status: 403 });
    assert.throws(() => f.service.build(admin, 'unknown', {}), { status: 404 });
  } finally {
    f.close();
  }
});

function day(value) {
  return new Date(value).toISOString().slice(0, 10);
}

test('analytics distinguishes actual completed round trips from request-to-receipt duration', () => {
  const f = fixture();
  try {
    const query = { from: String(f.base), to: String(f.base + 3 * DAY - 1) };
    const analytics = f.service.analytics(manager, query);
    assert.equal(Object.keys(analytics.charts).length, 7);
    assert.equal(analytics.metrics.completedRoundTrips, 1);
    assert.equal(analytics.metrics.averageRoundTripHours, 5);
    assert.equal(analytics.metrics.meanRequestToReceiptHours, 1.33);
    assert.deepEqual(analytics.charts.turnaround.data, [5]);
    assert.equal(
      analytics.charts.utilization.data.reduce((sum, value) => sum + value, 0),
      3,
    );
    assert.equal(
      analytics.charts.locationDistribution.data.reduce((sum, value) => sum + value, 0),
      3,
    );
    assert.equal(
      analytics.charts.dailyMovements.data.reduce((sum, value) => sum + value, 0),
      5,
    );
    assert.deepEqual(analytics.charts.overdueTrend.data, [0, 1, 1]);
    assert.equal(analytics.charts.topUsage.rows.find((row) => row.trolley === 'TR-001').count, 2);
    const weekly = f.service.analytics(admin, { ...query, period: 'week' });
    assert.equal(weekly.charts.overdueTrend.period, 'week');
    assert.equal(weekly.charts.overdueTrend.data.at(-1), 1);
    assert.throws(() => f.service.analytics(operator, query), { status: 403 });
    const summary = f.service.summary(admin, query);
    assert.deepEqual(
      {
        requested: summary.totals.requested,
        received: summary.totals.received,
        rejected: summary.totals.rejected,
      },
      { requested: 5, received: 3, rejected: 1 },
    );
    assert.equal(summary.totals.mean_receipt_ms, (4 * HOUR) / 3);
  } finally {
    f.close();
  }
});

test('a return without a recorded matching issue never creates fabricated turnaround', () => {
  const f = fixture();
  try {
    const result = f.service.analytics(admin, {
      trolley: 'TR-003',
      from: String(f.base),
      to: String(f.now),
    });
    assert.equal(result.metrics.completedRoundTrips, 0);
    assert.equal(result.metrics.averageRoundTripHours, null);
    assert.deepEqual(result.charts.turnaround.data, []);
  } finally {
    f.close();
  }
});

test('previews paginate while complete XLSX, PDF and CSV exports retain all rows', async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 260; index++)
      f.movement({ created: f.base + index, received: f.base + HOUR + index });
    const preview = f.service.build(admin, 'history', { page: '2', limit: '50' });
    assert.equal(preview.total, 266);
    assert.equal(preview.rows.length, 50);
    assert.equal(preview.nextPage, 3);
    const report = f.service.build(admin, 'history', {});
    assert.equal(report.rows.length, 266);
    const xlsx = await exportService.toBuffer(report, 'xlsx');
    assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');
    assert.match(xlsx.contentType, /spreadsheetml/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.buffer);
    const sheet = workbook.getWorksheet('Report');
    assert.equal(sheet.rowCount, 267);
    assert.equal(sheet.getRow(1).getCell(1).value, 'Movement ID');
    assert.equal(sheet.getRow(267).getCell(3).value, report.rows.at(-1)[2]);
    const csv = await exportService.toBuffer(report, 'csv');
    assert.equal(csv.buffer.toString('utf8').split('\r\n').length, 268);
    const pdf = await exportService.toBuffer(report, 'pdf');
    assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.ok((pdf.buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1);
    assert.ok(pdf.buffer.toString('latin1').endsWith('%%EOF\n'));
    await assert.rejects(exportService.toBuffer(report, 'html'), { status: 400 });
  } finally {
    f.close();
  }
});

test('exports preserve numeric types, quote CSV and keep spreadsheet formulas as literal strings', async () => {
  const report = {
    type: 'checks',
    title: 'Export checks',
    columns: ['Name', 'Quantity', 'Remark'],
    rows: [
      ['Gear, large', -2, '=HYPERLINK("https://example.test")'],
      ['Plate', 3, 'line one\nline two'],
    ],
    timezone: 'UTC',
  };
  const csv = await exportService.toBuffer(report, 'csv');
  assert.ok(
    csv.buffer
      .toString('utf8')
      .includes('"Gear, large",-2,"\'=HYPERLINK(""https://example.test"")"'),
  );
  const xlsx = await exportService.toBuffer(report, 'xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.buffer);
  assert.equal(workbook.worksheets[0].getCell('B2').value, -2);
  assert.equal(workbook.worksheets[0].getCell('C2').value, '=HYPERLINK("https://example.test")');
  assert.equal(workbook.worksheets[0].getCell('C2').type, ExcelJS.ValueType.String);
});

test('backdated direct entries use physical roundtrip times and do not fabricate request-to-receipt waits', () => {
  const f = fixture();
  try {
    f.movement({
      trolley: 'TR-002',
      movement_type: 'Production Issue',
      direct_complete: 1,
      occurred: f.base + 2 * DAY + HOUR,
      created: f.now,
      received: f.now,
      expected: f.now + HOUR,
    });
    f.movement({
      trolley: 'TR-002',
      source: 'LINE',
      destination: 'STORE',
      movement_type: 'Production Return',
      direct_complete: 1,
      occurred: f.base + 2 * DAY + 5 * HOUR,
      created: f.now + 1,
      received: f.now + 1,
      expected: f.now + HOUR,
    });
    const query = { trolley: 'TR-002', from: String(f.base), to: String(f.base + 3 * DAY) };
    const analytics = f.service.analytics(admin, query);
    assert.equal(analytics.metrics.completedRoundTrips, 1);
    assert.equal(analytics.metrics.averageRoundTripHours, 4);
    assert.equal(analytics.metrics.meanRequestToReceiptHours, 2);
    const report = f.service.build(admin, 'history', { ...query, type: 'Production Return' });
    assert.equal(report.rows[0].at(-1), '');
    assert.equal(f.service.summary(admin, query).totals.mean_receipt_ms, 2 * HOUR);
  } finally {
    f.close();
  }
});

test('location arrivals use receipt time even when the request was recorded earlier', () => {
  const f = fixture();
  try {
    f.movement({ created: f.base, received: f.now - HOUR, expected: f.now + HOUR });
    f.movement({
      direct_complete: 1,
      occurred: f.base,
      created: f.now,
      received: f.now,
      expected: f.now + HOUR,
    });
    const analytics = f.service.analytics(admin, {});
    const location = analytics.charts.locationMovements.rows.find((row) => row.id === 'LINE');
    assert.equal(location.arrivals, 1);
    assert.equal(
      analytics.charts.locationMovements.to - analytics.charts.locationMovements.from,
      DAY,
    );
  } finally {
    f.close();
  }
});
