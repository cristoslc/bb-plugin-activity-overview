# Test Report: The treemap's idle-visibility slider is usable at phone width (390×844)

**Suite ID:** uat-treemap-idle-slider-phone-001
**Date:** 2026-11-03T19:20:26.837Z
**Mode:** headless (vite harness + system Chrome)
**Viewport:** 390×844

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 5 | 5 | 0 |

## Results

### TC-01: The stacked chrome keeps every band inside the viewport, separated and untouching — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | assertChrome | p | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-01-step3.png | 4 chrome bands coherent, 1 control(s) reachable · ✔ the zoom-controls band sits fully inside the viewport ([274,800]→[378,832] (panel 390×844)) · ✔ the tabbar band sits fully inside the viewport ([12,12]→[378,66] (panel 390×844)) · ✔ the legend band sits fully inside the viewport ([12,596]→[378,667] (panel 390×844)) · ✔ the filters band sits fully inside the viewport ([12,675]→[378,792] (panel 390×844)) · ✔ the zoom-controls band does not cover the tabbar band (0px² overlap) · ✔ the zoom-controls band does not cover the legend band (0px² overlap) · ✔ the zoom-controls band does not cover the filters band (0px² overlap) · ✔ the tabbar band does not cover the legend band (0px² overlap) · ✔ the tabbar band does not cover the filters band (0px² overlap) · ✔ the legend band does not cover the filters band (0px² overlap) · ✔ [data-attn-filters] input[type='range'] sits fully inside the viewport ([82,703]→[363,731]) · ✔ [data-attn-filters] input[type='range'] is hit-testable at its center (reached) · ✔ no card or control sits under the floating chrome (9 marks all clear of 4 chrome bands) |
| 4 | profile | p | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-01-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":655.5,"harness-opened":655.9000000059605,"click-flow-tab":659.2999999970198}
- paint entries: [{"name":"first-paint","startTime":12},{"name":"first-contentful-paint","startTime":116}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.1ms · Task 0.1ms

### TC-02: A mid stop responds at phone width (stop 3, <7 d, keeps the freshest shades) — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "3" into [data-attn-filters] input[type="range"] |
| 4 | assertCount | p | — | 0 matches for [data-attn-unit][data-thread-id="thr_idle_month"] (want 0) |
| 5 | assertCount | p | — | 1 match for [data-attn-unit][data-thread-id="thr_idle_week"] (want 1) |
| 6 | waitFor | p | — | tree text "5 visible" painted; spinner unmounted |

### TC-03: The bottom stop (No idle) hides every idle thread — none — and the counts respond — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | type | p | — | typed "0" into [data-attn-filters] input[type="range"] |
| 4 | assertCount | p | — | 3 matches for [data-attn-mark='tile'] (want 3) |
| 5 | waitFor | p | — | tree text "3 visible" painted; spinner unmounted |
| 6 | profile | p | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-03-step6-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":565.5,"harness-opened":565.7999999970198,"click-flow-tab":568.5999999940395,"flow-tree-found":579.3999999910593}
- paint entries: [{"name":"first-paint","startTime":16},{"name":"first-contentful-paint","startTime":68}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script -0.0ms · Task -0.0ms

### TC-04: After the stops settle, no card or control sits under the stacked chrome — PASSED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | assertChrome | p | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-04-step3.png | 4 chrome bands coherent, 2 control(s) reachable · ✔ the zoom-controls band sits fully inside the viewport ([274,800]→[378,832] (panel 390×844)) · ✔ the tabbar band sits fully inside the viewport ([12,12]→[378,66] (panel 390×844)) · ✔ the legend band sits fully inside the viewport ([12,596]→[378,667] (panel 390×844)) · ✔ the filters band sits fully inside the viewport ([12,675]→[378,792] (panel 390×844)) · ✔ the zoom-controls band does not cover the tabbar band (0px² overlap) · ✔ the zoom-controls band does not cover the legend band (0px² overlap) · ✔ the zoom-controls band does not cover the filters band (0px² overlap) · ✔ the tabbar band does not cover the legend band (0px² overlap) · ✔ the tabbar band does not cover the filters band (0px² overlap) · ✔ the legend band does not cover the filters band (0px² overlap) · ✔ [data-attn-filters] input[type='range'] sits fully inside the viewport ([82,703]→[363,731]) · ✔ [data-attn-filters] input[type='range'] is hit-testable at its center (reached) · ✔ [data-attn-zoom-controls] sits fully inside the viewport ([274,800]→[378,832]) · ✔ [data-attn-zoom-controls] is hit-testable at its center (reached) · ✔ no card or control sits under the floating chrome (9 marks all clear of 4 chrome bands) |
| 4 | assertChrome | p | docs/uat//evidence/uat-treemap-idle-slider-phone-001/TC-04-step4.png | 4 chrome bands coherent · ✔ the zoom-controls band sits fully inside the viewport ([274,800]→[378,832] (panel 390×844)) · ✔ the tabbar band sits fully inside the viewport ([12,12]→[378,66] (panel 390×844)) · ✔ the legend band sits fully inside the viewport ([12,596]→[378,667] (panel 390×844)) · ✔ the filters band sits fully inside the viewport ([12,675]→[378,792] (panel 390×844)) · ✔ the zoom-controls band does not cover the tabbar band (0px² overlap) · ✔ the zoom-controls band does not cover the legend band (0px² overlap) · ✔ the zoom-controls band does not cover the filters band (0px² overlap) · ✔ the tabbar band does not cover the legend band (0px² overlap) · ✔ the tabbar band does not cover the filters band (0px² overlap) · ✔ the legend band does not cover the filters band (0px² overlap) |

### TC-05: The slider is keyboard-operable at phone width (native range input) — PASSED

**Criticality:** high

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | pressKey | p | — | focused [data-attn-filters] input[type="range"], pressed ArrowDown, value now "5" (want "5") |
| 4 | assertCount | p | — | 1 match for [data-attn-idle-tick="<90 d"][data-attn-idle-tick-active] (want 1) |
| 5 | assertCount | p | — | 6 matches for [data-attn-mark='tile'] (want 6) |
