import {
  TROLLEY_TYPES,
  STATUSES,
  MOVEMENT_TYPES,
  ROLES,
  ISSUE_TYPES,
  esc,
  array,
  locationName,
  productName,
  personName,
  effectiveStatus,
  fmt,
  duration,
  ago,
  localTime,
  options,
  field,
  select,
  textarea,
  error,
  empty,
  table,
  badge,
  priority,
  button,
  trolleyLink,
  title,
  manager,
  canMove,
  unique,
  flagsOf,
  flagChips,
  paginate,
  filterInput,
  filterSelect,
} from './operations-model.js';

const trolleys = (state) => state.trolleys || [];
const activeTrolleys = (state) =>
  trolleys(state).filter((item) => item.active !== 0 && item.active !== false);
const findTrolley = (state, id) => trolleys(state).find((item) => item.id === id);
const allMovements = (state) => state.allMovements || state.movements || [];
const people = (state) => state.people || state.accounts || [state.user];
const qrUrl = (id) => `/api/trolleys/${encodeURIComponent(id)}/label`;
const closeButton = () => button('Close', 'close-modal');
const form = (kind, contents, label, id = kind) =>
  `<form id="${id}" data-form="${kind}">${contents}${error}<div class="acts"><button class="btn p" type="submit">${label}</button></div></form>`;
const tagChips = (trolley) =>
  `<span class="chip ${trolley.tag_health === 'QR unreadable' ? 'r' : 'g'}">QR ${trolley.tag_health === 'QR unreadable' ? 'unreadable' : 'OK'}</span> <span class="chip ${trolley.tag_health === 'RFID signal weak' ? 'w' : 'g'}">RFID ${!trolley.rfid ? 'unassigned' : trolley.tag_health === 'RFID signal weak' ? 'weak' : 'OK'}</span>`;
const approvalStatus = (item) => item.status || item.state || 'Pending';
const approvalKind = (item) =>
  item.type || item.kind || (item.requires_quality ? 'Quality release' : 'Movement approval');

function masterView(state, ui) {
  const f = ui.master || {};
  const q = (f.q || '').toLowerCase().trim();
  const list = trolleys(state).filter(
    (item) =>
      (!f.type || item.type === f.type) &&
      (!f.status || effectiveStatus(item) === f.status) &&
      (!f.department || item.department === f.department) &&
      (!q ||
        [item.id, item.qr, item.rfid, item.type, item.assigned_area]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  );
  const paged = paginate(list, f.page, 'master');
  const first = trolleys(state)[0];
  const actions =
    state.user.role === 'Admin'
      ? button('Add trolley', 'add-trolley', '', '', 'p') +
        button('Add location', 'add-location') +
        button('Add product', 'add-product')
      : '';
  return `${title('Trolley master', 'Every trolley has one permanent identity, QR label and RFID tag.', actions)}
    <section class="card id-banner">${first ? `<div class="tag" style="border:0;padding:0"><div class="qrbox"><img src="${qrUrl(first.id)}" alt="QR label for ${esc(first.id)}" width="84" height="84"></div><div><div class="big">${esc(first.id)}</div><div class="small muted mono">${esc(first.qr || first.id)}<br>${esc(first.rfid || 'RFID not assigned')}</div></div></div>` : ''}<div style="flex:1"><h3>One trolley, one identity</h3><p class="muted">IDs and history stay on record after deactivation. Register your plant locations and products before adding a trolley.</p></div><div><div class="big">${trolleys(state).length}</div><span class="small muted">unique IDs · ${activeTrolleys(state).length} active</span></div></section>
    <section class="card mt"><div class="tools">${filterInput('master', 'q', f.q || '', 'Search by trolley ID, QR or RFID number')}${filterSelect('master', 'type', unique([...TROLLEY_TYPES, ...trolleys(state).map((item) => item.type)]), f.type, 'All types')}${filterSelect('master', 'status', STATUSES, f.status, 'All statuses')}${filterSelect('master', 'department', unique(trolleys(state).map((item) => item.department)), f.department, 'All departments')}</div>
    ${table(
      [
        'Trolley ID',
        'QR code',
        'RFID number',
        'Type',
        'Capacity',
        'Material type',
        'Department',
        'Current location',
        'Status',
        'Assigned area',
        'Created',
        'Last movement',
        'Actions',
      ],
      paged.items.map(
        (item) =>
          `<tr ${effectiveStatus(item) === 'Inactive' ? 'style="opacity:.6"' : ''}><td>${trolleyLink(item.id)}</td><td class="mono small">${esc(item.qr || item.id)}</td><td class="mono small">${esc(item.rfid || '—')}</td><td>${esc(item.type)}</td><td>${item.capacity} ${esc(item.unit)}</td><td>${esc(item.material_type || '—')}</td><td>${esc(item.department || '—')}</td><td>${esc(locationName(state, item.location))}</td><td>${badge(effectiveStatus(item))}</td><td>${esc(locationName(state, item.assigned_area))}</td><td class="nowrap">${fmt(item.created, true)}</td><td class="nowrap">${fmt(item.last_moved)}<div class="small muted">${ago(item.last_moved)}</div></td><td><div class="acts">${button('Generate QR', 'qr-label', item.id, '', 'sm')}${button('View details', 'open-trolley', item.id, '', 'sm')}${state.user.role === 'Admin' ? button('Edit', 'edit-trolley', item.id, '', 'sm') + button(effectiveStatus(item) === 'Inactive' ? 'Activate' : 'Deactivate', 'toggle-trolley', item.id, '', 'sm') : ''}</div></td></tr>`,
      ),
      'No trolleys match',
      'Adjust the filters or add a trolley.',
    )}${paged.footer}</section>`;
}

function scanResult(state, ui) {
  const result = ui.scan?.result || ui.scan?.res;
  if (!result)
    return empty('Waiting for a scan', 'Scan a trolley QR label, RFID tag or enter its ID.');
  const item = findTrolley(state, result.id || result.trolley);
  if (!item)
    return `<div class="cb"><div class="warn"><div><h4>Trolley not found</h4><p>${esc(result.error || result.code || 'No registered trolley matches this value.')}</p></div></div></div>`;
  return `<div class="res"><div class="cb"><div class="small muted">Identified by ${esc(result.source || result.src || 'manual entry')}</div><div class="ph"><div class="big">${esc(item.id)}</div>${badge(effectiveStatus(item))}</div><dl class="kv"><dt>Current location</dt><dd><b>${esc(locationName(state, item.location))}</b></dd><dt>Current status</dt><dd>${badge(effectiveStatus(item))}</dd><dt>Assigned material</dt><dd>${esc(productName(state, item.product))}${item.qty ? ` × ${item.qty} ${esc(item.unit)}` : ''}</dd><dt>Batch</dt><dd>${esc(item.batch || '—')}</dd><dt>Last movement</dt><dd>${fmt(item.last_moved)} · ${ago(item.last_moved)}</dd><dt>Last operator</dt><dd>${esc(personName(state, item.operator_id))}</dd><dt>At location for</dt><dd>${duration(Date.now() - (item.since || item.last_moved || Date.now()))}</dd></dl><div class="mt">${flagChips(state, item)} ${tagChips(item)}</div></div><div class="cb bigbtns">${canMove(state) ? button('Move trolley', 'move-trolley', item.id, '', 'p') + button('Receive trolley', 'receive-trolley', item.id) : ''}${button('Report issue', 'report-issue', item.id)}${button('View history', 'open-trolley', item.id)}</div></div>`;
}

function scanView(state, ui) {
  const readers = state.readerData?.readers || state.readers || [];
  const recent = ui.scan?.recent || [];
  return `${title('Scan trolley', 'Identify a trolley by its QR label, RFID tag or permanent ID.')}
    <div class="grid g2"><section class="card"><div class="cb"><div class="vf" id="camera-frame"><video id="scan-video" class="scan-video" autoplay muted playsinline hidden></video><div id="camera-placeholder"><div class="big">QR</div><p>Point the camera at a trolley QR label.</p></div><i class="c a"></i><i class="c b"></i><i class="c c2"></i><i class="c d"></i></div><div class="acts mt">${button('Scan with camera', 'camera-start', '', 'id="start-camera"', 'p')}${button('Stop camera', 'camera-stop', '', 'id="stop-camera" hidden')}</div><p id="scan-status" class="small muted" role="status">Camera frames stay on this device. A scan identifies the trolley without moving it.</p><div class="rfid mt"><div><b>RFID identification</b><div class="small muted">${readers.length ? `${readers.filter((item) => item.active).length} registered readers active. ` : 'No live reader connection has been established. '}Use a connected reader or enter a tag value below.</div></div></div>${form('scan', field('Trolley ID, QR or RFID tag', 'code', '', 'text', 'required autocomplete="off" autofocus placeholder="TR-018"'), 'Identify trolley')}<h4 class="mt">Recent scans</h4>${
      recent.length
        ? recent
            .slice(0, 5)
            .map(
              (item) =>
                `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line2)"><span>${item.id ? trolleyLink(item.id) : esc(item.code)}</span><span class="small muted">${esc(item.source || item.src || 'Manual')} · ${fmt(item.at)}</span></div>`,
            )
            .join('')
        : '<p class="small muted">No scans in this session.</p>'
    }</div></section><section class="card" id="scan-result">${scanResult(state, ui)}</section></div>`;
}

export function movementPreview(state, input = {}) {
  const item = findTrolley(state, String(input.trolley || '').trim());
  if (!item)
    return `<div class="muted">${input.trolley ? 'This trolley is not registered. Check the ID or add it in Trolley Master.' : 'Enter a trolley ID to see its location, load and any exceptions.'}</div>`;
  const warnings = [...flagsOf(state, item)];
  if (item.active === 0) warnings.push('Trolley is inactive');
  if (input.source && input.source !== item.location)
    warnings.push('Source does not match the recorded location');
  if (input.destination && input.destination === item.location)
    warnings.push('Choose a different destination');
  if (Number(input.qty) > item.capacity) warnings.push('Quantity exceeds trolley capacity');
  if (input.product && item.product && input.product !== item.product && Number(input.qty) > 0)
    warnings.push('Wrong product: the trolley currently holds a different product');
  if (Number(input.qty) > 0 && !input.product)
    warnings.push('A loaded trolley needs a product and batch');
  const product = state.products?.find((value) => value.id === input.product);
  if (product && product.unit !== item.unit)
    warnings.push('Product unit does not match trolley capacity unit');
  const destination = state.locations?.find((value) => value.id === input.destination);
  const allowed = array(product?.allowed_groups);
  if (allowed.length && destination && !allowed.includes(destination.group_name))
    warnings.push('Product is not permitted in this destination group');
  return `<div class="big">${esc(item.id)}</div><div class="mt">${badge(effectiveStatus(item))} ${flagChips(state, item)}</div><dl class="kv mt"><dt>Current location</dt><dd>${esc(locationName(state, item.location))}</dd><dt>Current load</dt><dd>${esc(productName(state, item.product))} · ${item.qty} ${esc(item.unit)}</dd><dt>Batch</dt><dd>${esc(item.batch || '—')}</dd><dt>Capacity</dt><dd>${item.capacity} ${esc(item.unit)}</dd><dt>Last moved</dt><dd>${fmt(item.last_moved)}</dd></dl>${
    warnings.length
      ? `<div class="warn mt"><div><h4>Check before moving</h4>${unique(warnings)
          .map((value) => `<p>${esc(value)}</p>`)
          .join(
            '',
          )}<p class="small">Correct the details or provide an exception reason for independent review.</p></div></div>`
      : `<div class="warn amber mt"><div><h4>${destination?.external ? 'Outside plant approval required' : 'Ready for validation'}</h4><p>${destination?.external ? 'The trolley remains at its source until the request is approved.' : 'The server validates the load, route, permissions and current trolley version when you confirm.'}</p></div></div>`
  }`;
}

function movementView(state, ui) {
  const value = ui.movement || {};
  const item = findTrolley(state, value.trolley);
  const recent = allMovements(state).slice(0, 5);
  const transit = (state.activeMovements || allMovements(state)).filter(
    (record) => record.state === 'In Transit',
  );
  if (!canMove(state))
    return (
      title(
        'Record trolley movement',
        'Your role can monitor movements. Operators, supervisors, quality and store users record movements.',
      ) + empty('Movement entry is unavailable for this role')
    );
  const fields = `${field('Trolley ID', 'trolley', value.trolley || '', 'text', 'required list="movement-trolleys" autocomplete="off"')}<datalist id="movement-trolleys">${options(activeTrolleys(state))}</datalist><input type="hidden" name="version" value="${item?.version || ''}">${value.correction_of ? `<input type="hidden" name="correction_of" value="${esc(value.correction_of)}">` : ''}${select('Movement type', 'movement_type', state.user.access?.types || MOVEMENT_TYPES, value.movement_type || 'Transfer')}${select('From location', 'source', state.locations || [], value.source || item?.location, 'Select location', 'required')}${select('Destination', 'destination', state.locations || [], value.destination || '', 'Select location', 'required')}${select('Product / material', 'product', state.products || [], value.product ?? item?.product ?? '', 'Empty trolley')}${field('Batch', 'batch', value.batch ?? item?.batch ?? 'EMPTY', 'text', 'maxlength="120"')}${field('Quantity (capacity units)', 'qty', value.qty ?? item?.qty ?? 0, 'number', 'required min="0" step="any"')}${select('Operator name', 'operator_id', people(state), value.operator_id || state.user.id)}${field('Department', 'department', value.department || item?.department || '')}${field('Movement date and time', 'occurred', (typeof value.occurred === 'number' ? localTime(value.occurred) : value.occurred) || localTime(), 'datetime-local', 'required')}${field('Expected arrival / return', 'expected', (typeof value.expected === 'number' ? localTime(value.expected) : value.expected) || localTime(Date.now() + 4 * 3600000), 'datetime-local', 'required')}${field('Reason', 'reason', value.reason || '', 'text', 'maxlength="500" placeholder="Why is it moving?"')}${select('Status after movement', 'status_after', ['auto', 'Available', 'In Use', 'Waiting', 'Maintenance', 'Outside Plant'], value.status_after || 'auto')}${textarea('Remarks', 'remarks', value.remarks || '', 'maxlength="1000"')}${textarea('Exception reason (only if policy mismatch)', 'exceptionReason', value.exceptionReason || '', 'maxlength="500" placeholder="Explain why an override is needed"')}<label class="check full"><input type="checkbox" name="direct_complete" ${value.direct_complete ? 'checked' : ''}>Record completed arrival immediately; leave unchecked to mark in transit until someone confirms receipt.</label>`;
  return `${title('Record trolley movement', 'Record departure and confirm arrival. Every location change is saved in the history.')}
    <div class="grid g21"><section class="card"><div class="ch"><h3>Movement details</h3></div><div class="cb"><div class="acts mb">${button('Scan with camera', 'camera-start', '', 'id="start-camera"')}${button('Stop camera', 'camera-stop', '', 'id="stop-camera" hidden')}</div><video id="scan-video" class="scan-video" autoplay muted playsinline hidden></video><p id="scan-status" class="small muted" role="status">Scan a trolley label or enter its ID below.</p>${form('movement', `<div class="fgrid">${fields}</div>`, 'Record movement', 'move')}</div></section><div><section class="card"><div class="ch"><h3>Verify before you confirm</h3></div><div class="cb" id="movement-preview">${movementPreview(state, value)}</div></section><section class="card mt"><div class="ch"><h3>Latest movements</h3></div><div class="cb">${recent.length ? recent.map((record) => `<div style="padding:8px 0;border-bottom:1px solid var(--line2)">${trolleyLink(record.trolley)} <span class="small muted">${fmt(record.created)}</span><div>${esc(locationName(state, record.source))} → ${esc(locationName(state, record.destination))}</div><div class="small muted">${esc(record.movement_type || 'Transfer')} · ${esc(record.requester || personName(state, record.operator_id || record.requested_by))}</div></div>`).join('') : empty('No movements recorded')}</div></section></div></div><section class="card mt"><div class="ch"><h3>Confirm arrival</h3></div>${table(
      ['Trolley', 'Route', 'Expected', 'Action'],
      transit.map(
        (record) =>
          `<tr><td>${trolleyLink(record.trolley)}</td><td>${esc(locationName(state, record.source))} → ${esc(locationName(state, record.destination))}</td><td>${fmt(record.expected)}</td><td>${button('Confirm arrival', 'receive-movement', record.id, '', 'p sm')}</td></tr>`,
      ),
      'Nothing to receive',
      'Trolleys in transit appear here until their arrival is confirmed.',
    )}</section>`;
}

function verificationForm(state, ui) {
  if (!['Admin', 'Supervisor', 'Quality User'].includes(state.user.role))
    return empty(
      'Product verification requires a quality user or supervisor',
      'You can inspect material assignments below.',
    );
  return form(
    'verify',
    field(
      'Trolley ID',
      'trolley',
      ui.verify?.trolley || '',
      'text',
      'required list="verify-trolleys"',
    ) +
      `<datalist id="verify-trolleys">${options(activeTrolleys(state))}</datalist>` +
      select(
        'Product scanned',
        'product',
        state.products || [],
        ui.verify?.product || '',
        'Select product',
        'required',
      ) +
      field('Batch scanned (optional)', 'batch', ui.verify?.batch || ''),
    'Verify scan',
  );
}

function productsView(state, ui) {
  const f = ui.products || {};
  const query = (f.q || '').trim().toLowerCase();
  const list = activeTrolleys(state)
    .filter((item) => item.product || flagsOf(state, item).length)
    .filter(
      (item) =>
        (!f.flag ||
          (f.flag === 'any'
            ? flagsOf(state, item).length
            : flagsOf(state, item).includes(f.flag))) &&
        (!query ||
          [
            item.id,
            item.product,
            productName(state, item.product),
            item.batch,
            locationName(state, item.location),
          ]
            .join(' ')
            .toLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) => flagsOf(state, b).length - flagsOf(state, a).length || a.id.localeCompare(b.id),
    );
  const paged = paginate(list, f.page, 'products', 20);
  const result = ui.verification;
  const issues = array(result?.issues);
  const pending = (state.approvals || []).filter(
    (item) => approvalStatus(item) === 'Pending' && /mismatch|product/i.test(approvalKind(item)),
  );
  return `${title('Product & material segregation', 'Every trolley carries one product and batch. Check scans and investigate assignment warnings.')}${pending.map((item) => `<div class="warn mb"><div><h4>Product mismatch awaiting review · ${trolleyLink(item.trolley)}</h4><p>${esc(item.remarks || item.reason || 'A scanned product did not match its trolley assignment.')}</p></div></div>`).join('')}
    <div class="grid g12"><section class="card"><div class="ch"><h3>Verify a scan</h3></div><div class="cb">${verificationForm(state, ui)}${result ? `<div class="warn ${result.ok ? 'amber' : ''} mt"><div><h4>${result.ok ? 'Match confirmed' : 'Product mismatch detected'}</h4>${result.ok ? '<p>The scanned product matches the trolley assignment.</p>' : issues.map((issue) => `<p>${esc(typeof issue === 'string' ? issue : issue.msg || issue.kind)}</p>`).join('')}${!result.ok && result.trolley ? button('Request supervisor approval', 'request-mismatch', result.trolley, '', 'p sm') : ''}</div></div>` : ''}</div></section><section class="card"><div class="ch"><h3>Products in the plant</h3><span class="small muted">${activeTrolleys(state).filter((item) => flagsOf(state, item).length).length} trolleys with warnings</span></div>${table(
      ['Code', 'Product', 'Default batch', 'Trolleys', 'Units', 'Held at'],
      (state.products || []).map((product) => {
        const records = activeTrolleys(state).filter((item) => item.product === product.id);
        return `<tr><td class="mono small">${esc(product.id)}</td><td>${esc(product.name)}</td><td>${esc(product.default_batch || '—')}</td><td>${records.length}</td><td>${records.reduce((sum, item) => sum + Number(item.qty), 0)} ${esc(product.unit)}</td><td>${esc(unique(records.map((item) => locationName(state, item.location))).join(', ') || '—')}</td></tr>`;
      }),
      'No product masters',
      'Add products from Trolley Master or Plant setup.',
    )}</section></div>
    <section class="card mt"><div class="ch"><h3>Trolley assignments</h3></div><div class="tools">${filterInput('products', 'q', f.q || '', 'Search trolley, product or batch')}${filterSelect('products', 'flag', [{ id: 'any', name: 'Any warning' }, ...['Wrong trolley', 'Wrong product', 'Wrong location', 'Mixed batch', 'Unassigned trolley']], f.flag, 'All trolleys')}</div>${table(
      [
        'Product name',
        'Product code',
        'Batch number',
        'Trolley ID',
        'Quantity',
        'Current location',
        'Status',
        'Segregation check',
      ],
      paged.items.map(
        (item) =>
          `<tr class="${flagsOf(state, item).length ? 'late' : ''}"><td>${esc(productName(state, item.product))}</td><td class="mono">${esc(item.product || '—')}</td><td>${esc(item.batch || '—')}</td><td>${trolleyLink(item.id)}</td><td>${item.qty} ${esc(item.unit)}</td><td>${esc(locationName(state, item.location))}</td><td>${badge(effectiveStatus(item))}</td><td>${flagChips(state, item) || '<span class="chip g">Verified</span>'}</td></tr>`,
      ),
      'No assignments match',
      'Change the search or warning filter.',
    )}${paged.footer}</section>`;
}

function alertsView(state, ui) {
  const f = ui.alerts || {};
  const records = state.alerts || [];
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const list = records
    .filter(
      (item) =>
        (!f.status ||
          (f.status === 'Active' ? item.status !== 'Resolved' : item.status === f.status)) &&
        (!f.priority || item.priority === f.priority) &&
        (!f.type || item.type === f.type),
    )
    .sort(
      (a, b) =>
        (a.status === 'Resolved') - (b.status === 'Resolved') ||
        (order[a.priority] ?? 2) - (order[b.priority] ?? 2) ||
        (b.created || b.ts) - (a.created || a.ts),
    );
  const paged = paginate(list, f.page, 'alerts');
  return `${title('Alerts', 'Investigate exceptions, acknowledge ownership and record how they were resolved.')}<section class="card"><div class="sum">${['Critical', 'High', 'Medium', 'Low'].map((value) => `<button type="button" class="${f.priority === value ? 'on' : ''}" data-action="alert-priority" data-priority="${value}"><b>${records.filter((item) => item.status !== 'Resolved' && item.priority === value).length}</b>${priority(value)}</button>`).join('')}<button type="button" data-action="alert-resolved"><b>${records.filter((item) => item.status === 'Resolved').length}</b>Resolved</button></div><div class="tools">${filterSelect('alerts', 'status', ['Active', 'Open', 'Acknowledged', 'Resolved'], f.status, 'All statuses')}${filterSelect('alerts', 'priority', ['Critical', 'High', 'Medium', 'Low'], f.priority, 'All priorities')}${filterSelect('alerts', 'type', unique(records.map((item) => item.type)), f.type, 'All alert types')}</div>${table(
    ['Priority', 'Alert type', 'Trolley ID', 'Location', 'Time', 'Status', 'Actions'],
    paged.items.map(
      (item) =>
        `<tr class="${item.priority === 'Critical' && item.status !== 'Resolved' ? 'late' : ''}" ${item.status === 'Resolved' ? 'style="opacity:.65"' : ''}><td>${priority(item.priority)}</td><td><b>${esc(item.type)}</b><div class="small muted" style="max-width:46ch">${esc(item.message || item.msg || '')}</div></td><td>${trolleyLink(item.trolley)}</td><td>${esc(locationName(state, item.location || item.loc))}</td><td class="nowrap">${fmt(item.created || item.ts)}<div class="small muted">${ago(item.created || item.ts)}</div></td><td>${badge(item.status)}${item.resolved_by || item.acknowledged_by ? `<div class="small muted">by ${esc(personName(state, item.resolved_by || item.acknowledged_by))}</div>` : ''}${item.resolution ? `<div class="small muted">${esc(item.resolution)}</div>` : ''}</td><td><div class="acts">${item.status === 'Open' && ['Admin', 'Plant Manager', 'Supervisor', 'Quality User'].includes(state.user.role) ? button('Acknowledge', 'acknowledge-alert', item.id, '', 'sm') : ''}${button('View trolley', 'open-trolley', item.trolley, '', 'sm')}${item.status !== 'Resolved' && ['Admin', 'Plant Manager', 'Supervisor', 'Quality User'].includes(state.user.role) ? button('Resolve', 'resolve-alert', item.id, '', 'g sm') : ''}</div></td></tr>`,
    ),
    'No alerts match',
    'New operational exceptions will appear here.',
  )}${paged.footer}</section>`;
}

function approvalsView(state, ui) {
  const records = state.approvals || [];
  const f = ui.approvals || {};
  const pending = records.filter((item) => approvalStatus(item) === 'Pending');
  const history = records.filter(
    (item) =>
      approvalStatus(item) !== 'Pending' && (!f.status || approvalStatus(item) === f.status),
  );
  return `${title('Approvals', 'Outside movements and mismatches stay on hold until independently reviewed.')}<div class="cards kpis">${['Pending', 'Approved', 'Rejected', 'Correction Requested'].map((value) => `<div class="card kpi"><div class="t">${esc(value)}</div><div class="v">${records.filter((item) => approvalStatus(item) === value).length}</div></div>`).join('')}</div><h3 class="mt">Pending requests</h3>${
    pending.length
      ? `<div class="grid g2 mt">${pending
          .map((item) => {
            const flags = array(item.policy_flags);
            const external = state.locations.some(
              (location) => location.id === item.destination && location.external,
            );
            const roles = item.requires_quality
              ? flags.length || external
                ? ['Admin']
                : ['Admin', 'Quality User']
              : ['Admin', 'Plant Manager', 'Supervisor'];
            const canDecide =
              roles.includes(state.user.role) &&
              String(item.requested_by) !== String(state.user.id);
            return `<article class="apc"><div class="row"><div>${trolleyLink(item.trolley)} <span class="muted">${esc(approvalKind(item))}</span></div>${badge('Pending')}</div><div class="route">${esc(locationName(state, item.source || item.from))} → ${esc(locationName(state, item.destination || item.to))}</div><div class="small muted">Requested by ${esc(item.requester || personName(state, item.requested_by))} · ${fmt(item.created || item.requested_at)}</div>${item.remarks || item.reason ? `<p>${esc(item.remarks || item.reason)}</p>` : ''}${
              array(item.issues || item.policy_flags).length
                ? `<p>${array(item.issues || item.policy_flags)
                    .map(
                      (value) =>
                        `<span class="chip r">${esc(typeof value === 'string' ? value : value.kind)}</span>`,
                    )
                    .join(' ')}</p>`
                : ''
            }${canDecide ? `<div class="acts mt">${button('Approve', 'decide-approval', item.id, 'data-decision="approve"', 'g')}${button('Reject', 'decide-approval', item.id, 'data-decision="reject"', 'd')}${button('Request correction', 'decide-approval', item.id, 'data-decision="correct"')}</div>` : '<p class="small muted">Another authorized user must review this request.</p>'}</article>`;
          })
          .join('')}</div>`
      : `<section class="card mt">${empty('Nothing waiting', 'New requests appear when approval is needed.')}</section>`
  }<section class="card mt"><div class="ch"><h3>Decision history</h3></div><div class="tools">${filterSelect('approvals', 'status', ['Approved', 'Rejected', 'Correction Requested'], f.status, 'All decisions')}</div>${table(
    ['Trolley', 'Type', 'Decision', 'Requested by', 'Decided by', 'Time', 'Remarks', 'Action'],
    history.map(
      (item) =>
        `<tr><td>${trolleyLink(item.trolley)}</td><td>${esc(approvalKind(item))}</td><td>${badge(approvalStatus(item))}</td><td>${esc(item.requester || personName(state, item.requested_by))}</td><td>${esc(item.decider || personName(state, item.decided_by))}</td><td>${fmt(item.decided_at)}</td><td>${esc(item.decision_reason || item.decision_remarks || item.remarks || '—')}</td><td>${approvalStatus(item) === 'Correction Requested' && (String(item.requested_by) === String(state.user.id) || state.user.role === 'Admin') ? button('Correct and resubmit', 'resubmit-approval', item.id, '', 'sm p') : '—'}</td></tr>`,
    ),
    'No decisions recorded',
  )}</section>`;
}

function usersSettings(state) {
  if (state.user.role !== 'Admin') return empty('Administrator access required');
  return `<div class="grid g2"><section class="card"><div class="ch"><h3>Create user</h3></div><div class="cb">${form('user', field('Username', 'username', '', 'text', 'required autocomplete="off"') + field('Full name', 'name', '', 'text', 'required') + field('Password (12+ characters)', 'password', '', 'password', 'required minlength="12" autocomplete="new-password"') + select('Role', 'role', ROLES, 'Operator'), 'Create user', 'users')}</div></section><section class="card"><div class="ch"><h3>Accounts</h3></div>${table(
    ['User', 'Role', 'Status', 'Action'],
    (state.accounts || people(state)).map(
      (item) =>
        `<tr><td>${esc(item.name)}<div class="small muted">${esc(item.username || '')}</div></td><td>${esc(item.role)}</td><td>${item.active === 0 ? 'Inactive' : 'Active'}</td><td>${item.id !== state.user.id && item.active !== 0 ? button('Deactivate', 'toggle-user', item.id, `data-deactivate="${item.id}"`, 'sm') : item.id === state.user.id ? 'Your account' : '—'}</td></tr>`,
    ),
  )}</section></div>`;
}

function readersSettings(state) {
  const data = state.readerData;
  if (state.user.role !== 'Admin') return empty('Administrator access required');
  if (!data) return empty('Loading reader configuration', 'Open this tab again after refreshing.');
  return `${state.readerSecret ? `<section class="card secret"><h3>Save this credential now</h3><p>${esc(state.readerSecret.id)}</p><code>${esc(state.readerSecret.secret)}</code><p class="small muted">This credential is displayed once. Save it securely in the reader adapter.</p>${button('I have saved it', 'hide-secret', '', 'id="hide-secret"')}</section>` : ''}${!data.configured ? '<div class="warn amber mb"><div><h4>Reader authentication needs configuration</h4><p>Set DEVICE_ENCRYPTION_KEY on the server to provision readers. Manual scanning remains available.</p></div></div>' : ''}<div class="grid g2"><section class="card"><div class="ch"><h3>Provision reader</h3></div><div class="cb">${form('reader', field('Reader ID', 'id', '', 'text', 'required') + field('Reader name', 'name', '', 'text', 'required') + select('Installed location', 'location', state.locations || []), 'Create reader')}</div></section><section class="card"><div class="ch"><h3>Assign RFID / QR tag</h3></div><div class="cb">${form('tag', field('Tag value', 'tag', '', 'text', 'required') + select('Trolley', 'trolley', trolleys(state)), 'Assign tag')}</div>${table(
    ['Tag', 'Trolley'],
    (data.tags || []).map(
      (item) => `<tr><td>${esc(item.tag)}</td><td>${trolleyLink(item.trolley)}</td></tr>`,
    ),
  )}</section></div><section class="card mt"><div class="ch"><h3>Registered readers</h3></div>${table(
    ['Reader', 'Location', 'Last observed', 'Status', 'Actions'],
    (data.readers || []).map(
      (item) =>
        `<tr><td>${esc(item.name)}<div class="small muted">${esc(item.id)}</div></td><td>${esc(locationName(state, item.location))}</td><td>${fmt(item.last_seen)}</td><td>${item.active ? 'Active' : 'Inactive'}</td><td><div class="acts">${item.active ? button('Rotate key', 'rotate-reader', item.id, `data-reader-rotate="${esc(item.id)}"`, 'sm') + button('Deactivate', 'disable-reader', item.id, `data-reader-disable="${esc(item.id)}"`, 'sm') : '—'}</div></td></tr>`,
    ),
  )}</section><section class="card mt"><div class="ch"><h3>Latest reader observations</h3></div>${table(
    ['Observed', 'Reader', 'Location', 'Tag', 'Trolley'],
    (data.events || []).map(
      (item) =>
        `<tr><td>${fmt(item.observed_at)}</td><td>${esc(item.reader)}</td><td>${esc(locationName(state, item.location))}</td><td>${esc(item.tag)}</td><td>${item.trolley ? trolleyLink(item.trolley) : 'Unknown tag'}</td></tr>`,
    ),
  )}</section>`;
}

function policySettings(state) {
  const policy = state.policy;
  if (!policy) return empty('Plant rules require a supervisor or administrator');
  const check = (label, name, value) =>
    `<label class="check"><input type="checkbox" name="${name}" ${value ? 'checked' : ''}>${label}</label>`;
  return `<div class="grid g2">${state.user.role === 'Admin' ? `<section class="card"><div class="ch"><h3>Enforcement</h3></div><div class="cb">${form('policy-settings', check('Enforce allowed product routes', 'enforce_routes', policy.settings.enforce_routes) + check('Enforce trolley/product compatibility', 'enforce_categories', policy.settings.enforce_categories) + check('Restrict operations by assigned location', 'scope_operations', policy.settings.scope_operations), 'Save enforcement')}</div></section>` : ''}<section class="card"><div class="ch"><h3>Trolley compatibility</h3></div><div class="cb">${form('policy-categories', field('Trolley type (exact master value)', 'trolley_type', '', 'text', 'required') + field('Allowed product category', 'category', '', 'text', 'required'), 'Add compatibility')}</div>${table(
    ['Trolley type', 'Category'],
    (policy.categories || []).map(
      (item) => `<tr><td>${esc(item.trolley_type)}</td><td>${esc(item.category)}</td></tr>`,
    ),
  )}</section><section class="card"><div class="ch"><h3>Allowed route</h3></div><div class="cb">${form('policy-routes', select('From', 'source', state.locations || []) + select('To', 'destination', state.locations || []) + field('Product category (Empty for empty trolleys)', 'category') + check('Quality release required', 'requires_quality'), 'Save route')}</div>${table(
    ['From', 'To', 'Category', 'Quality'],
    (policy.routes || []).map(
      (item) =>
        `<tr><td>${esc(locationName(state, item.source))}</td><td>${esc(locationName(state, item.destination))}</td><td>${esc(item.category)}</td><td>${item.requires_quality ? 'Required' : '—'}</td></tr>`,
    ),
  )}</section>${
    state.user.role === 'Admin'
      ? `<section class="card"><div class="ch"><h3>Location permissions</h3></div><div class="cb">${form(
          'policy-scopes',
          select(
            'User',
            'user_id',
            (state.accounts || []).filter((item) => item.active),
          ) +
            select('Location', 'location', state.locations || []) +
            check('May depart from here', 'can_depart') +
            check('May receive or approve here', 'can_receive'),
          'Save permission',
        )}</div>${table(
          ['User', 'Location', 'Depart', 'Receive'],
          (policy.scopes || []).map(
            (item) =>
              `<tr><td>${esc(personName(state, item.user_id))}</td><td>${esc(locationName(state, item.location))}</td><td>${item.can_depart ? 'Yes' : 'No'}</td><td>${item.can_receive ? 'Yes' : 'No'}</td></tr>`,
          ),
        )}</section>`
      : ''
  }</div>`;
}

function auditSettings(state, ui) {
  const f = ui.audit || {};
  const q = (f.q || '').trim().toLowerCase();
  const records = (state.auditPage?.items || state.allAudit || state.audit || []).filter(
    (item) =>
      !q ||
      [item.actor_name, item.action, item.entity, item.detail].join(' ').toLowerCase().includes(q),
  );
  const paged = paginate(records, f.page, 'audit', 20);
  return `<section class="card"><div class="ch"><h3>Audit trail</h3><span class="small muted">Who changed what, and when</span></div><div class="tools">${filterInput('audit', 'q', f.q || '', 'Search by trolley, user or action')}</div>${table(
    ['Date / time', 'User', 'Action', 'Trolley / entity', 'Details'],
    paged.items.map(
      (item) =>
        `<tr><td>${fmt(item.ts)}</td><td>${esc(item.actor_name || personName(state, item.actor))}</td><td>${esc(item.action)}</td><td>${esc(item.entity)}</td><td>${esc(item.detail)}</td></tr>`,
    ),
  )}${paged.footer}${state.auditPage?.nextCursor ? `<div class="cb">${button('Load older audit events', 'load-audit', '', '', 'sm')}</div>` : ''}</section>`;
}

function settingsView(state, ui, forcedTab) {
  const tab = forcedTab || ui.settingsTab || ui.settings?.tab || 'general';
  const tabs = [
    ['general', 'General'],
    ...(manager(state)
      ? [
          ['policies', 'Plant rules'],
          ['audit', 'Audit trail'],
        ]
      : []),
    ...(state.user.role === 'Admin'
      ? [
          ['users', 'User management'],
          ['readers', 'Readers & tags'],
          ['demo', 'Demo data'],
        ]
      : []),
  ];
  const blurbs = {
    Admin: 'Full access to plant records, users, settings and approvals.',
    'Plant Manager': 'Monitor the plant, review exceptions, approve requests and read reports.',
    Supervisor: 'Maintain trolleys, record movements, review alerts and approve requests.',
    Operator: 'Identify trolleys, record movements and confirm arrival.',
    'Quality User': 'Record quality movements, verify products and review quality exceptions.',
    'Store User': 'Issue and receive trolleys and manage material movements.',
  };
  const general = `<div class="grid g2"><section class="card"><div class="ch"><h3>Approval rules</h3></div><div class="cb">${state.user.role === 'Admin' ? form('settings', `<label class="check"><input type="checkbox" name="outside_approval" ${state.settings?.outside_approval !== false && state.settings?.outside_approval !== 0 ? 'checked' : ''}>Outside plant movements need approval</label><label class="check"><input type="checkbox" name="mismatch_approval" ${state.settings?.mismatch_approval !== false && state.settings?.mismatch_approval !== 0 ? 'checked' : ''}>Mismatches need supervisor approval</label>`, 'Save approval rules') : '<p class="muted">An administrator manages approval rules.</p>'}<h4 class="mt">Appearance</h4><div class="acts mt">${['auto', 'light', 'dark'].map((value) => button(value[0].toUpperCase() + value.slice(1), 'theme', '', `data-theme="${value}"`, (ui.theme || 'auto') === value ? 'p sm' : 'sm')).join('')}</div></div></section><section class="card"><div class="ch"><h3>Roles and access</h3></div>${table(
    ['Role', 'Can do'],
    ROLES.map(
      (value) =>
        `<tr><td><b>${esc(value)}</b></td><td class="small">${esc(blurbs[value])}</td></tr>`,
    ),
  )}</section></div><section class="card mt"><div class="ch"><h3>Plant records</h3></div><div class="cb"><p>Records are shared by authenticated users and persist in the server database.</p><div class="acts">${state.user.role === 'Admin' ? button('Add location', 'add-location') + button('Add product', 'add-product') + button('Add trolley', 'add-trolley') : ''}</div></div></section>`;
  const content =
    tab === 'users'
      ? usersSettings(state)
      : tab === 'readers'
        ? readersSettings(state)
        : tab === 'policies'
          ? policySettings(state)
          : tab === 'audit'
            ? auditSettings(state, ui)
            : tab === 'demo'
              ? `<section class="card"><div class="ch"><h3>Reference sample plant</h3></div><div class="cb"><p>Load 128 sample trolleys, locations and products into an empty operational database for testing.</p><div class="acts">${button('Load sample plant', 'load-demo', '', '', 'p')}</div><h4 class="mt">Restore sample data</h4><p>Restore the sample trolley snapshot after testing. Recorded history is retained, and open movements and approval requests must be finished first.</p>${button('Reset demo data', 'reset-demo', '', '', 'd')}</div></section>`
              : general;
  return `${title('Settings', 'Approval rules, appearance, access and the complete audit trail.')}<div class="acts mb">${tabs.map(([value, label]) => button(label, 'settings-tab', '', `data-tab="${value}"`, tab === value ? 'p' : '')).join('')}</div>${content}`;
}

export function operationsView(page, state, ui = {}) {
  if (page === 'master' || page === 'masters') return masterView(state, ui);
  if (page === 'scan') return scanView(state, ui);
  if (page === 'movement') return movementView(state, ui);
  if (page === 'products') return productsView(state, ui);
  if (page === 'alerts') return alertsView(state, ui);
  if (page === 'approvals') return approvalsView(state, ui);
  if (page === 'settings') return settingsView(state, ui);
  if (['users', 'readers', 'policies', 'audit'].includes(page))
    return settingsView(state, ui, page);
  return '';
}

function trolleyForm(state, item) {
  const edit = Boolean(item);
  const next = `TR-${String(Math.max(0, ...trolleys(state).map((value) => Number(String(value.id).replace(/^TR-/, '')) || 0)) + 1).padStart(3, '0')}`;
  const value = item || {
    id: next,
    type: TROLLEY_TYPES[0],
    capacity: 500,
    unit: 'kg',
    material_type: 'Raw Material',
    location: state.locations?.[0]?.id,
    assigned_area: state.locations?.[0]?.id,
    department: 'Stores',
  };
  return `<form id="trolleys" data-form="trolley" data-edit="${edit ? 'true' : 'false'}"><input type="hidden" name="version" value="${value.version ?? 0}"><div class="fgrid">${field('Trolley ID', 'id', value.id, 'text', edit ? 'readonly required' : 'required maxlength="40"', 'Permanent and unique; retained after deactivation.')}${field('QR code', 'qr', value.qr || `QR-${value.id}`, 'text', edit ? 'readonly maxlength="120"' : 'maxlength="120"')}${select('Trolley type', 'type', unique([...TROLLEY_TYPES, ...trolleys(state).map((record) => record.type)]), value.type)}${field('Capacity (same units as load)', 'capacity', value.capacity, 'number', 'required min="1" step="any"')}${field('Capacity unit', 'unit', value.unit || 'pcs', 'text', 'required maxlength="20"')}${select('Material type', 'material_type', ['Raw Material', 'Component', 'WIP', 'Finished Goods', 'Rework'], value.material_type)}${field('Department', 'department', value.department || '', 'text', 'maxlength="100"')}${select('Assigned area', 'assigned_area', state.locations || [], value.assigned_area, 'Select assigned area')}${field('RFID number', 'rfid', value.rfid || '', 'text', 'maxlength="120"')}${!edit ? select('Starting location', 'location', state.locations || [], value.location, 'Select location', 'required') : ''}${field('Maintenance due (optional)', 'maintenance_due', value.maintenance_due ? localTime(value.maintenance_due) : '', 'datetime-local')}${select('Tag health', 'tag_health', ['Good', 'QR unreadable', 'RFID signal weak'], value.tag_health || 'Good')}</div>${error}</form>`;
}

function detailsModal(state, item) {
  const detail = state.trolleyDetail?.trolley?.id === item.id ? state.trolleyDetail : null;
  item = detail?.trolley || item;
  const movements = (detail?.movements || allMovements(state))
    .filter((record) => record.trolley === item.id)
    .sort((a, b) => (a.created || 0) - (b.created || 0))
    .slice(-12);
  const alerts = (state.alerts || []).filter(
    (record) => record.trolley === item.id && record.status !== 'Resolved',
  );
  const audit = (detail?.audit || state.allAudit || state.audit || [])
    .filter((record) => record.entity === item.id)
    .slice(0, 6);
  return {
    title: `Trolley ${item.id}`,
    wide: true,
    body: `<div class="grid g2"><div><div class="tag"><div class="qrbox"><img src="${qrUrl(item.id)}" alt="QR label for ${esc(item.id)}" width="100" height="100"></div><div><div class="big">${esc(item.id)}</div><div class="mt">${badge(effectiveStatus(item))}</div><div class="mono small muted mt">${esc(item.qr || item.id)}<br>${esc(item.rfid || 'RFID not assigned')}</div></div></div><h4 class="mt">Trolley information</h4><dl class="kv mt"><dt>Type</dt><dd>${esc(item.type)}</dd><dt>Capacity</dt><dd>${item.capacity} ${esc(item.unit)}</dd><dt>Material type</dt><dd>${esc(item.material_type || '—')}</dd><dt>Department</dt><dd>${esc(item.department || '—')}</dd><dt>Assigned area</dt><dd>${esc(locationName(state, item.assigned_area))}</dd><dt>Current location</dt><dd><b>${esc(locationName(state, item.location))}</b></dd><dt>Previous location</dt><dd>${esc(locationName(state, item.previous_location))}</dd><dt>At location for</dt><dd>${duration(Date.now() - (item.since || item.last_moved || Date.now()))}</dd><dt>Times used</dt><dd>${Number(item.uses) || 0}</dd><dt>Created</dt><dd>${fmt(item.created)}</dd><dt>Maintenance due</dt><dd>${fmt(item.maintenance_due)}</dd><dt>Tags</dt><dd>${tagChips(item)}</dd></dl><h4 class="mt">Current assignment</h4><dl class="kv mt"><dt>Product</dt><dd>${esc(productName(state, item.product))}</dd><dt>Batch</dt><dd>${esc(item.batch || '—')}</dd><dt>Quantity</dt><dd>${item.qty} ${esc(item.unit)}</dd><dt>Operator</dt><dd>${esc(personName(state, item.operator_id))}</dd><dt>Expected return</dt><dd>${fmt(item.expected)} ${effectiveStatus(item) === 'Overdue' ? `<span class="chip r">${duration(Date.now() - item.expected)} late</span>` : ''}</dd></dl><div class="mt">${flagChips(state, item)}</div>${alerts.length ? `<h4 class="mt">Open alerts</h4>${alerts.map((record) => `<div class="mt">${priority(record.priority)} <b>${esc(record.type)}</b><div class="small muted">${esc(record.message || record.msg)}</div></div>`).join('')}` : ''}</div><div><h4>Movement timeline</h4><div class="tl mt">${movements.length ? movements.map((record, index) => `<div class="ev ${index === movements.length - 1 ? 'now' : ''}"><b>${esc(locationName(state, record.destination))}</b><span>${esc(record.movement_type || 'Transfer')} · ${esc(record.state)} · ${esc(record.requester || personName(state, record.operator_id || record.requested_by))}</span><br><span>${fmt(record.occurred || record.created)} · from ${esc(locationName(state, record.source))}</span>${record.reason ? `<div class="small muted">${esc(record.reason)}</div>` : ''}</div>`).join('') : empty('No movements recorded')}</div>${audit.length ? `<h4 class="mt">Recent audit entries</h4>${audit.map((record) => `<div class="small mt"><b>${esc(record.action)}</b> · ${esc(record.actor_name || personName(state, record.actor))}<div class="muted">${fmt(record.ts)} · ${esc(record.detail)}</div></div>`).join('')}` : ''}</div></div>`,
    footer: `${canMove(state) && effectiveStatus(item) !== 'Inactive' ? button('Move trolley', 'move-trolley', item.id, '', 'p') : ''}${button('Report issue', 'report-issue', item.id)}${button('Generate QR', 'qr-label', item.id)}${state.user.role === 'Admin' ? button('Edit', 'edit-trolley', item.id) : ''}${closeButton()}`,
  };
}

export function trolleyModal(kind, state, ui = {}) {
  const data = ui.modal || ui;
  const id = data.id || ui.id;
  const item = findTrolley(state, id);
  if (['detail', 'details', 'trolley', 'open-trolley'].includes(kind) && item)
    return detailsModal(state, item);
  if (['add', 'add-trolley', 'edit-trolley', 'edit'].includes(kind))
    return {
      title: item ? `Edit trolley ${item.id}` : 'Add trolley',
      body: trolleyForm(state, item),
      footer:
        button('Cancel', 'close-modal') +
        '<button class="btn p" type="submit" form="trolleys">Save trolley</button>',
      wide: true,
    };
  if (['qr', 'qr-label'].includes(kind) && item)
    return {
      title: `QR label · ${item.id}`,
      body: `<div style="display:grid;place-items:center;gap:12px"><div class="qrbox"><img src="${qrUrl(item.id)}" width="240" height="240" alt="QR label for ${esc(item.id)}"></div><div class="big">${esc(item.id)}</div><div class="mono muted small">${esc(item.qr || item.id)} · ${esc(item.rfid || 'RFID not assigned')}</div><p>Print this permanent identity label and attach it to the trolley frame.</p></div>`,
      footer:
        closeButton() +
        `<a class="btn p" href="${qrUrl(item.id)}" download="${esc(item.id)}-qr.svg">Save label</a>`,
    };
  if (['issue', 'report-issue'].includes(kind) && item)
    return {
      title: `Report issue · ${item.id}`,
      body: `<form id="issue-form" data-form="issue"><input type="hidden" name="trolley" value="${esc(item.id)}">${select('What is wrong?', 'type', ISSUE_TYPES)}${select('Priority', 'priority', ['Critical', 'High', 'Medium', 'Low'], 'Medium')}${textarea('Details', 'message', '', 'required maxlength="1000" placeholder="What did you see?"')}${error}</form>`,
      footer:
        button('Cancel', 'close-modal') +
        '<button class="btn p" type="submit" form="issue-form">Report issue</button>',
    };
  if (['receive', 'receive-trolley'].includes(kind)) {
    const movements = (state.activeMovements || allMovements(state)).filter(
      (record) =>
        record.state === 'In Transit' &&
        (!id || record.trolley === id || String(record.id) === String(id)),
    );
    if (!movements.length)
      return {
        title: 'Receive trolley',
        body: empty(
          'Nothing to receive',
          'This trolley has no movement awaiting arrival. Record a movement to change its location.',
        ),
        footer: closeButton(),
      };
    const record = movements[0];
    return {
      title: `Receive trolley · ${record.trolley}`,
      body: `<p>Confirm that <b>${esc(record.trolley)}</b> has physically arrived at <b>${esc(locationName(state, record.destination))}</b>.</p><dl class="kv mt"><dt>From</dt><dd>${esc(locationName(state, record.source))}</dd><dt>Product</dt><dd>${esc(productName(state, record.product))}</dd><dt>Quantity</dt><dd>${record.qty}</dd><dt>Expected</dt><dd>${fmt(record.expected)}</dd></dl>`,
      footer:
        button('Cancel', 'close-modal') +
        button('Confirm arrival', 'receive-movement', record.id, '', 'p'),
    };
  }
  if (['approval', 'decision', 'decide-approval'].includes(kind)) {
    const record = (state.approvals || []).find((value) => String(value.id) === String(id));
    const decision = data.decision || 'approve';
    const label =
      decision === 'correct'
        ? 'Request correction'
        : decision === 'reject'
          ? 'Reject request'
          : 'Approve request';
    return {
      title: `${label}${record ? ` · ${record.trolley}` : ''}`,
      body: `<form id="approval-decision-form" data-form="approval-decision"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="decision" value="${esc(decision)}"><p>${esc(record?.remarks || record?.reason || 'Review the request before deciding.')}</p>${textarea(decision === 'approve' ? 'Remarks / approval reason' : 'Reason and correction instructions', 'reason', '', `${decision === 'approve' && !array(record?.issues || record?.policy_flags).length && !/mismatch/i.test(approvalKind(record || {})) ? '' : 'required minlength="10"'} maxlength="1000"`)}${error}</form>`,
      footer:
        button('Cancel', 'close-modal') +
        `<button class="btn ${decision === 'reject' ? 'd' : 'p'}" type="submit" form="approval-decision-form">${label}</button>`,
    };
  }
  if (['location', 'add-location'].includes(kind))
    return {
      title: 'Add location',
      body: `<form id="location-form" data-form="location"><div class="fgrid">${field('Location ID', 'id', '', 'text', 'required maxlength="40"')}${field('Name', 'name', '', 'text', 'required')}${field('Location group', 'group_name', 'Store', 'text', 'required')}${field('Trolley bays', 'capacity', 20, 'number', 'required min="1"')}${field('Department', 'department', 'Stores')}${field('Expected stay (minutes)', 'expected_minutes', 240, 'number', 'required min="1"')}<label class="check full"><input name="external" type="checkbox">Outside plant</label></div>${error}</form>`,
      footer:
        button('Cancel', 'close-modal') +
        '<button class="btn p" type="submit" form="location-form">Add location</button>',
    };
  if (['product', 'add-product'].includes(kind))
    return {
      title: 'Add product',
      body: `<form id="product-form" data-form="product"><div class="fgrid">${field('Product code', 'id', '', 'text', 'required maxlength="40"')}${field('Product name', 'name', '', 'text', 'required')}${select('Category', 'category', ['Raw', 'Component', 'WIP', 'Finished'], 'Component')}${field('Quantity unit', 'unit', 'pcs', 'text', 'required maxlength="20"')}${field('Default batch', 'default_batch', '', 'text', 'maxlength="120"')}${field('Allowed location groups (comma separated)', 'allowed_groups', '', 'text', '', 'Leave blank to allow any location group.')}</div>${error}</form>`,
      footer:
        button('Cancel', 'close-modal') +
        '<button class="btn p" type="submit" form="product-form">Add product</button>',
    };
  if (['resolve-alert', 'resolve'].includes(kind))
    return {
      title: 'Resolve alert',
      body: `<form id="resolve-alert-form" data-form="resolve-alert"><input type="hidden" name="id" value="${esc(id)}">${textarea('Resolution details', 'resolution', '', 'required minlength="5" maxlength="1000"')}${error}</form>`,
      footer:
        button('Cancel', 'close-modal') +
        '<button class="btn g" type="submit" form="resolve-alert-form">Resolve alert</button>',
    };
  return {
    title: 'Trolley',
    body: empty('Record not found', 'Refresh and try again.'),
    footer: closeButton(),
  };
}
