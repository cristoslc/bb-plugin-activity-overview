# Changelog

All notable changes to this project are documented here. Format: Keep-a-Changelog 1.1.0.

Bullet discipline (the What's-new modal reads these, see `.agents/agents-md-detail/release.md`): every bullet opens with a **bold lead sentence** — that sentence, condensed, is the modal item — one bullet per behavior, written Slack-style in one short sentence (at most two beyond the lead); related facets indent two spaces as sub-bullets; published sections are never back-edited.

## [Unreleased]

### Added

- **Hovering a thread dot now shows a card with the full thread title and the end of its conversation.** The card replaces the bare browser tooltip and says who spoke last, or states plainly that the thread has no conversation yet, so an unfamiliar dot can be identified without opening it.
- **A Working dot's pulse now tracks how fast the thread is burning tokens.** The blink period follows the thread's measured token rate, so a thread consuming 10× the tokens pulses 10× as fast; a thread with a rate that cannot be measured yet keeps the original pulse, and one measured at zero holds the slowest blink rather than freezing or strobing.
- **Clicking a thread dot while zoomed in now opens that thread in bb's default view.** Zoom past the fit (or focus a project) and every dot becomes a control: clicking one opens its thread, and clicking away — or the new top-right close control — returns to the fitted view, where dots stay inert so the region-zoom gesture is unchanged.
- **The Token flow tab is now a swimlane flow-control stack.** Projects pile vertically, one wide row each; expanding a row tiles its status tiers across the width (Working, Needs You, Unread, Idle, left to right, hottest threads first), so the runaway thread is always the top row of the Working lane, and every card's river fans out of that project's single mouth.
  - Threads nest inside their parent's card, recursing to a grandchild and stopping there; a collapsed parent's river carries its whole subtree's flow, marked `Σ … tok/min`, and drops to its own flow once expanded (its bar and total keep the subtree sum), so a set that disaggregates stops reading as one wide river.
  - Each lane scrolls on its own; a collapsed row shows tokens, live tok/min, thread/working counts, the provider-mix strip, and the hottest thread's burn sparkline; rivers paint in front of the cards, translucent, with white beads for live activity.
  - The `flow` RPC is unchanged — same totals, same sampled burn buckets, same live `FLOW_CHANGED` push.

### Changed

- **The Board opens at the same size as the Unit treemap now.** Its shelves grow to fill the chrome-free fit box (solving for the largest slot scale whose pack still fits the height, capped at 2×), so the opening camera lands at 1× instead of leaving unused viewport; a one- or two-project roster stays capped rather than ballooning into a poster.
- **Every treemap project shows its title at every zoom and pan.** Titles moved to a screen-space layer drawn at a fixed size and decoupled from the camera, one chip per visible project seated without overlap — small projects are labeled at fit and no title shrinks away when the camera zooms out.

### Fixed

- **A running thread under a non-running parent now shows up in the Working lane.** Threads were only ever drawn inside their parent's card, so a running child of an idle or waiting thread never reached the Working lane: the row reported working threads while the lane looked empty and nothing animated. A child now stays nested only when it shares its parent's lane; otherwise it is promoted to its own lane's top level, and each lane's header count matches the cards it draws.
- **A camera saved while the roster was a different shape no longer hides the fitted opening.** The store now stamps each camera with the world dimensions it was captured on, and a restore whose world no longer matches is discarded, so the Board opens at the treemap's size again after the world changes.
- **The Board no longer opens off-centre on a first load.** The panel's first world was its pre-measurement placeholder, so the opening fit was computed before the panel was measured and the roster sat pushed to one side until a tab switch; the opening now waits for the measured panel and re-fits as the world settles, and a stale stored camera can no longer win over it.
- **The Board no longer re-reports its world every render.** Its model rebuilds against a fresh clock on each pass, so equal-but-new bounds kept re-entering the page and re-rendering it; the report is now deduped by value, ending the update loop the zoomed-in camera work exposed.

## [0.3.0] - 2026-10-18

### Removed

- **The Agent lanes, Activity flow and Token flow tabs are gone.** The panel keeps the three aggregate dot views (Board, Unit treemap, Strip tiles); the backend whose sole job was serving the flow and token-flow RPCs was removed with them, so the plugin is now frontend-only.

### Added

- **Every view color now follows bb's theme — light and dark.** All colors are plugin tokens in `views/theme.ts`, declared light-first with dark overrides under bb's `.dark` ancestor; ink, surface and line tokens derive from bb's own CSS custom properties (with standalone fallbacks), so custom bb themes recolor the views for free. The idle age ramp mixes muted ink into the stage (theme-relative fade), and the family tint previews got pastel light-mode variants of the same six hues.
- **The Activity Overview panel now has a What's-new surface.** A gift button sits in the tab bar, always present, pulsing after every update until opened; it opens a modal listing the changelog's condensed entries and marks the version seen. The feed, the dev-build pulse keying to the [Unreleased] group's content, and the empty-group silence all derive from this file at test/build time — the changelog is the single source of truth.
- **Clicking a project in the Unit treemap now zooms it to fill the view.** Tapping away or hitting fit restores the full board. While zoomed in, hovering a project previews one soft background tint per thread family, with press-and-hold standing in on touch devices.

### Fixed

- **Zooming no longer slides cards under the top nav.** The vertical pan clamp keeps the floating tab bar's margin clear, so project titles stay readable at every zoom level.
- **Family tint previews are actually visible now.** The per-family background slots render at full opacity instead of half-transparent over the same-key region fill, which read as no highlight at all.
  - The six tint hues were pulled far enough from the card fill to read at a glance in both themes — saturated deep blocks on dark, pigmented pastels on light — while status dots keep their legibility on top.
- **Fit, restore and the pan clamps survive any tab interaction.** The views' world size is cached per tab, so re-clicking the active tab or racing a remount can no longer null the world — the bug that no-opped the camera's fit/restore and let zoomed content slide under the top nav mid-session.

## [0.2.0] - 2026-10-05

### Added

- **The Activity Overview nav panel arrived with three live tabs** (Board, Unit treemap, Strip tiles), ported from the prototype generators. The plugin scaffolded as a BB plugin at 0.1.0.
- **A fourth tab, Agent lanes**, shows the thread-family tree as edge-less lane rows — a dot per thread, indent per depth level, project regions.
- **A fifth tab, Activity flow**, is the dive view: project → thread → turn → work, served by the new stateless `shape` RPC whose backend builds from live turn timelines.
- **Activity flow rebuilt from nested lists into an Agent Graph-style tidy tree** — node cards in depth columns, dashed bezier connectors, chevron folds, a status legend with counts, click-for-details in the footer, and double-click to open the thread.
- **Activity flow gained fold scopes and filters.** Clicking a project or thread focuses its subtree (toolbar breadcrumb All / project / thread climbs back out); turn and step chevrons only exist inside a scope; footer legend counts are solo status-filter chips (click to show only that status, again to reset); "Active only" stays as the idle-excluding preset.
- **Every tab moved onto a map-style interface.** A full-bleed pan/zoom world layer carries drag pan, wheel zoom 0.2×–5× around the cursor, floating ⤢/+/− controls, and chrome-free fit-box openings with margin clamping, under floating chrome: tabs top-left, legend bottom-left, flow toolbar top-right, flow footer bottom. The treemap fills the fit box exactly, Board and Strip tiles rescale (capped 2×) and re-shelve to fill the fit-box height, and Activity flow opens at a legible contain-width scale centered on its root card, re-centering on scope/filter changes.
- **The last camera now survives bb forward/back.** The last-visited tab and each tab's last camera (zoom and pan) persist in the session store (`activity-overview:camera`), so returning to the panel reopens exactly where the operator left it, with stale transforms clamped against the live viewport.

### Fixed

- **The Activity flow loading spinner is actually visible now.** It uses inline styles over a plugin-local `attn-spin` keyframes rule instead of host-compiled tailwind classes, which the host's CSS did not include for plugin content.

### Changed

- **Views reflow to the measured panel width** instead of packing into a fixed 1120px stage that forced horizontal scrolling.
- **Board one-dot cards are at least 120px wide** (wider slot grids), so short project names no longer truncate to a few characters.
- **The legend now shows per-status counts** with label sizes and contrast bumped (treemap labels 10px #98a8b6, board/tile labels 11px #9fb4c8).
- **Thread timestamps aligned to the SDK's epoch-number types**, leaving `tsc --noEmit` clean.
