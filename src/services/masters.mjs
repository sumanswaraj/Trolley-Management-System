import { fail } from '../errors.mjs';
import { requiredText, finiteNumber, integer } from '../validation.mjs';
import { requireRole, MANAGER_ROLES } from '../security.mjs';

const kinds = ['locations', 'products', 'trolleys'];
const tagConditions = ['Good', 'Damaged', 'Unreadable', 'Missing'];
const text = (value, label, maximum = 120) =>
  value === '' || value === undefined ? '' : requiredText(value, label, maximum);

export function masterService(repository) {
  const checkKind = (kind) => {
    if (!kinds.includes(kind)) fail(404, 'Unknown master type');
  };
  const productLocations = (product) =>
    repository
      .all('SELECT location FROM product_locations WHERE product = ? ORDER BY location', product)
      .map((row) => row.location);
  const decorateTrolley = (item, { received, active, location, uses = 0 }) => {
    const transit = active?.state === 'In Transit' ? active : null;
    const since = received?.received ?? item.created;
    const holding = ['In Use', 'Waiting', 'Maintenance', 'Outside Plant'].includes(item.status);
    return {
      ...item,
      since,
      last_moved: transit?.created ?? received?.received ?? item.created,
      expected:
        active?.expected ?? (holding ? since + (location?.expected_minutes ?? 120) * 60000 : null),
      operator_name: transit?.operator_name || received?.operator_name || '',
      previous_location: received?.source ?? item.location,
      destination: transit?.destination ?? null,
      uses,
    };
  };
  const trolleyDetails = (item) =>
    decorateTrolley(item, {
      received: repository.get(
        "SELECT * FROM movements WHERE trolley = ? AND state = 'Received' ORDER BY received DESC, id DESC LIMIT 1",
        item.id,
      ),
      active: repository.get(
        "SELECT * FROM movements WHERE trolley = ? AND state IN ('Pending', 'In Transit') LIMIT 1",
        item.id,
      ),
      location: repository.get(
        'SELECT expected_minutes FROM locations WHERE id = ?',
        item.location,
      ),
      uses: repository.get(
        "SELECT COUNT(*) AS count FROM movements WHERE trolley = ? AND state = 'Received'",
        item.id,
      ).count,
    });
  const record = (kind, id) => {
    checkKind(kind);
    const item = repository.get(`SELECT * FROM ${kind} WHERE id = ?`, id);
    if (!item) fail(404, 'Master record not found');
    return kind === 'products'
      ? { ...item, allowed_locations: productLocations(id) }
      : kind === 'trolleys'
        ? trolleyDetails(item)
        : item;
  };
  const activeLocation = (id) => {
    if (!repository.get('SELECT id FROM locations WHERE id = ? AND active = 1', id))
      fail(400, 'Unknown or inactive location');
    return id;
  };
  const openMovement = (trolley) =>
    repository.get(
      "SELECT id FROM movements WHERE trolley = ? AND state IN ('Pending', 'In Transit')",
      trolley,
    );
  const locationList = (value) => {
    if (!Array.isArray(value) || value.length > 200) fail(400, 'Invalid allowed locations');
    return [
      ...new Set(value.map((id) => activeLocation(requiredText(id, 'allowed location', 40)))),
    ];
  };
  const syncProductLocations = (id, locations) => {
    repository.run('DELETE FROM product_locations WHERE product = ?', id);
    for (const location of locations)
      repository.run(
        'INSERT INTO product_locations(product, location) VALUES (?, ?)',
        id,
        location,
      );
  };
  const identityAvailable = (value, id) => {
    if (!value) return;
    const collision = repository.get(
      `SELECT id FROM trolleys WHERE id <> ? AND
       (id = ? COLLATE NOCASE OR qr_value = ? COLLATE NOCASE OR rfid = ? COLLATE NOCASE)`,
      id,
      value,
      value,
      value,
    );
    const mapping = repository.get(
      'SELECT trolley FROM trolley_tags WHERE tag = ? COLLATE NOCASE',
      value,
    );
    if (collision || (mapping && mapping.trolley !== id))
      fail(409, 'Identifier is already assigned to another trolley');
  };
  const syncTag = (id, previous, current) => {
    if (previous && previous !== current)
      repository.run('DELETE FROM trolley_tags WHERE tag = ? AND trolley = ?', previous, id);
    if (current)
      repository.run(
        'INSERT INTO trolley_tags(tag, trolley) VALUES (?, ?) ON CONFLICT(tag) DO NOTHING',
        current,
        id,
      );
  };
  const valuesFor = (kind, input, previous = {}) => {
    const value = (key, fallback) =>
      input[key] === undefined ? (previous[key] ?? fallback) : input[key];
    if (kind === 'locations') {
      const external = value('external', false);
      if (typeof external !== 'boolean' && external !== 0 && external !== 1)
        fail(400, 'Invalid external location');
      return {
        name: requiredText(value('name'), 'name'),
        external: Number(external),
        group_name: requiredText(
          value('group_name', external ? 'Outside Plant' : 'Other'),
          'location group',
        ),
        department: text(value('department', ''), 'department'),
        bay_capacity: integer(value('bay_capacity', 20), 'bay capacity'),
        expected_minutes: integer(value('expected_minutes', 120), 'expected minutes'),
      };
    }
    if (kind === 'products')
      return {
        name: requiredText(value('name'), 'name'),
        category: requiredText(value('category', 'Unspecified'), 'category'),
        unit: requiredText(value('unit', 'pcs'), 'unit', 20),
        default_batch: text(value('default_batch', ''), 'default batch'),
      };
    const location = value('location');
    if (previous.id && location !== previous.location)
      fail(400, 'Record a movement to change the current location');
    const assignedArea = value('assigned_area', location);
    const tagCondition = value('tag_condition', 'Good');
    if (!tagConditions.includes(tagCondition)) fail(400, 'Invalid tag condition');
    const qrValue = requiredText(value('qr_value', input.id), 'QR value', 128);
    if (previous.id && qrValue !== previous.qr_value)
      fail(400, 'The permanent QR value cannot be changed');
    for (const key of ['status', 'product', 'batch', 'qty']) {
      if (input[key] !== undefined && input[key] !== previous[key])
        fail(400, 'Use movement actions to change trolley status or load');
    }
    const capacity = finiteNumber(value('capacity'), 'capacity', Number.MIN_VALUE);
    if (capacity < (previous.qty || 0)) fail(400, 'Capacity cannot be below the current load');
    const unit = requiredText(value('unit', 'pcs'), 'unit', 20);
    if (previous.qty > 0 && previous.unit !== unit)
      fail(409, 'Empty the trolley before changing its unit');
    return {
      type: requiredText(value('type'), 'type'),
      capacity,
      location: activeLocation(requiredText(location, 'location')),
      unit,
      material_type: requiredText(value('material_type', 'Unspecified'), 'material type'),
      department: text(value('department', ''), 'department'),
      assigned_area: activeLocation(requiredText(assignedArea, 'assigned area')),
      qr_value: qrValue,
      rfid: text(value('rfid', ''), 'RFID', 128),
      tag_condition: tagCondition,
    };
  };
  return {
    create(user, kind, input) {
      requireRole(user, MANAGER_ROLES);
      checkKind(kind);
      const id = requiredText(input.id, 'ID', 40);
      return repository.transaction(() => {
        const values = valuesFor(kind, input);
        if (kind === 'trolleys') {
          for (const identifier of [id, values.qr_value, values.rfid])
            identityAvailable(identifier, id);
          values.created = Date.now();
          values.updated = values.created;
        }
        const keys = Object.keys(values);
        repository.run(
          `INSERT INTO ${kind}(id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`,
          id,
          ...Object.values(values),
        );
        if (kind === 'products' && input.allowed_locations !== undefined)
          syncProductLocations(id, locationList(input.allowed_locations));
        if (kind === 'trolleys') syncTag(id, '', values.rfid);
        repository.audit(user, 'Master created', id, { kind });
        return record(kind, id);
      });
    },
    detail(user, kind, id) {
      return record(kind, requiredText(id, 'ID', 40));
    },
    update(user, kind, id, input) {
      requireRole(user, MANAGER_ROLES);
      checkKind(kind);
      return repository.transaction(() => {
        const previous = record(kind, requiredText(id, 'ID', 40));
        if (previous.version !== integer(input.version, 'version'))
          fail(409, 'Master record changed. Refresh and retry');
        if (input.id !== undefined && input.id !== id) fail(400, 'Master IDs cannot be changed');
        if (input.active !== undefined && Number(input.active) !== previous.active)
          fail(400, 'Use activation actions to change active status');
        if (kind === 'trolleys' && openMovement(id))
          fail(409, 'Receive or decide the open movement before editing this trolley');
        const values = valuesFor(kind, input, previous);
        if (
          kind === 'locations' &&
          values.external !== previous.external &&
          repository.get('SELECT id FROM trolleys WHERE location = ? AND active = 1', id)
        )
          fail(
            409,
            'Move active trolleys before changing whether this location is outside the plant',
          );
        if (
          kind === 'products' &&
          (values.unit !== previous.unit || values.category !== previous.category)
        ) {
          if (
            repository.get(
              "SELECT id FROM movements WHERE product = ? AND state IN ('Pending', 'In Transit')",
              id,
            ) ||
            repository.get('SELECT id FROM trolleys WHERE product = ? AND qty > 0', id)
          )
            fail(
              409,
              'Product is in use; empty its trolleys and finish movements before changing category or unit',
            );
        }
        if (
          kind === 'locations' &&
          (values.external !== previous.external || values.group_name !== previous.group_name) &&
          repository.get(
            "SELECT id FROM movements WHERE (source = ? OR destination = ?) AND state IN ('Pending', 'In Transit')",
            id,
            id,
          )
        )
          fail(409, 'Finish movements before changing the location classification');
        if (kind === 'trolleys') {
          identityAvailable(values.rfid, id);
          values.updated = Date.now();
          syncTag(id, previous.rfid, values.rfid);
        }
        repository.run(
          `UPDATE ${kind} SET ${Object.keys(values)
            .map((key) => `${key} = ?`)
            .join(', ')}, version = version + 1 WHERE id = ?`,
          ...Object.values(values),
          id,
        );
        if (kind === 'products' && input.allowed_locations !== undefined) {
          if (
            repository.get(
              "SELECT id FROM movements WHERE product = ? AND state IN ('Pending', 'In Transit')",
              id,
            )
          )
            fail(409, 'Finish movements before changing allowed product locations');
          syncProductLocations(id, locationList(input.allowed_locations));
        }
        const current = record(kind, id);
        repository.audit(user, 'Master updated', id, { kind, previous, current });
        return current;
      });
    },
    setActive(user, kind, id, input) {
      requireRole(user, MANAGER_ROLES);
      checkKind(kind);
      if (typeof input.active !== 'boolean') fail(400, 'Provide an active boolean');
      return repository.transaction(() => {
        const previous = record(kind, requiredText(id, 'ID', 40));
        if (previous.version !== integer(input.version, 'version'))
          fail(409, 'Master record changed. Refresh and retry');
        if (kind === 'trolleys') {
          if (openMovement(id)) fail(409, 'Trolley has an open movement');
          if (!input.active && previous.qty > 0)
            fail(409, 'Empty the trolley before deactivating it');
          if (input.active) {
            activeLocation(previous.location);
            activeLocation(previous.assigned_area);
          }
        } else if (!input.active && kind === 'locations') {
          if (
            repository.get(
              'SELECT id FROM trolleys WHERE active = 1 AND (location = ? OR assigned_area = ?)',
              id,
              id,
            ) ||
            repository.get(
              "SELECT id FROM movements WHERE (source = ? OR destination = ?) AND state IN ('Pending', 'In Transit')",
              id,
              id,
            ) ||
            repository.get('SELECT id FROM readers WHERE location = ? AND active = 1', id)
          )
            fail(409, 'Location is in use by active trolleys, readers or movements');
        } else if (!input.active && kind === 'products') {
          if (
            repository.get('SELECT id FROM trolleys WHERE product = ? AND qty > 0', id) ||
            repository.get(
              "SELECT id FROM movements WHERE product = ? AND state IN ('Pending', 'In Transit')",
              id,
            )
          )
            fail(409, 'Product is in use by a trolley or movement');
        }
        repository.run(
          `UPDATE ${kind} SET active = ?, version = version + 1${kind === 'trolleys' ? ', updated = ?' : ''} WHERE id = ?`,
          Number(input.active),
          ...(kind === 'trolleys' ? [Date.now()] : []),
          id,
        );
        repository.audit(user, input.active ? 'Master activated' : 'Master deactivated', id, {
          kind,
        });
        return record(kind, id);
      });
    },
    state(user) {
      const movementQuery = `SELECT m.*, u.name AS requester, a.name AS approver_name, r.name AS receiver_name,
        c.reason AS correction_reason,
        c.created AS correction_requested_at, CASE WHEN c.movement IS NOT NULL THEN 'Correction Requested'
        WHEN m.state = 'Rejected' THEN 'Rejected' WHEN m.approved_by IS NOT NULL THEN 'Approved' ELSE '' END AS decision
        , CASE WHEN c.movement IS NOT NULL THEN 'Correction Requested' WHEN m.state = 'Pending' THEN 'Pending Approval'
        WHEN m.state = 'Received' THEN 'Completed' ELSE m.state END AS display_status
        FROM movements m JOIN users u ON m.requested_by = u.id LEFT JOIN users a ON a.id = m.approved_by
        LEFT JOIN users r ON r.id = m.received_by LEFT JOIN correction_requests c ON c.movement = m.id`;
      const locations = repository.all('SELECT * FROM locations ORDER BY id');
      const locationById = new Map(locations.map((item) => [item.id, item]));
      const activeMovements = repository.all(
        `${movementQuery} WHERE state IN ('Pending', 'In Transit') ORDER BY m.id DESC`,
      );
      const activeByTrolley = new Map(activeMovements.map((item) => [item.trolley, item]));
      const latestReceived = repository.all(`SELECT * FROM (
        SELECT m.*, ROW_NUMBER() OVER (PARTITION BY trolley ORDER BY received DESC, id DESC) AS position,
        COUNT(*) OVER (PARTITION BY trolley) AS uses FROM movements m WHERE state = 'Received'
      ) WHERE position = 1`);
      const receivedByTrolley = new Map(latestReceived.map((item) => [item.trolley, item]));
      const allowedByProduct = new Map();
      for (const item of repository.all(
        'SELECT * FROM product_locations ORDER BY product, location',
      )) {
        if (!allowedByProduct.has(item.product)) allowedByProduct.set(item.product, []);
        allowedByProduct.get(item.product).push(item.location);
      }
      return {
        user,
        locations,
        products: repository
          .all('SELECT * FROM products ORDER BY id')
          .map((item) => ({ ...item, allowed_locations: allowedByProduct.get(item.id) || [] })),
        activeMovements,
        trolleys: repository.all('SELECT * FROM trolleys ORDER BY id').map((item) =>
          decorateTrolley(item, {
            received: receivedByTrolley.get(item.id),
            active: activeByTrolley.get(item.id),
            location: locationById.get(item.location),
            uses: receivedByTrolley.get(item.id)?.uses || 0,
          }),
        ),
        movements: repository.all(`${movementQuery} ORDER BY m.id DESC LIMIT 50`),
        approvalSettings: repository.get(
          'SELECT outside_approval, mismatch_approval FROM plant_settings WHERE id = 1',
        ),
        audit: MANAGER_ROLES.includes(user.role)
          ? repository.all(
              `SELECT a.*, u.name AS actor_name FROM audit a JOIN users u ON a.actor = u.id ORDER BY a.id DESC LIMIT 50`,
            )
          : [],
      };
    },
  };
}
