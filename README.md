# Smart Trolley Management System

Version 0.5.0 connects the supplied fourteen-page reference interface to the authenticated Node.js application and persistent SQLite database. It includes six account roles, trolley tracking, movement/approval/correction workflows, alerts, local QR scanning, and real CSV, XLSX and PDF exports. Final integrated release verification is tracked in [docs/VALIDATION.md](docs/VALIDATION.md).

## Run locally

1. Install Node.js 24 or later.
2. Copy `.env.example` to `.env`. Set a unique `ADMIN_PASSWORD` with at least 12 characters.
3. Run `npm ci --omit=dev --ignore-scripts`.
4. Run `node --env-file=.env server.mjs`.
5. Open <http://127.0.0.1:8080> and sign in as `admin` using your configured password.

On Windows, `start-windows.cmd` starts the source installation after `.env` is configured. It can install missing dependencies, so prepare dependencies while connected before an offline test. A source ZIP requires Node and the pinned dependencies; a previously supplied 0.4 bundle does not automatically contain this version.

The first installation needs package downloads. Once prepared, the local application, QR decoder, charts and report exports use local assets and can run without Internet access. Camera scanning needs camera permission; manual IDs and USB keyboard scanners remain available.

For an example plant, open **Settings → Demo data** as Admin and load the 128-trolley sample into an empty operational database. It adds locations and products without creating shared role-switching logins. Create named users under **Settings → Users**. For your own plant, add actual locations, products and trolleys instead, then configure routes, compatibility and location permissions before enabling enforcement.

`ADMIN_PASSWORD` initializes the first account only. Editing it later does not reset a password. Reader provisioning also needs a private `DEVICE_ENCRYPTION_KEY`; manual and QR workflows work without it.

## Workspace

The reference pages are Dashboard, Trolley Master, Scan Trolley, Live Tracking, Overdue Trolleys, Movement, Locations, Movement History, Products & Materials, Alerts, Approvals, Reports, Analytics and Settings. Navigation follows the signed-in account's role: Admin, Plant Manager, Supervisor, Operator, Quality User or Store User. Users, readers, plant rules and audit remain available through authorized Settings sections.

Identify a trolley, declare its load and destination, then record the movement. Requests that need approval wait for another authorized person. An approver can approve, reject or request correction; resubmission retains the original request and decision trail. Confirm physical arrival through receipt, or explicitly record a completed movement when the declared handover has already occurred. Reader observations identify evidence and never silently relocate a trolley.

Alerts support acknowledgement, resolution and reopening. Overdue follow-up sends an **in-app** notification; it does not send email or SMS. Return actions use the movement workflow. Reports and analytics use stored records, and exports produce actual CSV, XLSX or PDF files. See [docs/API.md](docs/API.md) for contracts and [docs/PLANT_POLICY.md](docs/PLANT_POLICY.md) for policy background; the current six-role matrix is defined in `src/security.mjs`.

Sample reset restores the marked sample snapshot and preserves recorded history. It requires explicit confirmation and rejects unsafe resets while affected movements or approvals remain open. It is a testing feature, not a command to erase an operational database.

## Keep data when updating

1. Stop the running app and keep a backup of its whole folder, including `.env`, `data/` and any local login files.
2. Extract the new version into a separate folder. Copy the original `.env` and complete stopped `data/` directory into it. Preserve local login files if your bundle uses them.
3. Install the new version's pinned dependencies with `npm ci --omit=dev --ignore-scripts`, or use a complete updated bundle that already contains them. Do not reuse an older dependency folder blindly.
4. Start once, then verify the existing login, trolley records and recent history. Migrations, including `005_reference_workflows.sql`, apply automatically.

Do not replace an existing database with a blank sample database or delete `.env` to reset a login. Keep the reader encryption key with its installation and back it up securely. For a live consistent backup, use `scripts/backup.mjs`; see [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Development checks

Run `npm ci --ignore-scripts`, then:

```sh
npm run check
npm run format:check
npm test
npx playwright install chromium
npm run test:browser
npm run test:load
```

Browser preparation downloads Chromium unless a compatible browser is supplied through `CHROMIUM_EXECUTABLE_PATH`. Actual results and remaining limits belong in [docs/VALIDATION.md](docs/VALIDATION.md), not an assumed release claim.

## Hosted adapter and deployment

`deploy/hosted-demo` is a separate, older D1/managed-identity adapter. The previously deployed private demo is not automatically updated by changes to this Node application. Its sample role actors do not replace real account administration here, and no redeployment is implied by this release.

Docker/Compose and HTTPS proxy templates are included; their execution needs separate validation in the intended environment. This remains a single-instance SQLite application. Physical reader drivers, durable disconnected-device queues, SSO/MFA/password recovery, multi-instance storage and enterprise rollout require further implementation or validation. See [architecture.md](architecture.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [rules.md](rules.md).
