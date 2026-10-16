# Validation evidence for 0.5.0

Validated in the cloud workspace with Node.js 24.19.0 and the installed Chromium browser:

- Clean lockfile installation, JavaScript checks and formatting pass.
- The local Bash/Node launcher was tested from a clean extracted copy in a folder containing spaces: first dependency install, private configuration, admin login, record creation, restart persistence, and the separate 128-trolley demo all pass. Windows batch execution remains untested on this Linux machine.
- All 77 application/service/view/launcher tests pass, including database upgrades, persistence, roles, optimistic edits, immutable corrections, alerts, reader evidence, notifications, report filtering and safe demo resets.
- All 12 browser workflows pass: the original five plus metadata/RFID lookup, incident handling, independent mismatch approvals, all eight report previews and 16 XLSX/PDF downloads, analytics/themes/mobile navigation, overdue reminders/returns and linked correction revisions.
- XLSX downloads were reopened with ExcelJS and their actual columns and filtered row counts checked. PDF downloads contain real PDF documents.
- All three existing hosted-adapter regression tests pass. The hosted site was not redeployed.
- The isolated 400-request shared-state smoke with 20 concurrent clients and 50 trolleys completed with zero failures: 1,977 ms total, 202 requests/second and p95 150 ms in this run. This is a small local read test, not a production capacity estimate.
- Automatic alert state uses a bounded number of reads as fleet/alert counts increase. Dashboard trolley metadata is batched rather than queried once per trolley.
- Production dependency audit reports zero known vulnerabilities after pinning ExcelJS's UUID dependency to the compatible patched 11.1.1 release. This does not replace a security review.
- The persistent application passed startup, health, login, state, report, analytics and audit checks. The separate sample application preserved its 128 trolleys, 11 locations, 10 products and six accounts across restart.
- Desktop and mobile screens were visually inspected; mobile location-card spacing was corrected. Browser checks confirm no page-wide horizontal overflow in the movement/fleet and mobile location workflows.

Physical cameras/RFID readers, vendor-specific drivers, Docker execution, public HTTPS deployment, extended soak and production capacity remain outside these local checks. Generated QR camera tests use a real encoded image delivered through an emulated video stream.

## Previous release: 0.4.0

Validated with Node.js 24.19.0 in the development workspace:

- JavaScript syntax checks pass.
- 21 backend/frontend-rendering tests pass, covering authentication, authorization, simultaneous receipt, capacity units, route/category policies, independent exception approval, quality release, location restrictions, idempotency, histories and real-event reports.
- Migration tests preserve version 0.3 account/master/load records while applying new migrations.
- A consistent SQLite online backup was restored and verified.
- Reader tests verify HMAC authentication, encrypted secrets, duplicate-event handling, stale timestamps, unknown tags, credential rotation and revocation. Observations leave operational location unchanged.
- Five browser workflows pass with Chromium 153: desktop (1440px) and phone (390px) movement/receipt, generated QR decoding through a simulated camera stream, permission-denial fallback, and administrator policy/reader provisioning.
- Screenshots of desktop and phone fleet views were visually inspected. Phone fleet cards expose all trolley details without page-wide horizontal overflow.
- A local read-only load smoke completed 400 shared-state requests with 20 concurrent clients and 50 trolleys: zero failures, 478 ms elapsed, p50 19 ms and p95 38 ms in this run. This is a small isolated smoke test, not a production capacity or SLA claim.
- npm audit --omit=dev reported zero known production dependency vulnerabilities at the time of the check. This does not replace a security review.

Physical cameras/readers, actual reader protocols, Docker image execution, public HTTPS hosting, multi-hour soak, browser/device coverage beyond the tested Chromium setup, external penetration testing and HA/disaster-recovery infrastructure have not been validated. Deployment and enterprise certification are not implied by passing local tests.

## Connected private demo

The hosted build and three D1-adapter transaction tests pass. The private demo was deployed with its database binding connected. Two live empty-trolley movements for TR-024 were recorded and received, read back through fresh API requests, and independently confirmed in the hosted movements table. The trolley was restored to QUALITY; these verification events remain in history. The demo uses managed ChatGPT identity and sample role actors; physical reader provisioning and real account administration are available in the full Node installation. Hosted visual QA was not performed because the required managed browser integration was unavailable; the shared local frontend had the five browser workflows described above.
