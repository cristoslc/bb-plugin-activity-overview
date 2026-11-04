# Test Report: Rivers read an honest shape — a mid-turn burn spreads across buckets, an hour-old burn keeps the tail non-flat, and the interpolation is declared

**Suite ID:** uat-token-flow-river-shape-001
**Date:** 2026-11-04T00:23:44.088Z
**Mode:** headless (vite harness + system Chrome)
**Viewport:** 1280×800

## Summary

| Total | Passed | Failed |
|-------|--------|--------|
| 4 | 1 | 3 |

## Results

### TC-01: A mid-turn burn spreads its growth across every bucket its span covers — FAILED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-row="proj_sigma"] appeared |
| 3 | swimlane | f | — | proj_sigma: growth spans buckets (≥3 elevated of 20); proj_sigma: not one fat newest bucket · ✖ proj_sigma: growth spans buckets (≥3 elevated of 20) (1 elevated) · ✔ proj_sigma: newest bucket still burning (last point elevated) · ✖ proj_sigma: not one fat newest bucket (1 elevated) |

### TC-02: An hour-old burn keeps the tail of the window non-flat — FAILED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-row="proj_tau"] appeared |
| 3 | swimlane | f | — | proj_tau: growth spans buckets (≥2 elevated of 20) · ✖ proj_tau: growth spans buckets (≥2 elevated of 20) (1 elevated) · ✔ proj_tau: newest bucket at rest (last point at baseline) · ✔ proj_tau: not one fat newest bucket (1 elevated) |

### TC-03: The interpolation assumption is declared in the view's legend — FAILED

**Criticality:** blocker

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | f | — | timeout waiting for [data-attn-interpolation-note] |
| 3 | profile | p | docs/uat//evidence/uat-token-flow-river-shape-001/TC-03-step3-final.png |  |

**Paint profile:**

- marks (performance.now, ms): {"gone:[span[style*=\"attn-spin\"]]":561,"harness-opened":561.4000000059605}
- paint entries: [{"name":"first-paint","startTime":28},{"name":"first-contentful-paint","startTime":44}]
- longtasks (first 10): []
- Chrome metrics Δ across the case: Layout -0.0ms · Script 0.0ms · Task 0.2ms

### TC-04: The two-tier boxes still read the newest 30 minutes of the interpolated series — PASSED

**Criticality:** standard

| Step | Action | Result | Evidence | Notes |
|------|--------|--------|----------|-------|
| 1 | goto | p | — | ready (tabs) |
| 2 | waitForSelector | p | — | [data-attn-tier1] appeared |
| 3 | swimlane | p | — | nested tier boxes read correctly (subscription) · ✔ Tier-1 grouping is declared (mode=subscription) · ✔ hottest-first nested Tier-1 boxes exist (6 outer boxes) · ✔ Tier-2 boxes nest inside the Tier-1 boxes (7 inner boxes) · ✔ synthetic nests at least one box (2 inner) · ✔ Codex nests at least one box (1 inner) · ✔ ollama-cloud nests at least one box (1 inner) · ✔ cove nests at least one box (1 inner) · ✔ Claude Code nests at least one box (1 inner) · ✔ Pi nests at least one box (1 inner) · ✔ every outer box wraps its inner boxes (6/6) · ✔ taller = more tokens/min (height monotone in flow) (9→33, 12→35, 17→37, 34→43, 49→46, 65→50, 1043→128) · ✔ inner box heights keep a legibility floor (min 33px) |

## Console capture

- error: Failed to load resource: the server responded with a status of 404 (Not Found)
