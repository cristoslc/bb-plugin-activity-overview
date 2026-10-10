# Activity Overview

A BB plugin that adds an "Activity Overview" nav panel with three live tabs over all visible threads. One dot = one thread: color reads status, dot volume reads count, dominance emerges from the color pattern.

## Surfaces
- Nav panel `Activity Overview` (icon: pulse line, registered as
  `activity-overview/pulse` and used for plugin branding via
  `./icons/pulse.svg`) routed at `/plugins/activity-overview/board`
  - Tab **Board** — fixed-slot project cards, shelf-packed.
  - Tab **Unit treemap** — squarified regions, honest constant-pitch dot fill.
  - Tab **Strip tiles** — 4px-per-thread strips reflowed to fill the width.
  - **What's new**: a gift button in the tab bar lists recent changes after an update — it pulses until opened and never disappears, so the changelog stays reachable.

## No
- CLI commands, settings, secrets, background services, storage, RPCs. The views are frontend-only; the backend entry is a load-only stub.
