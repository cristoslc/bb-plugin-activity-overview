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
- **Token flow** — the amplitude wave (below), ported from
  `docs/user-experience/sankey-amplitude-wave-mockup.html`.

## Token flow (the amplitude wave)

A provider → project → family sankey where one thread is one river that leaves
its provider block, passes through its project's stacked bar, and lands on the
thread's own card row in the family column. Painted with hand-rolled SVG (no
libraries), colors from `views/theme.ts`; the layout math is pure
(`tokenFlowLayout` and the river path helpers in views/model.ts).

- **Candles = total spend.** Each card row carries its thread's total tokens
  (context-window usage) as a left-edge bar, provider-colored, bottom-aligned
  in the row; the row is sized tall enough to hold the whole candle, so a
  project's candle run equals its middle bar's height exactly. Zero-spend rows
  carry a full-slot grey no-data bar. The totals px-per-token is a design
  constant (the biggest spender gets 200px), shrunk only when the rail would
  otherwise overflow the artboard.
- **Three encodings**, switched from the floating chrome:
  - **A · ribbon wave** — each river's width is its thread's burn per
    interval, all the way back to the provider face; the busiest bucket sets a
    fixed interval scale (56px). This is the default.
  - **B · trace lane** — totals bands plus a per-member share bar (each
    member's share of its family's window total).
  - **C · burn envelope** — totals bands with an inner per-interval crest at
    its own mini-scale.
- **Cards cluster by project** (alphabetical, matching the middle column, so
  rivers never cross needlessly) with a large gutter between clusters and a
  small gap between cards inside one; a faint project caption sits over each
  cluster.
- **Selection lighting**: clicking a family enlarges its cards with a ~250ms
  ease-out tween and lights *only that family's members* — the selected
  threads' rivers, candles, and project slices stay lit while everything else
  dims; re-clicking the same family (or empty space) releases it. Hover
  lifts a provider's, project's, or family's rivers.
- **Beads** stream along running threads at their sampled burn rate; a quiet
  thread is a flat stream with its tok/min label. A 15 min / last hour window,
  pause, and a speed slider ride the floating chrome, and wheel zooms, drag
  pans, double-click resets (viewBox camera, not MapCanvas).
- **Data**: the `flow` RPC reads each thread's persisted `usedTokens` (the
  totals) and resamples the plugin's local sample ring of positive context
  growth into equal wall-clock buckets (the burn profile). The host persists
  no lifetime consumption, so totals are context usage and the sampler tracks
  only since the plugin started; unrecognized providers ride the "other" row
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
- The Token flow tab is a structural sankey, not an aggregate: its ribbons
  and card bars are line/area work (like the removed Activity flow's dashed
  connectors were), and its region fills come from the `--attn-prov-*` tokens,
  never from status.
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