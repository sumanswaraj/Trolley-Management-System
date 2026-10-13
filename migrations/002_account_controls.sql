ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE INDEX IF NOT EXISTS movements_created ON movements(created);
CREATE INDEX IF NOT EXISTS audit_timestamp ON audit(ts);

-- Historical request details are immutable. Decisions and receipt remain mutable.
CREATE TRIGGER movement_no_delete BEFORE DELETE ON movements
BEGIN SELECT RAISE(ABORT, 'Movement history cannot be deleted'); END;
CREATE TRIGGER movement_request_immutable
BEFORE UPDATE OF trolley, source, destination, product, batch, qty, requested_by, created, expected, key, payload, version ON movements
BEGIN SELECT RAISE(ABORT, 'Movement request details are immutable'); END;
