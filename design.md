# Workspace design

Status: implemented in Node 0.5.0. Desktop and phone layouts were inspected, and browser acceptance covers navigation, dialogs, forms and exports.

## Reference and layout

Use `public/prototype.html` as the visual reference. It is a design specimen, not the operational application or a source of trusted runtime data. Its generated records, simulated identities and remote scripts must not enter the authenticated workspace.

Desktop uses a fixed 248px dark sidebar, sticky light/dark header and a centered content area with a maximum width of 1500px. The sidebar has the amber trolley mark, compact icon navigation, active-page accent and workspace status. The header contains trolley search, a local clock, notifications, theme controls and the current account.

At widths below 900px, use a dismissible navigation drawer. At phone widths, show compact header controls and bottom navigation with a More button. Preserve comfortable touch targets and prevent content from being obscured by fixed navigation.

## Visual system

- Use the reference palette: slate workspace background, white cards, deep blue accent, amber highlights and dark navy navigation.
- Use system sans-serif and monospace font stacks so offline operation never waits for a font service.
- Use 12px card radii, restrained borders/shadows, compact headings and generous spacing between operational groups.
- Preserve distinct colors and text labels for available, in-use, transit, waiting, maintenance, overdue, outside and inactive states.
- Prefer reusable classes for cards, KPI groups, filters, badges, tables, forms, timelines, maps, charts and dialogs.
- Use inline static SVG symbols for icons and self-contained SVG for charts. Charts must summarize real events and retain understandable labels.

## Interaction

Global search accepts a trolley ID, QR value or RFID value. A result reveals current identity and context before an operator records a movement. Filters and pagination remain visible close to the records they change.

Dialogs have an accessible title, a labeled close button, Escape handling and focus restoration. Forms have persistent labels, inline errors, meaningful submit labels and disabled/busy states. Destructive or irreversible operational actions explain their effect and record the required reason.

Notifications show real events and unread state. Account identity is informational; access changes require the authenticated account workflow. A cosmetic role switcher must not grant permissions.

## Accessibility and responsiveness

Provide semantic landmarks, visible focus, keyboard navigation, live status announcements, label associations and reduced-motion behavior. Do not communicate state by color alone. Keep wide tables inside scroll containers and provide trolley cards where phone readability benefits. Hidden mobile navigation must not leave off-screen controls in the tab order.

## Modules

`experience-shell.js` renders the shared shell, login and dialogs. `experience.css` owns reference styling and compatibility for existing administration forms. Page renderers own their page content; the controller owns events, API calls, state and focus behavior. See [architecture.md](architecture.md) for runtime responsibilities and [tasks.md](tasks.md) for verification work.
