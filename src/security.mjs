import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fail } from './errors.mjs';

export const USER_ROLES = Object.freeze([
  'Admin',
  'Plant Manager',
  'Supervisor',
  'Operator',
  'Quality User',
  'Store User',
]);
export const MANAGER_ROLES = Object.freeze(['Admin', 'Supervisor']);
export const APPROVER_ROLES = Object.freeze(['Admin', 'Supervisor', 'Plant Manager']);

export function requireRole(user, allowedRoles) {
  if (!allowedRoles.includes(user.role)) fail(403, 'Your role cannot perform this action');
}
export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}
export function createPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
export function verifyPassword(password, user) {
  const actual = scryptSync(password, user?.salt || 'missing-user', 64);
  const expected = Buffer.from(user?.password || '00'.repeat(64), 'hex');
  return timingSafeEqual(actual, expected) && Boolean(user);
}
export function sessionCookie(token, secure, maxAge = 28800) {
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
