# Activity Overview plugin — agent guidance

See [PURPOSE.md](PURPOSE.md) for the one-paragraph outcome. Global agent standards live in `~/.agents/AGENTS.md`; this file adds project specifics.

## What lives where

- `app.tsx` — frontend entry: the navPanel registration. Point at `views/Views.tsx`.
- `views/Views.tsx` — the three view components and the tab page.
- `views/model.ts` — shared pure pipeline: classification, colors, tree grouping, squarify, shelf packing.
- `server.ts` — backend stub (required by the manifest; the plugin owns no server state).
- `skills/activity-views/` — the plugin's own skill: what the views show and their constraints.
- Design history and verdicts for the encodings live in the bb thread that commissioned this plugin, not in this repo.

## Invariants

- Dominance is read from the dot color pattern ONLY; never paint a region or card with a status-derived fill.
- One thread = one dot/unit; per-thread weight is 1 everywhere.
- Idle dots carry age through brightness (the grey ramp), never through extra hues.
- Line-work is banned: grouping comes from proximity, voids, and region fills. No seams or outline systems.

## Test command

`npm test` (runs `node --experimental-strip-types --test tests/`) — layout invariants and classification precedence. Run before any commit touching `views/`.

## Build

`bb plugin build` before any install or release; `bb plugin reload activity-overview` after path-install changes.
