# Test Report: Status-dot hover shows a card with the full title and end-of-thread snippet; working dots pulse at their burn rate

**Suite ID:** uat-hover-card-pulse-001
**Date:** 2026-10-28T06:13:17.978Z
**Mode:** headless (vite harness + system Chrome)
**Viewport:** 1280×800

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 5 | 5 | 0 |

## Results

### TC-01: Hovering a treemap dot opens the card with the full title and a resolved snippet — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | hover | p | docs/uat//evidence/uat-hover-card-pulse-001/TC-01-step3.png | card "Refactor the export path" (assistant) · ✔ card mounted · ✔ full title present (Refactor the export path) · ✔ snippet resolved (assistant) · ✔ card inside panel · ✔ card escapes the camera (no transformed ancestor) · ✔ card keeps its authored width (painted 300px, laid out 300px) · ✔ card not occluded () |

### TC-02: A thread with no conversation says so instead of showing an empty snippet — PASSED

**Criticality:** standard

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | hover | p | docs/uat//evidence/uat-hover-card-pulse-001/TC-02-step3.png | card "Housekeeping" (empty) · ✔ card mounted · ✔ full title present (Housekeeping) · ✔ snippet resolved (empty) · ✔ card inside panel · ✔ card escapes the camera (no transformed ancestor) · ✔ card keeps its authored width (painted 300px, laid out 300px) · ✔ card not occluded () |

### TC-03: Working dots pulse at their burn rate, and the busiest pulses fastest — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | assertPulse | p | — | 2 pulsing units, 2 periods · ✔ every pulsing unit animates (2/2) · ✔ periods are positive · ✔ rates produce distinct periods (2 distinct period(s)) · ✔ 10× burn is 10× the pulse (ratio 10.000) |

### TC-04: The card is gone once the pointer leaves, and the board's dots hover identically — PASSED

**Criticality:** standard

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | hover | p | docs/uat//evidence/uat-hover-card-pulse-001/TC-04-step2.png | card "Fix flaky importer test" (assistant) · ✔ card mounted · ✔ full title present (Fix flaky importer test) · ✔ snippet resolved (assistant) · ✔ card inside panel · ✔ card escapes the camera (no transformed ancestor) · ✔ card keeps its authored width (painted 300px, laid out 300px) · ✔ card not occluded () |
| 3 | pointerAway | p | — | pointer left; card dismissed |

### TC-05: The card does not follow the camera — zooming in leaves it the same size — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | clickTab | p | — | clicked "Unit treemap" |
| 3 | click | p | — | clicked [data-attn-control="+"] |
| 4 | hover | p | docs/uat//evidence/uat-hover-card-pulse-001/TC-05-step4.png | card "Refactor the export path" (assistant) · ✔ card mounted · ✔ full title present (Refactor the export path) · ✔ snippet resolved (assistant) · ✔ card inside panel · ✔ card escapes the camera (no transformed ancestor) · ✔ card keeps its authored width (painted 300px, laid out 300px) · ✔ card not occluded () |
