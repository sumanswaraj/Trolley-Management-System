# Validation evidence for 0.4.0

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
