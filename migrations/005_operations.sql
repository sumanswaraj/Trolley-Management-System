CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  trolley TEXT NOT NULL REFERENCES trolleys(id),
  location TEXT NOT NULL REFERENCES locations(id),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Acknowledged', 'Resolved')),
  source TEXT NOT NULL CHECK (source IN ('Manual', 'Automatic', 'Verification')),
  system_key TEXT UNIQUE,
  created INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at INTEGER,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at INTEGER,
  updated INTEGER NOT NULL,
  remarks TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX one_active_alert ON alerts(type, trolley) WHERE status <> 'Resolved';
CREATE INDEX alerts_status_priority ON alerts(status, priority, created);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  read_at INTEGER
);
CREATE INDEX notifications_user_unread ON notifications(user_id, read_at, created);

CREATE TABLE verifications (
  id INTEGER PRIMARY KEY,
  trolley TEXT NOT NULL REFERENCES trolleys(id),
  trolley_version INTEGER NOT NULL,
  input TEXT NOT NULL,
  flags TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Matched', 'Mismatch')),
  created INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE mismatch_approvals (
  id INTEGER PRIMARY KEY,
  verification INTEGER NOT NULL UNIQUE REFERENCES verifications(id),
  trolley TEXT NOT NULL REFERENCES trolleys(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  created INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Correction Required')),
  decided_by INTEGER REFERENCES users(id),
  decided_at INTEGER,
  reason TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT ''
);
CREATE INDEX mismatch_approvals_status ON mismatch_approvals(status, created);

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  trolley TEXT NOT NULL REFERENCES trolleys(id),
  movement INTEGER NOT NULL REFERENCES movements(id),
  recipient INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX reminders_trolley_created ON reminders(trolley, created);
CREATE INDEX movements_latest_received ON movements(state, trolley, COALESCE(received, created) DESC, id DESC);
CREATE INDEX reader_events_trolley_observed ON reader_events(trolley, observed_at DESC, id DESC);

CREATE TRIGGER verification_no_update BEFORE UPDATE ON verifications
BEGIN SELECT RAISE(ABORT, 'Verification history is immutable'); END;
CREATE TRIGGER verification_no_delete BEFORE DELETE ON verifications
BEGIN SELECT RAISE(ABORT, 'Verification history cannot be deleted'); END;
CREATE TRIGGER mismatch_request_immutable
BEFORE UPDATE OF verification, trolley, requested_by, created, reason ON mismatch_approvals
BEGIN SELECT RAISE(ABORT, 'Approval request details are immutable'); END;
CREATE TRIGGER mismatch_approval_no_delete BEFORE DELETE ON mismatch_approvals
BEGIN SELECT RAISE(ABORT, 'Approval history cannot be deleted'); END;
