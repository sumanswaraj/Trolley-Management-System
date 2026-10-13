# Delivery status and enterprise release plan

## Implemented in version 0.3

- Responsive UI connected to shared API state; desktop sidebar and phone navigation.
- Named users, salted password hashes, sessions, server roles, account deactivation and session revocation.
- Persistent location/product/trolley masters and an empty-plant setup workflow.
- Departure, approval/rejection and receipt with transactional history and audit writes.
- Idempotency keys, stale-version checks, duplicate/open-movement prevention and no self-approval.
- Overdue dashboard, fleet search and CSV movement export based on real database records.
- Module boundaries, versioned SQL migrations, test scripts, CI workflow, Docker/Compose and Windows launcher.
- Consistent online backup script and deployment/recovery documentation.

## Next release: plant policy and scanning

Define product categories, compatible trolley types, capacity units, allowed routes and quality release rules from the actual plant. Apply these rules in the movement service; supervisor overrides must record a reason and approved exceptions. Add camera QR scanning with USB/manual fallback. Confirm RFID reader model, protocol and gate directions before implementing a signed device-ingestion API and offline replay protection.

## Enterprise infrastructure release

Implement PostgreSQL and migration tests, paginated reads, complete period reporting, managed identity/SSO, password recovery, location-scoped roles, scalable sessions/rate limits, monitoring and disaster recovery automation. Test multi-client concurrency, load, security, migrations and backup restoration in the intended hosting environment before rollout. Preserve the frontend/service/repository boundaries while adding these capabilities.

## Decisions still needed for physical deployment

Hosting (plant server or cloud), company identity provider, reader models, plant layout, capacity units, route rules, approval hierarchy, retention and availability targets. These are not guessed or inferred from the prototype.

## Acceptance criteria

Two users see the same persisted state; unauthorized master/user/approval requests are denied by the API; movement retries do not duplicate history; stale commands return conflicts; departure and receipt are independently recorded; restart preserves records; account deactivation revokes sessions; history remains intact; reports contain recorded events only. Load, device and recovery evidence remains required for enterprise release.
