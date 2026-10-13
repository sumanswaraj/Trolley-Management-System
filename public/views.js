import {
  escapeHtml as escape, formatTime, canManagePlant, inputField, selectField,
  optionsFor, form, dataTable, pageTitle,
} from './ui.js';

const locationName = (state, id) => state.locations.find(location => location.id === id)?.name || id;
const productName = (state, id) => state.products.find(product => product.id === id)?.name || 'Empty';
const openMovements = state => state.movements.filter(movement => ['Pending', 'In Transit'].includes(movement.state));

export function loginView() {
  return `<section class="login"><div class="card">
    <h1>Smart Trolley Management</h1>
    <p class="subtitle">Sign in to your plant workspace.</p>
    ${form('login',
      inputField('Username', 'username', 'text', 'autocomplete="username"') +
      inputField('Password', 'password', 'password', 'autocomplete="current-password"'), 'Sign in')}
    <p class="hint">First login: admin and the password configured on your server.</p>
  </div></section>`;
}

export function fleetTable(state, trolleys = state.trolleys) {
  return dataTable(['ID', 'Type', 'Location', 'State', 'Product / batch', 'Load'], trolleys.map(trolley => `<tr>
    <td><b>${escape(trolley.id)}</b></td>
    <td>${escape(trolley.type)}</td>
    <td>${escape(locationName(state, trolley.location))}</td>
    <td><span class="badge">${escape(trolley.status)}</span></td>
    <td>${escape(productName(state, trolley.product))}<div class="hint">${escape(trolley.batch)}</div></td>
    <td>${trolley.qty} / ${trolley.capacity}</td>
  </tr>`));
}

function movementTable(state, movements, mode = 'history') {
  return dataTable(['Trolley', 'Route', 'State', 'Requested', 'Actions'], movements.map(movement => {
    let actions = '—';
    if (mode === 'receive') {
      actions = `<button class="btn primary" data-action="receive" data-id="${movement.id}">Confirm arrival</button>`;
    } else if (mode === 'approve' && canManagePlant(state.user) && movement.requested_by !== state.user.id) {
      actions = `<button class="btn" data-action="approve" data-id="${movement.id}">Approve</button>
        <button class="btn danger" data-action="reject" data-id="${movement.id}">Reject</button>`;
    }
    return `<tr>
      <td><b>${escape(movement.trolley)}</b><div class="hint">${escape(productName(state, movement.product))} · ${movement.qty}</div></td>
      <td>${escape(locationName(state, movement.source))} → ${escape(locationName(state, movement.destination))}</td>
      <td><span class="badge">${escape(movement.state)}</span></td>
      <td>${formatTime(movement.created)}<div class="hint">${escape(movement.requester)}</div></td>
      <td><div class="actions">${actions}</div></td>
    </tr>`;
  }));
}

function dashboardView(state) {
  const open = openMovements(state);
  const metrics = [
    ['Fleet', state.trolleys.length],
    ['Available', state.trolleys.filter(trolley => trolley.status === 'Available').length],
    ['In transit', open.filter(movement => movement.state === 'In Transit').length],
    ['Overdue', open.filter(movement => movement.expected < Date.now()).length],
  ];
  const attention = open.filter(movement => movement.state === 'Pending' || movement.expected < Date.now());
  return `${pageTitle('Plant overview', `Shared operational data · ${state.trolleys.length} registered trolleys`)}
    <div class="cards">${metrics.map(([name, value]) => `<div class="card metric"><span>${name}</span><strong>${value}</strong></div>`).join('')}</div>
    ${!state.locations.length ? '<div class="callout">Start in Plant setup: register locations, products and trolleys. Then add operators in User management.</div>' : ''}
    <div class="grid">
      <section class="card"><h3>Location distribution</h3>
        ${dataTable(['Location', 'Trolleys'], state.locations.map(location => `<tr>
          <td>${escape(location.name)}</td><td>${state.trolleys.filter(trolley => trolley.location === location.id).length}</td>
        </tr>`))}
      </section>
      <section class="card"><h3>Needs attention</h3>
        ${dataTable(['Trolley', 'Status', 'Expected'], attention.map(movement => `<tr>
          <td>${escape(movement.trolley)}</td>
          <td><span class="badge ${movement.expected < Date.now() ? 'late' : ''}">${escape(movement.state)}${movement.expected < Date.now() ? ' · Overdue' : ''}</span></td>
          <td>${formatTime(movement.expected)}</td>
        </tr>`))}
      </section>
    </div>`;
}

function movementView(state) {
  return `${pageTitle('Move or scan a trolley', 'Use a USB QR scanner or enter the trolley ID. Outside-plant movements require approval.')}
    <div class="grid">
      <section class="card"><h3>Record departure</h3>
        ${form('move',
          inputField('Scan / trolley ID', 'trolley', 'text', 'list="trolley-list" autocomplete="off"') +
          `<datalist id="trolley-list">${state.trolleys.map(trolley => `<option value="${escape(trolley.id)}"></option>`).join('')}</datalist>` +
          selectField('Destination', 'destination', optionsFor(state.locations)) +
          selectField('Product', 'product', '<option value="">Empty trolley</option>' + optionsFor(state.products)) +
          inputField('Batch', 'batch', 'text', 'value="EMPTY"') +
          inputField('Quantity (capacity units)', 'qty', 'number', 'min="0" step="any" value="0"') +
          inputField('Expected arrival / return', 'expected', 'datetime-local'), 'Record movement')}
      </section>
      <section class="card"><h3>Confirm arrival</h3>
        ${movementTable(state, openMovements(state).filter(movement => movement.state === 'In Transit'), 'receive')}
        <p class="hint">Confirm only after the physical trolley reaches its destination.</p>
      </section>
    </div>`;
}

function mastersView(state) {
  const title = pageTitle('Plant setup', 'Create real plant records. IDs must be unique.');
  if (!canManagePlant(state.user)) return title + '<div class="callout">A supervisor or administrator can configure the plant.</div>';
  return `${title}<div class="grid">
    <section class="card"><h3>Location</h3>
      ${form('locations', inputField('Location ID', 'id') + inputField('Name', 'name') +
        '<label class="check"><input name="external" type="checkbox">Outside plant</label>', 'Add location')}
    </section>
    <section class="card"><h3>Product</h3>
      ${form('products', inputField('Product code', 'id') + inputField('Product name', 'name'), 'Add product')}
    </section>
    <section class="card"><h3>Trolley</h3>
      ${form('trolleys', inputField('Trolley ID / QR value', 'id') + inputField('Trolley type', 'type') +
        inputField('Capacity (same units as load quantity)', 'capacity', 'number', 'min="1" step="any"') +
        selectField('Initial location', 'location', optionsFor(state.locations)), 'Register trolley')}
    </section>
    <section class="card"><h3>Registered masters</h3>
      ${dataTable(['Location ID', 'Name'], state.locations.map(location => `<tr><td>${escape(location.id)}</td><td>${escape(location.name)}${location.external ? ' · Outside plant' : ''}</td></tr>`))}
      ${dataTable(['Product', 'Name'], state.products.map(product => `<tr><td>${escape(product.id)}</td><td>${escape(product.name)}</td></tr>`))}
    </section>
  </div>`;
}

function usersView(state) {
  return `${pageTitle('User management', 'Each operator signs in with their own account. Deactivation keeps history and revokes sessions.')}
    <div class="grid"><section class="card"><h3>Create user</h3>
      ${form('users', inputField('Username', 'username') + inputField('Full name', 'name') +
        inputField('Password (12+ characters)', 'password', 'password', 'minlength="12" autocomplete="new-password"') +
        selectField('Role', 'role', ['Admin', 'Supervisor', 'Operator', 'Quality User', 'Store User'].map(role => `<option>${role}</option>`).join('')), 'Create user')}
    </section><section class="card"><h3>Accounts</h3>
      ${dataTable(['User', 'Role', 'Status', 'Action'], (state.accounts || []).map(user => `<tr>
        <td>${escape(user.name)}<div class="hint">${escape(user.username)}</div></td>
        <td>${escape(user.role)}</td><td>${user.active ? 'Active' : 'Inactive'}</td>
        <td>${user.active && user.id !== state.user.id ? `<button class="btn danger" data-deactivate="${user.id}">Deactivate</button>` : '—'}</td>
      </tr>`))}
    </section></div>`;
}

function pageContent(state, page) {
  switch (page) {
    case 'dashboard': return dashboardView(state);
    case 'fleet': return `${pageTitle('Trolley fleet', 'Location updates after receipt is confirmed.')}
      <input id="search" class="search" placeholder="Search trolley, type or location" aria-label="Search fleet">
      <section class="card" id="fleet">${fleetTable(state)}</section>`;
    case 'movement': return movementView(state);
    case 'approvals': return `${pageTitle('Approval queue', 'Requests must be decided by a different supervisor or administrator.')}
      <section class="card">${movementTable(state, openMovements(state).filter(movement => movement.state === 'Pending'), 'approve')}</section>`;
    case 'history': return `${pageTitle('Movement history', 'Most recent 1,000 records. Recorded events only.')}
      <button class="btn" data-export="movements">Export CSV</button>
      <section class="card">${movementTable(state, state.movements)}</section>`;
    case 'audit': return `${pageTitle('Audit trail', 'Latest 500 events. Audit records cannot be edited or deleted through the application.')}
      <section class="card">${dataTable(['Time', 'User', 'Action', 'Entity', 'Details'], state.audit.map(event => `<tr>
        <td>${formatTime(event.ts)}</td><td>${escape(event.actor_name)}</td><td>${escape(event.action)}</td>
        <td>${escape(event.entity)}</td><td>${escape(event.detail)}</td>
      </tr>`))}</section>`;
    case 'masters': return mastersView(state);
    case 'users': return state.user.role === 'Admin' ? usersView(state) : '<p>Administrator access required.</p>';
    default: return dashboardView(state);
  }
}

export function workspaceView(state, page) {
  const navigation = [
    ['dashboard', 'Overview'], ['fleet', 'Trolley fleet'], ['movement', 'Move / scan'],
    ['approvals', 'Approvals'], ['history', 'Movement history'], ['masters', 'Plant setup'], ['audit', 'Audit trail'],
  ];
  if (state.user.role === 'Admin') navigation.push(['users', 'User management']);
  return `<div class="shell">
    <aside><h2>Smart Trolley</h2><p>PLANT OPERATIONS</p><nav>
      ${navigation.map(([id, title]) => `<button data-page="${id}" class="${page === id ? 'on' : ''}" ${page === id ? 'aria-current="page"' : ''}>${title}</button>`).join('')}
    </nav></aside>
    <main><header>
      <div><b>${escape(state.user.name)}</b><small>${escape(state.user.role)} · Shared workspace</small></div>
      <div class="actions"><button class="btn" id="refresh">Refresh</button><button class="btn" id="logout">Sign out</button></div>
    </header><div class="content">${pageContent(state, page)}</div></main>
  </div>`;
}
