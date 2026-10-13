# Smart Trolley Management System

A runnable shared-system MVP with a responsive frontend, authenticated Node.js API and persistent SQLite database. The original design prototype is preserved at `/prototype` and remains an explicitly labelled browser-local demo.

## Included packages

- Responsive frontend: HTML, CSS and JavaScript; no frontend build step or CDN dependency.
- Backend: Node.js HTTP server, SQLite migrations, password hashing and cookie sessions.
- Operations: real location/product/trolley masters, departures, approvals, arrival confirmation, overdue dashboard, history, CSV export and append-only audit records.
- Delivery: package.json scripts, Dockerfile, Compose, environment template, Windows launcher and integration tests.

## Run on Windows, Linux or macOS

1. Install Node.js 24 or later.
2. Copy `.env.example` to `.env` and set a unique `ADMIN_PASSWORD` of at least 12 characters.
3. Run `node --env-file=.env server.mjs` from the project folder. On Windows, alternatively double-click `start-windows.cmd`.
4. Open http://127.0.0.1:8080 and sign in as `admin` using your configured password.
5. Add locations, products and trolleys in Plant setup, then add individual users in User management.

No npm dependencies are required: the backend uses Node's built-in HTTP, SQLite and crypto packages. `npm run check` checks JavaScript syntax; `npm test` runs API integration tests. Changing ADMIN_PASSWORD after the first start does not reset an existing account's password. The schema uses version-tracked migrations, and account deactivation revokes sessions without removing history.

## Docker

Set ADMIN_PASSWORD in `.env`, then run `docker compose up --build -d`. Database files persist in the `trolley-data` volume. The published port is bound to the local machine by default.

## Workflow

Scan a trolley ID with a USB keyboard scanner or enter it manually. Select destination, product, batch, quantity and expected time. Internal movements depart immediately; outside-plant movements wait for approval by a different admin/supervisor. Confirm arrival after the trolley reaches its destination. Its recorded location stays at the source until receipt is confirmed.

The quantity and capacity must use the same units. This MVP does not infer weight from piece count. Load/product values are declared during departure; it does not yet enforce category-specific routing or batch lineage.

## Deployment boundaries

This MVP is tested locally, not deployed or certified for production. Camera QR scanning and physical RFID readers are not connected. Secure transport, infrastructure backups, password recovery, device credentials, offline queues and detailed role/location policies remain release work. Serve behind an HTTPS reverse proxy and set SECURE_COOKIE=true for a plant-wide/cloud deployment. Do not expose plain HTTP on the public internet.

See docs/API.md, docs/ARCHITECTURE.md, docs/OPERATIONS.md and IMPLEMENTATION_PLAN.md for API and release details.
