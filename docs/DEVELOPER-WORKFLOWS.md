# Developer workflows

- Build: `bb plugin build` (emits dist/server.js + dist/app.js + css + meta).
- Test: `npm test` (node --test on tests/*.test.ts; six layout/classification tests).
- Dev loop: `bb plugin dev` (rebuild + reload on save), `bb plugin reload activity-overview` after manual changes.
- Staging deploy: `scripts/staging/deploy.sh` (path install into local bb).
- Staging E2E: `scripts/staging/e2e.sh`; teardown: `scripts/staging/teardown.sh` (`bb plugin remove activity-overview`).
- Production: git release; `bb plugin outdated` / `update` handle managed installs.
