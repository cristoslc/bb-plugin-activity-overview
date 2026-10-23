# Test Report: Token flow renders as a swimlane flow-control stack — projects pile vertically, tiers tile, rivers front the cards

**Suite ID:** uat-token-flow-swimlanes-001
**Date:** 2026-10-23T04:08:14.199Z
**Mode:** headless (vite harness + system Chrome)

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 7 | 7 | 0 |

## Results

### TC-01: Projects pile vertically as one full-width row each, never tiled — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-row="proj_alpha"] appeared |
| 3 | swimlane | p | — | projects pile vertically, one full-width row each · ✔ rows present (2 project rows) · ✔ row proj_beta stacks below proj_alpha (617 >= 593) · ✔ rows share one full width (never tiled) (lefts 200 widths 1036) · ✔ the stack fits the stage width (stage 0..1280) |
| 4 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-01-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":743,"harness-opened":745}
- paint entries: [{"name":"first-paint","startTime":40},{"name":"first-contentful-paint","startTime":172}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.1ms · Task 0.2ms

### TC-02: An expanded row tiles four status lanes left-to-right, gutter-separated, no occlusion — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-lane="working"] appeared |
| 3 | swimlane | p | — | four lanes tiled left→right, gutter-separated, no overlap · ✔ four lanes (4 lanes) · ✔ lane order (working, needs-you, unread, idle) · ✔ needs-you does not overlap working (left 475.5 >= right 453.5) · ✔ unread does not overlap needs-you (left 729.0 >= right 707.0) · ✔ idle does not overlap unread (left 982.5 >= right 960.5) · ✔ lanes share one height band (heights 370) · ✔ lanes sit inside the row (row 200.0..1236.0) · ✔ lanes sit below the row header (lanes start below the expanded header) · ✔ all four lanes fit the stage width (last lane ends 1214, stage ends 1280) |
| 4 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-02-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":575.1999999955297,"harness-opened":575.6999999955297}
- paint entries: [{"name":"first-paint","startTime":32},{"name":"first-contentful-paint","startTime":32}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script -0.1ms · Task -0.1ms

### TC-03: Every card's river paints in front of the cards, all from the one project mouth — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-river] appeared |
| 3 | swimlane | p | — | rivers in front of cards, deepest first, all from one mouth · ✔ rivers present (7 rivers) · ✔ a card per river (7 cards, 7 rivers) · ✔ rivers in front of every card (first river @7, last card @6) · ✔ rivers paint deepest-first (depths 0,0,0,0,0,0,0) · ✔ one mouth (mouth present) · ✔ all rivers from the one mouth (starts 239,194 vs mouth 239,194) · ✔ non-working lanes carry no rivers (needs-you/unread/idle are cards only) |
| 4 | assertBeads | p | — | beads are drifting · ✔ the Working lane carries bead paths (7 bead paths) · ✔ the beads drift (the rivers animate) (7/7 offsets changed (-27.0417,-14.7234,-13.7405 → -52.0988,-28.3662,-26.4727)) |
| 5 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-03-step5-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":563.3999999985099,"harness-opened":563.6999999955297}
- paint entries: [{"name":"first-paint","startTime":24},{"name":"first-contentful-paint","startTime":40}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.0ms · Task 0.0ms

### TC-04: A collapsed group head reads its subtree sum (Σ) and drops to its own flow once expanded — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-card="thr_running"] appeared |
| 3 | swimlane | p | — | group head (group-collapsed) reads correctly · ✔ a group head is present (1 group heads; wanting open=false) · ✔ collapsed head shows the subtree sum (Σ) (Refactor the export path · 41.2k tokens · runningRefactor the export pathΣ 29.8k tok/min · 41.2k total▸ 1 sub) |
| 4 | click | p | — | clicked [data-attn-card-rect="thr_running"] |
| 5 | waitForSelector | p | — | [data-attn-card="thr_running"][data-open="true"] appeared |
| 6 | swimlane | p | — | group head (group-expanded) reads correctly · ✔ a group head is present (2 group heads; wanting open=true) · ✔ expanded head shows own flow (Refactor the export path · 41.2k tokens · runningRefactor the export pathown 15.8k tok/min · 41.2k total▾ 1 sub) |
| 7 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-04-step7-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":561.5,"harness-opened":561.8000000044703}
- paint entries: [{"name":"first-paint","startTime":28},{"name":"first-contentful-paint","startTime":40}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.0ms · Task -0.0ms

### TC-05: Each lane scrolls on its own; scrolling one never moves another — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-lane][data-overflow="true"] appeared |
| 3 | wheelLane | p | — | working scrolled independently · ✔ the scrolled lane moved (working transform translate(0 0) → translate(0 -129)) · ✔ no other lane moved (moved: working) |
| 4 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-05-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":564.5,"harness-opened":564.8999999985099}
- paint entries: [{"name":"first-paint","startTime":16},{"name":"first-contentful-paint","startTime":40}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script -0.0ms · Task 0.0ms

### TC-06: A collapsed row carries no lanes; expanding it reveals the four tiles — PASSED

**Criticality:** standard

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-lane="working"] appeared |
| 3 | assertCount | p | — | 4 matches for [data-attn-lane] (want 4) |
| 4 | click | p | — | clicked [data-attn-row-rect="proj_beta"] |
| 5 | waitForSelector | p | — | [data-attn-lane-row="proj_beta"] appeared |
| 6 | assertCount | p | — | 8 matches for [data-attn-lane] (want 8) |

### TC-07: A running child under a waiting parent surfaces in the Working lane, not nested inside the parent — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-card="thr_supervisor_child"] appeared |
| 3 | assertCount | p | — | 1 match for [data-attn-lane="working"] [data-attn-card="thr_supervisor_child"] (want 1) |
| 4 | assertCount | p | — | 0 matches for [data-attn-lane="needs-you"] [data-attn-card="thr_supervisor_child"] (want 0) |
| 5 | swimlane | p | — | lane counts are consistent with the cards drawn · ✔ working never draws more than it counts (header 9, drawn 7) · ✔ needs-you never draws more than it counts (header 2, drawn 2) · ✔ unread never draws more than it counts (header 1, drawn 1) · ✔ idle never draws more than it counts (header 1, drawn 1) · ✔ the row's working count matches the Working lane header (row 9, lane 9) · ✔ the Working lane is not empty when the row reports working threads (row 9, drawn 7) |

## Console capture

- error: Failed to load resource: the server responded with a status of 404 (Not Found)
