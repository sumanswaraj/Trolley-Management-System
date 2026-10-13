# Architecture and code conventions

## Module boundaries

| Directory        | Responsibility                                                    |
| ---------------- | ----------------------------------------------------------------- |
| public/app.js    | UI events and client-side state                                   |
| public/views.js  | Page composition; no API calls                                    |
| public/ui.js     | Accessible forms, tables and escaping                             |
| public/api.js    | Same-origin HTTP requests and typed errors                        |
| src/http         | Routing, JSON limits, HTTP errors and security headers            |
| src/services     | Account, master, movement, policy, report, label and reader rules |
| src/database.mjs | SQL access, transactions, audit writes and migration runner       |
| src/security.mjs | Password hashing, cookies and permission checks                   |
| migrations       | Ordered, version-tracked schema changes                           |
| tests            | API integration and frontend rendering tests                      |
| scripts          | Syntax validation and consistent SQLite backups                   |

Use descriptive identifiers, small functions and explicit state transitions. UI code must never be the sole enforcer of permissions. Escape user-controlled strings in every HTML view. Parameterize SQL. Keep passwords, cookies and request bodies out of logs. Add new migrations instead of rewriting migrations already applied to a deployed database.

## Movement consistency

A trolley has at most one Pending or In Transit request. Internal movements change its status to In Transit but preserve its source location. External requests preserve both until a different manager approves. Receipt changes the location and increments the trolley version. Rejected requests remain in history. All movement and audit writes in a transition commit or roll back together.

A unique request key identifies one declared load and destination. Matching retries return the original movement. Different payloads with the same key fail. The frontend retains this key after network errors. Version checks reject stale commands. SQL triggers prevent removal of movement history or modification of declared request details. Audit update/delete are also blocked. These controls are application/database protections, not cryptographic tamper proofing against infrastructure administrators.

## Runtime and scaling boundary

This release is a single-instance plant pilot using SQLite on a local persistent volume. Never put the SQLite file on a network share or run multiple application replicas against it. Database calls and password hashing are synchronous. No load capacity is claimed. Full state reads include recent history and active movements; masters/fleet remain unpaginated. Dedicated history APIs use bounded keyset pages. Before a large or multi-site rollout, implement PostgreSQL behind repository interfaces, paginated master/fleet APIs, a shared session/rate-limit store, asynchronous device ingestion, and measured load targets.

## Authentication and authorization

Passwords are salted scrypt hashes. Sessions are random tokens; only their SHA-256 hashes are stored. Cookies are HttpOnly and SameSite=Strict, with Secure enabled for HTTPS deployments. Server-side role checks protect user administration, plant masters and approval decisions. Operational roles can move/receive only at permitted locations when scoped operation is enabled. Quality releases use explicit approval roles. Location mutation permissions, category/type rules and product routes are configurable. SSO/MFA and multi-stage approver chains require further implementation.

## Original prototype

`public/prototype.html` preserves the supplied concept as reference source only. Its browser-local roles and RFID statuses are simulations. The operational server does not serve this file, avoiding third-party demo scripts in an authenticated origin.
