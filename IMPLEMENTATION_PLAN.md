# Implementation plan

## Product workflow

Register trolley and label -> identify trolley -> validate load and destination -> request approval when required -> record departure -> confirm arrival -> release/return trolley. Track transit separately from arrival.

## Proposed shared-system architecture

Preserve the uploaded interface; connect it to an API and a transactional database. Use authenticated users and enforce every role and approval rule on the server. Hardware events and manual scans must use the same movement validation service.

## Delivery sequence

1. Baseline: preserve prototype, label sample data and document its limits.
2. Foundation: database migrations, user login, permissions, trolley/location/product masters, empty-plant onboarding and separate demo data.
3. Operations: movement API with transactional state changes, expected-state checks, idempotency keys and departure/arrival confirmation. Persist product, batch and quantity with each movement.
4. Controls: server-enforced approvals, no self-approval, append-only movement/audit records, deactivation instead of deleting operational history, overdue rules and backup/restore.
5. Scanning: USB scanner input first; camera QR scanning with manual fallback and duplicate-scan protection; RFID integration after reader protocol and gate locations are confirmed.
6. Reporting: calculate utilization, movement counts and turnaround from real events; remove synthetic chart data; export filtered results.
7. Pilot: test simultaneous operators, duplicate and delayed device events, interrupted connections, rejected approvals, arrival mismatches, restoration and phone layouts.

## Decisions before production integrations

- Hosting: local plant server or cloud; available plant connectivity.
- Identity: independent logins or company identity provider.
- Hardware: QR-only first or RFID readers; reader model and interface.
- Plant rules: locations, capacities, movement routes, return times and approver hierarchy.

## Completion criteria

Two users see the same persisted state; unauthorized requests are rejected by the API; retries do not create duplicate movements; departure and receipt are independently recorded; restart preserves records; audit history records actor, timestamp, previous state and resulting state; reports contain only recorded data.
