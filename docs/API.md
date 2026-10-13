# API contract

All POST routes accept JSON. Login sets an HttpOnly, SameSite=Strict cookie; sessions expire after 8 hours. Cross-origin browser mutations are rejected. Admin credentials are bootstrapped once from ADMIN_PASSWORD. Passwords use salted scrypt hashes.

| Route | Method | Purpose / permission |
|---|---|---|
| /api/health | GET | Health check |
| /api/login | POST | username, password |
| /api/logout | POST | End current session |
| /api/me | GET | Current authenticated user |
| /api/state | GET | Shared masters, fleet, latest 1,000 movements and 500 audit events |
| /api/users | GET | Admin: list account metadata (no password fields) |
| /api/users/deactivate | POST | Admin: id; revokes sessions, keeps history |
| /api/users | POST | Admin: username, name, password (12+ chars), role |
| /api/locations | POST | Admin/Supervisor: id, name, external boolean |
| /api/products | POST | Admin/Supervisor: id, name |
| /api/trolleys | POST | Admin/Supervisor: id, type, capacity, location |
| /api/movements | POST | Any authenticated user: trolley, destination, product or null, batch, qty, expected (epoch ms), version, unique key |
| /api/movements/:id/approve | POST | Different Admin/Supervisor; Pending -> In Transit |
| /api/movements/:id/reject | POST | Different Admin/Supervisor; Pending -> Rejected |
| /api/movements/:id/receive | POST | Authenticated receiver; In Transit -> Received |

Location changes only on receipt. Outside destinations always require approval, including requests from administrators. A partial unique index prevents simultaneous open movements. Mutations execute in SQLite transactions. Request keys deduplicate matching movement retries and reject reuse with different payloads. Stale trolley versions and already-decided approvals return 409.

Errors return `{ "error": "message" }` with 400, 401, 403, 404, 409, 413, 415 or 429 status as applicable. No record deletion endpoint is exposed. Audit UPDATE/DELETE are blocked by database triggers; infrastructure owners can still modify database files.

Current roles: Admin, Supervisor, Operator, Quality User, Store User. Detailed location/category restrictions are not implemented; operational roles currently share movement/receipt access.
