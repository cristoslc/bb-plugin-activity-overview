# Changelog

All notable changes to this project are documented here. Format: keep-a-changelog.

## Unreleased

- Added: the Activity Overview nav panel with three live tabs (Board, Unit treemap, Strip tiles), ported from the prototype generators.
- Scaffolded as a BB plugin at 0.1.0.
- Fixed: views now reflow to the measured panel width instead of packing into a fixed 1120px stage that forced horizontal scrolling.
- Fixed: board one-dot cards are at least 120px wide (wider slot grids), so short project names no longer truncate to a few characters.
- Changed: legend now shows per-status counts; label sizes/contrast bumped (treemap labels 10px #98a8b6, board/tile labels 11px #9fb4c8).
- Chore: thread timestamps aligned to the SDK's epoch-number types; `tsc --noEmit` is clean.
