---
name: activity-views
description: "What the Activity Overview plugin shows and how it reads thread data."
---

# Activity Overview plugin views

The Activity Overview plugin adds an "Activity Overview" nav panel in the BB sidebar with four
tabs: three aggregate tabs rendered live from the host's sidebar thread data, plus the
**Token flow** tab, whose per-thread burn history is served by the plugin's backend over the
`flow` RPC (see below).

- **Board** — one card per project, fixed dot slots (13px pitch). Volume of
  dots = thread count; color = status; empty slots stay put so daily change
  lands in a familiar spot.
- **Unit treemap** — region area = thread count (squarified); each thread
  occupies its true unit area as one constant-size dot; neutral region fill,
  thin voids separate projects, no strokes. Every project shows its title at
  every zoom and pan: the labels live in a screen-space layer drawn at a fixed
  size, decoupled from the camera, one chip per visible project seated without
  overlap (`placeRegionLabels`, `treemapLayout` in views/model.ts). The tab
  rides the shared `MapCanvas` (wheel zoom, drag pan, corner controls). Zoomed
  in past 1.2×, hovering a project previews its family structure — one subtle
  background tint per thread family (`familyTints`, `FAMILY_TINTS` in
  views/model.ts; family-derived, never status-derived). On touch,
  press-and-hold (~400ms) on a project gives the same preview, which stays on
  until the next press. Clicking/tapping a project focuses it: the other
  projects dim to 30% opacity and the camera zooms (MapCanvas `openRect`) so
  the project fills the fit box with its family tints locked on. Tapping
  anything else — the dimmed neighbors or a void — re-fits the zoomed-out
  world and clears the focus (the corner ⤢ re-fits the camera only; one tap
  then leaves the focus). Helpers are pure (`familyTints`, `treemapLayout`,
  `placeRegionLabels`, `zoomToRect`, `clampPan`, `fillScale`) with tests in
  tests/model.test.ts and tests/board-fill-labels.test.ts.
- **Strip tiles** — one small tile per project: name over a strip, one 4px
  unit per thread (4px + 1px gap), hottest statuses at the left edge. Tiles
  flow-wrap to fill the panel width.
- **Token flow** — the swimlane flow-control stack (below), ported from
  `docs/user-experience/token-flow-swimlane-mockup.html`.

## Token flow (the swimlane stack)

A flow-control display, not an aggregate: projects pile vertically, one wide
landscape row each, and an expanded row tiles its status tiers across the width
as four lanes — Working, Needs You, Unread, Idle, left to right. Painted with
hand-rolled SVG (no libraries), colors from `views/theme.ts`; the layout math is
pure (`swimlaneLayout`, `buildForest`, `subtreeFlow`/`subtreeRate`, `bandW`,
`riverOpacity`, and the river path builders in views/model.ts) and the view
paints it, owns the open sets, scrolls the lanes, and animates the beads.

The goal, quoted from the commissioning thread: *"to see what the current token
flow distribution looks like, in order to spot out-of-control threads … primarily
a flow control display, with secondary benefits of seeing threads the operator
may need to act on."*

- **Status lanes fold five statuses into four.** Working ← `running`; Needs You
  ← `waiting`/`error`/`queued` (an error card carries a red ring); Unread ←
  `done`/`interrupted`; Idle ← `idle` (its dot fades on the age grey ramp).
  Every lane sorts its threads by whole-subtree flow, highest at the top, so the
  runaway thread is the first row of the Working lane.
- **Three tiers, two axes.** Tier 1 Provider is a vertical spine of colored
  blocks on the left (`TIER 1 · providers`). Tier 2 Project is the vertical
  stack of wide rows, hottest project first — never tiled. Tier 3 Thread tiles
  *inside* an expanded row: four lanes across its width.
- **Every card's river fans from the one project-level mouth** — the single dot
  at the Working lane's top-left, fed by the project header. Rivers are never
  inherited through ancestry; a filled provider-colored band, thickness = the
  card's shown flow, white beads = live activity. Needs You / Unread / Idle carry
  no rivers. Rivers paint in front of every card, deepest first.
- **Collapsed shows the subtree sum; expanded drops to own flow.** A thread that
  heads a group reports `Σ … tok/min` while collapsed (its whole subtree's flow,
  so the set reads as one river); open, it drops to `own … tok/min` because the
  descendants now report theirs. Its bar and total always show the subtree sum.
- **Threads nest inside their parent's card only when they share its lane.**
  A child in the same lane nests inside the parent's card (indented, recursing
  parent → child → grandchild, hard-capped at the grandchild, `MAX_DEPTH = 2`,
  toggled by the `▸ N sub` / `▾ N nested` chip); a child in a *different* lane
  is **promoted to its own lane's top level** (`containedForest` in
  views/model.ts). That promotion is what keeps the display honest: a running
  thread under an idle or waiting parent would otherwise hide inside the
  parent's card, leaving the Working lane empty of the very threads the view
  exists to surface. A lane's header count is therefore always the number of
  cards it draws, and clicking a row header opens its lanes.
- **Each lane scrolls independently** (its own rail) and is capped at the Working
  lane's height, so a crowded lane overflows into its own scroll rather than
  growing the row. Collapsed rows show tokens, live tok/min, thread/working
  counts, the provider-mix strip, and the hottest thread's burn sparkline.
- **Data**: the `flow` RPC (server.ts) reads each thread's persisted
  `usedTokens` (the totals) and resamples the plugin's local sample ring of
  positive context growth into equal wall-clock buckets (the burn profile) —
  unchanged by this view. Unrecognized providers ride the "other" row
  (`providerOfModel` in views/model.ts — the server imports it).

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
fit box, and the Board solves for the largest slot scale whose shelf pack
still fits the fit box's height (capped 2×) and re-shelves at that scale, so
its opening camera also lands at 1× — the whole roster fills the viewport the
way the treemap fills its rect. Strip tiles still grows its tile scale
(capped 2×) and re-wraps at that scale.
`MapCanvas` (views/Views.tsx) owns the pan/zoom state and clamps the world
so content never fully leaves the viewport and clamped extremes keep a
16px margin instead of butting flush against the edges; aggregate views
report their world size through the `onWorld` callback (the world is exactly
the content block, no baked-in padding).

## Reading the dots

- Status classification (most urgent wins): needs-you (pending interaction) >
  error > working (active) > unread > idle.
- Colors: error #e5534b, needs-you #d9a53f, working #3d84e0 (pulses at its
  measured token burn: 10× the tokens, 10× the pulse), unread
  #2e9e45, idle grey fading with age (#a8b3bf toward #2a3038).
- Dominance is always read from the dot color pattern; no region is ever
  painted with a status override.
- The Token flow tab is a structural flow display, not an aggregate: its
  rivers and card bars are line/area work (like the removed Activity flow's
  dashed connectors were), their fills come from the `--attn-prov-*` tokens,
  and its neutral lane/row fills are never status-derived — status shows only
  as dots and lane headers.
- Hover any dot for a card with the full thread title, status, age, and the end
  of its conversation. The card portals into the panel root, so it never
  scales with the camera; a thread whose rate is not measurable yet keeps the
  base pulse, and a measured zero holds the slowest blink (never frozen).

## Operating constraints

- The three aggregate tabs are pure frontend views over sidebar thread data;
  they have no CLI commands and no settings. The one backend read they make is
  the `pulse` RPC (the burn-rate map for the working-dot blink); the hover
  card's snippet comes from the `threadCard` RPC, fetched once per thread per
  session and never re-fetched. Data refreshes when BB's sidebar data
  refreshes.
- The Token flow tab's backend is the plugin's `flow` RPC (server.ts): a
  stateless read of each thread's context usage plus a local sample ring,
  pushed live over the coalesced `FLOW_CHANGED` realtime channel. Streaming
  deltas feed the sampler, they do not rebuild anything.
- Rendering constants live in views/model.ts and views/Views.tsx; the layout
  and classification tests are in tests/model.test.ts, and the token-flow
  pipeline tests in tests/token-flow.test.ts.