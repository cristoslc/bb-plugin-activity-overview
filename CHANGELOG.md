# Changelog

All notable changes to this project are documented here. Format: Keep-a-Changelog 1.1.0.

Bullet discipline (the What's-new modal reads these, see `.agents/agents-md-detail/release.md`): every bullet opens with a **bold lead sentence** — that sentence, condensed, is the modal item — one bullet per behavior, written Slack-style in one short sentence (at most two beyond the lead); related facets indent two spaces as sub-bullets; published sections are never back-edited.

## [Unreleased]

### Added

- **Every view color now follows bb's theme — light and dark.** All colors are plugin tokens in `views/theme.ts`, declared light-first with dark overrides under bb's `.dark` ancestor; ink, surface and line tokens derive from bb's own CSS custom properties (with standalone fallbacks), so custom bb themes recolor the views for free. The idle age ramp mixes muted ink into the stage (theme-relative fade), and the family tint previews got pastel light-mode variants of the same six hues.
- **The Activity Overview panel now has a What's-new surface.** A gift button sits in the tab bar, always present, pulsing after every update until opened; it opens a modal listing the changelog's condensed entries and marks the version seen. The feed, the dev-build pulse keying to the [Unreleased] group's content, and the empty-group silence all derive from this file at test/build time — the changelog is the single source of truth.

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

- **The Activity flow's loading throbber is actually visible now.** Headless UAT (puppeteer + paint profiling) caught it as a 4×22px unstyled sliver — the compiled tailwind only matches inside the host's plugin scope — and later as hidden behind the tab bar: the spinner is now fully inline-styled (no class dependencies), centered in the panel clear of the chrome, and the plugin's keyframes `<style>` block stays mounted through every loading state.

- **The Activity flow loading spinner is actually visible now.** It uses inline styles over a plugin-local `attn-spin` keyframes rule instead of host-compiled tailwind classes, which the host's CSS did not include for plugin content.

### Changed

- **Views reflow to the measured panel width** instead of packing into a fixed 1120px stage that forced horizontal scrolling.
- **Board one-dot cards are at least 120px wide** (wider slot grids), so short project names no longer truncate to a few characters.
- **The legend now shows per-status counts** with label sizes and contrast bumped (treemap labels 10px #98a8b6, board/tile labels 11px #9fb4c8).
- **Thread timestamps aligned to the SDK's epoch-number types**, leaving `tsc --noEmit` clean.
