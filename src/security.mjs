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
export const APPROVER_ROLES = Object.freeze(['Admin', 'Plant Manager', 'Supervisor']);

const ALL_PAGES = [
  'dashboard',
  'master',
  'scan',
  'live',
  'overdue',
  'movement',
  'locations',
  'history',
  'products',
  'alerts',
  'approvals',
  'reports',
  'analytics',
  'settings',
];

export const ROLE_ACCESS = Object.freeze({
  Admin: {
    pages: ALL_PAGES,
    perms: ['master', 'movement', 'approve', 'alert', 'verify', 'reports', 'settings'],
  },
  'Plant Manager': {
    pages: [
      'dashboard',
      'live',
      'overdue',
      'locations',
      'history',
      'products',
      'alerts',
      'approvals',
      'reports',
      'analytics',
    ],
    perms: ['approve', 'alert', 'reports'],
  },
  Supervisor: {
    pages: [
      'dashboard',
      'master',
      'scan',
      'live',
      'overdue',
      'movement',
      'locations',
      'history',
      'products',
      'alerts',
      'approvals',
    ],
    perms: ['movement', 'approve', 'alert', 'verify'],
  },
  Operator: {
    pages: ['dashboard', 'scan', 'live', 'movement', 'history', 'alerts'],
    perms: ['movement'],
  },
  'Quality User': {
    pages: ['dashboard', 'scan', 'live', 'movement', 'products', 'history', 'alerts'],
    perms: ['movement', 'verify', 'alert'],
    types: ['Quality Inspection', 'Quality Release', 'Transfer'],
  },
  'Store User': {
    pages: ['dashboard', 'master', 'scan', 'live', 'movement', 'history', 'products', 'alerts'],
    perms: ['movement'],
    types: ['Production Issue', 'Production Return', 'Store Transfer', 'Transfer'],
  },
});

export function accessFor(user) {
  const access = ROLE_ACCESS[user.role];
  return access
    ? {
        pages: [...access.pages],
        perms: [...access.perms],
        ...(access.types ? { types: [...access.types] } : {}),
      }
    : { pages: [], perms: [] };
}

export function canAccessPage(user, page) {
  return Boolean(ROLE_ACCESS[user.role]?.pages.includes(page));
}

export function requirePermission(user, permission) {
  if (!ROLE_ACCESS[user.role]?.perms.includes(permission))
    fail(403, 'Your role cannot perform this action');
}

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
