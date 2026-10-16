import { escapeHtml as escape, formatTime, dataTable, pageTitle } from './ui.js';

const palette = ['#17855a', '#0f5fa8', '#0a8499', '#a96a00', '#7a3fc4', '#c22b2b', '#697b8c'];
const numeric = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
const number = (value) => numeric(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const hours = (value) => numeric(value) / 3600000;
const timestamp = (value) => (Number.isFinite(Number(value)) ? formatTime(Number(value)) : '—');
const dateInput = (value) => {
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
};

function reportActions(kind, primary = false) {
  const key = escape(kind);
  return `<div class="actions">
    ${primary ? `<button class="btn primary" data-report-view="${key}">View report</button>` : ''}
    <button class="btn" data-report-export="${key}" data-format="xlsx">Excel</button>
    <button class="btn" data-report-export="${key}" data-format="pdf">PDF</button>
  </div>`;
}

export function reportCatalogueView(state) {
  const reports = state.reportCatalogue?.reports || [];
  const selected = state.selectedReport;
  const catalogue = reports.length
    ? `<div class="report-grid">${reports
        .map(
          (report) => `<article class="card report-card">
          <span class="eyebrow">OPERATIONS REPORT</span>
          <h3>${escape(report.title)}</h3><p class="hint">${escape(report.description)}</p>
          ${reportActions(report.id, true)}
        </article>`,
        )
        .join('')}</div>`
    : '<section class="card empty">No reports are available yet. Refresh to try again.</section>';
  const preview = selected
    ? `<section class="card report-preview mt" aria-labelledby="report-preview-title">
      <div class="card-heading"><div><span class="eyebrow">REPORT PREVIEW</span>
        <h2 id="report-preview-title">${escape(selected.title)}</h2>
        <p class="hint">${number(selected.rows?.length)} rows · Generated ${escape(timestamp(selected.generatedAt))} · ${escape(selected.timezone || 'UTC')}</p>
      </div>${reportActions(selected.kind)}</div>
      ${dataTable(
        (selected.columns || []).map((column) => escape(column)),
        (selected.rows || []).map(
          (row) => `<tr>${row.map((value) => `<td>${escape(value)}</td>`).join('')}</tr>`,
        ),
      )}
    </section>`
    : '';
  return `${pageTitle('Reports & analytics', 'Review live operational records and download complete Excel or PDF reports.')}
    <div class="actions section-actions"><button class="btn" data-page="analytics">Open analytics</button></div>
    ${catalogue}${preview}`;
}

function chartSvg(id, title, description, content, height = 260) {
  return `<svg class="chart-svg" viewBox="0 0 640 ${height}" role="img" aria-labelledby="${id}-title ${id}-desc">
    <title id="${id}-title">${escape(title)}</title>
    <desc id="${id}-desc">${escape(description)}</desc>${content}
  </svg>`;
}

function chartTable(headers, rows) {
  return `<details class="chart-data"><summary>View chart data</summary>${dataTable(
    headers.map((header) => escape(header)),
    rows.map((row) => `<tr>${row.map((value) => `<td>${escape(value)}</td>`).join('')}</tr>`),
  )}</details>`;
}

function chartCard(title, subtitle, chart, table, actions = '') {
  return `<section class="card chart-card"><div class="card-heading"><div><h3>${escape(title)}</h3><p class="hint">${escape(subtitle)}</p></div>${actions}</div>${chart}${table}</section>`;
}

function shortLabel(label, limit = 23) {
  const value = String(label ?? '');
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

function barChart(id, title, rows, unit = 'trolleys') {
  const maximum = Math.max(1, ...rows.map((row) => numeric(row.value)));
  const rowHeight = 34;
  const height = Math.max(160, rows.length * rowHeight + 24);
  const bars = rows.length
    ? rows
        .map((row, index) => {
          const value = numeric(row.value);
          const width = (value / maximum) * 335;
          const y = 12 + index * rowHeight;
          return `<g><title>${escape(row.label)}: ${number(value)} ${escape(unit)}</title>
            <text x="0" y="${y + 17}" fill="currentColor" font-size="12">${escape(shortLabel(row.label))}</text>
            <rect x="185" y="${y}" width="335" height="23" rx="5" fill="currentColor" opacity="0.06"/>
            <rect x="185" y="${y}" width="${width.toFixed(2)}" height="23" rx="5" fill="${palette[index % palette.length]}"/>
            <text x="535" y="${y + 17}" fill="currentColor" font-size="12">${number(value)}</text>
          </g>`;
        })
        .join('')
    : '<text x="320" y="80" fill="currentColor" text-anchor="middle" font-size="14">No recorded data for this period</text>';
  return chartSvg(
    id,
    title,
    rows.length
      ? rows.map((row) => `${row.label}: ${number(row.value)} ${unit}`).join('; ')
      : 'No recorded data for this period.',
    bars,
    height,
  );
}

function lineChart(id, title, rows, unit, color = palette[1]) {
  const maximum = Math.max(1, ...rows.map((row) => numeric(row.value)));
  const x = (index) => 48 + (rows.length > 1 ? (index / (rows.length - 1)) * 560 : 280);
  const y = (value) => 210 - (numeric(value) / maximum) * 165;
  const points = rows.map((row, index) => `${x(index).toFixed(2)},${y(row.value).toFixed(2)}`);
  const lines = [0, 0.5, 1]
    .map((ratio) => {
      const level = 210 - ratio * 165;
      return `<line x1="48" y1="${level}" x2="608" y2="${level}" stroke="currentColor" opacity="0.12"/>
        <text x="38" y="${level + 4}" fill="currentColor" text-anchor="end" font-size="11">${number(maximum * ratio)}</text>`;
    })
    .join('');
  const plot = rows.length
    ? `${rows.length > 1 ? `<polygon points="${x(0)},210 ${points.join(' ')} ${x(rows.length - 1)},210" fill="${color}" opacity="0.09"/><polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>` : ''}
      ${rows
        .map(
          (row, index) =>
            `<circle cx="${x(index).toFixed(2)}" cy="${y(row.value).toFixed(2)}" r="4" fill="${color}"><title>${escape(row.label)}: ${number(row.value)} ${escape(unit)}</title></circle>`,
        )
        .join('')}
      <text x="48" y="240" fill="currentColor" font-size="11">${escape(rows[0].label)}</text>
      ${rows.length > 1 ? `<text x="608" y="240" fill="currentColor" text-anchor="end" font-size="11">${escape(rows.at(-1).label)}</text>` : ''}`
    : '<text x="320" y="125" fill="currentColor" text-anchor="middle" font-size="14">No recorded data for this period</text>';
  return chartSvg(
    id,
    title,
    rows.length
      ? rows.map((row) => `${row.label}: ${number(row.value)} ${unit}`).join('; ')
      : 'No recorded data for this period.',
    lines + plot,
  );
}

function fleetChart(rows) {
  const total = rows.reduce((sum, row) => sum + numeric(row.count), 0);
  let offset = 0;
  const segments = rows
    .filter((row) => numeric(row.count) > 0)
    .map((row, index) => {
      const length = total ? (numeric(row.count) / total) * 100 : 0;
      const segment = `<circle cx="135" cy="125" r="82" pathLength="100" fill="none" stroke="${palette[index % palette.length]}" stroke-width="27" stroke-dasharray="${length.toFixed(4)} ${(100 - length).toFixed(4)}" stroke-dashoffset="${(-offset).toFixed(4)}" transform="rotate(-90 135 125)"><title>${escape(row.status)}: ${number(row.count)}</title></circle>`;
      offset += length;
      return segment;
    })
    .join('');
  const legend = rows
    .filter((row) => numeric(row.count) > 0)
    .map(
      (
        row,
        index,
      ) => `<g><circle cx="280" cy="${44 + index * 27}" r="5" fill="${palette[index % palette.length]}"/>
        <text x="295" y="${48 + index * 27}" fill="currentColor" font-size="13">${escape(row.status)} · ${number(row.count)}</text></g>`,
    )
    .join('');
  return chartSvg(
    'fleet-utilization',
    'Trolley utilization',
    total
      ? rows.map((row) => `${row.status}: ${number(row.count)}`).join('; ')
      : 'No registered active trolleys.',
    `<circle cx="135" cy="125" r="82" fill="none" stroke="currentColor" opacity="0.08" stroke-width="27"/>${segments}
      <text x="135" y="125" fill="currentColor" text-anchor="middle" font-size="34" font-weight="600">${number(total)}</text>
      <text x="135" y="147" fill="currentColor" text-anchor="middle" font-size="12">active trolleys</text>
      ${legend || '<text x="280" y="125" fill="currentColor" font-size="13">No registered active trolleys</text>'}`,
    Math.max(260, rows.filter((row) => numeric(row.count) > 0).length * 27 + 50),
  );
}

export function analyticsView(state) {
  const analytics = state.analytics || {};
  const fleet = analytics.fleet || [];
  const arrivals = (analytics.arrivals || []).map((row) => ({
    label: row.name || row.location,
    value: row.count,
  }));
  const daily = (analytics.daily || []).map((row) => ({ label: row.day, value: row.count }));
  const top = (analytics.topTrolleys || []).map((row) => ({
    label: row.trolley,
    value: row.count,
  }));
  const turnaround = (analytics.turnaround?.daily || [])
    .filter((row) => row.meanMs != null && Number.isFinite(Number(row.meanMs)))
    .map((row) => ({
      label: row.day,
      value: hours(row.meanMs),
    }));
  const weekly = state.analyticsPeriod === 'week';
  const overdue = (analytics.overdue?.[weekly ? 'weekly' : 'daily'] || []).map((row) => ({
    label: weekly ? row.week : row.day,
    value: row.count,
  }));
  const distribution = (analytics.distribution || []).map((row) => ({
    label: row.name || row.location,
    value: row.count,
  }));
  const table = (headers, rows) =>
    chartTable(
      headers,
      rows.map((row) => [row.label, number(row.value)]),
    );
  const periodControls = `<div class="actions" role="group" aria-label="Overdue trend period">
    <button class="btn ${!weekly ? 'primary' : ''}" data-analytics-period="day" aria-pressed="${!weekly}">Daily</button>
    <button class="btn ${weekly ? 'primary' : ''}" data-analytics-period="week" aria-pressed="${weekly}">Weekly</button>
  </div>`;
  return `${pageTitle('Analytics', 'Understand fleet use, movement activity and return performance from recorded plant events.')}
    <form id="analytics-filter" class="filter-bar">
      <label>From date<input name="from" type="date" value="${dateInput(analytics.from)}" required></label>
      <label>To date<input name="to" type="date" value="${dateInput(analytics.to)}" required></label>
      <div class="error" role="alert"></div><button class="btn" type="submit">Apply period</button>
    </form>
    <p class="hint">Time buckets use ${escape(analytics.timezone || 'UTC')}. Fleet and distribution show the current plant. Arrivals cover the last 24 hours; other trends use the selected period.</p>
    <div class="chart-grid">
      ${chartCard(
        'Trolley utilization',
        'Live active fleet split',
        fleetChart(fleet),
        chartTable(
          ['Status', 'Trolleys'],
          fleet.map((row) => [row.status, number(row.count)]),
        ),
      )}
      ${chartCard('Movement by location', 'Recorded arrivals in the last 24 hours', barChart('location-arrivals', 'Movement by location', arrivals, 'arrivals'), table(['Location', 'Arrivals'], arrivals))}
      ${chartCard('Daily movement trend', 'Requested trolley movements per day', lineChart('daily-movement', 'Daily movement trend', daily, 'movements'), table(['Day', 'Movements'], daily))}
      ${chartCard('Top trolley usage', 'Most frequently moved trolleys', barChart('top-trolley-usage', 'Top trolley usage', top, 'movements'), table(['Trolley', 'Movements'], top))}
      ${chartCard('Average turnaround time', `${number(analytics.turnaround?.completedCycles)} completed cycles · Mean ${analytics.turnaround?.meanMs == null ? '—' : number(hours(analytics.turnaround.meanMs)) + ' hours'}`, lineChart('turnaround-time', 'Average turnaround time in hours', turnaround, 'hours', palette[3]), table(['Day', 'Mean hours'], turnaround))}
      ${chartCard('Overdue trolley trend', `${weekly ? 'Weekly' : 'Daily'} count of overdue movements`, lineChart('overdue-trend', 'Overdue trolley trend', overdue, 'overdue movements', palette[5]), table([weekly ? 'Week' : 'Day', 'Overdue movements'], overdue), periodControls)}
      ${chartCard('Location-wise trolley distribution', 'Trolleys physically present right now', barChart('location-distribution', 'Location-wise trolley distribution', distribution), table(['Location', 'Trolleys'], distribution))}
    </div>`;
}

const roles = [
  [
    'Admin',
    'All modules, master data, users, readers, approvals and plant settings.',
    'All modules',
  ],
  [
    'Plant Manager',
    'Monitor operations, review reports and decide independent approvals.',
    'Overview, tracking, locations, products, alerts, approvals, reports and analytics',
  ],
  [
    'Supervisor',
    'Manage trolley records, record movements, verify loads and decide approvals.',
    'Operational modules, approvals, plant rules and audit',
  ],
  [
    'Operator',
    'Identify trolleys, record departures, confirm receipt and report issues.',
    'Overview, scan, live tracking, movements, history and alerts',
  ],
  [
    'Quality User',
    'Verify product segregation and manage quality inspection and release.',
    'Overview, scan, live tracking, movements, products, history and alerts',
  ],
  [
    'Store User',
    'Issue and receive materials and review product assignments.',
    'Overview, trolley master, scan, live tracking, movements, products, history and alerts',
  ],
];

function auditValues(event) {
  let detail = {};
  try {
    detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail || {};
  } catch {
    detail = { current: event.detail };
  }
  const display = (value) =>
    value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return [
    event.prev ?? detail.previous ?? detail.before,
    event.next ?? detail.current ?? detail.after ?? event.detail,
  ].map(display);
}

export function settingsView(state) {
  const settings = state.operationSettings || state.settings || {};
  const theme = ['auto', 'light', 'dark'].includes(state.theme) ? state.theme : 'auto';
  const canConfigure = state.user?.role === 'Admin';
  const canAudit = ['Admin', 'Supervisor', 'Plant Manager'].includes(state.user?.role);
  const audit = state.auditPage?.items || state.audit || [];
  const query = state.auditFilter?.q || '';
  return `${pageTitle('Settings', 'Configure approval rules, appearance and review the plant audit trail.')}
    <div class="settings-grid">
      <section class="card"><h3>Approval rules</h3>
        <form id="operation-settings">
          <label class="toggle-row"><input name="outside_approval" type="checkbox" ${settings.outside_approval !== false && settings.outside_approval !== 0 ? 'checked' : ''} ${canConfigure ? '' : 'disabled'}>
            <span>Outside plant movements need approval<span class="hint">An independent authorized user reviews departures beyond the plant gate.</span></span>
          </label>
          <label class="toggle-row"><input name="mismatch_approval" type="checkbox" ${settings.mismatch_approval !== false && settings.mismatch_approval !== 0 ? 'checked' : ''} ${canConfigure ? '' : 'disabled'}>
            <span>Mismatches need supervisor approval<span class="hint">Product, batch, trolley and location exceptions wait for review.</span></span>
          </label>
          <div class="error" role="alert"></div>
          ${canConfigure ? '<button class="btn primary" type="submit">Save approval rules</button>' : '<p class="hint">An administrator can change approval rules.</p>'}
        </form>
        <h3 class="mt">Appearance</h3><div class="actions" role="group" aria-label="Color theme">
          ${['auto', 'light', 'dark'].map((value) => `<button class="btn ${theme === value ? 'primary' : ''}" data-theme="${value}" aria-pressed="${theme === value}">${value === 'auto' ? 'Auto' : value === 'light' ? 'Light' : 'Dark'}</button>`).join('')}
        </div>
        <p class="hint">Auto follows your device appearance. Your theme preference stays in this browser.</p>
        <h3 class="mt">Display preferences</h3>
        <p class="hint">Reset your display filters and theme to their defaults. Plant records and shared configuration remain unchanged.</p>
        <button class="btn" data-reset-display>Reset display preferences</button>
      </section>
      <section class="card"><h3>Roles and access</h3>${dataTable(
        ['Role', 'Permissions', 'Modules'],
        roles.map(
          ([role, permissions, pages]) =>
            `<tr><td><b>${escape(role)}</b></td><td>${escape(permissions)}</td><td>${escape(pages)}</td></tr>`,
        ),
      )}</section>
    </div>
    ${
      canAudit
        ? `<section class="card mt"><div class="card-heading"><h3>Audit trail</h3><span class="hint">Who changed what, and when</span></div>
        <form id="audit-filter" class="filter-bar"><label>Search audit<input name="q" type="search" value="${escape(query)}" placeholder="Trolley, user or action"></label><div class="error" role="alert"></div><button class="btn" type="submit">Search audit</button></form>
        ${dataTable(
          ['Date and time', 'User', 'Action', 'Trolley / entity', 'Previous value', 'New value'],
          audit.map((event) => {
            const [previous, next] = auditValues(event);
            return `<tr><td>${escape(timestamp(event.ts))}</td><td>${escape(event.actor_name || event.user || 'System')}<div class="hint">${escape(event.role || '')}</div></td><td>${escape(event.action)}</td><td>${escape(event.entity || event.trolley || '—')}</td><td>${escape(previous)}</td><td>${escape(next)}</td></tr>`;
          }),
        )}
        ${state.auditPage?.nextCursor ? '<button class="btn mt" data-more="audit">Load older audit events</button>' : ''}
      </section>`
        : ''
    }`;
}
