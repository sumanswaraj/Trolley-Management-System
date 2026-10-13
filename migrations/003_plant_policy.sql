ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'Unspecified';
ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'pcs';
ALTER TABLE trolleys ADD COLUMN unit TEXT NOT NULL DEFAULT 'pcs';
ALTER TABLE movements ADD COLUMN policy_flags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE movements ADD COLUMN exception_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE movements ADD COLUMN requires_quality INTEGER NOT NULL DEFAULT 0;
ALTER TABLE movements ADD COLUMN decision_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE plant_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enforce_routes INTEGER NOT NULL DEFAULT 0 CHECK (enforce_routes IN (0, 1)),
  enforce_categories INTEGER NOT NULL DEFAULT 0 CHECK (enforce_categories IN (0, 1)),
  scope_operations INTEGER NOT NULL DEFAULT 0 CHECK (scope_operations IN (0, 1))
);
INSERT INTO plant_settings(id) VALUES (1);

CREATE TABLE trolley_categories (
  trolley_type TEXT NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY(trolley_type, category)
);
CREATE TABLE allowed_routes (
  source TEXT NOT NULL REFERENCES locations(id),
  destination TEXT NOT NULL REFERENCES locations(id),
  category TEXT NOT NULL,
  requires_quality INTEGER NOT NULL DEFAULT 0 CHECK (requires_quality IN (0, 1)),
  PRIMARY KEY(source, destination, category),
  CHECK (source <> destination)
);
CREATE TABLE user_locations (
  user_id INTEGER NOT NULL REFERENCES users(id),
  location TEXT NOT NULL REFERENCES locations(id),
  can_depart INTEGER NOT NULL DEFAULT 0 CHECK (can_depart IN (0, 1)),
  can_receive INTEGER NOT NULL DEFAULT 0 CHECK (can_receive IN (0, 1)),
  PRIMARY KEY(user_id, location)
);

CREATE TRIGGER movement_policy_immutable
BEFORE UPDATE OF policy_flags, exception_reason, requires_quality ON movements
BEGIN SELECT RAISE(ABORT, 'Movement policy snapshot is immutable'); END;
