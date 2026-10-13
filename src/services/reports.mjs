import { fail } from '../errors.mjs';
import { requireRole, MANAGER_ROLES } from '../security.mjs';

function positiveParameter(value, label, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum)
    fail(400, `Invalid ${label}`);
  return number;
}

/** Keyset pagination gives complete histories without unbounded response bodies. */
export function reportService(repository) {
  return {
    history(user, kind, query) {
      const limit = positiveParameter(query.get('limit'), 'limit', 50, 100);
      const cursor = positiveParameter(query.get('before'), 'cursor', null);
      const from = positiveParameter(query.get('from'), 'start time', null);
      const to = positiveParameter(query.get('to'), 'end time', null);
      if (from && to && from > to) fail(400, 'Start time must not exceed end time');
      if (kind === 'audit') requireRole(user, MANAGER_ROLES);
      const alias = kind === 'audit' ? 'a' : 'm';
      const timestamp = kind === 'audit' ? 'ts' : 'created';
      const conditions = [];
      const parameters = [];
      if (cursor) {
        conditions.push(`${alias}.id < ?`);
        parameters.push(cursor);
      }
      if (from) {
        conditions.push(`${alias}.${timestamp} >= ?`);
        parameters.push(from);
      }
      if (to) {
        conditions.push(`${alias}.${timestamp} <= ?`);
        parameters.push(to);
      }
      if (query.get('trolley')) {
        conditions.push(`${alias}.${kind === 'audit' ? 'entity' : 'trolley'} = ?`);
        parameters.push(query.get('trolley'));
      }
      const select =
        kind === 'audit'
          ? 'SELECT a.*, u.name AS actor_name FROM audit a JOIN users u ON a.actor = u.id'
          : 'SELECT m.*, u.name AS requester FROM movements m JOIN users u ON m.requested_by = u.id';
      const rows = repository.all(
        `${select}${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''}
        ORDER BY ${alias}.id DESC LIMIT ?`,
        ...parameters,
        limit + 1,
      );
      const more = rows.length > limit;
      const items = rows.slice(0, limit);
      return { items, nextCursor: more ? items.at(-1).id : null };
    },
    summary(user, query) {
      const from = positiveParameter(query.get('from'), 'start time', Date.now() - 30 * 86400000);
      const to = positiveParameter(query.get('to'), 'end time', Date.now());
      if (from > to) fail(400, 'Start time must not exceed end time');
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
  };
}
