# Validation evidence — Node 0.5.0

Validated on 2026-10-22 with Node.js 24.19.0 and Chromium 154 on Linux.

## Automated results

| Command                                                           | Result                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run check`                                                   | JavaScript syntax checks passed.                                                     |
| `npm run format:check`                                            | All matched files passed Prettier.                                                   |
| `npm test`                                                        | 46 application/domain/API/rendering tests passed; none failed or skipped.            |
| `npm run test:hosted`                                             | 3 separate hosted-adapter tests passed; this is not hosted 0.5 parity or deployment. |
| `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser` | 13 browser journeys passed.                                                          |
| `npm run test:load`                                               | 400 requests, 20 concurrent clients, 50 trolleys, zero failures.                     |
| `git diff --check`                                                | No whitespace errors.                                                                |

The load run completed in 10,249 ms with p50 395 ms and p95 813 ms while other validation work was running. This is an isolated local smoke test, not a production throughput guarantee or enterprise service level.

Application coverage includes account/session permissions, six roles, rich master records and identity uniqueness, migration and restart preservation, online backup/restore, optimistic versions, idempotency, load/capacity/unit checks, independent quality/exception approval, correction/resubmission, physical receipt/direct entry semantics, overdue deadlines after receipt, per-user notifications, alert lifecycle, signed reader evidence, eight report types and real export formats.

Export tests read actual XLSX cells, CSV rows and paginated PDF output, including more than a preview page of records and long cells. Filtered history exports retain every matching row. Metric tests distinguish physical issue/return turnaround from request-to-receipt duration; backdated direct entries do not invent approval waits.

## Browser and visual evidence

The browser suite covers all fourteen screens, ten dashboard KPIs, eight reports, seven analytics panels, theme persistence, master registration/edit/activation and QR download, manual/QR/RFID lookup, unknown-code handling, issue reporting/acknowledgement/resolution, notification reads, independent mismatch approval, correction/resubmission, real XLSX/PDF/CSV downloads, guarded sample restoration, phone movement/receipt, Plant Manager monitoring, camera decoder fallback and permission denial, plant policy configuration and one-time reader provisioning.

An additional local functional check visited all fourteen screens with external browser requests blocked. No external requests or browser errors occurred. Desktop screenshots at 1440px and phone screenshots at 390px were inspected. Phone pages had no page-wide horizontal overflow. Escape restored focus to the trolley-detail trigger, and theme changes retained a partially entered movement form. The application uses local fonts/icons/QR assets, SVG charts and server-side exports.

## Reproduction

```sh
npm ci --ignore-scripts
npm run check
npm run format:check
npm test
npm run test:hosted
CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run test:browser
npm run test:load
```

Use `npx playwright install chromium` if no compatible Chromium is installed. Browser installation needs connectivity; local application use does not after dependencies are prepared. All automated operational fixtures use isolated databases.

## Limits

Linux results do not establish Windows CMD integration, real camera/device coverage, physical RFID drivers, durable device buffering, Docker execution, public HTTPS, multi-hour soak, multiple application instances, security certification or enterprise availability. Those need separate evidence.

The private hosted demo remains the separate older D1/managed-identity adapter in `deploy/hosted-demo`. These changes do not automatically redeploy or port the Node application there. The historical 0.4 evidence is available in Git history and is not reused as current acceptance.

## Handover documentation review — 1 November 2026

Added [handover.md](../handover.md) and its README entry, recorded continuation tasks/memory, corrected API master creation to Admin-only and removed the stale `public/ui.js` architecture reference. No application behavior, dependency, migration or deployment files changed.

`npm run format:check`, local Markdown link-target validation for the changed documents and `git diff --check` passed. The report's setup/recovery procedures, roles, source map and limits were checked against the implementation and runbooks. The software/browser/load suites above were not rerun for this documentation-only update; their acceptance date remains 22 October 2026. Remote CI execution and platform/device acceptance are not established by these checks.
