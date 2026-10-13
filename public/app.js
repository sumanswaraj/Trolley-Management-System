import { QrScanner } from './scanner.js';
import { api } from './api.js';
import { loginView, workspaceView, fleetTable } from './views.js';

const application = document.getElementById('app');
let state = null;
let currentPage = 'dashboard';
let mutationPending = false;
let scanner = null;
let readerSecret = null;

function notify(message) {
  const notice = document.getElementById('notice');
  notice.textContent = message;
  notice.style.display = 'block';
  setTimeout(() => {
    notice.style.display = 'none';
  }, 4000);
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
function render() {
  stopCamera();
  state.readerSecret = readerSecret;
  application.innerHTML = workspaceView(state, currentPage);
}
async function refresh() {
  try {
    const updatedState = await api('state');
    if (updatedState.user.role === 'Admin') updatedState.accounts = await api('users');
    if (currentPage === 'policies' && ['Admin', 'Supervisor'].includes(updatedState.user.role))
      updatedState.policy = await api('policies');
    if (currentPage === 'readers' && updatedState.user.role === 'Admin')
      updatedState.readerData = await api('readers');
    if (currentPage === 'history') updatedState.historyPage = await api('history');
    if (currentPage === 'audit' && ['Admin', 'Supervisor'].includes(updatedState.user.role))
      updatedState.auditPage = await api('audit');
    if (currentPage === 'reports') updatedState.report = await api('reports/summary');
    state = updatedState;
    render();
  } catch (error) {
    if (error.status === 401) showLogin();
    throw error;
  }
}

/** Keep a request key on the form so a network retry cannot duplicate departure. */
async function submitMovement(form, input) {
  const trolley = state.trolleys.find((record) => record.id === input.trolley.trim());
  if (!trolley) throw new Error('Unknown trolley ID');
  const payload = {
    ...input,
    trolley: trolley.id,
    qty: Number(input.qty),
    version: trolley.version,
    expected: new Date(input.expected).getTime(),
  };
  const signature = JSON.stringify(payload);
  if (form.dataset.signature !== signature) {
    form.dataset.signature = signature;
    form.dataset.requestKey = crypto.randomUUID();
  }
  await api('movements', { ...payload, key: form.dataset.requestKey });
}

application.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (mutationPending) return;
  const form = event.target;
  // Named form controls such as 'id' can shadow DOM properties.
  const formId = form.getAttribute('id');
  const submit = form.querySelector('button[type=submit]');
  const errorLabel = form.querySelector('.error');
  mutationPending = true;
  submit.disabled = true;
  errorLabel.textContent = '';
  try {
    const input = Object.fromEntries(new FormData(form));
    if (formId === 'login') {
      await api('login', input);
      await refresh();
      return;
    }
    if (formId === 'report-filter') {
      state.report = await api(
        `reports/summary?from=${new Date(input.from).getTime()}&to=${new Date(input.to).getTime()}`,
      );
      render();
      return;
    }
    if (formId === 'move') await submitMovement(form, input);
    else if (formId.startsWith('policy-')) {
      const kind = formId.replace('policy-', '');
      if (kind === 'settings') {
        for (const key of ['enforce_routes', 'enforce_categories', 'scope_operations'])
          input[key] = form.elements[key].checked;
      }
      if (kind === 'routes') input.requires_quality = form.elements.requires_quality.checked;
      if (kind === 'scopes') {
        input.user_id = Number(input.user_id);
        input.can_depart = form.elements.can_depart.checked;
        input.can_receive = form.elements.can_receive.checked;
      }
      await api(`policies/${kind}`, input);
    } else if (formId === 'readers') readerSecret = await api('readers', input);
    else {
      if (formId === 'locations') input.external = form.elements.external.checked;
      if (formId === 'trolleys') input.capacity = Number(input.capacity);
      await api(formId, input);
    }
    notify('Saved successfully');
    await refresh();
  } catch (error) {
    if (error.status === 401 && formId !== 'login') showLogin();
    else errorLabel.textContent = error.message;
  } finally {
    mutationPending = false;
    submit.disabled = false;
  }
});

application.addEventListener('input', (event) => {
  if (event.target.id !== 'search') return;
  const query = event.target.value.toLowerCase();
  const matching = state.trolleys.filter((trolley) => {
    const location =
      state.locations.find((record) => record.id === trolley.location)?.name || trolley.location;
    return [trolley.id, trolley.type, location].join(' ').toLowerCase().includes(query);
  });
  document.getElementById('fleet').innerHTML = fleetTable(state, matching);
});

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
    'exception_reason',
    'decision_reason',
  ];
  const csvCell = (value) =>
    '"' +
    String(value ?? '')
      .replace(/^[\s]*[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const rows = [fields.join(',')];
  let cursor = null;
  do {
    const page = await api(`history?limit=100${cursor ? '&before=' + cursor : ''}`);
    rows.push(
      ...page.items.map((record) => fields.map((field) => csvCell(record[field])).join(',')),
    );
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
    (value) => {
      const trolley = state.trolleys.find((record) => record.id === value.trim());
      if (!trolley) {
        status.textContent = 'QR value does not match a registered trolley.';
        return false;
      }
      const form = document.getElementById('move');
      form.elements.trolley.value = trolley.id;
      form.elements.product.value = trolley.product || '';
      form.elements.qty.value = trolley.qty;
      form.elements.batch.value = trolley.batch || 'EMPTY';
      status.textContent = `Scanned ${trolley.id}. Check the load and destination before recording departure.`;
      document.getElementById('stop-camera').hidden = true;
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

application.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button || mutationPending) return;
  try {
    if (button.dataset.page) {
      readerSecret = null;
      currentPage = button.dataset.page;
      await refresh();
    } else if (button.id === 'refresh') await refresh();
    else if (button.id === 'logout') {
      await api('logout', {});
      showLogin();
    } else if (button.id === 'start-camera') {
      button.disabled = true;
      await startCamera();
    } else if (button.id === 'stop-camera') stopCamera();
    else if (button.id === 'hide-secret') {
      readerSecret = null;
      render();
    } else if (button.dataset.more) {
      mutationPending = true;
      const key = button.dataset.more === 'history' ? 'historyPage' : 'auditPage';
      const next = await api(`${button.dataset.more}?before=${state[key].nextCursor}`);
      state[key] = { items: [...state[key].items, ...next.items], nextCursor: next.nextCursor };
      render();
    } else if (button.dataset.readerRotate || button.dataset.readerDisable) {
      mutationPending = true;
      button.disabled = true;
      if (
        !window.confirm(
          'This change immediately invalidates the current reader credential. Continue?',
        )
      )
        return;
      if (button.dataset.readerRotate)
        readerSecret = await api('readers/rotate', { id: button.dataset.readerRotate });
      else await api('readers/deactivate', { id: button.dataset.readerDisable });
      await refresh();
    } else if (button.dataset.action || button.dataset.deactivate) {
      mutationPending = true;
      button.disabled = true;
      if (button.dataset.deactivate) {
        if (!window.confirm('Deactivate this user and end all their sessions?')) return;
        await api('users/deactivate', { id: Number(button.dataset.deactivate) });
      } else {
        let reason = '';
        const movement = (state.activeMovements || state.movements).find(
          (record) => record.id === Number(button.dataset.id),
        );
        if (
          button.dataset.action === 'approve' &&
          JSON.parse(movement.policy_flags || '[]').length
        ) {
          reason =
            window.prompt('Why is this policy exception approved? Enter at least 10 characters.') ||
            '';
          if (!reason) return;
        }
        await api(`movements/${button.dataset.id}/${button.dataset.action}`, { reason });
      }
      notify('Record updated');
      await refresh();
    } else if (button.dataset.export) {
      mutationPending = true;
      button.disabled = true;
      await exportMovements();
    }
  } catch (error) {
    if (error.status === 401) showLogin();
    notify(error.message);
  } finally {
    mutationPending = false;
    button.disabled = false;
  }
});

refresh().catch((error) => {
  if (error.status === 401) showLogin();
  else {
    showLogin();
    notify('Cannot reach the server. Check the connection and try signing in.');
  }
});
// Never redraw a page with an active form or destroy an operator's unsaved input.
setInterval(async () => {
  if (
    !state ||
    mutationPending ||
    scanner ||
    application.querySelector('form') ||
    application.contains(document.activeElement) ||
    currentPage === 'history' ||
    currentPage === 'audit'
  )
    return;
  try {
    await refresh();
  } catch (error) {
    if (error.status !== 401) notify('Refresh failed. Displayed data may be out of date.');
  }
}, 15000);

window.addEventListener('pagehide', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
});
