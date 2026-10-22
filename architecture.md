# Application architecture

Status: Node 0.5.0 implements the reference-interface expansion. Integrated Linux application and browser evidence is recorded in docs/VALIDATION.md.

## Runtime

The application is an ES-module Node.js server with persistent SQLite storage and browser modules served from the same origin. Node.js 24 or later is required for the built-in SQLite API. Production dependencies are installed from the lockfile; QR decoding, QR generation and export assets are served or executed locally.

`server.mjs` starts the service and coordinates shutdown. `src/http/application.mjs` owns routing, static-file allowlisting, headers, input boundaries and response handling. Services own account, master-data, movement, policy, reader, report and other domain workflows. Database helpers own SQL, transactions and ordered migrations.

## Persistence and integrity

Keep versioned schema migrations in `migrations/`. Apply each migration once within the existing migration mechanism. Preserve account credentials and existing records during upgrades.

Movement commands must preserve transactional updates, idempotency, optimistic versions and the single-open-movement rule. Keep audit and movement history append-only according to their schema protections. Do not update operational state through a presentation-only shortcut or treat a reader observation as confirmation of arrival.

SQLite is a single-instance deployment here. Store its data directory persistently. Use the supported online backup operation, or stop the service before copying the complete database directory. Reader wrapping keys must be backed up separately and kept private.

## Frontend responsibilities

- The controller owns authenticated API calls, shared state, navigation, action dispatch, busy/error handling, polling and focus management.
- `public/experience-shell.js` renders the shell, login, navigation, notifications and modal frame.
- Page modules render monitoring and operational views from server data.
- `public/experience-ui.js` and the existing UI helpers escape untrusted text and produce common controls.
- `public/experience.css` provides the reference visual system, responsive layouts and existing-form compatibility.
- Existing account, policy and reader components remain available through authorized Settings sections.

Renderers return HTML from state; they must not silently write domain records. Escape API/user values before HTML interpolation. Static SVG icon markup is trusted local source; arbitrary input must not become markup.

## Authentication and authorization

Real named accounts authenticate through the existing session API. Passwords use salted scrypt hashes; session tokens are stored as hashes and delivered in HttpOnly cookies. The server defines the six-role access matrix and must authorize every mutation and protected read. Frontend navigation is a usability aid, not an authorization boundary.

Keep origin checks, content restrictions, input limits, reader HMAC validation and encrypted reader secrets intact. Keep secrets out of source files, logs, exports, screenshots and shared artifacts.

## Validation boundaries

Use API/domain tests for authorization, persistence and state transitions; browser tests for cross-module user journeys and keyboard/responsive behavior; visual review for fidelity. Keep load checks isolated from real databases. Physical hardware, public HTTPS, Docker execution and Windows-specific launch behavior require their own evidence.

See [prd.md](prd.md) for required behavior, [design.md](design.md) for the interface, [rules.md](rules.md) for working conventions and [memory.md](memory.md) for recorded decisions.
