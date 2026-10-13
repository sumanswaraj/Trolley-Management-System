import { fail } from '../errors.mjs';
import { requiredText, finiteNumber, integer } from '../validation.mjs';
import { requireRole, MANAGER_ROLES } from '../security.mjs';

/** All state transitions happen in a transaction, with optimistic version checks. */
export function movementService(repository, policies) {
  return {
    request(user, input) {
      const trolley = requiredText(input.trolley, 'trolley');
      const destination = requiredText(input.destination, 'destination');
      const key = requiredText(input.key, 'request key', 100);
      const quantity = finiteNumber(input.qty, 'quantity');
      const version = integer(input.version, 'version');
      const expected = integer(input.expected, 'expected return time');
      const product = input.product ? requiredText(input.product, 'product') : null;
      const batch = typeof input.batch === 'string' ? input.batch.trim() : '';
      if (batch.length > 120 || (quantity > 0 && (!product || !batch)))
        fail(400, 'A load requires a product and batch');
      const exceptionReason =
        typeof input.exceptionReason === 'string' ? input.exceptionReason.trim() : '';
      if (exceptionReason.length > 500) fail(400, 'Exception reason is too long');
      if (quantity === 0 && product) fail(400, 'Select Empty trolley when quantity is zero');
      const payload = JSON.stringify({
        trolley,
        destination,
        quantity,
        version,
        expected,
        product,
        batch,
        exceptionReason,
        user: user.id,
      });

      return repository.transaction(() => {
        // Matching retries still succeed after the requested arrival time has passed.
        const previous = repository.get('SELECT * FROM movements WHERE key = ?', key);
        if (previous) {
          if (previous.payload !== payload)
            fail(409, 'Request key already used with different data');
          return previous;
        }
        if (expected <= Date.now()) fail(400, 'Expected time must be in the future');
        const current = repository.get(
          'SELECT * FROM trolleys WHERE id = ? AND active = 1',
          trolley,
        );
        const location = repository.get('SELECT * FROM locations WHERE id = ?', destination);
        if (!current || !location) fail(400, 'Unknown trolley or destination');
        policies.requireLocation(user, current.location, 'depart');
        if (current.version !== version) fail(409, 'Trolley changed. Refresh and retry');
        if (current.location === destination) fail(400, 'Choose a different destination');
        if (quantity > current.capacity) fail(400, 'Quantity exceeds trolley capacity');
        if (product && !repository.get('SELECT id FROM products WHERE id = ?', product))
          fail(400, 'Unknown product');
        if (
          repository.get(
            "SELECT id FROM movements WHERE trolley = ? AND state IN ('Pending', 'In Transit')",
            trolley,
          )
        ) {
          fail(409, 'Trolley already has an open movement');
        }
        const productRecord = product
          ? repository.get('SELECT * FROM products WHERE id = ?', product)
          : null;
        const evaluation = policies.evaluate(current, destination, productRecord, quantity, batch);
        if (evaluation.flags.length && exceptionReason.length < 10) {
          fail(
            400,
            `Policy mismatch: ${evaluation.flags.join('; ')}. Provide a reason of at least 10 characters to request an exception`,
          );
        }
        const status =
          location.external || evaluation.flags.length || evaluation.requiresQuality
            ? 'Pending'
            : 'In Transit';
        const inserted = repository.run(
          `INSERT INTO movements
          (trolley, source, destination, product, batch, qty, state, requested_by, created, expected, key, payload, version, policy_flags, exception_reason, requires_quality)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          trolley,
          current.location,
          destination,
          product,
          batch,
          quantity,
          status,
          user.id,
          Date.now(),
          expected,
          key,
          payload,
          version,
          JSON.stringify(evaluation.flags),
          exceptionReason,
          Number(evaluation.requiresQuality),
        );
        if (status === 'In Transit') {
          repository.run(
            "UPDATE trolleys SET status = 'In Transit', product = ?, batch = ?, qty = ?, version = version + 1 WHERE id = ?",
            product,
            batch,
            quantity,
            trolley,
          );
        }
        repository.audit(user, 'Movement requested', trolley, { destination, status });
        return repository.get('SELECT * FROM movements WHERE id = ?', inserted.lastInsertRowid);
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
          policies.requireLocation(user, movement.destination, 'receive');
          if (movement.state !== 'In Transit')
            fail(409, 'Only an in-transit movement can be received');
          if (trolley.version !== movement.version + 1) fail(409, 'Trolley state changed');
          repository.run(
            "UPDATE movements SET state = 'Received', received = ?, received_by = ? WHERE id = ?",
            Date.now(),
            user.id,
            movement.id,
          );
          const location = repository.get(
            'SELECT * FROM locations WHERE id = ?',
            movement.destination,
          );
          const status = location.external
            ? 'Outside Plant'
            : movement.qty > 0
              ? 'In Use'
              : 'Available';
          repository.run(
            'UPDATE trolleys SET location = ?, status = ?, version = version + 1 WHERE id = ?',
            movement.destination,
            status,
            movement.trolley,
          );
        } else if (action === 'approve' || action === 'reject') {
          const flags = JSON.parse(movement.policy_flags);
          const destination = repository.get(
            'SELECT external FROM locations WHERE id = ?',
            movement.destination,
          );
          const allowedRoles = movement.requires_quality
            ? flags.length || destination.external
              ? ['Admin']
              : ['Admin', 'Quality User']
            : MANAGER_ROLES;
          requireRole(user, allowedRoles);
          policies.requireLocation(user, movement.destination, 'receive');
          const decisionReason = typeof input.reason === 'string' ? input.reason.trim() : '';
          if (
            action === 'approve' &&
            flags.length &&
            (decisionReason.length < 10 || decisionReason.length > 500)
          ) {
            fail(400, 'Approving a policy exception requires a reason of 10 to 500 characters');
          }
          if (decisionReason.length > 500) fail(400, 'Decision reason is too long');
          if (movement.requested_by === user.id)
            fail(403, 'Another authorized user must approve or reject your request');
          if (movement.state !== 'Pending') fail(409, 'Request already decided');
          if (trolley.version !== movement.version) fail(409, 'Trolley state changed');
          repository.run(
            'UPDATE movements SET state = ?, approved_by = ?, decision_reason = ? WHERE id = ?',
            action === 'approve' ? 'In Transit' : 'Rejected',
            user.id,
            decisionReason,
            movement.id,
          );
          if (action === 'approve') {
            repository.run(
              "UPDATE trolleys SET status = 'In Transit', product = ?, batch = ?, qty = ?, version = version + 1 WHERE id = ?",
              movement.product,
              movement.batch,
              movement.qty,
              movement.trolley,
            );
          }
        } else fail(400, 'Unknown movement action');
        repository.audit(user, `Movement ${action}`, movement.trolley, { movement: movement.id });
        return repository.get('SELECT * FROM movements WHERE id = ?', movement.id);
      });
    },
  };
}
