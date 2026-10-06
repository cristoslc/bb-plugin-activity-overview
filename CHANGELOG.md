# Changelog

All notable changes to this project are documented here. Format: keep-a-changelog.

## Unreleased

_Nothing yet._

## 0.2.0 — 2026-10-05

- Scaffolded as a BB plugin at 0.1.0.
- Fixed: views now reflow to the measured panel width instead of packing into a fixed 1120px stage that forced horizontal scrolling.
- Fixed: board one-dot cards are at least 120px wide (wider slot grids), so short project names no longer truncate to a few characters.
- Changed: legend now shows per-status counts; label sizes/contrast bumped (treemap labels 10px #98a8b6, board/tile labels 11px #9fb4c8).
- Chore: thread timestamps aligned to the SDK's epoch-number types; `tsc --noEmit` is clean.
- Added: light & dark theming — every view color is a plugin token (`views/theme.ts`), declared light first with dark overrides under bb's `.dark` ancestor; ink/surface/line tokens derive from bb's own CSS custom properties with standalone fallbacks, and the idle age ramp mixes muted ink into the stage so the fade is theme-relative.
- Added: a fourth tab, Agent lanes — the thread-family tree as edge-less lane rows (dot per thread, indent per depth level, project regions).
- Added: a fifth tab, Activity flow — the dive view: project → thread → turn → work, served by the new stateless `shape` RPC (backend built from live turn timelines).
- Changed: Activity flow rebuilt from nested lists into an Agent Graph-style tidy tree — node cards in depth columns, dashed bezier connectors, chevron folds, a status legend with counts, click-for-details in the footer, and double-click to open the thread.
- Added: Activity flow fold scopes and filters — clicking a project or thread focuses its subtree (toolbar breadcrumb All / project / thread climbs back out); turn and step chevrons only exist inside a scope; footer legend counts are solo status-filter chips (click to show only that status, again to reset); "Active only" stays as the idle-excluding preset.
- Added: map-style interface for every tab — a full-bleed pan/zoom world layer (drag pan, wheel zoom 0.2×–5× around the cursor, floating ⤢/+/− controls, chrome-free fitBox openings with margin clamping) with floating chrome: tabs top-left, legend bottom-left, flow toolbar top-right, flow footer bottom. The treemap fills the fit box exactly; Board and Strip tiles rescale (capped 2×) and re-shelve to fill the fit-box height; Activity flow opens at a legible contain-width scale centered on its root card and re-centers on scope/filter changes.
- Fixed: the Activity flow loading spinner now uses inline styles over a plugin-local `attn-spin` keyframes rule instead of host-compiled tailwind, so it is actually visible while the `shape` RPC builds.
- Added: camera-state persistence over bb forward/back — the last-visited tab and each tab's last camera (zoom and pan) survive in the session store (`activity-overview:camera`); returning to the panel reopens exactly where the operator left it, with stale transforms clamped against the live viewport.
