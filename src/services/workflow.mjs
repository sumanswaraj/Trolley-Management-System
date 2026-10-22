import { randomUUID } from 'node:crypto';
import { fail } from '../errors.mjs';
import { integer, requiredText } from '../validation.mjs';
import { requireRole, APPROVER_ROLES } from '../security.mjs';
import {
  deliverNotification,
  optionalText,
  raiseWorkflowAlert,
  resolveWorkflowAlerts,
} from './movements.mjs';

export const ALERT_TYPES = Object.freeze([
  'Trolley overdue',
  'Trolley missing',
  'Wrong location',
  'Wrong product',
  'Outside plant',
  'Movement not completed',
  'Trolley maintenance due',
  'Unauthorized movement',
  'Wrong trolley',
  'Mixed batch',
  'Unassigned trolley',
]);
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const ALERT_ROLES = ['Admin', 'Plant Manager', 'Supervisor', 'Quality User'];
const VERIFY_ROLES = ['Admin', 'Supervisor', 'Quality User'];
const HOUR = 3600000;
const readQuery = (query, key) => (query?.get ? query.get(key) : query?.[key]);
const issue = (type, message) => ({ type, kind: type, message, msg: message });
const issuePriority = (type) =>
  ({
    'Wrong product': 'Critical',
    'Trolley missing': 'High',
    'Unauthorized movement': 'High',
    'Movement not completed': 'Medium',
    'Trolley maintenance due': 'Low',
  })[type] || 'Medium';

export function workflowService(repository, policies, movements) {
  const trolleyFor = (id) => {
    const trolley = repository.get(
      'SELECT * FROM trolleys WHERE id = ?',
      requiredText(id, 'trolley'),
    );
    if (!trolley) fail(404, 'Trolley not found');
    return trolley;
  };
  const systemActor = () =>
    repository.get(
      "SELECT id, name, role FROM users WHERE active = 1 ORDER BY role = 'Admin' DESC, id LIMIT 1",
    );
  const notificationRows = (user) =>
    repository
      .all(
        `SELECT n.*, CASE WHEN r.read_at IS NULL THEN 0 ELSE 1 END AS read, r.read_at
    FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
    WHERE n.user_id IS NULL OR n.user_id = ? ORDER BY n.id DESC`,
        user.id,
        user.id,
      )
      .map((row) => ({ ...row, read: Boolean(row.read) }));
  const approvalFor = (id) => {
    const approval = repository.get(
      'SELECT * FROM approval_requests WHERE id = ?',
      integer(id, 'approval ID'),
    );
    if (!approval) fail(404, 'Approval not found');
    return approval;
  };
  const service = {
    synchronize() {
      return repository.transaction(() => {
        const now = Date.now();
        const actor = systemActor();
        for (const trolley of repository.all('SELECT * FROM trolleys WHERE active = 1')) {
          const location = repository.get('SELECT * FROM locations WHERE id = ?', trolley.location);
          const open = repository.get(
            "SELECT * FROM movements WHERE trolley = ? AND state IN ('Pending','In Transit')",
            trolley.id,
          );
          const raise = (type, priority, message) =>
            raiseWorkflowAlert(repository, actor, {
              trolley: trolley.id,
              location: trolley.location,
              type,
              priority,
              message,
              source: 'system',
            });
          const overdue =
            ['In Use', 'Waiting', 'In Transit'].includes(trolley.status) &&
            trolley.expected &&
            trolley.expected < now;
          if (overdue) {
            const delay = now - trolley.expected;
            raise(
              'Trolley overdue',
              delay > 2 * HOUR ? 'Critical' : delay > HOUR ? 'High' : 'Medium',
              `Past expected return time at ${location.name}`,
            );
          } else resolveWorkflowAlerts(repository, actor, trolley.id, ['Trolley overdue']);
          if (location.external)
            raise('Outside plant', 'Medium', `Trolley is outside the plant at ${location.name}`);
          else resolveWorkflowAlerts(repository, actor, trolley.id, ['Outside plant']);
          if (open?.state === 'In Transit' && (trolley.expected || open.expected) < now)
            raise(
              'Movement not completed',
              'High',
              `Arrival at ${open.destination} has not been received`,
            );
          else resolveWorkflowAlerts(repository, actor, trolley.id, ['Movement not completed']);
          if (trolley.maintenance_due && trolley.maintenance_due < now)
            raise('Trolley maintenance due', 'Low', 'Scheduled trolley service is due');
          else
            for (const alert of repository.all(
              "SELECT id FROM alerts WHERE trolley = ? AND type = 'Trolley maintenance due' AND source = 'system' AND status <> 'Resolved'",
              trolley.id,
            ))
              repository.run(
                "UPDATE alerts SET status = 'Resolved', resolved_by = ?, resolved_at = ? WHERE id = ?",
                actor?.id || null,
                now,
                alert.id,
              );
          const observation = repository.get(
            'SELECT * FROM reader_events WHERE trolley = ? ORDER BY observed_at DESC LIMIT 1',
            trolley.id,
          );
          if (
            observation &&
            observation.observed_at >= trolley.last_moved &&
            observation.location !== trolley.location &&
            !(open?.state === 'In Transit' && open.destination === observation.location)
          )
            raise(
              'Unauthorized movement',
              'High',
              `Reader observed trolley at ${observation.location}; recorded location is ${trolley.location}`,
            );
          const seen = Math.max(
            trolley.last_moved || trolley.created,
            observation?.observed_at || 0,
          );
          if (
            !location.external &&
            trolley.status !== 'Maintenance' &&
            trolley.assigned_area &&
            trolley.assigned_area !== trolley.location &&
            seen &&
            now - seen > 24 * HOUR
          )
            raise(
              'Trolley missing',
              'High',
              'No movement or reader observation for more than 24 hours outside its assigned area',
            );
        }
        return { ok: true };
      });
    },
    state(user) {
      service.synchronize();
      return {
        settings: policies.settings(),
        alerts: service.listAlerts(user),
        approvals:
          repository.all(`SELECT a.*, u.name AS requester, d.name AS decider, m.source, m.destination, m.movement_type,
          m.policy_flags, m.requires_quality FROM approval_requests a JOIN users u ON u.id = a.requested_by
          LEFT JOIN users d ON d.id = a.decided_by LEFT JOIN movements m ON m.id = a.movement_id ORDER BY a.id DESC`),
        notifications: notificationRows(user),
        verifications: repository
          .all(
            `SELECT v.*, u.name AS operator FROM scan_verifications v JOIN users u ON u.id = v.user_id ORDER BY v.id DESC LIMIT 1000`,
          )
          .map((row) => ({ ...row, ok: Boolean(row.ok), issues: JSON.parse(row.issues) })),
      };
    },
    listAlerts(user, query = {}) {
      const values = [];
      const filters = [];
      const status = readQuery(query, 'status');
      const priority = readQuery(query, 'priority');
      const type = readQuery(query, 'type');
      const trolley = readQuery(query, 'trolley');
      const search = readQuery(query, 'q');
      if (status === 'Active') filters.push("a.status <> 'Resolved'");
      else if (status) {
        if (!['Open', 'Acknowledged', 'Resolved'].includes(status))
          fail(400, 'Invalid alert status');
        filters.push('a.status = ?');
        values.push(status);
      }
      if (priority) {
        if (!PRIORITIES.includes(priority)) fail(400, 'Invalid alert priority');
        filters.push('a.priority = ?');
        values.push(priority);
      }
      if (type) {
        if (!ALERT_TYPES.includes(type)) fail(400, 'Invalid alert type');
        filters.push('a.type = ?');
        values.push(type);
      }
      if (trolley) {
        filters.push('a.trolley = ?');
        values.push(requiredText(trolley, 'trolley'));
      }
      if (search) {
        filters.push('(a.message LIKE ? OR a.trolley LIKE ? OR a.type LIKE ?)');
        const q = `%${optionalText(search, 'search', 120)}%`;
        values.push(q, q, q);
      }
      return repository.all(
        `SELECT a.*, u.name AS acknowledged_name, r.name AS resolved_name FROM alerts a
        LEFT JOIN users u ON u.id = a.acknowledged_by LEFT JOIN users r ON r.id = a.resolved_by
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY a.status = 'Resolved', CASE a.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, a.created DESC`,
        ...values,
      );
    },
    reportIssue(user, input) {
      const trolley = trolleyFor(input.trolley);
      policies.requireLocation(user, trolley.location, 'receive');
      const aliases = {
        'Damaged wheel or frame': 'Trolley maintenance due',
        'Tag unreadable (QR or RFID)': 'Trolley maintenance due',
        'Trolley missing from its location': 'Trolley missing',
        'Wrong trolley at this location': 'Wrong location',
        'Wrong product loaded': 'Wrong product',
      };
      const type = aliases[input.type] || requiredText(input.type, 'issue type');
      if (!ALERT_TYPES.includes(type)) fail(400, 'Unknown issue type');
      const message =
        optionalText(input.message || input.details || input.reason, 'issue details', 1000) ||
        input.type;
      const priority = input.priority || issuePriority(type);
      if (!PRIORITIES.includes(priority)) fail(400, 'Invalid alert priority');
      return repository.transaction(() =>
        raiseWorkflowAlert(repository, user, {
          trolley: trolley.id,
          location: trolley.location,
          type,
          priority,
          message: `${message} (reported by ${user.name})`,
          source: 'manual',
        }),
      );
    },
    alertAction(user, id, action, input = {}) {
      requireRole(user, ALERT_ROLES);
      const resolution = optionalText(
        input.resolution || input.reason || input.remarks,
        'resolution',
        1000,
      );
      return repository.transaction(() => {
        const alert = repository.get('SELECT * FROM alerts WHERE id = ?', integer(id, 'alert ID'));
        if (!alert) fail(404, 'Alert not found');
        policies.requireLocation(user, alert.location, 'receive');
        const now = Date.now();
        const previous = alert.status;
        if (['ack', 'acknowledge'].includes(action)) {
          if (previous !== 'Open') fail(409, 'Only an open alert can be acknowledged');
          repository.run(
            "UPDATE alerts SET status = 'Acknowledged', acknowledged_by = ?, acknowledged_at = ? WHERE id = ?",
            user.id,
            now,
            alert.id,
          );
        } else if (action === 'resolve') {
          if (previous === 'Resolved') fail(409, 'Alert is already resolved');
          repository.run(
            "UPDATE alerts SET status = 'Resolved', resolved_by = ?, resolved_at = ?, resolution = ? WHERE id = ?",
            user.id,
            now,
            resolution,
            alert.id,
          );
        } else if (action === 'reopen') {
          if (previous !== 'Resolved') fail(409, 'Only a resolved alert can be reopened');
          repository.run(
            "UPDATE alerts SET status = 'Open', acknowledged_by = NULL, acknowledged_at = NULL, resolved_by = NULL, resolved_at = NULL, resolution = '', created = ? WHERE id = ?",
            now,
            alert.id,
          );
          deliverNotification(repository, `${alert.type}: ${alert.trolley} alert reopened`, 'warn');
        } else fail(400, 'Unknown alert action');
        repository.audit(user, `Alert ${action}`, alert.trolley, {
          alert: alert.id,
          previous,
          resolution,
        });
        return repository.get('SELECT * FROM alerts WHERE id = ?', alert.id);
      });
    },
    notifications(user) {
      return notificationRows(user);
    },
    markRead(user, input = {}) {
      if (input.all !== true && !Array.isArray(input.ids) && input.id == null)
        fail(400, 'Provide notification IDs or mark all');
      const ids =
        input.all === true
          ? null
          : (input.ids || [input.id]).map((id) => integer(id, 'notification ID'));
      if (ids && ids.length > 1000) fail(400, 'Too many notification IDs');
      return repository.transaction(() => {
        for (const notification of notificationRows(user)) {
          if (ids && !ids.includes(notification.id)) continue;
          repository.run(
            'INSERT INTO notification_reads(notification_id, user_id, read_at) VALUES (?, ?, ?) ON CONFLICT(notification_id,user_id) DO NOTHING',
            notification.id,
            user.id,
            Date.now(),
          );
        }
        return { ok: true };
      });
    },
    verify(user, input) {
      requireRole(user, VERIFY_ROLES);
      const trolley = trolleyFor(input.trolley);
      if (!trolley.active) fail(400, 'Cannot verify an inactive trolley');
      policies.requireLocation(user, trolley.location, 'receive');
      const product = repository.get(
        'SELECT * FROM products WHERE id = ?',
        requiredText(input.product, 'product'),
      );
      if (!product) fail(400, 'Unknown product');
      const batch = optionalText(input.batch, 'batch', 120);
      const issues = [];
      if (!trolley.product)
        issues.push(
          issue(
            'Unassigned trolley',
            'The trolley has no product assigned; record a loaded movement first',
          ),
        );
      else if (trolley.product !== product.id)
        issues.push(
          issue(
            'Wrong product',
            `Trolley is assigned to ${trolley.product}, but ${product.id} was scanned`,
          ),
        );
      if (batch && trolley.batch && trolley.batch !== batch)
        issues.push(
          issue(
            'Mixed batch',
            `Assigned batch ${trolley.batch} differs from scanned batch ${batch}`,
          ),
        );
      if (trolley.unit !== product.unit)
        issues.push(issue('Wrong trolley', 'Product and trolley capacity units do not match'));
      if (
        policies.settings().enforce_categories &&
        !repository.get(
          'SELECT category FROM trolley_categories WHERE trolley_type = ? AND category = ?',
          trolley.type,
          product.category,
        )
      )
        issues.push(
          issue('Wrong trolley', 'Product category is not approved for this trolley type'),
        );
      const location = repository.get('SELECT * FROM locations WHERE id = ?', trolley.location);
      const allowed = JSON.parse(product.allowed_groups || '[]');
      if (allowed.length && !allowed.includes(location.group_name))
        issues.push(issue('Wrong location', 'Product is not permitted at this location group'));
      return repository.transaction(() => {
        const inserted = repository.run(
          'INSERT INTO scan_verifications(trolley,product,batch,user_id,created,trolley_version,ok,issues) VALUES (?,?,?,?,?,?,?,?)',
          trolley.id,
          product.id,
          batch,
          user.id,
          Date.now(),
          trolley.version,
          Number(!issues.length),
          JSON.stringify(issues),
        );
        const id = Number(inserted.lastInsertRowid);
        repository.audit(user, 'Product scan verified', trolley.id, {
          verification: id,
          product: product.id,
          issues,
        });
        return {
          id,
          trolley: trolley.id,
          product: product.id,
          batch,
          trolley_version: trolley.version,
          ok: !issues.length,
          issues,
        };
      });
    },
    requestMismatch(user, input) {
      requireRole(user, VERIFY_ROLES);
      const verification = repository.get(
        'SELECT * FROM scan_verifications WHERE id = ?',
        integer(input.verification ?? input.verification_id, 'verification ID'),
      );
      if (!verification) fail(404, 'Verification not found');
      if (verification.user_id !== user.id && user.role !== 'Admin')
        fail(403, 'Only the verifier can submit this mismatch');
      if (verification.ok) fail(400, 'A matching scan does not require an exception');
      const trolley = trolleyFor(verification.trolley);
      if (verification.trolley_version !== trolley.version)
        fail(409, 'Trolley changed; verify the product again');
      policies.requireLocation(user, trolley.location, 'receive');
      const remarks = optionalText(input.remarks || input.reason, 'remarks', 1000);
      const originApproval =
        input.originApproval == null ? null : integer(input.originApproval, 'original approval ID');
      return repository.transaction(() => {
        if (originApproval) {
          const origin = approvalFor(originApproval);
          if (origin.trolley !== trolley.id || origin.status !== 'Correction Requested')
            fail(400, 'Invalid correction request');
          if (origin.requested_by !== user.id && user.role !== 'Admin')
            fail(403, 'Only the requester can resubmit a correction');
        }
        const pending = repository.get(
          "SELECT * FROM approval_requests WHERE trolley = ? AND kind = 'Product mismatch' AND status = 'Pending'",
          trolley.id,
        );
        if (pending) return { ...pending, duplicate: true };
        const issues = JSON.parse(verification.issues);
        const payload = JSON.stringify({
          verification: verification.id,
          issues,
          version: verification.trolley_version,
          originApproval,
        });
        const result = repository.run(
          'INSERT INTO approval_requests(kind,trolley,product,requested_by,created,remarks,payload) VALUES (?,?,?,?,?,?,?)',
          'Product mismatch',
          trolley.id,
          verification.product,
          user.id,
          Date.now(),
          remarks || issues.map((row) => row.message).join('; '),
          payload,
        );
        const id = Number(result.lastInsertRowid);
        for (const row of issues)
          raiseWorkflowAlert(repository, user, {
            trolley: trolley.id,
            location: trolley.location,
            type: row.type,
            priority: row.type === 'Wrong product' ? 'Critical' : 'High',
            message: row.message,
            source: 'verification',
          });
        repository.audit(user, 'Product mismatch approval requested', trolley.id, {
          approval: id,
          verification: verification.id,
        });
        deliverNotification(repository, `Product mismatch approval needed: ${trolley.id}`, 'warn');
        return repository.get('SELECT * FROM approval_requests WHERE id = ?', id);
      });
    },
    approvalAction(user, id, action, input = {}) {
      const approval = approvalFor(id);
      if (action === 'resubmit') {
        if (approval.status !== 'Correction Requested')
          fail(409, 'Only a correction request can be resubmitted');
        if (approval.requested_by !== user.id && user.role !== 'Admin')
          fail(403, 'Only the requester can resubmit a correction');
        const payload = JSON.parse(approval.payload);
        if (approval.movement_id) {
          const previous = repository.get(
            'SELECT * FROM movements WHERE id = ?',
            approval.movement_id,
          );
          const base = payload.input || {
            trolley: previous.trolley,
            destination: previous.destination,
            product: previous.product,
            batch: previous.batch,
            qty: previous.qty,
            movement_type: previous.movement_type,
            department: previous.department,
            reason: previous.reason,
            remarks: previous.remarks,
            status_after: previous.status_after || 'auto',
            direct_complete: Boolean(previous.direct_complete),
            exceptionReason: previous.exception_reason,
          };
          return movements.request(user, {
            ...base,
            ...input,
            trolley: approval.trolley,
            source: input.source || base.source || previous.source,
            version: input.version,
            key: input.key || randomUUID(),
            expected: input.expected,
            occurred: input.occurred,
            originApproval: approval.id,
          });
        }
        if (input.verification == null && input.verification_id == null)
          fail(400, 'Verify the corrected product before resubmitting');
        const verification = repository.get(
          'SELECT trolley FROM scan_verifications WHERE id = ?',
          integer(input.verification ?? input.verification_id, 'verification ID'),
        );
        if (!verification || verification.trolley !== approval.trolley)
          fail(400, 'Verify the same trolley before resubmitting');
        return service.requestMismatch(user, { ...input, originApproval: approval.id });
      }
      if (!['approve', 'reject', 'correct'].includes(action)) fail(400, 'Unknown approval action');
      if (approval.status !== 'Pending') fail(409, 'Request already decided');
      const reason = optionalText(input.reason ?? input.remarks, 'decision reason');
      if (action !== 'approve' && !reason)
        fail(400, 'A remark is required for rejection or correction');
      if (approval.movement_id) {
        movements.transition(user, approval.movement_id, action, { reason });
        return approvalFor(id);
      }
      requireRole(user, APPROVER_ROLES);
      if (approval.requested_by === user.id)
        fail(403, 'Another authorized user must decide your request');
      const trolley = trolleyFor(approval.trolley);
      policies.requireLocation(user, trolley.location, 'receive');
      const payload = JSON.parse(approval.payload);
      if (action === 'approve' && reason.length < 10)
        fail(400, 'Approving a product exception requires a reason of at least 10 characters');
      if (action === 'approve' && payload.version !== trolley.version)
        fail(409, 'Trolley changed; verify the product again');
      return repository.transaction(() => {
        const current = approvalFor(id);
        if (current.status !== 'Pending') fail(409, 'Request already decided');
        const status =
          action === 'approve'
            ? 'Approved'
            : action === 'reject'
              ? 'Rejected'
              : 'Correction Requested';
        repository.run(
          'UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ?',
          status,
          user.id,
          Date.now(),
          reason,
          approval.id,
        );
        if (action === 'approve')
          resolveWorkflowAlerts(
            repository,
            user,
            trolley.id,
            (payload.issues || []).map((row) => row.type),
          );
        repository.audit(user, `Product exception ${status.toLowerCase()}`, trolley.id, {
          approval: approval.id,
          reason,
        });
        deliverNotification(
          repository,
          `${trolley.id}: product exception ${status.toLowerCase()}${reason ? ` — ${reason}` : ''}`,
          action === 'approve' ? 'info' : 'warn',
          approval.requested_by,
        );
        return approvalFor(id);
      });
    },
    reminder(user, id, input = {}) {
      requireRole(user, APPROVER_ROLES);
      const trolley = trolleyFor(id);
      policies.requireLocation(user, trolley.location, 'receive');
      const last = repository.get(
        'SELECT requested_by FROM movements WHERE trolley = ? ORDER BY id DESC LIMIT 1',
        trolley.id,
      );
      const recipient = trolley.operator_id || last?.requested_by || user.id;
      const message =
        optionalText(input.message, 'reminder', 1000) ||
        `Please follow up trolley ${trolley.id} at ${trolley.location}${trolley.expected ? `; expected return ${new Date(trolley.expected).toISOString()}` : ''}`;
      return repository.transaction(() => {
        const notification = deliverNotification(
          repository,
          `Reminder: ${message}`,
          'warn',
          recipient,
        );
        repository.audit(user, 'Reminder delivered in app', trolley.id, {
          recipient,
          notification,
        });
        return { ok: true, notification, user_id: recipient, channel: 'in-app' };
      });
    },
    markReturned(user, id, input = {}) {
      const trolley = trolleyFor(id);
      if (
        repository.get(
          "SELECT id FROM movements WHERE trolley = ? AND state IN ('Pending','In Transit')",
          trolley.id,
        )
      )
        fail(409, 'Complete or decide the open movement before returning this trolley');
      const store = input.destination
        ? repository.get('SELECT * FROM locations WHERE id = ?', input.destination)
        : repository.get(
            "SELECT * FROM locations WHERE group_name = 'Store' AND id <> ? ORDER BY id LIMIT 1",
            trolley.location,
          );
      if (!store) fail(400, 'Choose a store destination for the empty trolley');
      return movements.request(user, {
        trolley: trolley.id,
        destination: store.id,
        source: trolley.location,
        qty: 0,
        batch: '',
        product: null,
        version: input.version ?? trolley.version,
        key: input.key || randomUUID(),
        movement_type: 'Production Return',
        reason: input.reason || 'Return empty trolley',
        remarks: input.remarks || '',
        direct_complete: true,
        status_after: 'Available',
      });
    },
    configure(user, input) {
      return policies.configure(user, input);
    },
  };
  return service;
}
