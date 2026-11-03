# Test Report: The treemap's idle-visibility slider steps down through the operator's duration ticks from all to none

**Suite ID:** uat-treemap-idle-slider-001
**Date:** 2026-11-03T19:16:53.280Z
**Mode:** headless (vite harness + system Chrome)
**Viewport:** 1280×800

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 7 | 6 | 1 |

## Results

### TC-01: The default stop shows every idle thread (all seven base threads) — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | assertExists | p | — | [data-attn-filters] input[type="range"] present |
| 4 | assertCount | p | — | 7 matches for [data-attn-mark="tile"] (want 7) |
| 5 | waitFor | p | — | tree text "7 visible" painted; spinner unmounted |
| 6 | assertCount | p | — | 7 matches for [data-attn-idle-tick] (want 7) |
| 7 | assertCount | p | — | 1 match for [data-attn-idle-tick="All Idle"][data-attn-idle-tick-active] (want 1) |

### TC-02: A mid stop hides the idle threads at or past its bound (stop 3, <7 d) — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "3" into [data-attn-filters] input[type="range"] |
| 4 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle_month"] (want 0) |
| 5 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle_year"] (want 0) |
| 6 | assertCount | p | — | 1 match for [data-attn-unit][data-thread-id="thr_idle_week"] (want 1) |
| 7 | assertCount | p | — | 5 matches for [data-attn-mark="tile"] (want 5) |
| 8 | waitFor | p | — | tree text "5 visible" painted; spinner unmounted |

### TC-03: The bottom stop (No idle) hides every idle thread — none — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "0" into [data-attn-filters] input[type="range"] |
| 4 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle"] (want 0) |
| 5 | assertCount | p | — | 3 matches for [data-attn-unit] (want 3) |
| 6 | waitFor | p | — | tree text "3 visible" painted; spinner unmounted |
| 7 | profile | p | docs/uat//evidence/uat-treemap-idle-slider-001/TC-03-step7-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":604.9000000059605,"harness-opened":605.5,"click-flow-tab":610.6000000089407,"flow-tree-found":634.2999999970198}
- paint entries: [{"name":"first-paint","startTime":40},{"name":"first-contentful-paint","startTime":96}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.0ms · Task -0.0ms

### TC-04: The tick row names every stop from the ramp constants, the active one marked — PASSED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "2" into [data-attn-filters] input[type="range"] |
| 4 | assertCount | p | — | 1 match for [data-attn-idle-tick="<24 h"][data-attn-idle-tick-active] (want 1) |
| 5 | assertCount | p | — | 1 match for [data-attn-idle-tick-active] (want 1) |
| 6 | type | p | — | typed "0" into [data-attn-filters] input[type="range"] |
| 7 | assertCount | p | — | 1 match for [data-attn-idle-tick="No idle"][data-attn-idle-tick-active] (want 1) |
| 8 | type | p | — | typed "6" into [data-attn-filters] input[type="range"] |
| 9 | assertCount | p | — | 1 match for [data-attn-idle-tick="All Idle"][data-attn-idle-tick-active] (want 1) |

### TC-05: An empty bucket's stop hides nothing extra — FAILED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "5" into [data-attn-filters] input[type="range"] |
| 4 | assertCount | p | — | 6 matches for [data-attn-unit] (want 6) |
| 5 | type | p | — | typed "4" into [data-attn-filters] input[type="range"] |
| 6 | assertCount | f | — | 5 matches for [data-attn-unit] (want 6) |
| 7 | type | p | — | typed "2" into [data-attn-filters] input[type="range"] |
| 8 | assertCount | p | — | 4 matches for [data-attn-unit] (want 4) |

### TC-06: The slider works in dot mode too, and sliding back up restores the dimmest last — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "0" into [data-attn-filters] input[type="range"] |
| 4 | click | p | — | clicked [data-attn-control="+"] |
| 5 | assertCount | p | — | 3 matches for [data-attn-mark="dot"] (want 3) |
| 6 | type | p | — | typed "6" into [data-attn-filters] input[type="range"] |
| 7 | assertCount | p | — | 7 matches for [data-attn-mark="dot"] (want 7) |
| 8 | assertCount | p | — | 1 match for [data-attn-unit][data-thread-id="thr_idle_year"] (want 1) |

### TC-07: Working tiles keep their burn pulse at a filtered stop — PASSED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "1" into [data-attn-filters] input[type="range"] |
| 4 | assertCount | p | — | 4 matches for [data-attn-unit] (want 4) |
| 5 | assertPulse | p | — | 2 pulsing units, 2 periods · ✔ every pulsing unit animates (2/2) · ✔ periods are positive · ✔ rates produce distinct periods (2 distinct period(s)) · ✔ 10× burn is 10× the pulse (ratio 10.000) |

## Console capture

- error: Failed to load resource: the server responded with a status of 404 (Not Found)
