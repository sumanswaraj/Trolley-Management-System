# Smart Trolley Management System

Interactive shopfloor prototype for Digitron Technologies.

## Run locally

Run `python -m http.server 8080` in this directory and open http://localhost:8080.
Alternatively, open index.html directly. Internet access is required for fonts, charts, QR generation and spreadsheet/PDF exports loaded from CDNs.

## Implemented prototype workflows

- Dashboard and location map, trolley master and status tracking.
- Record movements, issue/return, product and batch checks.
- Approval queues, alerts, movement history and audit trail.
- Role-based demo views, reports and browser persistence.

## Current boundaries

This is a browser-local demo, not a deployed multi-user system. Role switching is not authentication. Camera preview is a placeholder. RFID gates are simulated. Historical analytics include generated sample values. Browser storage and audit entries can be edited or cleared. No backend or real devices are connected.

See IMPLEMENTATION_PLAN.md for the production implementation sequence.
