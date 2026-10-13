# Validation evidence for 0.3.0

Validated with Node.js 24.19.0 in the development workspace:

- npm run check: all frontend/backend/test/script JavaScript syntax passes.
- npm test: ten tests pass.
- API tests cover login, server roles, outside approvals, self-approval denial, duplicate requests, stale versions, simultaneous receipts, invalid loads, cross-origin rejection, account deactivation and restart persistence.
- SQL tests verify audit and movement history protections.
- A live SQLite online backup was restored and its masters and in-transit movement verified.
- Static-serving tests verify JavaScript modules, CSP and denial of server/database file access.
- Frontend template tests cover all pages, role-specific navigation and HTML escaping.

A browser executable was not available in this workspace, so desktop/mobile visual rendering and real browser interaction have not been verified. Docker build, GitHub Actions, physical readers, HTTPS deployment, load/soak and external security review have not been run. They are release checks, not claims implied by passing integration tests.
