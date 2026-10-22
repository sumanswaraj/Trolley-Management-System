import { fail } from '../errors.mjs';
import { requirePermission, requireRole, APPROVER_ROLES, USER_ROLES } from '../security.mjs';

const DAY = 86400000;
const EVENT = 'COALESCE(m.occurred,m.created)';
const MOVEMENTS = `SELECT m.*, u.name AS requester, COALESCE(op.name,u.name) AS operator_name,
 s.name AS source_name, d.name AS destination_name, p.name AS product_name
 FROM movements m LEFT JOIN users u ON u.id=m.requested_by
 LEFT JOIN users op ON op.id=COALESCE(m.operator_id,m.requested_by)
 LEFT JOIN locations s ON s.id=m.source LEFT JOIN locations d ON d.id=m.destination
 LEFT JOIN products p ON p.id=m.product`;
const FLEET = `SELECT t.*, l.name AS location_name, l.external, l.group_name AS location_group,
 p.name AS product_name, u.name AS operator_name FROM trolleys t
 LEFT JOIN locations l ON l.id=t.location LEFT JOIN products p ON p.id=t.product
 LEFT JOIN users u ON u.id=t.operator_id`;
const ALIASES = {
  util: 'utilization',
  loc: 'location',
  prod: 'product',
  over: 'overdue',
  hist: 'history',
  out: 'outside',
  exc: 'exceptions',
};
const MOVEMENT_COLUMNS = [
  'Movement ID',
  'Time (UTC)',
  'Trolley ID',
  'From',
  'To',
  'Product',
  'Batch',
  'Quantity',
  'Operator',
  'Movement type',
  'Status',
  'Department',
  'Reason',
  'Remarks',
  'Expected (UTC)',
  'Received (UTC)',
  'Request-to-receipt minutes',
];
const params = (input) =>
  input instanceof URLSearchParams ? input : new URLSearchParams(input || {});
const clause = (conditions) => (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '');
const like = (value) => '%' + value.replace(/[\\%_]/g, '\\$&') + '%';
const round = (value) => Math.round(value * 100) / 100;
const hours = (value) => (value === null ? null : round(value / 3600000));
const iso = (value) =>
  value === null || value === undefined || value === 0 ? '' : new Date(value).toISOString();
const day = (value) => new Date(value).toISOString().slice(0, 10);
const physicalArrival = (movement) =>
  movement.direct_complete ? (movement.occurred ?? movement.received) : movement.received;
const receiptSample = (movement) =>
  !movement.direct_complete && movement.received !== null && movement.received >= movement.created;
const overdue = (trolley, now) =>
  trolley.expected > 0 &&
  trolley.expected < now &&
  !['Available', 'Maintenance'].includes(trolley.status);
const status = (trolley, now) => (overdue(trolley, now) ? 'Overdue' : trolley.status);
const chart = (rows, label, value, extra = {}) => ({
  labels: rows.map((row) => row[label]),
  data: rows.map((row) => row[value]),
  rows,
  ...extra,
});

function positive(value, label, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) fail(400, `Invalid ${label}`);
  return number;
}
function timestamp(value, label, end = false) {
  if (value === null || value === undefined || value === '') return null;
  const number = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 8640000000000000)
    fail(400, `Invalid ${label}`);
  return number + (end && /^\d{4}-\d{2}-\d{2}$/.test(value) ? DAY - 1 : 0);
}
function range(query, defaults = {}) {
  const from =
    timestamp(query.get('from') || query.get('dateFrom'), 'start time') ?? defaults.from ?? null;
  const to =
    timestamp(query.get('to') || query.get('dateTo'), 'end time', true) ?? defaults.to ?? null;
  if (from !== null && to !== null && from > to) fail(400, 'Start time must not exceed end time');
  return { from, to };
}
function movementFilters(query, dates = range(query)) {
  const conditions = [],
    values = [];
  const add = (sql, ...args) => {
    conditions.push(sql);
    values.push(...args);
  };
  if (dates.from !== null) add(`${EVENT} >= ?`, dates.from);
  if (dates.to !== null) add(`${EVENT} <= ?`, dates.to);
  for (const [key, field] of [
    ['trolley', 'm.trolley'],
    ['product', 'm.product'],
    ['type', 'm.movement_type'],
    ['department', 'm.department'],
  ])
    if (query.get(key)) add(`${field} = ?`, query.get(key));
  if (query.get('location'))
    add('(m.source = ? OR m.destination = ?)', query.get('location'), query.get('location'));
  const requestedStatus = query.get('status');
  if (requestedStatus === 'Correction Requested')
    add("m.state = 'Rejected' AND m.correction_reason <> ''");
  else if (requestedStatus === 'Rejected') add("m.state = 'Rejected' AND m.correction_reason = ''");
  else if (requestedStatus) {
    const normalized =
      { Completed: 'Received', 'Pending Approval': 'Pending' }[requestedStatus] || requestedStatus;
    add('(m.state = ? OR m.status_after = ?)', normalized, normalized);
  }
  const operator = query.get('operator');
  if (operator) {
    if (/^\d+$/.test(operator)) add('COALESCE(m.operator_id,m.requested_by) = ?', Number(operator));
    else
      add(
        "(op.name LIKE ? ESCAPE '\\' OR op.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')",
        like(operator),
        like(operator),
        like(operator),
      );
  }
  const search = query.get('search') || query.get('q');
  if (search) {
    const fields = [
      'm.trolley',
      'm.source',
      'm.destination',
      's.name',
      'd.name',
      'p.name',
      'm.product',
      'm.batch',
      'op.name',
      'u.name',
      'm.movement_type',
      'm.state',
      'm.reason',
      'm.remarks',
    ];
    add(
      '(' + fields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ') + ')',
      ...fields.map(() => like(search)),
    );
  }
  return { conditions, values };
}
function fleetFilters(query) {
  const conditions = ['t.active = 1'],
    values = [];
  for (const [key, field] of [
    ['trolley', 't.id'],
    ['location', 't.location'],
    ['product', 't.product'],
    ['department', 't.department'],
    ['group', 'l.group_name'],
    ['trolleyType', 't.type'],
  ]) {
    if (query.get(key)) {
      conditions.push(`${field} = ?`);
      values.push(query.get(key));
    }
  }
  const operator = query.get('operator');
  if (operator) {
    conditions.push(/^\d+$/.test(operator) ? 't.operator_id = ?' : "u.name LIKE ? ESCAPE '\\'");
    values.push(/^\d+$/.test(operator) ? Number(operator) : like(operator));
  }
  const search = query.get('search') || query.get('q');
  if (search) {
    const fields = ['t.id', 't.type', 't.batch', 't.department', 'l.name', 'p.name', 'u.name'];
    conditions.push('(' + fields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
    values.push(...fields.map(() => like(search)));
  }
  return { conditions, values };
}
function movementRow(m) {
  return [
    m.id,
    iso(m.occurred ?? m.created),
    m.trolley,
    m.source_name || m.source,
    m.destination_name || m.destination,
    m.product_name || m.product || 'Empty',
    m.batch,
    m.qty,
    m.operator_name || '',
    m.movement_type,
    m.correction_reason ? 'Correction Requested' : m.state,
    m.department,
    m.reason,
    m.remarks,
    iso(m.expected),
    iso(m.received),
    receiptSample(m) ? round((m.received - m.created) / 60000) : '',
  ];
}

export function reportService(repository) {
  const movements = (query, dates) => {
    const f = movementFilters(query, dates);
    return repository.all(
      `${MOVEMENTS}${clause(f.conditions)} ORDER BY ${EVENT} DESC,m.id DESC`,
      ...f.values,
    );
  };
  const fleet = (query, now) => {
    const f = fleetFilters(query);
    return repository
      .all(`${FLEET}${clause(f.conditions)} ORDER BY t.id`, ...f.values)
      .filter((t) => !query.get('status') || status(t, now) === query.get('status'));
  };
  return {
    historyReport(user, input) {
      requireRole(user, USER_ROLES);
      const query = params(input);
      const dates = range(query);
      const rows = movements(query, dates).map(movementRow);
      return {
        type: 'history',
        title: 'Trolley movement history',
        columns: MOVEMENT_COLUMNS,
        rows,
        total: rows.length,
        page: 1,
        pageSize: rows.length,
        nextPage: null,
        generatedAt: Date.now(),
        timezone: 'UTC',
        ...dates,
        metric:
          'Recorded movement events; request-to-receipt duration includes approval wait and excludes direct entries without a separate receipt workflow.',
      };
    },
    history(user, kind, input) {
      const query = params(input),
        limit = positive(query.get('limit'), 'limit', 50, 100),
        cursor = positive(query.get('before'), 'cursor', null),
        page = positive(query.get('page'), 'page', 1);
      let select, filters, alias;
      if (kind === 'audit') {
        requireRole(user, APPROVER_ROLES);
        alias = 'a';
        select = 'SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON a.actor=u.id';
        const dates = range(query);
        filters = { conditions: [], values: [] };
        for (const [value, sql] of [
          [dates.from, 'a.ts >= ?'],
          [dates.to, 'a.ts <= ?'],
          [query.get('trolley'), 'a.entity = ?'],
          [query.get('operator'), 'a.actor = ?'],
          [query.get('type'), 'a.action = ?'],
        ])
          if (value !== null && value !== '') {
            filters.conditions.push(sql);
            filters.values.push(value);
          }
        const search = query.get('search') || query.get('q');
        if (search) {
          filters.conditions.push(
            "(a.entity LIKE ? ESCAPE '\\' OR a.action LIKE ? ESCAPE '\\' OR a.detail LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')",
          );
          filters.values.push(...Array(4).fill(like(search)));
        }
      } else if (kind === 'movements') {
        alias = 'm';
        select = MOVEMENTS;
        filters = movementFilters(query);
      } else fail(400, 'Unknown history type');
      const from = select.slice(select.indexOf(' FROM '));
      const total = repository.get(
        `SELECT COUNT(*) AS count${from}${clause(filters.conditions)}`,
        ...filters.values,
      ).count;
      if (cursor) {
        filters.conditions.push(`${alias}.id < ?`);
        filters.values.push(cursor);
      }
      const rows = repository.all(
        `${select}${clause(filters.conditions)} ORDER BY ${alias}.id DESC LIMIT ? OFFSET ?`,
        ...filters.values,
        limit + 1,
        cursor ? 0 : (page - 1) * limit,
      );
      const more = rows.length > limit,
        items = rows.slice(0, limit);
      return {
        items,
        total,
        page,
        limit,
        nextCursor: more ? items.at(-1).id : null,
        nextPage: more ? page + 1 : null,
      };
    },
    summary(user, input) {
      const query = params(input),
        now = Date.now(),
        dates = range(query, { from: now - 30 * DAY, to: now });
      requirePermission(user, 'reports');
      const records = movements(query, dates),
        receipts = records.filter(receiptSample),
        daily = new Map();
      for (const m of records) {
        const date = day(m.occurred ?? m.created);
        daily.set(date, (daily.get(date) || 0) + 1);
      }
      return {
        ...dates,
        totals: {
          requested: records.length,
          received: records.filter((m) => m.state === 'Received').length,
          rejected: records.filter((m) => m.state === 'Rejected').length,
          mean_receipt_ms: receipts.length
            ? receipts.reduce((sum, m) => sum + m.received - m.created, 0) / receipts.length
            : null,
        },
        daily: [...daily]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ day: date, count })),
        timezone: 'UTC',
        metric:
          'Request-to-receipt duration including approval wait; excludes direct entries without a separate receipt workflow.',
      };
    },
    build(user, requestedType, input) {
      requirePermission(user, 'reports');
      const type = ALIASES[requestedType] || requestedType,
        query = params(input),
        now = Date.now();
      const dates = range(
        query,
        type === 'daily' ? { from: Math.floor(now / DAY) * DAY, to: now } : {},
      );
      const trolleys = ['utilization', 'location', 'product', 'overdue', 'outside'].includes(type)
        ? fleet(query, now)
        : [];
      let title,
        columns,
        rows,
        metric = 'Current fleet snapshot; date filters apply to movement and exception reports.';
      if (type === 'daily' || type === 'history') {
        title = type === 'daily' ? 'Daily trolley movement report' : 'Trolley movement history';
        columns = MOVEMENT_COLUMNS;
        rows = movements(query, dates).map(movementRow);
        if (type === 'daily') rows.reverse();
        metric =
          'Recorded movement events; request-to-receipt duration includes approval wait and excludes direct entries without a separate receipt workflow.';
      } else if (type === 'utilization') {
        title = 'Trolley utilization report';
        columns = [
          'Trolley type',
          'Total',
          'Available',
          'In Use',
          'In Transit / Waiting',
          'Maintenance',
          'Outside Plant',
          'Overdue',
          'Utilization %',
        ];
        rows = [...new Set(trolleys.map((t) => t.type))].sort().map((type) => {
          const group = trolleys.filter((t) => t.type === type),
            count = (states) => group.filter((t) => states.includes(status(t, now))).length;
          const available = count(['Available']),
            maintenance = count(['Maintenance']);
          return [
            type,
            group.length,
            available,
            count(['In Use']),
            count(['In Transit', 'Waiting']),
            maintenance,
            count(['Outside Plant']),
            count(['Overdue']),
            round(((group.length - available - maintenance) / group.length) * 100),
          ];
        });
        metric =
          'Current utilization: active trolleys other than Available or Maintenance / active fleet.';
      } else if (type === 'location') {
        title = 'Location-wise trolley report';
        columns = [
          'Location code',
          'Location',
          'Group',
          'Department',
          'Trolleys',
          'Material quantity',
          'Capacity',
          'Bay usage %',
          'Longest stay hours',
        ];
        rows = repository
          .all('SELECT * FROM locations ORDER BY id')
          .filter((l) => !query.get('location') || query.get('location') === l.id)
          .map((l) => {
            const group = trolleys.filter((t) => t.location === l.id),
              starts = group.map((t) => t.since || t.last_moved || t.created).filter((v) => v > 0);
            return [
              l.id,
              l.name,
              l.group_name,
              l.department,
              group.length,
              group.reduce((sum, t) => sum + t.qty, 0),
              l.capacity || '',
              l.capacity ? round((group.length / l.capacity) * 100) : '',
              starts.length ? hours(now - Math.min(...starts)) : '',
            ];
          });
        metric = 'Current location snapshot. Material quantities may use different product units.';
      } else if (type === 'product') {
        title = 'Product-wise trolley report';
        columns = [
          'Product code',
          'Product',
          'Category',
          'Batch',
          'Unit',
          'Trolleys',
          'Quantity',
          'Locations',
        ];
        const groups = new Map(),
          products = new Map(repository.all('SELECT * FROM products').map((p) => [p.id, p]));
        for (const t of trolleys.filter((t) => t.product)) {
          const key = JSON.stringify([t.product, t.batch]);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(t);
        }
        rows = [...groups.values()]
          .map((group) => {
            const p = products.get(group[0].product);
            return [
              p.id,
              p.name,
              p.category,
              group[0].batch,
              p.unit,
              group.length,
              group.reduce((sum, t) => sum + t.qty, 0),
              [...new Set(group.map((t) => t.location_name || t.location))].sort().join(', '),
            ];
          })
          .sort(
            (a, b) =>
              String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3])),
          );
      } else if (type === 'overdue') {
        title = 'Overdue trolley report';
        columns = [
          'Trolley ID',
          'Location',
          'Expected return (UTC)',
          'Stay hours',
          'Delay hours',
          'Department',
          'Assigned person',
        ];
        rows = trolleys
          .filter((t) => overdue(t, now))
          .sort((a, b) => a.expected - b.expected)
          .map((t) => [
            t.id,
            t.location_name || t.location,
            iso(t.expected),
            t.since ? hours(now - t.since) : '',
            hours(now - t.expected),
            t.department,
            t.operator_name || '',
          ]);
      } else if (type === 'outside') {
        title = 'Outside plant trolley report';
        columns = [
          'Trolley ID',
          'Location',
          'Product',
          'Quantity',
          'Unit',
          'Out since (UTC)',
          'Hours outside',
          'Expected return (UTC)',
          'Approved by',
        ];
        rows = trolleys
          .filter((t) => t.external)
          .map((t) => {
            const a = repository.get(
              "SELECT u.name FROM movements m LEFT JOIN users u ON u.id=m.approved_by WHERE m.trolley=? AND m.destination=? AND m.state='Received' ORDER BY m.received DESC,m.id DESC LIMIT 1",
              t.id,
              t.location,
            );
            return [
              t.id,
              t.location_name || t.location,
              t.product_name || 'Empty',
              t.qty,
              t.unit,
              iso(t.since),
              t.since ? hours(now - t.since) : '',
              iso(t.expected),
              a?.name || '',
            ];
          });
      } else if (type === 'exceptions') {
        title = 'Movement exception report';
        columns = [
          'Source',
          'Raised (UTC)',
          'Trolley ID',
          'Location / destination',
          'Type',
          'Priority',
          'Status',
          'Detail',
          'Decision reason',
          'Operator',
        ];
        rows = movements(query, dates)
          .filter((m) => m.policy_flags !== '[]' || m.exception_reason || m.state === 'Rejected')
          .map((m) => [
            `Movement ${m.id}`,
            iso(m.occurred ?? m.created),
            m.trolley,
            m.destination_name || m.destination,
            m.movement_type,
            '',
            m.state,
            [m.policy_flags, m.exception_reason].filter(Boolean).join(' '),
            m.decision_reason,
            m.operator_name,
          ]);
        const conditions = [
            "a.type IN ('Wrong location','Wrong product','Wrong trolley','Unauthorized movement','Trolley missing','Movement not completed','Policy mismatch')",
          ],
          values = [];
        for (const [value, sql] of [
          [dates.from, 'a.created >= ?'],
          [dates.to, 'a.created <= ?'],
          [query.get('trolley'), 'a.trolley = ?'],
          [query.get('location'), 'a.location = ?'],
          [query.get('status'), 'a.status = ?'],
        ])
          if (value !== null && value !== '') {
            conditions.push(sql);
            values.push(value);
          }
        const search = query.get('search') || query.get('q');
        if (search) {
          conditions.push(
            "(a.message LIKE ? ESCAPE '\\' OR a.type LIKE ? ESCAPE '\\' OR a.trolley LIKE ? ESCAPE '\\')",
          );
          values.push(...Array(3).fill(like(search)));
        }
        if (!query.get('product') && !query.get('operator') && !query.get('department')) {
          const alerts = repository.all(
            `SELECT a.*,l.name AS location_name FROM alerts a LEFT JOIN locations l ON l.id=a.location${clause(conditions)} ORDER BY a.created DESC,a.id DESC`,
            ...values,
          );
          rows.push(
            ...alerts.map((a) => [
              `Alert ${a.id}`,
              iso(a.created),
              a.trolley,
              a.location_name || a.location,
              a.type,
              a.priority,
              a.status,
              a.message,
              '',
              '',
            ]),
          );
        }
        rows.sort((a, b) => String(b[1]).localeCompare(String(a[1])));
        metric = 'Recorded policy exceptions, rejected movements and operational exception alerts.';
      } else fail(404, 'Unknown report type');
      const total = rows.length,
        paginate = query.has('page') || query.has('limit'),
        page = positive(query.get('page'), 'page', 1),
        pageSize = paginate ? positive(query.get('limit'), 'limit', 50, 200) : total;
      if (paginate) rows = rows.slice((page - 1) * pageSize, page * pageSize);
      return {
        type,
        title,
        columns,
        rows,
        total,
        page,
        pageSize,
        nextPage: paginate && page * pageSize < total ? page + 1 : null,
        generatedAt: now,
        timezone: 'UTC',
        ...dates,
        metric,
      };
    },
    analytics(user, input) {
      requirePermission(user, 'reports');
      const query = params(input),
        now = Date.now(),
        dates = range(query, { from: Math.floor(now / DAY) * DAY - 13 * DAY, to: now });
      if (dates.to - dates.from > 3660 * DAY)
        fail(400, 'Analytics date range must not exceed 3660 days');
      const records = movements(query, dates),
        trolleys = fleet(query, now),
        locations = repository.all('SELECT * FROM locations ORDER BY id');
      const utilization = [
        'Available',
        'In Use',
        'In Transit',
        'Waiting',
        'Maintenance',
        'Overdue',
        'Outside Plant',
      ].map((name) => ({
        status: name,
        count: trolleys.filter((t) => status(t, now) === name).length,
      }));
      const locationDates = ['from', 'to', 'dateFrom', 'dateTo'].some((key) => query.has(key))
        ? dates
        : { from: now - DAY, to: now };
      const arrivalRecords = movements(query, { from: null, to: null });
      const byLocation = locations.map((l) => ({
        id: l.id,
        location: l.name,
        arrivals: arrivalRecords.filter(
          (m) =>
            m.destination === l.id &&
            m.state === 'Received' &&
            physicalArrival(m) >= locationDates.from &&
            physicalArrival(m) <= locationDates.to,
        ).length,
        departures: arrivalRecords.filter(
          (m) =>
            m.source === l.id &&
            !['Pending', 'Rejected'].includes(m.state) &&
            (m.decided_at ?? m.occurred ?? m.created) >= locationDates.from &&
            (m.decided_at ?? m.occurred ?? m.created) <= locationDates.to,
        ).length,
      }));
      const dailyMap = new Map(),
        usage = new Map();
      for (const m of records) {
        const date = day(m.occurred ?? m.created);
        if (!dailyMap.has(date))
          dailyMap.set(date, { day: date, requested: 0, received: 0, rejected: 0 });
        const entry = dailyMap.get(date);
        entry.requested++;
        if (m.state === 'Received') entry.received++;
        if (m.state === 'Rejected') entry.rejected++;
        if (!['Pending', 'Rejected'].includes(m.state))
          usage.set(m.trolley, (usage.get(m.trolley) || 0) + 1);
      }
      const daily = [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day));
      const top = [...usage]
        .map(([trolley, count]) => ({ trolley, count }))
        .sort((a, b) => b.count - a.count || a.trolley.localeCompare(b.trolley))
        .slice(0, 10);
      const allQuery = new URLSearchParams(query);
      for (const key of ['from', 'to', 'dateFrom', 'dateTo', 'location', 'type', 'status'])
        allQuery.delete(key);
      const completed = movements(allQuery, { from: null, to: dates.to })
        .filter((m) => m.state === 'Received' && m.received !== null)
        .sort((a, b) => (a.occurred ?? a.created) - (b.occurred ?? b.created) || a.id - b.id);
      const issued = new Map(),
        cycles = [];
      for (const m of completed) {
        if (m.movement_type === 'Production Issue') issued.set(m.trolley, m);
        else if (m.movement_type === 'Production Return') {
          const issue = issued.get(m.trolley);
          if (
            issue &&
            m.destination === issue.source &&
            physicalArrival(m) >= (issue.occurred ?? issue.created) &&
            (m.occurred ?? m.created) >= (physicalArrival(issue) ?? issue.occurred ?? issue.created)
          ) {
            if (physicalArrival(m) >= dates.from && physicalArrival(m) <= dates.to)
              cycles.push({
                trolley: m.trolley,
                issueId: issue.id,
                returnId: m.id,
                returned: physicalArrival(m),
                durationMs: physicalArrival(m) - (issue.occurred ?? issue.created),
              });
            issued.delete(m.trolley);
          }
        }
      }
      const turnMap = new Map();
      for (const cycle of cycles) {
        const date = day(cycle.returned);
        if (!turnMap.has(date)) turnMap.set(date, []);
        turnMap.get(date).push(cycle.durationMs);
      }
      const turnaround = [...turnMap]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({
          day: date,
          hours: hours(values.reduce((sum, v) => sum + v, 0) / values.length),
          cycles: values.length,
        }));
      const historical = movements(query, { from: null, to: dates.to }).filter(
          (m) => m.state !== 'Rejected',
        ),
        buckets = new Map();
      const period = query.get('period') || query.get('overduePeriod') || 'day';
      if (!['day', 'week'].includes(period)) fail(400, 'Invalid overdue period');
      for (
        let date = Math.floor(dates.from / DAY) * DAY;
        date <= Math.min(dates.to, now);
        date += DAY
      ) {
        const snapshot = Math.min(date + DAY - 1, dates.to, now);
        if (snapshot < dates.from) continue;
        const count = new Set(
          historical
            .filter(
              (m) =>
                m.created <= snapshot &&
                m.expected < snapshot &&
                (m.received === null || m.received > snapshot),
            )
            .map((m) => m.trolley),
        ).size;
        let label = day(date);
        if (period === 'week') {
          const d = new Date(date);
          d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
          label = day(d.valueOf());
        }
        buckets.set(label, count);
      }
      const trend = [...buckets].map(([date, count]) => ({ day: date, count }));
      const distribution = locations.map((l) => ({
          id: l.id,
          location: l.name,
          count: trolleys.filter((t) => t.location === l.id).length,
        })),
        receipts = records.filter(receiptSample);
      return {
        ...dates,
        generatedAt: now,
        timezone: 'UTC',
        charts: {
          utilization: chart(utilization, 'status', 'count', {
            metric: 'Current active fleet by effective status',
          }),
          locationMovements: chart(byLocation, 'location', 'arrivals', {
            ...locationDates,
            metric:
              'Physical event times for direct arrivals, receipt timestamps for transit arrivals; authorization/event times for departures. Default period: last 24 hours.',
            series: [
              { name: 'Arrivals', data: byLocation.map((r) => r.arrivals) },
              { name: 'Departures', data: byLocation.map((r) => r.departures) },
            ],
          }),
          dailyMovements: chart(daily, 'day', 'requested', {
            metric: 'Requests by recorded date, including pending and rejected requests',
          }),
          topUsage: chart(top, 'trolley', 'count', {
            metric: 'Authorized movements, excluding pending and rejected requests',
          }),
          turnaround: chart(turnaround, 'day', 'hours', {
            metric:
              'Production Issue event to matching Production Return at original source; direct entries use physical event times and transit entries use receipt times',
            cycles,
          }),
          overdueTrend: chart(trend, 'day', 'count', {
            period,
            metric:
              period === 'week'
                ? 'Distinct overdue movement trolleys on the last observed day of each UTC week'
                : 'Distinct overdue unreceived movement trolleys at UTC day end',
            limitation:
              'Uses recorded expected/receipt timestamps; unrecorded historical stays cannot be reconstructed.',
          }),
          locationDistribution: chart(distribution, 'location', 'count', {
            metric: 'Current active fleet by location',
          }),
        },
        metrics: {
          completedRoundTrips: cycles.length,
          averageRoundTripHours: cycles.length
            ? hours(cycles.reduce((sum, c) => sum + c.durationMs, 0) / cycles.length)
            : null,
          meanRequestToReceiptHours: receipts.length
            ? hours(receipts.reduce((sum, m) => sum + m.received - m.created, 0) / receipts.length)
            : null,
        },
        note: 'History uses recorded movement events. Fleet charts are current snapshots. No simulated data.',
      };
    },
  };
}
