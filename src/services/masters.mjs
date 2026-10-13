import { fail } from '../errors.mjs';
import { requiredText, finiteNumber } from '../validation.mjs';
import { requireRole, MANAGER_ROLES } from '../security.mjs';

export function masterService(repository) {
  return {
    create(user, kind, input) {
      requireRole(user, MANAGER_ROLES);
      const id = requiredText(input.id, 'ID', 40);
      repository.transaction(() => {
        if (kind === 'locations') {
          repository.run(
            'INSERT INTO locations(id, name, external) VALUES (?, ?, ?)',
            id,
            requiredText(input.name, 'name'),
            input.external === true ? 1 : 0,
          );
        } else if (kind === 'products') {
          repository.run(
            'INSERT INTO products(id, name, category, unit) VALUES (?, ?, ?, ?)',
            id,
            requiredText(input.name, 'name'),
            requiredText(input.category || 'Unspecified', 'category'),
            requiredText(input.unit || 'pcs', 'unit', 20),
          );
        } else if (kind === 'trolleys') {
          const location = requiredText(input.location, 'location');
          if (!repository.get('SELECT id FROM locations WHERE id = ?', location))
            fail(400, 'Unknown location');
          repository.run(
            'INSERT INTO trolleys(id, type, capacity, location, unit) VALUES (?, ?, ?, ?, ?)',
            id,
            requiredText(input.type, 'type'),
            finiteNumber(input.capacity, 'capacity', 1),
            location,
            requiredText(input.unit || 'pcs', 'unit', 20),
          );
        } else fail(404, 'Unknown master type');
        repository.audit(user, 'Master created', id, { kind });
      });
    },
    state(user) {
      return {
        user,
        locations: repository.all('SELECT * FROM locations ORDER BY id'),
        products: repository.all('SELECT * FROM products ORDER BY id'),
        activeMovements: repository.all(
          "SELECT m.*, u.name AS requester FROM movements m JOIN users u ON m.requested_by = u.id WHERE state IN ('Pending', 'In Transit') ORDER BY m.id DESC",
        ),
        trolleys: repository.all('SELECT * FROM trolleys ORDER BY id'),
        movements: repository.all(`SELECT m.*, u.name AS requester FROM movements m
          JOIN users u ON m.requested_by = u.id ORDER BY m.id DESC LIMIT 50`),
        audit: MANAGER_ROLES.includes(user.role)
          ? repository.all(`SELECT a.*, u.name AS actor_name FROM audit a
          JOIN users u ON a.actor = u.id ORDER BY a.id DESC LIMIT 50`)
          : [],
      };
    },
  };
}
