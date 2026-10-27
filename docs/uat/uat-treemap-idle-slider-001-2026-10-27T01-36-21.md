# Test Report: The treemap's idle-visibility slider steps down through the grey ramp from all to none

**Suite ID:** uat-treemap-idle-slider-001
**Date:** 2026-10-27T01:36:21.812Z
**Mode:** headless (vite harness + system Chrome)

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 7 | 4 | 3 |

## Results

### TC-01: The default stop shows every idle thread (all seven base threads) — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | assertExists | p | — | [data-attn-idle-slider] input[type="range"] present |
| 4 | assertCount | p | — | 7 matches for [data-attn-mark="tile"] (want 7) |
| 5 | waitFor | p | — | tree text "7 visible" painted; spinner unmounted |
| 6 | profile | p | docs/uat//evidence/uat-treemap-idle-slider-001/TC-01-step6-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":720.8999999761581,"harness-opened":722.8999999761581,"click-flow-tab":729.1999999880791,"flow-tree-found":745.6999999880791}
- paint entries: [{"name":"first-paint","startTime":52},{"name":"first-contentful-paint","startTime":212}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.1ms · Task 0.1ms

### TC-02: A mid stop hides the dimmest idle threads first (stop 2 keeps grey-0 and grey-1) — FAILED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "2" into [data-attn-idle-slider] input[type="range"] |
| 4 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle_month"] (want 0) |
| 5 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle_year"] (want 0) |
| 6 | assertCount | f | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle_week"] (want 1) |
| 7 | assertCount | f | — | 3 matches for [data-attn-mark="tile"] (want 5) |
| 8 | waitFor | f | — | timeout waiting for text "5 visible" |

### TC-03: The bottom stop hides every idle thread — none — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "0" into [data-attn-idle-slider] input[type="range"] |
| 4 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle"] (want 0) |
| 5 | assertCount | p | — | 3 matches for [data-attn-unit] (want 3) |
| 6 | waitFor | p | — | tree text "3 visible" painted; spinner unmounted |
| 7 | profile | p | docs/uat//evidence/uat-treemap-idle-slider-001/TC-03-step7-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":553.3000000119209,"harness-opened":555.3000000119209,"click-flow-tab":568.1000000238419,"flow-tree-found":587.5}
- paint entries: [{"name":"first-paint","startTime":20},{"name":"first-contentful-paint","startTime":40}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script 0.0ms · Task -0.1ms

### TC-04: The caption names each stop from the ramp's own thresholds — PASSED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "2" into [data-attn-idle-slider] input[type="range"] |
| 4 | waitFor | p | — | tree text "idle ≤ 6d shown" painted; spinner unmounted |
| 5 | type | p | — | typed "0" into [data-attn-idle-slider] input[type="range"] |
| 6 | waitFor | p | — | tree text "no idle shown" painted; spinner unmounted |
| 7 | type | p | — | typed "6" into [data-attn-idle-slider] input[type="range"] |
| 8 | waitFor | p | — | tree text "all idle shown" painted; spinner unmounted |

### TC-05: An empty shade's stop hides nothing extra — FAILED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "5" into [data-attn-idle-slider] input[type="range"] |
| 4 | assertCount | f | — | 3 matches for [data-attn-unit] (want 6) |
| 5 | type | p | — | typed "4" into [data-attn-idle-slider] input[type="range"] |
| 6 | assertCount | f | — | 3 matches for [data-attn-unit] (want 6) |
| 7 | type | p | — | typed "3" into [data-attn-idle-slider] input[type="range"] |
| 8 | assertCount | f | — | 3 matches for [data-attn-unit] (want 5) |
| 9 | type | p | — | typed "2" into [data-attn-idle-slider] input[type="range"] |
| 10 | assertCount | f | — | 3 matches for [data-attn-unit] (want 5) |

### TC-06: The slider works in dot mode too, and sliding back up restores the dimmest last — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "0" into [data-attn-idle-slider] input[type="range"] |
| 4 | click | p | — | clicked [data-attn-control="+"] |
| 5 | assertCount | p | — | 3 matches for [data-attn-mark="dot"] (want 3) |
| 6 | type | p | — | typed "6" into [data-attn-idle-slider] input[type="range"] |
| 7 | assertCount | p | — | 7 matches for [data-attn-mark="dot"] (want 7) |
| 8 | assertCount | p | — | 1 match for [data-attn-unit][data-thread-id="thr_idle_year"] (want 1) |

### TC-07: Working tiles keep their burn pulse at a filtered stop — FAILED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "1" into [data-attn-idle-slider] input[type="range"] |
| 4 | assertCount | f | — | 3 matches for [data-attn-unit] (want 4) |
| 5 | assertPulse | p | — | 2 pulsing units, 2 periods · ✔ every pulsing unit animates (2/2) · ✔ periods are positive · ✔ rates produce distinct periods (2 distinct period(s)) · ✔ 10× burn is 10× the pulse (ratio 10.000) |

## Console capture

- error: Failed to load resource: the server responded with a status of 404 (Not Found)
