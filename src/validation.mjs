import { fail } from './errors.mjs';

export function requiredText(value, label, maxLength = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    fail(400, `Invalid ${label}`);
  }
  return value.trim();
}

export function finiteNumber(value, label, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    fail(400, `Invalid ${label}`);
  }
  return value;
}

export function integer(value, label, minimum = 1) {
  finiteNumber(value, label, minimum);
  if (!Number.isSafeInteger(value)) fail(400, `Invalid ${label}`);
  return value;
}

/** Password whitespace is meaningful; never normalize or trim it. */
export function passwordValue(value, minimumLength = 1) {
  if (typeof value !== 'string' || value.length < minimumLength || value.length > 256) {
    fail(400, `Password must contain ${minimumLength} to 256 characters`);
  }
  return value;
}
