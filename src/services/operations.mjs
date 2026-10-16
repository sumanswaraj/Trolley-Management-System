import { fail } from '../errors.mjs';
import { finiteNumber, integer, requiredText } from '../validation.mjs';
import { requireRole } from '../security.mjs';

const APPROVERS = ['Admin', 'Plant Manager', 'Supervisor'];
const ALERT_MANAGERS = [...APPROVERS, 'Quality User'];
const VERIFIERS = ['Admin', 'Supervisor', 'Quality User'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const ALERT_TYPES = [
  'Trolley overdue',
  'Trolley missing',
  'Wrong location',
  'Wrong product',
  'Outside plant',
  'Movement not completed',
  'Trolley maintenance due',
  'Unauthorized movement',
];

function optionalText(value, label, maxLength = 1000) {
  if (value === undefined || value === null || value === '') return '';
  return requiredText(value, label, maxLength);
}

export function operationService(repository, policies) {
  const alertQuery = `SELECT a.*, c.name AS created_by_name, k.name AS acknowledged_by_name,
    r.name AS resolved_by_name FROM alerts a
    JOIN users c ON c.id = a.created_by
    LEFT JOIN users k ON k.id = a.acknowledged_by
    LEFT JOIN users r ON r.id = a.resolved_by`;
  const verificationQuery = `SELECT v.*, u.name AS created_by_name FROM verifications v
    JOIN users u ON u.id = v.created_by`;
  const approvalQuery = `SELECT a.*, u.name AS requester, d.name AS decider, v.flags, v.trolley_version
    FROM mismatch_approvals a JOIN users u ON u.id = a.requested_by
    LEFT JOIN users d ON d.id = a.decided_by
    JOIN verifications v ON v.id = a.verification`;
  const trolleyFor = (id) => {
    const trolley = repository.get('SELECT * FROM trolleys WHERE id = ? AND active = 1', id);
    if (!trolley) fail(404, 'Active trolley not found');
    return trolley;
  };
  const alertFor = (id) => repository.get(`${alertQuery} WHERE a.id = ?`, id);
  const verificationRecord = (record) =>
    record ? { ...record, ...JSON.parse(record.input), flags: JSON.parse(record.flags) } : null;
  const verificationFor = (id) =>
    verificationRecord(repository.get(`${verificationQuery} WHERE v.id = ?`, id));
  const approvalRecord = (record) =>
    record ? { ...record, flags: JSON.parse(record.flags) } : null;
  const approvalFor = (id) => {
    return approvalRecord(repository.get(`${approvalQuery} WHERE a.id = ?`, id));
  };
  const deliver = (actor, recipient, title, message, kind = 'info', entity = '') => {
    const inserted = repository.run(
      `INSERT INTO notifications(user_id, kind, title, message, entity, created, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      recipient,
      kind,
      title,
      message,
      entity,
      Date.now(),
      actor.id,
    );
    return Number(inserted.lastInsertRowid);
  };
  const broadcast = (actor, title, message, kind, entity, roles) => {
    for (const recipient of repository.all('SELECT id, role FROM users WHERE active = 1')) {
      if (!roles || roles.includes(recipient.role))
        deliver(actor, recipient.id, title, message, kind, entity);
    }
  };
  const byTrolley = (rows) => new Map(rows.map((row) => [row.trolley, row]));
  const facts = () => ({
    locations: new Map(
      repository.all('SELECT * FROM locations').map((location) => [location.id, location]),
    ),
    trolleys: repository.all('SELECT * FROM trolleys WHERE active = 1'),
    active: byTrolley(
      repository.all("SELECT * FROM movements WHERE state IN ('Pending', 'In Transit')"),
    ),
    received: byTrolley(
      repository.all(`SELECT * FROM (
      SELECT m.*, ROW_NUMBER() OVER (PARTITION BY trolley ORDER BY COALESCE(received, created) DESC, id DESC) AS position
      FROM movements m WHERE state = 'Received'
    ) WHERE position = 1`),
    ),
  });
  const deadlines = (current = facts()) => {
    return current.trolleys.flatMap((trolley) => {
      const active = current.active.get(trolley.id);
      if (active)
        return [
          { trolley, movement: active, expected: active.expected, key: `overdue:${active.id}` },
        ];
      if (!['In Use', 'Waiting', 'Maintenance', 'Outside Plant'].includes(trolley.status))
        return [];
      const received = current.received.get(trolley.id);
      const since = received ? (received.received ?? received.created) : trolley.created;
      if (!since) return [];
      return [
        {
          trolley,
          movement: received,
          expected:
            since + (current.locations.get(trolley.location)?.expected_minutes || 120) * 60000,
          key: received
            ? `held:${received.id}:${trolley.location}`
            : `initial:${trolley.id}:${trolley.location}`,
        },
      ];
    });
  };
  const alertPair = (trolley, type) => JSON.stringify([trolley, type]);
  const raise = (actor, input, source, systemKey = null, cache = null) => {
    const pair = alertPair(input.trolley, input.type);
    const active = cache
      ? cache.active.get(pair)
      : repository.get(
          "SELECT * FROM alerts WHERE trolley = ? AND type = ? AND status <> 'Resolved'",
          input.trolley,
          input.type,
        );
    if (active) {
      if (
        source === 'Automatic' &&
        active.source === 'Automatic' &&
        (active.priority !== input.priority ||
          active.message !== input.message ||
          active.location !== input.location)
      ) {
        repository.run(
          'UPDATE alerts SET priority = ?, message = ?, location = ?, updated = ? WHERE id = ?',
          input.priority,
          input.message,
          input.location,
          Date.now(),
          active.id,
        );
        repository.audit(actor, 'Automatic alert updated', input.trolley, {
          alert: active.id,
          previous: active.priority,
          priority: input.priority,
          source: 'System',
        });
        Object.assign(active, input);
      }
      return { alert: cache ? active : alertFor(active.id), created: false };
    }
    const previous = systemKey
      ? cache
        ? cache.system.get(systemKey)
        : repository.get('SELECT * FROM alerts WHERE system_key = ?', systemKey)
      : null;
    const now = Date.now();
    let id;
    if (previous) {
      repository.run(
        `UPDATE alerts SET status = 'Open', priority = ?, message = ?, location = ?,
        acknowledged_by = NULL, acknowledged_at = NULL, resolved_by = NULL,
        resolved_at = NULL, updated = ?, remarks = '' WHERE id = ?`,
        input.priority,
        input.message,
        input.location,
        now,
        previous.id,
      );
      id = previous.id;
    } else {
      id = Number(
        repository.run(
          `INSERT INTO alerts(type, priority, trolley, location, message, source, system_key,
          created, created_by, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          input.type,
          input.priority,
          input.trolley,
          input.location,
          input.message,
          source,
          systemKey,
          now,
          actor.id,
          now,
        ).lastInsertRowid,
      );
    }
    repository.audit(actor, previous ? 'Alert reopened' : 'Alert raised', input.trolley, {
      alert: id,
      type: input.type,
      priority: input.priority,
      source: source === 'Automatic' ? 'System' : source,
    });
    broadcast(
      actor,
      `${input.type}: ${input.trolley}`,
      input.message,
      ['Critical', 'High'].includes(input.priority) ? 'danger' : 'warn',
      `alert:${id}`,
    );
    const alert = cache ? repository.get('SELECT * FROM alerts WHERE id = ?', id) : alertFor(id);
    if (cache) {
      cache.active.set(pair, alert);
      cache.system.set(systemKey, alert);
    }
    return { alert, created: true };
  };
  const sync = (user) => {
    const now = Date.now();
    const current = facts();
    const alerts = repository.all('SELECT * FROM alerts');
    const cache = {
      active: new Map(
        alerts
          .filter((alert) => alert.status !== 'Resolved')
          .map((alert) => [alertPair(alert.trolley, alert.type), alert]),
      ),
      system: new Map(
        alerts.filter((alert) => alert.system_key).map((alert) => [alert.system_key, alert]),
      ),
    };
    const conditions = [];
    const add = (key, trolley, type, priority, message) =>
      conditions.push({
        key,
        input: { type, priority, trolley: trolley.id, location: trolley.location, message },
      });
    for (const deadline of deadlines(current)) {
      if (deadline.expected >= now) continue;
      const { trolley, movement, key } = deadline;
      const delay = now - deadline.expected;
      add(
        key,
        trolley,
        'Trolley overdue',
        delay > 7200000 ? 'Critical' : delay > 3600000 ? 'High' : 'Medium',
        movement && movement.state !== 'Received'
          ? `Movement ${movement.id} passed its expected return time.`
          : `Trolley ${trolley.id} passed its expected holding time at ${trolley.location}.`,
      );
      if (movement && movement.state !== 'Received')
        add(
          `incomplete:${movement.id}`,
          trolley,
          'Movement not completed',
          'High',
          `Movement ${movement.id} remains ${movement.state.toLowerCase()} after its recorded deadline.`,
        );
    }
    const productLocations = new Map();
    for (const rule of repository.all('SELECT * FROM product_locations')) {
      if (!productLocations.has(rule.product)) productLocations.set(rule.product, new Set());
      productLocations.get(rule.product).add(rule.location);
    }
    const observations = byTrolley(
      repository.all(`SELECT * FROM (
      SELECT e.*, ROW_NUMBER() OVER (PARTITION BY trolley ORDER BY observed_at DESC, id DESC) AS position
      FROM reader_events e WHERE trolley IS NOT NULL
    ) WHERE position = 1`),
    );
    for (const trolley of current.trolleys) {
      const location = current.locations.get(trolley.location);
      if (
        location?.external ||
        location?.group_name === 'Outside Plant' ||
        trolley.status === 'Outside Plant'
      )
        add(
          `outside:${trolley.id}`,
          trolley,
          'Outside plant',
          'Low',
          `Trolley ${trolley.id} is recorded outside the plant at ${trolley.location}.`,
        );
      const maintenance = [];
      if (trolley.status === 'Maintenance') maintenance.push('Trolley is marked for maintenance.');
      if (trolley.tag_condition && trolley.tag_condition !== 'Good')
        maintenance.push(`Trolley identification tag is ${trolley.tag_condition.toLowerCase()}.`);
      if (maintenance.length)
        add(
          `maintenance:${trolley.id}`,
          trolley,
          'Trolley maintenance due',
          trolley.tag_condition === 'Missing' ? 'High' : 'Medium',
          maintenance.join(' '),
        );
      const issues = [];
      const allowed = productLocations.get(trolley.product);
      if (trolley.qty > 0 && allowed?.size && !allowed.has(trolley.location))
        issues.push(
          `Product ${trolley.product} is not approved at the recorded location ${trolley.location}.`,
        );
      const observed = observations.get(trolley.id);
      const received = current.received.get(trolley.id);
      const confirmedAt = received ? (received.received ?? received.created) : trolley.created;
      const active = current.active.get(trolley.id);
      if (
        observed &&
        observed.observed_at > (confirmedAt || 0) &&
        observed.received_at > (confirmedAt || 0) &&
        observed.location !== trolley.location &&
        !(active?.state === 'In Transit' && observed.location === active.destination)
      )
        issues.push(
          `Reader ${observed.reader} observed the tag at ${observed.location}; the recorded location is ${trolley.location}. Confirm the location before recording a receipt.`,
        );
      if (issues.length)
        add(`location:${trolley.id}`, trolley, 'Wrong location', 'High', issues.join(' '));
    }
    const activeKeys = new Set(conditions.map((condition) => condition.key));
    for (const alert of alerts) {
      if (alert.source !== 'Automatic' || alert.status === 'Resolved') continue;
      if (activeKeys.has(alert.system_key)) continue;
      repository.run(
        `UPDATE alerts SET status = 'Resolved', resolved_by = ?, resolved_at = ?, updated = ?,
        remarks = 'Automatically resolved after the condition cleared' WHERE id = ?`,
        user.id,
        now,
        now,
        alert.id,
      );
      repository.audit(user, 'Alert resolved', alert.trolley, {
        alert: alert.id,
        source: 'System',
      });
      cache.active.delete(alertPair(alert.trolley, alert.type));
    }
    for (const condition of conditions)
      raise(user, condition.input, 'Automatic', condition.key, cache);
  };

  return {
    sync(user) {
      repository.transaction(() => sync(user));
    },
    state(user) {
      repository.transaction(() => sync(user));
      const canApprove = APPROVERS.includes(user.role);
      return {
        alerts: repository.all(`${alertQuery} ORDER BY a.created DESC, a.id DESC`),
        notifications: repository
          .all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 200', user.id)
          .map((notification) => ({ ...notification, read: notification.read_at !== null })),
        verifications: repository
          .all(
            `${verificationQuery} ${canApprove ? '' : 'WHERE v.created_by = ?'} ORDER BY v.id DESC LIMIT 100`,
            ...(canApprove ? [] : [user.id]),
          )
          .map(verificationRecord),
        approvals: repository
          .all(
            `${approvalQuery} ${canApprove ? '' : 'WHERE a.requested_by = ?'} ORDER BY a.id DESC LIMIT 200`,
            ...(canApprove ? [] : [user.id]),
          )
          .map(approvalRecord),
      };
    },
    report(user, input) {
      const type = requiredText(input.type, 'incident type');
      const priority = requiredText(input.priority || 'Medium', 'priority');
      if (!ALERT_TYPES.includes(type) || !PRIORITIES.includes(priority))
        fail(400, 'Invalid incident type or priority');
      const trolley = requiredText(input.trolley, 'trolley');
      const message = requiredText(input.message, 'incident message', 1000);
      return repository.transaction(() => {
        const current = trolleyFor(trolley);
        const location = input.location
          ? requiredText(input.location, 'location')
          : current.location;
        if (!repository.get('SELECT id FROM locations WHERE id = ?', location))
          fail(400, 'Unknown location');
        policies.requireLocation(user, location, 'receive');
        return raise(user, { type, priority, trolley, location, message }, 'Manual').alert;
      });
    },
    updateAlert(user, id, input) {
      requireRole(user, ALERT_MANAGERS);
      const alertId = integer(id, 'alert ID');
      const status = requiredText(input.status, 'alert status');
      if (!['Acknowledged', 'Resolved', 'Open'].includes(status)) fail(400, 'Invalid alert status');
      const remarks = optionalText(input.remarks, 'remarks');
      return repository.transaction(() => {
        const current = alertFor(alertId);
        if (!current) fail(404, 'Alert not found');
        policies.requireLocation(user, current.location, 'receive');
        if (current.status === status) return current;
        if (current.status === 'Resolved' && status !== 'Open')
          fail(409, 'Reopen a resolved alert first');
        const now = Date.now();
        if (status === 'Open') {
          if (
            repository.get(
              "SELECT id FROM alerts WHERE trolley = ? AND type = ? AND status <> 'Resolved' AND id <> ?",
              current.trolley,
              current.type,
              alertId,
            )
          )
            fail(409, 'An active alert already exists for this trolley and type');
          repository.run(
            `UPDATE alerts SET status = 'Open', acknowledged_by = NULL, acknowledged_at = NULL,
            resolved_by = NULL, resolved_at = NULL, updated = ?, remarks = ? WHERE id = ?`,
            now,
            remarks,
            alertId,
          );
        } else if (status === 'Acknowledged') {
          repository.run(
            "UPDATE alerts SET status = 'Acknowledged', acknowledged_by = ?, acknowledged_at = ?, updated = ?, remarks = ? WHERE id = ?",
            user.id,
            now,
            now,
            remarks,
            alertId,
          );
        } else {
          repository.run(
            "UPDATE alerts SET status = 'Resolved', resolved_by = ?, resolved_at = ?, updated = ?, remarks = ? WHERE id = ?",
            user.id,
            now,
            now,
            remarks,
            alertId,
          );
        }
        repository.audit(user, `Alert ${status.toLowerCase()}`, current.trolley, {
          alert: alertId,
          previous: current.status,
          remarks,
        });
        return alertFor(alertId);
      });
    },
    verify(user, input) {
      requireRole(user, VERIFIERS);
      const id = requiredText(input.trolley, 'trolley');
      const productId = input.product ? requiredText(input.product, 'product') : null;
      const declaredType = input.type ? requiredText(input.type, 'trolley type') : null;
      const declaredLocation = input.location ? requiredText(input.location, 'location') : null;
      const quantity = input.qty === undefined ? null : finiteNumber(input.qty, 'quantity');
      const batch = optionalText(input.batch, 'batch', 120);
      const remarks = optionalText(input.remarks, 'remarks');
      return repository.transaction(() => {
        const trolley = trolleyFor(id);
        const location = declaredLocation || trolley.location;
        if (!repository.get('SELECT id FROM locations WHERE id = ?', location))
          fail(400, 'Unknown location');
        policies.requireLocation(user, location, 'receive');
        const product = productId
          ? repository.get('SELECT * FROM products WHERE id = ?', productId)
          : null;
        if (productId && !product) fail(400, 'Unknown product');
        const flags = [];
        const flag = (code, message) => flags.push({ code, message });
        if (productId && !trolley.product)
          flag('Unassigned trolley', `Trolley ${id} has no assigned product.`);
        else if (productId && productId !== trolley.product)
          flag(
            'Wrong product',
            `Scanned product ${productId} differs from assigned product ${trolley.product}.`,
          );
        if (declaredType && declaredType !== trolley.type)
          flag('Wrong trolley', `Trolley ${id} is ${trolley.type}, not ${declaredType}.`);
        if (declaredLocation && declaredLocation !== trolley.location)
          flag(
            'Wrong location',
            `Trolley ${id} is recorded at ${trolley.location}, not ${declaredLocation}.`,
          );
        if (product) {
          if (product.active === 0) flag('Inactive product', `Product ${productId} is inactive.`);
          if (product.unit !== trolley.unit)
            flag(
              'Unit mismatch',
              `Product unit ${product.unit} differs from trolley unit ${trolley.unit}.`,
            );
          const configuredCategories = repository.all(
            'SELECT category FROM trolley_categories WHERE trolley_type = ?',
            trolley.type,
          );
          if (
            (policies.settings().enforce_categories || configuredCategories.length) &&
            !configuredCategories.some((category) => category.category === product.category)
          )
            flag(
              'Wrong trolley',
              `Trolley type ${trolley.type} is not approved for ${product.category}.`,
            );
          const allowedLocations = repository.all(
            'SELECT location FROM product_locations WHERE product = ?',
            product.id,
          );
          if (
            allowedLocations.length &&
            !allowedLocations.some((allowed) => allowed.location === location)
          )
            flag('Wrong location', `Product ${productId} is not approved at ${location}.`);
        }
        if (quantity !== null && quantity > trolley.capacity)
          flag(
            'Capacity exceeded',
            `Quantity ${quantity} exceeds trolley capacity ${trolley.capacity}.`,
          );
        if (quantity !== null && quantity !== trolley.qty)
          flag(
            'Load mismatch',
            `Scanned quantity ${quantity} differs from recorded quantity ${trolley.qty}.`,
          );
        if (batch && trolley.batch && batch !== trolley.batch)
          flag(
            'Mixed batch',
            `Scanned batch ${batch} differs from recorded batch ${trolley.batch}.`,
          );
        if (trolley.tag_condition && trolley.tag_condition !== 'Good')
          flag(
            'Tag problem',
            `Trolley identification tag is ${trolley.tag_condition.toLowerCase()}.`,
          );
        const snapshot = {
          product: productId,
          type: declaredType,
          location,
          qty: quantity,
          batch,
          remarks,
        };
        const inserted = repository.run(
          'INSERT INTO verifications(trolley, trolley_version, input, flags, status, created, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id,
          trolley.version,
          JSON.stringify(snapshot),
          JSON.stringify(flags),
          flags.length ? 'Mismatch' : 'Matched',
          Date.now(),
          user.id,
        );
        repository.audit(user, 'Trolley verified', id, {
          verification: Number(inserted.lastInsertRowid),
          status: flags.length ? 'Mismatch' : 'Matched',
          flags,
        });
        return verificationFor(Number(inserted.lastInsertRowid));
      });
    },
    requestApproval(user, input) {
      const verificationId = integer(input.verification, 'verification ID');
      const reason = requiredText(input.reason, 'approval reason', 1000);
      return repository.transaction(() => {
        const verification = verificationFor(verificationId);
        if (!verification) fail(404, 'Verification not found');
        if (verification.created_by !== user.id)
          fail(403, 'Only the verifier can request approval');
        const previous = repository.get(
          'SELECT id FROM mismatch_approvals WHERE verification = ?',
          verificationId,
        );
        if (previous) return approvalFor(previous.id);
        if (verification.status !== 'Mismatch')
          fail(400, 'Only a mismatched verification needs approval');
        const trolley = trolleyFor(verification.trolley);
        if (trolley.version !== verification.trolley_version)
          fail(409, 'Trolley changed. Verify it again');
        const inserted = repository.run(
          'INSERT INTO mismatch_approvals(verification, trolley, requested_by, created, reason) VALUES (?, ?, ?, ?, ?)',
          verificationId,
          trolley.id,
          user.id,
          Date.now(),
          reason,
        );
        const id = Number(inserted.lastInsertRowid);
        const type =
          verification.flags.some((flag) => flag.code === 'Wrong location') &&
          !verification.flags.some((flag) => flag.code === 'Wrong product')
            ? 'Wrong location'
            : 'Wrong product';
        raise(
          user,
          {
            type,
            priority: 'Critical',
            trolley: trolley.id,
            location: trolley.location,
            message: verification.flags.map((flag) => flag.message).join(' '),
          },
          'Verification',
        );
        broadcast(
          user,
          `Approval needed: ${trolley.id}`,
          reason,
          'warn',
          `approval:${id}`,
          APPROVERS,
        );
        repository.audit(user, 'Mismatch approval requested', trolley.id, {
          approval: id,
          verification: verificationId,
          reason,
        });
        return approvalFor(id);
      });
    },
    decide(user, id, input) {
      requireRole(user, APPROVERS);
      const approvalId = integer(id, 'approval ID');
      const decision = requiredText(input.decision, 'decision');
      if (!['Approved', 'Rejected', 'Correction Required'].includes(decision))
        fail(400, 'Invalid approval decision');
      const remarks = optionalText(input.remarks, 'decision remarks');
      if (decision !== 'Approved' && !remarks)
        fail(400, 'Explain the rejection or requested correction');
      return repository.transaction(() => {
        const approval = approvalFor(approvalId);
        if (!approval) fail(404, 'Approval not found');
        if (approval.requested_by === user.id)
          fail(403, 'Another authorized user must decide your request');
        if (approval.status !== 'Pending') fail(409, 'Request already decided');
        const trolley = trolleyFor(approval.trolley);
        policies.requireLocation(user, trolley.location, 'receive');
        if (decision === 'Approved' && trolley.version !== approval.trolley_version)
          fail(409, 'Trolley changed. Request a new verification');
        const now = Date.now();
        repository.run(
          'UPDATE mismatch_approvals SET status = ?, decided_by = ?, decided_at = ?, remarks = ? WHERE id = ?',
          decision,
          user.id,
          now,
          remarks,
          approvalId,
        );
        if (
          decision === 'Approved' &&
          !repository.get(
            "SELECT id FROM mismatch_approvals WHERE trolley = ? AND status = 'Pending' LIMIT 1",
            trolley.id,
          )
        ) {
          for (const alert of repository.all(
            "SELECT * FROM alerts WHERE trolley = ? AND source = 'Verification' AND status <> 'Resolved' AND type IN ('Wrong product', 'Wrong location')",
            trolley.id,
          )) {
            repository.run(
              "UPDATE alerts SET status = 'Resolved', resolved_by = ?, resolved_at = ?, updated = ?, remarks = ? WHERE id = ?",
              user.id,
              now,
              now,
              `Mismatch approved: ${remarks}`,
              alert.id,
            );
            repository.audit(user, 'Alert resolved', trolley.id, {
              alert: alert.id,
              approval: approvalId,
            });
          }
        }
        deliver(
          user,
          approval.requested_by,
          `${trolley.id}: ${decision.toLowerCase()}`,
          remarks || 'The mismatch approval request was approved.',
          decision === 'Approved' ? 'info' : 'warn',
          `approval:${approvalId}`,
        );
        repository.audit(user, `Mismatch ${decision.toLowerCase()}`, trolley.id, {
          approval: approvalId,
          remarks,
        });
        return approvalFor(approvalId);
      });
    },
    remind(user, id, input = {}) {
      const trolleyId = requiredText(id, 'trolley');
      const message = optionalText(input.message, 'reminder message');
      return repository.transaction(() => {
        const trolley = trolleyFor(trolleyId);
        const now = Date.now();
        const deadline = deadlines().find((record) => record.trolley.id === trolleyId);
        if (!deadline || deadline.expected >= now) fail(409, 'Trolley is not overdue');
        const movement = deadline.movement;
        if (!movement) fail(409, 'No recorded movement identifies a responsible user to remind');
        policies.requireLocation(user, trolley.location, 'receive');
        if (
          repository.get(
            'SELECT id FROM reminders WHERE trolley = ? AND created > ? LIMIT 1',
            trolleyId,
            now - 300000,
          )
        )
          fail(429, 'A reminder was sent recently. Wait five minutes before sending another');
        const recipient = repository.get(
          'SELECT id FROM users WHERE id = ? AND active = 1',
          movement.requested_by,
        );
        if (!recipient) fail(409, 'The responsible user is inactive');
        const text =
          message || `Please follow up on overdue trolley ${trolleyId}, movement ${movement.id}.`;
        const inserted = repository.run(
          'INSERT INTO reminders(trolley, movement, recipient, message, created, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          trolleyId,
          movement.id,
          recipient.id,
          text,
          now,
          user.id,
        );
        const reminderId = Number(inserted.lastInsertRowid);
        deliver(
          user,
          recipient.id,
          `Overdue trolley reminder: ${trolleyId}`,
          text,
          'warn',
          `reminder:${reminderId}`,
        );
        repository.audit(user, 'Reminder sent', trolleyId, {
          reminder: reminderId,
          recipient: recipient.id,
          movement: movement.id,
        });
        return repository.get('SELECT * FROM reminders WHERE id = ?', reminderId);
      });
    },
    readNotification(user, id) {
      return repository.transaction(() => {
        let updated;
        if (id === 'all') {
          updated = repository.run(
            'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
            Date.now(),
            user.id,
          ).changes;
        } else {
          const notificationId = integer(id, 'notification ID');
          if (
            !repository.get(
              'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
              notificationId,
              user.id,
            )
          )
            fail(404, 'Notification not found');
          updated = repository.run(
            'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL',
            Date.now(),
            notificationId,
            user.id,
          ).changes;
        }
        if (updated)
          repository.audit(user, 'Notifications read', `user:${user.id}`, {
            notification: id,
            updated,
          });
        return { updated: Number(updated) };
      });
    },
    notify(user, input) {
      requireRole(user, APPROVERS);
      const recipient = integer(input.userId, 'recipient ID');
      const title = requiredText(input.title, 'notification title', 120);
      const message = requiredText(input.message, 'notification message', 1000);
      const kind = input.kind || 'info';
      if (!['info', 'warn', 'danger'].includes(kind)) fail(400, 'Invalid notification kind');
      const entity = optionalText(input.entity, 'notification entity', 120);
      return repository.transaction(() => {
        if (!repository.get('SELECT id FROM users WHERE id = ? AND active = 1', recipient))
          fail(400, 'Unknown active recipient');
        const id = deliver(user, recipient, title, message, kind, entity);
        repository.audit(user, 'Notification sent', `user:${recipient}`, {
          notification: id,
          title,
        });
        return repository.get('SELECT * FROM notifications WHERE id = ?', id);
      });
    },
  };
}
