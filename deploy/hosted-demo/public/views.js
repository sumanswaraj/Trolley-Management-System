import { policyView } from "./policy-views.js";
import { readerView } from "./reader-views.js";
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
} from "./ui.js";

const locationName = (state, id) =>
  state.locations.find((location) => location.id === id)?.name || id;
const productName = (state, id) =>
  state.products.find((product) => product.id === id)?.name || "Empty";
const openMovements = (state) =>
  (state.activeMovements || state.movements).filter((movement) =>
    ["Pending", "In Transit"].includes(movement.state),
  );

export function loginView() {
  return `<section class="login"><div class="card">
    <h1>Smart Trolley Management</h1>
    <p class="subtitle">Sign in to your plant workspace.</p>
    ${form(
      "login",
      inputField("Username", "username", "text", 'autocomplete="username"') +
        inputField(
          "Password",
          "password",
          "password",
          'autocomplete="current-password"',
        ),
      "Sign in",
    )}
    <p class="hint">First login: admin and the password configured on your server.</p>
  </div></section>`;
}

export function fleetTable(state, trolleys = state.trolleys) {
  const desktop = dataTable(
    ["ID", "Type", "Location", "State", "Product / batch", "Load", "Label"],
    trolleys.map(
      (trolley) => `<tr>
    <td><b>${escape(trolley.id)}</b></td>
    <td>${escape(trolley.type)}</td>
    <td>${escape(locationName(state, trolley.location))}</td>
    <td><span class="badge">${escape(trolley.status)}</span></td>
    <td>${escape(productName(state, trolley.product))}<div class="hint">${escape(trolley.batch)}</div></td>
    <td>${trolley.qty} / ${trolley.capacity} ${escape(trolley.unit || "pcs")}</td>
    <td><a href="/api/trolleys/${encodeURIComponent(trolley.id)}/label" target="_blank" rel="noopener">QR label</a></td>
  </tr>`,
    ),
  );
  const mobile = trolleys.length
    ? trolleys
        .map(
          (trolley) => `<article class="mobile-trolley">
    <div class="card-heading"><h3>${escape(trolley.id)}</h3><span class="badge">${escape(trolley.status)}</span></div>
    <dl><dt>Location</dt><dd>${escape(locationName(state, trolley.location))}</dd>
      <dt>Type</dt><dd>${escape(trolley.type)}</dd>
      <dt>Product</dt><dd>${escape(productName(state, trolley.product))}</dd>
      <dt>Batch</dt><dd>${escape(trolley.batch || "—")}</dd>
      <dt>Load</dt><dd>${trolley.qty} / ${trolley.capacity} ${escape(trolley.unit || "pcs")}</dd></dl>
    <a href="/api/trolleys/${encodeURIComponent(trolley.id)}/label" target="_blank" rel="noopener">QR label</a>
  </article>`,
        )
        .join("")
    : '<div class="empty">No records yet.</div>';
  return `<div class="fleet-table">${desktop}</div><div class="trolley-cards">${mobile}</div>`;
}

function movementTable(state, movements, mode = "history") {
  return dataTable(
    ["Trolley", "Route", "State", "Requested", "Actions"],
    movements.map((movement) => {
      let actions = "—";
      if (mode === "receive") {
        actions = `<button class="btn primary" data-action="receive" data-id="${movement.id}">Confirm arrival</button>`;
      } else if (
        mode === "approve" &&
        canApprove(state, movement) &&
        movement.requested_by !== state.user.id
      ) {
        actions = `<button class="btn" data-action="approve" data-id="${movement.id}">Approve</button>
        <button class="btn danger" data-action="reject" data-id="${movement.id}">Reject</button>`;
      }
      return `<tr>
      <td><b>${escape(movement.trolley)}</b><div class="hint">${escape(productName(state, movement.product))} · ${movement.qty}</div></td>
      <td>${escape(locationName(state, movement.source))} → ${escape(locationName(state, movement.destination))}</td>
      <td><span class="badge">${escape(movement.state)}</span>${movement.requires_quality ? '<div class="hint">Quality release required</div>' : ""}<div class="hint">${escape(JSON.parse(movement.policy_flags || "[]").join("; "))}</div>${movement.exception_reason ? `<div class="hint">Exception: ${escape(movement.exception_reason)}</div>` : ""}</td>
      <td>${formatTime(movement.created)}<div class="hint">${escape(movement.requester)}</div></td>
      <td><div class="actions">${actions}</div></td>
    </tr>`;
    }),
  );
}

function dashboardView(state) {
  const open = openMovements(state);
  const metrics = [
    ["Fleet", state.trolleys.length],
    [
      "Available",
      state.trolleys.filter((trolley) => trolley.status === "Available").length,
    ],
    [
      "In transit",
      open.filter((movement) => movement.state === "In Transit").length,
    ],
    [
      "Overdue",
      open.filter((movement) => movement.expected < Date.now()).length,
    ],
  ];
  const attention = open.filter(
    (movement) =>
      movement.state === "Pending" || movement.expected < Date.now(),
  );
  return `${pageTitle("Plant overview", `Shared operational data · ${state.trolleys.length} registered trolleys`)}
    <div class="cards">${metrics.map(([name, value]) => `<div class="card metric"><span>${name}</span><strong>${value}</strong></div>`).join("")}</div>
    ${!state.locations.length ? '<div class="callout">Start in Plant setup: register locations, products and trolleys. Then add operators in User management.</div>' : ""}
    <div class="grid">
      <section class="card"><h3>Location distribution</h3>
        ${dataTable(
          ["Location", "Trolleys"],
          state.locations.map(
            (location) => `<tr>
          <td>${escape(location.name)}</td><td>${state.trolleys.filter((trolley) => trolley.location === location.id).length}</td>
        </tr>`,
          ),
        )}
      </section>
      <section class="card"><h3>Needs attention</h3>
        ${dataTable(
          ["Trolley", "Status", "Expected"],
          attention.map(
            (movement) => `<tr>
          <td>${escape(movement.trolley)}</td>
          <td><span class="badge ${movement.expected < Date.now() ? "late" : ""}">${escape(movement.state)}${movement.expected < Date.now() ? " · Overdue" : ""}</span></td>
          <td>${formatTime(movement.expected)}</td>
        </tr>`,
          ),
        )}
      </section>
    </div>`;
}

function movementView(state) {
  return `${pageTitle("Move or scan a trolley", "Use a USB QR scanner or enter the trolley ID. Outside-plant movements require approval.")}
    <div class="grid">
      <section class="card"><h3>Record departure</h3>
        <div class="actions"><button class="btn" id="start-camera">Scan with camera</button><button class="btn" id="stop-camera" hidden>Stop camera</button></div>
        <video id="scan-video" class="scan-video" autoplay muted playsinline hidden></video>
        <p id="scan-status" class="hint" role="status">Camera frames stay on this device. A scan fills the form; it does not submit a movement.</p>
        ${form(
          "move",
          inputField(
            "Scan / trolley ID",
            "trolley",
            "text",
            'list="trolley-list" autocomplete="off"',
          ) +
            `<datalist id="trolley-list">${state.trolleys.map((trolley) => `<option value="${escape(trolley.id)}"></option>`).join("")}</datalist>` +
            selectField(
              "Destination",
              "destination",
              optionsFor(state.locations),
            ) +
            selectField(
              "Product",
              "product",
              '<option value="">Empty trolley</option>' +
                optionsFor(state.products),
            ) +
            inputField("Batch", "batch", "text", 'value="EMPTY"') +
            inputField(
              "Quantity (capacity units)",
              "qty",
              "number",
              'min="0" step="any" value="0"',
            ) +
            inputField(
              "Expected arrival / return",
              "expected",
              "datetime-local",
            ) +
            '<label>Exception reason (only if policy mismatch)<input name="exceptionReason" maxlength="500" placeholder="Explain why an override is needed"></label>',
          "Record movement",
        )}
      </section>
      <section class="card"><h3>Confirm arrival</h3>
        ${movementTable(
          state,
          openMovements(state).filter(
            (movement) => movement.state === "In Transit",
          ),
          "receive",
        )}
        <p class="hint">Confirm only after the physical trolley reaches its destination.</p>
      </section>
    </div>`;
}

function mastersView(state) {
  const title = pageTitle(
    "Plant setup",
    "Create real plant records. IDs must be unique.",
  );
  if (!canManagePlant(state.user))
    return (
      title +
      '<div class="callout">A supervisor or administrator can configure the plant.</div>'
    );
  return `${title}<div class="grid">
    <section class="card"><h3>Location</h3>
      ${form(
        "locations",
        inputField("Location ID", "id") +
          inputField("Name", "name") +
          '<label class="check"><input name="external" type="checkbox">Outside plant</label>',
        "Add location",
      )}
    </section>
    <section class="card"><h3>Product</h3>
      ${form("products", inputField("Product code", "id") + inputField("Product name", "name") + inputField("Category", "category", "text", 'value="Unspecified"') + inputField("Quantity unit", "unit", "text", 'value="pcs" maxlength="20"'), "Add product")}
    </section>
    <section class="card"><h3>Trolley</h3>
      ${form(
        "trolleys",
        inputField("Trolley ID / QR value", "id") +
          inputField("Trolley type", "type") +
          inputField(
            "Capacity (same units as load quantity)",
            "capacity",
            "number",
            'min="1" step="any"',
          ) +
          inputField(
            "Capacity unit",
            "unit",
            "text",
            'value="pcs" maxlength="20"',
          ) +
          selectField(
            "Initial location",
            "location",
            optionsFor(state.locations),
          ),
        "Register trolley",
      )}
    </section>
    <section class="card"><h3>Registered masters</h3>
      ${dataTable(
        ["Location ID", "Name"],
        state.locations.map(
          (location) =>
            `<tr><td>${escape(location.id)}</td><td>${escape(location.name)}${location.external ? " · Outside plant" : ""}</td></tr>`,
        ),
      )}
      ${dataTable(
        ["Product", "Name"],
        state.products.map(
          (product) =>
            `<tr><td>${escape(product.id)}</td><td>${escape(product.name)}</td></tr>`,
        ),
      )}
    </section>
  </div>`;
}

function usersView(state) {
  if (state.demoMode)
    return (
      pageTitle(
        "Demo roles",
        "These are sample actors inside your private sandbox. ChatGPT sign-in controls entry; the full installation manages real users.",
      ) +
      dataTable(
        ["Actor", "Role"],
        (state.accounts || []).map(
          (user) =>
            `<tr><td>${escape(user.name)}</td><td>${escape(user.role)}</td></tr>`,
        ),
      )
    );
  return `${pageTitle("User management", "Each operator signs in with their own account. Deactivation keeps history and revokes sessions.")}
    <div class="grid"><section class="card"><h3>Create user</h3>
      ${form(
        "users",
        inputField("Username", "username") +
          inputField("Full name", "name") +
          inputField(
            "Password (12+ characters)",
            "password",
            "password",
            'minlength="12" autocomplete="new-password"',
          ) +
          selectField(
            "Role",
            "role",
            ["Admin", "Supervisor", "Operator", "Quality User", "Store User"]
              .map((role) => `<option>${role}</option>`)
              .join(""),
          ),
        "Create user",
      )}
    </section><section class="card"><h3>Accounts</h3>
      ${dataTable(
        ["User", "Role", "Status", "Action"],
        (state.accounts || []).map(
          (user) => `<tr>
        <td>${escape(user.name)}<div class="hint">${escape(user.username)}</div></td>
        <td>${escape(user.role)}</td><td>${user.active ? "Active" : "Inactive"}</td>
        <td>${user.active && user.id !== state.user.id ? `<button class="btn danger" data-deactivate="${user.id}">Deactivate</button>` : "—"}</td>
      </tr>`,
        ),
      )}
    </section></div>`;
}

function pageContent(state, page) {
  switch (page) {
    case "dashboard":
      return dashboardView(state);
    case "fleet":
      return `${pageTitle("Trolley fleet", "Location updates after receipt is confirmed.")}
      <input id="search" class="search" placeholder="Search trolley, type or location" aria-label="Search fleet">
      <section class="card" id="fleet">${fleetTable(state)}</section>`;
    case "movement":
      return movementView(state);
    case "approvals":
      return `${pageTitle("Approval queue", "An independent authorized approver reviews outside, quality and exception requests.")}
      <section class="card">${movementTable(
        state,
        openMovements(state).filter((movement) => movement.state === "Pending"),
        "approve",
      )}</section>`;
    case "history":
      return `${pageTitle("Movement history", "Paged history from the full database. Recorded events only.")}
      <button class="btn" data-export="movements">Export CSV</button>
      <section class="card">${movementTable(state, state.historyPage?.items || state.movements)}</section>
      ${state.historyPage?.nextCursor ? '<button class="btn mt" data-more="history">Load older movements</button>' : ""}`;
    case "audit":
      return `${pageTitle("Audit trail", "Paged audit history. Supervisors and administrators only.")}
      <section class="card">${dataTable(
        ["Time", "User", "Action", "Entity", "Details"],
        (state.auditPage?.items || state.audit).map(
          (event) => `<tr>
        <td>${formatTime(event.ts)}</td><td>${escape(event.actor_name)}</td><td>${escape(event.action)}</td>
        <td>${escape(event.entity)}</td><td>${escape(event.detail)}</td>
      </tr>`,
        ),
      )}</section>${state.auditPage?.nextCursor ? '<button class="btn mt" data-more="audit">Load older audit events</button>' : ""}`;
    case "policies":
      return policyView(state);
    case "readers":
      return readerView(state, state.readerSecret);
    case "reports":
      return reportsView(state);
    case "masters":
      return mastersView(state);
    case "users":
      return state.user.role === "Admin"
        ? usersView(state)
        : "<p>Administrator access required.</p>";
    default:
      return dashboardView(state);
  }
}

export function workspaceView(state, page) {
  const navigation = [
    ["dashboard", "Overview"],
    ["fleet", "Trolley fleet"],
    ["movement", "Move / scan"],
    ["approvals", "Approvals"],
    ["history", "Movement history"],
    ["reports", "Reports"],
    ["masters", "Plant setup"],
  ];
  if (canManagePlant(state.user))
    navigation.push(["policies", "Plant rules"], ["audit", "Audit trail"]);
  if (state.user.role === "Admin")
    navigation.push(
      ["readers", "Readers & tags"],
      ["users", "User management"],
    );
  if (state.demoMode) {
    const readerIndex = navigation.findIndex(([id]) => id === "readers");
    if (readerIndex >= 0) navigation.splice(readerIndex, 1);
  }
  return `<div class="shell">
    <aside><h2>Smart Trolley</h2><p>PLANT OPERATIONS</p><nav>
      ${navigation.map(([id, title]) => `<button data-page="${id}" class="${page === id ? "on" : ""}" ${page === id ? 'aria-current="page"' : ""}>${title}</button>`).join("")}
    </nav></aside>
    <main><header>
      <div><b>${escape(state.user.name)}</b><small>${escape(state.user.role)} · Shared workspace</small></div>
      <div class="actions"><button class="btn" id="refresh">Refresh</button>${state.demoMode ? '<a class="btn" href="/signout-with-chatgpt?return_to=/" target="_top">Sign out</a>' : '<button class="btn" id="logout">Sign out</button>'}</div>
    </header>${state.demoMode ? demoToolbar(state) : ""}<div class="content">${pageContent(state, page)}</div></main>
  </div>`;
}

function canApprove(state, movement) {
  const user = state.user;
  const external = state.locations.find(
    (location) => location.id === movement.destination,
  )?.external;
  const flags = JSON.parse(movement.policy_flags || "[]");
  return movement.requires_quality
    ? user.role === "Admin" ||
        (!flags.length && !external && user.role === "Quality User")
    : canManagePlant(user);
}

function reportsView(state) {
  const report = state.report;
  return `${pageTitle("Operational reports", "Calculated from recorded movements; the daily buckets use UTC.")}
    <section class="card">
      ${form("report-filter", inputField("From (local time)", "from", "datetime-local") + inputField("To (local time)", "to", "datetime-local"), "Calculate report")}
      ${
        report
          ? `<div class="cards">
        ${[
          ["Requested", report.totals.requested],
          ["Received", report.totals.received || 0],
          ["Rejected", report.totals.rejected || 0],
          [
            "Mean request-to-receipt (hours)",
            report.totals.mean_receipt_ms === null
              ? "—"
              : (report.totals.mean_receipt_ms / 3600000).toFixed(2),
          ],
        ]
          .map(
            ([title, value]) =>
              `<div class="card metric"><span>${title}</span><strong>${value}</strong></div>`,
          )
          .join("")}
      </div><p class="hint">${formatTime(report.from)} to ${formatTime(report.to)}. The mean includes time waiting for approval.</p>
      ${dataTable(
        ["Day (UTC)", "Requested movements"],
        report.daily.map(
          (day) => `<tr><td>${escape(day.day)}</td><td>${day.count}</td></tr>`,
        ),
      )}`
          : ""
      }
    </section>`;
}

function demoToolbar(state) {
  return `<section class="demo-toolbar"><div><b>Connected database demo</b><p>24 sample trolleys · Changes persist across visits. Switch sample roles to try independent approvals.</p></div><div class="actions">${["Admin", "Supervisor", "Operator", "Quality User", "Store User"].map((role) => `<button class="btn ${state.user.role === role ? "primary" : ""}" data-demo-role="${escape(role)}">${role}</button>`).join("")}</div></section>`;
}
