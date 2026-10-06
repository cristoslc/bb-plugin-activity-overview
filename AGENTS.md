# Activity Overview plugin — agent guidance

See [PURPOSE.md](PURPOSE.md) for the one-paragraph outcome. Global agent standards live in `~/.agents/AGENTS.md`; this file adds project specifics.

## What lives where

- `app.tsx` — frontend entry: the navPanel registration. Point at `views/Views.tsx`.
- `views/Views.tsx` — the five view components, the `MapCanvas` pan/zoom
  shell (drag/wheel/corner-controls map canvas with floating chrome), and the
  tab page (the Activity flow view carries its own `useShape` RPC hook).
- `views/model.ts` — shared pure pipeline: classification, colors, tree grouping, squarify, shelf packing, and the flow fold/layout pipeline (`indexShape`, `flowDefaultOpen`, `flowChildren`, `flowAge`, `flowLayout` — the latter enforces scope-gated depth and status filtering, `NODE_W`/`NODE_H`/`COL_GAP`/`ROW_GAP`).
- `views/theme.ts` — the plugin's light & dark theme tokens (`THEME_CSS`: light
  block first, dark overrides under bb's `.dark` ancestor; `THEME_TOKENS`).
  All view colors and the status/flow/grey constants in `model.ts` are `var(--attn-…)`
  tokens declared there — no hardcoded hexes in the views.
- `views/timeline.ts` — pure turn normalization over thread timeline rows (copied from the agent-graph plugin).
- `views/lineage.ts` — pure lineage decoration for the shape build: cross-project spawn hints (`spawnHint`) and delegation `childRef` → child-thread links (`delegationChildId`); tests in tests/lineage.test.ts.
- `server.ts` — the stateless read-only `shape` RPC: root → project → thread → turn → work node tree built from live timelines, plus a coalesced `thread:changed` realtime push (SHAPE_CHANGED; payload in shared.ts). This file is no longer an empty stub.
- `skills/activity-views/` — the plugin's own skill: what the views show and their constraints.
- `lib/whats-new.ts`, `lib/changelog-markdown.ts`, `lib/unreleased-changelog.ts` — the What's-new surface ported from the Focus Board plugin: version/prerelease pulse logic, the changelog parsers, and the derivations (see `## Release & What's-new discipline`).
- `scripts/generate-unreleased.mjs`, `scripts/generate-whats-new.mjs` — build-time embeddings of `CHANGELOG.md` into `lib/*.generated.ts` (generated files are committed; no bullet is written twice).
- Design history and verdicts for the encodings live in the bb thread that commissioned this plugin, not in this repo.

## Invariants

- Dominance is read from the dot color pattern ONLY; never paint a region or card with a status-derived fill.
- One thread = one dot/unit; per-thread weight is 1 everywhere.
- Idle dots carry age through brightness (the grey ramp), never through extra hues.
- Line-work is banned in the four aggregate views: grouping comes from
  proximity, voids, and region fills. No seams or outline systems. The
  Activity flow tree is the exception — dashed bezier connectors there are
  parent-child structure, not grouping paint.

## Test command

`npm test` (generates the what's-new feeds from `CHANGELOG.md`, then `node --test tests/*.test.ts`) — layout invariants, classification precedence, lockstep version pins, and the changelog parse contract. Run before any commit touching `views/` or `CHANGELOG.md`.

## Release & What's-new discipline

Full reference: `.agents/agents-md-detail/release.md` (ported from the Focus Board plugin). The short form:

- Merges into `dev` with user-facing behavior append bullets to `CHANGELOG.md`'s `[Unreleased]` group under `### Added/Changed/Fixed` in the same edit; only user-facing behavior earns bullets; one bullet per behavior; the bullet's **bold lead sentence** is the What's-new modal item.
- `dev` carries a prerelease version (`X.Y.Z-dev`) in `package.json`, `package-lock.json`, and `APP_VERSION` (in `lib/whats-new.ts`); the finalize commit renames `[Unreleased]` → `[X.Y.Z] - <date>`, adds a fresh empty group, strips `-dev`, and nothing else — the modal entry derives itself.
- The gift button (tab bar, always present) pulses when the version is unseen (stable) or the `[Unreleased]` group's content changed (dev); opening the modal marks seen.
- After every dev merge: `npm test`, `npm run build`, `bb plugin reload activity-overview` — a missing gift pulse after a changelog-carrying merge is a stale bundle first, a code bug second.

## Build

`bb plugin build` before any install or release; `bb plugin reload activity-overview` after path-install changes.
