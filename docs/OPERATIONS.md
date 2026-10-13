# Deployment, backup and recovery

## Plant pilot

Use Node.js 24+ on a managed machine or the included Docker image. Keep the data directory persistent and restricted to the application/service owner. Bootstrap a unique administrator password from .env, create named operators and a second supervisor, then stop sharing the bootstrap account.

For other computers to connect, place the service behind an HTTPS reverse proxy. Preserve the public Host header and set SECURE_COOKIE=true. A private LAN address may be bound with HOST only after network controls are configured. The supplied Compose port is local-only by default. Do not increase it to public exposure without secure transport. Proxy configuration must also bound body size, timeouts and request rates. The process-local login limiter sees the proxy address; configure a proxy-level limiter before broad deployment.

GET /api/health checks database access. HTTP logs are JSON with request IDs, paths, status and duration; errors include request IDs. They omit credentials and bodies. Configure log retention, error-rate monitoring, disk usage alarms and backup-failure alerts in your hosting environment. CI runs syntax checks and API, policy, reader, migration and browser tests.

## Consistent backup

Run:

    node scripts/backup.mjs data/trolley.sqlite /secure-backups/trolley-YYYYMMDD.sqlite

Use a new output path per backup. The script uses SQLite's online backup API; copying only the main live SQLite file is not sufficient when WAL is active. Encrypt backups, restrict access and copy them to an independent managed destination. Retention and schedules are operational configuration, not implemented automatic jobs.

## Restore drill

1. Stop the service and prevent client writes.
2. Preserve the current data directory as incident evidence.
3. Restore a verified backup into a fresh data directory with the expected filename and owner permissions. Never mix old WAL/SHM files with a restored main database.
4. Start the service; migrations are tracked and only unapplied migrations run.
5. Verify login, masters, the latest movement and audit history with a test account.
6. Revoke restored sessions: restoring an older backup can revive sessions and account access that were revoked later. Delete rows in the sessions table using a controlled maintenance procedure before reopening access; reconcile user status and movements since the backup.
7. Record restore duration and any lost events against your agreed RTO/RPO.

## Required production release checks

- SSO/MFA or verified password recovery and account lifecycle policy.
- Verify the configured role/location/product rules, device identities and actual reader protocols.
- Real-device camera compatibility, durable offline buffering, clock synchronization and duplicate RFID testing.
- External review of security controls; threat modelling and infrastructure hardening.
- PostgreSQL/HA plan if concurrency or availability requires multiple instances.
- Load/soak tests, measured limits, monitoring, alert ownership and recovery drills.
- Large-fleet pagination, reporting semantics and real operational analytics on plant data.

This release has no production-readiness certification and no claimed enterprise SLA.

## Included HTTPS proxy template

`compose.production.yaml` adds Caddy as an HTTPS reverse proxy. Set TROLLEY_DOMAIN in .env to a DNS hostname that you control and point it to the confirmed host. After reviewing that host's firewall, DNS and certificate access, run `docker compose -f compose.yaml -f compose.production.yaml up --build -d`. The app sets secure cookies, and the proxy preserves the public Host header. Reader requests and camera access use the HTTPS origin. Caddy requires access for certificate issuance/renewal. This template was created but has not been executed against a real domain. The private app port remains bound to localhost.

The floating major Node/Caddy image tags are maintained references. For a governed production release, test and pin the exact approved image digests in your deployment environment. Do not mistake this single-instance template for a high-availability architecture.
