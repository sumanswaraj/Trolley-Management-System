import { randomUUID } from 'node:crypto';
import { fail } from '../errors.mjs';
import { requiredText, finiteNumber, integer } from '../validation.mjs';
import { requireRole } from '../security.mjs';

export const MOVEMENT_TYPES = Object.freeze([
  'Transfer',
  'Production Issue',
  'Production Return',
  'Quality Inspection',
  'Quality Release',
  'Packing',
  'Dispatch',
  'Store Transfer',
  'Maintenance',
  'Outside Plant',
]);
const MOVERS = ['Admin', 'Supervisor', 'Operator', 'Quality User', 'Store User'];
const APPROVERS = ['Admin', 'Supervisor', 'Plant Manager'];
const RESTRICTED_TYPES = {
  'Quality User': ['Quality Inspection', 'Quality Release', 'Transfer'],
  'Store User': ['Production Issue', 'Production Return', 'Store Transfer', 'Transfer'],
};
const STATUSES = ['auto', 'Available', 'In Use', 'Waiting', 'Maintenance', 'Outside Plant'];
const MINUTE = 60000;
const flagAlertType = (flag) =>
  /trolley type|category is/.test(flag)
    ? 'Wrong trolley'
    : /batch|load/.test(flag)
      ? 'Wrong product'
      : 'Wrong location';

export function optionalText(value, label, maximum = 500) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > maximum) fail(400, `Invalid ${label}`);
  return value.trim();
}

export function locationGroup(location) {
  if (location.external) return 'Outside Plant';
  if (location.group_name) return location.group_name;
  const name = `${location.id} ${location.name}`.toLowerCase();
  for (const [pattern, group] of [
    [/quality|inspection/, 'Quality'],
    [/maint/, 'Maintenance'],
    [/assembly|assy/, 'Assembly'],
    [/pack/, 'Packing'],
    [/dispatch/, 'Dispatch'],
    [/finished|\bfg\b/, 'Finished Goods'],
    [/store/, 'Store'],
  ])
    if (pattern.test(name)) return group;
  return 'Production';
}

export function arrivalStatus(location, quantity, requested = 'auto') {
  requested ||= 'auto';
  const group = locationGroup(location);
  if (location.external) return 'Outside Plant';
  if (group === 'Maintenance') return 'Maintenance';
  if (requested !== 'auto') return requested;
  return quantity > 0 ? (group === 'Quality' ? 'Waiting' : 'In Use') : 'Available';
}

export function expectedAt(location, status, timestamp) {
  if (status === 'Available' || status === 'Inactive') return null;
  const defaults = {
    Production: 240,
    Assembly: 180,
    Quality: 90,
    Packing: 120,
    Dispatch: 60,
    Maintenance: 480,
    'Outside Plant': 1440,
    Store: 480,
    'Finished Goods': 480,
  };
  return (
    timestamp + (location.expected_minutes || defaults[locationGroup(location)] || 240) * MINUTE
  );
}

export function deliverNotification(repository, text, level = 'info', userId = null) {
  const inserted = repository.run(
    'INSERT INTO notifications(user_id, text, level, created) VALUES (?, ?, ?, ?)',
    userId,
    text,
    level,
    Date.now(),
  );
  return Number(inserted.lastInsertRowid);
}

export function raiseWorkflowAlert(
  repository,
  actor,
  { trolley, location, type, priority = 'Medium', message, source = 'manual' },
) {
  const fingerprint = `${trolley}:${type}`;
  const previous = repository.get('SELECT * FROM alerts WHERE fingerprint = ?', fingerprint);
  if (previous && previous.status !== 'Resolved') {
    repository.run(
      'UPDATE alerts SET priority = ?, message = ?, location = ? WHERE id = ?',
      priority,
      message,
      location,
      previous.id,
    );
    return { ...repository.get('SELECT * FROM alerts WHERE id = ?', previous.id), duplicate: true };
  }
  const now = Date.now();
  let id;
  if (previous) {
    id = previous.id;
    repository.run(
      "UPDATE alerts SET status = 'Open', priority = ?, message = ?, location = ?, created = ?, acknowledged_by = NULL, acknowledged_at = NULL, resolved_by = NULL, resolved_at = NULL, resolution = '', source = ? WHERE id = ?",
      priority,
      message,
      location,
      now,
      source,
      id,
    );
  } else {
    id = Number(
      repository.run(
        'INSERT INTO alerts(trolley, location, type, priority, message, created, fingerprint, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        trolley,
        location,
        type,
        priority,
        message,
        now,
        fingerprint,
        source,
      ).lastInsertRowid,
    );
  }
  if (actor)
    repository.audit(actor, previous ? 'Alert reopened' : 'Alert raised', trolley, {
      alert: id,
      type,
      priority,
    });
  deliverNotification(
    repository,
    `${type}: ${trolley} — ${message}`,
    ['Critical', 'High'].includes(priority) ? 'danger' : 'warn',
  );
  return { ...repository.get('SELECT * FROM alerts WHERE id = ?', id), duplicate: false };
}

export function resolveWorkflowAlerts(repository, actor, trolley, types) {
  for (const alert of repository.all(
    "SELECT * FROM alerts WHERE trolley = ? AND status <> 'Resolved'",
    trolley,
  )) {
    if (!types.includes(alert.type)) continue;
    repository.run(
      "UPDATE alerts SET status = 'Resolved', resolved_by = ?, resolved_at = ? WHERE id = ?",
      actor?.id || null,
      Date.now(),
      alert.id,
    );
    if (actor)
      repository.audit(actor, 'Alert resolved by movement', trolley, {
        alert: alert.id,
        type: alert.type,
      });
  }
}

function operatorFor(repository, user, supplied) {
  const id = supplied == null || supplied === '' ? user.id : integer(supplied, 'operator ID');
  if (!repository.get('SELECT id FROM users WHERE id = ? AND active = 1', id))
    fail(400, 'Unknown or inactive operator');
  return id;
}

function hasExplicitDeadline(movement) {
  const payload = JSON.parse(movement.payload);
  return payload.explicitExpected ?? typeof payload.expected === 'number';
}

function completeArrival(repository, actor, movement, trolley, timestamp, receiver) {
  const location = repository.get('SELECT * FROM locations WHERE id = ?', movement.destination);
  const status = arrivalStatus(location, movement.qty, movement.status_after);
  const expected =
    status === 'Available'
      ? null
      : hasExplicitDeadline(movement)
        ? movement.expected
        : expectedAt(location, status, timestamp);
  repository.run(
    'UPDATE trolleys SET previous_location = ?, location = ?, status = ?, product = ?, batch = ?, qty = ?, last_moved = ?, since = ?, expected = ?, operator_id = ?, uses = uses + 1, version = version + 1, flags = ? WHERE id = ?',
    trolley.location,
    movement.destination,
    status,
    movement.product,
    movement.batch,
    movement.qty,
    timestamp,
    timestamp,
    expected,
    receiver,
    movement.qty > 0 ? trolley.flags : '[]',
    trolley.id,
  );
  repository.run(
    "UPDATE movements SET state = 'Received', received = ?, received_by = ? WHERE id = ?",
    Date.now(),
    actor.id,
    movement.id,
  );
  resolveWorkflowAlerts(repository, actor, trolley.id, [
    'Wrong location',
    'Unauthorized movement',
    'Trolley missing',
    'Movement not completed',
    'Trolley overdue',
  ]);
  if (location.external) {
    raiseWorkflowAlert(repository, actor, {
      trolley: trolley.id,
      location: location.id,
      type: 'Outside plant',
      priority: 'Medium',
      message: `Trolley is outside the plant at ${location.name}`,
      source: 'movement',
    });
  } else resolveWorkflowAlerts(repository, actor, trolley.id, ['Outside plant']);
  repository.audit(actor, 'Location changed', trolley.id, {
    previous: trolley.location,
    current: movement.destination,
    movement: movement.id,
  });
}

export function movementService(repository, policies) {
  return {
    request(user, input) {
      requireRole(user, MOVERS);
      const trolley = requiredText(input.trolley, 'trolley');
      const destination = requiredText(input.destination || input.to, 'destination');
      const key = requiredText(input.key || randomUUID(), 'request key', 100);
      const quantity = finiteNumber(input.qty, 'quantity');
      const version = input.version == null ? null : integer(input.version, 'version');
      const explicitExpected = input.expected != null && input.expected !== '';
      const suppliedExpected = explicitExpected
        ? integer(input.expected, 'expected return time')
        : null;
      const product = input.product ? requiredText(input.product, 'product') : null;
      const batch = optionalText(input.batch, 'batch', 120);
      if (quantity > 0 && (!product || !batch)) fail(400, 'A load requires a product and batch');
      if (quantity === 0 && product) fail(400, 'Select Empty trolley when quantity is zero');
      const exceptionReason = optionalText(input.exceptionReason, 'exception reason');
      const reason = optionalText(input.reason, 'reason');
      const remarks = optionalText(input.remarks, 'remarks', 1000);
      const movementType = requiredText(
        input.movement_type || input.type || 'Transfer',
        'movement type',
      );
      if (!MOVEMENT_TYPES.includes(movementType)) fail(400, 'Unknown movement type');
      if (RESTRICTED_TYPES[user.role] && !RESTRICTED_TYPES[user.role].includes(movementType))
        fail(403, 'Your role cannot record this movement type');
      const source = optionalText(input.source || input.from, 'source');
      const department = optionalText(input.department || input.dept, 'department', 120);
      const statusAfter = input.status_after || input.statusAfter || 'auto';
      if (!STATUSES.includes(statusAfter)) fail(400, 'Invalid status after movement');
      if (input.direct_complete != null && typeof input.direct_complete !== 'boolean')
        fail(400, 'direct_complete must be a boolean');
      if (input.transit != null && typeof input.transit !== 'boolean')
        fail(400, 'transit must be a boolean');
      const directComplete = input.direct_complete === true || input.transit === false;
      let occurred = input.occurred;
      if (typeof occurred === 'string') occurred = Date.parse(occurred);
      if (occurred == null && input.date)
        occurred = Date.parse(`${input.date}T${input.time || '00:00'}`);
      if (occurred != null) integer(occurred, 'movement date and time');
      const operatorId = operatorFor(repository, user, input.operator_id);
      const originApproval =
        input.originApproval == null ? null : integer(input.originApproval, 'original approval ID');
      const payload = JSON.stringify({
        trolley,
        destination,
        quantity,
        version,
        expected: suppliedExpected,
        explicitExpected,
        product,
        batch,
        exceptionReason,
        reason,
        remarks,
        movementType,
        source,
        department,
        statusAfter,
        directComplete,
        occurred: occurred || null,
        operatorId,
        user: user.id,
        originApproval,
      });
      return repository.transaction(() => {
        const previous = repository.get('SELECT * FROM movements WHERE key = ?', key);
        if (previous) {
          if (previous.payload !== payload)
            fail(409, 'Request key already used with different data');
          return previous;
        }
        const now = Date.now();
        if (occurred && occurred > now) fail(400, 'Movement date cannot be in the future');
        if (explicitExpected && suppliedExpected <= now)
          fail(400, 'Expected time must be in the future');
        const current = repository.get(
          'SELECT * FROM trolleys WHERE id = ? AND active = 1',
          trolley,
        );
        const location = repository.get('SELECT * FROM locations WHERE id = ?', destination);
        if (!current || !location || location.active === 0)
          fail(400, 'Unknown trolley or destination');
        if (source && !repository.get('SELECT id FROM locations WHERE id = ?', source))
          fail(400, 'Unknown source location');
        if (originApproval) {
          const origin = repository.get(
            'SELECT * FROM approval_requests WHERE id = ?',
            originApproval,
          );
          if (!origin || origin.trolley !== trolley || origin.status !== 'Correction Requested')
            fail(400, 'Invalid correction request');
          if (origin.requested_by !== user.id && user.role !== 'Admin')
            fail(403, 'Only the requester can resubmit a correction');
        }
        policies.requireLocation(user, current.location, 'depart');
        if (directComplete) policies.requireLocation(user, destination, 'receive');
        if (version != null && current.version !== version)
          fail(409, 'Trolley changed. Refresh and retry');
        if (current.location === destination) fail(400, 'Choose a different destination');
        if (quantity > current.capacity) fail(400, 'Quantity exceeds trolley capacity');
        const productRecord = product
          ? repository.get('SELECT * FROM products WHERE id = ?', product)
          : null;
        if (product && (!productRecord || productRecord.active === 0)) fail(400, 'Unknown product');
        if (
          repository.get(
            "SELECT id FROM movements WHERE trolley = ? AND state IN ('Pending', 'In Transit')",
            trolley,
          )
        )
          fail(409, 'Trolley already has an open movement');
        if (
          repository.get(
            "SELECT id FROM approval_requests WHERE trolley = ? AND movement_id IS NULL AND status = 'Pending'",
            trolley,
          )
        )
          fail(409, 'Decide the pending product verification exception before moving this trolley');
        const evaluation = policies.evaluate(current, destination, productRecord, quantity, batch);
        if (source && source !== current.location)
          evaluation.flags.push('Declared source differs from the current trolley location');
        const suppliedReason = exceptionReason || reason;
        if (evaluation.flags.length && suppliedReason.length < 10)
          fail(
            400,
            `Policy mismatch: ${evaluation.flags.join('; ')}. Provide a reason of at least 10 characters to request an exception`,
          );
        const settings = policies.settings();
        const pending =
          (location.external && settings.outside_approval !== 0) ||
          (evaluation.flags.length > 0 && settings.mismatch_approval !== 0) ||
          evaluation.requiresQuality;
        const state = pending ? 'Pending' : directComplete ? 'Received' : 'In Transit';
        const timestamp = occurred || now;
        const status = arrivalStatus(location, quantity, statusAfter);
        const expected =
          suppliedExpected ||
          (directComplete
            ? expectedAt(location, status === 'Available' ? 'In Use' : status, timestamp)
            : timestamp + 60 * MINUTE);
        const inserted = repository.run(
          `INSERT INTO movements(trolley, source, destination, product, batch, qty, state, requested_by, created, expected, key, payload, version, policy_flags, exception_reason, requires_quality, movement_type, operator_id, department, occurred, reason, remarks, status_after, direct_complete) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          trolley,
          current.location,
          destination,
          product,
          batch,
          quantity,
          state,
          user.id,
          now,
          expected,
          key,
          payload,
          current.version,
          JSON.stringify(evaluation.flags),
          suppliedReason,
          Number(evaluation.requiresQuality),
          movementType,
          operatorId,
          department || location.department || current.department || '',
          timestamp,
          reason,
          remarks,
          statusAfter,
          Number(directComplete),
        );
        const movement = repository.get(
          'SELECT * FROM movements WHERE id = ?',
          inserted.lastInsertRowid,
        );
        if (pending) {
          const kind = evaluation.flags.length
            ? 'Movement exception'
            : evaluation.requiresQuality
              ? 'Quality release'
              : 'Outside plant movement';
          repository.run(
            'INSERT INTO approval_requests(movement_id, kind, trolley, product, requested_by, created, remarks, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            movement.id,
            kind,
            trolley,
            product,
            user.id,
            now,
            remarks || reason || suppliedReason,
            JSON.stringify({
              input: {
                trolley,
                destination,
                qty: quantity,
                product,
                batch,
                version,
                expected: suppliedExpected,
                exceptionReason,
                key,
                movement_type: movementType,
                source,
                operator_id: operatorId,
                department,
                occurred,
                reason,
                remarks,
                status_after: statusAfter,
                direct_complete: directComplete,
                originApproval,
              },
              issues: evaluation.flags,
              originApproval,
            }),
          );
          deliverNotification(
            repository,
            `Approval needed: ${trolley} from ${current.location} to ${destination}`,
            'warn',
          );
        } else if (directComplete)
          completeArrival(repository, user, movement, current, timestamp, operatorId);
        else
          repository.run(
            "UPDATE trolleys SET status = 'In Transit', product = ?, batch = ?, qty = ?, operator_id = ?, last_moved = ?, since = ?, expected = ?, version = version + 1 WHERE id = ?",
            product,
            batch,
            quantity,
            operatorId,
            timestamp,
            timestamp,
            expected,
            trolley,
          );
        for (const flag of evaluation.flags) {
          const type = flagAlertType(flag);
          raiseWorkflowAlert(repository, user, {
            trolley,
            location: current.location,
            type,
            priority: type === 'Wrong product' ? 'Critical' : 'High',
            message: flag,
            source: 'movement',
          });
        }
        repository.audit(user, 'Movement requested', trolley, {
          destination,
          status: state,
          movement: movement.id,
          direct_complete: directComplete,
        });
        return repository.get('SELECT * FROM movements WHERE id = ?', movement.id);
      });
    },
    transition(user, id, action, input = {}) {
      return repository.transaction(() => {
        const movement = repository.get(
          'SELECT * FROM movements WHERE id = ?',
          integer(id, 'movement ID'),
        );
        if (!movement) fail(404, 'Movement not found');
        const trolley = repository.get('SELECT * FROM trolleys WHERE id = ?', movement.trolley);
        if (action === 'receive') {
          requireRole(user, MOVERS);
          policies.requireLocation(user, movement.destination, 'receive');
          if (movement.state !== 'In Transit')
            fail(409, 'Only an in-transit movement can be received');
          if (trolley.version !== movement.version + 1) fail(409, 'Trolley state changed');
          completeArrival(
            repository,
            user,
            movement,
            trolley,
            Date.now(),
            operatorFor(repository, user, input.operator_id),
          );
          deliverNotification(
            repository,
            `${movement.trolley} received at ${movement.destination}`,
            'info',
            movement.requested_by,
          );
        } else if (['approve', 'reject', 'correct'].includes(action)) {
          const flags = JSON.parse(movement.policy_flags);
          const destination = repository.get(
            'SELECT * FROM locations WHERE id = ?',
            movement.destination,
          );
          const allowedRoles = movement.requires_quality
            ? flags.length || destination.external
              ? ['Admin']
              : ['Admin', 'Quality User']
            : APPROVERS;
          requireRole(user, allowedRoles);
          policies.requireLocation(user, movement.destination, 'receive');
          const decisionReason = optionalText(input.reason ?? input.remarks, 'decision reason');
          if (action === 'approve' && flags.length && decisionReason.length < 10)
            fail(400, 'Approving a policy exception requires a reason of 10 to 500 characters');
          if (action === 'correct' && !decisionReason) fail(400, 'Explain the correction required');
          if (movement.requested_by === user.id)
            fail(403, 'Another authorized user must approve or reject your request');
          if (movement.state !== 'Pending') fail(409, 'Request already decided');
          if (trolley.version !== movement.version) fail(409, 'Trolley state changed');
          const now = Date.now();
          const next =
            action === 'approve'
              ? movement.direct_complete
                ? 'Received'
                : 'In Transit'
              : 'Rejected';
          repository.run(
            'UPDATE movements SET state = ?, approved_by = ?, decision_reason = ?, decided_at = ?, correction_reason = ? WHERE id = ?',
            next,
            user.id,
            decisionReason,
            now,
            action === 'correct' ? decisionReason : '',
            movement.id,
          );
          repository.run(
            "UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE movement_id = ? AND status = 'Pending'",
            action === 'approve'
              ? 'Approved'
              : action === 'correct'
                ? 'Correction Requested'
                : 'Rejected',
            user.id,
            now,
            decisionReason,
            movement.id,
          );
          if (action === 'approve') {
            if (movement.direct_complete)
              completeArrival(
                repository,
                user,
                movement,
                trolley,
                now,
                movement.operator_id || movement.requested_by,
              );
            else
              repository.run(
                "UPDATE trolleys SET status = 'In Transit', product = ?, batch = ?, qty = ?, operator_id = ?, since = ?, last_moved = ?, expected = ?, version = version + 1 WHERE id = ?",
                movement.product,
                movement.batch,
                movement.qty,
                movement.operator_id || movement.requested_by,
                now,
                now,
                hasExplicitDeadline(movement) ? movement.expected : now + 60 * MINUTE,
                movement.trolley,
              );
            resolveWorkflowAlerts(repository, user, movement.trolley, flags.map(flagAlertType));
          }
          deliverNotification(
            repository,
            `${movement.trolley}: movement ${action === 'correct' ? 'needs correction' : action === 'approve' ? 'approved' : 'rejected'}${decisionReason ? ` — ${decisionReason}` : ''}`,
            action === 'approve' ? 'info' : 'warn',
            movement.requested_by,
          );
        } else fail(400, 'Unknown movement action');
        repository.audit(user, `Movement ${action}`, movement.trolley, { movement: movement.id });
        return repository.get('SELECT * FROM movements WHERE id = ?', movement.id);
      });
    },
  };
}
