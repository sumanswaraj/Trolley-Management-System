CREATE TABLE readers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL REFERENCES locations(id),
  encrypted_secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE TABLE trolley_tags (
  tag TEXT PRIMARY KEY,
  trolley TEXT NOT NULL REFERENCES trolleys(id)
);
CREATE TABLE reader_events (
  id INTEGER PRIMARY KEY,
  reader TEXT NOT NULL REFERENCES readers(id),
  event_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  trolley TEXT REFERENCES trolleys(id),
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  location TEXT NOT NULL REFERENCES locations(id),
  payload_hash TEXT NOT NULL,
  UNIQUE(reader, event_id)
);
CREATE INDEX reader_events_received ON reader_events(received_at);
CREATE TRIGGER reader_event_no_update BEFORE UPDATE ON reader_events
BEGIN SELECT RAISE(ABORT, 'Reader observations are immutable'); END;
CREATE TRIGGER reader_event_no_delete BEFORE DELETE ON reader_events
BEGIN SELECT RAISE(ABORT, 'Reader observations cannot be deleted'); END;
