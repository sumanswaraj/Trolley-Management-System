# Prototype feature map

The supplied HTML is the design and behavior reference for version 0.5.0. Operational records live in SQLite, with authenticated server mutations and version checks. The original browser-only prototype remains archived in `public/prototype.html` and is not served.

| Workflow         | Implementation                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace        | Named accounts, six roles, mobile drawer and bottom navigation, global ID/QR/RFID lookup, clock, notices and per-user notifications                                                 |
| Dashboard        | Ten clickable fleet and department indicators, plant occupancy and recorded 24-hour flow, questions, pending approvals, active alerts and latest trolley activity                   |
| Trolley master   | Permanent ID and QR identity, RFID, type, capacity/unit, material, department, assigned area, tag health, timestamps, search/filter/paging, edit, activate/deactivate and QR labels |
| Trolley detail   | Current load, deadline, dwell, operator, tag health, open alerts, retained movement trail, audit, label download, movement and issue actions                                        |
| Scan             | Camera QR decoding, manual or USB input, registered RFID aliases, current assignment, failed lookup feedback, session scan history and physical receipt                             |
| Live tracking    | Cards/table switch, status/location/type/group/department filters, search, paging, previous/current/destination, product/batch and responsible operator                             |
| Overdue          | Active movement deadline or received holding deadline, delay escalation, due-soon view, rate-limited in-app reminders and prefilled empty return                                    |
| Movement         | Ten movement types, current-load autofill, destination defaults, authenticated operator, department, date/time, reason, remarks, expected time, arrival status and policy preview   |
| Physical receipt | In-transit departures retain their source location until receipt; an explicit completed-arrival option records both actions together                                                |
| Locations        | Location groups, bay capacity, occupancy, material totals separated by unit, status badges and fleet drilldown                                                                      |
| History          | Full paged records with date, trolley, location, operator, product, type, state and free-text filters; matching CSV, Excel and PDF downloads                                        |
| Products         | Batch-specific assignment totals, material/location warnings, server-side scan verification and independent exception review                                                        |
| Alerts           | Persisted incidents and automatic conditions, priority escalation, deduplication, acknowledgment, resolution, actor/time and in-app notifications                                   |
| Approvals        | Independent route/quality/exception and product-verification decisions, rejection/correction remarks, decision history and linked movement revisions                                |
| Reports          | Daily movement, utilization, location, product, overdue, full history, outside plant and exception reports, previewed and exported as real XLSX/PDF files                           |
| Analytics        | Fleet utilization, arrivals, daily movements, frequent trolleys, completed return-cycle duration, daily/weekly overdue and location distribution, with accessible data tables       |
| Settings         | Persistent outside/mismatch approval rules, device-local auto/light/dark theme, role capabilities and searchable immutable audit history                                            |
| Demo             | Separate sample database, 128 trolleys, 11 plant locations, 10 products and authenticated sample accounts; reset preserves a demo database backup                                   |

## Operational semantics

The signed-in user owns movement and decision identity; entering another operator name cannot impersonate them. An approver cannot approve their own request. Rejected and corrected requests remain in history, and revised movements link to the original. A deactivation never removes identity or history, and a loaded trolley or open movement prevents unsafe deactivation.

An open movement's `expected` time takes precedence. After arrival, In Use, Waiting, Maintenance and Outside Plant trolleys have a holding deadline based on actual receipt plus the location's configured expected minutes. Empty available trolleys have no deadline. Initial legacy holding records fall back to their recorded creation time; reminders require a recorded responsible user. Reminders are internal notifications, not email or SMS.

Chart buckets use UTC. Current fleet indicators show current state. Arrival and flow indicators cover the last 24 hours. Trend filters cover the selected dates. Return-cycle duration uses recorded issue and return receipts; it is different from request-to-receipt duration. Historical overdue reconstruction uses recorded lifecycle events and current location holding limits. Empty charts show no observed activity; they do not invent historical measurements.

Camera frames stay on the device. Signed reader ingestion records observations without moving the trolley. Physical RFID/camera hardware, provider-specific reader drivers and production hosting require the corresponding equipment or deployment configuration. The previously hosted adapter remains a separate deployment; these local changes do not publish it.
