---
name: activity-views
description: "What the Activity Overview plugin shows and how it reads thread data."
---

# Activity Overview plugin views

The Activity Overview plugin adds an "Activity Overview" nav panel in the BB sidebar with three
aggregate tabs, all rendered live from the host's sidebar thread data. The backend is a load-only
stub: no RPCs, no state.

- **Board** — one card per project, fixed dot slots (13px pitch). Volume of
  dots = thread count; color = status; empty slots stay put so daily change
  lands in a familiar spot.
- **Unit treemap** — region area = thread count (squarified); each thread
  occupies its true unit area as one constant-size dot; neutral region fill,
  thin voids separate projects, no strokes. The tab rides the shared
  `MapCanvas` (wheel zoom, drag pan, corner controls). Zoomed in past 1.2×,
  hovering a project previews its family structure — one subtle background
  tint per thread family (`familyTints`, `FAMILY_TINTS` in views/model.ts;
  family-derived, never status-derived). On touch, press-and-hold (~400ms)
  on a project gives the same preview, which stays on until the next press.
  Clicking/tapping a project focuses it: the other projects dim to 30%
  opacity and the camera zooms (MapCanvas `openRect`) so the project fills
  the fit box with its family tints locked on. Tapping anything else — the
  dimmed neighbors or a void — re-fits the zoomed-out world and clears the
  focus (the corner ⤢ re-fits the camera only; one tap then leaves the
  focus). Helpers are pure (`familyTints`,
  `zoomToRect`, `clampPan`) with tests in tests/model.test.ts.
- **Strip tiles** — one small tile per project: name over a strip, one 4px
  unit per thread (4px + 1px gap), hottest statuses at the left edge. Tiles
  flow-wrap to fill the panel width.

## Map-style interface

The tab page is a full-bleed map canvas (Google Maps / OpenStreetMap style),
not a scrolling document. Each view lays out into a fixed-size **world layer**
that fills the entire panel viewport; the operator pans by dragging anywhere,
zooms with the mouse wheel (around the cursor, 0.2×–5×) or the floating
+/−/fit controls at the bottom-right, and "⤢" fits the whole world into the
view (never zooming past 1×). Dragging never lands as a click: a pan within
the last 200ms suppresses card clicks and double-clicks. All chrome floats
above the canvas:

- Tab switcher — floating card top-left, with the What's-new gift button at
  its end (always present; pulses after an update until opened).
- Legend + caption — floating card bottom-left, pointer-events-none so
  tooltips pass through.
- Dragging captures the pointer only after a real drag starts (moved >3px);
  capturing before that retargets card clicks to the canvas root and eats
  the cards' click and double-click handlers.

Openings: aggregate tabs open with the whole world fitted and centered
inside a chrome-free fit box (`SAFE` top 60 / bottom 88 / side 12px, plus a
16px `GAP` breathing ring); the Unit treemap is sized to exactly fill the
fit box, and the Board and Strip tiles grow their slot/tile scale (capped
2×) and re-shelve so their shelves use the fit box's height, the way the
treemap fills its rect.
`MapCanvas` (views/Views.tsx) owns the pan/zoom state and clamps the world
so content never fully leaves the viewport and clamped extremes keep a
16px margin instead of butting flush against the edges; aggregate views
report their world size through the `onWorld` callback (the world is exactly
the content block, no baked-in padding).

## Reading the dots

- Status classification (most urgent wins): needs-you (pending interaction) >
  error > working (active) > unread > idle.
- Colors: error #e5534b, needs-you #d9a53f, working #3d84e0 (pulses), unread
  #2e9e45, idle grey fading with age (#a8b3bf toward #2a3038).
- Dominance is always read from the dot color pattern; no region is ever
  painted with a status override.
- Hover any dot for the thread tooltip.

## Operating constraints

- The three aggregate tabs are pure frontend views over sidebar thread data;
  they have no CLI commands, no settings, and no server state (the backend
  entry is a load-only stub — the plugin build requires one). Data
  refreshes when BB's sidebar data refreshes.
- Rendering constants live in views/model.ts and views/Views.tsx; the layout
  and classification tests are in tests/model.test.ts.