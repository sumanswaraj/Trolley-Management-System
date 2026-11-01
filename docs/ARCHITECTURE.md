# Node architecture and code conventions — 0.5.0

The canonical root overview is [architecture.md](../architecture.md). This document records implementation details for the fourteen-page, six-role Node application. The older hosted adapter under `deploy/hosted-demo` has its own runtime and deployment contract.

## Module boundaries

| Path                                                     | Responsibility                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `public/app.js`                                          | Small entry point loading the operational controller.                                                 |
| `public/experience.js`                                   | Authenticated state, navigation, events, API orchestration, theme, camera lifecycle and dialog focus. |
| `public/experience-shell.js`                             | Login, reference navigation/header, notifications, static SVG icons and dialog frame.                 |
| `public/monitoring-views.js`                             | Dashboard, fleet, overdue, locations, history, reports and analytics rendering.                       |
| `public/operations-views.js`, `operations-model.js`      | Masters, scan/movement/product workflows, alerts, approvals, settings and their presentation helpers. |
| `public/experience.css`                                  | Offline system fonts, reference visual system and desktop/phone accessibility.                        |
| `public/api.js`, `experience-ui.js`                      | Same-origin transport, errors, escaping and common rendering helpers.                                 |
| `src/http/application.mjs`                               | Static allowlist, HTTP boundaries, routing, headers and export responses.                             |
| `src/services/masters.mjs`                               | Master lifecycle, identity lookup, detail/state and protected operational fields.                     |
| `src/services/movements.mjs`, `policies.mjs`             | Transactional movements, capacity/units, approval, receipt, route/type and location rules.            |
| `src/services/workflow.mjs`                              | Alerts, per-user notification reads, verification, correction/resubmission and overdue follow-up.     |
| `src/services/reports.mjs`, `exports.mjs`                | Filtered stored-event reports/analytics and real CSV/XLSX/PDF serialization.                          |
| `src/services/demo.mjs`                                  | Explicit Admin-only 128-trolley sample load/reset with history preservation.                          |
| `src/services/accounts.mjs`, `readers.mjs`, `labels.mjs` | Named accounts, signed observations and local QR generation.                                          |
| `src/database.mjs`, `src/security.mjs`                   | SQL/transactions/migrations/audit and password/session/role primitives.                               |
| `migrations/`                                            | Ordered schema changes through `005_reference_workflows.sql`.                                         |
| `tests/`, `browser-tests/`, `scripts/`                   | Domain/API and browser checks, syntax validation, isolated load and consistent backup tools.          |

Renderers do not own domain mutations. Escape user/API values before HTML interpolation and parameterize SQL. Comments explain constraints or reasons rather than repeating code. Add migrations instead of rewriting a migration already applied to a database.

## Persistence and transitions

Migration 005 extends existing locations, products, trolleys, movements and settings, and adds alerts, notifications/read markers, approval requests and product verifications. Existing IDs/accounts/history remain in place. Trolley identity is permanent; master edits cannot bypass movement/location/load rules. Startup applies only unapplied migrations transactionally.

A trolley has at most one open movement. A normal departure becomes In Transit while retaining its source location; receipt commits the destination and increments its version. Explicit completed entries represent a handover already confirmed by the operator. If approval is required, location/status changes remain gated by that decision. Reader observations remain independent evidence.

Matching request-key retries return the original movement, while altered payloads under the same key fail. Version checks reject stale commands. Request snapshots and audit rows retain their database protections. Correction requests preserve the original decision and request; resubmission creates a linked replacement instead of rewriting history.

Alert state is Open, Acknowledged or Resolved. Workflow synchronization raises/resolves system exceptions from stored evidence. Notifications are broadcast or targeted, with per-account read markers. Overdue reminders are in-app notifications; return actions call the existing movement service.

Sample load requires an empty operational database. Sample reset requires an installation marked by the sample loader, explicit confirmation, and safe conditions around affected open operations. It restores sample snapshots while retaining movement/audit history and accounts.

## Access and local assets

The server owns the six-role reference matrix in `src/security.mjs`. Frontend navigation follows supplied access metadata; every protected operation separately validates permission and location rights. Settings retain real user administration, policies, reader credentials and audit access. No browser-side role switch grants authority.

Passwords are salted scrypt hashes. Only session-token hashes are stored; cookies are HttpOnly/SameSite=Strict and can be Secure behind HTTPS. Reader secrets are encrypted at rest and HMAC observations have replay/deduplication checks. Logs must omit passwords, cookies, tokens and request bodies.

The operational page loads local modules, stylesheet, static SVG icons, charts and jsQR fallback. ExcelJS and PDFKit generate actual downloads on the server. The original `public/prototype.html` remains an unserved design reference with simulated state/CDN dependencies.

## Metrics and scaling boundary

Reports identify whether a value is a current snapshot or an observation from recorded events. Daily grouping is UTC. Separate receipt-duration metrics exclude explicit direct-completion entries; cycle metrics require a matching recorded issue/return. Exports preserve applicable filters and remove UI pagination.

SQLite and synchronous password/database operations make this a single-instance local/pilot architecture. Keep the database on a local persistent disk, not a network share, and do not run multiple replicas against the file. Dedicated histories are bounded; large-fleet APIs and a PostgreSQL/shared-session design require separate work.

For updates, stop the service, preserve `.env` and the complete data directory, install matching dependencies and let migrations apply once. Use SQLite's online backup API for a live backup; copying only an active main file can omit WAL data. Validate Windows launchers, actual readers, public HTTPS and deployment infrastructure separately. See [VALIDATION.md](VALIDATION.md) for evidence.
