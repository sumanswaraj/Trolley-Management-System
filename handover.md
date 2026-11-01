# Smart Trolley Management System — handover report

Prepared: **1 November 2026**. Application version: **0.5.0**.

## Delivery status

The Node application implements the supplied HTML reference's fourteen screens against authenticated accounts, server-side business rules and persistent SQLite data. The reference remains in `public/prototype.html` as an unserved design specimen. The operational application starts from `public/index.html`.

| Item                                      | Handover baseline                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Repository                                | [sumanswaraj/Trolley-Management-System](https://github.com/sumanswaraj/Trolley-Management-System)                                    |
| Delivery branch                           | [`codex/trolley-v0.5.0`](https://github.com/sumanswaraj/Trolley-Management-System/tree/codex/trolley-v0.5.0)                         |
| Implementation commit                     | [`c84bd3b`](https://github.com/sumanswaraj/Trolley-Management-System/commit/c84bd3b)                                                 |
| Latest source baseline before this report | [`424c1c9`](https://github.com/sumanswaraj/Trolley-Management-System/commit/424c1c9)                                                 |
| Source download                           | [Version 0.5.0 branch ZIP](https://github.com/sumanswaraj/Trolley-Management-System/archive/refs/heads/codex/trolley-v0.5.0.zip)     |
| Software acceptance evidence              | 22 October 2026; Linux, Node.js 24.19.0, Chromium 154                                                                                |
| Deployment boundary                       | This report accompanies the Node source branch. The default `main` branch and separate hosted demo are not updated by this handover. |

The branch ZIP follows subsequent commits on that branch and contains source, not an installed Windows runtime or dependencies. For reproducible installation, use an approved full commit ID from Git history and its lockfile. The earlier 0.4 Windows bundle is not the 0.5.0 release. No passwords, reader secrets, private configuration or operational database are part of the source handover.

## Delivered functionality

| Area                 | Implemented behavior                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard            | Ten fleet/location KPIs, occupancy and movement summaries, recent updates and operational exceptions.                                                    |
| Trolley Master       | Identity/QR/RFID lookup, registration, protected editing, activation/deactivation, filters, pagination, detail/history and permanent QR labels.          |
| Scan Trolley         | Manual, keyboard-scanner and camera QR identification; current trolley context, verification and operational actions.                                    |
| Live Tracking        | Card/table fleet views with location, status, load, batch, responsibility and tag-health filters/context.                                                |
| Overdue Trolleys     | Deadline/dwell exceptions, recorded in-app reminders and return movement actions.                                                                        |
| Movement             | Ten movement types, load/context validation, independent exception approval, correction/resubmission, physical receipt and explicit completed handovers. |
| Locations            | Location groups, departments, capacities, expected stay and occupancy.                                                                                   |
| Movement History     | Searchable, filtered movement trace and complete matching exports.                                                                                       |
| Products & Materials | Product category/unit/batch/location compatibility, master maintenance and verification context.                                                         |
| Alerts               | Recorded exceptions, priorities, acknowledgement, resolution and reopening.                                                                              |
| Approvals            | Independent decisions and linked correction/resubmission without overwriting earlier requests.                                                           |
| Reports              | Eight report types: daily, utilization, location, product, overdue, outside, exceptions and history; genuine CSV, XLSX and PDF exports.                  |
| Analytics            | Seven panels based on stored records, with metric definitions and honest empty states.                                                                   |
| Settings             | Named users, configuration, plant policies, reader/tag administration, audit access and guarded sample-data tools.                                       |

Shared controls include global trolley search, notifications with per-user read state, theme persistence, account identity, sign-out, desktop navigation, phone drawer/bottom navigation and keyboard-accessible dialogs. Runtime fonts, icons, QR decoding, charts and exports use local assets after dependencies are installed.

The movement types are Transfer, Production Issue, Production Return, Quality Inspection, Quality Release, Packing, Dispatch, Store Transfer, Maintenance and Outside Plant. Sample loading explicitly creates 128 trolleys, 11 locations and 10 products in an empty operational installation. It does not create shared role-switching accounts. Sample reset preserves accounts, history and unrelated records and rejects conflicting open sample operations.

## Access and integrity rules

The current authority is [`src/security.mjs`](src/security.mjs), enforced together with service-level workflow and location checks. Navigation visibility does not grant permission.

| Role          | Main responsibilities and limits                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin         | All pages; master/account/configuration administration, operational workflows, approvals, reports and sample-data administration.                     |
| Plant Manager | Monitoring, alerts, authorized approvals, reports and analytics; no master editing or movement entry.                                                 |
| Supervisor    | Operational movements, verification, alerts and authorized approvals; masters are read-only and reporting pages are not granted.                      |
| Operator      | Dashboard, scanning, live tracking, movement, history and alert visibility; no master administration or approval authority.                           |
| Quality User  | Quality Inspection, Quality Release and Transfer movements; verification and alert actions within authorized access.                                  |
| Store User    | Production Issue, Production Return, Store Transfer and Transfer movements; relevant master/product visibility without editing or approval authority. |

Preserve these invariants in maintenance work:

- Authorize mutations on the server and apply configured role, route, product and location restrictions.
- Keep one open movement per trolley, transactional updates, optimistic versions and idempotent command retries.
- Keep a trolley's source location until arrival is physically received. Explicit direct completion records an already completed handover; applicable approval gates still apply.
- A requester cannot approve their own request. Corrections create linked replacement requests and retain the prior decision trail.
- Reader observations are signed evidence; they do not automatically move a trolley or confirm arrival.
- Keep identity/history/audit protections and existing credentials intact during upgrades. Add new migrations rather than rewriting applied migrations.
- Keep reminders described as in-app notifications. Email/SMS delivery is not implemented.

## Architecture and source map

One Node.js process serves the browser modules and HTTP API from the same origin. Domain services use SQLite on a persistent local disk; migrations run at startup. This is a single-instance architecture, with no shared multi-instance storage or high-availability claim.

| Path                                                                       | Responsibility                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `server.mjs`                                                               | Listener configuration and graceful shutdown.                                       |
| `src/http/application.mjs`, `body.mjs`                                     | API routing, static allowlist, input boundaries, headers and responses.             |
| `src/database.mjs`, `migrations/`                                          | SQL/transactions, audit and ordered schema changes through migration 005.           |
| `src/security.mjs`, `src/services/accounts.mjs`                            | Role access, salted password hashes, session cookies and account lifecycle.         |
| `src/services/masters.mjs`, `movements.mjs`, `policies.mjs`                | Master lifecycle and protected movement/policy transitions.                         |
| `src/services/workflow.mjs`, `demo.mjs`                                    | Verification, approvals/corrections, alerts, notifications and guarded sample data. |
| `src/services/readers.mjs`, `labels.mjs`                                   | Reader credentials/observations, tag mapping and local QR labels.                   |
| `src/services/reports.mjs`, `exports.mjs`                                  | Stored-data reporting/analytics and real CSV/XLSX/PDF serialization.                |
| `public/experience.js`                                                     | Browser state, API orchestration, events, navigation and focus.                     |
| `public/experience-shell.js`, `experience-ui.js`, `api.js`                 | Shell/dialogs, escaped shared controls and same-origin transport.                   |
| `public/monitoring-views.js`, `operations-views.js`, `operations-model.js` | Focused page renderers and presentation helpers.                                    |
| `public/experience.css`, `scanner.js`                                      | Responsive interface and camera decoder lifecycle.                                  |
| `tests/`, `browser-tests/`, `scripts/`                                     | Automated acceptance, syntax/load checks and online backup tool.                    |
| `deploy/hosted-demo/`                                                      | Separate older D1/managed-identity adapter; not Node 0.5.0 parity.                  |

Production dependencies are pinned to ExcelJS 4.4.0, jsQR 1.4.0, PDFKit 0.17.2 and qrcode 1.5.4. Use `package-lock.json` through `npm ci`. Developer tools include Playwright and Prettier. There is no separate frontend build step for the Node application.

## Windows setup and first use

These instructions are for the 0.5.0 source installation. Windows execution still needs acceptance on the receiving computer.

1. Install **Node.js 24 or later** for Windows 64-bit. Keep Internet connected for the first dependency installation.
2. Download the delivery-branch ZIP above and extract it into a new folder.
3. In File Explorer, enable **View → Show → File name extensions**. Copy `.env.example` to `.env`; ensure the filename is not `.env.txt`.
4. Edit `.env` in a text editor. Set a unique `ADMIN_PASSWORD` with at least 12 characters. Keep this file private.
5. Double-click `start-windows.cmd`. It checks Node/configuration, installs missing runtime dependencies and starts the application. Keep the command window open.
6. Open <http://127.0.0.1:8080>. For a new installation, sign in as `admin` using the password you configured.
7. Create named accounts under **Settings → Users**. For testing only, an Admin can use **Settings → Demo data** to load the sample plant into an empty operational database. For real use, enter actual masters and review plant rules instead.

After dependencies are installed, local operation can run offline. Other devices still need connectivity to the computer running the server. A disconnected browser does not have an offline synchronization queue. Camera scanning needs permission and a supported camera/browser on localhost or HTTPS; manual IDs and USB keyboard scanners remain alternatives.

The equivalent commands, run from the extracted project directory, are:

```sh
npm ci --omit=dev --ignore-scripts
node --env-file=.env server.mjs
```

`npm start` alone does not load `.env`. Use the launcher or the explicit `--env-file` command unless the service environment already supplies the variables. To stop a foreground server, press **Ctrl+C** in its command window.

## Configuration and private assets

| Name/path                                            | Purpose and custody                                                                                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_PASSWORD`                                     | Bootstraps the first Admin only. Changing it later does not reset an existing account password.                                                                        |
| `HOST`, `PORT`                                       | Default local bind `127.0.0.1:8080`. Review network controls before permitting access from other computers.                                                            |
| `SECURE_COOKIE`                                      | `false` for local HTTP; use `true` with a correctly configured HTTPS deployment.                                                                                       |
| `DEVICE_ENCRYPTION_KEY`                              | Optional for manual/QR operation; reader provisioning requires 32 random bytes represented by 64 hex characters. Keep a protected separate backup.                     |
| `TROLLEY_DOMAIN`                                     | DNS hostname used only by the production Compose/Caddy template.                                                                                                       |
| `.env`                                               | Private installation configuration; preserve across upgrades and never commit.                                                                                         |
| `data/trolley.sqlite` and complete `data/` directory | Operational database and SQLite journal files. Default location is under the project root; no database-path environment variable is exposed by the server entry point. |
| Reader bridge credentials                            | Per-reader ID/secret issued once during provisioning/rotation; store in the bridge's protected configuration.                                                          |

Password recovery/reset and SSO/MFA are not implemented. An existing user's login is stored in the database; deleting configuration or editing the bootstrap password does not recover it. Do not replace the operational database to regain access. Arrange an administrator-led recovery procedure before operational rollout.

Back up the reader wrapping key separately from the database. Losing it prevents verification of existing encrypted reader credentials; changing the environment value alone does not re-encrypt them. No private values or access grants are transferred by this report. Receiving owners must confirm custody through their approved secure channel.

## Upgrade, backup and recovery

### Preserve an existing installation

1. Stop the old application and back up its whole folder, including `.env`, the complete `data/` directory and any bundle-specific login files.
2. Extract 0.5.0 into a separate folder. Copy the original `.env` and the complete stopped `data/` directory into it; retain relevant local login files privately.
3. Install the new lockfile's dependencies using `npm ci --omit=dev --ignore-scripts`. Do not copy the old `node_modules` into the new version.
4. Start the new version. Unapplied migrations, including `005_reference_workflows.sql`, run automatically and transactionally.
5. Verify existing logins, masters, recent movements, audit and reader history before reopening normal use. Keep the old backup until acceptance.

There is no documented down-migration. If an upgrade must be rolled back, stop writes and use the matching pre-upgrade code, database backup and private configuration together. Preserve and reconcile any events recorded after the backup; do not point old code at a newly migrated database and assume compatibility.

### Consistent backup

For a live database, use the supplied online backup script with a new destination filename in an existing protected backup directory. For example, on Windows:

```bat
node scripts/backup.mjs data/trolley.sqlite "C:\TrolleyBackups\trolley-2026-11-01.sqlite"
```

The command backs up the database, not `.env` or the wrapping key. Copying only the main file while SQLite is running can omit WAL contents. A complete data-directory copy is an alternative only after stopping the application. Arrange backup encryption, retention, schedules, an independent destination and failure alerts; automatic backup scheduling is not part of this application.

### Restore

Follow [docs/OPERATIONS.md](docs/OPERATIONS.md): stop the service and block client writes, preserve the incident directory, restore a verified backup into a fresh data directory as `trolley.sqlite`, and retain the corresponding private configuration/key. Never combine a restored database with stale WAL/SHM files.

Before reopening access, use controlled maintenance to revoke restored sessions and reconcile user status: restoring an older backup can revive sessions or accounts revoked afterward. Then verify login, masters, movement/audit/reader history and reconcile physical events since the backup. Record restore duration and data loss against an agreed recovery time objective (RTO) and recovery point objective (RPO). An isolated restore drill on the receiving installation remains an owner acceptance task.

## Deployment and operations

The Windows launcher is a foreground local-test workflow. A managed service needs an explicit service supervisor, restricted filesystem permissions, persistent local storage, controlled restart and an assigned operator.

For multiple client computers, use a reviewed HTTPS reverse proxy preserving the public Host header and `SECURE_COOKIE=true`. Configure request-size/time limits, proxy-level rate limiting and network access controls. Camera access on a remote plain-HTTP LAN address may fail browser secure-context requirements.

`Dockerfile`, `compose.yaml`, `compose.production.yaml` and `deploy.Caddyfile` are supplied templates. The Compose data volume is `trolley-data`; the default published application port is localhost-only. Public deployment requires controlled DNS, TLS certificate access and infrastructure review. Docker, public HTTPS and the production template have not been validated by the recorded local release checks.

Monitor `GET /api/health` for database access, process availability, disk space, HTTP errors, backup failures and reader activity. HTTP JSON logs include request IDs, paths, statuses and durations; request IDs help correlate failures without copying passwords or request bodies into tickets. Log retention, monitoring, backup jobs, incident response and service levels are receiving-team responsibilities.

The Node SQLite database belongs on a persistent local disk, with one application instance. Multi-instance storage, HA and production capacity guarantees require further design and validation. The older hosted demo has a separate runtime and deployment contract; this source push does not deploy it or establish feature parity.

## Validation evidence

The recorded software acceptance run was **22 October 2026**, on Linux with Node.js 24.19.0 and Chromium 154. See [docs/VALIDATION.md](docs/VALIDATION.md) for detail.

| Check                                  | Recorded result                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Syntax, formatting and whitespace      | Passed.                                                                                                                                 |
| Application/domain/API/rendering suite | 46 passed; none failed or skipped.                                                                                                      |
| Separate hosted-adapter suite          | 3 passed; no hosted 0.5.0 parity or deployment claim.                                                                                   |
| Browser journeys                       | 13 passed.                                                                                                                              |
| Total automated test cases             | 62 across the three suites above.                                                                                                       |
| Isolated load smoke                    | 400 requests, 20 concurrent clients, 50 trolleys, zero failures; p50 395 ms, p95 813 ms.                                                |
| Offline asset check                    | All fourteen screens exercised with external requests blocked; no external requests or browser errors.                                  |
| Visual/accessibility review            | 1440px desktop and 390px phone screenshots, contained page width, Escape focus restoration and theme changes preserving movement input. |

Coverage includes authorization, migration/restart preservation, online backup/restore, approval/correction/receipt transitions, idempotency, versions, notifications, signed reader evidence and real filtered/paginated exports. The load result is a local smoke test, not a production capacity guarantee.

This handover update changes documentation only. On 1 November 2026, `npm run format:check`, local Markdown link-target validation and `git diff --check` passed. The application/browser suites are historical acceptance evidence and are not rerun or redated for this report. The repository CI definition includes syntax, formatting, application, hosted-adapter and browser checks plus a Docker build; a workflow definition is not evidence of a successful remote CI run.

To reproduce software checks in an isolated development checkout:

```sh
npm ci --ignore-scripts
npm run check
npm run format:check
npm test
npm run test:hosted
npx playwright install chromium
npm run test:browser
npm run test:load
```

For an already installed compatible Chromium, use `CHROMIUM_EXECUTABLE_PATH` instead of downloading a browser. Keep load/acceptance fixtures isolated from operational data.

## Remaining acceptance and ownership

No named receiving owners, recovery targets or operational sign-off have been recorded. Assign them before plant rollout. These are explicit remaining acceptance items; the completed Linux software checks do not close them.

| Priority                             | Required next step                                                                                                                                            | Receiving owner to assign                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Before local acceptance              | Run Windows 64-bit setup/upgrade on the actual computer; verify preserved accounts/data, offline startup and a movement/independent approval/receipt journey. | Application maintainer and plant tester       |
| Before real operations               | Validate actual location/product/type rules, named accounts, location scopes and escalation responsibilities using plant data.                                | Plant process owner and account administrator |
| Before real operations               | Confirm secure configuration/key custody, backup schedule/retention, agreed RTO/RPO and an isolated restore/session-revocation drill.                         | Backup/recovery owner                         |
| Before LAN/public rollout            | Validate service supervision, HTTPS, secure cookies, proxy limits, monitoring, infrastructure controls and recovery procedures.                               | Infrastructure/security owner                 |
| Before reader deployment             | Confirm reader protocol, antenna/direction, tag format, clock synchronization, duplicate/retry handling and real-camera compatibility.                        | Hardware/integration owner                    |
| If disconnected readers are required | Implement durable bridge buffering and reconciliation; the supplied sender is not an automatic persistent queue.                                              | Integration owner                             |
| Before broader enterprise use        | Address password recovery/account lifecycle, SSO/MFA requirements, security review, representative load/soak and any shared-storage/HA requirement.           | Product, security and infrastructure owners   |

Actual Windows CMD execution, physical cameras/RFID hardware, Docker deployment, public HTTPS, multi-hour soak and enterprise availability remain unvalidated in the recorded release. Browser tests of decoder/permission behavior do not establish physical device compatibility. No durable disconnected-browser synchronization, automatic email/SMS delivery, enterprise identity or multi-stage approval capability is implied.

For troubleshooting: check Node 24+, the private `.env` filename and dependency installation if startup fails; check the configured host/port and command window if the page is unreachable. A 403 may be the expected role/location guard; a 409 requires refreshing current state or resolving an existing open operation rather than bypassing version/idempotency checks. Follow the original receipt/approval workflow when a trolley is in transit or pending review.

## Documentation and continuation rules

| Document                                                                                               | Purpose                                                          |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [README.md](README.md)                                                                                 | Installation, update and user-facing entry point.                |
| [prd.md](prd.md)                                                                                       | Fourteen-screen requirements, roles, data and acceptance.        |
| [architecture.md](architecture.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                       | Canonical architecture and detailed module/integrity map.        |
| [design.md](design.md)                                                                                 | Reference layout, visual system, accessibility and interactions. |
| [rules.md](rules.md), [AGENTS.md](AGENTS.md)                                                           | Project conventions and reusable rules for future work.          |
| [tasks.md](tasks.md), [memory.md](memory.md)                                                           | Completed work, outstanding verification and durable decisions.  |
| [docs/API.md](docs/API.md)                                                                             | Node API contracts and permissions.                              |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)                                                               | Deployment, consistent backup and recovery procedure.            |
| [docs/READER_INTEGRATION.md](docs/READER_INTEGRATION.md), [docs/PLANT_POLICY.md](docs/PLANT_POLICY.md) | Reader wire/credential contract and plant-policy background.     |
| [docs/VALIDATION.md](docs/VALIDATION.md)                                                               | Dated evidence and platform/deployment limits.                   |

Before future changes, read the governing documents, preserve unrelated work and data, keep domain logic in services and update affected requirements/decisions. Write focused modules and comments only where they explain a non-obvious reason. Validate the changed behavior, record actual evidence and never claim a push, deployment or platform test that has not occurred. Merge into `main`, tagging and deployment are separate release actions from this branch handover.
