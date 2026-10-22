# Reusable project working rules

These conventions apply to this project and can guide future projects. Explicit user instructions and repository-specific requirements take precedence.

## Keep one coherent source of truth

1. User instructions define the authorized goal and constraints.
2. `prd.md` defines agreed behavior and acceptance criteria.
3. `design.md` defines the interface; `architecture.md` defines technical responsibilities.
4. `tasks.md` tracks execution and unfinished checks.
5. `memory.md` records durable decisions and verified outcomes.

Resolve contradictions at the governing source and update dependent documents. Do not silently invent requirements, drop requested features or mark an unfinished task complete.

## Work in small, complete units

Inspect the current code, existing changes, setup documentation and instructions before editing. Reuse established workflows and package/version pins. Keep unrelated changes out of the task. Each cloud task already has an isolated environment; use its checkout and create a worktree only if the user requests one.

Separate presentation, orchestration and domain behavior. Prefer focused modules and clear names. Share real repeated logic without adding speculative abstractions. Comments should explain a non-obvious reason, constraint or invariant; do not narrate straightforward code or add decorative comment blocks.

## Protect users and data

Authorize actions on the server, validate input at boundaries and escape untrusted output. Use transactions for coordinated changes. Preserve data during upgrades and make migrations repeatable through version tracking. Do not bypass approval, receipt, idempotency, audit or concurrency safeguards for a visual match.

Check existing configuration and credential presence before requesting new requirements. Never print or commit secrets, dump environment values, copy local databases into distributable artifacts or place credentials in documentation. Use supported secure environment settings and retain TLS, signature and checksum verification.

Keep demo fixtures isolated and clearly labeled. Empty real data should produce an empty state, not fabricated operational activity. Represent unsupported hardware and deployment behavior honestly.

## Build usable interfaces

Start from the agreed visual reference. Keep consistent navigation, labels, hierarchy and spacing. Provide keyboard access, visible focus, semantic labels, clear errors, responsive layouts and reduced motion. Treat every visible control as a behavior commitment; implement it or explain a genuine prerequisite. Keep technical implementation details out of routine operator flows.

Prefer local assets when offline operation is required. Test with external network requests blocked. Make data-based charts and exports traceable to stored records.

## Verify completion

Choose checks that test meaningful behavior and regression risks. Run the repository's required checks plus relevant domain/API, browser and visual acceptance checks. Do not replace a functional test with syntax success or an install result. Once checks pass, repeat them only when new changes or unresolved evidence justify it.

Record what changed, why, what was actually tested and any material limitation. Keep acceptance checkboxes open until evidence supports them. Update documents when implementation changes scope.

## Commit and publish carefully

Before a commit, inspect the diff and status, confirm that intended files and lockfiles match the change, and remove generated artifacts and secrets. Use a clear problem/behavior-focused message and include relevant validation. Commit or push when the current user instruction authorizes it; do not treat a documentation checklist as independent authorization.

Preserve unrelated user work. Do not rewrite shared history, force-push, merge, deploy or publish without applicable authorization. If an authorized push is blocked, report the exact blocker while completing all useful local work. Never claim a commit, push, deployment or platform-specific test that did not occur.
