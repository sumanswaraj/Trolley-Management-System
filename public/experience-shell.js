import { esc } from './experience-ui.js';

const SPRITE = `<symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></symbol>
<symbol id="i-cart" viewBox="0 0 24 24"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></symbol>
<symbol id="i-scan" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></symbol>
<symbol id="i-activity" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></symbol>
<symbol id="i-move" viewBox="0 0 24 24"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></symbol>
<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></symbol>
<symbol id="i-history" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></symbol>
<symbol id="i-box" viewBox="0 0 24 24"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></symbol>
<symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></symbol>
<symbol id="i-file" viewBox="0 0 24 24"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></symbol>
<symbol id="i-chart" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></symbol>
<symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol>
<symbol id="i-warn" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></symbol>
<symbol id="i-truck" viewBox="0 0 24 24"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></symbol>
<symbol id="i-wrench" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></symbol>
<symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></symbol>
<symbol id="i-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></symbol>
<symbol id="i-filter" viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></symbol>
<symbol id="i-qr" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20 14v3"/><path d="M14 20h3"/><path d="M20 20h1"/></symbol>
<symbol id="i-rfid" viewBox="0 0 24 24"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></symbol>
<symbol id="i-edit" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></symbol>
<symbol id="i-power" viewBox="0 0 24 24"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></symbol>
<symbol id="i-factory" viewBox="0 0 24 24"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></symbol>
<symbol id="i-store" viewBox="0 0 24 24"><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-inbox" viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></symbol>
<symbol id="i-flag" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></symbol>
<symbol id="i-user" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></symbol>
<symbol id="i-pkg" viewBox="0 0 24 24"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></symbol>
<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z"/></symbol>
<symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></symbol>
<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M3 11a9 9 0 0 1 15-6l3 3M21 3v5h-5M21 13a9 9 0 0 1-15 6l-3-3M3 21v-5h5"/></symbol>`;

export const NAV = Object.freeze([
  ['dashboard', 'Dashboard', 'grid'],
  ['master', 'Trolley Master', 'cart'],
  ['scan', 'Scan Trolley', 'scan'],
  ['live', 'Live Tracking', 'activity'],
  ['overdue', 'Overdue Trolleys', 'clock'],
  ['movement', 'Movement', 'move'],
  ['locations', 'Locations', 'pin'],
  ['history', 'Movement History', 'history'],
  ['products', 'Products & Materials', 'box'],
  ['alerts', 'Alerts', 'bell'],
  ['approvals', 'Approvals', 'check'],
  ['reports', 'Reports', 'file'],
  ['analytics', 'Analytics', 'chart'],
  ['settings', 'Settings', 'sliders'],
]);

const ROLE_PAGES = Object.freeze({
  Admin: NAV.map(([page]) => page),
  'Plant Manager': [
    'dashboard',
    'live',
    'overdue',
    'locations',
    'history',
    'products',
    'alerts',
    'approvals',
    'reports',
    'analytics',
  ],
  Supervisor: [
    'dashboard',
    'master',
    'scan',
    'live',
    'overdue',
    'movement',
    'locations',
    'history',
    'products',
    'alerts',
    'approvals',
  ],
  Operator: ['dashboard', 'scan', 'live', 'movement', 'history', 'alerts'],
  'Quality User': ['dashboard', 'scan', 'live', 'movement', 'products', 'history', 'alerts'],
  'Store User': [
    'dashboard',
    'master',
    'scan',
    'live',
    'movement',
    'history',
    'products',
    'alerts',
  ],
});

const icon = (name, size = '') =>
  `<svg class="ic ${esc(size)}" aria-hidden="true" focusable="false"><use href="#i-${esc(name)}"></use></svg>`;
const timestamp = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};
const isUnread = (notification) => !notification.read && !notification.read_at;

export function iconSprite() {
  return `<svg class="icon-sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>${SPRITE}</defs></svg>`;
}

function navigationLink(item, current, badges = {}, compact = false) {
  const [page, title, symbol] = item;
  const label = compact
    ? {
        dashboard: 'Home',
        scan: 'Scan',
        live: 'Live',
        alerts: 'Alerts',
        movement: 'Move',
        history: 'History',
      }[page] || title
    : title;
  return `<button type="button" class="${page === current ? 'on' : ''}" data-page="${page}" ${page === current ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${badges[page] ? `<span class="${compact ? 'cnt' : 'n'} ${page === 'approvals' ? 'soft' : ''}" aria-label="${badges[page]} items">${badges[page]}</span>` : ''}</button>`;
}

function notificationsView(notifications, open) {
  return `<section class="pop notification-pop ${open ? 'show' : ''}" id="bellPop" aria-label="Notifications" ${open ? '' : 'hidden'}>
    <div class="notification-heading"><h2>Notifications</h2><span class="small muted">${notifications.filter(isUnread).length} unread</span></div>
    <div class="notification-list">${
      notifications.length
        ? notifications
            .slice(0, 8)
            .map(
              (notification) => `<article class="ni ${isUnread(notification) ? 'unread' : ''}">
      ${icon(['danger', 'warn', 'warning'].includes(notification.level) ? 'warn' : 'check', 'sm')}
      <div><p>${esc(notification.text || notification.message || '')}</p><time class="small muted">${esc(timestamp(notification.created || notification.ts || notification.created_at))}</time></div>
    </article>`,
            )
            .join('')
        : '<div class="empty"><b>All caught up</b><p>No notifications yet.</p></div>'
    }</div>
    <div class="notification-actions"><button type="button" class="btn sm" data-action="notifications-read" ${notifications.some(isUnread) ? '' : 'disabled'}>Mark all read</button><button type="button" class="btn sm p" data-page="alerts">Open alerts</button></div>
  </section>`;
}

export function shellView(state, page, content, ui = {}) {
  const user = state.user || {};
  const pages = user.access?.pages || state.access?.pages || ROLE_PAGES[user.role] || [];
  const navigation = NAV.filter(([id]) => pages.includes(id));
  const notifications = state.notifications || [];
  const unread = notifications.filter(isUnread).length;
  const trolleys = state.trolleys || [];
  const movements = state.activeMovements || state.movements || [];
  const badges = {
    overdue: trolleys.filter(
      (trolley) =>
        trolley.effective_status === 'Overdue' ||
        (trolley.active !== 0 &&
          trolley.expected &&
          trolley.expected < Date.now() &&
          !['Available', 'Inactive', 'Maintenance'].includes(trolley.status)),
    ).length,
    alerts: (state.alerts || []).filter((alert) => !['Resolved', 'Closed'].includes(alert.status))
      .length,
    approvals: movements.filter((movement) => movement.state === 'Pending').length,
  };
  const initials = (user.name || user.username || 'User')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const now = new Date();
  const nextTheme = ui.theme === 'dark' ? 'light' : 'dark';
  const quickPages = ['dashboard', 'scan', 'live', 'alerts'].filter((id) => pages.includes(id));
  const quickNavigation = quickPages.map((id) => navigation.find(([pageId]) => id === pageId));
  return `${iconSprite()}<a class="skip-link" href="#view">Skip to workspace</a>
    <div class="experience-shell">
      <aside class="side ${ui.menuOpen ? 'open' : ''}" id="side" aria-label="Workspace sidebar">
        <div class="brand"><div class="mk">${icon('cart', 'lg')}</div><div><b>Smart Trolley</b><span>Management System</span></div><button type="button" class="sidebar-close iconbtn" data-action="menu" aria-label="Close menu">${icon('x')}</button></div>
        <nav class="nav" id="nav" aria-label="Main navigation">${navigation.map((item) => navigationLink(item, page, badges)).join('')}</nav>
        <div class="side-f"><div class="ok"><i class="dotg" aria-hidden="true"></i>Shared plant workspace</div><span>Trace every trolley. Keep work moving.</span><button type="button" class="sidebar-logout" data-action="logout">${icon('power', 'sm')} Sign out</button></div>
      </aside>
      <button type="button" class="scrim ${ui.menuOpen ? 'show' : ''}" id="scrim" data-action="menu" aria-label="Close navigation" ${ui.menuOpen ? '' : 'hidden'}></button>
      <div class="main">
        <header class="top">
          <button type="button" class="iconbtn menu-button" id="menuBtn" data-action="menu" aria-label="${ui.menuOpen ? 'Close' : 'Open'} menu" aria-expanded="${Boolean(ui.menuOpen)}" aria-controls="side">${icon('menu')}</button>
          <form class="gsearch" data-form="global-search" role="search"><label class="sr-only" for="gs">Find a trolley by ID, QR or RFID</label><button class="search-submit" type="submit" data-action="search-global" aria-label="Search trolleys">${icon('search', 'sm')}</button><input id="gs" name="code" placeholder="Find a trolley by ID, QR or RFID" value="${esc(ui.search || '')}" autocomplete="off" spellcheck="false"></form>
          <div class="top-spacer"></div><div class="clock" aria-label="Current date and time"><b id="clk">${esc(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</b><span id="clkd">${esc(now.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }))}</span></div>
          <button type="button" class="iconbtn theme-button" data-action="theme" data-value="${nextTheme}" data-v="${nextTheme}" aria-label="Use ${nextTheme} theme" title="Use ${nextTheme} theme">${icon(nextTheme === 'dark' ? 'moon' : 'sun')}</button>
          <div class="rel"><button type="button" class="iconbtn" data-action="notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}" aria-expanded="${Boolean(ui.notificationsOpen)}" aria-controls="bellPop">${icon('bell')}${unread ? `<span class="cnt" id="bellCnt">${unread > 99 ? '99+' : unread}</span>` : ''}</button>${notificationsView(notifications, ui.notificationsOpen)}</div>
          <div class="user" aria-label="Signed in as ${esc(user.name || user.username)}, ${esc(user.role)}"><span class="av" aria-hidden="true">${esc(initials)}</span><div><b id="uname">${esc(user.name || user.username)}</b><span id="urole">${esc(user.role)}</span></div></div>
          <button type="button" class="iconbtn header-logout" data-action="logout" aria-label="Sign out" title="Sign out">${icon('power')}</button>
        </header>
        <main class="view" id="view" tabindex="-1">${content}</main>
      </div>
    </div>
    <nav class="bnav" id="bnav" aria-label="Quick navigation">${quickNavigation.map((item) => navigationLink(item, page, badges, true)).join('')}<button type="button" data-action="menu" aria-label="More navigation" aria-expanded="${Boolean(ui.menuOpen)}" aria-controls="side">${icon('menu')}<span>More</span></button></nav>
    ${modalView(ui.modal)}<div class="toasts" id="toasts" aria-live="polite" aria-atomic="true"></div>`;
}

export function loginView() {
  return `${iconSprite()}<main class="login-screen">
    <section class="login-story" aria-label="Smart Trolley workspace"><div class="brand"><div class="mk">${icon('cart', 'lg')}</div><div><b>Smart Trolley</b><span>Management System</span></div></div><div class="login-story-copy"><span class="eyebrow">YOUR PLANT, IN SYNC</span><h1>Every trolley.<br>Every movement.<br>One clear picture.</h1><p>Track material from store to dispatch, keep handovers accountable, and give every team the same view.</p><div class="login-features"><span>${icon('scan')} Fast identification</span><span>${icon('move')} Traceable handovers</span><span>${icon('shield')} Role-based access</span></div></div><p class="login-story-footer">Built for the people who keep your plant moving.</p></section>
    <section class="login-panel"><div class="login-card"><div class="login-mark">${icon('cart', 'lg')}</div><h2>Welcome back</h2><p class="subtitle">Sign in to your plant workspace.</p>
      <form id="login" data-form="login"><div class="fld"><label for="login-username">Username</label><input id="login-username" name="username" autocomplete="username" required autofocus></div><div class="fld"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" required></div><div class="error err" role="alert"></div><button class="btn p login-submit" type="submit">Sign in ${icon('arrow')}</button></form>
      <p class="login-help">Use the account provided by your administrator.<br>For a new local setup, use your generated admin login.</p><div class="login-trust">${icon('shield', 'sm')} Your role controls access to plant operations.</div></div></section>
    </main><div class="toasts" id="toasts" aria-live="polite" aria-atomic="true"></div>`;
}

export function modalView(model) {
  if (!model)
    return '<div class="ovl" id="ovl" hidden><section class="modal" id="modal"></section></div>';
  return `<div class="ovl show" id="ovl"><section class="modal ${model.wide ? 'wide' : ''}" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><header class="mh"><h2 id="modal-title">${esc(model.title || 'Details')}</h2><button type="button" class="iconbtn" data-action="close-modal" aria-label="Close dialog">${icon('x')}</button></header><div class="mb">${model.body || model.content || ''}</div>${model.footer ? `<footer class="mf">${model.footer}</footer>` : ''}</section></div>`;
}
