import { randomBytes } from 'node:crypto';
import { fail } from '../errors.mjs';
import { requiredText, integer, passwordValue } from '../validation.mjs';
import {
  createPassword,
  verifyPassword,
  tokenHash,
  requireRole,
  USER_ROLES,
  accessFor,
} from '../security.mjs';

export function accountService(repository, initialAdminPassword) {
  if (!repository.get('SELECT id FROM users LIMIT 1')) {
    if (
      typeof initialAdminPassword !== 'string' ||
      initialAdminPassword.length < 12 ||
      initialAdminPassword.length > 256
    ) {
      throw new Error('Set ADMIN_PASSWORD to at least 12 characters for first startup.');
    }
    const password = createPassword(initialAdminPassword);
    repository.run(
      'INSERT INTO users(username, name, role, salt, password) VALUES (?, ?, ?, ?, ?)',
      'admin',
      'Administrator',
      'Admin',
      password.salt,
      password.hash,
    );
  }
  // Bounded, process-local throttling. A shared limiter is needed for multiple nodes.
  const attempts = new Map();
  return {
    login(input, address) {
      const username = requiredText(input.username, 'username');
      const password = passwordValue(input.password);
      const now = Date.now();
      let attempt = attempts.get(address);
      if (!attempt || attempt.until < now) {
        if (attempts.size >= 10000) {
          for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
          if (attempts.size >= 10000) fail(429, 'Login service busy. Try again later');
        }
        attempt = { count: 0, until: now + 15 * 60 * 1000 };
        attempts.set(address, attempt);
      }
      if (attempt.count >= 10) fail(429, 'Too many attempts. Try again in 15 minutes');
      attempt.count += 1;
      const user = repository.get(
        'SELECT * FROM users WHERE username = ? AND active = 1',
        username,
      );
      if (!verifyPassword(password, user)) fail(401, 'Invalid username or password');
      attempt.count = 0;
      const token = randomBytes(32).toString('hex');
      repository.run('DELETE FROM sessions WHERE expires < ?', now);
      repository.run(
        'INSERT INTO sessions VALUES (?, ?, ?)',
        tokenHash(token),
        user.id,
        now + 8 * 60 * 60 * 1000,
      );
      repository.audit(user, 'Signed in', username, {});
      return {
        token,
        user: { id: user.id, name: user.name, role: user.role, access: accessFor(user) },
      };
    },
    authenticate(cookieHeader = '') {
      const token = cookieHeader
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('session='))
        ?.slice(8);
      const user =
        token &&
        repository.get(
          `
        SELECT u.id, u.username, u.name, u.role FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires > ? AND u.active = 1`,
          tokenHash(token),
          Date.now(),
        );
      if (!user) fail(401, 'Sign in required');
      return { user: { ...user, access: accessFor(user) }, token };
    },
    logout(user, token) {
      repository.run('DELETE FROM sessions WHERE token = ?', tokenHash(token));
      repository.audit(user, 'Signed out', user.username, {});
    },
    create(user, input) {
      requireRole(user, ['Admin']);
      const username = requiredText(input.username, 'username');
      const name = requiredText(input.name, 'name');
      const password = passwordValue(input.password);
      if (password.length < 12 || !USER_ROLES.includes(input.role))
        fail(400, 'Use a 12-character password and a valid role');
      const secret = createPassword(password);
      repository.transaction(() => {
        repository.run(
          'INSERT INTO users(username, name, role, salt, password) VALUES (?, ?, ?, ?, ?)',
          username,
          name,
          input.role,
          secret.salt,
          secret.hash,
        );
        repository.audit(user, 'User created', username, { role: input.role });
      });
    },
    list(user) {
      requireRole(user, ['Admin']);
      return repository.all('SELECT id, username, name, role, active FROM users ORDER BY id');
    },
    deactivate(user, input) {
      requireRole(user, ['Admin']);
      const id = integer(input.id, 'user ID');
      if (id === user.id) fail(400, 'You cannot deactivate your own account');
      repository.transaction(() => {
        const target = repository.get('SELECT * FROM users WHERE id = ?', id);
        if (!target) fail(404, 'User not found');
        repository.run('UPDATE users SET active = 0 WHERE id = ?', id);
        repository.run('DELETE FROM sessions WHERE user_id = ?', id);
        repository.audit(user, 'User deactivated', target.username, {});
      });
    },
  };
}
