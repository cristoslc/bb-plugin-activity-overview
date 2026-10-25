# Test Report: Token flow renders as a swimlane flow-control stack — projects pile vertically, tiers tile, rivers front the cards

**Suite ID:** uat-token-flow-swimlanes-001
**Date:** 2026-10-25T02:19:35.499Z
**Mode:** headless (vite harness + system Chrome)

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 12 | 12 | 0 |

## Results

### TC-01: Projects pile vertically as one full-width row each, never tiled — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-row="proj_alpha"] appeared |
| 3 | swimlane | p | — | projects pile vertically, one full-width row each · ✔ rows present (2 project rows) · ✔ row proj_beta stacks below proj_alpha (617 >= 593) · ✔ rows share one full width (never tiled) (lefts 292 widths 944) · ✔ the stack fits the stage width (stage 0..1280) |
| 4 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-01-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":707,"harness-opened":708}
- paint entries: [{"name":"first-paint","startTime":20},{"name":"first-contentful-paint","startTime":132}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.1ms · Task 0.1ms

### TC-02: An expanded row tiles four status lanes left-to-right, gutter-separated, no occlusion — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-lane="working"] appeared |
| 3 | swimlane | p | — | four lanes tiled left→right, gutter-separated, no overlap · ✔ four lanes (4 lanes) · ✔ lane order (working, needs-you, unread, idle) · ✔ needs-you does not overlap working (left 544.5 >= right 522.5) · ✔ unread does not overlap needs-you (left 775.0 >= right 753.0) · ✔ idle does not overlap unread (left 1005.5 >= right 983.5) · ✔ lanes share one height band (heights 370) · ✔ lanes sit inside the row (row 292.0..1236.0) · ✔ lanes sit below the row header (lanes start below the expanded header) · ✔ all four lanes fit the stage width (last lane ends 1214, stage ends 1280) |
| 4 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-02-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":584.9000000059605,"harness-opened":585.5999999940395}
- paint entries: [{"name":"first-paint","startTime":20},{"name":"first-contentful-paint","startTime":44}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script -0.1ms · Task -0.1ms

### TC-03: Every card's river paints in front of the cards, all from the one project mouth — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-river] appeared |
| 3 | swimlane | p | — | rivers in front of cards, deepest first, all from one mouth · ✔ rivers present (8 rivers) · ✔ a card per river (8 cards, 8 rivers) · ✔ rivers in front of every card (first river @8, last card @7) · ✔ rivers paint deepest-first (depths 0,0,0,0,0,0,0,0) · ✔ one mouth (mouth present) · ✔ all rivers from the one mouth (starts 331,194 vs mouth 331,194) · ✔ non-working lanes carry no rivers (needs-you/unread/idle are cards only) |
| 4 | assertBeads | p | — | project→card beads are drifting · ✔ the project→card rivers carry bead paths (8 bead paths) · ✔ the project→card beads drift (the rivers animate) (8/8 offsets changed (-27.5829,-15.0181,-14.0155 → -52.64,-28.6609,-26.7477)) |
| 5 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-03-step5-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":572.0999999940395,"harness-opened":572.8000000119209}
- paint entries: [{"name":"first-paint","startTime":24},{"name":"first-contentful-paint","startTime":40}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script 0.0ms · Task 0.0ms

### TC-04: A collapsed group head reads its subtree sum (Σ) and drops to its own flow once expanded — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-card="thr_running"] appeared |
| 3 | swimlane | p | — | group head (group-collapsed) reads correctly · ✔ a group head is present (2 group heads; wanting open=false) · ✔ collapsed head shows the subtree sum (Σ) (Refactor the export path · 41.2k tokens · runningRefactor the export pathΣ 29.8k tok/min · 41.2k total▸ 1 sub) |
| 4 | click | p | — | clicked [data-attn-card-rect="thr_running"] |
| 5 | waitForSelector | p | — | [data-attn-card="thr_running"][data-open="true"] appeared |
| 6 | swimlane | p | — | group head (group-expanded) reads correctly · ✔ a group head is present (3 group heads; wanting open=true) · ✔ expanded head shows own flow (Refactor the export path · 41.2k tokens · runningRefactor the export pathown 15.8k tok/min · 41.2k total▾ 1 sub) |
| 7 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-04-step7-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":570.6999999880791,"harness-opened":571.4000000059605}
- paint entries: [{"name":"first-paint","startTime":24},{"name":"first-contentful-paint","startTime":40}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.0ms · Task -0.0ms

### TC-05: Each lane scrolls on its own; scrolling one never moves another — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-lane][data-overflow="true"] appeared |
| 3 | wheelLane | p | — | working scrolled independently · ✔ the scrolled lane moved (working transform translate(0 0) → translate(0 -193)) · ✔ no other lane moved (moved: working) |
| 4 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-05-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":577.8999999761581,"harness-opened":578.7999999821186}
- paint entries: [{"name":"first-paint","startTime":16},{"name":"first-contentful-paint","startTime":36}]
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
| 5 | swimlane | p | — | lane counts are consistent with the cards drawn · ✔ working never draws more than it counts (header 11, drawn 8) · ✔ needs-you never draws more than it counts (header 2, drawn 2) · ✔ unread never draws more than it counts (header 1, drawn 1) · ✔ idle never draws more than it counts (header 1, drawn 1) · ✔ the row's working count matches the Working lane header (row 11, lane 11) · ✔ the Working lane is not empty when the row reports working threads (row 11, drawn 8) |

### TC-08: The provider→project segment is a river too, with its own drifting beads — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-link] appeared |
| 3 | swimlane | p | — | provider→project rivers are bands with beads when live · ✔ provider→project rivers exist (8 links) · ✔ the widest provider→project river is a band, not a hairline (widths 15.6,10.3,8.1,7.5,12.7,6.6,12.6,7.6) · ✔ every provider→project river is a filled band (band fill present) · ✔ live provider→project rivers carry a bead ridge (7 live, 1 quiet) · ✔ quiet provider→project rivers stay bead-free (1 quiet links) |
| 4 | assertBeads | p | — | provider→project beads are drifting · ✔ the provider→project rivers carry bead paths (7 bead paths) · ✔ the provider→project beads drift (the rivers animate) (7/7 offsets changed (-20.3893,-16.8193,-16.8867 → -38.7643,-31.977,-32.105)) |
| 5 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-08-step5-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":577.3000000119209,"harness-opened":577.9000000059605}
- paint entries: [{"name":"first-paint","startTime":28},{"name":"first-contentful-paint","startTime":44}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.0ms · Task 0.0ms

### TC-09: Tier 1 is a stack of nested subscription/model boxes whose heights encode active flow — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-tier1] appeared |
| 3 | swimlane | p | — | nested tier boxes read correctly (subscription) · ✔ Tier-1 grouping is declared (mode=subscription) · ✔ hottest-first nested Tier-1 boxes exist (6 outer boxes) · ✔ Tier-2 boxes nest inside the Tier-1 boxes (7 inner boxes) · ✔ synthetic nests at least one box (2 inner) · ✔ Codex nests at least one box (1 inner) · ✔ ollama-cloud nests at least one box (1 inner) · ✔ cove nests at least one box (1 inner) · ✔ Claude Code nests at least one box (1 inner) · ✔ Pi nests at least one box (1 inner) · ✔ every outer box wraps its inner boxes (6/6) · ✔ taller = more tokens/min (height monotone in flow) (9→59, 12→66, 17→73, 34→93, 49→107, 65→120, 76→128) · ✔ inner box heights keep a legibility floor (min 59px) |
| 4 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-09-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":573.3000000119209,"harness-opened":573.9000000059605}
- paint entries: [{"name":"first-paint","startTime":12},{"name":"first-contentful-paint","startTime":36}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script -0.0ms · Task -0.0ms

### TC-10: The view-chrome toggle swaps Tier 1 from subscription to ACP provider — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-tier1] appeared |
| 3 | swimlane | p | — | Tier-1 swapped subscription → provider · ✔ the Tier-1 toggle is present (mode=subscription) · ✔ clicking the toggle swaps the Tier-1 axis (subscription → provider) · ✔ the Tier-1 keys change with the axis (synthetic,Codex,ollama-cloud,cove,Claude Code,Pi → acp-opencode,codex,claude-code,pi) · ✔ Tier-2 boxes are re-keyed too (7 inner boxes) |
| 4 | profile | p | docs/uat//evidence/uat-token-flow-swimlanes-001/TC-10-step4-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":572.3000000119209,"harness-opened":572.9000000059605}
- paint entries: [{"name":"first-paint","startTime":24},{"name":"first-contentful-paint","startTime":40}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout 0.0ms · Script 0.0ms · Task 0.0ms

### TC-11: A burning grandchild gets its own river, from the same mouth, and its beads animate — PASSED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-card="thr_running"] appeared |
| 3 | click | p | — | clicked [data-attn-card-rect="thr_running"] |
| 4 | waitForSelector | p | — | [data-attn-card="thr_running_child"] appeared |
| 5 | click | p | — | clicked [data-attn-card-rect="thr_running_child"] |
| 6 | waitForSelector | p | — | [data-attn-lane="working"] [data-attn-card="thr_running_grand"][data-depth="2"] appeared |
| 7 | assertCount | p | — | 1 match for [data-attn-river="thr_running_grand"] path[stroke-dasharray] (want 1) |
| 8 | assertBeads | p | — | the targeted ([data-attn-river="thr_running_grand"] path[stroke-dasharray]) beads are drifting · ✔ the the targeted ([data-attn-river="thr_running_grand"] path[stroke-dasharray]) rivers carry bead paths (1 bead paths) · ✔ the the targeted ([data-attn-river="thr_running_grand"] path[stroke-dasharray]) beads drift (the rivers animate) (1/1 offsets changed (0 → -11.8191)) |

### TC-12: A rate too small to show as whole tok/min reads as quiet, never "0 tok/min" — PASSED

**Criticality:** standard

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-card="thr_trickle"] appeared |
| 3 | swimlane | p | — | a sub-token rate reads as quiet, never 0 tok/min · ✔ no card or row reads "0 tok/min" (none) · ✔ a barely-burning thread reads as quiet (1 quiet card(s)) · ✔ a genuinely burning thread still shows tok/min (9 live label(s)) |

## Console capture

- error: Failed to load resource: the server responded with a status of 404 (Not Found)
