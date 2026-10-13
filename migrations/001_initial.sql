CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  salt TEXT NOT NULL,
  password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  external INTEGER NOT NULL DEFAULT 0 CHECK (external IN (0, 1))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trolleys (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  capacity REAL NOT NULL CHECK (capacity > 0),
  location TEXT REFERENCES locations(id),
  status TEXT NOT NULL DEFAULT 'Available',
  product TEXT REFERENCES products(id),
  batch TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0 CHECK (qty >= 0 AND qty <= capacity),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY,
  trolley TEXT REFERENCES trolleys(id),
  source TEXT NOT NULL,
  destination TEXT REFERENCES locations(id),
  product TEXT REFERENCES products(id),
  batch TEXT NOT NULL,
  qty REAL NOT NULL CHECK (qty >= 0),
  state TEXT NOT NULL CHECK (state IN ('Pending', 'In Transit', 'Received', 'Rejected')),
  requested_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  received_by INTEGER REFERENCES users(id),
  created INTEGER NOT NULL,
  expected INTEGER NOT NULL,
  received INTEGER,
  key TEXT UNIQUE NOT NULL,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_move ON movements(trolley)
WHERE state IN ('Pending', 'In Transit');

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  actor INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  detail TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
