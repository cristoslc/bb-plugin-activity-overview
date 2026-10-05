---
name: activity-views
description: "What the Activity Overview plugin shows and how it reads thread data."
---

# Activity Overview plugin views

The Activity Overview plugin adds an "Activity Overview" nav panel in the BB sidebar with five
tabs: four aggregate tabs rendered live from the host's sidebar thread data, plus the
**Activity flow** tab, served by the plugin's own backend over the `shape` RPC.

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
- **Activity flow** — the dive view: project → thread → turn → work, built
  server-side from each thread's turn timeline and rendered as a horizontal
  tidy tree (Agent Graph style): one node card per level (240×58px cards,
  64px column gap), depth = column, children stack vertically under an
  expanded parent, parent card centers on its children's extent, dashed
  bezier connectors from parent right edge to child left edge, a chevron on
  each foldable card. Fold policy is pure (views/model.ts): projects open,
  hot threads open, only the newest turn of a running thread expands by
  default; "+N earlier steps/turns" markers mark what the server trimmed
  (the work-level marker unfolds on click). Click a node for details in the
  footer; double-click a thread (or use its footer button) to open the thread;
  the layout lives in `flowLayout` (views/model.ts) with tests in
  tests/model.test.ts.
  - **Scope gating**: at top scope, projects expand to thread rows only —
    turn and step chevrons do not exist there. Clicking a project or thread
    card focuses its subtree (breadcrumb All / project / thread in the
    toolbar climbs back out; clicking the focused card steps up one level).
    Turns and work only unfold inside a scope; a cold scoped thread survives
    its status filter.
  - **Filters**: the footer legend counts double as solo status-filter
    chips: click "error 4" to see only error threads, click it again to show
    all. The "Active only" toolbar button is the idle-excluding preset
    (running/waiting/error/queued, on by default).

## Map-style interface

The tab page is a full-bleed map canvas (Google Maps / OpenStreetMap style),
not a scrolling document. Each view lays out into a fixed-size **world layer**
that fills the entire panel viewport; the operator pans by dragging anywhere,
zooms with the mouse wheel (around the cursor, 0.2×–5×) or the floating
+/−/fit controls at the bottom-right, and "⤢" fits the whole world into the
view (never zooming past 1×). Dragging never lands as a click: a pan within
the last 200ms suppresses card clicks and double-clicks. All chrome floats
above the canvas:

- Tab switcher — floating card top-left.
- Legend + caption — floating card bottom-left, pointer-events-none so
  tooltips pass through (hidden on the flow tab, whose footer chips serve the
  same purpose).
- Activity flow toolbar (breadcrumb, Active only, Expand/Collapse, To
  running, thread count) — floating card top-right.
- Activity flow footer (status chips, selected-node details) — floating card
  bottom, pannable canvas behind it.
- Dragging captures the pointer only after a real drag starts (moved >3px);
  capturing before that retargets card clicks to the canvas root and eats
  the cards' click and double-click handlers.

Openings: aggregate tabs open with the whole world fitted and centered
inside a chrome-free fit box (`SAFE` top 60 / bottom 88 / side 12px, plus a
16px `GAP` breathing ring); the Unit treemap is sized to exactly fill the
fit box, and the Board and Strip tiles grow their slot/tile scale (capped
2×) and re-shelve so their shelves use the fit box's height, the way the
treemap fills its rect. The flow tree opens in `contain` mode: contain-width
scale floored at 0.8× so cards stay legible, vertically centered on the root
card; scope and status-filter changes re-center there via `openAt`, while
plain data refetches keep the camera. "⤢" re-fits the whole world.
`panTo` ("To running") lands its target in the fit box's center.
`MapCanvas` (views/Views.tsx) owns the pan/zoom state and clamps the world
so content never fully leaves the viewport and clamped extremes keep a
16px margin instead of butting flush against the edges; aggregate views
report their world size through the `onWorld` callback (the world is exactly
the content block, no baked-in padding). The flow tab shows a spinner
throbber while the `shape` RPC builds the tree from live thread timelines.

## Reading the dots

- Status classification (most urgent wins): needs-you (pending interaction) >
  error > working (active) > unread > idle.
- Colors: error #e5534b, needs-you #d9a53f, working #3d84e0 (pulses), unread
  #2e9e45, idle grey fading with age (#a8b3bf toward #2a3038).
- Dominance is always read from the dot color pattern; no region is ever
  painted with a status override.
- The Activity flow tab reuses the four dot palette hues for its node dots
  but is a structural tree, not an aggregate: it is the one view allowed
  connector lines (dashed bezier edges), because grouping there is
  parent-child structure, not dot dominance.
- Hover any dot for the thread tooltip.

## Operating constraints

- The four aggregate tabs are pure frontend views over sidebar thread data;
  they have no CLI commands, no settings, and no server state. Data
  refreshes when BB's sidebar data refreshes.
- The Activity flow tab has one backend: the stateless read-only `shape`
  RPC (server.ts) plus a coalesced `thread:changed` realtime push. Timelines
  are cached per thread (200 entries) and every structural change evicts the
  cache before the push.
- Flow shape caps: hot threads keep 8 turns, cold threads 1; each turn keeps
  its newest 8 work rows (+4 for cold threads) behind a "+N earlier steps"
  marker; turns beyond the cap collapse into a "+N earlier turns" marker;
  a 2500-node ceiling drops the coldest threads last (the header shows
  "truncated" when it engages).
- Rendering constants live in views/model.ts, views/Views.tsx and server.ts;
  the fold policy tests are in tests/model.test.ts.
