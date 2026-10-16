import { fail } from '../errors.mjs';
import { requiredText, finiteNumber, integer } from '../validation.mjs';
import { requireRole, APPROVER_ROLES } from '../security.mjs';

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
const movementRoles = ['Admin', 'Supervisor', 'Operator', 'Quality User', 'Store User'];
const limitedTypes = {
  'Quality User': ['Quality Inspection', 'Quality Release', 'Transfer'],
  'Store User': ['Production Issue', 'Production Return', 'Store Transfer', 'Transfer'],
};
const statusOptions = ['auto', 'Available', 'In Use', 'Waiting', 'Maintenance', 'Outside Plant'];
const optionalText = (value, label, maximum = 120) =>
  value === undefined || value === '' ? '' : requiredText(value, label, maximum);

export function movementService(repository, policies) {
  const record = (id) =>
    repository.get(
      `SELECT m.*, u.name AS requester, a.name AS approver_name, r.name AS receiver_name,
    c.reason AS correction_reason,
    c.created AS correction_requested_at, CASE WHEN c.movement IS NOT NULL THEN 'Correction Requested'
    WHEN m.state = 'Rejected' THEN 'Rejected' WHEN m.approved_by IS NOT NULL THEN 'Approved' ELSE '' END AS decision
    , CASE WHEN c.movement IS NOT NULL THEN 'Correction Requested' WHEN m.state = 'Pending' THEN 'Pending Approval'
    WHEN m.state = 'Received' THEN 'Completed' ELSE m.state END AS display_status
    FROM movements m JOIN users u ON u.id = m.requested_by LEFT JOIN users a ON a.id = m.approved_by
    LEFT JOIN users r ON r.id = m.received_by LEFT JOIN correction_requests c ON c.movement = m.id WHERE m.id = ?`,
      id,
    );
  const statusFor = (movement, location) => {
    if (movement.status_after !== 'auto') return movement.status_after;
    if (location.external) return 'Outside Plant';
    if (location.group_name === 'Maintenance' || movement.movement_type === 'Maintenance')
      return 'Maintenance';
    if (movement.qty === 0) return 'Available';
    return location.group_name === 'Quality' ? 'Waiting' : 'In Use';
  };
  const receive = (movement, actor, now) => {
    const location = repository.get('SELECT * FROM locations WHERE id = ?', movement.destination);
    if (!location?.active) fail(409, 'Destination is inactive');
    repository.run(
      "UPDATE movements SET state = 'Received', received = ?, received_by = ? WHERE id = ?",
      now,
      actor.id,
      movement.id,
    );
    repository.run(
      'UPDATE trolleys SET location = ?, status = ?, updated = ?, version = version + 1 WHERE id = ?',
      movement.destination,
      statusFor(movement, location),
      now,
      movement.trolley,
    );
  };
  const depart = (movement, actor, now) => {
    repository.run(
      "UPDATE trolleys SET status = 'In Transit', product = ?, batch = ?, qty = ?, updated = ?, version = version + 1 WHERE id = ?",
      movement.product,
      movement.batch,
      movement.qty,
      now,
      movement.trolley,
    );
    if (!movement.in_transit) receive(movement, actor, now);
  };
  return {
    request(user, input) {
      requireRole(user, movementRoles);
      const trolley = requiredText(input.trolley, 'trolley');
      const destination = requiredText(input.destination, 'destination');
      const key = requiredText(input.key, 'request key', 100);
      const quantity = finiteNumber(input.qty, 'quantity');
      const version = integer(input.version, 'version');
      const expectedInput =
        input.expected === undefined ? null : integer(input.expected, 'expected return time');
      const product = input.product ? requiredText(input.product, 'product') : null;
      const batch = optionalText(input.batch, 'batch');
      if (quantity > 0 && (!product || !batch)) fail(400, 'A load requires a product and batch');
      if (quantity === 0 && product) fail(400, 'Select Empty trolley when quantity is zero');
      const exceptionReason = optionalText(input.exceptionReason, 'exception reason', 500);
      const movementType =
        input.movement_type === undefined
          ? 'Transfer'
          : requiredText(input.movement_type, 'movement type');
      if (!MOVEMENT_TYPES.includes(movementType)) fail(400, 'Unknown movement type');
      if (limitedTypes[user.role] && !limitedTypes[user.role].includes(movementType))
        fail(403, 'Your role cannot record this movement type');
      const remarks = optionalText(input.remarks, 'remarks', 1000);
      const reason = optionalText(input.reason, 'reason', 500);
      const department = optionalText(input.department, 'department');
      const statusAfter = input.status_after === undefined ? 'auto' : input.status_after;
      if (!statusOptions.includes(statusAfter)) fail(400, 'Invalid status after movement');
      const inTransit = input.in_transit === undefined ? true : input.in_transit;
      if (typeof inTransit !== 'boolean') fail(400, 'Provide an in-transit boolean');
      const occurredAt =
        input.occurred_at === undefined ? null : integer(input.occurred_at, 'movement time');
      const revisionOf =
        input.revision_of === undefined ? null : integer(input.revision_of, 'original movement ID');
      const source = input.source === undefined ? null : requiredText(input.source, 'source');
      const payload = JSON.stringify({
        trolley,
        destination,
        quantity,
        version,
        expected: expectedInput,
        product,
        batch,
        exceptionReason,
        movementType,
        remarks,
        reason,
        department,
        statusAfter,
        inTransit,
        occurredAt,
        revisionOf,
        source,
        user: user.id,
      });
      return repository.transaction(() => {
        const previous = repository.get('SELECT * FROM movements WHERE key = ?', key);
        if (previous) {
          if (previous.payload !== payload)
            fail(409, 'Request key already used with different data');
          return record(previous.id);
        }
        const now = Date.now();
        if (occurredAt !== null && occurredAt > now + 60000)
          fail(400, 'Movement time cannot be in the future');
        const current = repository.get(
          'SELECT * FROM trolleys WHERE id = ? AND active = 1',
          trolley,
        );
        const location = repository.get(
          'SELECT * FROM locations WHERE id = ? AND active = 1',
          destination,
        );
        if (!current || !location) fail(400, 'Unknown or inactive trolley or destination');
        const expected = expectedInput ?? now + location.expected_minutes * 60000;
        if (expected <= now) fail(400, 'Expected time must be in the future');
        policies.requireLocation(user, current.location, 'depart');
        if (!inTransit) policies.requireLocation(user, destination, 'receive');
        if (current.version !== version) fail(409, 'Trolley changed. Refresh and retry');
        if (source !== null && source !== current.location)
          fail(409, 'Source must match the current trolley location');
        if (current.location === destination) fail(400, 'Choose a different destination');
        if (quantity > current.capacity) fail(400, 'Quantity exceeds trolley capacity');
        const productRecord = product
          ? repository.get('SELECT * FROM products WHERE id = ? AND active = 1', product)
          : null;
        if (product && !productRecord) fail(400, 'Unknown or inactive product');
        if (
          repository.get(
            "SELECT id FROM movements WHERE trolley = ? AND state IN ('Pending', 'In Transit')",
            trolley,
          )
        )
          fail(409, 'Trolley already has an open movement');
        if (
          (statusAfter === 'Outside Plant' && !location.external) ||
          (location.external && !['auto', 'Outside Plant'].includes(statusAfter))
        )
          fail(400, 'Outside Plant status must match an external destination');
        if (statusAfter === 'Available' && quantity > 0)
          fail(400, 'A loaded trolley cannot be available');
        if (statusAfter === 'In Use' && quantity === 0)
          fail(400, 'An empty trolley cannot be in use');
        if (revisionOf !== null) {
          const original = repository.get(
            'SELECT m.* FROM movements m JOIN correction_requests c ON c.movement = m.id WHERE m.id = ?',
            revisionOf,
          );
          if (!original || original.requested_by !== user.id || original.trolley !== trolley)
            fail(400, 'A revision must refer to your corrected request for this trolley');
          if (repository.get('SELECT id FROM movements WHERE revision_of = ?', revisionOf))
            fail(409, 'This request already has a revision');
        }
        const evaluation = policies.evaluate(current, destination, productRecord, quantity, batch);
        if (evaluation.flags.length && exceptionReason.length < 10)
          fail(
            400,
            `Policy mismatch: ${evaluation.flags.join('; ')}. Provide a reason of at least 10 characters to request an exception`,
          );
        const settings = policies.settings();
        const held =
          (location.external && settings.outside_approval) ||
          (evaluation.flags.length && settings.mismatch_approval) ||
          evaluation.requiresQuality;
        const state = held ? 'Pending' : 'In Transit';
        const inserted = repository.run(
          `INSERT INTO movements
          (trolley, source, destination, product, batch, qty, state, requested_by, created, expected, key, payload, version,
           policy_flags, exception_reason, requires_quality, movement_type, remarks, department, reason, operator_name,
           occurred_at, status_after, in_transit, revision_of)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          version,
          JSON.stringify(evaluation.flags),
          exceptionReason,
          Number(evaluation.requiresQuality),
          movementType,
          remarks,
          department || location.department,
          reason,
          user.name,
          occurredAt ?? now,
          statusAfter,
          Number(inTransit),
          revisionOf,
        );
        const created = record(inserted.lastInsertRowid);
        if (state === 'In Transit') depart(created, user, now);
        repository.audit(user, 'Movement requested', trolley, {
          movement: created.id,
          destination,
          state,
          in_transit: inTransit,
        });
        return record(created.id);
      });
    },
    transition(user, id, action, input = {}) {
      return repository.transaction(() => {
        const movement = record(integer(id, 'movement ID'));
        if (!movement) fail(404, 'Movement not found');
        const trolley = repository.get('SELECT * FROM trolleys WHERE id = ?', movement.trolley);
        const now = Date.now();
        if (action === 'receive') {
          requireRole(user, movementRoles);
          policies.requireLocation(user, movement.destination, 'receive');
          if (movement.state !== 'In Transit')
            fail(409, 'Only an in-transit movement can be received');
          if (trolley.version !== movement.version + 1) fail(409, 'Trolley state changed');
          receive(movement, user, now);
        } else if (['approve', 'reject', 'correct'].includes(action)) {
          const flags = JSON.parse(movement.policy_flags);
          const destination = repository.get(
            'SELECT external FROM locations WHERE id = ?',
            movement.destination,
          );
          const allowedRoles = movement.requires_quality
            ? flags.length || destination.external
              ? ['Admin']
              : ['Admin', 'Quality User']
            : APPROVER_ROLES;
          requireRole(user, allowedRoles);
          policies.requireLocation(user, movement.destination, 'receive');
          const decisionReason = optionalText(input.reason, 'decision reason', 500);
          if (action === 'correct' && !decisionReason)
            fail(400, 'Explain what the requester needs to correct');
          if (action === 'approve' && flags.length && decisionReason.length < 10)
            fail(400, 'Approving a policy exception requires a reason of 10 to 500 characters');
          if (movement.requested_by === user.id)
            fail(403, 'Another authorized user must approve or reject your request');
          if (movement.state !== 'Pending') fail(409, 'Request already decided');
          if (trolley.version !== movement.version) fail(409, 'Trolley state changed');
          repository.run(
            'UPDATE movements SET state = ?, approved_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?',
            action === 'approve' ? 'In Transit' : 'Rejected',
            user.id,
            decisionReason,
            now,
            movement.id,
          );
          if (action === 'correct')
            repository.run(
              'INSERT INTO correction_requests(movement, requested_by, reason, created) VALUES (?, ?, ?, ?)',
              movement.id,
              user.id,
              decisionReason,
              now,
            );
          if (action === 'approve') depart(movement, user, now);
        } else fail(400, 'Unknown movement action');
        repository.audit(user, `Movement ${action}`, movement.trolley, { movement: movement.id });
        return record(movement.id);
      });
    },
  };
}
