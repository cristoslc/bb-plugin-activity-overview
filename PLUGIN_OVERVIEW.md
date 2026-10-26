# Activity Overview

A BB plugin that adds an "Activity Overview" nav panel with four live tabs over all visible threads. One dot = one thread: color reads status, dot volume reads count, dominance emerges from the color pattern; the token flow tab reads where tokens go.

## Surfaces
- Nav panel `Activity Overview` (icon: pulse line, registered as
  `activity-overview/pulse` and used for plugin branding via
  `./icons/pulse.svg`) routed at `/plugins/activity-overview/board`
  - Tab **Board** — fixed-slot project cards, shelf-packed.
  - Tab **Unit treemap** — squarified regions, honest unit-area fill: full-fill status tiles at the fitted view, constant-size dots once zoomed in past 1.2×.
  - Tab **Strip tiles** — 4px-per-thread strips reflowed to fill the width.
  - Tab **Token flow** — the swimlane flow-control stack (projects pile vertically; an expanded row tiles its status tiers as four lanes; every card's river fans from the project's one mouth), served over the `flow` RPC.
  - **What's new**: a gift button in the tab bar lists recent changes after an update — it pulses until opened and never disappears, so the changelog stays reachable.

## No
- CLI commands, settings, secrets, background services, or storage. The backend is a stateless read-only `flow` RPC plus a live push; the aggregate views stay frontend-only.
