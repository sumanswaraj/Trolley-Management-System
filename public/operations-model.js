export const TROLLEY_TYPES = [
  'Material Trolley',
  'Component Trolley',
  'Finished Goods',
  'WIP Trolley',
  'Rework Trolley',
];
export const STATUSES = [
  'Available',
  'In Use',
  'In Transit',
  'Waiting',
  'Maintenance',
  'Overdue',
  'Outside Plant',
  'Inactive',
];
export const MOVEMENT_TYPES = [
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
export const ROLES = [
  'Admin',
  'Plant Manager',
  'Supervisor',
  'Operator',
  'Quality User',
  'Store User',
];
export const ISSUE_TYPES = [
  'Wrong product',
  'Wrong trolley',
  'Wrong location',
  'Mixed batch',
  'Unassigned trolley',
  'Trolley missing',
  'Unauthorized movement',
  'Movement not completed',
  'Trolley maintenance due',
  'Damaged wheel or frame',
  'Tag unreadable (QR or RFID)',
];
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
export const array = (value) => {
  if (Array.isArray(value)) return value;
  try {
    const result = JSON.parse(value || '[]');
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
};
export const locationName = (state, id) =>
  state.locations?.find((item) => item.id === id)?.name || id || '—';
export const productName = (state, id) =>
  state.products?.find((item) => item.id === id)?.name || id || 'Empty';
export const personName = (state, id) =>
  state.people?.find((item) => String(item.id) === String(id))?.name ||
  state.accounts?.find((item) => String(item.id) === String(id))?.name ||
  (String(id) === String(state.user?.id) ? state.user?.name : id) ||
  '—';
export const effectiveStatus = (item) =>
  item.active === 0 || item.active === false
    ? 'Inactive'
    : item.effective_status ||
      (item.expected &&
      item.expected < Date.now() &&
      ['In Use', 'Waiting', 'In Transit'].includes(item.status)
        ? 'Overdue'
        : item.status || 'Available');
export const fmt = (value, dateOnly = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(
    undefined,
    dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' },
  );
};
export const duration = (value) => {
  const minutes = Math.max(0, Math.floor(Number(value) / 60000));
  if (!Number.isFinite(minutes)) return '—';
  return minutes < 1
    ? '<1m'
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
};
export const ago = (value) => (value ? `${duration(Date.now() - value)} ago` : '—');
export const localTime = (value = Date.now()) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const options = (records, selected = '', blank) =>
  (blank === undefined ? '' : `<option value="">${esc(blank)}</option>`) +
  records
    .map((item) => {
      const value = typeof item === 'object' ? item.id : item;
      const title = typeof item === 'object' ? item.name || item.id : item;
      return `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(title)}</option>`;
    })
    .join('');
export const field = (label, name, value = '', type = 'text', attributes = '', hint = '') =>
  `<div class="fld"><label for="op-${esc(name)}">${esc(label)}</label><input id="op-${esc(name)}" name="${esc(name)}" type="${type}" value="${esc(value)}" ${attributes}>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
export const select = (label, name, records, value = '', blank, attributes = '') =>
  `<div class="fld"><label for="op-${esc(name)}">${esc(label)}</label><select id="op-${esc(name)}" name="${esc(name)}" ${attributes}>${options(records, value, blank)}</select></div>`;
export const textarea = (label, name, value = '', attributes = '') =>
  `<div class="fld full"><label for="op-${esc(name)}">${esc(label)}</label><textarea id="op-${esc(name)}" name="${esc(name)}" rows="3" ${attributes}>${esc(value)}</textarea></div>`;
export const error = '<p class="err error full" role="alert"></p>';
export const empty = (title, detail = '') =>
  `<div class="empty"><b>${esc(title)}</b>${detail ? `<div>${esc(detail)}</div>` : ''}</div>`;
export const table = (columns, rows, emptyTitle = 'No records yet', emptyDetail = '') =>
  rows.length
    ? `<div class="tw table"><table><thead><tr>${columns.map((item) => `<th>${esc(item)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : empty(emptyTitle, emptyDetail);
const STATUS_KEYS = {
  Available: 'avail',
  'In Use': 'use',
  'In Transit': 'transit',
  Waiting: 'wait',
  Maintenance: 'maint',
  Overdue: 'over',
  'Outside Plant': 'out',
  Inactive: 'off',
  Open: 'over',
  Acknowledged: 'wait',
  Resolved: 'avail',
  Pending: 'wait',
  Approved: 'avail',
  Rejected: 'over',
  'Correction Requested': 'wait',
  Received: 'avail',
  Completed: 'avail',
};
export const badge = (value) =>
  `<span class="bd s-${STATUS_KEYS[value] || 'off'}">${esc(value)}</span>`;
export const priority = (value) =>
  `<span class="bd p-${String(value || 'Medium').toLowerCase()}">${esc(value || 'Medium')}</span>`;
export const button = (label, action, id = '', extra = '', style = '') =>
  `<button type="button" class="btn ${style}" data-action="${action}" ${id === '' ? '' : `data-id="${esc(id)}"`} ${extra}>${label}</button>`;
export const trolleyLink = (id) =>
  `<button type="button" class="tid" data-action="open-trolley" data-id="${esc(id)}">${esc(id)}</button>`;
export const title = (heading, subtitle, actions = '') =>
  `<div class="ph"><div><h1>${esc(heading)}</h1><p>${esc(subtitle)}</p></div>${actions ? `<div class="acts">${actions}</div>` : ''}</div>`;
export const manager = (state) => ['Admin', 'Supervisor'].includes(state.user?.role);
export const canMove = (state) => state.user?.role !== 'Plant Manager';
export const unique = (values) => [...new Set(values.filter(Boolean))].sort();
export const flagsOf = (state, trolley) =>
  unique([
    ...array(trolley.flags).map((item) =>
      typeof item === 'object' ? item.kind || item.msg : item,
    ),
    ...(state.alerts || [])
      .filter(
        (item) =>
          item.trolley === trolley.id &&
          item.status !== 'Resolved' &&
          [
            'Wrong trolley',
            'Wrong product',
            'Wrong location',
            'Mixed batch',
            'Unassigned trolley',
          ].includes(item.type),
      )
      .map((item) => item.type),
  ]);
export const flagChips = (state, trolley) =>
  flagsOf(state, trolley)
    .map((flag) => `<span class="chip r">${esc(flag)}</span>`)
    .join(' ');
export const paginate = (items, current, section, size = 15) => {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(pages, Math.max(1, Number(current) || 1));
  return {
    items: items.slice((page - 1) * size, page * size),
    footer: `<div class="pager"><span>${items.length ? `Showing ${(page - 1) * size + 1}–${Math.min(items.length, page * size)} of ${items.length}` : 'No records'}</span><div class="acts">${button('Previous', 'paginate', '', `data-section="${section}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}`, 'sm')}<span>Page ${page} of ${pages}</span>${button('Next', 'paginate', '', `data-section="${section}" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}`, 'sm')}</div></div>`,
  };
};
export const filterInput = (section, key, value, placeholder) =>
  `<input class="grow" data-filter="${section}.${key}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">`;
export const filterSelect = (section, key, records, value, blank) =>
  `<select data-filter="${section}.${key}" aria-label="${esc(blank)}">${options(records, value, blank)}</select>`;
