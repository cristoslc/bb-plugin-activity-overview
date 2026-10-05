---
name: activity-views
description: "What the Activity Overview plugin shows and how it reads thread data."
---

# Activity Overview plugin views

The Activity Overview plugin adds an "Activity Overview" nav panel in the BB sidebar with four
tabs, all rendered live from the host's sidebar thread data:

- **Board** — one card per project, fixed dot slots (13px pitch). Volume of
  dots = thread count; color = status; empty slots stay put so daily change
  lands in a familiar spot.
- **Unit treemap** — region area = thread count (squarified); each thread
  occupies its true unit area as one constant-size dot; neutral region fill,
  thin voids separate projects, no strokes.
- **Strip tiles** — one small tile per project: name over a strip, one 4px
  unit per thread (4px + 1px gap), hottest statuses at the left edge. Tiles
  flow-wrap to fill the panel width.
- **Agent lanes** — the thread-family tree (parent/spawned-under links from
  the sidebar data), encoded edge-less: one unit dot per thread, hierarchy =
  horizontal indent per depth level, family blocks contiguous, projects
  packed as neutral-fill regions (`#131a22`) with voids between cards, no
  connector lines and no outlines. Threads whose parent is invisible
  (deleted, archived, or outside the page) promote to roots, and
  parentThreadId cycles are severed into roots so the walk stays finite.

## Reading the dots

- Status classification (most urgent wins): needs-you (pending interaction) >
  error > working (active) > unread > idle.
- Colors: error #e5534b, needs-you #d9a53f, working #3d84e0 (pulses), unread
  #2e9e45, idle grey fading with age (#a8b3bf toward #2a3038).
- Dominance is always read from the dot color pattern; no region is ever
  painted with a status override.
- Hover any dot for the thread tooltip.

## Operating constraints

- The plugin has no CLI commands, no settings, and no server state; it is a
  pure frontend view. Data refreshes when BB's sidebar data refreshes.
- Rendering constants live in views/model.ts and views/Views.tsx.
