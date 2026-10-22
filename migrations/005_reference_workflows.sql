ALTER TABLE locations ADD COLUMN group_name TEXT NOT NULL DEFAULT 'Store';
ALTER TABLE locations ADD COLUMN capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0);
ALTER TABLE locations ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE locations ADD COLUMN expected_minutes INTEGER NOT NULL DEFAULT 240 CHECK (expected_minutes > 0);
ALTER TABLE products ADD COLUMN default_batch TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN allowed_groups TEXT NOT NULL DEFAULT '[]';
ALTER TABLE trolleys ADD COLUMN material_type TEXT NOT NULL DEFAULT '';
ALTER TABLE trolleys ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE trolleys ADD COLUMN assigned_area TEXT NOT NULL DEFAULT '';
ALTER TABLE trolleys ADD COLUMN qr TEXT;
ALTER TABLE trolleys ADD COLUMN rfid TEXT;
ALTER TABLE trolleys ADD COLUMN created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trolleys ADD COLUMN last_moved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trolleys ADD COLUMN since INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trolleys ADD COLUMN expected INTEGER;
ALTER TABLE trolleys ADD COLUMN previous_location TEXT NOT NULL DEFAULT '';
ALTER TABLE trolleys ADD COLUMN operator_id INTEGER REFERENCES users(id);
ALTER TABLE trolleys ADD COLUMN tag_health TEXT NOT NULL DEFAULT 'Good';
ALTER TABLE trolleys ADD COLUMN maintenance_due INTEGER;
ALTER TABLE trolleys ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trolleys ADD COLUMN flags TEXT NOT NULL DEFAULT '[]';
UPDATE trolleys SET qr = id,
  created = COALESCE((SELECT MIN(created) FROM movements WHERE trolley = trolleys.id), CAST(strftime('%s','now') AS INTEGER) * 1000),
  last_moved = COALESCE((SELECT MAX(COALESCE(received,created)) FROM movements WHERE trolley = trolleys.id), CAST(strftime('%s','now') AS INTEGER) * 1000),
  since = COALESCE((SELECT MAX(received) FROM movements WHERE trolley = trolleys.id AND state = 'Received'), CAST(strftime('%s','now') AS INTEGER) * 1000),
  expected = (SELECT expected FROM movements WHERE trolley = trolleys.id ORDER BY id DESC LIMIT 1),
  uses = (SELECT COUNT(*) FROM movements WHERE trolley = trolleys.id AND state = 'Received');
CREATE UNIQUE INDEX trolley_qr_unique ON trolleys(qr) WHERE qr IS NOT NULL AND qr <> '';
CREATE UNIQUE INDEX trolley_rfid_unique ON trolleys(rfid) WHERE rfid IS NOT NULL AND rfid <> '';
ALTER TABLE movements ADD COLUMN movement_type TEXT NOT NULL DEFAULT 'Transfer';
ALTER TABLE movements ADD COLUMN operator_id INTEGER REFERENCES users(id);
ALTER TABLE movements ADD COLUMN department TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN occurred INTEGER;
ALTER TABLE movements ADD COLUMN reason TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN remarks TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN status_after TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN direct_complete INTEGER NOT NULL DEFAULT 0 CHECK (direct_complete IN (0,1));
ALTER TABLE movements ADD COLUMN decided_at INTEGER;
ALTER TABLE movements ADD COLUMN correction_reason TEXT NOT NULL DEFAULT '';
DROP TRIGGER movement_request_immutable;
CREATE TRIGGER movement_request_immutable
BEFORE UPDATE OF trolley,source,destination,product,batch,qty,requested_by,created,expected,key,payload,version,movement_type,operator_id,department,occurred,reason,remarks,status_after,direct_complete ON movements
BEGIN SELECT RAISE(ABORT, 'Movement request details are immutable'); END;
ALTER TABLE plant_settings ADD COLUMN outside_approval INTEGER NOT NULL DEFAULT 1 CHECK (outside_approval IN (0,1));
ALTER TABLE plant_settings ADD COLUMN mismatch_approval INTEGER NOT NULL DEFAULT 1 CHECK (mismatch_approval IN (0,1));
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  trolley TEXT NOT NULL REFERENCES trolleys(id),
  location TEXT NOT NULL,
  type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('Critical','High','Medium','Low')),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Acknowledged','Resolved')),
  message TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at INTEGER,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at INTEGER,
  fingerprint TEXT UNIQUE,
  source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX alerts_status_priority ON alerts(status,priority,created);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  text TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  created INTEGER NOT NULL
);
CREATE TABLE notification_reads (
  notification_id INTEGER NOT NULL REFERENCES notifications(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  read_at INTEGER NOT NULL,
  PRIMARY KEY(notification_id,user_id)
);
CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY,
  movement_id INTEGER UNIQUE REFERENCES movements(id),
  kind TEXT NOT NULL DEFAULT 'Movement',
  trolley TEXT NOT NULL REFERENCES trolleys(id),
  product TEXT REFERENCES products(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id),
  created INTEGER NOT NULL,
  decided_at INTEGER,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Correction Requested')),
  remarks TEXT NOT NULL DEFAULT '',
  decision_reason TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX approvals_status_created ON approval_requests(status,created);
INSERT INTO approval_requests(movement_id,trolley,product,requested_by,decided_by,created,decided_at,status,decision_reason,payload)
SELECT id,trolley,product,requested_by,approved_by,created,NULL,
  CASE WHEN state = 'Pending' THEN 'Pending' WHEN state = 'Rejected' THEN 'Rejected' ELSE 'Approved' END,
  decision_reason,payload FROM movements WHERE state = 'Pending' OR approved_by IS NOT NULL;
CREATE TABLE scan_verifications (
  id INTEGER PRIMARY KEY,
  trolley TEXT NOT NULL REFERENCES trolleys(id),
  product TEXT REFERENCES products(id),
  batch TEXT NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id),
  created INTEGER NOT NULL,
  trolley_version INTEGER NOT NULL DEFAULT 1,
  ok INTEGER NOT NULL CHECK (ok IN (0,1)),
  issues TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX verifications_trolley_created ON scan_verifications(trolley,created);
CREATE TRIGGER approval_request_no_delete BEFORE DELETE ON approval_requests
BEGIN SELECT RAISE(ABORT, 'Approval history cannot be deleted'); END;
CREATE TRIGGER approval_request_immutable
BEFORE UPDATE OF movement_id,kind,trolley,product,requested_by,created,remarks,payload ON approval_requests
BEGIN SELECT RAISE(ABORT, 'Approval request details are immutable'); END;
CREATE TRIGGER scan_verification_no_update BEFORE UPDATE ON scan_verifications
BEGIN SELECT RAISE(ABORT, 'Scan verifications are immutable'); END;
CREATE TRIGGER scan_verification_no_delete BEFORE DELETE ON scan_verifications
BEGIN SELECT RAISE(ABORT, 'Scan verifications cannot be deleted'); END;
