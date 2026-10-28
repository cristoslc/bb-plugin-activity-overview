# Test Report: The treemap's idle-visibility slider is usable at phone width (390×844)

**Suite ID:** uat-treemap-idle-slider-phone-001
**Date:** 2026-10-28T06:10:07.994Z
**Mode:** headless (vite harness + system Chrome)
**Viewport:** 390×844

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 5 | 3 | 2 |

## Results

### TC-01: The stacked chrome keeps every band inside the viewport, separated and untouching — FAILED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | assertChrome | f | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-01-step3.png | no card or control sits under the floating chrome · ✔ the zoom-controls band sits fully inside the viewport ([274,800]→[378,832] (panel 390×844)) · ✔ the tabbar band sits fully inside the viewport ([12,12]→[378,66] (panel 390×844)) · ✔ the legend band sits fully inside the viewport ([12,646]→[378,717] (panel 390×844)) · ✔ the slider band sits fully inside the viewport ([12,725]→[378,792] (panel 390×844)) · ✔ the zoom-controls band does not cover the tabbar band (0px² overlap) · ✔ the zoom-controls band does not cover the legend band (0px² overlap) · ✔ the zoom-controls band does not cover the slider band (0px² overlap) · ✔ the tabbar band does not cover the legend band (0px² overlap) · ✔ the tabbar band does not cover the slider band (0px² overlap) · ✔ the legend band does not cover the slider band (0px² overlap) · ✔ [data-attn-idle-slider] input[type='range'] sits fully inside the viewport ([27,753]→[299,781]) · ✔ [data-attn-idle-slider] input[type='range'] is hit-testable at its center (reached) · ✖ no card or control sits under the floating chrome (zoom-controls ∩ legend, zoom-controls ∩ legend, zoom-controls ∩ legend) |
| 4 | profile | p | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-01-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":705.1999999880791,"harness-opened":705.8000000119209,"click-flow-tab":710.6999999880791}
- paint entries: [{"name":"first-paint","startTime":40},{"name":"first-contentful-paint","startTime":200}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.1ms · Task 0.1ms

### TC-02: A mid stop responds at phone width (stop 2 keeps the freshest shades) — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "2" into [data-attn-idle-slider] input[type="range"] |
| 4 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle_month"] (want 0) |
| 5 | assertCount | p | — | 1 match for [data-attn-unit][data-thread-id="thr_idle_week"] (want 1) |
| 6 | waitFor | p | — | tree text "5 visible" painted; spinner unmounted |

### TC-03: The bottom stop hides every idle thread — none — and the counts respond — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "0" into [data-attn-idle-slider] input[type="range"] |
| 4 | assertCount | p | — | 3 matches for [data-attn-mark='tile'] (want 3) |
| 5 | waitFor | p | — | tree text "3 visible" painted; spinner unmounted |
| 6 | profile | p | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-03-step6-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":545.1000000238419,"harness-opened":545.5,"click-flow-tab":547.8000000119209,"flow-tree-found":559.5}
- paint entries: [{"name":"first-paint","startTime":32},{"name":"first-contentful-paint","startTime":48}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script -0.0ms · Task -0.0ms

### TC-04: After the stops settle, no card or control sits under the stacked chrome — FAILED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | assertChrome | f | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-04-step3.png | no card or control sits under the floating chrome · ✔ the zoom-controls band sits fully inside the viewport ([274,800]→[378,832] (panel 390×844)) · ✔ the tabbar band sits fully inside the viewport ([12,12]→[378,66] (panel 390×844)) · ✔ the legend band sits fully inside the viewport ([12,646]→[378,717] (panel 390×844)) · ✔ the slider band sits fully inside the viewport ([12,725]→[378,792] (panel 390×844)) · ✔ the zoom-controls band does not cover the tabbar band (0px² overlap) · ✔ the zoom-controls band does not cover the legend band (0px² overlap) · ✔ the zoom-controls band does not cover the slider band (0px² overlap) · ✔ the tabbar band does not cover the legend band (0px² overlap) · ✔ the tabbar band does not cover the slider band (0px² overlap) · ✔ the legend band does not cover the slider band (0px² overlap) · ✔ [data-attn-idle-slider] input[type='range'] sits fully inside the viewport ([27,753]→[299,781]) · ✔ [data-attn-idle-slider] input[type='range'] is hit-testable at its center (reached) · ✔ [data-attn-zoom-controls] sits fully inside the viewport ([274,800]→[378,832]) · ✔ [data-attn-zoom-controls] is hit-testable at its center (reached) · ✖ no card or control sits under the floating chrome (zoom-controls ∩ legend, zoom-controls ∩ legend, zoom-controls ∩ legend) |
| 4 | assertChrome | p | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-04-step4.png | 4 chrome bands coherent · ✔ the zoom-controls band sits fully inside the viewport ([274,800]→[378,832] (panel 390×844)) · ✔ the tabbar band sits fully inside the viewport ([12,12]→[378,66] (panel 390×844)) · ✔ the legend band sits fully inside the viewport ([12,646]→[378,717] (panel 390×844)) · ✔ the slider band sits fully inside the viewport ([12,725]→[378,792] (panel 390×844)) · ✔ the zoom-controls band does not cover the tabbar band (0px² overlap) · ✔ the zoom-controls band does not cover the legend band (0px² overlap) · ✔ the zoom-controls band does not cover the slider band (0px² overlap) · ✔ the tabbar band does not cover the legend band (0px² overlap) · ✔ the tabbar band does not cover the slider band (0px² overlap) · ✔ the legend band does not cover the slider band (0px² overlap) |

### TC-05: The slider is keyboard-operable at phone width (native range input) — PASSED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | pressKey | p | — | focused [data-attn-idle-slider] input[type="range"], pressed ArrowDown, value now "5" (want "5") |
| 4 | waitFor | p | — | tree text "idle ≤ 168d shown" painted; spinner unmounted |
| 5 | assertCount | p | — | 6 matches for [data-attn-mark='tile'] (want 6) |

## Console capture

- error: Failed to load resource: the server responded with a status of 404 (Not Found)
