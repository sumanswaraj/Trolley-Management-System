ALTER TABLE locations ADD COLUMN group_name TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE locations ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE locations ADD COLUMN bay_capacity INTEGER NOT NULL DEFAULT 20 CHECK (bay_capacity > 0);
ALTER TABLE locations ADD COLUMN expected_minutes INTEGER NOT NULL DEFAULT 120 CHECK (expected_minutes > 0);
ALTER TABLE locations ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
ALTER TABLE locations ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE products ADD COLUMN default_batch TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE trolleys ADD COLUMN material_type TEXT NOT NULL DEFAULT 'Unspecified';
ALTER TABLE trolleys ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE trolleys ADD COLUMN assigned_area TEXT REFERENCES locations(id);
ALTER TABLE trolleys ADD COLUMN qr_value TEXT NOT NULL DEFAULT '';
ALTER TABLE trolleys ADD COLUMN rfid TEXT NOT NULL DEFAULT '';
ALTER TABLE trolleys ADD COLUMN tag_condition TEXT NOT NULL DEFAULT 'Good' CHECK (tag_condition IN ('Good', 'Damaged', 'Unreadable', 'Missing'));
ALTER TABLE trolleys ADD COLUMN created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trolleys ADD COLUMN updated INTEGER NOT NULL DEFAULT 0;
UPDATE trolleys SET assigned_area = location, qr_value = id, created = CAST(strftime('%s', 'now') AS INTEGER) * 1000, updated = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
UPDATE locations SET group_name = 'Outside Plant' WHERE external = 1;
CREATE UNIQUE INDEX unique_trolley_qr ON trolleys(qr_value COLLATE NOCASE) WHERE qr_value <> '';
CREATE UNIQUE INDEX unique_trolley_rfid ON trolleys(rfid COLLATE NOCASE) WHERE rfid <> '';

CREATE TABLE product_locations (
  product TEXT NOT NULL REFERENCES products(id),
  location TEXT NOT NULL REFERENCES locations(id),
  PRIMARY KEY (product, location)
);

ALTER TABLE plant_settings ADD COLUMN outside_approval INTEGER NOT NULL DEFAULT 1 CHECK (outside_approval IN (0, 1));
ALTER TABLE plant_settings ADD COLUMN mismatch_approval INTEGER NOT NULL DEFAULT 1 CHECK (mismatch_approval IN (0, 1));
ALTER TABLE movements ADD COLUMN movement_type TEXT NOT NULL DEFAULT 'Transfer';
ALTER TABLE movements ADD COLUMN remarks TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN reason TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN operator_name TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN occurred_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE movements ADD COLUMN status_after TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE movements ADD COLUMN in_transit INTEGER NOT NULL DEFAULT 1 CHECK (in_transit IN (0, 1));
ALTER TABLE movements ADD COLUMN revision_of INTEGER REFERENCES movements(id);
ALTER TABLE movements ADD COLUMN decided_at INTEGER;
CREATE INDEX movements_trolley_state ON movements(trolley, state, received DESC, id DESC);
UPDATE movements SET operator_name = COALESCE((SELECT name FROM users WHERE users.id = movements.requested_by), ''), occurred_at = created;
CREATE TRIGGER movement_metadata_immutable
BEFORE UPDATE OF movement_type, remarks, department, reason, operator_name, occurred_at, status_after, in_transit, revision_of ON movements
BEGIN SELECT RAISE(ABORT, 'Movement request metadata is immutable'); END;

CREATE TABLE correction_requests (
  movement INTEGER PRIMARY KEY REFERENCES movements(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TRIGGER correction_no_update BEFORE UPDATE ON correction_requests
BEGIN SELECT RAISE(ABORT, 'Correction requests are immutable'); END;
CREATE TRIGGER correction_no_delete BEFORE DELETE ON correction_requests
BEGIN SELECT RAISE(ABORT, 'Correction requests cannot be deleted'); END;
