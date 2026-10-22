import { api } from './api.js';
import { QrScanner } from './scanner.js';
import { shellView, loginView } from './experience-shell.js';
import { operationsView, trolleyModal, movementPreview } from './operations-views.js';
import { monitoringView } from './monitoring-views.js';

const app = document.getElementById('app');
const monitoringPages = new Set([
  'dashboard',
  'live',
  'overdue',
  'locations',
  'history',
  'reports',
  'analytics',
]);
const aliases = { fleet: 'live', masters: 'master' };
let state;
let page = aliases[location.hash.slice(2)] || location.hash.slice(2) || 'dashboard';
let busy = false;
let generation = 0;
let scanner;
let filterTimer;
let returnFocus;
const ui = {
  scan: { recent: [] },
  movement: {},
  reports: { type: 'daily' },
  history: {},
  settingsTab: 'general',
};
try {
  ui.theme = localStorage.getItem('stms-theme') || 'auto';
} catch {
  ui.theme = 'auto';
}

function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  ui.theme = theme;
  try {
    localStorage.setItem('stms-theme', theme);
  } catch {}
}

function toast(message, error = false) {
  const container = document.getElementById('toasts') || document.getElementById('notice');
  if (!container) return;
  const notice = document.createElement('div');
  notice.className = error ? 'toast danger' : 'toast';
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.textContent = message;
  container.append(notice);
  setTimeout(() => notice.remove(), 6000);
}

function stopCamera() {
  scanner?.stop();
  scanner = null;
  const stop = document.getElementById('stop-camera');
  if (stop) stop.hidden = true;
}

function clock() {
  const now = new Date();
  const time = document.getElementById('clk');
  const date = document.getElementById('clkd');
  if (time) time.textContent = now.toLocaleTimeString();
  if (date)
    date.textContent = now.toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
}

function render() {
  stopCamera();
  if (!state) {
    app.innerHTML = loginView();
    return;
  }
  const active = document.activeElement;
  const filter = active?.dataset.filter;
  const selection = active && 'selectionStart' in active ? active.selectionStart : null;
  const content = monitoringPages.has(page)
    ? monitoringView(page, state, ui)
    : operationsView(page, state, ui);
  const model = ui.modal ? trolleyModal(ui.modal.kind, state, ui) : null;
  app.innerHTML = shellView(state, page, content, { ...ui, modal: model });
  clock();
  if (filter) {
    const replacement = [...app.querySelectorAll('[data-filter]')].find(
      (element) => element.dataset.filter === filter,
    );
    replacement?.focus({ preventScroll: true });
    if (
      selection !== null &&
      replacement?.setSelectionRange &&
      ['text', 'search'].includes(replacement.type)
    )
      replacement.setSelectionRange(selection, selection);
  }
  if (ui.modal)
    app.querySelector('#modal input, #modal select, #modal textarea, #modal button')?.focus();
}

function queryString(values = {}, omit = []) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (
      value !== '' &&
      value !== undefined &&
      value !== null &&
      !['page', 'view', 'stack', 'filters', 'showFilters', 'over', ...omit].includes(key)
    )
      query.set(key, value);
  }
  return query.toString();
}

async function refresh() {
  const request = ++generation;
  const next = await api('state');
  const pages = next.user.access?.pages;
  if (pages && !pages.includes(page) && !['users', 'readers', 'policies', 'audit'].includes(page))
    page = 'dashboard';
  if (next.user.role === 'Admin') next.accounts = await api('users');
  const extra = [];
  if (page === 'history')
    extra.push(
      api('history?' + queryString(ui.history)).then((value) => {
        next.historyPage = value;
      }),
    );
  if (page === 'reports')
    extra.push(
      api(
        `reports/${ui.reports.type || 'daily'}?${queryString({ ...ui.reports, limit: 50 }, ['type'])}`,
      ).then((value) => {
        next.report = value;
      }),
    );
  if (page === 'analytics')
    extra.push(
      api('analytics?' + queryString(ui.analytics)).then((value) => {
        next.analytics = value;
      }),
    );
  if (page === 'settings' || ['users', 'readers', 'policies', 'audit'].includes(page)) {
    const tab = ['users', 'readers', 'policies', 'audit'].includes(page) ? page : ui.settingsTab;
    if (tab === 'policies')
      extra.push(
        api('policies').then((value) => {
          next.policy = value;
        }),
      );
    if (tab === 'readers')
      extra.push(
        api('readers').then((value) => {
          next.readerData = value;
        }),
      );
    if (tab === 'audit')
      extra.push(
        api('audit?' + queryString(ui.audit)).then((value) => {
          next.auditPage = value;
        }),
      );
  }
  await Promise.all(extra);
  if (request !== generation) return;
  next.readerSecret = state?.readerSecret;
  next.trolleyDetail = state?.trolleyDetail;
  state = next;
  const allowed = state.access?.pages || state.user.access?.pages;
  if (
    allowed &&
    !allowed.includes(page) &&
    !['users', 'readers', 'policies', 'audit'].includes(page)
  )
    page = 'dashboard';
  render();
}

async function navigate(target) {
  const permitted = state?.user.access?.pages;
  const destination = aliases[target] || target;
  if (
    permitted &&
    !permitted.includes(destination) &&
    !['users', 'readers', 'policies', 'audit'].includes(destination)
  )
    throw new Error('Your role cannot open this page');
  page = destination;
  ui.menuOpen = false;
  ui.notificationsOpen = false;
  ui.modal = null;
  if (state) state.readerSecret = null;
  if (location.hash !== '#/' + page) history.replaceState(null, '', '#/' + page);
  await refresh();
  window.scrollTo({ top: 0 });
}

async function openModal(kind, id, extra = {}) {
  const trigger = document.activeElement;
  returnFocus = trigger
    ? {
        action: trigger.dataset.action,
        id: trigger.dataset.id,
        page: trigger.dataset.page,
        text: trigger.textContent,
      }
    : null;
  if (id && ['detail', 'open-trolley', 'edit', 'edit-trolley', 'qr', 'qr-label'].includes(kind))
    state.trolleyDetail = await api('trolleys/' + encodeURIComponent(id));
  ui.modal = { kind, id, ...extra };
  ui.id = id;
  render();
}

function closeModal() {
  ui.modal = null;
  render();
  const trigger = [...app.querySelectorAll('button, a[data-page]')].find(
    (element) =>
      returnFocus &&
      element.dataset.action === returnFocus.action &&
      element.dataset.id === returnFocus.id &&
      element.dataset.page === returnFocus.page &&
      element.textContent === returnFocus.text,
  );
  (trigger || document.getElementById('view'))?.focus();
}

function formValues(form) {
  const values = Object.fromEntries(new FormData(form));
  for (const checkbox of form.querySelectorAll('input[type=checkbox]'))
    values[checkbox.name] = checkbox.checked;
  for (const input of form.querySelectorAll('input[type=number]')) {
    if (input.value !== '') values[input.name] = Number(input.value);
  }
  for (const input of form.querySelectorAll('input[type=datetime-local]'))
    values[input.name] = input.value ? new Date(input.value).getTime() : null;
  for (const key of ['operator_id', 'user_id', 'version', 'verification'])
    if (values[key] !== undefined && values[key] !== '') values[key] = Number(values[key]);
  if (typeof values.allowed_groups === 'string')
    values.allowed_groups = values.allowed_groups
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  return values;
}

async function download(path, fallback) {
  const response = await fetch('/api/' + path, { credentials: 'same-origin' });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Download failed');
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || fallback;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function scanCode(code, source = 'Manual') {
  try {
    const result = await api('trolleys/lookup?code=' + encodeURIComponent(code));
    const trolley = result.trolley || result;
    ui.scan.result = { ...trolley, id: trolley.id, source };
    ui.scan.recent = [{ id: trolley.id, source, at: Date.now(), code }, ...ui.scan.recent].slice(
      0,
      5,
    );
  } catch (error) {
    ui.scan.result = { error: error.message, source, code };
  }
  render();
}

async function startCamera() {
  const video = document.getElementById('scan-video');
  const status = document.getElementById('scan-status');
  if (!video || !status) throw new Error('Open the scan or movement page first');
  scanner = new QrScanner(
    video,
    (code) => {
      if (page === 'scan') {
        scanCode(code, 'Camera QR');
        return true;
      }
      const trolley = state.trolleys.find((record) =>
        [record.id, record.qr, record.rfid].includes(code.trim()),
      );
      if (!trolley) {
        status.textContent = 'QR value does not match a registered trolley.';
        return false;
      }
      const form = app.querySelector('[data-form=movement]');
      if (form) {
        for (const [name, value] of Object.entries({
          trolley: trolley.id,
          product: trolley.product || '',
          batch: trolley.batch || 'EMPTY',
          qty: trolley.qty,
          source: trolley.location,
        }))
          if (form.elements[name]) form.elements[name].value = value;
        if (form.elements.version) form.elements.version.value = trolley.version;
      }
      status.textContent = `Scanned ${trolley.id}. Check the load and destination before recording departure.`;
      const stop = document.getElementById('stop-camera');
      if (stop) stop.hidden = true;
      return true;
    },
    (message) => {
      status.textContent = message;
      stopCamera();
    },
  );
  status.textContent = 'Allow camera access, then point at the trolley QR label.';
  const stop = document.getElementById('stop-camera');
  if (stop) stop.hidden = false;
  try {
    await scanner.start();
  } catch (error) {
    stopCamera();
    status.textContent = error.message;
  }
}

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const kind = form.dataset.form || form.id;
  if (!kind || busy) return;
  if (kind === 'scan' || kind === 'global-search') {
    const input = formValues(form);
    const code = input.code || input.trolley || input.scan;
    if (kind === 'global-search') {
      const result = await api('trolleys/lookup?code=' + encodeURIComponent(code)).catch(
        (error) => {
          toast(error.message, true);
        },
      );
      if (result) await openModal('detail', (result.trolley || result).id);
    } else await scanCode(code);
    return;
  }
  busy = true;
  const submit = form.querySelector('[type=submit]');
  const errorLabel = form.querySelector('.error, [data-error]');
  if (submit) submit.disabled = true;
  if (errorLabel) errorLabel.textContent = '';
  try {
    const input = formValues(form);
    if (kind === 'login') {
      await api('login', input);
      await refresh();
      return;
    }
    if (kind === 'movement' || kind === 'move') {
      const trolley = state.trolleys.find((record) => record.id === input.trolley);
      input.version = Number(input.version || trolley?.version);
      if (!input.expected) delete input.expected;
      if (!input.occurred) delete input.occurred;
      input.product ||= null;
      const signature = JSON.stringify(input);
      if (form.dataset.signature !== signature) {
        form.dataset.signature = signature;
        form.dataset.key = crypto.randomUUID();
      }
      const correction = input.correction_of || ui.movement.correction_of;
      const result = await api(correction ? `approvals/${correction}/resubmit` : 'movements', {
        ...input,
        key: form.dataset.key,
      });
      ui.movement = {};
      ui.lastMovement = result;
      toast(result.state === 'Pending' ? 'Movement is waiting for approval' : 'Movement recorded');
    } else if (kind === 'trolley') {
      const id = input.id;
      const edit = input.edit === 'true' || ui.modal?.kind?.includes('edit');
      delete input.edit;
      if (!edit && !input.qr) delete input.qr;
      await api(edit ? `trolleys/${encodeURIComponent(id)}` : 'trolleys', input);
    } else if (kind === 'location' || kind === 'product') {
      const collection = kind === 'location' ? 'locations' : 'products';
      const edit = input.edit === 'true';
      delete input.edit;
      await api(edit ? `${collection}/${encodeURIComponent(input.id)}` : collection, input);
    } else if (kind === 'verify') {
      ui.verification = await api('verify', input);
      if (ui.correctionApproval) {
        await api(`approvals/${ui.correctionApproval}/resubmit`, {
          verification: ui.verification.id,
        });
        ui.correctionApproval = null;
        toast('Corrected verification resubmitted for review');
      }
    } else if (kind === 'issue') {
      await api('alerts', {
        ...input,
        trolley: input.trolley || ui.modal?.id,
        message: input.message || input.detail || input.remarks,
      });
    } else if (kind === 'resolve-alert') {
      await api(`alerts/${input.id}/resolve`, { resolution: input.resolution });
    } else if (kind === 'approval-decision') {
      const id = input.id || ui.modal?.approvalId || ui.modal?.id;
      const decision = input.decision || ui.modal?.decision;
      await api(`approvals/${id}/${decision}`, { reason: input.reason || input.remarks || '' });
    } else if (kind === 'settings') {
      await api('settings', input);
    } else if (kind === 'user' || kind === 'users') {
      await api('users', input);
    } else if (kind.startsWith('policy-')) {
      const type = kind.replace('policy-', '');
      await api('policies/' + type, input);
    } else if (kind === 'reader' || kind === 'readers') {
      state.readerSecret = await api('readers', input);
    } else if (kind === 'tag' || kind === 'tags') {
      await api('tags', input);
    } else if (kind === 'history-filter') {
      ui.history = input;
    } else if (kind === 'report-filter') {
      Object.assign(ui.reports, input);
    } else throw new Error('This action is not available');
    ui.modal = null;
    await refresh();
    if (!['verify', 'history-filter', 'report-filter', 'movement', 'move'].includes(kind))
      toast('Saved successfully');
  } catch (error) {
    if (error.status === 401 && kind !== 'login') {
      state = null;
      render();
    } else if (errorLabel?.isConnected) errorLabel.textContent = error.message;
    else toast(error.message, true);
  } finally {
    busy = false;
    if (submit?.isConnected) submit.disabled = false;
  }
});

async function act(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (button.dataset.page && action !== 'paginate') return navigate(button.dataset.page);
  if (action === 'menu') {
    ui.menuOpen = !ui.menuOpen;
    render();
  } else if (action === 'close-menu') {
    ui.menuOpen = false;
    render();
  } else if (action === 'close-modal') closeModal();
  else if (action === 'logout' || button.id === 'logout') {
    await api('logout', {});
    state = null;
    ui.modal = null;
    render();
  } else if (action === 'refresh' || button.id === 'refresh') await refresh();
  else if (action === 'theme') {
    applyTheme(button.dataset.theme || button.dataset.value || 'auto');
    render();
  } else if (action === 'notifications') {
    ui.notificationsOpen = !ui.notificationsOpen;
    render();
  } else if (action === 'notifications-read') {
    await api('notifications/read', { all: true });
    await refresh();
  } else if (action === 'settings-tab') {
    ui.settingsTab = button.dataset.tab;
    await refresh();
  } else if (
    [
      'add-trolley',
      'edit-trolley',
      'open-trolley',
      'qr-label',
      'report-issue',
      'add-location',
      'add-product',
      'receive-trolley',
    ].includes(action)
  ) {
    const kinds = {
      'add-trolley': 'add',
      'edit-trolley': 'edit',
      'open-trolley': 'detail',
      'qr-label': 'qr',
      'report-issue': 'issue',
      'add-location': 'location',
      'add-product': 'product',
      'receive-trolley': 'receive',
    };
    await openModal(kinds[action], id);
  } else if (action === 'move-trolley') {
    const trolley = state.trolleys.find((record) => record.id === id);
    ui.movement = { ...trolley, trolley: id, source: trolley?.location, expected: null };
    await navigate('movement');
  } else if (action === 'toggle-trolley') {
    const trolley = state.trolleys.find((record) => record.id === id);
    if (!confirm(`${trolley.active ? 'Deactivate' : 'Activate'} ${id}?`)) return;
    await api(`trolleys/${encodeURIComponent(id)}/active`, {
      active: !trolley.active,
      version: trolley.version,
    });
    await refresh();
  } else if (action === 'camera-start' || button.id === 'start-camera') await startCamera();
  else if (action === 'camera-stop' || button.id === 'stop-camera') stopCamera();
  else if (action === 'scan-recent')
    await scanCode(button.dataset.code || id, button.dataset.source || 'Recent');
  else if (action === 'request-mismatch') {
    if (!ui.verification?.id) throw new Error('Verify the trolley and product first');
    await api('approvals/mismatch', {
      verification: ui.verification.id,
      remarks: 'Product scan mismatch requires review',
    });
    await refresh();
    toast('Mismatch approval requested');
  } else if (action === 'decide-approval')
    await openModal('decision', id, { approvalId: id, decision: button.dataset.decision });
  else if (action === 'resubmit-approval') {
    const approval = state.approvals.find((record) => String(record.id) === id);
    const payload =
      typeof approval.payload === 'string' ? JSON.parse(approval.payload) : approval.payload;
    if (approval.movement_id) {
      ui.movement = {
        ...(payload.input || payload),
        trolley: approval.trolley,
        correction_of: approval.id,
        expected: null,
        occurred: null,
      };
      await navigate('movement');
    } else {
      ui.verify = { trolley: approval.trolley, product: approval.product };
      ui.correctionApproval = approval.id;
      await navigate('products');
      toast('Verify the corrected product, then resubmit the verification for review');
    }
  } else if (
    ['receive-movement', 'receive'].includes(action) ||
    button.dataset.action === 'confirm-arrival'
  ) {
    await api(`movements/${id}/receive`, {});
    ui.modal = null;
    await refresh();
  } else if (action === 'resolve-alert') await openModal('resolve-alert', id);
  else if (action === 'acknowledge-alert' || action === 'reopen-alert') {
    await api(
      `alerts/${id}/${{ 'acknowledge-alert': 'acknowledge', 'resolve-alert': 'resolve', 'reopen-alert': 'reopen' }[action]}`,
      {},
    );
    await refresh();
  } else if (action === 'overdue-remind') {
    await api(`overdue/${encodeURIComponent(id)}/remind`, {});
    await refresh();
    toast('Reminder delivered to the responsible user in the app');
  } else if (action === 'overdue-return') {
    if (!confirm('Confirm the trolley has physically returned?')) return;
    await api(`overdue/${encodeURIComponent(id)}/return`, {
      version: state.trolleys.find((record) => record.id === id)?.version,
      key: crypto.randomUUID(),
    });
    await refresh();
  } else if (action === 'fleet-view') {
    (ui.live ||= {}).view = button.dataset.view;
    render();
  } else if (action === 'location-detail') {
    ui.locations = { ...ui.locations, id, selected: id };
    render();
  } else if (action === 'dashboard-focus') {
    ui.live = { status: '', location: '', type: '', q: '' };
    const target = button.dataset.target;
    if (button.dataset.status) ui.live.status = button.dataset.status;
    else if (
      !button.dataset.group &&
      ['Available', 'In Use', 'In Transit', 'Overdue', 'Outside Plant'].includes(target)
    )
      ui.live.status = target;
    if (button.dataset.group) ui.live.group = button.dataset.group;
    await navigate('live');
  } else if (action === 'paginate') {
    const section = button.dataset.section || button.dataset.target || page;
    const filter = (ui[section] ||= {});
    filter.page = button.dataset.page
      ? Number(button.dataset.page)
      : Math.max(1, Number(filter.page || 1) + Number(button.dataset.direction || 1));
    render();
  } else if (action === 'history-next') {
    if (state.historyPage?.nextCursor) {
      (ui.history.stack ||= []).push(ui.history.before || '');
      ui.history.before = state.historyPage.nextCursor;
      await refresh();
    }
  } else if (action === 'history-prev') {
    ui.history.before = ui.history.stack?.pop() || '';
    await refresh();
  } else if (action === 'history-export')
    await download(
      `history/export?${queryString({ ...ui.history, before: '', format: button.dataset.format })}`,
      'movement-history.' + button.dataset.format,
    );
  else if (action === 'export-report')
    await download(
      `reports/${button.dataset.type || ui.reports.type}/export?${queryString({ ...ui.reports, format: button.dataset.format }, ['type'])}`,
      'report.' + button.dataset.format,
    );
  else if (action === 'report-select' || action === 'report-generate') {
    ui.reports.type = button.dataset.type || ui.reports.type;
    await refresh();
  } else if (action === 'clear-movement') {
    ui.movement = {};
    render();
  } else if (action === 'history-filters') {
    ui.history.filters = ui.history.filters === false;
    render();
  } else if (action === 'analytics-period') {
    (ui.analytics ||= {}).over = button.dataset.period;
    ui.analytics.period = button.dataset.period;
    await refresh();
  } else if (action === 'clear-filters') {
    ui[button.dataset.target || page] = {};
    await refresh();
  } else if (action === 'alert-priority') {
    (ui.alerts ||= {}).priority =
      ui.alerts.priority === button.dataset.priority ? '' : button.dataset.priority;
    render();
  } else if (action === 'alert-resolved') {
    (ui.alerts ||= {}).status = ui.alerts.status === 'Resolved' ? '' : 'Resolved';
    render();
  } else if (action === 'load-audit') {
    const before = state.auditPage?.nextCursor;
    if (before) {
      const next = await api('audit?' + queryString({ ...ui.audit, before }));
      state.auditPage = {
        items: [...state.auditPage.items, ...next.items],
        nextCursor: next.nextCursor,
      };
      render();
    }
  } else if (action === 'load-demo' || action === 'reset-demo') {
    const reset = action === 'reset-demo';
    if (
      reset &&
      prompt('Type RESET DEMO DATA to restore the sample plant while retaining history.') !==
        'RESET DEMO DATA'
    )
      return;
    if (
      !reset &&
      !confirm('Load the reference 128-trolley sample plant? This requires an empty installation.')
    )
      return;
    await api(`demo/${reset ? 'reset' : 'load'}`, reset ? { confirm: 'RESET DEMO DATA' } : {});
    await refresh();
    toast('Sample plant is ready');
  } else if (button.dataset.deactivate) {
    if (!confirm('Deactivate this user and end their sessions?')) return;
    await api('users/deactivate', { id: Number(button.dataset.deactivate) });
    await refresh();
  } else if (button.dataset.readerRotate || button.dataset.readerDisable) {
    const reader = button.dataset.readerRotate || button.dataset.readerDisable;
    const result = await api(`readers/${button.dataset.readerRotate ? 'rotate' : 'deactivate'}`, {
      id: reader,
    });
    if (button.dataset.readerRotate) state.readerSecret = result;
    await refresh();
  } else if (button.id === 'hide-secret' || action === 'hide-secret') {
    state.readerSecret = null;
    render();
  }
}

app.addEventListener('click', async (event) => {
  if (event.target.id === 'ovl') {
    closeModal();
    return;
  }
  const button = event.target.closest('button, a[data-page], [data-action]');
  if (!button || busy) return;
  if (button.matches('a[data-page]')) event.preventDefault();
  if (button.type === 'submit' && button.form) return;
  busy = true;
  try {
    await act(button);
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
  }
});

app.addEventListener('input', (event) => {
  const input = event.target;
  const movement = input.closest('[data-form=movement]');
  if (movement) {
    if (input.name === 'trolley') {
      const trolley = state.trolleys.find((record) => record.id === input.value);
      if (trolley) {
        for (const [name, value] of Object.entries({
          source: trolley.location,
          product: trolley.product || '',
          batch: trolley.batch || 'EMPTY',
          qty: trolley.qty,
          version: trolley.version,
          operator_id: trolley.operator_id || state.user.id,
        }))
          if (movement.elements[name]) movement.elements[name].value = value;
        movement.dataset.trolley = trolley.id;
      }
    }
    ui.movement = Object.fromEntries(new FormData(movement));
    ui.movement.direct_complete = movement.elements.direct_complete?.checked || false;
    const preview = document.getElementById('movement-preview');
    if (preview) preview.innerHTML = movementPreview(state, formValues(movement));
  }
  if (!input.dataset.filter) return;
  const [section, name] = input.dataset.filter.split('.');
  const values = (ui[section] ||= {});
  values[name] = input.value;
  if (name !== 'page') values.page = 1;
  if (section === 'history') {
    delete values.before;
    values.stack = [];
  }
  clearTimeout(filterTimer);
  filterTimer = setTimeout(
    () => {
      if (['history', 'reports', 'analytics', 'audit'].includes(section))
        refresh().catch((error) => toast(error.message, true));
      else render();
    },
    input.matches('select') ? 0 : 200,
  );
});

app.addEventListener('change', (event) => {
  const editor = event.target.closest('[data-form=trolley]');
  if (editor && editor.dataset.edit !== 'true' && event.target.name === 'type') {
    const defaults = {
      'Material Trolley': [500, 'Raw Material'],
      'Component Trolley': [350, 'Component'],
      'Finished Goods': [600, 'Finished Goods'],
      'WIP Trolley': [400, 'WIP'],
      'Rework Trolley': [300, 'Rework'],
    }[event.target.value];
    if (defaults) {
      editor.elements.capacity.value = defaults[0];
      editor.elements.material_type.value = defaults[1];
    }
    return;
  }
  const form = event.target.closest('[data-form=movement]');
  if (!form) return;
  if (event.target.name === 'movement_type') {
    const destinationGroup = {
      'Production Issue': 'Production',
      'Production Return': 'Store',
      'Quality Inspection': 'Quality',
      'Quality Release': 'Packing',
      Packing: 'Packing',
      Dispatch: 'Dispatch',
      'Store Transfer': 'Store',
      Maintenance: 'Maintenance',
      'Outside Plant': 'Outside Plant',
    }[event.target.value];
    const destination = state.locations.find(
      (location) =>
        location.group_name === destinationGroup && location.id !== form.elements.source.value,
    );
    if (destination) form.elements.destination.value = destination.id;
    document.getElementById('movement-preview').innerHTML = movementPreview(
      state,
      formValues(form),
    );
    return;
  }
  if (event.target.name !== 'trolley') return;
  const trolley = state.trolleys.find((record) => record.id === event.target.value);
  if (!trolley) return;
  if (form.dataset.trolley === trolley.id) return;
  form.dataset.trolley = trolley.id;
  for (const [name, value] of Object.entries({
    source: trolley.location,
    product: trolley.product || '',
    batch: trolley.batch || 'EMPTY',
    qty: trolley.qty,
    version: trolley.version,
    operator_id: trolley.operator_id || state.user.id,
  }))
    if (form.elements[name]) form.elements[name].value = value;
  const preview = document.getElementById('movement-preview');
  if (preview) preview.innerHTML = movementPreview(state, formValues(form));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (ui.modal) closeModal();
    else {
      ui.menuOpen = false;
      ui.notificationsOpen = false;
      if (state) render();
    }
  }
  if (event.key !== 'Tab' || !ui.modal) return;
  const focusable = [
    ...app.querySelectorAll(
      '#modal button, #modal input, #modal select, #modal textarea, #modal a[href]',
    ),
  ].filter((node) => !node.disabled && node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
window.addEventListener('hashchange', () =>
  navigate(location.hash.slice(2)).catch((error) => toast(error.message, true)),
);
window.addEventListener('pagehide', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
});
applyTheme(ui.theme);
refresh().catch((error) => {
  state = null;
  render();
  if (error.status !== 401) toast(error.message, true);
});
setInterval(clock, 1000);
setInterval(() => {
  if (
    !state ||
    busy ||
    scanner ||
    ui.modal ||
    document.hidden ||
    app.contains(document.activeElement) ||
    app.querySelector('form:not([data-form=global-search])')
  )
    return;
  refresh().catch((error) => {
    if (error.status === 401) {
      state = null;
      render();
    } else toast(error.message, true);
  });
}, 15000);
