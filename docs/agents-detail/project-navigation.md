# Project Navigation

## Starting points
- `PURPOSE.md` — one-paragraph outcome
- `README.md` — user-facing landing page
- `AGENTS.md` — agent guidance + `## Test command` + `## Store & media`

## Scripts (not under docs/)
- `scripts/screenshot/` — the render/UAT harness and the media runs (`shoot.mjs`, `capture-tab-tour-gif.mjs`).
- `scripts/uat/` — YAML-suite runner, the shared harness starter, and the store-evidence run.
- `scripts/store/` + `store/entry.json` — the bb community marketplace listing and its validator. See `AGENTS.md` `## Store & media`.

## Hubs and spokes
- `docs/ARCHITECTURE.md` → `docs/technical-architecture/` (c4/, tech-stack.md)
- `docs/DOMAIN-MODEL-L1.md` → `docs/domain-architecture/` (CONTEXT-MAP, DOMAIN-EVENTS, DOMAIN-MODEL-L2, events/)
- Cross-cutting: `docs/DEVELOPER-WORKFLOWS.md`, `docs/USER-EXPERIENCE.md`, `docs/agents-detail/`
- `docs/adr/`, `docs/plans/`, `docs/musings/`, `docs/retros/`, `docs/tech-debt/` — no hub file

Read the hub first, then drill into spokes. Every docs directory has a README.
