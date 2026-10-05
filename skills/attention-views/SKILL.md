---
name: attention-views
description: "What the Attention plugin shows and how it reads thread data."
---

# Attention plugin views

The Attention plugin adds an "Attention" nav panel in the BB sidebar with three
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
