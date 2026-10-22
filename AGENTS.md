# Working in this repository

Read `prd.md`, `architecture.md`, `design.md`, `rules.md`, `tasks.md` and `memory.md` before changing behavior. Follow current user instructions when they supersede a document, and update the affected documents to remain consistent.

Use the existing checkout. Keep domain behavior in services, API boundaries in the HTTP layer and presentation in focused browser modules. Write clear names and only comments that explain a non-obvious invariant or reason.

Preserve account credentials, migrations, movement/audit evidence, independent approvals, idempotency, versions and physical receipt semantics. Demo actions must remain isolated, explicit and data-preserving. Keep private configuration and databases out of commits and release archives.

Run checks appropriate to the change; the normal software checks are `npm run check`, `npm run format:check`, `npm test`, `npm run test:hosted`, `npm run test:browser` and the isolated `npm run test:load`. Browser tests may use `CHROMIUM_EXECUTABLE_PATH` for an installed Chromium.

Record actual acceptance evidence and remaining limits in `docs/VALIDATION.md`, `tasks.md` and `memory.md`. Do not claim unrun checks, hardware validation, a push or a deployment. Commit/push only within the user's authorized scope, and never force-push shared history.
