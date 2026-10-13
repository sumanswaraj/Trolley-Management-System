# Connected demo

URL: https://smart-trolley-demo.swarajminiscience199.chatgpt.site

The demo is private to the owner account. Open it with the same ChatGPT account used to create it. Its backend runs as a hosted Worker with a persistent D1 database; browser storage is not the source of trolley records.

## Try the workflow

1. Select Operator in the yellow demo toolbar.
2. In Move / scan, select TR-001, choose LINE-1, select GEAR, enter batch B-DEMO, quantity 20 and a future expected time. Record departure, then confirm arrival.
3. Use another available trolley and choose OUTSIDE to try a held request.
4. Switch to Supervisor, open Approvals and approve the request; then confirm arrival.
5. Refresh or revisit the demo. Fleet and movement history read the saved database records.
6. Configure Plant rules to try route/category checks, exception reasons and scoped operations.

The role switcher represents sample actors in a sandbox. It is not production user authentication; entry uses managed ChatGPT sign-in. The demo has 24 sample trolleys and keeps changes/history across visits. The full Node application manages real users and reader credentials. The hosted demo does not connect physical RFID hardware.

## Source and maintenance

The complete tracked hosting source is included under deploy/hosted-demo, with app/hosted services, schema, migrations, frontend, pinned dependencies and Sites build integration. Checkout-local credentials, environment values, runtime data and generated TypeScript cache are excluded. The hosting manifest retains the published Site identity. Use the Sites workflow to update the existing private deployment; do not create a new identity or change its audience accidentally. The hosted demo adapts synchronous local transactions into guarded atomic D1 batches and maintains its own database, separate from a local SQLite installation.

Run npm run test:hosted from the repository root for adapter checks. Three tests cover anonymous denial, shared records, matching retry/concurrent-departure protection and independent outside approvals. Physical integrations and a governed enterprise production rollout remain separate release work.
