# Plant policy configuration

## Product and capacity units

Products have a category and unit. Trolleys have a type and capacity unit. All existing records migrate to category Unspecified and unit pcs; confirm these values before real use. Loaded movements require matching product/trolley units and quantity not above capacity. A policy exception cannot override incompatible units or capacity. Empty trolleys must use no product and quantity zero.

## Compatibility and routes

Add allowed category/trolley-type pairs and source/destination/category routes in Plant rules. Use category Empty for an unloaded route. Enable enforcement only after configuring the intended rules. This explicit opt-in preserves existing version 0.3 installations and avoids inventing plant routes. Rules and toggles are audited.

A route can require quality release. Ordinary supervisors cannot approve such a route. A different Quality User or Admin can release a compliant internal request. When quality release is combined with outside-plant approval or policy exceptions, the approver must be an Admin; multi-stage approval chains are future work.

## Exception requests

Wrong trolley category, unlisted routes, and a declared product/batch differing from the current load cause policy mismatches. The requester must provide at least 10 characters explaining an exception. The request is held Pending without changing the trolley's location, status or declared load. A different authorized approver must supply a reason of 10 to 500 characters to release it. Original flags and request reason are immutable snapshots; the approval reason is retained in history. Rejection leaves history intact and releases the open-request lock.

## Location permissions

Administrators can assign departure and receipt/approval rights by user and location. When scoped operations are enabled, non-admins need explicit access. A user requesting departure needs rights at the source. Receipt and decisions need rights at the destination. Administrators retain access to avoid configuration lockout. Fleet visibility remains plant-wide; these scopes constrain mutations, not data visibility.

## History and reports

Movements and audit history support keyset pagination, time ranges and trolley filters. The UI loads older records and exports the complete movement history through paged reads rather than silently limiting it to the dashboard snapshot. Audit details are limited to supervisors and administrators. Operational reports count recorded requests and calculate request-to-receipt time, including approval wait. Daily grouping uses UTC. Reporting does not invent historical utilization or turnaround data.
