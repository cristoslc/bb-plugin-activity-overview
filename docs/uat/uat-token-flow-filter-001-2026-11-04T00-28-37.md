# Test Report: Token flow stack ranks by current activity and filters by project — active projects lead, misses vanish

**Suite ID:** uat-token-flow-filter-001
**Date:** 2026-11-04T00:28:37.743Z
**Mode:** headless (vite harness + system Chrome)
**Viewport:** 1280×800

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 4 | 4 | 0 |

## Results

### TC-01: The stack ranks by current activity — the burning projects lead, the big quiet one sinks — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-row-rect="proj_gamma"] appeared |
| 3 | swimlane | p | — | stack order: proj_alpha → proj_beta → proj_gamma · ✔ rows present (3 project rows) · ✔ stack order is proj_alpha → proj_beta → proj_gamma (proj_alpha → proj_beta → proj_gamma) |
| 4 | profile | p | docs/uat//evidence/uat-token-flow-filter-001/TC-01-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":728.4000000059605,"harness-opened":728.9000000059605}
- paint entries: [{"name":"first-paint","startTime":44},{"name":"first-contentful-paint","startTime":172}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.1ms · Task 0.1ms

### TC-02: The project filter narrows the stack; a filtered-out project vanishes, never dims — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-row-rect="proj_gamma"] appeared |
| 3 | type | p | — | typed "beta" into [data-attn-project-filter] |
| 4 | assertCount | p | — | 1 match for [data-attn-row-rect] (want 1) |
| 5 | assertGone | p | — | absent |
| 6 | waitFor | p | — | tree text "1/3" painted; spinner unmounted |
| 7 | profile | p | docs/uat//evidence/uat-token-flow-filter-001/TC-02-step7-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":574,"harness-opened":574.9000000059605,"flow-tree-found":596.6000000089407}
- paint entries: [{"name":"first-paint","startTime":32},{"name":"first-contentful-paint","startTime":32}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script -0.0ms · Task -0.0ms

### TC-03: An expanded row stays open and filterable under a matching query — PASSED

**Criticality:** standard

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-lane="working"] appeared |
| 3 | type | p | — | typed "ALPHA" into [data-attn-project-filter] |
| 4 | assertCount | p | — | 4 matches for [data-attn-lane] (want 4) |
| 5 | assertCount | p | — | 1 match for [data-attn-row-rect] (want 1) |
| 6 | profile | p | docs/uat//evidence/uat-token-flow-filter-001/TC-03-step6-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":570.4000000059605,"harness-opened":570.7000000029802}
- paint entries: [{"name":"first-paint","startTime":24},{"name":"first-contentful-paint","startTime":24}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script 0.0ms · Task -0.0ms

### TC-04: A query that matches nothing shows a clear empty state with a way back — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-row-rect="proj_alpha"] appeared |
| 3 | type | p | — | typed "zzz-no-such-project" into [data-attn-project-filter] |
| 4 | waitForSelector | p | — | [data-attn-empty-state] appeared |
| 5 | assertCount | p | — | 0 matches for [data-attn-row-rect] (want 0) |
| 6 | click | p | — | clicked [data-attn-empty-state-clear] |
| 7 | waitForSelector | p | — | [data-attn-row-rect="proj_gamma"] appeared |
| 8 | profile | p | docs/uat//evidence/uat-token-flow-filter-001/TC-04-step8-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":576.4000000059605,"harness-opened":577}
- paint entries: [{"name":"first-paint","startTime":36},{"name":"first-contentful-paint","startTime":40}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.0ms · Task 0.0ms

## Console capture

- error: Failed to load resource: the server responded with a status of 404 (Not Found)
