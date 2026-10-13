/** Expected application failures are safe to return to the caller. */
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function fail(status, message) {
  throw new AppError(status, message);
}
