# Delivery status and enterprise release plan

## Implemented in 0.3

Shared frontend/API, users and sessions, master data, departure/approval/receipt, transactional audit/history, version checks, idempotency, deployment packages and backup tools.

## Implemented in 0.4

- Configurable category/type compatibility, allowed routes, quality releases and capacity units.
- Independent policy exception approvals with immutable flags and recorded reasons.
- Source/destination mutation permissions by user and location.
- Complete paged histories and CSV export; real-event reporting; restricted audit visibility.
- Camera QR scan with native/local decoder, physical receipt confirmation and QR label generation.
- Signed reader event API, encrypted per-reader keys, mapping, rotation/revocation and observation deduplication.
- Desktop/phone browser tests, real QR decoding with a simulated stream, migration preservation and isolated load smoke.
- Formatting tooling and updated deployment/device/policy documentation.

## Next: physical plant pilot

Confirm hosting, plant layout, categories, units, routes, reader model/protocol, tag format and antenna direction. Configure identities, rules and location rights. Fit labels and bridge the reader protocol to the signed observation contract. Run actual camera/reader tests, clock/offline/retry scenarios and supervised departures/receipts with two or more users. Keep observations separate from confirmed movements until the physical evidence is validated.

## Enterprise infrastructure release

Implement PostgreSQL and migration tests, managed SSO/MFA/password recovery, scalable sessions/rate limits, durable device buffering, paginated large-fleet APIs, monitoring and disaster recovery automation. Define availability, retention and load targets, then conduct multi-hour load/soak, external security review and recovery exercises. Complete multi-stage approvals and data visibility scopes if required by the plant. Deploy only into confirmed hosting with HTTPS and operational ownership.

## Acceptance evidence

See docs/VALIDATION.md. Local tests verify shared persisted state, server-side permissions, independent approvals, consistent versions, deduplication, receipt, account revocation, reader signatures and preserved histories. Physical device behavior, multi-instance scaling, infrastructure security and availability remain release gates.
