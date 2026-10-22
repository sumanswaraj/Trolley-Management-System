# Delivery status and release plan

## Node 0.5.0 implementation

The current code connects the supplied reference design to the persistent Node application. Integrated local software acceptance is recorded in [tasks.md](tasks.md) and [docs/VALIDATION.md](docs/VALIDATION.md).

Implemented areas include:

- All fourteen reference pages and six real account roles with server-defined access metadata.
- Shared offline shell, responsive drawer/bottom navigation, global identity search, theme, clock and notifications.
- Expanded trolley, location and product records, permanent QR/RFID identity, detail views, lifecycle controls and migration 005.
- Declared movement context, receipt/direct-completed handovers, independent approval, rejection, correction and linked resubmission.
- Product verification, alert lifecycle, derived exceptions, per-account notification reads, in-app reminders and movement-based overdue return.
- Real-event reports/analytics and actual CSV, XLSX and PDF exports with filters and unpaginated downloads.
- Admin-only 128-trolley sample plant load and guarded snapshot reset that retains accounts/history.
- Preserved account administration, plant rules, reader provisioning/signatures, history/audit and backup tools.

The older 0.3/0.4 application supplied the persistent account, movement, policy and reader foundations. Their former test counts are historical and do not prove this revision's acceptance.

## Release verification

The 2026-10-22 integrated checks passed: 46 application tests, 3 separate hosted-adapter tests, 13 browser journeys and a 400-request isolated smoke with zero failures. Local offline assets, desktop/phone layouts, modal focus and preserved input were checked. Migration/restart/backup and immutable history are covered by tests. See docs/VALIDATION.md for exact scope and remaining platform limits.

The user has requested a version update and GitHub delivery. Prepare the verified source on the task branch and report the actual commit/push/download result after it succeeds. Do not equate a local change with a published branch or a hosted redeployment.

## Physical plant pilot

Confirm the plant layout, units/categories, routes, readers/protocols, tags and responsible users. Configure real accounts, rules and location scopes. Fit QR labels and bridge device observations to the signed contract. Validate actual cameras/readers, clock/retry behavior and supervised handovers with independent approvers. Keep observations separate from operational receipt.

For Windows updates, stop the old process, back up the original installation, preserve `.env`, its reader key and complete `data/`, install the new matching dependencies and apply migrations at startup. Do not ship or overwrite a user's database with a sample snapshot.

## Separate hosted adapter

`deploy/hosted-demo` remains a separate older deployment with D1 storage and managed identity/sample actors. Node 0.5 features are not automatically ported or redeployed there. A hosted parity/deployment task needs its own implementation and validation evidence.

## Infrastructure roadmap

PostgreSQL/shared sessions, paginated large-fleet APIs, managed SSO/MFA/password recovery, durable disconnected-device buffering, multi-stage approval chains and visibility scopes remain separate work. Define retention, load, availability, security and recovery targets before multi-site rollout. Public HTTPS, Docker execution, external security review, actual hardware and multi-hour soak require dedicated validation.
