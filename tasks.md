# Implementation and acceptance tasks

Status: Node 0.5.0 software implementation and local acceptance are complete. GitHub delivery is recorded separately after a successful push.

## Requirements and structure

- [x] Confirm the fourteen reference pages and six-role access matrix against the integrated interface.
- [x] Keep PRD, design, architecture, task status and project memory consistent.
- [x] Preserve existing user, policy, reader, backup and audit capabilities.

## Data and backend

- [x] Validate master-data additions and migration of an existing database.
- [x] Validate trolley identity, detail, maintenance and lifecycle actions.
- [x] Validate movement declaration, independent approvals, correction and receipt behavior.
- [x] Validate role/page restrictions and action authorization for every role.
- [x] Validate alerts, notifications, report/export and analytics data from stored records.
- [x] Check transactional, idempotency, version, unit/capacity and audit invariants after expansion.

## Interface

- [x] Integrate the prototype shell, fourteen pages and real account identity.
- [x] Connect shared search, notifications, clock, sign-out, theme and navigation.
- [x] Connect trolley/master forms, QR/RFID identification and movement actions.
- [x] Connect filters, pagination, history/detail dialogs, exports and settings tabs.
- [x] Verify honest empty/loading/error and unsupported-hardware states.
- [x] Verify desktop, phone, drawer, bottom navigation and contained table scrolling.
- [x] Verify keyboard navigation, Escape/close, focus restoration, labels and reduced motion.

## Verification and delivery

- [x] Run syntax and formatting checks appropriate to the changed files.
- [x] Run relevant existing and new automated API/domain checks.
- [x] Run browser journeys across roles and core operational actions.
- [x] Inspect representative desktop and phone screenshots against the supplied reference.
- [x] Run local operation with external requests blocked and verify local QR/export assets.
- [x] Check persistence and restart without losing existing records or credentials.
- [x] Review final diff/status for unintended changes and sensitive/generated files.
- [x] Record actual results and outstanding limits in project memory and delivery notes.
- [x] Perform commit/push or publication only if authorized by the current task.

## Evidence log

Validation on 2026-10-22: 46 application tests, 3 hosted-adapter tests and 13 browser tests passed; the isolated 400-request smoke had zero failures. Syntax, Prettier and whitespace checks passed. Offline browser routing, desktop/phone screenshots and keyboard modal focus were checked. See docs/VALIDATION.md for scope and platform limits.

Delivery: the user authorized commit/push. Remote publication is recorded only after the actual push and remote-reference verification succeed.
