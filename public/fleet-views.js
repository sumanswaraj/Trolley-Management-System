import {
  escapeHtml as e,
  formatTime,
  canManagePlant,
  inputField,
  selectField,
  optionsFor,
  form,
  dataTable,
  pageTitle,
} from './ui.js';

export const movementTypes = [
  'Transfer',
  'Production Issue',
  'Production Return',
  'Quality Inspection',
  'Quality Release',
  'Packing',
  'Dispatch',
  'Store Transfer',
  'Maintenance',
  'Outside Plant',
];
export const statuses = [
  'Available',
  'In Use',
  'In Transit',
  'Waiting',
  'Maintenance',
  'Overdue',
  'Outside Plant',
  'Inactive',
];
export const locationName = (state, id) =>
  state.locations.find((item) => item.id === id)?.name || id || '—';
const productName = (state, id) => state.products.find((item) => item.id === id)?.name || 'Empty';
const openMove = (state, id) =>
  (state.activeMovements || state.movements).find(
    (item) => item.trolley === id && ['Pending', 'In Transit'].includes(item.state),
  );
export const effectiveStatus = (state, trolley) =>
  !trolley.active && trolley.active !== undefined
    ? 'Inactive'
    : Boolean(openMove(state, trolley.id)?.expected || trolley.expected) &&
        (openMove(state, trolley.id)?.expected || trolley.expected) < Date.now()
      ? 'Overdue'
      : trolley.status;
const time = (value) => (value ? formatTime(value) : '—');
const selectOptions = (values, selected = '', label = 'All') =>
  `<option value="">${e(label)}</option>` +
  values
    .map((value) => `<option ${value === selected ? 'selected' : ''}>${e(value)}</option>`)
    .join('');
const link = (id) =>
  `<button class="text-button mono" data-trolley-detail="${e(id)}">${e(id)}</button>`;
const badge = (value) =>
  `<span class="badge ${['Overdue', 'Inactive'].includes(value) ? 'late' : ''}">${e(value)}</span>`;

export function fleetTable(state, trolleys = state.trolleys) {
  const desktop = dataTable(
    [
      'Trolley',
      'Type / tags',
      'Previous → current',
      'Destination',
      'Product / batch',
      'Load',
      'Status',
      'Last movement / operator',
    ],
    trolleys.map((trolley) => {
      const movement = openMove(state, trolley.id);
      const last = (state.movements || []).find((item) => item.trolley === trolley.id);
      return `<tr><td>${link(trolley.id)}<div class="hint">${e(trolley.department)}</div></td><td>${e(trolley.type)}<div class="hint">QR ${e(trolley.qr_value || trolley.id)} · RFID ${e(trolley.rfid || '—')}</div><div class="hint">${e(trolley.tag_condition || 'Good')}</div></td><td>${last ? `${e(locationName(state, last.source))} → ` : ''}${e(locationName(state, trolley.location))}</td><td>${movement ? e(locationName(state, movement.destination)) : '—'}</td><td>${e(productName(state, trolley.product))}<div class="hint">${e(trolley.batch)}</div></td><td>${trolley.qty} / ${trolley.capacity} ${e(trolley.unit || 'pcs')}</td><td>${badge(effectiveStatus(state, trolley))}</td><td>${time(trolley.last_moved || last?.created)}<div class="hint">${e(trolley.operator_name || last?.requester || '—')}</div></td></tr>`;
    }),
  );
  const mobile = trolleys
    .map(
      (trolley) =>
        `<article class="mobile-trolley"><div class="card-heading"><h3>${link(trolley.id)}</h3>${badge(effectiveStatus(state, trolley))}</div><dl><dt>Location</dt><dd>${e(locationName(state, trolley.location))}</dd><dt>Destination</dt><dd>${e(locationName(state, openMove(state, trolley.id)?.destination))}</dd><dt>Type</dt><dd>${e(trolley.type)}</dd><dt>Product</dt><dd>${e(productName(state, trolley.product))}</dd><dt>Batch</dt><dd>${e(trolley.batch || '—')}</dd><dt>Load</dt><dd>${trolley.qty} / ${trolley.capacity} ${e(trolley.unit || 'pcs')}</dd><dt>Tags</dt><dd>${e(trolley.tag_condition || 'Good')} · ${e(trolley.rfid || 'No RFID')}</dd></dl><a href="/api/trolleys/${encodeURIComponent(trolley.id)}/label" target="_blank" rel="noopener">QR label</a></article>`,
    )
    .join('');
  return `<div class="fleet-table">${desktop}</div><div class="trolley-cards">${mobile || '<div class="empty">No matching trolleys.</div>'}</div>`;
}

export function fleetView(state) {
  const f = state.fleetFilters || {};
  const q = (f.q || '').toLowerCase();
  const list = state.trolleys.filter((trolley) => {
    const last = (state.movements || []).find((item) => item.trolley === trolley.id);
    const loc = state.locations.find((item) => item.id === trolley.location);
    return (
      (!q ||
        [
          trolley.id,
          trolley.qr_value,
          trolley.rfid,
          trolley.type,
          trolley.product,
          trolley.batch,
          trolley.operator_name,
          last?.requester,
          loc?.name,
        ]
          .join(' ')
          .toLowerCase()
          .includes(q)) &&
      (!f.status || effectiveStatus(state, trolley) === f.status) &&
      (!f.location || trolley.location === f.location) &&
      (!f.type || trolley.type === f.type) &&
      (!f.group || loc?.group_name === f.group) &&
      (!f.department || trolley.department === f.department)
    );
  });
  const page = Math.min(Math.max(1, Number(f.page) || 1), Math.max(1, Math.ceil(list.length / 20)));
  const slice = list.slice((page - 1) * 20, page * 20);
  return `${pageTitle('Trolley fleet', 'Live tracking · location changes when receipt is confirmed.')}<section class="card"><form id="fleet-filter" class="filter-bar"><label>Search fleet<input name="q" value="${e(f.q || '')}" placeholder="ID, QR, RFID, product or operator"></label><label>Status<select name="status">${selectOptions(statuses, f.status, 'All statuses')}</select></label><label>Location<select name="location"><option value="">All locations</option>${state.locations.map((item) => `<option value="${e(item.id)}" ${f.location === item.id ? 'selected' : ''}>${e(item.name)}</option>`).join('')}</select></label><label>Type<select name="type">${selectOptions([...new Set(state.trolleys.map((item) => item.type))], f.type, 'All types')}</select></label><label>Group<select name="group">${selectOptions([...new Set(state.locations.map((item) => item.group_name).filter(Boolean))], f.group, 'All groups')}</select></label><label>Department<select name="department">${selectOptions([...new Set(state.trolleys.map((item) => item.department).filter(Boolean))], f.department, 'All departments')}</select></label><div class="error" role="alert"></div><button type="submit">Filter</button><button type="button" class="btn" data-clear-fleet>Clear</button></form><div class="section-heading"><p class="hint">${list.length} trolleys · page ${page} of ${Math.max(1, Math.ceil(list.length / 20))}</p><div class="actions"><button class="btn" data-fleet-mode="table" aria-pressed="${state.fleetMode !== 'cards'}">Table</button><button class="btn" data-fleet-mode="cards" aria-pressed="${state.fleetMode === 'cards'}">Cards</button></div></div><div id="fleet" class="${state.fleetMode === 'cards' ? 'force-cards' : ''}">${fleetTable(state, slice)}</div><div class="actions mt"><button class="btn" data-fleet-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn" data-fleet-page="${page + 1}" ${page * 20 >= list.length ? 'disabled' : ''}>Next</button></div></section>`;
}

export function dashboardView(state) {
  const active = state.trolleys.filter((item) => item.active !== 0);
  const count = (value) => active.filter((item) => effectiveStatus(state, item) === value).length;
  const groupCount = (name) =>
    active.filter(
      (item) => state.locations.find((loc) => loc.id === item.location)?.group_name === name,
    ).length;
  const metrics = [
    ['Fleet', active.length, ''],
    ...['Available', 'In Use', 'In Transit', 'Overdue', 'Outside Plant'].map((status) => [
      status,
      count(status),
      status,
    ]),
    ...['Production', 'Quality', 'Store', 'Dispatch'].map((group) => [
      group,
      groupCount(group),
      '',
      group,
    ]),
  ];
  const open = state.activeMovements || state.movements || [];
  const stages = [
    'Store',
    'Production',
    'Assembly',
    'Quality',
    'Packing',
    'Finished Goods',
    'Dispatch',
    'Maintenance',
    'Outside Plant',
  ];
  const grouped = new Map();
  for (const location of state.locations.filter((item) => item.active !== 0)) {
    const group =
      location.group_name && location.group_name !== 'Other' ? location.group_name : location.id;
    if (!grouped.has(group))
      grouped.set(group, {
        name: group === location.id ? location.name : group,
        group: group === location.id ? '' : group,
        locations: [],
      });
    grouped.get(group).locations.push(location);
  }
  const flowGroups = [...grouped.values()].sort(
    (a, b) =>
      (stages.includes(a.group) ? stages.indexOf(a.group) : stages.length) -
      (stages.includes(b.group) ? stages.indexOf(b.group) : stages.length),
  );
  const longest = active
    .filter((t) => t.since)
    .slice()
    .sort((a, b) => a.since - b.since)[0];
  return `${pageTitle('Plant overview', 'Know what moved, where it is, and when its location changed.')}<div class="actions">${state.user.role !== 'Plant Manager' ? '<button class="btn primary" data-page="scan">Scan trolley</button><button class="btn" data-page="movement">Record movement</button><button class="btn" data-page="movement">Receive trolley</button>' : ''}<button class="btn" data-page="locations">Locate a trolley</button></div><div class="cards dashboard-metrics">${metrics.map(([label, value, status, group]) => `<button class="card metric" data-kpi-status="${e(status)}" data-kpi-group="${e(group || '')}"><span>${label}</span><strong>${value}</strong></button>`).join('')}</div>${!state.locations.length ? '<div class="callout">Start in Plant setup: register locations, products and trolleys. Then add operators in User management.</div>' : ''}<section class="card"><div class="section-heading"><h3>Plant trolley movement overview</h3><span class="hint">Arrow counts show departures in the last 24 hours</span></div><div class="plant-flow">${flowGroups
    .map((group, index) => {
      const ids = new Set(group.locations.map((item) => item.id));
      const n = active.filter((item) => ids.has(item.location)).length;
      const capacity = group.locations.reduce((sum, item) => sum + (item.bay_capacity || 0), 0);
      const next = flowGroups[index + 1];
      const destinations = new Set(next?.locations.map((item) => item.id) || []);
      const moved = (state.flow || [])
        .filter((item) => ids.has(item.source) && destinations.has(item.destination))
        .reduce((sum, item) => sum + item.count, 0);
      const target = group.group
        ? `data-kpi-status="" data-kpi-group="${e(group.group)}"`
        : `data-filter-location="${e(group.locations[0].id)}"`;
      return `<button class="flow-node" ${target}><span>${e(group.name)}</span><b>${n}</b><small>${capacity ? `${n} / ${capacity} bays` : `${group.locations.length} locations`}</small></button>${next ? `<span class="flow-arrow">${moved} →</span>` : ''}`;
    })
    .join(
      '',
    )}</div></section><div class="grid mt"><section class="card"><h3>Operations questions, answered</h3>${dataTable(
    ['Question', 'Live answer'],
    [
      `<tr><td>Where are the busiest bays?</td><td>${
        state.locations
          .slice()
          .sort(
            (a, b) =>
              active.filter((t) => t.location === b.id).length -
              active.filter((t) => t.location === a.id).length,
          )
          .slice(0, 3)
          .map((loc) => e(loc.name))
          .join(', ') || 'No locations yet'
      }</td></tr>`,
      `<tr><td>What is outside?</td><td>${
        active
          .filter((t) => state.locations.find((loc) => loc.id === t.location)?.external)
          .map((t) => link(t.id))
          .join(' ') || 'None'
      }</td></tr>`,
      `<tr><td>What is overdue?</td><td>${
        active
          .filter((t) => effectiveStatus(state, t) === 'Overdue')
          .map((t) => link(t.id))
          .join(' ') || 'None'
      }</td></tr>`,
      `<tr><td>What needs approval?</td><td>${open.filter((m) => m.state === 'Pending').length + (state.approvals || []).filter((a) => a.status === 'Pending').length} requests</td></tr>`,
      `<tr><td>Which trolley has the longest stay?</td><td>${longest ? `${link(longest.id)} · ${e(locationName(state, longest.location))} · ${Math.floor((Date.now() - longest.since) / 60000)} minutes` : 'No assignments yet'}</td></tr>`,
      `<tr><td>How many active exceptions?</td><td>${(state.alerts || []).filter((a) => a.status !== 'Resolved').length}</td></tr>`,
      `<tr><td>Latest movement?</td><td>${state.movements[0] ? `${link(state.movements[0].trolley)} · ${time(state.movements[0].created)}` : 'No movements yet'}</td></tr>`,
    ],
  )}</section><section class="card"><div class="section-heading"><h3>Needs attention</h3><button class="btn" data-page="alerts">All alerts</button></div>${
    (state.alerts || [])
      .filter((a) => a.status !== 'Resolved')
      .slice(0, 5)
      .map(
        (a) =>
          `<article class="attention-item"><span class="badge late">${e(a.priority)}</span> ${link(a.trolley)}<b>${e(a.type)}</b><p>${e(a.message)}</p></article>`,
      )
      .join('') || '<div class="empty">No active alerts.</div>'
  }</section></div><section class="card mt"><div class="section-heading"><h3>Latest trolley activity</h3><button class="btn" data-page="history">Movement history</button></div>${fleetTable(
    state,
    active
      .slice()
      .sort((a, b) => (b.last_moved || 0) - (a.last_moved || 0))
      .slice(0, 8),
  )}</section>`;
}

function optional(label, name, value = '', type = 'text') {
  return `<label>${e(label)}<input name="${name}" type="${type}" value="${e(value)}"></label>`;
}

export function mastersView(state) {
  if (!canManagePlant(state.user))
    return (
      pageTitle('Plant setup', 'Register and maintain your plant data.') +
      '<div class="callout">A supervisor or administrator can configure the plant.</div>'
    );
  const mf = state.masterFilters || {};
  const matching = state.trolleys.filter(
    (t) =>
      (!mf.q ||
        [t.id, t.qr_value, t.rfid, t.type, t.material_type, t.assigned_area]
          .join(' ')
          .toLowerCase()
          .includes(mf.q.toLowerCase())) &&
      (!mf.type || t.type === mf.type) &&
      (!mf.status || effectiveStatus(state, t) === mf.status) &&
      (!mf.department || t.department === mf.department),
  );
  const masterPage = Math.min(
    Math.max(1, Number(mf.page) || 1),
    Math.max(1, Math.ceil(matching.length / 15)),
  );
  const masterRows = matching.slice((masterPage - 1) * 15, masterPage * 15);
  let nextId = 1;
  while (state.trolleys.some((t) => t.id.toUpperCase() === 'TR-' + String(nextId).padStart(3, '0')))
    nextId++;
  const nextHint = 'TR-' + String(nextId).padStart(3, '0');
  const filters = `<form id="master-filter" class="filter-bar"><label>Search trolley master<input name="q" value="${e(mf.q || '')}" placeholder="ID, QR, RFID or material"></label><label>Type<select name="type">${selectOptions([...new Set(state.trolleys.map((t) => t.type))], mf.type, 'All types')}</select></label><label>Status<select name="status">${selectOptions(statuses, mf.status, 'All statuses')}</select></label><label>Department<select name="department">${selectOptions([...new Set(state.trolleys.map((t) => t.department).filter(Boolean))], mf.department, 'All departments')}</select></label><div class="error" role="alert"></div><button type="submit">Filter master</button><button type="button" class="btn" data-clear-master>Clear</button></form><p class="hint">${matching.length} trolleys · page ${masterPage} of ${Math.max(1, Math.ceil(matching.length / 15))} · Next unused ID: ${nextHint}</p>`;
  const edit = state.editingMaster;
  const record = edit?.record || {};
  const kind = edit?.kind || 'trolleys';
  const locationOptions = optionsFor(state.locations.filter((item) => item.active !== 0));
  const fields = (entity) => {
    const value = entity === kind ? record : {};
    const id = `<label>${entity === 'trolleys' ? 'Trolley ID / QR value' : entity === 'locations' ? 'Location ID' : 'Product code'}<input name="id" required maxlength="40" value="${e(value.id || '')}" ${value.id ? 'readonly' : ''}></label>`;
    if (entity === 'locations')
      return (
        id +
        optional('Name', 'name', value.name) +
        optional('Group', 'group_name', value.group_name || 'Store') +
        optional('Department', 'department', value.department) +
        optional('Bay capacity', 'bay_capacity', value.bay_capacity || 20, 'number') +
        optional(
          'Expected return (minutes)',
          'expected_minutes',
          value.expected_minutes || 480,
          'number',
        ) +
        `<label class="check"><input name="external" type="checkbox" ${value.external ? 'checked' : ''}>Outside plant</label>`
      );
    if (entity === 'products')
      return (
        id +
        optional('Product name', 'name', value.name) +
        optional('Category', 'category', value.category || 'Unspecified') +
        optional('Quantity unit', 'unit', value.unit || 'pcs') +
        optional('Default batch', 'default_batch', value.default_batch) +
        `<label>Allowed locations<select name="allowed_locations" multiple>${state.locations.map((loc) => `<option value="${e(loc.id)}" ${(value.allowed_locations || []).includes(loc.id) ? 'selected' : ''}>${e(loc.name)}</option>`).join('')}</select><small class="hint">No selection allows all locations. Hold Ctrl or Command to select several.</small></label>`
      );
    return (
      id +
      optional('Trolley type', 'type', value.type || 'Component Trolley') +
      optional(
        'Capacity (same units as load quantity)',
        'capacity',
        value.capacity || 100,
        'number',
      ) +
      optional('Capacity unit', 'unit', value.unit || 'pcs') +
      optional('Material type', 'material_type', value.material_type) +
      optional('Department', 'department', value.department) +
      `<label>Assigned area<select name="assigned_area"><option value="">Unassigned</option>${locationOptions}</select></label>` +
      (value.id
        ? `<p class="hint">Current location: ${e(locationName(state, value.location))}. Record a movement to change it.</p>`
        : selectField('Initial location', 'location', locationOptions)) +
      optional('QR value', 'qr_value', value.qr_value || value.id) +
      optional('RFID number', 'rfid', value.rfid) +
      `<label>Tag condition<select name="tag_condition">${['Good', 'Damaged', 'Unreadable', 'Missing'].map((tag) => `<option ${value.tag_condition === tag ? 'selected' : ''}>${tag}</option>`).join('')}</select></label>`
    );
  };
  const sections = edit ? [kind] : ['trolleys', 'locations', 'products'];
  return `${pageTitle('Plant setup', 'Permanent trolley identities, real locations and product compatibility.')}<div class="grid">${sections.map((entity) => `<section class="card"><h3>${edit ? 'Edit' : 'Add'} ${entity.replace(/s$/, '')}</h3>${form(edit ? 'master-edit' : entity, `<input type="hidden" name="kind" value="${entity}"><input type="hidden" name="version" value="${record.version || 1}">` + fields(entity), edit ? 'Save changes' : entity === 'trolleys' ? 'Register trolley' : entity === 'locations' ? 'Add location' : 'Add product')}${edit ? '<button class="btn mt" data-cancel-edit>Cancel</button>' : ''}</section>`).join('')}</div><section class="card mt"><h3>Trolley master</h3>${filters}<p class="hint">IDs and history are retained when a trolley is deactivated.</p>${dataTable(
    [
      'ID / QR / RFID',
      'Type / material',
      'Department / area',
      'Capacity',
      'Location',
      'Status',
      'Created / last moved',
      'Actions',
    ],
    masterRows.map(
      (t) =>
        `<tr><td>${link(t.id)}<div class="hint">${e(t.qr_value || t.id)} · ${e(t.rfid || '—')}</div></td><td>${e(t.type)}<div class="hint">${e(t.material_type)}</div></td><td>${e(t.department)}<div class="hint">${e(locationName(state, t.assigned_area))}</div></td><td>${t.capacity} ${e(t.unit)}</td><td>${e(locationName(state, t.location))}</td><td>${badge(effectiveStatus(state, t))}</td><td>${time(t.created)}<div class="hint">${time(t.last_moved)}</div></td><td><div class="actions"><button class="btn" data-edit-master="trolleys" data-id="${e(t.id)}">Edit</button><button class="btn" data-toggle-master="trolleys" data-id="${e(t.id)}">${t.active ? 'Deactivate' : 'Activate'}</button><button class="btn" data-label="${e(t.id)}">QR label</button></div></td></tr>`,
    ),
  )}<div class="actions mt"><button class="btn" data-master-page="${masterPage - 1}" ${masterPage <= 1 ? 'disabled' : ''}>Previous</button><button class="btn" data-master-page="${masterPage + 1}" ${masterPage * 15 >= matching.length ? 'disabled' : ''}>Next</button></div></section><div class="grid mt">${[
    'locations',
    'products',
  ]
    .map(
      (entity) =>
        `<section class="card"><h3>Registered ${entity}</h3>${dataTable(
          ['ID', 'Name', 'Status', 'Actions'],
          state[entity].map(
            (r) =>
              `<tr><td>${e(r.id)}</td><td>${e(r.name)}</td><td>${r.active === 0 ? 'Inactive' : 'Active'}</td><td><div class="actions"><button class="btn" data-edit-master="${entity}" data-id="${e(r.id)}">Edit</button><button class="btn" data-toggle-master="${entity}" data-id="${e(r.id)}">${r.active === 0 ? 'Activate' : 'Deactivate'}</button></div></td></tr>`,
          ),
        )}</section>`,
    )
    .join('')}</div>`;
}

export function historyView(state) {
  const f = state.historyFilters || {};
  const options = (records, value, all) =>
    `<option value="">${all}</option>` +
    records
      .map(
        (r) =>
          `<option value="${e(r.id)}" ${value === r.id ? 'selected' : ''}>${e(r.name || r.id)}</option>`,
      )
      .join('');
  const records = state.historyPage?.items || state.movements;
  return `${pageTitle('Movement history', 'Complete retained history with filters and matching downloads.')}<section class="card"><form id="history-filter" class="filter-bar">${optional('Search', 'q', f.q)}${optional('From', 'from', f.from, 'datetime-local')}${optional('To', 'to', f.to, 'datetime-local')}<label>Trolley<select name="trolley">${options(state.trolleys, f.trolley, 'All trolleys')}</select></label><label>Location<select name="location">${options(state.locations, f.location, 'All locations')}</select></label><label>Product<select name="product">${options(state.products, f.product, 'All products')}</select></label>${optional('Operator', 'operator', f.operator)}<label>Movement type<select name="type">${selectOptions(movementTypes, f.type, 'All types')}</select></label><label>Status<select name="status">${selectOptions(['Completed', 'In Transit', 'Pending Approval', 'Rejected', 'Correction Requested'], f.status, 'All statuses')}</select></label><div class="error" role="alert"></div><button type="submit">Apply filters</button><button type="button" class="btn" data-clear-history>Clear</button></form><div class="actions mt"><button class="btn" data-export="movements">Export CSV</button><button class="btn" data-report-export="hist" data-format="xlsx">Excel</button><button class="btn" data-report-export="hist" data-format="pdf">PDF</button></div>${dataTable(
    [
      'Trolley',
      'Date / time',
      'Route',
      'Product / batch / load',
      'Operator / department',
      'Type / reason',
      'Status',
      'Remarks',
    ],
    records.map(
      (m) =>
        `<tr><td>${link(m.trolley)}</td><td>${time(m.occurred_at || m.created)}</td><td>${e(locationName(state, m.source))} → ${e(locationName(state, m.destination))}</td><td>${e(productName(state, m.product))} · ${e(m.batch)} · ${m.qty}</td><td>${e(m.requester || m.operator_name)}<div class="hint">${e(m.department)}</div></td><td>${e(m.movement_type || 'Transfer')}<div class="hint">${e(m.reason)}</div></td><td>${badge(m.display_status || m.state)}${(m.correction_requested || m.display_status === 'Correction Requested') && m.requested_by === state.user.id ? `<button class="btn" data-revise-movement="${m.id}">Revise request</button>` : ''}<div class="hint">${e(m.decision_reason)}</div></td><td>${e(m.remarks)}</td></tr>`,
    ),
  )}${state.historyPage?.nextCursor ? '<button class="btn mt" data-more="history">Load older movements</button>' : ''}</section>`;
}
