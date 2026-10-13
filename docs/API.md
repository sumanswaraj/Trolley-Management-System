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
| /api/trolleys/:id/label    | GET    | Authenticated: SVG QR encoding the exact trolley ID                                                                                          |
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
