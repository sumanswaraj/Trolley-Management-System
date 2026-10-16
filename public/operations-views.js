import { escapeHtml as escape, formatTime, form, dataTable, pageTitle } from './ui.js';

const priorities = ['Critical', 'High', 'Medium', 'Low'];
const alertTypes = [
  'Trolley overdue',
  'Trolley missing',
  'Wrong location',
  'Wrong product',
  'Outside plant',
  'Movement not completed',
  'Trolley maintenance due',
  'Unauthorized movement',
];
const segregationFlags = [
  'Wrong trolley',
  'Wrong product',
  'Wrong location',
  'Mixed batch',
  'Unassigned trolley',
];
const list = (value) => (Array.isArray(value) ? value : []);
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const count = (value) => number(value).toLocaleString();
const now = (state) => number(state.now) || Date.now();
const activeTrolleys = (state) =>
  list(state.trolleys).filter((trolley) => trolley.active !== 0 && trolley.active !== false);
const location = (state, id) => list(state.locations).find((record) => record.id === id);
const locationName = (state, id) => location(state, id)?.name || id || 'Unassigned';
const product = (state, id) => list(state.products).find((record) => record.id === id);
const productName = (state, id) => product(state, id)?.name || id || 'Empty';
const stamp = (value) => (number(value) > 0 ? escape(formatTime(number(value))) : '—');
const option = (value, text, selected = '') =>
  `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(text)}</option>`;
const empty = (title, detail) =>
  `<div class="empty"><strong>${escape(title)}</strong><p>${escape(detail)}</p></div>`;
const badge = (value, warning = false) =>
  `<span class="badge${warning ? ' late' : ''}">${escape(value)}</span>`;
const trolleyLink = (id) =>
  `<button class="text-button" data-trolley-detail="${escape(id)}">${escape(id)}</button>`;
const manager = (state) => ['Admin', 'Supervisor', 'Plant Manager'].includes(state.user?.role);
const canMove = (state) => state.user?.role !== 'Plant Manager';
const canEdit = (state) => ['Admin', 'Supervisor'].includes(state.user?.role);
const canVerify = (state) => ['Admin', 'Supervisor', 'Quality User'].includes(state.user?.role);
const canManageAlerts = (state) => manager(state) || state.user?.role === 'Quality User';

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function trolleyMovements(state, id) {
  const history = state.trolleyHistory;
  const extra = Array.isArray(history) ? history : list(history?.items);
  const records = [...list(state.movements), ...list(state.activeMovements), ...extra];
  return [
    ...new Map(
      records.filter((record) => record.trolley === id).map((record) => [record.id, record]),
    ).values(),
  ].sort((a, b) => number(b.created) - number(a.created) || number(b.id) - number(a.id));
}

function assignment(state, trolley) {
  const movements = trolleyMovements(state, trolley.id);
  const movement = movements.find((record) => !['Pending', 'Rejected'].includes(record.state));
  const open = movements.find((record) => ['Pending', 'In Transit'].includes(record.state));
  const received = movements.find((record) => record.state === 'Received');
  const holding = ['In Use', 'Waiting', 'Maintenance', 'Outside Plant'].includes(trolley.status);
  const heldDeadline =
    holding && received?.received
      ? number(received.received) +
        number(location(state, trolley.location)?.expected_minutes) * 60000
      : 0;
  return {
    expected: number(trolley.expected || trolley.expected_return || open?.expected || heldDeadline),
    since: number(
      trolley.since ||
        trolley.location_since ||
        movement?.received ||
        trolley.created ||
        trolley.updated,
    ),
    lastMove: number(
      trolley.last_moved ||
        trolley.last_move ||
        trolley.lastMove ||
        movement?.received ||
        movement?.created ||
        trolley.updated ||
        trolley.created,
    ),
    operator:
      trolley.operator_name ||
      trolley.operator ||
      trolley.assigned_person ||
      movement?.operator_name ||
      movement?.requester ||
      'Unassigned',
    department:
      trolley.department ||
      location(state, trolley.location)?.department ||
      location(state, trolley.location)?.group_name ||
      'Unassigned',
    movement,
    open,
  };
}

export function duration(milliseconds) {
  const minutes = Math.floor(Math.max(0, number(milliseconds)) / 60000);
  if (minutes < 1) return 'Less than a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}${hours % 24 ? ` ${hours % 24} hr` : ''}`;
}

export function effectiveStatus(state, trolley) {
  if (trolley.active === 0 || trolley.active === false) return 'Inactive';
  const due = assignment(state, trolley).expected;
  if (due > 0 && due < now(state)) return 'Overdue';
  return trolley.status || 'Available';
}

export function trolleyFlags(state, trolley) {
  const explicit = parseList(trolley.flags);
  const incidents = list(state.alerts)
    .filter(
      (alert) =>
        alert.trolley === trolley.id &&
        alert.status !== 'Resolved' &&
        segregationFlags.includes(alert.type),
    )
    .map((alert) => alert.type);
  const latest = list(state.verifications)
    .filter((record) => record.trolley === trolley.id)
    .sort((a, b) => number(b.id) - number(a.id))[0];
  const approval =
    latest && list(state.approvals).find((record) => record.verification === latest.id);
  const verificationFlags =
    latest?.status === 'Mismatch' &&
    (!latest.trolley_version || latest.trolley_version === trolley.version) &&
    (!approval || approval.status === 'Pending')
      ? parseList(latest.flags)
      : [];
  const record = product(state, trolley.product);
  const configured = [];
  if (
    record &&
    list(record.allowed_locations).length &&
    !record.allowed_locations.includes(trolley.location)
  )
    configured.push('Wrong location');
  if (
    !trolley.product &&
    ['Production', 'Assembly'].includes(location(state, trolley.location)?.group_name) &&
    trolley.status === 'In Use'
  )
    configured.push('Unassigned trolley');
  return [
    ...new Set(
      [...explicit, ...incidents, ...verificationFlags, ...configured]
        .map((flag) => (typeof flag === 'string' ? flag : flag.code || flag.kind || flag.type))
        .filter(Boolean),
    ),
  ];
}

function flagChips(state, trolley) {
  return trolleyFlags(state, trolley)
    .map((flag) => badge(flag, true))
    .join(' ');
}

function materialTotals(state, trolleys) {
  const totals = new Map();
  for (const trolley of trolleys) {
    if (!trolley.product || !number(trolley.qty)) continue;
    const unit = product(state, trolley.product)?.unit || trolley.unit || 'pcs';
    totals.set(unit, (totals.get(unit) || 0) + number(trolley.qty));
  }
  return (
    [...totals].map(([unit, total]) => `${count(total)} ${escape(unit)}`).join(' · ') ||
    'No material'
  );
}

function metrics(items) {
  return `<div class="cards">${items.map(([label, value, detail]) => `<div class="card metric"><span>${escape(label)}</span><strong>${escape(value)}</strong>${detail ? `<small class="hint">${escape(detail)}</small>` : ''}</div>`).join('')}</div>`;
}

export function overdueView(state) {
  const current = now(state);
  const overdue = activeTrolleys(state)
    .filter((trolley) => effectiveStatus(state, trolley) === 'Overdue')
    .sort((a, b) => assignment(state, a).expected - assignment(state, b).expected);
  const soon = activeTrolleys(state)
    .filter((trolley) => {
      const due = assignment(state, trolley).expected;
      return due >= current && due <= current + 30 * 60000;
    })
    .sort((a, b) => assignment(state, a).expected - assignment(state, b).expected);
  const escalated = overdue.filter(
    (trolley) => current - assignment(state, trolley).expected > 2 * 3600000,
  );
  return `${pageTitle('Overdue trolleys', 'Follow up on late returns before they hold up the next operation.')}
    ${metrics([
      ['Overdue now', overdue.length],
      ['Escalated', escalated.length, 'More than two hours late'],
      ['Due within 30 minutes', soon.length],
      [
        'Longest delay',
        overdue.length ? duration(current - assignment(state, overdue[0]).expected) : '—',
      ],
    ])}
    <div class="callout${overdue.length ? ' warning' : ' success'}" role="status">${overdue.length ? `${count(overdue.length)} trolley${overdue.length === 1 ? ' is' : 's are'} overdue. Longest delay: ${trolleyLink(overdue[0].id)} at ${escape(locationName(state, overdue[0].location))}.` : 'Every trolley is inside its expected return window.'}</div>
    <section class="card"><h3>Overdue now</h3>
      ${
        overdue.length
          ? dataTable(
              [
                'Trolley',
                'Current location',
                'Expected return',
                'At location for',
                'Department / assigned person',
                'Delay / escalation',
                'Actions',
              ],
              overdue.map((trolley) => {
                const details = assignment(state, trolley);
                const delay = current - details.expected;
                const priority =
                  delay > 2 * 3600000
                    ? 'Critical · Escalated'
                    : delay > 3600000
                      ? 'High'
                      : 'Medium';
                return `<tr class="overdue-row"><td>${trolleyLink(trolley.id)}</td><td>${escape(locationName(state, trolley.location))}<div class="hint">${escape(trolley.location)}</div></td><td>${stamp(details.expected)}</td><td>${details.since ? duration(current - details.since) : '—'}</td><td>${escape(details.department)}<div class="hint">${escape(details.operator)}</div></td><td><strong>${duration(delay)} late</strong><div>${badge(priority, true)}</div></td><td><div class="actions"><button class="btn" data-remind="${escape(trolley.id)}">Send reminder</button>${canMove(state) ? `<button class="btn primary" data-return="${escape(trolley.id)}">Mark returned</button>` : ''}</div></td></tr>`;
              }),
            )
          : empty(
              'Nothing overdue',
              'Trolleys that pass their expected return time will appear here.',
            )
      }
    </section>
    <section class="card mt"><h3>Due back in the next 30 minutes</h3>
      ${
        soon.length
          ? dataTable(
              ['Trolley', 'Location', 'Expected return', 'Time left', 'Assigned person'],
              soon.map((trolley) => {
                const details = assignment(state, trolley);
                return `<tr><td>${trolleyLink(trolley.id)}</td><td>${escape(locationName(state, trolley.location))}</td><td>${stamp(details.expected)}</td><td>${duration(details.expected - current)}</td><td>${escape(details.operator)}</td></tr>`;
              }),
            )
          : empty('No trolleys at risk', 'Nothing is due back in the next half hour.')
      }
    </section>`;
}

function locationCard(state, record, selected) {
  const trolleys = activeTrolleys(state).filter((trolley) => trolley.location === record.id);
  const capacity = number(record.bay_capacity);
  const occupancy = capacity > 0 ? Math.round((trolleys.length / capacity) * 100) : null;
  const statuses = [...new Set(trolleys.map((trolley) => effectiveStatus(state, trolley)))];
  return `<button class="location-card${record.id === selected ? ' selected' : ''}${occupancy >= 85 ? ' crowded' : ''}" data-filter-location="${escape(record.id)}" aria-pressed="${record.id === selected}">
    <span class="hint">${escape(record.id)} · ${escape(record.group_name || (record.external ? 'Outside plant' : 'Plant'))}</span>
    <strong>${escape(record.name)}</strong><span class="location-count">${count(trolleys.length)} <small>trolleys</small></span>
    <span>${materialTotals(state, trolleys)}</span>
    ${capacity > 0 ? `<meter min="0" max="${capacity}" value="${Math.min(trolleys.length, capacity)}" aria-label="${escape(record.name)} occupancy">${occupancy}%</meter><span class="hint">${occupancy}% of ${count(capacity)} trolley bays${occupancy > 100 ? ' · Over capacity' : ''}</span>` : '<span class="hint">Bay capacity not configured</span>'}
    <span class="location-statuses">${statuses.map((status) => badge(status, status === 'Overdue')).join(' ')}</span>
  </button>`;
}

export function locationsView(state) {
  const locations = list(state.locations);
  const selectedId = state.locationFilter || state.selectedLocation || locations[0]?.id;
  const selected = locations.find((record) => record.id === selectedId) || locations[0];
  const trolleys = selected
    ? activeTrolleys(state).filter((trolley) => trolley.location === selected.id)
    : [];
  const groups = [
    ...new Set(
      locations.filter((record) => !record.external).map((record) => record.group_name || 'Plant'),
    ),
  ];
  return `${pageTitle('Plant location tracking', 'Select a location to see its occupancy, material and current trolleys.')}
    ${
      locations.length
        ? `${groups
            .map(
              (group) =>
                `<section class="location-group"><h3>${escape(group)}</h3><div class="location-grid">${locations
                  .filter((record) => !record.external && (record.group_name || 'Plant') === group)
                  .map((record) => locationCard(state, record, selected?.id))
                  .join('')}</div></section>`,
            )
            .join('')}
      ${
        locations.some((record) => record.external)
          ? `<section class="location-group"><h3>Beyond the plant gate</h3><div class="location-grid">${locations
              .filter((record) => record.external)
              .map((record) => locationCard(state, record, selected?.id))
              .join('')}</div></section>`
          : ''
      }
      <section class="card mt" id="location-detail"><div class="card-heading"><div><h3>${escape(selected.name)}</h3><p class="hint">${escape(selected.id)} · ${escape(selected.department || selected.group_name || 'Plant')} · ${count(trolleys.length)} trolleys · ${materialTotals(state, trolleys)}</p></div></div>
      ${
        trolleys.length
          ? dataTable(
              [
                'Trolley',
                'Type',
                'Product / batch',
                'Quantity',
                'Status',
                'Here for',
                'Last operator',
              ],
              trolleys.map((trolley) => {
                const details = assignment(state, trolley);
                const status = effectiveStatus(state, trolley);
                return `<tr><td>${trolleyLink(trolley.id)}</td><td>${escape(trolley.type)}</td><td>${escape(productName(state, trolley.product))}<div class="hint">${escape(trolley.batch)}</div></td><td>${count(trolley.qty)} ${escape(product(state, trolley.product)?.unit || trolley.unit || 'pcs')}</td><td>${badge(status, status === 'Overdue')}</td><td>${details.since ? duration(now(state) - details.since) : '—'}</td><td>${escape(details.operator)}</td></tr>`;
              }),
            )
          : empty('No trolleys here', 'This location is empty at the moment.')
      }</section>`
        : `<section class="card">${empty('No plant locations yet', 'Add locations in Plant setup to begin tracking occupancy.')}</section>`
    }`;
}

function verificationResult(state) {
  const verification = state.lastVerification;
  if (!verification) return '<div id="verification-result" aria-live="polite"></div>';
  const issues = parseList(verification.flags || verification.issues);
  const matched =
    verification.ok === true ||
    ['Matched', 'Verified', 'Match', 'Passed'].includes(verification.result || verification.status);
  return `<div id="verification-result" class="callout ${matched ? 'success' : 'warning'}" role="status"><strong>${matched ? 'Match confirmed' : 'Verification needs attention'}</strong>
    <p>${escape(verification.message || (matched ? 'The scanned trolley and material match their current assignment.' : 'Review the exceptions before this trolley is used.'))}</p>
    ${issues.length ? `<ul>${issues.map((issue) => `<li>${escape(typeof issue === 'string' ? issue : issue.message || issue.msg || issue.kind || issue.type)}</li>`).join('')}</ul>` : ''}
    ${!matched && verification.id ? `<button class="btn primary" data-request-verification="${escape(verification.id)}">Request supervisor approval</button>` : ''}</div>`;
}

function productSummaries(state) {
  const groups = new Map();
  for (const trolley of activeTrolleys(state)) {
    if (!trolley.product) continue;
    const key = JSON.stringify([trolley.product, trolley.batch]);
    if (!groups.has(key))
      groups.set(key, { product: trolley.product, batch: trolley.batch, trolleys: [] });
    groups.get(key).trolleys.push(trolley);
  }
  for (const record of list(state.products)) {
    if (![...groups.values()].some((group) => group.product === record.id))
      groups.set(record.id, { product: record.id, batch: '', trolleys: [] });
  }
  return [...groups.values()].sort(
    (a, b) =>
      String(a.product).localeCompare(String(b.product)) ||
      String(a.batch).localeCompare(String(b.batch)),
  );
}

export function productsView(state) {
  const filters = state.productFilters || {};
  const query = String(filters.q || '')
    .trim()
    .toLowerCase();
  const assignments = activeTrolleys(state).filter(
    (trolley) => trolley.product || trolleyFlags(state, trolley).length,
  );
  const filtered = assignments
    .filter((trolley) => {
      const flags = trolleyFlags(state, trolley);
      const text = [
        trolley.id,
        trolley.product,
        productName(state, trolley.product),
        trolley.batch,
        locationName(state, trolley.location),
      ]
        .join(' ')
        .toLowerCase();
      return (
        (!query || text.includes(query)) &&
        (!filters.flag ||
          (filters.flag === 'any' ? flags.length > 0 : flags.includes(filters.flag)))
      );
    })
    .sort(
      (a, b) =>
        trolleyFlags(state, b).length - trolleyFlags(state, a).length ||
        String(a.id).localeCompare(String(b.id)),
    );
  const warningCount = activeTrolleys(state).filter(
    (trolley) => trolleyFlags(state, trolley).length,
  ).length;
  const pending = list(state.approvals).filter((record) => record.status === 'Pending');
  return `${pageTitle('Product & material segregation', 'Verify the trolley, product and batch before use. Exceptions stay visible until reviewed.')}
    ${pending.length ? `<div class="callout warning">${count(pending.length)} product verification request${pending.length === 1 ? '' : 's'} awaiting supervisor review. <button class="text-button" data-page="approvals">Open approvals</button></div>` : ''}
    <div class="grid"><section class="card"><h3>Verify a scan</h3>
      ${
        canVerify(state)
          ? form(
              'scan-verify',
              `<label>Trolley ID<input name="trolley" required list="verify-trolleys" autocomplete="off" placeholder="Scan or enter trolley ID"></label><datalist id="verify-trolleys">${activeTrolleys(
                state,
              )
                .map((trolley) => option(trolley.id, trolley.id))
                .join('')}</datalist>
        <label>Product scanned<select name="product" required><option value="">Select a product</option>${list(
          state.products,
        )
          .map((record) => option(record.id, `${record.id} · ${record.name}`))
          .join('')}</select></label>
        <details><summary>Additional checks</summary><div class="form-fields"><label>Expected trolley type<input name="type" maxlength="80"></label>
        <label>Scanned location<select name="location"><option value="">Use current location</option>${list(
          state.locations,
        )
          .map((record) => option(record.id, record.name))
          .join('')}</select></label>
        <label>Batch number<input name="batch" maxlength="120"></label><label>Scanned quantity<input name="qty" type="number" min="0" step="any"></label><label>Remarks<input name="remarks" maxlength="500"></label></div></details>`,
              'Verify scan',
            )
          : '<p class="hint">An administrator, supervisor or quality user can verify product scans.</p>'
      }
      ${verificationResult(state)}</section>
    <section class="card"><div class="card-heading"><h3>Products in the plant</h3>${badge(`${warningCount} trolleys with warnings`, warningCount > 0)}</div>
      ${dataTable(
        ['Code / product', 'Batch', 'Trolleys', 'Quantity', 'Held at'],
        productSummaries(state).map(
          (group) =>
            `<tr><td><strong>${escape(productName(state, group.product))}</strong><div class="hint">${escape(group.product)}</div></td><td>${escape(group.batch || '—')}</td><td>${count(group.trolleys.length)}</td><td>${count(group.trolleys.reduce((total, trolley) => total + number(trolley.qty), 0))} ${escape(product(state, group.product)?.unit || 'pcs')}</td><td>${[...new Set(group.trolleys.map((trolley) => locationName(state, trolley.location)))].map(escape).join(', ') || '—'}</td></tr>`,
        ),
      )}</section></div>
    <section class="card mt"><h3>Current material assignments</h3><form id="product-filter" class="filter-bar"><label>Search assignments<input name="q" value="${escape(filters.q || '')}" type="search" placeholder="Trolley, product, batch or location"></label><label>Segregation warning<select name="flag">${option('', 'All assignments', filters.flag)}${option('any', 'Any warning', filters.flag)}${segregationFlags.map((flag) => option(flag, flag, filters.flag)).join('')}</select></label><button class="btn" type="submit">Apply filters</button></form>
    ${
      filtered.length
        ? dataTable(
            [
              'Product / code',
              'Batch',
              'Trolley',
              'Quantity',
              'Current location',
              'Status',
              'Segregation check',
            ],
            filtered.map((trolley) => {
              const status = effectiveStatus(state, trolley);
              return `<tr><td>${escape(productName(state, trolley.product))}<div class="hint">${escape(trolley.product || '—')}</div></td><td>${escape(trolley.batch || '—')}</td><td>${trolleyLink(trolley.id)}<div class="hint">${escape(trolley.type)}</div></td><td>${count(trolley.qty)} ${escape(product(state, trolley.product)?.unit || trolley.unit || 'pcs')}</td><td>${escape(locationName(state, trolley.location))}</td><td>${badge(status, status === 'Overdue')}</td><td>${flagChips(state, trolley) || badge('No active warnings')}</td></tr>`;
            }),
          )
        : empty('No assignments match', 'Change the search or warning filter.')
    }</section>`;
}

function incidentForm(state, trolleyId = '') {
  return form(
    'incident-report',
    `<label>Trolley<select name="trolley" required><option value="">Select trolley</option>${list(
      state.trolleys,
    )
      .map((trolley) => option(trolley.id, trolley.id, trolleyId))
      .join('')}</select></label>
    <label>Issue type<select name="type" required>${alertTypes.map((type) => option(type, type)).join('')}</select></label>
    <label>Priority<select name="priority" required>${priorities.map((priority) => option(priority, priority, 'Medium')).join('')}</select></label>
    <label>Location<select name="location"><option value="">Use trolley location</option>${list(
      state.locations,
    )
      .map((record) => option(record.id, record.name))
      .join('')}</select></label>
    <label>What happened?<textarea name="message" required maxlength="1000" rows="3" placeholder="Describe the issue and what needs attention"></textarea></label>`,
    'Report issue',
  );
}

export function alertsView(state) {
  const filters = state.alertFilters || {};
  const alerts = list(state.alerts);
  const active = alerts.filter((alert) => alert.status !== 'Resolved');
  const filtered = alerts
    .filter(
      (alert) =>
        (!filters.priority || alert.priority === filters.priority) &&
        (!filters.type || alert.type === filters.type) &&
        (!filters.status ||
          (filters.status === 'Active'
            ? alert.status !== 'Resolved'
            : alert.status === filters.status)),
    )
    .sort(
      (a, b) =>
        Number(a.status === 'Resolved') - Number(b.status === 'Resolved') ||
        priorities.indexOf(a.priority) - priorities.indexOf(b.priority) ||
        number(b.created || b.ts) - number(a.created || a.ts),
    );
  const types = [...new Set([...alertTypes, ...alerts.map((alert) => alert.type)])];
  return `${pageTitle('Alerts center', 'Review exceptions by priority, acknowledge ownership and record their resolution.')}
    ${metrics(priorities.map((priority) => [priority, active.filter((alert) => alert.priority === priority).length, 'Active alerts']))}
    <section class="card"><div class="card-heading"><h3>Operational alerts</h3><span class="hint">${count(active.length)} active · ${count(alerts.length - active.length)} resolved</span></div>
    <form id="alert-filter" class="filter-bar"><label>Alert status<select name="status">${option('', 'All statuses', filters.status)}${option('Active', 'Active: open and acknowledged', filters.status)}${['Open', 'Acknowledged', 'Resolved'].map((status) => option(status, status, filters.status)).join('')}</select></label>
    <label>Priority<select name="priority">${option('', 'All priorities', filters.priority)}${priorities.map((priority) => option(priority, priority, filters.priority)).join('')}</select></label><label>Alert type<select name="type">${option('', 'All alert types', filters.type)}${types.map((type) => option(type, type, filters.type)).join('')}</select></label><button class="btn" type="submit">Apply filters</button></form>
    ${
      filtered.length
        ? dataTable(
            ['Priority', 'Alert / message', 'Trolley / location', 'Raised', 'Status', 'Actions'],
            filtered.map(
              (alert) =>
                `<tr><td>${badge(alert.priority, ['Critical', 'High'].includes(alert.priority))}</td><td><strong>${escape(alert.type)}</strong><p class="hint">${escape(alert.message || alert.msg)}</p></td><td>${alert.trolley ? trolleyLink(alert.trolley) : '—'}<div class="hint">${escape(locationName(state, alert.location || alert.loc))}</div></td><td>${stamp(alert.created || alert.ts)}</td><td>${badge(alert.status, alert.status === 'Open')}<div class="hint">${escape(alert.resolved_by_name || alert.acknowledged_by_name || alert.resolvedBy || alert.ackBy || '')}</div>${alert.remarks ? `<div class="hint">${escape(alert.remarks)}</div>` : ''}</td><td><div class="actions">${alert.status === 'Open' && canManageAlerts(state) ? `<button class="btn" data-alert-id="${escape(alert.id)}" data-alert-status="Acknowledged">Acknowledge</button>` : ''}${alert.status !== 'Resolved' && canManageAlerts(state) ? `<button class="btn" data-alert-id="${escape(alert.id)}" data-alert-status="Resolved">Resolve</button>` : ''}${alert.trolley ? `<button class="btn" data-trolley-detail="${escape(alert.trolley)}">View trolley</button>` : ''}</div></td></tr>`,
            ),
          )
        : empty('No alerts match', 'There are no alerts for the selected filters.')
    }</section>
    <section class="card mt"><details${state.reportIssue ? ' open' : ''}><summary>Report an issue</summary><p class="hint">Record a missing trolley, unexpected scan or other operational exception.</p>${incidentForm(state, state.reportIssue || '')}</details></section>`;
}

export function notificationsView(state) {
  const notifications = list(state.notifications)
    .slice()
    .sort((a, b) => number(b.created || b.ts) - number(a.created || a.ts));
  const unread = notifications.filter(
    (notification) => !notification.read && !notification.read_at,
  );
  return `${pageTitle('Notifications', 'Updates and reminders for your plant workspace.')}
    <section class="card"><div class="card-heading"><h3>${count(unread.length)} unread</h3><div class="actions"><button class="btn" data-notification-read="all"${unread.length ? '' : ' disabled'}>Mark all read</button><button class="btn" data-page="alerts">Open alerts</button></div></div>
      ${
        notifications.length
          ? `<div class="notification-list">${notifications
              .map((notification) => {
                const isUnread = !notification.read && !notification.read_at;
                return `<article class="notification${isUnread ? ' unread' : ''}"><div><div class="actions">${badge(notification.kind || notification.level || notification.type || 'Update', ['danger', 'Critical', 'warn', 'warning'].includes(notification.kind || notification.level))}${isUnread ? badge('Unread') : ''}</div>${notification.title ? `<h3>${escape(notification.title)}</h3>` : ''}<p>${escape(notification.message || notification.text || notification.title)}</p><time class="hint">${stamp(notification.created || notification.ts)}</time>${notification.trolley ? `<p>${trolleyLink(notification.trolley)}</p>` : ''}</div>${isUnread ? `<button class="btn" data-notification-read="${escape(notification.id)}" aria-label="Mark notification read">Mark read</button>` : ''}</article>`;
              })
              .join('')}</div>`
          : empty('All clear', 'New reminders and operational updates will appear here.')
      }</section>`;
}

function scanTrolley(state) {
  const result = state.scanResult;
  if (!result) return null;
  if (typeof result.trolley === 'object' && result.trolley)
    return (
      list(state.trolleys).find((trolley) => trolley.id === result.trolley.id) || result.trolley
    );
  const id = typeof result === 'string' ? result : result.trolley || result.id;
  return (
    list(state.trolleys).find((trolley) => trolley.id === id) || (result.location ? result : null)
  );
}

export function scanView(state) {
  const trolley = scanTrolley(state);
  const result = state.scanResult;
  const details = trolley ? assignment(state, trolley) : null;
  const status = trolley ? effectiveStatus(state, trolley) : '';
  const recent = list(state.recentScans).slice(0, 8);
  return `${pageTitle('Scan trolley', 'Identify a trolley by its QR label, RFID tag or trolley ID and see its current assignment.')}
    <div class="grid"><section class="card"><h3>Identify a trolley</h3><div class="scanner-frame"><div class="scanner-symbol" aria-hidden="true">▦</div><p>Scan a QR label with your camera, use a connected reader, or enter an ID below.</p></div>
      <div class="actions"><button class="btn" id="start-camera">Scan with camera</button><button class="btn" id="stop-camera" hidden>Stop camera</button>${state.user?.role === 'Admin' ? '<button class="btn" data-page="readers">RFID readers</button>' : ''}</div>
      <video id="scan-video" class="scan-video" autoplay muted playsinline hidden></video><p id="scan-status" class="hint" role="status">Camera frames stay on this device. Identification does not record a movement.</p>
      ${form('scan-lookup', '<label>Trolley ID, QR value or RFID tag<input name="code" required autocomplete="off" placeholder="Scan or enter identifier" autofocus maxlength="200"></label>', 'Find trolley')}
      <h3 class="mt">Recent scans</h3>${recent.length ? `<div class="recent-scans">${recent.map((scan) => `<div>${scan.trolley || scan.id ? trolleyLink(scan.trolley || scan.id) : escape(scan.code || scan.q)} <span class="hint">${escape(scan.source || 'Manual entry')} · ${stamp(scan.created || scan.at)}</span></div>`).join('')}</div>` : '<p class="hint">No scans yet in this session.</p>'}</section>
    <section class="card" id="scan-result" aria-live="polite">${
      trolley
        ? `<div class="card-heading"><div><p class="hint">${escape(result.source || 'Trolley identified')}</p><h2>${escape(trolley.id)}</h2></div>${badge(status, status === 'Overdue')}</div>
      <dl class="detail-list"><dt>Current location</dt><dd><strong>${escape(locationName(state, trolley.location))}</strong><div class="hint">${escape(trolley.location)}</div></dd><dt>Current status</dt><dd>${escape(status)}${details.open ? ` · To ${escape(locationName(state, details.open.destination))}` : ''}</dd><dt>Assigned material</dt><dd>${escape(productName(state, trolley.product))}${trolley.product ? ` · ${count(trolley.qty)} ${escape(product(state, trolley.product)?.unit || trolley.unit || 'pcs')}` : ''}</dd><dt>Batch</dt><dd>${escape(trolley.batch || '—')}</dd><dt>Last movement</dt><dd>${stamp(details.lastMove)}</dd><dt>Last operator</dt><dd>${escape(details.operator)}</dd><dt>At location for</dt><dd>${details.since ? duration(now(state) - details.since) : '—'}</dd></dl>
      <div class="actions">${flagChips(state, trolley)}</div><div class="actions mt">${canMove(state) ? `<button class="btn primary" data-prefill-move="${escape(trolley.id)}">Move trolley</button>` : ''}${canMove(state) && details.open?.state === 'In Transit' ? `<button class="btn" data-receive="${escape(details.open.id)}">Receive trolley</button>` : ''}<button class="btn" data-trolley-detail="${escape(trolley.id)}">View details & history</button><button class="btn" data-report-issue="${escape(trolley.id)}">Report issue</button></div>`
        : result
          ? `<div class="callout warning"><h3>Trolley not found</h3><p>No trolley matches ${escape(result.code || result.error || result.err || result)}. Check the identifier or register the trolley in Plant setup.</p></div>`
          : empty(
              'Waiting for a scan',
              'Trolley details and available actions appear here after identification.',
            )
    }</section></div>`;
}

export function trolleyDetailView(state, trolleyId) {
  const trolley = list(state.trolleys).find((record) => record.id === trolleyId);
  if (!trolley)
    return `${pageTitle('Trolley details', 'Review a trolley and its movement trail.')}<section class="card">${empty('Trolley not found', 'The trolley may have been removed or your view needs refreshing.')}</section>`;
  const details = assignment(state, trolley);
  const status = effectiveStatus(state, trolley);
  const movements = trolleyMovements(state, trolley.id);
  const alerts = list(state.alerts).filter(
    (alert) => alert.trolley === trolley.id && alert.status !== 'Resolved',
  );
  const audit = list(state.audit)
    .filter((record) => record.entity === trolley.id)
    .slice(0, 8);
  const labelUrl = `/api/trolleys/${encodeURIComponent(trolley.id)}/label`;
  const history = state.trolleyHistory;
  return `${pageTitle(escape(trolley.id), 'Current assignment, identification and complete movement history.')}
    <div class="actions page-actions"><button class="btn" data-page="fleet">Back to fleet</button>${canMove(state) ? `<button class="btn primary" data-prefill-move="${escape(trolley.id)}">Move trolley</button>` : ''}<button class="btn" data-report-issue="${escape(trolley.id)}">Report issue</button>${canEdit(state) ? `<button class="btn" data-edit-master="trolleys" data-id="${escape(trolley.id)}">Edit trolley</button>` : ''}</div>
    <div class="grid mt"><section class="card"><div class="trolley-label"><img src="${escape(labelUrl)}" alt="QR label for trolley ${escape(trolley.id)}" width="132" height="132"><div><h2>${escape(trolley.id)}</h2>${badge(status, status === 'Overdue')}<div class="actions mt">${flagChips(state, trolley)}</div></div></div>
      <div class="actions mt"><a class="btn" href="${escape(labelUrl)}" target="_blank" rel="noopener">Open / print QR label</a><a class="btn" href="${escape(labelUrl)}" download="${escape(trolley.id)}.svg">Download QR label</a></div>
      <h3 class="mt">Trolley information</h3><dl class="detail-list"><dt>Type</dt><dd>${escape(trolley.type)}</dd><dt>Capacity</dt><dd>${count(trolley.capacity)} ${escape(trolley.unit || 'pcs')}</dd><dt>Material type</dt><dd>${escape(trolley.material_type || 'Unspecified')}</dd><dt>Department</dt><dd>${escape(details.department)}</dd><dt>Assigned area</dt><dd>${escape(locationName(state, trolley.assigned_area))}</dd><dt>Current location</dt><dd><strong>${escape(locationName(state, trolley.location))}</strong> <span class="hint">${escape(trolley.location)}</span></dd><dt>At location for</dt><dd>${details.since ? duration(now(state) - details.since) : '—'}</dd><dt>Times used</dt><dd>${count(trolley.uses ?? movements.filter((movement) => movement.state === 'Received').length)}</dd><dt>QR value</dt><dd><code>${escape(trolley.qr_value || trolley.id)}</code></dd><dt>RFID tag</dt><dd><code>${escape(trolley.rfid || 'Not assigned')}</code></dd><dt>Tag condition</dt><dd>${escape(trolley.tag_condition || 'Not recorded')}</dd></dl>
      <h3 class="mt">Current assignment</h3>${trolley.product ? `<dl class="detail-list"><dt>Product</dt><dd>${escape(productName(state, trolley.product))}<div class="hint">${escape(trolley.product)}</div></dd><dt>Batch</dt><dd>${escape(trolley.batch)}</dd><dt>Quantity</dt><dd>${count(trolley.qty)} ${escape(product(state, trolley.product)?.unit || trolley.unit || 'pcs')}</dd><dt>Operator</dt><dd>${escape(details.operator)}</dd><dt>Expected return</dt><dd>${stamp(details.expected)}${status === 'Overdue' ? ` ${badge(`${duration(now(state) - details.expected)} late`, true)}` : ''}</dd></dl>` : `<p class="hint">Empty trolley. Last handled by ${escape(details.operator)}.</p>`}
      ${alerts.length ? `<h3 class="mt">Open alerts</h3>${alerts.map((alert) => `<div class="callout warning">${badge(alert.priority, true)} <strong>${escape(alert.type)}</strong><p>${escape(alert.message || alert.msg)}</p><button class="text-button" data-page="alerts">Review alerts</button></div>`).join('')}` : ''}</section>
    <section class="card"><div class="card-heading"><h3>Movement timeline</h3><span class="hint">${count(movements.length)} loaded</span></div>
      ${movements.length ? `<ol class="timeline">${movements.map((movement) => `<li><div class="card-heading"><strong>${escape(locationName(state, movement.destination))}</strong>${badge(movement.state, movement.state === 'Rejected')}</div><p>${escape(locationName(state, movement.source))} → ${escape(locationName(state, movement.destination))}</p><p class="hint">${stamp(movement.created)} · ${escape(movement.requester || 'Operator')}<br>${escape(productName(state, movement.product))} · ${count(movement.qty)} ${escape(product(state, movement.product)?.unit || trolley.unit || 'pcs')} · ${escape(movement.batch || 'No batch')}${movement.received ? `<br>Received ${stamp(movement.received)}` : ''}</p>${parseList(movement.policy_flags).length ? `<p class="hint">${parseList(movement.policy_flags).map(escape).join(' · ')}</p>` : ''}${movement.decision_reason ? `<p class="hint">Decision: ${escape(movement.decision_reason)}</p>` : ''}</li>`).join('')}</ol>` : empty('No movements recorded', 'The movement timeline will grow as this trolley is used.')}
      ${history?.nextCursor ? `<button class="btn" data-history-more="${escape(trolley.id)}">Load earlier movements</button>` : ''}
      ${audit.length ? `<h3 class="mt">Recent audit entries</h3><ul class="audit-list">${audit.map((record) => `<li><strong>${escape(record.action)}</strong><div class="hint">${escape(record.actor_name || '')} · ${stamp(record.ts)}</div></li>`).join('')}</ul>` : ''}</section></div>`;
}
