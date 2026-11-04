# Test Report: The shared filters card works on every dot board — Board and Strip tiles included

**Suite ID:** uat-filters-cross-view-001
**Date:** 2026-11-04T00:28:48.611Z
**Mode:** headless (vite harness + system Chrome)
**Viewport:** 1280×800

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 6 | 6 | 0 |

## Results

### TC-01: The Board carries the filters card — slider and project filter — at the default stop — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | assertExists | p | — | [data-attn-filters] input[type="range"] present |
| 3 | assertExists | p | — | [data-attn-filters] input[type="text"] present |
| 4 | assertCount | p | — | 7 matches for [data-attn-unit] (want 7) |
| 5 | waitFor | p | — | tree text "7 visible" painted; spinner unmounted |

### TC-02: The slider gates the Board's roster (stop 3, <7 d) — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | type | p | — | typed "3" into [data-attn-filters] input[type="range"] |
| 3 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle_month"] (want 0) |
| 4 | assertCount | p | — | 1 match for [data-attn-unit][data-thread-id="thr_idle_week"] (want 1) |
| 5 | assertCount | p | — | 5 matches for [data-attn-unit] (want 5) |
| 6 | waitFor | p | — | tree text "5 visible" painted; spinner unmounted |

### TC-03: The project filter narrows the Board and clears back — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | type | p | — | typed "beta" into [data-attn-filters] input[type="text"] |
| 3 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_running"] (want 0) |
| 4 | assertCount | p | — | 5 matches for [data-attn-unit] (want 5) |
| 5 | waitFor | p | — | tree text "1/2" painted; spinner unmounted |
| 6 | click | p | — | clicked [data-attn-filters] [data-attn-project-filter-clear] |
| 7 | assertCount | p | — | 7 matches for [data-attn-unit] (want 7) |

### TC-04: Strip tiles carries the same filters card — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Strip tiles" |
| 3 | assertExists | p | — | [data-attn-filters] input[type="range"] present |
| 4 | type | p | — | typed "0" into [data-attn-filters] input[type="range"] |
| 5 | assertCount | p | — | 3 matches for [data-attn-unit] (want 3) |
| 6 | type | p | — | typed "alpha" into [data-attn-filters] input[type="text"] |
| 7 | assertCount | p | — | 2 matches for [data-attn-unit] (want 2) |
| 8 | waitFor | p | — | tree text "2 visible" painted; spinner unmounted |

### TC-05: The stop and the query are shared state — they carry across boards — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | type | p | — | typed "beta" into [data-attn-filters] input[type="text"] |
| 3 | type | p | — | typed "0" into [data-attn-filters] input[type="range"] |
| 4 | assertCount | p | — | 1 match for [data-attn-unit] (want 1) |
| 5 | clickTab | p | — | clicked "Strip tiles" |
| 6 | pressKey | p | — | focused [data-attn-filters] input[type="range"], pressed ArrowLeft, value now "0" (want "0") |
| 7 | assertCount | p | — | 1 match for [data-attn-unit] (want 1) |
| 8 | waitFor | p | — | tree text "1/2" painted; spinner unmounted |

### TC-06: At phone width the Board's stacked chrome fits the new tiers (390×844) — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | assertChrome | p | docs/uat//evidence/uat-filters-cross-view-001/TC-06-step2.png | 4 chrome bands coherent, 3 control(s) reachable · ✔ the zoom-controls band sits fully inside the viewport ([274,800]→[378,832] (panel 390×844)) · ✔ the tabbar band sits fully inside the viewport ([12,12]→[378,66] (panel 390×844)) · ✔ the legend band sits fully inside the viewport ([12,596]→[378,667] (panel 390×844)) · ✔ the filters band sits fully inside the viewport ([12,675]→[378,792] (panel 390×844)) · ✔ the zoom-controls band does not cover the tabbar band (0px² overlap) · ✔ the zoom-controls band does not cover the legend band (0px² overlap) · ✔ the zoom-controls band does not cover the filters band (0px² overlap) · ✔ the tabbar band does not cover the legend band (0px² overlap) · ✔ the tabbar band does not cover the filters band (0px² overlap) · ✔ the legend band does not cover the filters band (0px² overlap) · ✔ [data-attn-filters] input[type='range'] sits fully inside the viewport ([82,703]→[363,731]) · ✔ [data-attn-filters] input[type='range'] is hit-testable at its center (reached) · ✔ [data-attn-filters] input[type='text'] sits fully inside the viewport ([61,765]→[365,783]) · ✔ [data-attn-filters] input[type='text'] is hit-testable at its center (reached) · ✔ [data-attn-zoom-controls] sits fully inside the viewport ([274,800]→[378,832]) · ✔ [data-attn-zoom-controls] is hit-testable at its center (reached) · ✔ no card or control sits under the floating chrome (7 marks all clear of 4 chrome bands) |
| 3 | type | p | — | typed "1" into [data-attn-filters] input[type="range"] |
| 4 | assertCount | p | — | 4 matches for [data-attn-unit] (want 4) |
| 5 | profile | p | docs/uat//evidence/uat-filters-cross-view-001/TC-06-step5-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":544.2999999970198,"harness-opened":544.5999999940395}
- paint entries: [{"name":"first-paint","startTime":32},{"name":"first-contentful-paint","startTime":32}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script -0.0ms · Task -0.0ms

## Console capture

- error: Failed to load resource: the server responded with a status of 404 (Not Found)
