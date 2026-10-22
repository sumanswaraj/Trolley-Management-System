# Node application API — 0.5.0

POST routes accept JSON up to 32 KiB. Browser clients use an HttpOnly, SameSite=Strict session cookie; enable Secure cookies behind HTTPS. Sessions expire after eight hours. Cross-origin browser mutations are rejected. Readers use separate HMAC authentication. Errors return `error` and `requestId` with an appropriate HTTP status.

The six account roles are Admin, Plant Manager, Supervisor, Operator, Quality User and Store User. The authoritative page/action matrix is `src/security.mjs`; a hidden control is not an authorization check. Location scopes restrict mutations when enabled, while the shared fleet snapshot remains plant-wide.

## Accounts, state and master data

| Route                                                          | Method   | Contract                                                                                                                                                                       |
| -------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/health`                                                  | GET      | Database health; no login required.                                                                                                                                            |
| `/api/login`                                                   | POST     | `username`, `password`; create session.                                                                                                                                        |
| `/api/logout`                                                  | POST     | End the current session.                                                                                                                                                       |
| `/api/me`                                                      | GET      | Current authenticated account metadata.                                                                                                                                        |
| `/api/state`                                                   | GET      | Masters, fleet, recent/open movements, access metadata, alerts, notifications, approvals and settings available to the account.                                                |
| `/api/users`                                                   | GET/POST | Admin: list metadata, or create `username`, `name`, `password` (12+ characters), `role`.                                                                                       |
| `/api/users/deactivate`                                        | POST     | Admin: `id`; revoke sessions and retain history.                                                                                                                               |
| `/api/locations`                                               | POST     | Admin/Supervisor: `id`, `name`, `external`, `group_name`, `capacity`, `department`, `expected_minutes`.                                                                        |
| `/api/products`                                                | POST     | Admin/Supervisor: `id`, `name`, `category`, `unit`, `default_batch`, `allowed_groups`.                                                                                         |
| `/api/trolleys`                                                | POST     | Admin/Supervisor: empty trolley with `id`, `type`, `capacity`, `unit`, `location`; optional material, department, assigned-area, QR/RFID, tag-health and maintenance metadata. |
| `/api/locations/:id`, `/api/products/:id`, `/api/trolleys/:id` | POST     | Admin: update permitted master fields. Trolley edits require `version`; IDs and QR identity are permanent. Operational load/location/status changes use movement commands.     |
| `/api/trolleys/:id`                                            | GET      | Authenticated: trolley detail, movement and audit context.                                                                                                                     |
| `/api/trolleys/lookup?code=...`                                | GET      | Resolve a trolley ID, QR value or RFID/tag value.                                                                                                                              |
| `/api/trolleys/:id/active`                                     | POST     | Admin: `active`, `version`; lifecycle restrictions protect open operations.                                                                                                    |
| `/api/trolleys/:id/label`                                      | GET      | Authenticated: generated SVG QR label encoding the trolley ID.                                                                                                                 |

Optional trolley metadata includes `material_type`, `department`, `assigned_area`, `qr`, `rfid`, `tag_health` and `maintenance_due` (epoch milliseconds). Registration creates an empty available trolley; clients cannot inject a loaded operational state through master creation.

## Movements, verification and approvals

| Route                         | Method | Contract                                                                                                                                   |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/movements`              | POST   | Authorized moving role: `trolley`, `destination`, `product` or null, `batch`, `qty`, `expected`, `version`, `key`; optional context below. |
| `/api/movements/:id/approve`  | POST   | Independent permitted approver; `reason` for applicable exceptions.                                                                        |
| `/api/movements/:id/reject`   | POST   | Independent permitted approver; optional `reason`.                                                                                         |
| `/api/movements/:id/receive`  | POST   | Authorized destination operator: physically confirm In Transit → Received.                                                                 |
| `/api/verify`                 | POST   | Admin/Supervisor/Quality User: `trolley`, `product`, optional `batch`; persist verification and its issues.                                |
| `/api/approvals`              | GET    | Approval metadata for the authenticated workflow.                                                                                          |
| `/api/approvals/mismatch`     | POST   | Request review of a recorded product verification using `verification`; optional `remarks`.                                                |
| `/api/approvals/:id/approve`  | POST   | Independent authorized approver; reason required for applicable product/policy exceptions.                                                 |
| `/api/approvals/:id/reject`   | POST   | Reject with `reason`/`remarks`; retain original request.                                                                                   |
| `/api/approvals/:id/correct`  | POST   | Request correction with `reason`/`remarks`.                                                                                                |
| `/api/approvals/:id/resubmit` | POST   | Requester/Admin: corrected movement fields plus current `version` and request `key`, or corrected `verification` for a product review.     |

Movement context includes `source`, `movement_type`, `operator_id`, `department`, `occurred`, `reason`, `remarks`, `status_after`, `direct_complete` and `exceptionReason`. Timestamps use epoch milliseconds. The service validates source, capacity, units, identity, declared role/type, policy and location rights. Explicit direct completion records a physical handover; a request requiring approval still waits for that approval.

A correction retains the original movement/decision, marks the approval as Correction Requested, and creates a linked replacement on resubmission. Old request details are not edited. Idempotency keys deduplicate matching retries and reject different payloads under the same key. Versions reject stale commands; the database prevents simultaneous open movements. Reader observations never execute receipt.

## Alerts, notifications, overdue and settings

| Route                         | Method   | Contract                                                                                                                                             |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/alerts`                 | GET      | Current alerts; filters include status, priority, type, trolley and search.                                                                          |
| `/api/alerts`                 | POST     | Report `trolley`, `type`, `priority`, `message`; validate location rights.                                                                           |
| `/api/alerts/:id/acknowledge` | POST     | Admin/Plant Manager/Supervisor/Quality User: acknowledge an Open alert.                                                                              |
| `/api/alerts/:id/resolve`     | POST     | Same roles: resolve, optionally recording `resolution`/`reason`.                                                                                     |
| `/api/alerts/:id/reopen`      | POST     | Same roles: reopen a Resolved alert.                                                                                                                 |
| `/api/notifications`          | GET      | Broadcast and account-targeted notifications, with this account's read state.                                                                        |
| `/api/notifications/read`     | POST     | Mark `all: true`, `ids`, or `id` read for the current account.                                                                                       |
| `/api/overdue/:id/remind`     | POST     | Admin/Plant Manager/Supervisor: optional `message`; deliver an in-app reminder to the responsible account.                                           |
| `/api/overdue/:id/return`     | POST     | Use the empty return movement workflow; `version`, `key`, optional store `destination`, reason and remarks. Open operations must be completed first. |
| `/api/settings`               | GET/POST | Read settings; Admin updates approval/policy settings through the policy service.                                                                    |
| `/api/policies`               | GET      | Admin/Supervisor: enforcement, routes and compatibility; Admin sees scopes.                                                                          |
| `/api/policies/settings`      | POST     | Admin: `enforce_routes`, `enforce_categories`, `scope_operations`, `outside_approval`, `mismatch_approval`.                                          |
| `/api/policies/categories`    | POST     | Admin/Supervisor: `trolley_type`, `category`.                                                                                                        |
| `/api/policies/routes`        | POST     | Admin/Supervisor: `source`, `destination`, `category`, `requires_quality`.                                                                           |
| `/api/policies/scopes`        | POST     | Admin: `user_id`, `location`, `can_depart`, `can_receive`.                                                                                           |

Reminder delivery is stored in this application; it is not an email/SMS integration. Alert synchronization derives exceptions such as overdue, outside, unfinished movement and maintenance from stored trolley/movement/reader evidence.

## History, reports and exports

| Route                       | Method | Contract                                                                                                              |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `/api/history`              | GET    | Authenticated: bounded movement history with `items`, `nextCursor` and total/page metadata.                           |
| `/api/audit`                | GET    | Authorized approver roles: bounded audit history.                                                                     |
| `/api/history/export`       | GET    | Matching complete history export; `format=csv`, `xlsx` or `pdf` (default CSV).                                        |
| `/api/reports/summary`      | GET    | Reporting permission: event counts and request-to-receipt summary.                                                    |
| `/api/reports/:type`        | GET    | Reporting permission: report columns, rows, filters, totals and metric description.                                   |
| `/api/reports/:type/export` | GET    | Reporting permission: full filtered CSV/XLSX/PDF download (default XLSX).                                             |
| `/api/analytics`            | GET    | Reporting permission: stored-event trends, fleet utilization, location/product distributions and metric descriptions. |

Canonical report types are `daily`, `utilization`, `location`, `product`, `overdue`, `outside`, `exceptions` and `history`. Reporting permission belongs to Admin and Plant Manager in the reference role matrix. History export remains available to authenticated roles.

History/report filters include `from`/`to` (epoch milliseconds or supported date strings), `trolley`, `location`, `product`, `operator`, `department`, movement `type`, `status` and `q`/`search` where applicable. Date-only end dates include that full day. History/audit use `limit` (1–100) and exclusive `before` cursor; reports can use `page` and `limit` (up to 200). Exports remove pagination and retain the applicable filters. Reports identify UTC grouping. Snapshot utilization and measured movement durations are distinct metrics; direct-completion entries are excluded from separate receipt-duration averages.

CSV output quotes cells and protects formula-like text. XLSX is a real workbook generated by ExcelJS; PDF is generated by PDFKit. Both run locally on the server. Export responses use an attachment filename and no-store caching.

## Readers and sample plant

| Route                     | Method   | Contract                                                                                                                     |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/api/readers`            | GET/POST | Admin: list reader/tag metadata without secrets, or provision `id`, `name`, `location`; credential returned once.            |
| `/api/readers/rotate`     | POST     | Admin: `id`; replace credential and invalidate the old one.                                                                  |
| `/api/readers/deactivate` | POST     | Admin: `id`; retain observations.                                                                                            |
| `/api/tags`               | POST     | Admin: map `tag` to `trolley`; reject conflicting identity assignment.                                                       |
| `/api/reader-events`      | POST     | HMAC identity: `eventId`, `tag`, `observedAt`; see [READER_INTEGRATION.md](READER_INTEGRATION.md).                           |
| `/api/demo/load`          | POST     | Admin: load 128 sample trolleys, 11 locations and 10 products only into an empty operational database.                       |
| `/api/demo/reset`         | POST     | Admin: `confirm: "RESET DEMO DATA"`; restore marked sample records, preserve history and reject conflicting open operations. |

No endpoint deletes operational history. SQL protections enforce append-only history/request snapshots and audit rows, while infrastructure owners retain filesystem/database access. SSO, multi-stage approvals and visibility scopes are separate capabilities.

This contract describes the Node application. `deploy/hosted-demo` is a separate older adapter and is not automatically redeployed with these routes.
