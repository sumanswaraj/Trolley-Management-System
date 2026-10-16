import test from 'node:test';
import assert from 'node:assert/strict';
import { reportCatalogueView, analyticsView, settingsView } from '../public/report-views.js';

test('report catalogue previews and exports the same report without interpreting row markup', () => {
  const reports = ['daily', 'util', 'loc', 'prod', 'over', 'hist', 'out', 'exc'].map((id) => ({
    id,
    title: `${id} report`,
    description: 'Recorded operations',
  }));
  const html = reportCatalogueView({
    reportCatalogue: { reports },
    selectedReport: {
      kind: 'daily',
      title: 'Daily movements',
      columns: ['Trolley', '<img src=x onerror=alert(1)>'],
      rows: [['TR-001', '<script>alert(1)</script>']],
      generatedAt: 1700000000000,
      timezone: 'UTC',
    },
  });
  assert.equal((html.match(/data-report-view=/g) || []).length, 8);
  assert.equal((html.match(/data-format="xlsx"/g) || []).length, 9);
  assert.equal((html.match(/data-format="pdf"/g) || []).length, 9);
  assert.match(html, /report-preview-title">Daily movements/);
  assert.match(html, /TR-001/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
});

test('analytics draws all seven charts from recorded data with accessible table alternatives', () => {
  const html = analyticsView({
    analytics: {
      from: 1700000000000,
      to: 1700086400000,
      timezone: 'UTC',
      fleet: [
        { status: 'Available', count: 12 },
        { status: 'In Use', count: 8 },
      ],
      arrivals: [{ location: 'STORE', name: 'Main Store', count: 7 }],
      daily: [
        { day: '2023-11-14', count: 3 },
        { day: '2023-11-15', count: 6 },
      ],
      topTrolleys: [{ trolley: 'TR-042', count: 9 }],
      turnaround: {
        meanMs: 7200000,
        completedCycles: 4,
        daily: [{ day: '2023-11-14', meanMs: 7200000, count: 4 }],
      },
      overdue: {
        daily: [{ day: '2023-11-14', count: 2 }],
        weekly: [{ week: '2023-W46', count: 5 }],
      },
      distribution: [{ location: 'STORE', name: 'Main Store', count: 11 }],
    },
  });
  assert.equal((html.match(/role="img"/g) || []).length, 7);
  assert.equal((html.match(/View chart data/g) || []).length, 7);
  assert.match(html, /TR-042: 9 movements/);
  assert.match(html, /Main Store: 7 arrivals/);
  assert.match(html, /Mean 2 hours/);
  assert.match(html, /2023-11-14: 2 overdue movements/);
  assert.match(html, /data-analytics-period="day" aria-pressed="true"/);
  assert.match(html, /data-analytics-period="week" aria-pressed="false"/);
  assert.ok(!/NaN|Infinity/.test(html));
});

test('weekly analytics chooses weekly overdue records and empty charts avoid fabricated data', () => {
  const weekly = analyticsView({
    analyticsPeriod: 'week',
    analytics: {
      overdue: {
        daily: [{ day: 'DAILY-BUCKET', count: 2 }],
        weekly: [{ week: 'WEEKLY-BUCKET', count: 8 }],
      },
    },
  });
  assert.match(weekly, /WEEKLY-BUCKET: 8 overdue movements/);
  assert.ok(!weekly.includes('DAILY-BUCKET'));
  assert.match(weekly, /data-analytics-period="week" aria-pressed="true"/);
  const empty = analyticsView({});
  assert.equal((empty.match(/role="img"/g) || []).length, 7);
  assert.match(empty, /No recorded data for this period/);
  assert.match(empty, /No registered active trolleys/);
  assert.ok(!/NaN|Infinity|undefined/.test(empty));
  assert.ok(!empty.includes('<circle cx="48.00"'));
});

test('analytics escapes labels inside SVG text and descriptive elements', () => {
  const html = analyticsView({
    analytics: {
      topTrolleys: [{ trolley: '</title><script>alert(1)</script>', count: 3 }],
      distribution: [{ name: '<img src=x onerror=alert(1)>', count: 5 }],
    },
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;/);
});

test('turnaround charts omit days without completed cycles and label the arrival window', () => {
  const html = analyticsView({
    analytics: {
      turnaround: {
        meanMs: 7200000,
        completedCycles: 4,
        daily: [
          { day: 'NO-COMPLETED-CYCLES', meanMs: null, count: 0 },
          { day: 'MEASURED-CYCLES', meanMs: 7200000, count: 4 },
        ],
      },
    },
  });
  assert.ok(!html.includes('NO-COMPLETED-CYCLES'));
  assert.match(html, /MEASURED-CYCLES: 2 hours/);
  assert.match(html, /Recorded arrivals in the last 24 hours/);
});

test('settings reflects persisted rules, restricts configuration and keeps audit details escaped', () => {
  const state = {
    user: { role: 'Admin' },
    operationSettings: { outside_approval: 0, mismatch_approval: 1 },
    theme: 'dark',
    auditFilter: { q: '"><script>alert(1)</script>' },
    auditPage: {
      items: [
        {
          ts: 1700000000000,
          actor_name: '<b>Alex</b>',
          action: 'Trolley updated',
          entity: 'TR-001',
          detail: JSON.stringify({ previous: { department: 'Stores' }, current: '<img src=x>' }),
        },
      ],
      nextCursor: 4,
    },
  };
  const html = settingsView(state);
  assert.match(html, /name="outside_approval" type="checkbox"\s+>/);
  assert.match(html, /name="mismatch_approval" type="checkbox" checked/);
  assert.match(html, /data-theme="dark" aria-pressed="true"/);
  assert.match(html, /Plant Manager/);
  assert.match(html, /data-reset-display/);
  assert.match(html, /data-more="audit"/);
  assert.match(html, /&lt;b&gt;Alex&lt;\/b&gt;/);
  assert.match(html, /&quot;department&quot;:&quot;Stores&quot;/);
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('Reset demo data'));

  const operator = settingsView({ ...state, user: { role: 'Operator' } });
  assert.ok(!operator.includes('id="audit-filter"'));
  assert.ok(!operator.includes('Save approval rules'));
  assert.match(operator, /name="outside_approval" type="checkbox"\s+disabled/);
});
