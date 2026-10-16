# API contract

POST routes accept JSON up to 32 KiB. UI routes use an HttpOnly, SameSite=Strict session cookie; secure cookies are enabled for HTTPS deployments. Sessions expire after eight hours. Cross-origin browser mutations are rejected. Login uses salted scrypt hashes. Readers use a separate HMAC identity without UI sessions.

| Route                      | Method | Purpose / permission                                                                                                                         |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| /api/health                | GET    | Database health check                                                                                                                        |
| /api/login                 | POST   | username, password                                                                                                                           |
| /api/logout                | POST   | End current session                                                                                                                          |
| /api/me                    | GET    | Current authenticated user                                                                                                                   |
| /api/state                 | GET    | Plant masters/fleet, all open movements, recent history and permitted audit snapshot                                                         |
| /api/users                 | GET    | Admin: metadata only, no password fields                                                                                                     |
| /api/users                 | POST   | Admin: username, name, password (12+ characters), role                                                                                       |
| /api/users/deactivate      | POST   | Admin: id; revoke sessions, retain history                                                                                                   |
| /api/locations             | POST   | Admin/Supervisor: id, name, external boolean                                                                                                 |
| /api/products              | POST   | Admin/Supervisor: id, name, category, unit (default pcs)                                                                                     |
| /api/trolleys              | POST   | Admin/Supervisor: id, type, capacity, unit (default pcs), location                                                                           |
| /api/trolleys/:id/label    | GET    | Authenticated: SVG QR encoding the permanent registered QR value                                                                             |
| /api/movements             | POST   | Authenticated, scoped source: trolley, destination, product or null, batch, qty, expected (epoch ms), version, key, optional exceptionReason |
| /api/movements/:id/approve | POST   | Independent permitted approver; optional reason, required for exceptions                                                                     |
| /api/movements/:id/reject  | POST   | Independent permitted approver; optional reason                                                                                              |
| /api/movements/:id/receive | POST   | Authenticated, scoped destination; In Transit -> Received                                                                                    |
| /api/policies              | GET    | Admin/Supervisor: enforcement, routes, compatibility; scopes visible to Admin                                                                |
| /api/policies/settings     | POST   | Admin: enforce_routes, enforce_categories, scope_operations booleans                                                                         |
| /api/policies/categories   | POST   | Admin/Supervisor: trolley_type, category                                                                                                     |
| /api/policies/routes       | POST   | Admin/Supervisor: source, destination, category, requires_quality boolean                                                                    |
| /api/policies/scopes       | POST   | Admin: user_id, location, can_depart, can_receive booleans                                                                                   |
| /api/history               | GET    | Authenticated: paged movements                                                                                                               |
| /api/audit                 | GET    | Admin/Supervisor: paged audit                                                                                                                |
| /api/reports/summary       | GET    | Authenticated: requested/received/rejected counts and request-to-receipt duration                                                            |
| /api/readers               | GET    | Admin: reader/tag metadata and latest observations, no credentials                                                                           |
| /api/readers               | POST   | Admin: id, name, location; credential returned once                                                                                          |
| /api/readers/rotate        | POST   | Admin: id; new credential returned once, old credential invalidated                                                                          |
| /api/readers/deactivate    | POST   | Admin: id; preserves observations                                                                                                            |
| /api/tags                  | POST   | Admin: tag, trolley; conflicting reassignment is denied                                                                                      |
| /api/reader-events         | POST   | HMAC reader identity: eventId, tag, observedAt; see READER_INTEGRATION.md                                                                    |

History/audit query parameters: limit (1–100; default 50), before (exclusive ID cursor), from/to (inclusive epoch milliseconds), trolley (exact ID). Responses contain items and nextCursor. No nextCursor means the matching history has ended. Summary queries accept from/to; default is the last 30 days. Daily grouping is UTC and the mean duration includes approval wait.

Location changes only after receipt. Capacity mismatches are rejected. Outside destinations, quality routes and policy exceptions wait for independent approval. Exception approvals require a reason. Scoped operations are enforced by the service when enabled. See PLANT_POLICY.md for the current approval-role matrix and default enforcement semantics.

Mutations execute in transactions. Unique request keys deduplicate matching movement retries and reject different payload reuse. Trolley versions reject stale commands. A partial unique index prevents simultaneous open movements. Reader events are deduplicated separately and never modify movement state.

Errors return error plus requestId with 400, 401, 403, 404, 409, 413, 415, 429 or 503 status as applicable. No operational-history deletion endpoint exists. SQL triggers protect history/request snapshots and audit rows; infrastructure owners can still modify database files.

Current UI roles: Admin, Supervisor, Operator, Quality User, Store User. Location permissions restrict mutations; fleet visibility remains plant-wide. SSO, data visibility scopes and multi-stage approvals are not implemented.

## Version 0.5 additions

All routes below require a session. JSON mutation bodies retain the 32 KiB limit. Identifier path segments must be URL encoded.

| Route                             | Method | Behavior                                                                                                                        |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `/api/lookup?code=...`            | GET    | Case-insensitive trolley ID, permanent QR, RFID or assigned reader tag lookup                                                   |
| `/api/:kind/:id/update`           | POST   | Admin/Supervisor master edit; kind is locations, products or trolleys; requires current `version`                               |
| `/api/:kind/:id/active`           | POST   | Admin/Supervisor; `{version, active}`; preserves identities and history                                                         |
| `/api/operations`                 | GET    | Automatic alert refresh and current alerts, own notifications, accessible verifications and approvals                           |
| `/api/incidents`                  | POST   | `{type, priority, trolley, location?, message}` with location scope checks                                                      |
| `/api/alerts/:id`                 | POST   | Authorized alert managers: `{status, remarks?}`; Open, Acknowledged or Resolved                                                 |
| `/api/verifications`              | POST   | Admin/Supervisor/Quality User: `{trolley, product?, type?, location?, qty?, batch?, remarks?}`; persists read-only verification |
| `/api/verification-approvals`     | POST   | Verification requester: `{verification, reason}`; deduplicates repeat requests                                                  |
| `/api/verification-approvals/:id` | POST   | Independent Admin/Plant Manager/Supervisor: `{decision, remarks}`; Approved, Rejected or Correction Required                    |
| `/api/reminders`                  | POST   | `{trolley, message?}`; overdue-only in-app reminder to responsible user, five-minute rate limit                                 |
| `/api/notifications/:id`          | POST   | Mark own notification read; `all` marks only the current user's notifications                                                   |
| `/api/reports`                    | GET    | Eight-report catalogue; `?kind=daily\|util\|loc\|prod\|over\|hist\|out\|exc` returns columns and complete rows                  |
| `/api/reports/:kind/xlsx`         | GET    | Actual Excel workbook, matching report filters                                                                                  |
| `/api/reports/:kind/pdf`          | GET    | Actual paginated PDF, matching report filters                                                                                   |
| `/api/analytics`                  | GET    | Recorded fleet, arrival, daily/weekly, return-cycle, overdue, distribution and flow data                                        |
| `/api/movements/:id/correct`      | POST   | Independent approver: `{reason}`; closes original request with durable correction metadata                                      |

Master fields now include location `group_name`, `department`, `bay_capacity`, `expected_minutes`; product `default_batch`, `allowed_locations`; trolley `material_type`, `department`, `assigned_area`, immutable `qr_value`, `rfid`, and `tag_condition` (Good, Damaged, Unreadable, Missing). Updates cannot silently change a trolley's load, current location, operational status or permanent identity.

Movement requests accept `movement_type`, `department`, `reason`, `remarks`, `occurred_at`, `status_after`, `in_transit` and `revision_of`. `in_transit` defaults to true; false explicitly records actual arrival together with departure, after any required approval. Operator identity always comes from the session. Plant Managers approve but cannot enter movements or edit masters. Quality/Store users have role-specific movement types.

Plant settings accept partial boolean updates for `outside_approval`, `mismatch_approval`, `enforce_routes`, `enforce_categories`, and `scope_operations`; only Admin can change them. Required quality release and location rights remain enforced.

History query parameters are `q`, `from`, `to`, `trolley`, `location`, `operator`, `product`, `type`, `state`/`status`, `before` and `limit` (maximum 100). Reports accept matching filters without a row cap. Date-only end dates are inclusive UTC days. Audit supports `q`, `from`, `to`, `trolley`, `before` and `limit`. Exports require authentication and contain ordinary cell strings, not executable spreadsheet formulas.
