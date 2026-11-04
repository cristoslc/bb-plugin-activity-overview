# Developer workflows

- Build: `bb plugin build` (emits dist/server.js + dist/app.js + css + meta).
- Test: `npm test` (node --test on tests/*.test.ts; layout/classification, changelog, store-listing, and harness-identity contracts).
- Dev loop: `bb plugin dev` (rebuild + reload on save), `bb plugin reload activity-overview` after manual changes.
- Headless UAT: `npm run uat -- tests/manual/<suite>.yaml` (vite harness + system Chrome); reports in `docs/uat/`.
- Media (script-generated, never by hand): `npm run shots` (README/store screenshots), `npm run gif` (hero GIF); both land in `docs/screenshots/` and need `npm run build` first.
- Release gate: `npm run release-safety` (build + UAT + `npm run release-shots` into `docs/release-safety/`) — a named-stage runner now: a failure names its stage (`release-safety:uat`, …), notifies ntfy when `NTFY_TOPIC` is configured (`~/.config/activity-overview/ntfy.env`, silent no-op without it), and exits with the stage's own code.
- Release (one entry): `npm run release` — preconditions (clean dev tree in sync with `gh/dev`, tag absent, version `-dev`, `[Unreleased]` non-empty or `--allow-empty`, UAT suites present, signing configured), then the blocking gates (`npm test`, `npx tsc --noEmit`, `npm run build`, the full UAT sweep, `npm run store:check`, `npm run release-shots`), then the finalize commit, the signed + verified tag, the ff-only main promotion, `git push gh dev main vX.Y.Z`, and the store drop. `npm run release -- --dry-run` runs every gate and prints every step while mutating nothing — ship its output as release-PR evidence. Manual after: the `-dev` prep commit (release.md §6), `bb plugin reload activity-overview` (§7), the marketplace submission (§4a).
- Store listing: `npm run store:check` validates `store/entry.json` + `PLUGIN_OVERVIEW.md` + the screenshots against the marketplace contract; `npm run store:build` also assembles a drop under `dist/store/`. See `.agents/agents-md-detail/release.md` §4a.
- Staging deploy: `scripts/staging/deploy.sh` (path install into local bb).
- Staging E2E: `scripts/staging/e2e.sh`; teardown: `scripts/staging/teardown.sh` (`bb plugin remove activity-overview`).
- Production: git release; `bb plugin outdated` / `update` handle managed installs.
