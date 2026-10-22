import { fail } from '../errors.mjs';
import { requiredText, finiteNumber, integer } from '../validation.mjs';
import { requireRole, MANAGER_ROLES, accessFor } from '../security.mjs';

const kinds = new Set(['locations', 'products', 'trolleys']);
const movableStates = new Set(['In Use', 'Waiting', 'In Transit', 'Outside Plant']);

function text(value, label, maximum = 120) {
  if (value === undefined || value === null || value === '') return '';
  return requiredText(value, label, maximum);
}

function jsonArray(value, label) {
  if (!Array.isArray(value) || value.length > 50) fail(400, `Invalid ${label}`);
  return [...new Set(value.map((entry) => requiredText(entry, label)))];
}

function decodeArray(value) {
  if (Array.isArray(value)) return [...value];
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function locationFields(input) {
  if (![undefined, true, false, 0, 1].includes(input.external))
    fail(400, 'Invalid outside plant flag');
  return {
    name: requiredText(input.name, 'name'),
    external: Number(Boolean(input.external)),
    group_name: requiredText(
      input.group_name || (input.external ? 'Outside Plant' : 'Store'),
      'location group',
    ),
    capacity: integer(input.capacity ?? 0, 'location capacity', 0),
    department: text(input.department, 'department'),
    expected_minutes: integer(input.expected_minutes ?? 240, 'expected return minutes', 1),
  };
}

function productFields(input) {
  return {
    name: requiredText(input.name, 'name'),
    category: requiredText(input.category || 'Unspecified', 'category'),
    unit: requiredText(input.unit || 'pcs', 'unit', 20),
    default_batch: text(input.default_batch, 'default batch'),
    allowed_groups: JSON.stringify(
      jsonArray(input.allowed_groups ?? [], 'allowed location groups'),
    ),
  };
}

export function effectiveTrolley(trolley, now = Date.now()) {
  return {
    ...trolley,
    flags: decodeArray(trolley.flags),
    effective_status: !trolley.active
      ? 'Inactive'
      : movableStates.has(trolley.status) && trolley.expected && trolley.expected < now
        ? 'Overdue'
        : trolley.status,
  };
}

export function masterService(repository) {
  const record = (kind, id) => {
    if (!kinds.has(kind)) fail(404, 'Unknown master type');
    const result = repository.get(`SELECT * FROM ${kind} WHERE id = ?`, requiredText(id, 'ID', 40));
    if (!result) fail(404, 'Master record not found');
    return result;
  };
  const location = (id) => {
    const found = repository.get(
      'SELECT * FROM locations WHERE id = ?',
      requiredText(id, 'location'),
    );
    if (!found) fail(400, 'Unknown location');
    return found;
  };
  const openMovement = (id) =>
    repository.get(
      "SELECT id FROM movements WHERE trolley = ? AND state IN ('Pending', 'In Transit', 'Correction Requested')",
      id,
    );
  const identityAvailable = (trolleyId, value) => {
    if (!value) return;
    const duplicate = repository.get(
      'SELECT id FROM trolleys WHERE id <> ? AND (id = ? COLLATE NOCASE OR qr = ? COLLATE NOCASE OR rfid = ? COLLATE NOCASE)',
      trolleyId,
      value,
      value,
      value,
    );
    const tag = repository.get(
      'SELECT trolley FROM trolley_tags WHERE tag = ? COLLATE NOCASE',
      value,
    );
    if (duplicate || (tag && tag.trolley !== trolleyId))
      fail(409, 'This identity is already assigned to another trolley');
  };
  const bindTag = (trolleyId, tag) => {
    if (tag)
      repository.run(
        'INSERT INTO trolley_tags(tag, trolley) VALUES (?, ?) ON CONFLICT(tag) DO NOTHING',
        tag,
        trolleyId,
      );
  };
  const trolleyFields = (input, currentLocation) => {
    const assignedArea = text(input.assigned_area ?? currentLocation.id, 'assigned area', 40);
    if (assignedArea) location(assignedArea);
    return {
      type: requiredText(input.type, 'type'),
      capacity: finiteNumber(input.capacity, 'capacity', 1),
      unit: requiredText(input.unit || 'pcs', 'unit', 20),
      material_type: text(input.material_type, 'material type'),
      department: text(input.department ?? currentLocation.department, 'department'),
      assigned_area: assignedArea,
      rfid: text(input.rfid, 'RFID', 128) || null,
      tag_health: text(input.tag_health ?? 'Good', 'tag health', 80),
      maintenance_due:
        input.maintenance_due === null ||
        input.maintenance_due === undefined ||
        input.maintenance_due === ''
          ? null
          : integer(input.maintenance_due, 'maintenance due date'),
    };
  };
  const updateFields = (table, id, values, extra = '') => {
    repository.run(
      `UPDATE ${table} SET ${Object.keys(values)
        .map((key) => `${key} = ?`)
        .join(', ')}${extra} WHERE id = ?`,
      ...Object.values(values),
      id,
    );
  };
  const trolleyWithNames = (id) =>
    repository.get(
      `SELECT t.*, u.name AS operator_name FROM trolleys t
    LEFT JOIN users u ON t.operator_id = u.id WHERE t.id = ?`,
      id,
    );
  const movementSelect = `SELECT m.*, u.name AS requester, a.name AS approver, r.name AS receiver
    FROM movements m JOIN users u ON m.requested_by = u.id
    LEFT JOIN users a ON m.approved_by = a.id LEFT JOIN users r ON m.received_by = r.id`;

  return {
    create(user, kind, input) {
      requireRole(user, ['Admin']);
      if (!kinds.has(kind)) fail(404, 'Unknown master type');
      const id = requiredText(input.id, 'ID', 40);
      return repository.transaction(() => {
        if (kind === 'locations' || kind === 'products') {
          const values = kind === 'locations' ? locationFields(input) : productFields(input);
          repository.run(
            `INSERT INTO ${kind}(id, ${Object.keys(values).join(', ')}) VALUES (${Array(
              Object.keys(values).length + 1,
            )
              .fill('?')
              .join(', ')})`,
            id,
            ...Object.values(values),
          );
        } else {
          const startLocation = location(input.location);
          for (const key of ['status', 'product', 'batch', 'qty', 'expected', 'active']) {
            if (Object.hasOwn(input, key))
              fail(
                400,
                'Register an empty available trolley; use the movement workflow to assign a load or status',
              );
          }
          const values = trolleyFields(input, startLocation);
          const qr = text(input.qr ?? `QR-${id}`, 'QR value', 128);
          if (!qr) fail(400, 'A QR value is required');
          for (const value of [id, qr, values.rfid]) identityAvailable(id, value);
          const now = Date.now();
          repository.run(
            `INSERT INTO trolleys(id, ${Object.keys(values).join(', ')}, location, qr, created, last_moved, since, previous_location, operator_id)
            VALUES (${Array(Object.keys(values).length + 8)
              .fill('?')
              .join(', ')})`,
            id,
            ...Object.values(values),
            startLocation.id,
            qr,
            now,
            now,
            now,
            startLocation.id,
            user.id,
          );
          bindTag(id, qr);
          bindTag(id, values.rfid);
        }
        repository.audit(user, 'Master created', id, { kind });
        const created = record(kind, id);
        return kind === 'trolleys' ? effectiveTrolley(created) : created;
      });
    },
    update(user, kind, id, input) {
      requireRole(user, ['Admin']);
      return repository.transaction(() => {
        const previous = record(kind, id);
        if (
          (input.id !== undefined && input.id !== previous.id) ||
          (input.qr !== undefined && input.qr !== previous.qr)
        )
          fail(400, 'Trolley and master IDs and QR identities are permanent');
        let values;
        if (kind === 'locations') {
          values = locationFields({ ...previous, ...input });
          if (
            (values.external !== previous.external || values.group_name !== previous.group_name) &&
            repository.get(
              "SELECT id FROM movements WHERE (source = ? OR destination = ?) AND state IN ('Pending', 'In Transit', 'Correction Requested')",
              id,
              id,
            )
          )
            fail(
              409,
              'Finish open movements before changing this location group or outside status',
            );
        } else if (kind === 'products') {
          values = productFields({
            ...previous,
            allowed_groups: decodeArray(previous.allowed_groups),
            ...input,
          });
          if (
            (values.unit !== previous.unit || values.category !== previous.category) &&
            repository.get(
              `SELECT id FROM trolleys WHERE product = ? AND qty > 0
            UNION SELECT id FROM movements WHERE product = ? AND state IN ('Pending', 'In Transit', 'Correction Requested') LIMIT 1`,
              id,
              id,
            )
          )
            fail(
              409,
              'Unload affected trolleys and finish open movements before changing product units or category',
            );
        } else {
          const version = integer(input.version, 'version');
          if (version !== previous.version) fail(409, 'Trolley changed. Refresh and retry');
          for (const key of [
            'location',
            'status',
            'product',
            'batch',
            'qty',
            'expected',
            'active',
            'created',
            'last_moved',
            'since',
            'previous_location',
            'operator_id',
            'uses',
            'flags',
          ]) {
            if (Object.hasOwn(input, key) && input[key] !== previous[key])
              fail(
                400,
                'Location, load and operational status must change through the movement workflow',
              );
          }
          if (openMovement(id)) fail(409, 'Finish the open movement before editing this trolley');
          values = trolleyFields({ ...previous, ...input }, location(previous.location));
          if (values.capacity < previous.qty)
            fail(400, 'Capacity cannot be below the current load');
          if (previous.qty > 0 && (values.unit !== previous.unit || values.type !== previous.type))
            fail(409, 'Unload the trolley before changing its type or capacity unit');
          identityAvailable(id, values.rfid);
        }
        updateFields(kind, id, values, kind === 'trolleys' ? ', version = version + 1' : '');
        if (kind === 'trolleys') bindTag(id, values.rfid);
        const changes = Object.fromEntries(
          Object.entries(values)
            .filter(([key, value]) => previous[key] !== value)
            .map(([key, value]) => [key, { before: previous[key], after: value }]),
        );
        repository.audit(user, 'Master updated', id, { kind, changes });
        const updated = record(kind, id);
        return kind === 'trolleys' ? effectiveTrolley(updated) : updated;
      });
    },
    setActive(user, id, input) {
      requireRole(user, ['Admin']);
      if (typeof input.active !== 'boolean') fail(400, 'Provide an active boolean');
      return repository.transaction(() => {
        const trolley = record('trolleys', id);
        if (integer(input.version, 'version') !== trolley.version)
          fail(409, 'Trolley changed. Refresh and retry');
        if (Boolean(trolley.active) === input.active) return effectiveTrolley(trolley);
        if (openMovement(id))
          fail(409, 'Finish the open movement before changing trolley activation');
        if (!input.active && (trolley.qty > 0 || openMovement(id)))
          fail(409, 'Empty the trolley and finish its open movement before deactivating it');
        repository.run(
          'UPDATE trolleys SET active = ?, version = version + 1 WHERE id = ?',
          Number(input.active),
          id,
        );
        repository.audit(user, input.active ? 'Trolley activated' : 'Trolley deactivated', id, {
          previous: Boolean(trolley.active),
          active: input.active,
        });
        return effectiveTrolley(record('trolleys', id));
      });
    },
    detail(user, id) {
      record('trolleys', id);
      return {
        trolley: effectiveTrolley(trolleyWithNames(id)),
        movements: repository.all(`${movementSelect} WHERE m.trolley = ? ORDER BY m.id DESC`, id),
        audit: repository.all(
          `SELECT a.*, u.name AS actor_name FROM audit a LEFT JOIN users u ON a.actor = u.id
          WHERE a.entity = ? ORDER BY a.id DESC`,
          id,
        ),
        tags: repository.all('SELECT tag FROM trolley_tags WHERE trolley = ? ORDER BY tag', id),
        observations: repository.all(
          'SELECT id, reader, tag, observed_at, location FROM reader_events WHERE trolley = ? ORDER BY id DESC LIMIT 50',
          id,
        ),
      };
    },
    lookup(user, code) {
      const value = requiredText(code, 'trolley ID, QR or RFID', 128);
      const trolley = repository.get(
        `SELECT t.*, u.name AS operator_name FROM trolleys t LEFT JOIN users u ON t.operator_id = u.id
        WHERE t.id = ? COLLATE NOCASE OR t.qr = ? COLLATE NOCASE OR t.rfid = ? COLLATE NOCASE
        OR t.id IN (SELECT trolley FROM trolley_tags WHERE tag = ? COLLATE NOCASE) LIMIT 1`,
        value,
        value,
        value,
        value,
      );
      if (!trolley) fail(404, 'Trolley not found');
      return effectiveTrolley(trolley);
    },
    state(user) {
      const now = Date.now();
      const since = now - 86400000;
      const flows24h = repository.all(
        `SELECT s.group_name AS source_group, d.group_name AS destination_group, COUNT(*) AS count
        FROM movements m JOIN locations s ON m.source = s.id JOIN locations d ON m.destination = d.id
        WHERE m.state IN ('In Transit','Received') AND COALESCE(m.occurred,m.created) BETWEEN ? AND ?
        GROUP BY s.group_name,d.group_name ORDER BY s.group_name,d.group_name`,
        since,
        now,
      );
      const arrivals24h = repository.all(
        `SELECT d.id AS location,d.group_name,COUNT(*) AS count
        FROM movements m JOIN locations d ON m.destination=d.id
        WHERE m.state IN ('In Transit','Received') AND COALESCE(m.occurred,m.created) BETWEEN ? AND ?
        GROUP BY d.id,d.group_name ORDER BY d.id`,
        since,
        now,
      );
      return {
        user: { ...user, access: accessFor(user) },
        roles: Object.fromEntries(
          ['Admin', 'Plant Manager', 'Supervisor', 'Operator', 'Quality User', 'Store User'].map(
            (role) => [role, accessFor({ role })],
          ),
        ),
        people: repository.all('SELECT id, name, role, active FROM users ORDER BY name, id'),
        readers: repository.all(
          'SELECT id, name, location, active, created, last_seen FROM readers ORDER BY name',
        ),
        settings: repository.get('SELECT * FROM plant_settings WHERE id = 1'),
        dashboard: {
          movements24h: flows24h.reduce((sum, flow) => sum + flow.count, 0),
          flows24h,
          arrivals24h,
        },
        locations: repository.all('SELECT * FROM locations ORDER BY id'),
        products: repository
          .all('SELECT * FROM products ORDER BY id')
          .map((product) => ({ ...product, allowed_groups: decodeArray(product.allowed_groups) })),
        activeMovements: repository.all(
          `${movementSelect} WHERE m.state IN ('Pending', 'In Transit', 'Correction Requested') ORDER BY m.id DESC`,
        ),
        trolleys: repository
          .all(
            `SELECT t.*, u.name AS operator_name FROM trolleys t LEFT JOIN users u ON t.operator_id = u.id ORDER BY t.id`,
          )
          .map((trolley) => effectiveTrolley(trolley)),
        movements: repository.all(`${movementSelect} ORDER BY m.id DESC LIMIT 50`),
        audit: MANAGER_ROLES.includes(user.role)
          ? repository.all(
              `SELECT a.*, u.name AS actor_name FROM audit a LEFT JOIN users u ON a.actor = u.id ORDER BY a.id DESC LIMIT 50`,
            )
          : [],
      };
    },
  };
}
