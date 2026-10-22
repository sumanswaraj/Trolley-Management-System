# Smart Trolley product requirements

Status: the Node 0.5.0 reference-interface and workflow expansion has passed the local software acceptance checks recorded in docs/VALIDATION.md. Physical hardware and separate deployment boundaries remain as described below.

## Goal

Give plant teams one shared, authenticated view of every trolley, its load, location, movement, handover and exceptions. Reproduce the supplied prototype's information architecture and visual language while connecting its controls to the persistent application.

## Users and access

Support six real account roles: Admin, Plant Manager, Supervisor, Operator, Quality User and Store User. Use the reference page access matrix. Restrict actions on the server as well as in the interface. Show the actual signed-in person's identity; changing a visible role must never impersonate another user.

## Workspace

Keep the reference navigation and order: Dashboard, Trolley Master, Scan Trolley, Live Tracking, Overdue Trolleys, Movement, Locations, Movement History, Products & Materials, Alerts, Approvals, Reports, Analytics and Settings. Filter navigation by role. Keep account administration, reader provisioning, plant policies and audit access reachable from Settings where authorized.

Use shared header search, notifications, current date/time, identity, sign-out and appearance controls. Provide desktop navigation, a mobile drawer and mobile quick navigation.

## Operational behavior

- Register and maintain trolley, product and location master data without rewriting movement history.
- Identify a trolley using its ID, QR or RFID value. Camera scans fill identification; they do not submit a movement automatically.
- Declare source, destination, product, batch, quantity, expected return and movement context with appropriate validation.
- Preserve capacity/unit checks, policy enforcement, independent approvals, idempotency, version conflicts and one open movement per trolley.
- Update the operational location only when arrival is confirmed through the movement workflow.
- Show fleet, location, overdue, alert, approval, report and analytics views derived from actual stored records. Empty installations must show honest empty states.
- Preserve signed reader observations, tag mapping, credential rotation/revocation and the distinction between observations and confirmed physical handovers.
- Export actual records in the supported formats without requiring external browser libraries.

## Functional catalogue

| Page                 | Required behavior                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard            | Ten clickable fleet/location KPIs, plant movement flow, current occupancy, recent trolley updates, urgent exceptions and links into tracking.                                                                                                                        |
| Trolley Master       | Search ID/QR/RFID, filter type/status/department, paginate, register/edit, activate/deactivate, inspect details and download a permanent QR label. Preserve IDs and history; reject unsafe deactivation or stale edits.                                              |
| Scan Trolley         | Manual ID, QR or RFID lookup, real camera scanning, unknown-code feedback, recent scans, current context and actions to move, receive, inspect or report an issue.                                                                                                   |
| Live Tracking        | Card/table views, full fleet search and status/location/group/type filters; show load, batch, previous location, responsible person, last movement, tag health and warnings.                                                                                         |
| Overdue Trolleys     | Monitor held loads and in-transit deadlines, show duration/delay/responsibility, due-soon records, escalation priority, in-app reminders and confirmed returns through the movement service.                                                                         |
| Movement             | Ten business movement types; source/destination, product/batch/quantity, operator, department, physical event time, expected return, reason, remarks and arrival status. Validate before recording; support transit/receipt or explicit already-completed handovers. |
| Locations            | Clickable plant layout, bays/capacity, occupancy colors, trolley status dots, material quantities and selected-location details.                                                                                                                                     |
| Movement History     | Complete paged records with search, date, trolley, location, operator, product, movement type and status filters; export all matching rows as CSV, XLSX or PDF.                                                                                                      |
| Products & Materials | Product/category/unit/batch summaries, load assignments and segregation warnings; verify scanned product/batch against a trolley and submit mismatches for independent review.                                                                                       |
| Alerts               | Priorities, type/status filters, acknowledgement, recorded resolution, recurrence/reopening and links to the affected trolley. Retain who acted and when.                                                                                                            |
| Approvals            | Pending requests and decision history; independent approve/reject/correction, recorded reasons, linked corrected resubmission and immutable original evidence.                                                                                                       |
| Reports              | Daily movement, utilization, location, product, overdue, trolley history, outside plant and movement exceptions. Preview a bounded page; download the complete filtered result in genuine CSV/XLSX/PDF formats.                                                      |
| Analytics            | Fleet utilization, movements by location, daily trend, top usage, completed issue/return turnaround, daily/weekly overdue history and current location distribution. Use recorded facts and explain unavailable historical reconstruction.                           |
| Settings             | Approval rules, theme preference, role/access information, named-user administration, plant policies, reader/tag administration, searchable audit and guarded sample load/reset.                                                                                     |

Trolley records include identity, QR/RFID, type, capacity/unit, material, department, assigned area, status, current/previous location, load/batch, responsible operator, creation/movement/dwell/deadline times, tag health, maintenance due date and usage count. Locations include group, department, trolley bays and expected stay. Products include category, quantity unit, default batch and permitted location groups.

The ten movement types are Transfer, Production Issue, Production Return, Quality Inspection, Quality Release, Packing, Dispatch, Store Transfer, Maintenance and Outside Plant. Visible fleet states include Available, In Use, In Transit, Waiting, Maintenance, Overdue, Outside Plant and Inactive. Overdue is derived from recorded deadlines; it does not overwrite the underlying lifecycle state.

## Access and workflow invariants

- Admin manages master records, accounts, configuration and demo fixtures.
- Plant Manager monitors operations and authorized reports/approvals, without recording movements or editing masters.
- Supervisor performs operational movements, verification, alerts and authorized approvals; master records remain read-only.
- Operator identifies trolleys and records authorized movements.
- Quality User uses quality movement types and verification; Store User uses store/issue/return movement types. Both retain appropriate shared visibility.
- A requester cannot approve their own pending request. Configured quality gates still apply when ordinary outside/mismatch settings change.
- Correction creates a linked new request rather than overwriting the old request or decision. A stale scan verification cannot authorize a changed trolley.
- Reminders are persistent in-app notifications, with read state per recipient. Email/SMS delivery is not implied.
- Demo loading requires an empty installation. Reset requires explicit confirmation, rejects open sample operations and preserves users, unrelated records, immutable history and reader evidence.

## Acceptance

- [x] Each authorized page is reachable and displays real API data.
- [x] Every visible action is implemented or clearly explains its prerequisite.
- [x] Six-role page and action restrictions are enforced by the API.
- [x] Movement, approval, correction/receipt and trace workflows preserve the existing integrity guarantees.
- [x] Notifications, search, filters, pagination, dialogs, theme and sign-out function with keyboard and touch input.
- [x] Desktop and phone layouts match the reference structure without page-wide horizontal overflow.
- [x] Local operation and required assets work without a CDN or an Internet connection after installation.
- [x] Existing databases migrate without losing accounts, masters, movements, audit or reader history.
- [x] Relevant automated checks, browser workflows and visual review pass; results and limitations are recorded.

## Boundaries

A self-contained local server is required for shared data and authentication. Durable disconnected-device synchronization, physical RFID drivers, multi-instance database hosting and enterprise identity infrastructure are separate capabilities unless explicitly added to an approved task.
