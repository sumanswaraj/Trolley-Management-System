import { fail } from '../errors.mjs';
import { requireRole, MANAGER_ROLES } from '../security.mjs';

const DAY = 86400000;
const REPORTS = [
  ['daily', 'Daily trolley movement report', 'Every recorded movement today, in time order.'],
  ['util', 'Trolley utilization report', 'Current availability and utilization by trolley type.'],
  [
    'loc',
    'Location-wise trolley report',
    'Current trolleys, material and recorded stay at each location.',
  ],
  ['prod', 'Product-wise trolley report', 'Product and batch assignments across the fleet.'],
  ['over', 'Overdue trolley report', 'Trolleys past their movement or location holding deadline.'],
  ['hist', 'Trolley history report', 'The complete filtered movement trail.'],
  [
    'out',
    'Outside plant trolley report',
    'Trolleys currently outside the plant and their return times.',
  ],
  [
    'exc',
    'Movement exception report',
    'Recorded location, product, missing and movement exceptions.',
  ],
];
const HISTORY_COLUMNS = [
  'Date',
  'Time',
  'Trolley ID',
  'From location',
  'To location',
  'Product / material',
  'Quantity',
  'Operator',
  'Movement type',
  'Status',
];
const EXCEPTION_TYPES = new Set([
  'Wrong location',
  'Wrong product',
  'Wrong trolley',
  'Unauthorized movement',
  'Trolley missing',
  'Movement not completed',
]);

function positiveParameter(value, label, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum)
    fail(400, `Invalid ${label}`);
  return number;
}

function timeParameter(value, label, fallback = null, end = false) {
  if (value === null || value === '') return fallback;
  let timestamp;
  if (/^\d+$/.test(value)) timestamp = Number(value);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    timestamp = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value)
      fail(400, `Invalid ${label}`);
    if (end) timestamp += DAY - 1;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(value)) timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8640000000000000)
    fail(400, `Invalid ${label}`);
  return timestamp;
}

function dateRange(query, from = null, to = null) {
  const range = {
    from: timeParameter(query.get('from'), 'start time', from),
    to: timeParameter(query.get('to'), 'end time', to, true),
  };
  if (range.from !== null && range.to !== null && range.from > range.to)
    fail(400, 'Start time must not exceed end time');
  return range;
}

const dayKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
const dayStart = (timestamp) => Math.floor(timestamp / DAY) * DAY;
const movementTime = (movement) => movement.occurred_at || movement.created;
const displayStatus = (movement) =>
  movement.correction_requested
    ? 'Correction Requested'
    : movement.state === 'Received'
      ? 'Completed'
      : movement.state === 'Pending'
        ? 'Pending Approval'
        : movement.state;
const isoTime = (timestamp) => (timestamp == null ? '' : new Date(timestamp).toISOString());
const duration = (milliseconds) => {
  if (milliseconds == null) return '';
  const minutes = Math.floor(Math.max(0, milliseconds) / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
};
const normalized = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();
const contains = (value, query) => normalized(value).includes(normalized(query));
const like = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
const queryValue = (query, ...names) => names.map((name) => query.get(name)).find(Boolean) || '';

function historyRow(movement) {
  const timestamp = isoTime(movementTime(movement));
  return [
    timestamp.slice(0, 10),
    timestamp.slice(11, 19),
    movement.trolley,
    movement.source_name || movement.source,
    movement.destination_name || movement.destination,
    movement.product_name || movement.product || '',
    movement.qty,
    movement.requester,
    movement.movement_type || 'Transfer',
    displayStatus(movement),
  ];
}

function weekKey(timestamp) {
  const date = new Date(dayStart(timestamp));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return dayKey(date.getTime());
}

function returnCycles(movements) {
  const open = new Map();
  const cycles = [];
  for (const movement of [...movements].sort(
    (a, b) => movementTime(a) - movementTime(b) || a.id - b.id,
  )) {
    if (!['In Transit', 'Received'].includes(movement.state)) continue;
    let cycle = open.get(movement.trolley);
    if (!cycle) {
      cycle = {
        trolley: movement.trolley,
        source: movement.source,
        started: movementTime(movement),
        expected: movement.expected,
        returned: null,
      };
      open.set(movement.trolley, cycle);
      cycles.push(cycle);
    }
    if (
      movement.state === 'Received' &&
      movement.destination === cycle.source &&
      movement.received != null
    ) {
      cycle.returned = movement.received;
      open.delete(movement.trolley);
    }
  }
  return { cycles, open };
}

function overdueIntervals(movements, locations, decisions) {
  const events = new Map();
  for (const movement of movements) {
    const rejectedAt = decisions.get(movement.id);
    if (movement.state === 'Rejected' && rejectedAt == null) continue;
    const group = events.get(movement.trolley) || [];
    group.push({ time: movement.created, kind: 'request', movement });
    if (movement.state === 'Received' && movement.received != null)
      group.push({ time: movement.received, kind: 'received', movement });
    if (movement.state === 'Rejected') group.push({ time: rejectedAt, kind: 'rejected', movement });
    events.set(movement.trolley, group);
  }
  const intervals = [];
  for (const [trolley, group] of events) {
    let holding = null;
    let expected = null;
    let started = null;
    for (const event of group.sort(
      (a, b) => a.time - b.time || a.movement.id - b.movement.id || (a.kind === 'request' ? -1 : 1),
    )) {
      if (started != null && expected != null)
        intervals.push({ trolley, started, expected, ended: event.time });
      const movement = event.movement;
      if (event.kind === 'request') expected = movement.expected;
      else if (event.kind === 'rejected') expected = holding;
      else {
        const location = locations.get(movement.destination);
        const status =
          movement.status_after && movement.status_after !== 'auto'
            ? movement.status_after
            : location?.external
              ? 'Outside Plant'
              : movement.qty > 0
                ? 'In Use'
                : 'Available';
        holding = ['In Use', 'Waiting', 'Maintenance', 'Outside Plant'].includes(status)
          ? event.time + (location?.expected_minutes ?? 120) * 60000
          : null;
        expected = holding;
      }
      started = event.time;
    }
    if (started != null && expected != null)
      intervals.push({ trolley, started, expected, ended: null });
  }
  return intervals;
}

export function reportService(repository) {
  const movementColumns = new Set(
    repository.all('PRAGMA table_info(movements)').map((column) => column.name),
  );
  const hasCorrections = Boolean(
    repository.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'correction_requests'",
    ),
  );
  const timestamp = movementColumns.has('occurred_at')
    ? 'COALESCE(NULLIF(m.occurred_at, 0), m.created)'
    : 'm.created';
  const operator = movementColumns.has('operator_name')
    ? "COALESCE(NULLIF(m.operator_name, ''), u.name)"
    : 'u.name';
  const correction = hasCorrections
    ? 'EXISTS (SELECT 1 FROM correction_requests c WHERE c.movement = m.id)'
    : '0';
  const select = `SELECT m.*, ${operator} AS requester, u.username AS requester_username,
    sl.name AS source_name, dl.name AS destination_name, p.name AS product_name,
    au.name AS approver_name, ${correction} AS correction_requested
    FROM movements m LEFT JOIN users u ON m.requested_by = u.id
    LEFT JOIN users au ON m.approved_by = au.id
    LEFT JOIN locations sl ON m.source = sl.id
    LEFT JOIN locations dl ON m.destination = dl.id
    LEFT JOIN products p ON m.product = p.id`;

  function movementQuery(query, paginate = false) {
    const { from, to } = dateRange(query);
    const conditions = [];
    const parameters = [];
    const add = (condition, ...values) => {
      conditions.push(condition);
      parameters.push(...values);
    };
    if (from !== null) add(`${timestamp} >= ?`, from);
    if (to !== null) add(`${timestamp} <= ?`, to);
    const trolley = queryValue(query, 'trolley');
    if (trolley) add("m.trolley LIKE ? ESCAPE '\\'", like(trolley));
    const location = queryValue(query, 'location', 'loc');
    if (location) add('(m.source = ? OR m.destination = ?)', location, location);
    const requester = queryValue(query, 'operator', 'requested_by');
    if (requester)
      add(
        `(CAST(m.requested_by AS TEXT) = ? OR ${operator} = ? COLLATE NOCASE OR u.username = ? COLLATE NOCASE)`,
        requester,
        requester,
        requester,
      );
    const product = queryValue(query, 'product');
    if (product) add('m.product = ?', product);
    const type = queryValue(query, 'type', 'movement_type');
    if (type)
      add(
        movementColumns.has('movement_type')
          ? 'm.movement_type = ? COLLATE NOCASE'
          : "'Transfer' = ? COLLATE NOCASE",
        type,
      );
    const state = queryValue(query, 'state', 'status');
    if (state) {
      if (['Correction Requested', 'Correction Required'].includes(state)) add(`${correction} = 1`);
      else {
        add(
          'm.state = ?',
          { Completed: 'Received', 'Pending Approval': 'Pending' }[state] || state,
        );
        if (state === 'Rejected') add(`${correction} = 0`);
      }
    }
    const q = queryValue(query, 'q');
    if (q) {
      const fields = [
        'CAST(m.id AS TEXT)',
        'm.trolley',
        'm.source',
        'm.destination',
        'sl.name',
        'dl.name',
        'm.product',
        'p.name',
        operator,
        'm.batch',
        'm.exception_reason',
        'm.decision_reason',
      ];
      for (const field of ['movement_type', 'remarks', 'reason', 'department'])
        if (movementColumns.has(field)) fields.push(`m.${field}`);
      add(
        `(${fields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ')})`,
        ...fields.map(() => like(q)),
      );
    }
    let limit;
    if (paginate) {
      limit = positiveParameter(query.get('limit'), 'limit', 50, 100);
      const cursor = positiveParameter(query.get('before'), 'cursor', null);
      if (cursor) add('m.id < ?', cursor);
    }
    const rows = repository.all(
      `${select}${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY m.id DESC${paginate ? ' LIMIT ?' : ''}`,
      ...parameters,
      ...(paginate ? [limit + 1] : []),
    );
    return paginate
      ? {
          items: rows
            .slice(0, limit)
            .map((row) => ({ ...row, display_status: displayStatus(row) })),
          nextCursor: rows.length > limit ? rows[limit - 1].id : null,
        }
      : rows;
  }

  function context() {
    const now = Date.now();
    const movements = repository.all(`${select} ORDER BY m.id`);
    const { cycles } = returnCycles(movements);
    const latest = new Map();
    const arrivals = new Map();
    const active = new Map();
    for (const movement of movements) {
      const current = latest.get(movement.trolley);
      if (!current || movementTime(movement) >= movementTime(current))
        latest.set(movement.trolley, movement);
      if (movement.state === 'Received' && movement.received != null) {
        const previous = arrivals.get(movement.trolley);
        if (!previous || movement.received >= previous.received)
          arrivals.set(movement.trolley, movement);
      }
      if (['Pending', 'In Transit'].includes(movement.state))
        active.set(movement.trolley, movement);
    }
    const locations = repository.all('SELECT * FROM locations ORDER BY id');
    const products = repository.all('SELECT * FROM products ORDER BY id');
    const locationMap = new Map(locations.map((location) => [location.id, location]));
    const productMap = new Map(products.map((product) => [product.id, product]));
    const trolleys = repository
      .all('SELECT * FROM trolleys WHERE active = 1 ORDER BY id')
      .map((trolley) => {
        const transit = active.get(trolley.id);
        const arrival = arrivals.get(trolley.id);
        const movement = transit || arrival || latest.get(trolley.id);
        const location = locationMap.get(trolley.location);
        const since = arrival?.received ?? (trolley.created || null);
        const holding = ['In Use', 'Waiting', 'Maintenance', 'Outside Plant'].includes(
          trolley.status,
        );
        const expected =
          transit?.expected ??
          (holding && since != null ? since + (location?.expected_minutes ?? 120) * 60000 : null);
        const status = expected != null && expected < now ? 'Overdue' : trolley.status;
        return {
          ...trolley,
          status,
          since,
          expected,
          location_name: location?.name || trolley.location,
          product_name: productMap.get(trolley.product)?.name || trolley.product || '',
          department: trolley.department || location?.department || '',
          assigned_person: movement?.requester || '',
          movement,
        };
      });
    const decisions = new Map();
    for (const decision of repository.all(
      "SELECT detail, ts FROM audit WHERE action IN ('Movement reject', 'Movement correct') ORDER BY ts",
    )) {
      try {
        const movement = JSON.parse(decision.detail).movement;
        if (Number.isSafeInteger(movement)) decisions.set(movement, decision.ts);
      } catch {}
    }
    return {
      now,
      movements,
      cycles,
      trolleys,
      locations,
      products,
      locationMap,
      overdueIntervals: overdueIntervals(movements, locationMap, decisions),
    };
  }

  function filteredFleet(data, query) {
    const q = queryValue(query, 'q');
    const trolley = queryValue(query, 'trolley');
    const location = queryValue(query, 'location', 'loc');
    const product = queryValue(query, 'product');
    const operator = queryValue(query, 'operator', 'requested_by');
    const status = queryValue(query, 'status', 'state');
    const { from, to } = dateRange(query);
    return data.trolleys.filter(
      (item) =>
        (!q ||
          [
            item.id,
            item.type,
            item.location,
            item.location_name,
            item.product,
            item.product_name,
            item.batch,
            item.department,
            item.assigned_person,
          ].some((value) => contains(value, q))) &&
        (!trolley || contains(item.id, trolley)) &&
        (!location || item.location === location) &&
        (!product || item.product === product) &&
        (!status || item.status === status) &&
        (!operator ||
          String(item.movement?.requested_by) === operator ||
          normalized(item.assigned_person) === normalized(operator)) &&
        (from === null || (item.movement && movementTime(item.movement) >= from)) &&
        (to === null || (item.movement && movementTime(item.movement) <= to)),
    );
  }

  return {
    history(user, kind, query) {
      if (kind !== 'audit') return movementQuery(query, true);
      requireRole(user, MANAGER_ROLES);
      const limit = positiveParameter(query.get('limit'), 'limit', 50, 100);
      const cursor = positiveParameter(query.get('before'), 'cursor', null);
      const { from, to } = dateRange(query);
      const conditions = [];
      const parameters = [];
      for (const [condition, value] of [
        ['a.id < ?', cursor],
        ['a.ts >= ?', from],
        ['a.ts <= ?', to],
        ['a.entity = ?', query.get('trolley')],
      ])
        if (value !== null && value !== '') {
          conditions.push(condition);
          parameters.push(value);
        }
      const q = queryValue(query, 'q');
      if (q) {
        conditions.push(
          "(a.action LIKE ? ESCAPE '\\' OR a.entity LIKE ? ESCAPE '\\' OR a.detail LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')",
        );
        parameters.push(...Array(5).fill(like(q)));
      }
      const rows = repository.all(
        `SELECT a.*, u.name AS actor_name FROM audit a LEFT JOIN users u ON a.actor = u.id${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`,
        ...parameters,
        limit + 1,
      );
      return {
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },

    summary(user, query) {
      const { from, to } = dateRange(query, Date.now() - 30 * DAY, Date.now());
      const totals = repository.get(
        `SELECT COUNT(*) AS requested,
        SUM(CASE WHEN state = 'Received' THEN 1 ELSE 0 END) AS received,
        SUM(CASE WHEN state = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
        AVG(CASE WHEN received IS NOT NULL THEN received - created END) AS mean_receipt_ms
        FROM movements WHERE created >= ? AND created <= ?`,
        from,
        to,
      );
      const daily = repository.all(
        `SELECT date(created / 1000, 'unixepoch') AS day, COUNT(*) AS count
        FROM movements WHERE created >= ? AND created <= ? GROUP BY day ORDER BY day`,
        from,
        to,
      );
      return {
        from,
        to,
        totals,
        daily,
        timezone: 'UTC',
        metric: 'request-to-receipt duration, including approval wait',
      };
    },

    catalogue(user, queryOrKind = new URLSearchParams(), filters = new URLSearchParams()) {
      const query = typeof queryOrKind === 'string' ? filters : queryOrKind;
      const kind = typeof queryOrKind === 'string' ? queryOrKind : query.get('kind');
      if (!kind)
        return { reports: REPORTS.map(([id, title, description]) => ({ id, title, description })) };
      const report = REPORTS.find(([id]) => id === kind);
      if (!report) fail(404, 'Unknown report');
      const data = context();
      const fleet = filteredFleet(data, query);
      let columns;
      let rows;
      if (kind === 'daily' || kind === 'hist') {
        const selected = new URLSearchParams(query);
        if (kind === 'daily' && !selected.get('from'))
          selected.set('from', String(dayStart(data.now)));
        if (kind === 'daily' && !selected.get('to'))
          selected.set('to', String(dayStart(data.now) + DAY - 1));
        const movements = movementQuery(selected).sort((a, b) =>
          kind === 'daily'
            ? movementTime(a) - movementTime(b) || a.id - b.id
            : movementTime(b) - movementTime(a) || b.id - a.id,
        );
        columns = HISTORY_COLUMNS;
        rows = movements.map(historyRow);
      } else if (kind === 'util') {
        columns = [
          'Trolley type',
          'Total',
          'Available',
          'In use',
          'In transit / waiting',
          'Maintenance',
          'Outside plant',
          'Overdue',
          'Utilization %',
        ];
        rows = [...new Set(fleet.map((trolley) => trolley.type))].sort().map((type) => {
          const group = fleet.filter((trolley) => trolley.type === type);
          const count = (status) => group.filter((trolley) => trolley.status === status).length;
          return [
            type,
            group.length,
            count('Available'),
            count('In Use'),
            count('In Transit') + count('Waiting'),
            count('Maintenance'),
            count('Outside Plant'),
            count('Overdue'),
            `${Math.round(((group.length - count('Available') - count('Maintenance')) / group.length) * 100)}%`,
          ];
        });
      } else if (kind === 'loc') {
        columns = [
          'Location code',
          'Location',
          'Trolleys',
          'Units of material',
          'Bay usage %',
          'Longest stay',
        ];
        rows = data.locations
          .filter(
            (location) =>
              !queryValue(query, 'location', 'loc') ||
              location.id === queryValue(query, 'location', 'loc'),
          )
          .map((location) => {
            const group = fleet.filter((trolley) => trolley.location === location.id);
            const stays = group
              .filter((trolley) => trolley.since != null)
              .map((trolley) => data.now - trolley.since);
            const quantities = new Map();
            for (const trolley of group)
              if (trolley.qty > 0)
                quantities.set(
                  trolley.unit || 'pcs',
                  (quantities.get(trolley.unit || 'pcs') || 0) + trolley.qty,
                );
            const units =
              [...quantities].map(([unit, quantity]) => `${quantity} ${unit}`).join(', ') || 0;
            return [
              location.id,
              location.name,
              group.length,
              units,
              location.bay_capacity > 0
                ? `${Math.round((group.length / location.bay_capacity) * 100)}%`
                : '',
              stays.length ? duration(Math.max(...stays)) : '',
            ];
          });
      } else if (kind === 'prod') {
        columns = ['Code', 'Product', 'Batch', 'Trolleys', 'Units', 'Held at'];
        rows = [];
        for (const product of data.products.filter(
          (product) => !query.get('product') || product.id === query.get('product'),
        )) {
          const group = fleet.filter((trolley) => trolley.product === product.id);
          const batches = [...new Set(group.map((trolley) => trolley.batch))];
          if (!batches.length) batches.push(product.default_batch || '');
          for (const batch of batches) {
            const trolleys = group.filter((trolley) => trolley.batch === batch);
            rows.push([
              product.id,
              product.name,
              batch,
              trolleys.length,
              `${trolleys.reduce((total, trolley) => total + trolley.qty, 0)} ${product.unit || 'pcs'}`,
              [...new Set(trolleys.map((trolley) => trolley.location_name))].join(', '),
            ]);
          }
        }
      } else if (kind === 'over') {
        columns = [
          'Trolley ID',
          'Location',
          'Expected return',
          'At location for',
          'Delay',
          'Department',
          'Assigned person',
        ];
        rows = fleet
          .filter((trolley) => trolley.status === 'Overdue')
          .sort((a, b) => a.expected - b.expected)
          .map((trolley) => [
            trolley.id,
            trolley.location_name,
            isoTime(trolley.expected),
            duration(trolley.since == null ? null : data.now - trolley.since),
            duration(data.now - trolley.expected),
            trolley.department,
            trolley.assigned_person,
          ]);
      } else if (kind === 'out') {
        columns = [
          'Trolley ID',
          'Product',
          'Qty',
          'Out since',
          'Time outside',
          'Expected return',
          'Approved by',
        ];
        rows = fleet
          .filter((trolley) => data.locationMap.get(trolley.location)?.external)
          .map((trolley) => {
            const arrival = data.movements
              .filter(
                (movement) =>
                  movement.trolley === trolley.id &&
                  movement.destination === trolley.location &&
                  movement.state === 'Received',
              )
              .sort((a, b) => b.received - a.received)[0];
            return [
              trolley.id,
              trolley.product_name || 'Empty',
              trolley.qty,
              isoTime(trolley.since),
              duration(trolley.since == null ? null : data.now - trolley.since),
              isoTime(trolley.expected),
              arrival?.approver_name || '',
            ];
          });
      } else {
        columns = ['Raised', 'Type', 'Trolley ID', 'Location', 'Priority', 'Status', 'Detail'];
        const hasAlerts = repository.get(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'alerts'",
        );
        const alerts = hasAlerts
          ? repository.all(
              'SELECT a.*, u.name AS actor_name FROM alerts a LEFT JOIN users u ON a.created_by = u.id ORDER BY a.created DESC, a.id DESC',
            )
          : [];
        const { from, to } = dateRange(query);
        rows = alerts
          .filter(
            (alert) =>
              EXCEPTION_TYPES.has(alert.type) &&
              (from === null || alert.created >= from) &&
              (to === null || alert.created <= to) &&
              (!query.get('trolley') || contains(alert.trolley, query.get('trolley'))) &&
              (!queryValue(query, 'location', 'loc') ||
                alert.location === queryValue(query, 'location', 'loc')) &&
              (!query.get('status') || alert.status === query.get('status')) &&
              (!query.get('operator') ||
                String(alert.created_by) === query.get('operator') ||
                normalized(alert.actor_name) === normalized(query.get('operator'))) &&
              (!query.get('q') ||
                [alert.type, alert.trolley, alert.location, alert.message, alert.actor_name].some(
                  (value) => contains(value, query.get('q')),
                )),
          )
          .map((alert) => [
            isoTime(alert.created),
            alert.type,
            alert.trolley,
            data.locationMap.get(alert.location)?.name || alert.location || '',
            alert.priority,
            alert.status,
            alert.message,
          ]);
      }
      return { kind, title: report[1], columns, rows, generatedAt: data.now, timezone: 'UTC' };
    },

    analytics(user, query = new URLSearchParams()) {
      const data = context();
      const { from, to } = dateRange(query, dayStart(data.now) - 13 * DAY, data.now);
      if (to - from > 3660 * DAY) fail(400, 'Analytics date range must not exceed ten years');
      const recorded = data.movements.filter((movement) =>
        ['In Transit', 'Received'].includes(movement.state),
      );
      const selected = recorded.filter(
        (movement) => movementTime(movement) >= from && movementTime(movement) <= to,
      );
      const daily = [];
      const overdueDaily = [];
      const turnaroundDaily = [];
      const completed = data.cycles.filter(
        (cycle) =>
          cycle.returned != null &&
          cycle.returned >= from &&
          cycle.returned <= to &&
          cycle.returned >= cycle.started,
      );
      const completedByDay = new Map();
      for (const cycle of completed) {
        const day = dayKey(cycle.returned);
        const group = completedByDay.get(day) || [];
        group.push(cycle.returned - cycle.started);
        completedByDay.set(day, group);
      }
      const dailyCounts = new Map();
      for (const movement of selected) {
        const day = dayKey(movementTime(movement));
        dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
      }
      for (let start = dayStart(from); start <= dayStart(to); start += DAY) {
        const day = dayKey(start);
        const end = Math.min(start + DAY - 1, to);
        daily.push({ day, count: dailyCounts.get(day) || 0 });
        const overdueTrolleys = new Set(
          data.overdueIntervals
            .filter(
              (interval) =>
                interval.started <= end &&
                interval.expected < end &&
                (interval.ended == null || interval.ended > end),
            )
            .map((interval) => interval.trolley),
        );
        const count =
          end === data.now
            ? data.trolleys.filter((trolley) => trolley.status === 'Overdue').length
            : overdueTrolleys.size;
        overdueDaily.push({ day, count });
        const durations = completedByDay.get(day) || [];
        turnaroundDaily.push({
          day,
          count: durations.length,
          meanMs: durations.length
            ? durations.reduce((sum, value) => sum + value, 0) / durations.length
            : null,
        });
      }
      const weeks = new Map();
      for (const point of daily) {
        const week = weekKey(Date.parse(point.day));
        weeks.set(week, (weeks.get(week) || 0) + point.count);
      }
      const overdueWeeks = new Map();
      for (const point of overdueDaily)
        overdueWeeks.set(weekKey(Date.parse(point.day)), point.count);
      const fleetStatuses = [
        'Available',
        'In Use',
        'In Transit',
        'Waiting',
        'Maintenance',
        'Overdue',
        'Outside Plant',
      ];
      const fleet = fleetStatuses.map((status) => ({
        status,
        count: data.trolleys.filter((trolley) => trolley.status === status).length,
      }));
      const arrivals = data.locations.map((location) => ({
        location: location.id,
        name: location.name,
        count: recorded.filter(
          (movement) =>
            movement.state === 'Received' &&
            movement.received >= data.now - DAY &&
            movement.received <= data.now &&
            movement.destination === location.id,
        ).length,
      }));
      const usage = new Map();
      for (const movement of selected)
        usage.set(movement.trolley, (usage.get(movement.trolley) || 0) + 1);
      const flowCounts = new Map();
      for (const movement of recorded.filter(
        (movement) =>
          movementTime(movement) >= data.now - DAY && movementTime(movement) <= data.now,
      )) {
        const key = JSON.stringify([movement.source, movement.destination]);
        flowCounts.set(key, (flowCounts.get(key) || 0) + 1);
      }
      return {
        from,
        to,
        timezone: 'UTC',
        generatedAt: data.now,
        fleet,
        arrivals,
        daily,
        weekly: [...weeks].map(([week, count]) => ({ week, count })),
        topTrolleys: [...usage]
          .map(([trolley, count]) => ({ trolley, count }))
          .sort((a, b) => b.count - a.count || a.trolley.localeCompare(b.trolley))
          .slice(0, 8),
        turnaround: {
          completedCycles: completed.length,
          meanMs: completed.length
            ? completed.reduce((sum, cycle) => sum + cycle.returned - cycle.started, 0) /
              completed.length
            : null,
          daily: turnaroundDaily,
          metric: 'Recorded departure from a source to confirmed receipt back at that source',
        },
        overdue: {
          daily: overdueDaily,
          weekly: [...overdueWeeks].map(([week, count]) => ({ week, count })),
          metric:
            'Unique trolleys overdue at period end from recorded movement and receipt times, using current location holding limits',
        },
        distribution: data.locations.map((location) => ({
          location: location.id,
          name: location.name,
          count: data.trolleys.filter((trolley) => trolley.location === location.id).length,
        })),
        flow: [...flowCounts].map(([key, count]) => {
          const [source, destination] = JSON.parse(key);
          return { source, destination, count };
        }),
      };
    },
  };
}
