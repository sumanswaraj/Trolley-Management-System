import { QrScanner } from './scanner.js';
import { api } from './api.js';
import { loginView, workspaceView } from './views.js';
import { escapeHtml as escape } from './ui.js';

const application = document.getElementById('app');
const pages = new Set([
  'dashboard',
  'policies',
  'fleet',
  'masters',
  'movement',
  'scan',
  'locations',
  'overdue',
  'history',
  'products',
  'alerts',
  'approvals',
  'reports',
  'analytics',
  'settings',
  'audit',
  'readers',
  'users',
  'notifications',
  'detail',
]);
let state = null;
let currentPage = pages.has(location.hash.slice(2)) ? location.hash.slice(2) : 'dashboard';
let mutationPending = false;
let scanner = null;
let readerSecret = null;
let viewState = {
  theme: localStorage.getItem('trolley-theme') || 'auto',
  fleetFilters: {},
  historyFilters: {},
  alertFilters: {},
  productFilters: {},
  auditFilter: {},
  recentScans: [],
};

function applyTheme(theme) {
  viewState.theme = theme;
  localStorage.setItem('trolley-theme', theme);
  document.documentElement.dataset.theme =
    theme === 'auto'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
}
applyTheme(viewState.theme);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (viewState.theme === 'auto') applyTheme('auto');
});

function notify(message) {
  const notice = document.getElementById('notice');
  notice.textContent = message;
  notice.style.display = 'block';
  setTimeout(() => {
    notice.style.display = 'none';
  }, 5000);
}
function stopCamera() {
  scanner?.stop();
  scanner = null;
  const stop = document.getElementById('stop-camera');
  if (stop) stop.hidden = true;
}
function showLogin() {
  stopCamera();
  readerSecret = null;
  state = null;
  application.innerHTML = loginView();
}
function updateClock() {
  const clock = document.getElementById('plant-clock');
  if (clock) {
    clock.textContent = new Date().toLocaleString();
    clock.dateTime = new Date().toISOString();
  }
}
function render() {
  stopCamera();
  Object.assign(state, viewState, { readerSecret });
  application.innerHTML = workspaceView(state, currentPage);
  const edit = viewState.editingMaster;
  if (edit?.kind === 'trolleys') {
    const field = document.querySelector('[name=assigned_area]');
    if (field) field.value = edit.record.assigned_area || edit.record.location;
    const qr = document.querySelector('[name=qr_value]');
    if (qr) qr.readOnly = true;
  }
  if (currentPage === 'movement' && viewState.movePrefill) {
    const form = document.getElementById('move');
    for (const [key, value] of Object.entries(viewState.movePrefill))
      if (form.elements[key]) form.elements[key].value = value;
    fillMovement(form, false);
  }
  updateClock();
}
function query(filters = {}) {
  const values = {};
  for (const [key, value] of Object.entries(filters))
    if (value !== '' && value !== undefined && value !== null)
      values[key] =
        ['from', 'to'].includes(key) && typeof value === 'string' && value.includes('T')
          ? new Date(value).getTime()
          : value;
  return new URLSearchParams(values).toString();
}
async function refresh() {
  const next = await api('state');
  if (next.user.role === 'Admin') next.accounts = await api('users');
  if (currentPage === 'policies' && ['Admin', 'Supervisor'].includes(next.user.role))
    next.policy = await api('policies');
  if (currentPage === 'readers' && next.user.role === 'Admin')
    next.readerData = await api('readers');
  if (currentPage === 'history')
    next.historyPage = await api('history?' + query(viewState.historyFilters));
  if (
    ['audit', 'settings'].includes(currentPage) &&
    ['Admin', 'Plant Manager', 'Supervisor'].includes(next.user.role)
  )
    next.auditPage = await api('audit?' + query(viewState.auditFilter));
  if (currentPage === 'reports') {
    next.reportCatalogue = await api('reports');
    if (viewState.selectedReportKind)
      next.selectedReport = await api(
        'reports?' + query({ kind: viewState.selectedReportKind, ...viewState.historyFilters }),
      );
  }
  if (currentPage === 'analytics')
    next.analytics = await api('analytics?' + query(viewState.analyticsFilters));
  if (currentPage === 'detail' && viewState.selectedTrolley)
    next.trolleyHistory = await api('history?' + query({ trolley: viewState.selectedTrolley }));
  state = next;
  render();
}
async function navigate(page) {
  readerSecret = null;
  currentPage = pages.has(page) ? page : 'dashboard';
  history.pushState(null, '', '#/' + currentPage);
  await refresh();
  window.scrollTo(0, 0);
}
function lookup(code) {
  const value = code.trim().toLowerCase();
  return state.trolleys.find((item) =>
    [
      item.id,
      item.qr_value,
      item.rfid,
      ...(state.tags || []).filter((tag) => tag.trolley === item.id).map((tag) => tag.tag),
    ].some((entry) => entry && entry.toLowerCase() === value),
  );
}
function fillMovement(form, fillLoad = true) {
  const trolley = lookup(form.elements.trolley.value);
  if (!trolley) return;
  form.elements.trolley.value = trolley.id;
  if (fillLoad) {
    form.elements.product.value = trolley.product || '';
    form.elements.qty.value = trolley.qty;
    form.elements.batch.value = trolley.batch || 'EMPTY';
  }
  if (!form.elements.expected.value) {
    const destination = state.locations.find((item) => item.id === form.elements.destination.value);
    const date = new Date(Date.now() + (destination?.expected_minutes || 120) * 60000);
    form.elements.expected.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  movementPreview(form);
}
function movementPreview(form) {
  const panel = document.getElementById('movement-preview');
  const trolley = lookup(form.elements.trolley.value);
  if (!panel || !trolley) return;
  const source = state.locations.find((item) => item.id === trolley.location);
  const destination = state.locations.find((item) => item.id === form.elements.destination.value);
  const before = state.trolleys.filter(
    (item) => item.active && item.location === trolley.location,
  ).length;
  const after = state.trolleys.filter(
    (item) => item.active && item.location === destination?.id,
  ).length;
  const qty = Number(form.elements.qty.value);
  const warnings = [];
  if (qty > trolley.capacity) warnings.push('Quantity exceeds capacity.');
  if (destination?.id === trolley.location) warnings.push('Choose a different destination.');
  if (destination?.external && state.operationSettings?.outside_approval)
    warnings.push('Outside movement requires independent approval.');
  const product = state.products.find((p) => p.id === form.elements.product.value);
  if (product?.unit !== trolley.unit && qty > 0) warnings.push('Product and trolley units differ.');
  if (product?.allowed_locations?.length && !product.allowed_locations.includes(destination?.id))
    warnings.push('Product is not permitted at the destination.');
  if (
    trolley.qty > 0 &&
    (product?.id !== trolley.product || form.elements.batch.value !== trolley.batch)
  )
    warnings.push('Declared product or batch differs from the current load.');
  panel.innerHTML = `<b>${escape(trolley.id)} · ${escape(source?.name || trolley.location)}</b><p>${trolley.qty} / ${trolley.capacity} ${escape(trolley.unit)} · ${escape(trolley.status)}</p>${warnings.map((text) => `<p class="error">${escape(text)}</p>`).join('')}<p>${escape(source?.name)}: ${before} → ${Math.max(0, before - 1)} trolleys<br>${escape(destination?.name || '')}: ${after} → ${after + 1} trolleys</p><span class="hint">Server policy and permissions are checked when you submit.</span>`;
}
async function submitMovement(form, input) {
  const trolley = lookup(input.trolley);
  if (!trolley) throw new Error('Unknown trolley ID');
  const payload = {
    ...input,
    trolley: trolley.id,
    ...(input.revision_of ? { revision_of: Number(input.revision_of) } : {}),
    qty: Number(input.qty),
    version: trolley.version,
    expected: new Date(input.expected).getTime(),
    occurred_at: new Date(input.occurred_at).getTime(),
    in_transit: form.elements.in_transit.checked,
  };
  const signature = JSON.stringify(payload);
  if (form.dataset.signature !== signature) {
    form.dataset.signature = signature;
    form.dataset.requestKey = crypto.randomUUID();
  }
  const record = await api('movements', { ...payload, key: form.dataset.requestKey });
  delete viewState.movePrefill;
  notify(
    record.state === 'Pending'
      ? 'Movement saved for independent approval.'
      : record.state === 'Received'
        ? 'Movement and physical arrival recorded.'
        : 'Departure recorded. Confirm arrival when the trolley reaches its destination.',
  );
}
function masterInput(form, input) {
  for (const key of ['capacity', 'bay_capacity', 'expected_minutes', 'version'])
    if (key in input) input[key] = Number(input[key]);
  if (form.elements.external) input.external = form.elements.external.checked;
  if (form.elements.allowed_locations)
    input.allowed_locations = Array.from(
      form.elements.allowed_locations.selectedOptions,
      (option) => option.value,
    );
  if (input.kind === 'trolleys' || form.id === 'trolleys') {
    input.assigned_area ||= input.location || viewState.editingMaster?.record.location;
    input.qr_value ||= input.id;
    input.material_type ||= 'Unspecified';
  }
  return input;
}
application.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (mutationPending) return;
  const form = event.target;
  const id = form.getAttribute('id');
  const submit = form.querySelector('button[type=submit]');
  const errorLabel = form.querySelector('.error');
  mutationPending = true;
  application.inert = true;
  if (submit) submit.disabled = true;
  if (errorLabel) errorLabel.textContent = '';
  try {
    const input = Object.fromEntries(new FormData(form));
    if (id === 'login') {
      await api('login', input);
      await refresh();
      return;
    }
    if (['global-lookup', 'scan-lookup'].includes(id)) {
      try {
        const trolley = await api('lookup?' + query({ code: input.code }));
        viewState.scanResult = { trolley, code: input.code, source: 'Manual / USB' };
        viewState.recentScans.unshift({
          trolley: trolley.id,
          code: input.code,
          source: 'Manual / USB',
          created: Date.now(),
        });
        viewState.recentScans = viewState.recentScans.slice(0, 20);
        if (id === 'global-lookup') {
          viewState.selectedTrolley = trolley.id;
          await navigate('detail');
        } else render();
      } catch (error) {
        if (error.status === 401) throw error;
        viewState.scanResult = { code: input.code, error: error.message };
        viewState.recentScans.unshift({
          code: input.code,
          source: 'Manual / USB',
          created: Date.now(),
          status: 'Not found',
        });
        render();
        notify(error.message);
      }
      return;
    }
    const filterForms = {
      'fleet-filter': 'fleetFilters',
      'master-filter': 'masterFilters',
      'history-filter': 'historyFilters',
      'alert-filter': 'alertFilters',
      'product-filter': 'productFilters',
      'audit-filter': 'auditFilter',
      'analytics-filter': 'analyticsFilters',
    };
    if (filterForms[id]) {
      viewState[filterForms[id]] = input;
      await refresh();
      return;
    }
    if (id === 'operation-settings') {
      await api('policies/settings', {
        outside_approval: form.elements.outside_approval.checked,
        mismatch_approval: form.elements.mismatch_approval.checked,
      });
    } else if (id === 'move') {
      await submitMovement(form, input);
      await refresh();
      return;
    } else if (id === 'incident-report') await api('incidents', input);
    else if (id === 'scan-verify') {
      for (const field of ['qty']) {
        if (input[field] === '') delete input[field];
        else if (input[field] !== undefined) input[field] = Number(input[field]);
      }
      for (const field of ['product', 'type', 'location', 'batch'])
        if (input[field] === '') delete input[field];
      viewState.lastVerification = await api('verifications', input);
      await refresh();
      return;
    } else if (id === 'verification-request')
      await api('verification-approvals', {
        verification: Number(input.verification),
        reason: input.reason,
      });
    else if (id === 'master-edit') {
      masterInput(form, input);
      await api(`${input.kind}/${encodeURIComponent(input.id)}/update`, input);
      delete viewState.editingMaster;
    } else if (id.startsWith('policy-')) {
      const kind = id.replace('policy-', '');
      if (kind === 'settings')
        for (const key of ['enforce_routes', 'enforce_categories', 'scope_operations'])
          input[key] = form.elements[key].checked;
      if (kind === 'routes') input.requires_quality = form.elements.requires_quality.checked;
      if (kind === 'scopes') {
        input.user_id = Number(input.user_id);
        input.can_depart = form.elements.can_depart.checked;
        input.can_receive = form.elements.can_receive.checked;
      }
      await api(`policies/${kind}`, input);
    } else if (id === 'readers') readerSecret = await api('readers', input);
    else if (['trolleys', 'products', 'locations'].includes(id)) {
      masterInput(form, input);
      await api(id, input);
    } else await api(id, input);
    notify('Saved successfully');
    await refresh();
  } catch (error) {
    if (error.status === 401 && id !== 'login') showLogin();
    else if (errorLabel) errorLabel.textContent = error.message;
    else notify(error.message);
  } finally {
    mutationPending = false;
    application.inert = false;
    if (submit) submit.disabled = false;
  }
});

async function download(path, filename) {
  const response = await fetch('/api/' + path, { credentials: 'same-origin' });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Download failed');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportMovements() {
  const fields = [
    'id',
    'trolley',
    'source',
    'destination',
    'state',
    'product',
    'batch',
    'qty',
    'created',
    'received',
    'movement_type',
    'requester',
    'department',
    'reason',
    'remarks',
    'exception_reason',
    'decision_reason',
  ];
  const csv = (value) =>
    '"' +
    String(value ?? '')
      .replace(/^[\s]*[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const rows = [fields.join(',')];
  let cursor;
  do {
    const page = await api(
      'history?' + query({ ...viewState.historyFilters, limit: 100, before: cursor }),
    );
    rows.push(...page.items.map((record) => fields.map((field) => csv(record[field])).join(',')));
    cursor = page.nextCursor;
  } while (cursor);
  const url = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'trolley-movements.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function startCamera() {
  const video = document.getElementById('scan-video');
  const status = document.getElementById('scan-status');
  scanner = new QrScanner(
    video,
    (code) => {
      const trolley = lookup(code);
      if (!trolley) {
        status.textContent = 'QR value does not match a registered trolley.';
        return false;
      }
      if (currentPage === 'movement') {
        const form = document.getElementById('move');
        form.elements.trolley.value = trolley.id;
        fillMovement(form);
        status.textContent = `Scanned ${trolley.id}. Check the load and destination before recording departure.`;
        document.getElementById('stop-camera').hidden = true;
      } else {
        viewState.scanResult = { trolley, code, source: 'Camera' };
        viewState.recentScans.unshift({
          trolley: trolley.id,
          code,
          source: 'Camera',
          created: Date.now(),
        });
        setTimeout(render, 0);
      }
      return true;
    },
    (message) => {
      status.textContent = message;
      document.getElementById('stop-camera').hidden = true;
    },
  );
  status.textContent = 'Allow camera access, then point at the trolley QR label.';
  document.getElementById('stop-camera').hidden = false;
  try {
    await scanner.start();
  } catch (error) {
    stopCamera();
    status.textContent = error.message || 'Camera could not open. Use manual input.';
  }
}

application.addEventListener('input', (event) => {
  if (event.target.form && event.target.closest('.content'))
    event.target.form.dataset.dirty = 'true';
  if (event.target.form?.getAttribute('id') === 'move') {
    if (event.target.name === 'trolley') fillMovement(event.target.form);
    else movementPreview(event.target.form);
  }
});
application.addEventListener('change', (event) => {
  const form = event.target.form;
  if (form?.getAttribute('id') !== 'move') return;
  if (event.target.name === 'movement_type') {
    const groups = {
      'Production Issue': 'Production',
      'Production Return': 'Store',
      'Quality Inspection': 'Quality',
      'Quality Release': 'Packing',
      Packing: 'Packing',
      Dispatch: 'Dispatch',
      'Store Transfer': 'Store',
      Maintenance: 'Maintenance',
      'Outside Plant': 'Outside Plant',
    };
    const target = state.locations.find(
      (location) => location.active && location.group_name === groups[event.target.value],
    );
    if (target) {
      form.elements.destination.value = target.id;
      form.elements.department.value = target.department || '';
    }
    if (['Production Return', 'Maintenance', 'Store Transfer'].includes(event.target.value)) {
      form.elements.qty.value = 0;
      form.elements.product.value = '';
      form.elements.batch.value = 'EMPTY';
    }
  }
  if (event.target.name === 'destination')
    form.elements.department.value =
      state.locations.find((loc) => loc.id === event.target.value)?.department || '';
  movementPreview(form);
});

application.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button || mutationPending || (button.type === 'submit' && button.form)) return;
  try {
    if (button.hasAttribute('data-menu-toggle')) {
      const aside = document.getElementById('sidebar');
      aside.classList.toggle('open');
      application.querySelector('.sidebar-scrim').hidden = !aside.classList.contains('open');
      return;
    }
    if (button.hasAttribute('data-menu-close')) {
      document.getElementById('sidebar').classList.remove('open');
      button.hidden = true;
      return;
    }
    mutationPending = true;
    application.inert = true;
    button.disabled = true;
    const d = button.dataset;
    if (d.page) await navigate(d.page);
    else if (button.id === 'refresh') await refresh();
    else if (button.id === 'logout') {
      await api('logout', {});
      viewState = {
        theme: viewState.theme,
        fleetFilters: {},
        historyFilters: {},
        alertFilters: {},
        productFilters: {},
        auditFilter: {},
        recentScans: [],
      };
      currentPage = 'dashboard';
      history.replaceState(null, '', '#/dashboard');
      showLogin();
    } else if (button.id === 'start-camera') await startCamera();
    else if (button.id === 'stop-camera') stopCamera();
    else if (button.id === 'hide-secret') {
      readerSecret = null;
      render();
    } else if (d.theme) {
      applyTheme(d.theme);
      render();
    } else if ('resetDisplay' in d) {
      viewState = {
        theme: 'auto',
        fleetFilters: {},
        historyFilters: {},
        alertFilters: {},
        productFilters: {},
        auditFilter: {},
        recentScans: [],
      };
      applyTheme('auto');
      await refresh();
    } else if ('clearMaster' in d) {
      viewState.masterFilters = {};
      render();
    } else if ('masterPage' in d) {
      viewState.masterFilters = { ...viewState.masterFilters, page: Number(d.masterPage) };
      render();
    } else if ('clearFleet' in d) {
      viewState.fleetFilters = {};
      render();
    } else if ('clearHistory' in d) {
      viewState.historyFilters = {};
      await refresh();
    } else if ('fleetMode' in d) {
      viewState.fleetMode = d.fleetMode;
      render();
    } else if ('fleetPage' in d) {
      viewState.fleetFilters = { ...viewState.fleetFilters, page: Number(d.fleetPage) };
      render();
    } else if ('kpiStatus' in d) {
      viewState.fleetFilters = { status: d.kpiStatus, group: d.kpiGroup };
      await navigate('fleet');
    } else if (d.trolleyDetail) {
      viewState.selectedTrolley = d.trolleyDetail;
      await navigate('detail');
    } else if (d.filterLocation) {
      if (currentPage === 'locations') {
        viewState.locationFilter = d.filterLocation;
        render();
      } else {
        viewState.locationFilter = d.filterLocation;
        await navigate('locations');
      }
    } else if (d.reviseMovement) {
      const original = (state.historyPage?.items || state.movements).find(
        (m) => m.id === Number(d.reviseMovement),
      );
      if (!original || original.requested_by !== state.user.id)
        throw new Error('Choose your own corrected movement');
      viewState.movePrefill = Object.fromEntries(
        [
          'trolley',
          'destination',
          'product',
          'batch',
          'qty',
          'movement_type',
          'department',
          'reason',
          'remarks',
        ].map((key) => [key, original[key] ?? '']),
      );
      viewState.movePrefill.revision_of = original.id;
      await navigate('movement');
    } else if (d.prefillMove || d.return) {
      const trolley = state.trolleys.find((t) => t.id === (d.prefillMove || d.return));
      viewState.movePrefill = {
        trolley: trolley.id,
        product: trolley.product || '',
        qty: trolley.qty,
        batch: trolley.batch || 'EMPTY',
      };
      if (d.return) {
        const home = state.locations.find(
          (l) => l.active && (l.id === trolley.assigned_area || l.group_name === 'Store'),
        );
        Object.assign(viewState.movePrefill, {
          product: '',
          qty: 0,
          batch: 'EMPTY',
          movement_type: 'Production Return',
          destination: home?.id || '',
        });
      }
      await navigate('movement');
    } else if (d.reportIssue) {
      viewState.reportIssue = d.reportIssue;
      await navigate('alerts');
      document.getElementById('incident-report')?.scrollIntoView({ behavior: 'smooth' });
    } else if (d.reportView) {
      viewState.selectedReportKind = d.reportView;
      await navigate('reports');
      document.getElementById('report-preview-title')?.scrollIntoView();
    } else if (d.reportExport)
      await download(
        `reports/${d.reportExport}/${d.format}?` + query(viewState.historyFilters),
        `trolley-${d.reportExport}.${d.format}`,
      );
    else if (d.analyticsPeriod) {
      viewState.analyticsPeriod = d.analyticsPeriod;
      render();
    } else if (d.editMaster || d.editTrolley) {
      const kind = d.editMaster || 'trolleys';
      const id = d.id || d.editTrolley;
      viewState.editingMaster = { kind, record: state[kind].find((r) => r.id === id) };
      await navigate('masters');
    } else if ('cancelEdit' in d) {
      delete viewState.editingMaster;
      render();
    } else if ('cancelMovement' in d) {
      delete viewState.movePrefill;
      render();
    } else if (d.toggleMaster) {
      const record = state[d.toggleMaster].find((r) => r.id === d.id);
      await api(`${d.toggleMaster}/${encodeURIComponent(record.id)}/active`, {
        version: record.version,
        active: !record.active,
      });
      await refresh();
    } else if (d.label) {
      viewState.selectedTrolley = d.label;
      await navigate('detail');
    } else if (d.alertId) {
      await api(`alerts/${d.alertId}`, { status: d.alertStatus });
      await refresh();
    } else if (d.remind) {
      await api('reminders', { trolley: d.remind });
      notify('In-app reminder sent to the responsible operator.');
      await refresh();
    } else if (d.notificationRead) {
      await api(`notifications/${d.notificationRead}`, {});
      await refresh();
    } else if (d.requestVerification) {
      const reason = window.prompt('Reason for supervisor review (at least 10 characters)');
      if (!reason) return;
      await api('verification-approvals', { verification: Number(d.requestVerification), reason });
      notify('Independent review requested.');
      await refresh();
    } else if (d.verificationDecision) {
      const remarks = window.prompt(
        d.verificationDecision === 'Approved'
          ? 'Approval remarks (optional)'
          : 'Required decision remarks',
      );
      if (remarks === null || (!remarks && d.verificationDecision !== 'Approved')) return;
      await api(`verification-approvals/${d.id}`, { decision: d.verificationDecision, remarks });
      await refresh();
    } else if (d.more) {
      const key = d.more === 'history' ? 'historyPage' : 'auditPage';
      const filters = d.more === 'history' ? viewState.historyFilters : viewState.auditFilter;
      const next = await api(d.more + '?' + query({ ...filters, before: state[key].nextCursor }));
      state[key] = { items: [...state[key].items, ...next.items], nextCursor: next.nextCursor };
      render();
    } else if (d.historyMore) {
      const next = await api(
        'history?' + query({ trolley: d.historyMore, before: state.trolleyHistory.nextCursor }),
      );
      state.trolleyHistory = {
        items: [...state.trolleyHistory.items, ...next.items],
        nextCursor: next.nextCursor,
      };
      render();
    } else if (d.readerRotate || d.readerDisable) {
      if (!window.confirm('This invalidates the current reader credential. Continue?')) return;
      if (d.readerRotate) readerSecret = await api('readers/rotate', { id: d.readerRotate });
      else await api('readers/deactivate', { id: d.readerDisable });
      await refresh();
    } else if (d.deactivate) {
      if (!window.confirm('Deactivate this user and end their sessions?')) return;
      await api('users/deactivate', { id: Number(d.deactivate) });
      await refresh();
    } else if (d.action || d.receive) {
      const action = d.action || 'receive';
      const id = d.id || d.receive;
      const movement = (state.activeMovements || state.movements).find((r) => r.id === Number(id));
      let reason = '';
      if (
        ['reject', 'correct'].includes(action) ||
        (action === 'approve' && JSON.parse(movement.policy_flags || '[]').length)
      ) {
        reason = window.prompt('Decision reason (at least 10 characters)') || '';
        if (!reason) return;
      }
      await api(`movements/${id}/${action}`, { reason });
      notify('Movement updated.');
      await refresh();
    } else if (d.export) await exportMovements();
  } catch (error) {
    if (error.status === 401) showLogin();
    notify(error.message);
  } finally {
    mutationPending = false;
    application.inert = false;
    button.disabled = false;
  }
});

refresh().catch((error) => {
  showLogin();
  if (error.status !== 401) notify('Cannot reach the server. Try signing in again.');
});
setInterval(updateClock, 1000);
setInterval(async () => {
  if (
    !state ||
    mutationPending ||
    scanner ||
    application.querySelector('.content form[data-dirty]') ||
    application.contains(document.activeElement) ||
    ['history', 'audit', 'detail'].includes(currentPage)
  )
    return;
  try {
    await refresh();
  } catch (error) {
    if (error.status === 401) showLogin();
    else notify('Refresh failed. Displayed data may be out of date.');
  }
}, 15000);
window.addEventListener('popstate', () => {
  currentPage = pages.has(location.hash.slice(2)) ? location.hash.slice(2) : 'dashboard';
  refresh().catch((error) => notify(error.message));
});
window.addEventListener('pagehide', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.getElementById('sidebar')?.classList.remove('open');
    const scrim = application.querySelector('.sidebar-scrim');
    if (scrim) scrim.hidden = true;
  }
});
