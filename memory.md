# Project memory

Keep this file short and factual. Record decisions, their reason and verified outcomes; use `tasks.md` for current work and `prd.md` for requirements.

## Established context

- Repository: `sumanswaraj/Trolley-Management-System`, primary branch `main`.
- The existing full Node application provides authenticated accounts, SQLite persistence, transactional movements, plant rules, QR labels/scanning, reader provisioning and audit history.
- `public/prototype.html` preserves the supplied visual prototype. Its screen structure is the current design reference; its simulated data and role switching are not production authentication.
- Local/offline use is a continuing requirement. Operational assets must not require Google Fonts, a CDN, a hosted identity service or a network request to render the local workspace.
- An earlier Windows offline bundle was assembled with a verified official Node runtime. Linux checks do not establish Windows/CMD or physical-hardware validation.

## Current decisions

- Implement the reference's fourteen pages and six roles in the real persistent application.
- Retain old administration, reader and policy capabilities inside Settings instead of removing them during the interface rebuild.
- Split shared shell, page renderers, controller and styles so behavior remains reviewable.
- Preserve server authorization and movement integrity when adding reference actions.
- Use local system fonts, static SVG icons and locally implemented charts/exports.
- Use the correctly spelled `architecture.md` as the canonical root architecture document. The user's earlier spelling referred to architecture; it does not require a typo-named duplicate.
- The task's implementation scope authorizes source changes. Onboarding's earlier source-preservation rule applied to environment setup, not this feature implementation.

## Verification status

Node 0.5.0 was validated on 2026-10-22 with Node.js 24.19.0 and Chromium 154 on Linux. The integrated run passed 46 application tests, 3 separate hosted-adapter tests and 13 browser journeys. The isolated 400-request load smoke had zero failures. Syntax, formatting and whitespace checks passed.

All fourteen screens were exercised with external browser requests blocked. Desktop and 390px phone screenshots were inspected; modal Escape focus restoration, page overflow and preservation of movement input across theme changes were verified. Migration, restart, backup and reader-history preservation are covered by the application tests.

Master creation/editing requires Admin, matching the reference permission matrix; Supervisor can view the register and use authorized operational workflows. Correction resubmission requires the original requester or Admin.

Windows execution, actual cameras/RFID hardware, Docker, public HTTPS and the separate hosted demo deployment were not validated or updated by these local checks. No prepared cloud-workspace ZIP should be presented as a public download. GitHub delivery must be reported only after push succeeds.

The source is committed locally as c84bd3b on `codex/trolley-v0.5.0`. The authorized `git push -u origin codex/trolley-v0.5.0` received HTTP 403 because connected account `swarajsuman321-dev` lacks repository write access. Preserve the local branch. After the user corrects GitHub access, retry that push and verify the remote ref; do not change Git author identity or request a token in chat as an authentication workaround.

## Recording rules

Never record credential values, tokens, customer data or a complete environment dump here. Separate observations from assumptions. When a decision changes, update the requirement/design/task that governs it and summarize the reason here; avoid leaving contradictory instructions across documents.
