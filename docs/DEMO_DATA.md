# Isolated sample plant

The optional demo runs the complete application against `data/demo.sqlite` on `http://127.0.0.1:8081`. It leaves the normal application's `data/trolley.sqlite` untouched. Use it for local development and demonstrations only: its six accounts share the configured development password.

Install dependencies with `npm ci`, copy `.env.example` to `.env` if needed, and set `ADMIN_PASSWORD` to your own password of 12–256 characters. Keep `.env` private. Start the demo from the repository root:

```sh
npm run demo
```

The equivalent direct command is:

```sh
node --env-file=.env scripts/demo.mjs
```

The first startup seeds an empty demo database. Later startups preserve its users, assignments, history and decisions. An existing database with operational records or additional accounts is left unchanged. Sample operational IDs start with `DEMO-`; the administrator account remains `admin`.

| Username          | Name          | Role          |
| ----------------- | ------------- | ------------- |
| `admin`           | Administrator | Admin         |
| `demo.manager`    | Sunita Rao    | Plant Manager |
| `demo.supervisor` | Ramesh Iyer   | Supervisor    |
| `demo.operator`   | Rahul Kumar   | Operator      |
| `demo.quality`    | Neha Sharma   | Quality User  |
| `demo.store`      | Amit Verma    | Store User    |

All six accounts use the `ADMIN_PASSWORD` value present when the empty database was seeded. Changing `.env` afterward does not change existing account passwords.

The sample plant includes the prototype's 128 trolleys, five trolley types, 11 named locations and 10 products with batches, measurement units, location rules, QR values and RFID identifiers. Assignments cover available, in-use, transit, quality waiting, maintenance and outside-plant trolleys. The database also includes a completed return trip, two pending outside movements, rejection and correction decisions, product verification mismatches, supervisor decisions, alerts and notifications.

Every sample movement, receipt, approval and incident is recorded through the application's services. Their timestamps reflect when the seed actually runs. Analytics count these recorded events; historical trends fill as activity accumulates. Overdue trolleys appear when their actual movement or location holding deadline passes.

To use another local port:

```sh
DEMO_PORT=8082 npm run demo
```

Stop the demo with Ctrl+C before resetting it. A reset archives the existing demo database and its SQLite sidecars under a timestamped `data/demo-backups/` directory, then seeds a fresh demo database:

```sh
DEMO_RESET=1 npm run demo
```

Reset affects only the isolated demo. Its backups contain sample account password hashes and should remain private. The normal application database is neither reset nor archived. A process lock prevents two demo processes from modifying the sample database simultaneously.

For automated checks, importing `scripts/demo.mjs` does not start a server. Its `seedDemo(repository, password)` export accepts an application repository, returns the seeded counts, and returns `{ seeded: false }` when existing records must be preserved. Use an in-memory or temporary database for these checks.
