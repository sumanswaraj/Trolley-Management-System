import {
  fleetTable,
  fleetView,
  dashboardView,
  mastersView,
  historyView,
  movementTypes,
} from './fleet-views.js';
import {
  overdueView,
  locationsView,
  productsView,
  alertsView,
  notificationsView,
  scanView,
  trolleyDetailView,
} from './operations-views.js';
import { reportCatalogueView, analyticsView, settingsView } from './report-views.js';
export { fleetTable } from './fleet-views.js';
import { policyView } from './policy-views.js';
import { readerView } from './reader-views.js';
import {
  escapeHtml as escape,
  formatTime,
  canManagePlant,
  inputField,
  selectField,
  optionsFor,
  form,
  dataTable,
  pageTitle,
} from './ui.js';

const locationName = (state, id) =>
  state.locations.find((location) => location.id === id)?.name || id;
const productName = (state, id) =>
  state.products.find((product) => product.id === id)?.name || 'Empty';
const openMovements = (state) =>
  (state.activeMovements || state.movements).filter((movement) =>
    ['Pending', 'In Transit'].includes(movement.state),
  );

export function loginView() {
  return `<section class="login"><div class="card">
    <h1>Smart Trolley Management</h1>
    <p class="subtitle">Sign in to your plant workspace.</p>
    ${form(
      'login',
      inputField('Username', 'username', 'text', 'autocomplete="username"') +
        inputField('Password', 'password', 'password', 'autocomplete="current-password"'),
      'Sign in',
    )}
    <p class="hint">First login: admin and the password configured on your server.</p>
  </div></section>`;
}

function movementTable(state, movements, mode = 'history') {
  return dataTable(
    ['Trolley', 'Route', 'State', 'Requested', 'Actions'],
    movements.map((movement) => {
      let actions = '—';
      if (mode === 'receive') {
        actions = `<button class="btn primary" data-action="receive" data-id="${movement.id}">Confirm arrival</button>`;
      } else if (
        mode === 'approve' &&
        canApprove(state, movement) &&
        movement.requested_by !== state.user.id
      ) {
        actions = `<button class="btn" data-action="approve" data-id="${movement.id}">Approve</button>
        <button class="btn danger" data-action="reject" data-id="${movement.id}">Reject</button><button class="btn" data-action="correct" data-id="${movement.id}">Request correction</button>`;
      }
      return `<tr>
      <td><b>${escape(movement.trolley)}</b><div class="hint">${escape(productName(state, movement.product))} · ${movement.qty}</div></td>
      <td>${escape(locationName(state, movement.source))} → ${escape(locationName(state, movement.destination))}</td>
      <td><span class="badge">${escape(movement.state)}</span>${movement.requires_quality ? '<div class="hint">Quality release required</div>' : ''}<div class="hint">${escape(JSON.parse(movement.policy_flags || '[]').join('; '))}</div>${movement.exception_reason ? `<div class="hint">Exception: ${escape(movement.exception_reason)}</div>` : ''}</td>
      <td>${formatTime(movement.created)}<div class="hint">${escape(movement.requester)}</div></td>
      <td><div class="actions">${actions}</div></td>
    </tr>`;
    }),
  );
}

function movementView(state) {
  return `${pageTitle('Move or scan a trolley', 'Use a USB QR scanner or enter the trolley ID. Outside-plant movements require approval.')}
    <div class="grid">
      <section class="card"><h3>Record departure</h3>
        <div class="actions"><button class="btn" id="start-camera">Scan with camera</button><button class="btn" id="stop-camera" hidden>Stop camera</button></div>
        <video id="scan-video" class="scan-video" autoplay muted playsinline hidden></video>
        <p id="scan-status" class="hint" role="status">Camera frames stay on this device. A scan fills the form; it does not submit a movement.</p>
        ${form(
          'move',
          (state.movePrefill?.revision_of
            ? `<input type="hidden" name="revision_of" value="${Number(state.movePrefill.revision_of)}"><p class="callout">Revising movement ${Number(state.movePrefill.revision_of)}. The original request remains in history.</p>`
            : '') +
            inputField(
              'Scan / trolley ID',
              'trolley',
              'text',
              'list="trolley-list" autocomplete="off"',
            ) +
            `<datalist id="trolley-list">${state.trolleys.map((trolley) => `<option value="${escape(trolley.id)}"></option>`).join('')}</datalist>` +
            selectField(
              'Movement type',
              'movement_type',
              movementTypes
                .filter((type) =>
                  state.user.role === 'Quality User'
                    ? ['Quality Inspection', 'Quality Release', 'Transfer'].includes(type)
                    : state.user.role === 'Store User'
                      ? [
                          'Production Issue',
                          'Production Return',
                          'Store Transfer',
                          'Transfer',
                        ].includes(type)
                      : true,
                )
                .map((type) => `<option>${type}</option>`)
                .join(''),
            ) +
            selectField(
              'Destination',
              'destination',
              optionsFor(state.locations.filter((item) => item.active !== 0)),
            ) +
            selectField(
              'Product',
              'product',
              '<option value="">Empty trolley</option>' +
                optionsFor(state.products.filter((item) => item.active !== 0)),
              false,
            ) +
            inputField('Batch', 'batch', 'text', 'value="EMPTY"') +
            inputField(
              'Quantity (capacity units)',
              'qty',
              'number',
              'min="0" step="any" value="0"',
            ) +
            inputField('Expected arrival / return', 'expected', 'datetime-local') +
            inputField(
              'Movement date and time',
              'occurred_at',
              'datetime-local',
              `value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"`,
            ) +
            `<label>Operator<input value="${escape(state.user.name)}" readonly></label><label>Department<input name="department"></label><label>Reason<input name="reason" maxlength="500"></label><label>Status after arrival<select name="status_after"><option value="auto">Set automatically</option>${['Available', 'In Use', 'Waiting', 'Maintenance', 'Outside Plant'].map((s) => `<option>${s}</option>`).join('')}</select></label><label>Remarks<textarea name="remarks" maxlength="1000" rows="2"></textarea></label><label class="check"><input type="checkbox" name="in_transit" checked>Keep in transit until physical receipt</label>` +
            '<label>Exception reason (only if policy mismatch)<input name="exceptionReason" maxlength="500" placeholder="Explain why an override is needed"></label>',
          'Record movement',
        )}
      </section>
      <section class="card"><h3>Confirm arrival</h3>
        ${movementTable(
          state,
          openMovements(state).filter((movement) => movement.state === 'In Transit'),
          'receive',
        )}
        <div id="movement-preview" class="callout">Choose a trolley to check its assignment and route.</div><button class="btn" data-cancel-movement>Clear movement</button><p class="hint">Confirm only after the physical trolley reaches its destination.</p>
      </section>
    </div>`;
}

function usersView(state) {
  return `${pageTitle('User management', 'Each operator signs in with their own account. Deactivation keeps history and revokes sessions.')}
    <div class="grid"><section class="card"><h3>Create user</h3>
      ${form(
        'users',
        inputField('Username', 'username') +
          inputField('Full name', 'name') +
          inputField(
            'Password (12+ characters)',
            'password',
            'password',
            'minlength="12" autocomplete="new-password"',
          ) +
          selectField(
            'Role',
            'role',
            ['Admin', 'Plant Manager', 'Supervisor', 'Operator', 'Quality User', 'Store User']
              .map((role) => `<option>${role}</option>`)
              .join(''),
          ),
        'Create user',
      )}
    </section><section class="card"><h3>Accounts</h3>
      ${dataTable(
        ['User', 'Role', 'Status', 'Action'],
        (state.accounts || []).map(
          (user) => `<tr>
        <td>${escape(user.name)}<div class="hint">${escape(user.username)}</div></td>
        <td>${escape(user.role)}</td><td>${user.active ? 'Active' : 'Inactive'}</td>
        <td>${user.active && user.id !== state.user.id ? `<button class="btn danger" data-deactivate="${user.id}">Deactivate</button>` : '—'}</td>
      </tr>`,
        ),
      )}
    </section></div>`;
}

function pageContent(state, page) {
  switch (page) {
    case 'dashboard':
      return dashboardView(state);
    case 'fleet':
      return fleetView(state);
    case 'movement':
      return movementView(state);
    case 'approvals':
      return `${pageTitle('Approval queue', 'An independent authorized approver reviews outside, quality and exception requests.')}
      <section class="card">${movementTable(
        state,
        openMovements(state).filter((movement) => movement.state === 'Pending'),
        'approve',
      )}</section>${verificationApprovals(state)}`;
    case 'history':
      return historyView(state);
    case 'audit':
      return `${pageTitle('Audit trail', 'Paged audit history. Supervisors and administrators only.')}
      <section class="card">${dataTable(
        ['Time', 'User', 'Action', 'Entity', 'Details'],
        (state.auditPage?.items || state.audit).map(
          (event) => `<tr>
        <td>${formatTime(event.ts)}</td><td>${escape(event.actor_name)}</td><td>${escape(event.action)}</td>
        <td>${escape(event.entity)}</td><td>${escape(event.detail)}</td>
      </tr>`,
        ),
      )}</section>${state.auditPage?.nextCursor ? '<button class="btn mt" data-more="audit">Load older audit events</button>' : ''}`;
    case 'policies':
      return policyView(state);
    case 'readers':
      return readerView(state, state.readerSecret);
    case 'reports':
      return reportCatalogueView(state);
    case 'scan':
      return scanView(state);
    case 'overdue':
      return overdueView(state);
    case 'locations':
      return locationsView(state);
    case 'products':
      return productsView(state);
    case 'alerts':
      return alertsView(state);
    case 'notifications':
      return notificationsView(state);
    case 'analytics':
      return analyticsView(state);
    case 'settings':
      return settingsView(state);
    case 'detail':
      return trolleyDetailView(state, state.selectedTrolley);
    case 'masters':
      return mastersView(state);
    case 'users':
      return state.user.role === 'Admin'
        ? usersView(state)
        : '<p>Administrator access required.</p>';
    default:
      return dashboardView(state);
  }
}

export function workspaceView(state, page) {
  const manager = ['Admin', 'Plant Manager', 'Supervisor'].includes(state.user.role);
  const canMove = state.user.role !== 'Plant Manager';
  const navigation = [
    ['dashboard', 'Overview'],
    ['masters', 'Plant setup'],
    ['fleet', 'Trolley fleet'],
    ['overdue', 'Overdue trolleys'],
    ['locations', 'Locations'],
    ['history', 'Movement history'],
    ['products', 'Products & materials'],
    ['alerts', 'Alerts'],
  ];
  if (canMove) navigation.splice(2, 0, ['scan', 'Scan trolley'], ['movement', 'Move / scan']);
  if (manager || state.user.role === 'Quality User') navigation.push(['approvals', 'Approvals']);
  if (manager) navigation.push(['reports', 'Reports'], ['analytics', 'Analytics']);
  if (canManagePlant(state.user)) navigation.push(['policies', 'Plant rules']);
  if (canManagePlant(state.user))
    navigation.push(['settings', 'Settings'], ['audit', 'Audit trail']);
  if (state.user.role === 'Admin')
    navigation.push(['readers', 'Readers & tags'], ['users', 'User management']);
  const unread = (state.notifications || []).filter((item) => !item.read && !item.read_at).length;
  const badges = {
    alerts: (state.alerts || []).filter((a) => a.status !== 'Resolved').length,
    approvals:
      openMovements(state).filter((m) => m.state === 'Pending').length +
      (state.approvals || []).filter((a) => a.status === 'Pending').length,
  };
  return `<div class="shell">
    <aside id="sidebar"><div class="brand"><span class="brand-mark">T</span><div><h2>Smart Trolley</h2><p>PLANT OPERATIONS</p></div></div><nav aria-label="Plant navigation">
      ${navigation.map(([id, title]) => `<button data-page="${id}" class="${page === id ? 'on' : ''}" ${page === id ? 'aria-current="page"' : ''}><span>${title}</span>${badges[id] ? `<span class="nav-count">${badges[id]}</span>` : ''}</button>`).join('')}
    </nav><div class="sidebar-footer"><span class="online-dot"></span>Shared plant workspace</div></aside>
    <button class="sidebar-scrim" aria-label="Close navigation" data-menu-close hidden></button>
    <main><header><button class="btn menu-toggle" data-menu-toggle aria-label="Open navigation">☰</button><form id="global-lookup" class="global-search"><label class="sr-only" for="global-code">Find a trolley</label><input id="global-code" name="code" placeholder="Find trolley by ID, QR or RFID" required><button type="submit" class="btn" aria-label="Find trolley">Find</button><div class="error" role="alert"></div></form><time id="plant-clock" class="clock"></time>
      <div class="user-identity"><b>${escape(state.user.name)}</b><small>${escape(state.user.role)}</small></div>
      <div class="actions"><button class="btn notification-button" data-page="notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">Notifications ${unread ? `<span class="nav-count">${unread}</span>` : ''}</button><button class="btn" id="refresh">Refresh</button><button class="btn" id="logout">Sign out</button></div>
    </header><div class="content">${pageContent(state, page)}</div><nav class="bottom-nav" aria-label="Quick navigation"><button data-page="dashboard">Home</button>${canMove ? '<button data-page="scan">Scan</button><button data-page="movement">Move</button>' : ''}<button data-page="alerts">Alerts</button><button data-menu-toggle>More</button></nav></main>
  </div>`;
}

function canApprove(state, movement) {
  const user = state.user;
  const external = state.locations.find(
    (location) => location.id === movement.destination,
  )?.external;
  const flags = JSON.parse(movement.policy_flags || '[]');
  return movement.requires_quality
    ? user.role === 'Admin' || (!flags.length && !external && user.role === 'Quality User')
    : ['Admin', 'Plant Manager', 'Supervisor'].includes(user.role);
}

function verificationApprovals(state) {
  const pending = (state.approvals || []).filter((a) => a.status === 'Pending');
  const history = (state.approvals || []).filter((a) => a.status !== 'Pending');
  const canDecide = ['Admin', 'Plant Manager', 'Supervisor'].includes(state.user.role);
  return `<section class="card mt"><h3>Product verification approvals</h3>${pending.map((a) => `<article class="approval-card"><h4>${escape(a.trolley)} · Product mismatch</h4><p>${escape(a.reason)}</p><p class="hint">Requested by ${escape(a.requester)} · ${formatTime(a.created)}</p><ul>${(a.flags || []).map((flag) => `<li>${escape(flag.message)}</li>`).join('')}</ul>${canDecide && a.requested_by !== state.user.id ? `<div class="actions">${['Approved', 'Rejected', 'Correction Required'].map((decision) => `<button class="btn" data-verification-decision="${decision}" data-id="${a.id}">${decision === 'Approved' ? 'Approve' : decision === 'Rejected' ? 'Reject' : 'Request correction'}</button>`).join('')}</div>` : '<p class="hint">Awaiting an independent approver.</p>'}</article>`).join('') || '<div class="empty">No pending product verifications.</div>'}</section><section class="card mt"><h3>Approval history</h3>${dataTable(['Trolley', 'Request', 'Decision', 'Decided by', 'Date', 'Remarks'], [...history.map((a) => `<tr><td>${escape(a.trolley)}</td><td>Product verification</td><td>${escape(a.status)}</td><td>${escape(a.decider)}</td><td>${a.decided_at ? formatTime(a.decided_at) : '—'}</td><td>${escape(a.remarks)}</td></tr>`), ...state.movements.filter((m) => m.approved_by || m.state === 'Rejected').map((m) => `<tr><td>${escape(m.trolley)}</td><td>${escape(m.movement_type || 'Movement')}</td><td>${escape(m.display_status || m.state)}</td><td>${escape(m.approver_name || '')}</td><td>${formatTime(m.decided_at || m.created)}</td><td>${escape(m.decision_reason)}</td></tr>`)])}</section>`;
}
