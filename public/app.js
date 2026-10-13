import { api } from './api.js';
import { loginView, workspaceView, fleetTable } from './views.js';

const application = document.getElementById('app');
let state = null;
let currentPage = 'dashboard';
let mutationPending = false;

function notify(message) {
  const notice = document.getElementById('notice');
  notice.textContent = message;
  notice.style.display = 'block';
  setTimeout(() => { notice.style.display = 'none'; }, 4000);
}
function showLogin() {
  state = null;
  application.innerHTML = loginView();
}
function render() {
  application.innerHTML = workspaceView(state, currentPage);
}
async function refresh() {
  try {
    const updatedState = await api('state');
    if (updatedState.user.role === 'Admin') updatedState.accounts = await api('users');
    state = updatedState;
    render();
  } catch (error) {
    if (error.status === 401) showLogin();
    throw error;
  }
}

/** Keep a request key on the form so a network retry cannot duplicate departure. */
async function submitMovement(form, input) {
  const trolley = state.trolleys.find(record => record.id === input.trolley.trim());
  if (!trolley) throw new Error('Unknown trolley ID');
  const payload = {
    ...input, trolley: trolley.id, qty: Number(input.qty), version: trolley.version,
    expected: new Date(input.expected).getTime(),
  };
  const signature = JSON.stringify(payload);
  if (form.dataset.signature !== signature) {
    form.dataset.signature = signature;
    form.dataset.requestKey = crypto.randomUUID();
  }
  await api('movements', { ...payload, key: form.dataset.requestKey });
}

application.addEventListener('submit', async event => {
  event.preventDefault();
  if (mutationPending) return;
  const form = event.target;
  const submit = form.querySelector('button[type=submit]');
  const errorLabel = form.querySelector('.error');
  mutationPending = true;
  submit.disabled = true;
  errorLabel.textContent = '';
  try {
    const input = Object.fromEntries(new FormData(form));
    if (form.id === 'login') {
      await api('login', input);
      await refresh();
      return;
    }
    if (form.id === 'move') await submitMovement(form, input);
    else {
      if (form.id === 'locations') input.external = form.elements.external.checked;
      if (form.id === 'trolleys') input.capacity = Number(input.capacity);
      await api(form.id, input);
    }
    notify('Saved successfully');
    await refresh();
  } catch (error) {
    if (error.status === 401 && form.id !== 'login') showLogin();
    else errorLabel.textContent = error.message;
  } finally {
    mutationPending = false;
    submit.disabled = false;
  }
});

application.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  const query = event.target.value.toLowerCase();
  const matching = state.trolleys.filter(trolley => {
    const location = state.locations.find(record => record.id === trolley.location)?.name || trolley.location;
    return [trolley.id, trolley.type, location].join(' ').toLowerCase().includes(query);
  });
  document.getElementById('fleet').innerHTML = fleetTable(state, matching);
});

function exportMovements() {
  const fields = ['id', 'trolley', 'source', 'destination', 'state', 'product', 'batch', 'qty', 'created', 'received'];
  // Neutralize formula prefixes before exporting user-entered strings to Excel.
  const csvCell = value => '"' + String(value ?? '').replace(/^[\s]*[=+@-]/, "'$&").replace(/"/g, '""') + '"';
  const csv = [fields.join(','), ...state.movements.map(record => fields.map(field => csvCell(record[field])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'trolley-movements.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

application.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || mutationPending) return;
  try {
    if (button.dataset.page) {
      currentPage = button.dataset.page;
      render();
    } else if (button.id === 'refresh') await refresh();
    else if (button.id === 'logout') {
      await api('logout', {});
      showLogin();
    } else if (button.dataset.action || button.dataset.deactivate) {
      mutationPending = true;
      button.disabled = true;
      if (button.dataset.deactivate) {
        if (!window.confirm('Deactivate this user and end all their sessions?')) return;
        await api('users/deactivate', { id: Number(button.dataset.deactivate) });
      } else {
        await api(`movements/${button.dataset.id}/${button.dataset.action}`, {});
      }
      notify('Record updated');
      await refresh();
    } else if (button.dataset.export) exportMovements();
  } catch (error) {
    if (error.status === 401) showLogin();
    notify(error.message);
  } finally {
    mutationPending = false;
    button.disabled = false;
  }
});

refresh().catch(error => {
  if (error.status === 401) showLogin();
  else {
    showLogin();
    notify('Cannot reach the server. Check the connection and try signing in.');
  }
});
// Never redraw a page with an active form or destroy an operator's unsaved input.
setInterval(async () => {
  if (!state || mutationPending || application.querySelector('form')) return;
  try { await refresh(); }
  catch (error) { if (error.status !== 401) notify('Refresh failed. Displayed data may be out of date.'); }
}, 15000);
