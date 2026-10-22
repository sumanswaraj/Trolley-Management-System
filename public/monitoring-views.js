import { esc, icon } from './experience-ui.js';

const STATUS_KEYS = {
  Available: 'avail',
  'In Use': 'use',
  'In Transit': 'transit',
  Waiting: 'wait',
  Maintenance: 'maint',
  Overdue: 'over',
  'Outside Plant': 'out',
  Inactive: 'off',
  Completed: 'avail',
  Received: 'avail',
  Pending: 'wait',
  'Pending Approval': 'wait',
  Rejected: 'over',
  'Correction Requested': 'wait',
};
const STATUSES = [
  'Available',
  'In Use',
  'In Transit',
  'Waiting',
  'Maintenance',
  'Overdue',
  'Outside Plant',
];
const MOVEMENT_TYPES = [
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
const GROUPS = [
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
const REPORTS = [
  ['daily', 'Daily Trolley Movement Report', 'Every movement recorded today, in time order.'],
  ['util', 'Trolley Utilization Report', 'Busy, available and out-of-service trolleys by type.'],
  ['loc', 'Location-wise Trolley Report', 'Trolleys, material and longest stay at each location.'],
  ['prod', 'Product-wise Trolley Report', 'Which trolleys hold each product, and where.'],
  ['over', 'Overdue Trolley Report', 'Expected returns, responsible people and delays.'],
  ['hist', 'Trolley History Report', 'The complete movement trail across all trolleys.'],
  ['out', 'Outside Plant Trolley Report', 'Trolleys beyond the gate and their return times.'],
  [
    'exc',
    'Movement Exception Report',
    'Wrong locations, wrong products, missing trolleys and unauthorized movements.',
  ],
];
const AREAS = {
  'STORE-01': 'store',
  'PROD-L01': 'prod1',
  'PROD-L02': 'prod2',
  'PROD-L03': 'prod3',
  'ASSY-01': 'assy',
  'QUALITY-01': 'qual',
  'MAINT-01': 'maint',
  'FG-01': 'fg',
  'PACK-01': 'pack',
  'DISPATCH-01': 'disp',
};
const number = (value) => Number(value) || 0;
const active = (trolley) => trolley.active !== false && trolley.active !== 0;
const records = (state, key) => (Array.isArray(state[key]) ? state[key] : []);
const location = (state, id) => records(state, 'locations').find((item) => item.id === id);
const lname = (state, id) => location(state, id)?.name || id || '—';
const pname = (state, id) =>
  records(state, 'products').find((item) => item.id === id)?.name || id || 'Empty';
const person = (state, id) =>
  records(state, 'people').find((item) => String(item.id) === String(id))?.name || id || '—';
const group = (state, id) =>
  location(state, id)?.group_name || (location(state, id)?.external ? 'Outside Plant' : 'Other');
const moved = (item) => number(item.last_moved || item.lastMove || item.created);
const occurred = (item) => number(item.occurred || item.created || item.ts);
const since = (item) => number(item.since || item.last_moved || item.created);
const openMovement = (state, trolley) =>
  records(state, 'activeMovements').find(
    (item) => item.trolley === trolley.id && ['Pending', 'In Transit'].includes(item.state),
  );
const expected = (state, trolley) =>
  number(trolley.expected || openMovement(state, trolley)?.expected);
const effective = (state, trolley) => {
  if (!active(trolley)) return 'Inactive';
  if (trolley.effective_status) return trolley.effective_status;
  const deadline = expected(state, trolley);
  if (deadline && deadline < Date.now() && !['Available', 'Maintenance'].includes(trolley.status))
    return 'Overdue';
  return trolley.status || 'Available';
};
const color = (status) => `var(--c-${STATUS_KEYS[status] || 'off'})`;
const badge = (status) =>
  `<span class="bd s-${STATUS_KEYS[status] || 'off'}">${esc(status)}</span>`;
const dt = (timestamp) =>
  number(timestamp) ? new Date(number(timestamp)).toLocaleDateString() : '—';
const tm = (timestamp) =>
  number(timestamp)
    ? new Date(number(timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
const dateTime = (timestamp) =>
  number(timestamp) ? new Date(number(timestamp)).toLocaleString() : '—';
const duration = (milliseconds) => {
  const minutes = Math.max(0, Math.floor(number(milliseconds) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
};
const ago = (timestamp) =>
  number(timestamp) ? `${duration(Date.now() - number(timestamp))} ago` : '—';
const tid = (id) =>
  `<button class="tid" data-action="open-trolley" data-id="${esc(id)}">${esc(id)}</button>`;
const empty = (title, text = '') =>
  `<div class="empty"><b>${esc(title)}</b>${text ? `<div>${esc(text)}</div>` : ''}</div>`;
const button = (label, action, attributes = '', primary = false) =>
  `<button type="button" class="btn${primary ? ' p' : ''}" data-action="${action}" ${attributes}>${label}</button>`;
const pageTitle = (title, subtitle, actions = '') =>
  `<div class="ph"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${actions ? `<div class="acts">${actions}</div>` : ''}</div>`;
const options = (list, value, placeholder) =>
  `<option value="">${esc(placeholder)}</option>${list
    .map((item) => {
      const id = typeof item === 'object' ? item.id : item;
      const label = typeof item === 'object' ? item.name || item.id : item;
      return `<option value="${esc(id)}"${String(value || '') === String(id) ? ' selected' : ''}>${esc(label)}</option>`;
    })
    .join('')}`;
const input = (page, name, value, placeholder, type = 'text') =>
  `<input type="${type}" data-filter="${page}.${name}" name="${name}" value="${esc(value || '')}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"${name === 'q' ? ' class="grow"' : ''}>`;
const select = (page, name, value, items, placeholder) =>
  `<select data-filter="${page}.${name}" name="${name}" aria-label="${esc(placeholder)}">${options(items, value, placeholder)}</select>`;
const table = (
  headers,
  rows,
  message = 'No records match',
  detail = 'Adjust the filters or add records to your plant.',
) =>
  rows.length
    ? `<div class="tw"><table><thead><tr>${headers.map((header) => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : empty(message, detail);
const distinct = (list) => [...new Set(list.filter(Boolean))].sort();
const flags = (trolley) => {
  if (Array.isArray(trolley.flags)) return trolley.flags;
  try {
    const parsed = JSON.parse(trolley.flags || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const flagChips = (trolley) =>
  flags(trolley)
    .map(
      (flag) =>
        `<span class="chip r">${esc(typeof flag === 'object' ? flag.kind || flag.message || flag.msg : flag)}</span>`,
    )
    .join(' ');
const operator = (state, item) =>
  item.operator_name ||
  item.operator ||
  records(state, 'people').find(
    (entry) => String(entry.id) === String(item.operator_id || item.requested_by),
  )?.name ||
  item.requester ||
  '—';
const movementStatus = (item) =>
  item.state === 'Received'
    ? 'Completed'
    : item.state === 'Pending'
      ? 'Pending Approval'
      : item.state || item.status || '—';
const canMove = (state) =>
  state.user?.access?.perms
    ? state.user.access.perms.includes('movement')
    : ['Admin', 'Supervisor', 'Operator', 'Store User', 'Quality User'].includes(state.user?.role);

function workflow(selected = []) {
  const steps = [
    ['scan', 'Identify', 'Scan QR / RFID'],
    ['live', 'Locate', 'See current location'],
    ['movement', 'Move', 'Record a movement'],
    ['products', 'Verify', 'Check product / batch'],
    ['alerts', 'Notify', 'Follow up exceptions'],
    ['history', 'Trace', 'Review movement history'],
    ['reports', 'Analyze', 'Reports & analytics'],
  ];
  return `<div class="steps" aria-label="Trolley workflow">${steps.map(([page, label, detail], index) => `<button class="step${selected.includes(index) ? ' on' : ''}" data-page="${page}"><b><i>${index + 1}</i>${label}</b><span>${detail}</span></button>`).join('')}</div>`;
}

function tagChips(trolley) {
  const health = trolley.tag_health || 'OK';
  return `<span class="chip ${health === 'QR unreadable' ? 'r' : 'g'}">QR ${health === 'QR unreadable' ? 'unreadable' : 'ok'}</span> <span class="chip ${health === 'RFID signal weak' ? 'w' : 'g'}">RFID ${health === 'RFID signal weak' ? 'weak' : 'ok'}</span>`;
}

function fleetTable(state, list) {
  return table(
    [
      'Trolley ID',
      'Type',
      'Current location',
      'Previous location',
      'Product / material',
      'Status',
      'Last movement',
      'Operator',
      'RFID / QR',
    ],
    list.map((trolley) => {
      const status = effective(state, trolley);
      const movement = openMovement(state, trolley);
      return `<tr${status === 'Overdue' ? ' class="late"' : ''}><td>${tid(trolley.id)}</td><td>${esc(trolley.type)}</td><td><b>${esc(lname(state, trolley.location))}</b><div class="small muted mono" aria-hidden="true">${esc(trolley.location)}</div></td><td>${esc(lname(state, trolley.previous_location))}</td><td>${trolley.product ? `${esc(pname(state, trolley.product))}<div class="small muted">${esc(trolley.qty)} ${esc(trolley.unit)} · ${esc(trolley.batch)}</div>` : '<span class="muted">Empty</span>'}</td><td>${badge(status)}${movement?.state === 'In Transit' ? `<div class="small muted">to ${esc(lname(state, movement.destination))}</div>` : ''}${flagChips(trolley) ? `<div>${flagChips(trolley)}</div>` : ''}</td><td class="nowrap">${tm(moved(trolley))}<div class="small muted">${ago(moved(trolley))}</div></td><td>${esc(operator(state, trolley))}</td><td class="nowrap">${tagChips(trolley)}</td></tr>`;
    }),
    'No trolleys match',
    'Clear a filter or search for another ID.',
  );
}

function fleetCards(state, list) {
  return list.length
    ? `<div class="tcards trolley-cards">${list
        .map((trolley) => {
          const status = effective(state, trolley);
          return `<article class="tc mobile-trolley" style="--c:${color(status)}"><div class="r1"><span class="id">${tid(trolley.id)}</span>${badge(status)}</div><div class="small muted">${esc(trolley.type)}</div><dl><dt>Now at</dt><dd><b>${esc(lname(state, trolley.location))}</b></dd><dt>From</dt><dd>${esc(lname(state, trolley.previous_location))}</dd><dt>Material</dt><dd>${trolley.product ? `${esc(pname(state, trolley.product))} × ${esc(trolley.qty)} ${esc(trolley.unit)}` : 'Empty'}</dd><dt>Batch</dt><dd>${esc(trolley.batch || '—')}</dd><dt>Moved</dt><dd>${tm(moved(trolley))} · ${ago(moved(trolley))}</dd><dt>Operator</dt><dd>${esc(operator(state, trolley))}</dd></dl><div style="margin-top:9px">${tagChips(trolley)} ${flagChips(trolley)}</div></article>`;
        })
        .join('')}</div>`
    : empty('No trolleys match', 'Clear a filter or search for another ID.');
}

function paging(list, filter, target, fallback = 20) {
  const size = Math.max(1, Number(filter.size || filter.pageSize) || fallback);
  const pages = Math.max(1, Math.ceil(list.length / size));
  const page = Math.min(pages, Math.max(1, Number(filter.page) || 1));
  const start = (page - 1) * size;
  const footer = `<div class="pager"><span>${list.length ? start + 1 : 0}–${Math.min(start + size, list.length)} of ${list.length} records</span><div class="acts"><button class="btn sm" data-action="paginate" data-target="${target}" data-direction="-1"${page === 1 ? ' disabled' : ''}>Previous</button><span>Page ${page} of ${pages}</span><button class="btn sm" data-action="paginate" data-target="${target}" data-direction="1"${page === pages ? ' disabled' : ''}>Next</button></div></div>`;
  return { items: list.slice(start, start + size), footer };
}

function dashboardView(state) {
  const fleet = records(state, 'trolleys').filter(active);
  const byStatus = (status) =>
    fleet.filter((trolley) => effective(state, trolley) === status).length;
  const byGroup = (name) =>
    fleet.filter((trolley) => group(state, trolley.location) === name).length;
  const metrics = [
    [
      'Total trolleys',
      fleet.length,
      'cart',
      'var(--accent)',
      '',
      '',
      `${records(state, 'trolleys').length - fleet.length} inactive`,
    ],
    [
      'Available',
      byStatus('Available'),
      'check',
      color('Available'),
      'Available',
      '',
      'Ready to issue',
    ],
    ['In use', byStatus('In Use'), 'activity', color('In Use'), 'In Use', '', 'Loaded and working'],
    [
      'In transit',
      byStatus('In Transit'),
      'move',
      color('In Transit'),
      'In Transit',
      '',
      'Awaiting receipt',
    ],
    [
      'At production',
      byGroup('Production'),
      'factory',
      'var(--ink2)',
      '',
      'Production',
      'Production lines',
    ],
    [
      'At quality',
      byGroup('Quality'),
      'shield',
      'var(--ink2)',
      '',
      'Quality',
      `${byStatus('Waiting')} waiting for inspection`,
    ],
    ['At store', byGroup('Store'), 'store', 'var(--ink2)', '', 'Store', 'Main store'],
    [
      'At dispatch',
      byGroup('Dispatch'),
      'truck',
      'var(--ink2)',
      '',
      'Dispatch',
      'Loading and staging',
    ],
    ['Overdue', byStatus('Overdue'), 'clock', color('Overdue'), 'Overdue', '', 'Needs follow-up'],
    [
      'Outside plant',
      byGroup('Outside Plant'),
      'pin',
      color('Outside Plant'),
      '',
      'Outside Plant',
      'Return time tracked',
    ],
  ];
  const recent = [...fleet].sort((a, b) => moved(b) - moved(a)).slice(0, 8);
  const urgent = records(state, 'alerts')
    .filter((alert) => alert.status !== 'Resolved' && ['Critical', 'High'].includes(alert.priority))
    .sort((a, b) => number(b.created || b.ts) - number(a.created || a.ts))
    .slice(0, 5);
  const approvals =
    records(state, 'approvals').filter((item) =>
      ['Pending', 'Pending Approval'].includes(item.status || item.state),
    ).length || records(state, 'activeMovements').filter((item) => item.state === 'Pending').length;
  const completed = records(state, 'movements').filter((item) =>
    ['Received', 'Completed', 'In Transit'].includes(item.state || item.status),
  );
  const dayMoves = completed.filter((item) => occurred(item) >= Date.now() - 86400000);
  const groups = distinct([
    ...GROUPS,
    ...records(state, 'locations').map((item) => item.group_name),
  ]);
  const node = (name) => {
    const list = fleet.filter((item) => group(state, item.location) === name);
    const capacity = records(state, 'locations')
      .filter((item) => group(state, item.id) === name)
      .reduce((sum, item) => sum + number(item.capacity), 0);
    const overdue = list.filter((item) => effective(state, item) === 'Overdue').length;
    return `<button class="fn" data-action="dashboard-focus" data-target="${esc(name)}" data-group="${esc(name)}" style="--c:${name === 'Outside Plant' ? color('Outside Plant') : name === 'Maintenance' ? color('Maintenance') : 'var(--accent)'}"><span class="n">${icon(name === 'Outside Plant' ? 'pin' : 'factory')}${esc(name)}</span><div class="v">${list.length}</div><div class="s">${list.filter((item) => effective(state, item) === 'In Use').length} in use${overdue ? ` · <b style="color:var(--c-over)">${overdue} overdue</b>` : ''}</div><div class="lb"><i style="width:${capacity ? Math.min(100, (list.length / capacity) * 100) : 0}%"></i></div></button>`;
  };
  const chain = ['Store', 'Production', 'Quality', 'Packing', 'Dispatch'];
  const routes = [
    [['Store'], ['Production']],
    [['Production', 'Assembly'], ['Quality']],
    [['Quality'], ['Packing']],
    [['Packing', 'Finished Goods'], ['Dispatch']],
  ];
  const flowCount = (index) => {
    const [sources, destinations] = routes[index];
    return state.dashboard?.flows24h
      ? state.dashboard.flows24h
          .filter(
            (item) =>
              sources.includes(item.source_group) && destinations.includes(item.destination_group),
          )
          .reduce((sum, item) => sum + number(item.count), 0)
      : dayMoves.filter(
          (item) =>
            sources.includes(group(state, item.source)) &&
            destinations.includes(group(state, item.destination)),
        ).length;
  };
  const flow = chain
    .map(
      (name, index) =>
        `${node(name)}${index < chain.length - 1 ? `<div class="fc" aria-label="Moves in the last 24 hours"><span>${flowCount(index)}</span></div>` : ''}`,
    )
    .join('');
  const arrivals = dayMoves.reduce((result, item) => {
    const name = lname(state, item.destination);
    result[name] = (result[name] || 0) + 1;
    return result;
  }, {});
  const busiest = state.dashboard?.arrivals24h
    ? [...state.dashboard.arrivals24h]
        .sort((a, b) => number(b.count) - number(a.count))
        .map((item) => [lname(state, item.location), number(item.count)])[0]
    : Object.entries(arrivals).sort((a, b) => b[1] - a[1])[0];
  const outside = fleet.filter((item) => group(state, item.location) === 'Outside Plant');
  const overdue = fleet.filter((item) => effective(state, item) === 'Overdue');
  const longest = [...fleet]
    .filter((item) => ['In Use', 'Waiting', 'Overdue'].includes(effective(state, item)))
    .sort((a, b) => since(a) - since(b))[0];
  const last = [...completed].sort((a, b) => occurred(b) - occurred(a))[0];
  const exceptions = records(state, 'alerts').filter(
    (item) =>
      item.status !== 'Resolved' &&
      ['Wrong location', 'Wrong product', 'Unauthorized movement', 'Trolley missing'].includes(
        item.type,
      ),
  ).length;
  const movementActions = canMove(state)
    ? '<button class="btn" data-page="movement">Record movement</button>'
    : '';
  const scanAction =
    state.user?.role === 'Plant Manager'
      ? ''
      : `<button class="btn p" data-page="scan">${icon('scan')}Scan trolley</button>`;
  return `${pageTitle('Know what moved, where it is, and when its location changed.', 'One live view of every trolley across the plant. Identify. Locate. Track. Notify. Trace.', `${scanAction}${movementActions}`)}${workflow()}
    ${!records(state, 'locations').length ? '<div class="warn amber"><div><h4>Set up your plant</h4><p>Add locations, products and trolleys in Settings to begin tracking real movements.</p><button class="btn sm" data-page="settings">Open settings</button></div></div>' : ''}
    <div class="kpis">${metrics.map(([label, count, symbol, tint, status, name, foot]) => `<button class="kpi${status === 'Overdue' && count ? ' alert' : ''}" style="--c:${tint}" data-action="dashboard-focus" data-target="${esc(status || name || 'total')}" data-status="${esc(status)}" data-group="${esc(name)}"><div class="t"><span>${label}</span><span class="ib">${icon(symbol)}</span></div><div class="v">${count}</div><div class="bar"><i style="width:${fleet.length ? (count / fleet.length) * 100 : 0}%"></i></div><div class="f">${foot}</div></button>`).join('')}</div>
    <section class="card mt"><div class="ch"><h3>Plant trolley movement overview</h3><span class="small muted">Arrows show recorded moves in the last 24 hours</span></div><div class="flow">${flow}</div><div class="side-nodes">${groups
      .filter((name) => !chain.includes(name) && name !== 'Other')
      .map(node)
      .join('')}</div></section>
    <div class="grid g21 mt"><section class="card"><div class="ch"><h3>Operations questions, answered</h3></div><div class="cb"><dl class="kv"><dt>Where is every trolley?</dt><dd><b>${fleet.length}</b> trolleys across ${records(state, 'locations').length} locations. <button class="tid" data-page="live">Open live tracking</button> or <button class="tid" data-page="locations">the plant map</button>.</dd><dt>Busiest location</dt><dd>${busiest ? `<b>${esc(busiest[0])}</b> · ${busiest[1]} arrivals in 24 hours` : 'No recorded arrivals in the last 24 hours'}</dd><dt>Outside the plant</dt><dd><b>${outside.length}</b> ${outside
      .slice(0, 6)
      .map((item) => tid(item.id))
      .join(' ')}</dd><dt>Overdue</dt><dd><b>${overdue.length}</b> ${overdue
      .slice(0, 6)
      .map((item) => tid(item.id))
      .join(
        ' ',
      )}</dd><dt>Last movement</dt><dd>${last ? `${tid(last.trolley)} · ${ago(occurred(last))} · ${esc(lname(state, last.source))} → ${esc(lname(state, last.destination))}` : 'No movement recorded yet'}</dd><dt>Longest at one location</dt><dd>${longest ? `${tid(longest.id)} at ${esc(lname(state, longest.location))} for <b>${duration(Date.now() - since(longest))}</b>` : 'No loaded trolleys'}</dd><dt>Abnormal movements</dt><dd><b>${exceptions}</b> open exceptions · <b>${approvals}</b> pending approvals. <button class="tid" data-page="approvals">Review</button></dd><dt>What is inside each trolley?</dt><dd>Product, batch and quantity stay linked to each trolley. <button class="tid" data-page="products">See materials</button></dd></dl></div></section>
    <section class="card"><div class="ch"><h3>Needs attention</h3><button class="btn sm" data-page="alerts">All alerts</button></div><div class="cb">${urgent.length ? urgent.map((alert) => `<div style="padding:9px 0;border-bottom:1px solid var(--line2)"><div class="acts"><span class="bd p-${esc(alert.priority.toLowerCase())}">${esc(alert.priority)}</span><span class="small muted">${ago(alert.created || alert.ts)}</span></div><div style="margin-top:5px"><b>${esc(alert.type)}</b> · ${tid(alert.trolley)}</div><div class="small muted">${esc(alert.message || alert.msg)}</div></div>`).join('') : empty('No urgent alerts', 'Critical and high alerts appear here.')}${approvals ? `<div class="warn amber mt"><div><b>${approvals} movements waiting for approval</b><p><button class="tid" data-page="approvals">Open approvals</button></p></div></div>` : ''}</div></section></div>
    <section class="card mt"><div class="ch"><h3>Latest trolley movements</h3><button class="btn sm" data-page="live">View all</button></div>${fleetTable(state, recent)}</section>`;
}

function liveView(state, ui) {
  const filter = ui.live || {};
  const q = String(filter.q || '')
    .trim()
    .toLowerCase();
  const list = records(state, 'trolleys')
    .filter(active)
    .filter(
      (trolley) =>
        (!filter.status || effective(state, trolley) === filter.status) &&
        (!(filter.location || filter.loc) ||
          trolley.location === (filter.location || filter.loc)) &&
        (!(filter.group || filter.grp) ||
          group(state, trolley.location) === (filter.group || filter.grp)) &&
        (!filter.type || trolley.type === filter.type) &&
        (!q ||
          [
            trolley.id,
            trolley.type,
            trolley.qr,
            trolley.rfid,
            trolley.batch,
            lname(state, trolley.location),
            pname(state, trolley.product),
            operator(state, trolley),
          ]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    )
    .sort((a, b) => moved(b) - moved(a));
  const page = paging(list, filter, 'live', filter.view === 'cards' ? 24 : 20);
  const view = filter.view === 'cards' ? 'cards' : 'table';
  return `${pageTitle('Trolley fleet', 'Every trolley, where it is now, where it came from and what it carries.', `${button('Cards', 'fleet-view', 'data-view="cards"', view === 'cards')}${button('Table', 'fleet-view', 'data-view="table"', view === 'table')}`)}${workflow([1])}<section class="card"><div class="tools">${input('live', 'q', filter.q, 'Search by ID, product, operator or location')}${select('live', 'status', filter.status, STATUSES, 'All statuses')}${select('live', 'location', filter.location || filter.loc, records(state, 'locations'), 'All locations')}${select('live', 'group', filter.group || filter.grp, distinct(records(state, 'locations').map((item) => group(state, item.id))), 'All groups')}${select('live', 'type', filter.type, distinct(records(state, 'trolleys').map((item) => item.type)), 'All types')}${button('Clear filters', 'clear-filters', 'data-target="live"')}</div><div class="${view === 'table' ? 'fleet-table' : ''}"${view === 'table' ? ' data-fleet-view="table"' : ''}>${view === 'cards' ? fleetCards(state, page.items) : fleetTable(state, page.items)}</div>${view === 'table' ? `<div class="fleet-mobile">${fleetCards(state, page.items)}</div>` : ''}${page.footer}</section>`;
}

function overdueView(state) {
  const now = Date.now();
  const list = records(state, 'trolleys')
    .filter((item) => active(item) && effective(state, item) === 'Overdue')
    .sort((a, b) => expected(state, a) - expected(state, b));
  const soon = records(state, 'trolleys')
    .filter(
      (item) =>
        active(item) &&
        ['In Use', 'Waiting', 'Outside Plant', 'In Transit'].includes(item.status) &&
        expected(state, item) > now &&
        expected(state, item) - now <= 1800000,
    )
    .sort((a, b) => expected(state, a) - expected(state, b));
  const warning = list.length
    ? `<div class="warn">${icon('clock')}<div><h4>${list.length} ${list.length === 1 ? 'trolley is' : 'trolleys are'} overdue</h4><p>Longest delay: ${tid(list[0].id)} at ${esc(lname(state, list[0].location))}, late by <b>${duration(now - expected(state, list[0]))}</b>.</p></div></div>`
    : `<div class="warn amber" style="border-color:var(--c-avail)">${icon('check')}<div><h4>No overdue trolleys</h4><p>Every trolley is inside its expected return window.</p></div></div>`;
  const rows = list.map((trolley) => {
    const delay = now - expected(state, trolley);
    return `<tr class="late"><td>${tid(trolley.id)}</td><td><b>${esc(lname(state, trolley.location))}</b><div class="small muted mono">${esc(trolley.location)}</div></td><td class="nowrap">${tm(expected(state, trolley))}<div class="small muted">${dt(expected(state, trolley))}</div></td><td>${duration(now - since(trolley))}</td><td>${esc(trolley.department || location(state, trolley.location)?.department || '—')}</td><td>${esc(operator(state, trolley))}</td><td class="nowrap" style="color:var(--c-over);font-weight:600">${duration(delay)}</td><td>${badge('Overdue')}${delay > 7200000 ? '<div class="small" style="color:var(--c-over)">Escalated</div>' : ''}</td><td><div class="acts">${button('Send reminder', 'overdue-remind', `data-id="${esc(trolley.id)}"`)}${canMove(state) ? button('Mark returned', 'overdue-return', `data-id="${esc(trolley.id)}"`, true) : ''}</div></td></tr>`;
  });
  return `${pageTitle('Overdue trolleys', 'Trolleys held past their expected return time, with delays and responsible people.')}${warning}<section class="card mt"><div class="ch"><h3>Overdue now</h3></div>${table(['Trolley ID', 'Current location', 'Expected return', 'Actual duration', 'Responsible department', 'Assigned person', 'Delay', 'Status', 'Actions'], rows, 'Nothing overdue', 'Trolleys that pass their expected return time will appear here.')}</section><section class="card mt"><div class="ch"><h3>Due back in the next 30 minutes</h3></div>${table(
    ['Trolley ID', 'Location', 'Expected return', 'Time left', 'Assigned person'],
    soon.map(
      (item) =>
        `<tr><td>${tid(item.id)}</td><td>${esc(lname(state, item.location))}</td><td>${tm(expected(state, item))}</td><td>${duration(expected(state, item) - now)}</td><td>${esc(operator(state, item))}</td></tr>`,
    ),
    'No trolleys at risk',
    'Nothing is due back in the next half hour.',
  )}</section>`;
}

function locationsView(state, ui) {
  const all = records(state, 'locations');
  const selected =
    (ui.locations || ui.loc || {}).id ||
    (ui.locations || ui.loc || {}).selected ||
    (ui.locations || ui.loc || {}).sel ||
    all[0]?.id;
  const internal = all.filter((item) => !item.external);
  const external = all.filter((item) => item.external);
  const mapped = internal.length > 0 && internal.every((item) => AREAS[item.id]);
  const listFor = (id) =>
    records(state, 'trolleys').filter((item) => active(item) && item.location === id);
  const room = (item) => {
    const list = listFor(item.id);
    const capacity = number(item.capacity);
    const pct = capacity ? Math.round((list.length / capacity) * 100) : 0;
    const tint =
      capacity && pct >= 85
        ? 'var(--c-over)'
        : capacity && pct >= 60
          ? 'var(--c-wait)'
          : 'var(--c-avail)';
    return `<button class="room${selected === item.id ? ' sel' : ''}" style="--rc:${tint};${mapped && !item.external ? `grid-area:${AREAS[item.id]};` : ''}" data-action="location-detail" data-id="${esc(item.id)}" aria-pressed="${selected === item.id}" aria-label="${esc(item.name)}, ${list.length} trolleys"><div class="code">${esc(item.id)}</div><b>${esc(item.name)}</b><div class="ct"><span><strong>${list.length}</strong> trolleys</span><span><strong>${list.reduce((sum, trolley) => sum + number(trolley.qty), 0)}</strong> units</span></div><div class="dots">${list.map((trolley) => `<i class="dot" title="${esc(trolley.id)} · ${esc(effective(state, trolley))}" style="--c:${color(effective(state, trolley))}"></i>`).join('')}</div><div class="small muted" style="margin-top:6px">${capacity ? `${pct}% of ${capacity} trolley bays` : 'Capacity not configured'}</div></button>`;
  };
  const selectedLocation = all.find((item) => item.id === selected);
  const selectedList = listFor(selected).sort((a, b) => moved(b) - moved(a));
  return `${pageTitle('Plant location tracking', 'Each room shows its current trolleys and occupancy. Select a location to see details.')}${workflow([1])}${
    all.length
      ? `<section class="card"><div class="cb"><div class="plant"${mapped ? '' : ' style="grid-template-areas:none"'}>${internal.map(room).join('')}</div>${external.length ? `<div class="small muted" style="margin:12px 0 4px">Beyond the plant gate</div><div class="outside">${external.map(room).join('')}</div>` : ''}<div class="legend">${STATUSES.map((status) => `<span><i style="--c:${color(status)}"></i>${status}</span>`).join('')}</div></div></section><section class="card mt" id="location-detail"><div class="ch"><h3>${esc(selectedLocation?.name || 'Select a location')} <span class="small muted mono">${esc(selected || '')}</span></h3><span class="small muted">${selectedList.length} trolleys · ${selectedList.reduce((sum, item) => sum + number(item.qty), 0)} units</span></div>${table(
          [
            'Trolley ID',
            'Type',
            'Product / material',
            'Quantity',
            'Status',
            'Here for',
            'Last operator',
          ],
          selectedList.map(
            (trolley) =>
              `<tr${effective(state, trolley) === 'Overdue' ? ' class="late"' : ''}><td>${tid(trolley.id)}</td><td>${esc(trolley.type)}</td><td>${esc(pname(state, trolley.product))}</td><td>${esc(trolley.qty || '—')} ${esc(trolley.qty ? trolley.unit : '')}</td><td>${badge(effective(state, trolley))}</td><td>${duration(Date.now() - since(trolley))}</td><td>${esc(operator(state, trolley))}</td></tr>`,
          ),
          'No trolleys here',
          'This location is empty at the moment.',
        )}</section>`
      : `<section class="card">${empty('No locations registered', 'Add your plant locations in Settings.')}</section>`
  }`;
}

function historyView(state, ui) {
  const filter = ui.history || ui.hist || {};
  const history = state.historyPage || { items: records(state, 'movements'), nextCursor: null };
  const list = history.items || [];
  const movementTypes = distinct([
    ...MOVEMENT_TYPES,
    ...records(state, 'movements').map((item) => item.movement_type),
  ]);
  const actions = ['xlsx', 'pdf', 'csv']
    .map((format) =>
      button(
        `Export ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}`,
        'history-export',
        `data-format="${format}"`,
      ),
    )
    .join('');
  const fields = `<div class="fld"><label>From date</label>${input('history', 'from', filter.from, 'From date', 'date')}</div><div class="fld"><label>To date</label>${input('history', 'to', filter.to, 'To date', 'date')}</div><div class="fld"><label>Trolley ID</label>${input('history', 'trolley', filter.trolley, 'Trolley ID')}</div><div class="fld"><label>Location</label>${select('history', 'location', filter.location || filter.loc, records(state, 'locations'), 'Any location')}</div><div class="fld"><label>Operator</label>${select('history', 'operator', filter.operator, records(state, 'people'), 'Any operator')}</div><div class="fld"><label>Product</label>${select('history', 'product', filter.product, records(state, 'products'), 'Any product')}</div><div class="fld"><label>Movement type</label>${select('history', 'type', filter.type, movementTypes, 'Any movement type')}</div><div class="fld"><label>Status</label>${select(
    'history',
    'status',
    filter.status,
    [
      { id: 'Received', name: 'Completed' },
      { id: 'In Transit', name: 'In Transit' },
      { id: 'Pending', name: 'Pending Approval' },
      { id: 'Rejected', name: 'Rejected' },
      { id: 'Correction Requested', name: 'Correction Requested' },
    ],
    'Any status',
  )}</div>`;
  return `${pageTitle('Trolley movement history', 'Every move, who did it, what it carried and where it went. History is retained.', actions)}${workflow([5])}<section class="card"><form data-form="history-filter"><div class="tools">${input('history', 'q', filter.q, 'Search trolley, location, product or operator')}<button class="btn p" type="submit">${icon('search')}Search</button>${button('Filters', 'history-filters', `aria-expanded="${filter.filters !== false}"`)}${button('Reset', 'clear-filters', 'data-target="history"')}</div><div class="tools"${filter.filters === false ? ' hidden' : ''}>${fields}</div></form>${table(
    [
      'Date',
      'Time',
      'Trolley ID',
      'From location',
      'To location',
      'Product / material',
      'Quantity',
      'Operator',
      'Movement type',
      'Status',
      'Reason / remarks',
    ],
    list.map(
      (item) =>
        `<tr><td class="nowrap">${dt(occurred(item))}</td><td class="nowrap">${tm(occurred(item))}</td><td>${tid(item.trolley)}</td><td>${esc(lname(state, item.source))}</td><td>${esc(lname(state, item.destination))}</td><td>${esc(pname(state, item.product))}<div class="small muted">${esc(item.batch)}</div></td><td>${esc(item.qty)}</td><td>${esc(item.operator_name || item.requester || person(state, item.operator_id || item.requested_by))}</td><td>${esc(item.movement_type || 'Transfer')}</td><td>${badge(movementStatus(item))}</td><td>${esc(item.reason || '')}${item.remarks ? `<div class="small muted">${esc(item.remarks)}</div>` : ''}</td></tr>`,
    ),
    'No movements match',
    'Widen the date range or clear a filter.',
  )}<div class="pager"><span>${list.length} records on this page${history.total !== undefined ? ` · ${number(history.total)} matching records` : ''}</span><div class="acts"><button class="btn sm" data-action="history-prev"${!(filter.stack?.length || filter.cursors?.length || filter.page > 1) ? ' disabled' : ''}>Previous</button><span>Page ${filter.stack ? filter.stack.length + 1 : number(filter.page) || 1}</span><button class="btn sm" data-action="history-next"${!history.nextCursor ? ' disabled' : ''} data-cursor="${esc(history.nextCursor || '')}">Next</button></div></div></section>`;
}

function reportsView(state, ui) {
  const selected = ui.reports?.type || '';
  const report = state.report;
  const preview = report
    ? `<section class="card mt" id="report-preview"><div class="ch"><h3>${esc(report.title || 'Report preview')}</h3><span class="small muted">${report.total ?? report.rows?.length ?? 0} matching rows · generated ${dateTime(report.generatedAt || report.generated || Date.now())}</span></div>${table(
        report.columns || report.cols || [],
        (report.rows || [])
          .slice(0, 150)
          .map((row) => `<tr>${row.map((value) => `<td>${esc(value)}</td>`).join('')}</tr>`),
        'No rows',
        'Nothing to report for this period yet.',
      )}${(report.total || 0) > (report.rows?.length || 0) || report.rows?.length > 150 ? '<div class="cb small muted">Preview shows the first page. Downloads include the full report.</div>' : ''}</section>`
    : '';
  return `${pageTitle('Reports & analytics', 'Management reports from your saved operational data. Preview or download as Excel, PDF or CSV.', '<button class="btn" data-page="analytics">Open analytics</button>')}${workflow([6])}<div class="grid g3" style="grid-template-columns:repeat(auto-fill,minmax(270px,1fr))">${REPORTS.map(([type, title, description]) => `<section class="card${selected === type ? ' selected' : ''}"><div class="rep"><div class="ib">${icon('file')}</div><h3>${title}</h3><p>${description}</p><div class="acts">${button('View report', 'report-select', `data-type="${type}"`, true)}${button('Excel', 'export-report', `data-type="${type}" data-format="xlsx"`)}${button('PDF', 'export-report', `data-type="${type}" data-format="pdf"`)}${button('CSV', 'export-report', `data-type="${type}" data-format="csv"`)}</div></div></section>`).join('')}</div>${preview}`;
}

function normalizeSeries(value, labelKeys = [], valueKeys = []) {
  if (!value) return [];
  if (value.labels && (value.values || value.data))
    return value.labels.map((label, index) => ({
      label: String(label),
      value: number((value.values || value.data)[index]),
    }));
  if (Array.isArray(value))
    return value.map((item) =>
      typeof item === 'object'
        ? {
            label: String(
              item.label ??
                labelKeys.map((key) => item[key]).find((label) => label !== undefined) ??
                item.name ??
                item.id ??
                '',
            ),
            value: number(
              item.value ??
                valueKeys.map((key) => item[key]).find((count) => count !== undefined) ??
                item.count,
            ),
          }
        : { label: '', value: number(item) },
    );
  return Object.entries(value)
    .filter(([, count]) => typeof count === 'number')
    .map(([label, count]) => ({ label, value: count }));
}

function chartTable(series, unit = '') {
  return `<details class="small"><summary>View chart data</summary>${table(
    ['Category', unit || 'Count'],
    series.map(
      (point) =>
        `<tr><td>${esc(point.label)}</td><td>${esc(Number(point.value.toFixed(2)))}</td></tr>`,
    ),
  )}</details>`;
}

function barChart(series, title, tint = 'var(--accent)', unit = '') {
  if (!series.length) return empty('No data yet', 'Record movements to populate this chart.');
  const max = Math.max(1, ...series.map((point) => point.value));
  const height = Math.max(220, series.length * 30 + 30);
  return `<div class="chartbox" style="height:auto;min-height:270px;overflow:auto"><svg viewBox="0 0 620 ${height}" role="img" aria-label="${esc(title)}" style="width:100%;min-width:320px;display:block"><title>${esc(title)}</title>${series.map((point, index) => `<g><title>${esc(point.label)}: ${esc(Number(point.value.toFixed(2)))} ${esc(unit)}</title><text x="162" y="${index * 30 + 30}" text-anchor="end" fill="var(--ink2)" font-size="12">${esc(point.label.length > 23 ? `${point.label.slice(0, 21)}…` : point.label)}</text><rect x="175" y="${index * 30 + 16}" width="${(point.value / max) * 370}" height="19" rx="4" fill="${tint}"/><text x="${Math.min(575, 182 + (point.value / max) * 370)}" y="${index * 30 + 30}" fill="var(--ink2)" font-size="12">${esc(Number(point.value.toFixed(2)))}</text></g>`).join('')}</svg></div>${chartTable(series, unit)}`;
}

function lineChart(series, title, tint = 'var(--accent)', unit = '') {
  if (!series.length) return empty('No data yet', 'The chart will use your recorded movements.');
  const max = Math.max(1, ...series.map((point) => point.value));
  const x = (index) => 45 + (series.length === 1 ? 260 : (index / (series.length - 1)) * 520);
  const y = (value) => 220 - (value / max) * 180;
  const path = series
    .map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point.value)}`)
    .join(' ');
  const interval = Math.max(1, Math.ceil(series.length / 6));
  return `<div class="chartbox"><svg viewBox="0 0 620 270" role="img" aria-label="${esc(title)}" style="width:100%;height:100%"><title>${esc(title)}</title>${[0, 1, 2, 3, 4].map((tick) => `<line x1="45" x2="580" y1="${220 - tick * 45}" y2="${220 - tick * 45}" stroke="var(--line2)"/><text x="38" y="${224 - tick * 45}" text-anchor="end" fill="var(--mute)" font-size="11">${Number(((max * tick) / 4).toFixed(1))}</text>`).join('')}<path d="${path} L${x(series.length - 1)},220 L${x(0)},220 Z" fill="${tint}" opacity=".08"/><path d="${path}" fill="none" stroke="${tint}" stroke-width="2.5"/>${series.map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="3.5" fill="${tint}"><title>${esc(point.label)}: ${esc(Number(point.value.toFixed(2)))} ${esc(unit)}</title></circle>${index % interval === 0 || index === series.length - 1 ? `<text x="${x(index)}" y="245" text-anchor="middle" fill="var(--ink2)" font-size="11">${esc(point.label.length > 12 ? point.label.slice(-10) : point.label)}</text>` : ''}`).join('')}</svg></div>${chartTable(series, unit)}`;
}

function donutChart(series, title) {
  const sum = series.reduce((total, point) => total + point.value, 0);
  if (!sum)
    return empty('No active trolleys', 'Register trolleys to see the live utilization split.');
  const colors = [
    'var(--c-avail)',
    'var(--c-use)',
    'var(--c-transit)',
    'var(--c-wait)',
    'var(--c-maint)',
    'var(--c-over)',
    'var(--c-out)',
    'var(--c-off)',
  ];
  let offset = 0;
  const rings = series
    .map((point, index) => {
      const fraction = (point.value / sum) * 100;
      const ring = `<circle cx="150" cy="130" r="90" pathLength="100" fill="none" stroke="${color(point.label) === 'var(--c-off)' ? colors[index % colors.length] : color(point.label)}" stroke-width="32" stroke-dasharray="${fraction} ${100 - fraction}" stroke-dashoffset="${-offset}" transform="rotate(-90 150 130)"><title>${esc(point.label)}: ${point.value}</title></circle>`;
      offset += fraction;
      return ring;
    })
    .join('');
  return `<div class="chartbox"><svg viewBox="0 0 620 270" role="img" aria-label="${esc(title)}" style="width:100%;height:100%"><title>${esc(title)}</title>${rings}<text x="150" y="129" text-anchor="middle" fill="var(--ink)" font-size="30" font-weight="600">${sum}</text><text x="150" y="151" text-anchor="middle" fill="var(--mute)" font-size="12">active trolleys</text>${series.map((point, index) => `<rect x="295" y="${26 + index * 29}" width="10" height="10" rx="2" fill="${color(point.label) === 'var(--c-off)' ? colors[index % colors.length] : color(point.label)}"/><text x="315" y="${36 + index * 29}" fill="var(--ink2)" font-size="13">${esc(point.label)}: ${point.value}</text>`).join('')}</svg></div>${chartTable(series)}`;
}

function analyticsView(state, ui) {
  const analytics = state.analytics || {};
  const data = analytics.charts || analytics;
  const fleet = records(state, 'trolleys').filter(active);
  const utilization = normalizeSeries(
    data.utilization ||
      STATUSES.map((status) => ({
        label: status,
        value: fleet.filter((item) => effective(state, item) === status).length,
      })),
    ['status'],
    ['count', 'total'],
  );
  const arrivals = normalizeSeries(
    data.locationMovements || data.movementByLocation || data.movement_by_location || data.arrivals,
    ['location_name', 'name', 'location'],
    ['count', 'arrivals'],
  );
  const daily = normalizeSeries(
    data.dailyMovements || data.dailyMovement || data.daily_movement || data.daily,
    ['day', 'date'],
    ['count', 'movements'],
  );
  const usage = normalizeSeries(
    data.topUsage || data.top_usage || data.topTrolleys,
    ['trolley', 'id'],
    ['uses', 'count'],
  );
  const turnaround = normalizeSeries(
    data.turnaround || data.turnaroundTime || data.turnaround_time,
    ['day', 'date'],
    ['hours', 'average_hours', 'mean_hours'],
  );
  const mode = ui.analytics?.over || ui.analytics?.period || ui.an?.over || 'day';
  const overdueValue =
    mode === 'week'
      ? data.overdueWeekly || data.overdue_weekly || data.overdueTrend?.weekly
      : data.overdueDaily || data.overdue_daily || data.overdueTrend?.daily;
  const overdue = normalizeSeries(
    overdueValue || data.overdueTrend || data.overdue_trend,
    ['day', 'week', 'date'],
    ['count', 'overdue'],
  );
  const distribution = normalizeSeries(
    data.locationDistribution ||
      data.location_distribution ||
      records(state, 'locations').map((item) => ({
        label: item.name,
        value: fleet.filter((trolley) => trolley.location === item.id).length,
      })),
    ['location_name', 'name', 'location'],
    ['count', 'trolleys'],
  );
  const chart = (title, subtitle, content, full = false) =>
    `<section class="card"${full ? ' style="grid-column:1/-1"' : ''}><div class="ch"><h3>${title}</h3><span class="small muted">${subtitle}</span></div><div class="cb">${content}</div></section>`;
  const toggle = `<span class="acts">${button('Daily', 'analytics-period', 'data-period="day"', mode === 'day')}${button('Weekly', 'analytics-period', 'data-period="week"', mode === 'week')}</span>`;
  return `${pageTitle('Analytics', 'Fleet counts and historical trends calculated from saved trolley and movement records. No simulated values.')}${workflow([6])}<div class="grid g2">${chart('Trolley utilization', 'Live fleet split', donutChart(utilization, 'Trolley utilization'))}${chart('Movement by location', 'Arrivals in the last 24 hours', barChart(arrivals, 'Movement by location'))}${chart('Daily movement trend', 'Recorded movements per day', lineChart(daily, 'Daily movement trend'))}${chart('Top trolley usage', 'Most frequently used', barChart(usage, 'Top trolley usage', 'var(--c-transit)'))}${chart('Average turnaround time', 'Completed production issue / return cycles, in hours', lineChart(turnaround, 'Average turnaround time', 'var(--c-wait)', 'Hours'))}<section class="card"><div class="ch"><h3>Overdue trolley trend</h3>${toggle}</div><div class="cb">${lineChart(overdue, 'Overdue trolley trend', 'var(--c-over)')}${data.overdueTrend?.limitation ? `<p class="small muted">${esc(data.overdueTrend.limitation)}</p>` : ''}</div></section>${chart('Location-wise trolley distribution', 'Trolleys present right now', barChart(distribution, 'Location-wise trolley distribution'), true)}</div>`;
}

export function monitoringView(page, state, ui = {}) {
  const views = {
    dashboard: dashboardView,
    live: liveView,
    fleet: liveView,
    overdue: overdueView,
    locations: locationsView,
    history: historyView,
    reports: reportsView,
    analytics: analyticsView,
  };
  return views[page] ? views[page](state, ui) : '';
}
