import { fail } from '../errors.mjs';
import { integer, requiredText } from '../validation.mjs';
import { requireRole, MANAGER_ROLES } from '../security.mjs';

/** Policy is configured by the plant; defaults preserve existing installations. */
export function policyService(repository) {
  const settings = () => repository.get('SELECT * FROM plant_settings WHERE id = 1');
  return {
    settings,
    describe(user) {
      requireRole(user, MANAGER_ROLES);
      return {
        settings: settings(),
        categories: repository.all(
          'SELECT * FROM trolley_categories ORDER BY trolley_type, category',
        ),
        routes: repository.all(
          'SELECT * FROM allowed_routes ORDER BY source, destination, category',
        ),
        scopes:
          user.role === 'Admin'
            ? repository.all('SELECT * FROM user_locations ORDER BY user_id, location')
            : [],
      };
    },
    configure(user, input) {
      requireRole(user, ['Admin']);
      const keys = [
        'enforce_routes',
        'enforce_categories',
        'scope_operations',
        'outside_approval',
        'mismatch_approval',
      ];
      const supplied = keys.filter((key) => key in input);
      if (!supplied.length) fail(400, 'Provide at least one policy setting');
      for (const key of supplied)
        if (typeof input[key] !== 'boolean') fail(400, `Provide a boolean for ${key}`);
      repository.transaction(() => {
        const previous = settings();
        repository.run(
          `UPDATE plant_settings SET ${supplied.map((key) => `${key} = ?`).join(', ')} WHERE id = 1`,
          ...supplied.map((key) => Number(input[key])),
        );
        repository.audit(user, 'Plant policy updated', 'plant', { previous, current: input });
      });
      return settings();
    },
    addRule(user, kind, input) {
      requireRole(user, MANAGER_ROLES);
      repository.transaction(() => {
        if (kind === 'categories') {
          repository.run(
            'INSERT INTO trolley_categories VALUES (?, ?) ON CONFLICT(trolley_type, category) DO NOTHING',
            requiredText(input.trolley_type, 'trolley type'),
            requiredText(input.category, 'category'),
          );
        } else if (kind === 'routes') {
          const source = requiredText(input.source, 'source');
          const destination = requiredText(input.destination, 'destination');
          if (source === destination) fail(400, 'Route must have different locations');
          for (const id of [source, destination]) {
            if (!repository.get('SELECT id FROM locations WHERE id = ?', id))
              fail(400, 'Unknown route location');
          }
          repository.run(
            `INSERT INTO allowed_routes VALUES (?, ?, ?, ?)
            ON CONFLICT(source, destination, category) DO UPDATE SET requires_quality = excluded.requires_quality`,
            source,
            destination,
            requiredText(input.category, 'category'),
            Number(input.requires_quality === true),
          );
        } else if (kind === 'scopes') {
          requireRole(user, ['Admin']);
          const userId = integer(input.user_id, 'user ID');
          const location = requiredText(input.location, 'location');
          if (
            !repository.get('SELECT id FROM users WHERE id = ?', userId) ||
            !repository.get('SELECT id FROM locations WHERE id = ?', location)
          ) {
            fail(400, 'Unknown user or location');
          }
          repository.run(
            `INSERT INTO user_locations VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, location) DO UPDATE SET can_depart = excluded.can_depart, can_receive = excluded.can_receive`,
            userId,
            location,
            Number(input.can_depart === true),
            Number(input.can_receive === true),
          );
        } else fail(404, 'Unknown policy rule');
        repository.audit(user, 'Plant rule configured', kind, input);
      });
    },
    requireLocation(user, location, action) {
      if (user.role === 'Admin' || !settings().scope_operations) return;
      const scope = repository.get(
        'SELECT * FROM user_locations WHERE user_id = ? AND location = ?',
        user.id,
        location,
      );
      const permitted = action === 'depart' ? scope?.can_depart : scope?.can_receive;
      if (!permitted) fail(403, `Your account cannot ${action} at this location`);
    },
    evaluate(trolley, destination, product, quantity, batch) {
      const currentSettings = settings();
      const flags = [];
      if (quantity > 0 && trolley.unit !== product.unit)
        fail(400, 'Product and trolley capacity units must match');
      if (
        quantity > 0 &&
        currentSettings.enforce_categories &&
        !repository.get(
          'SELECT category FROM trolley_categories WHERE trolley_type = ? AND category = ?',
          trolley.type,
          product.category,
        )
      ) {
        flags.push('Product category is not approved for this trolley type');
      }
      const category = quantity > 0 ? product.category : 'Empty';
      const route = repository.get(
        'SELECT * FROM allowed_routes WHERE source = ? AND destination = ? AND category = ?',
        trolley.location,
        destination,
        category,
      );
      if (currentSettings.enforce_routes && !route)
        flags.push('Route is not approved for this product category');
      if (
        quantity > 0 &&
        trolley.qty > 0 &&
        (trolley.product !== product.id || trolley.batch !== batch)
      ) {
        flags.push('Declared product or batch differs from the current trolley load');
      }
      if (quantity > 0 && product.allowed_groups) {
        const allowed = JSON.parse(product.allowed_groups);
        const location = repository.get('SELECT * FROM locations WHERE id = ?', destination);
        if (allowed.length && !allowed.includes(location.group_name))
          flags.push('Product is not approved for the destination location group');
      }
      return { flags, requiresQuality: Boolean(route?.requires_quality) };
    },
  };
}
