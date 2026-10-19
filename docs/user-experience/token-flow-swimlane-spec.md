---
title: Token flow — project stack + left-tree spec
status: proposed
owner: thr_e92b7ef398
mockup: docs/user-experience/token-flow-swimlane-mockup.html
supersedes: token-flow-tiled-spec.md (declined)
---

# Token flow — project stack + left-tree spec

> [!IMPORTANT] Proposal, not implemented.
> Doc-only. `views/` and `server.ts` are untouched; `npm test` is 102 pass and `npx tsc --noEmit` is clean.

## The goal (north star)

> The primary goal is to see what the current token flow distribution looks like, in order to spot out-of-control threads. This is primarily a flow control display, with secondary benefits of seeing threads the operator may need to act on.

## The shape (three tiers, two axes)

```mermaid
graph TD
  P1[Tier 1 Provider — vertical spine] -->|burn + activity lines| P2[Tier 2 Project — vertical stack]
  P2 -->|expand| L[Tier 3 Threads — four status lanes, tiled across]
  L -->|parent expands| C[Child threads — nested inside the parent card]
```

- **Projects pile vertically** — one wide landscape row each, **never tiled**. The row list *is* the stack; it scrolls/grows downward.
- **The tiers inside a project tile** — an expanded project opens its status lanes **across the row's width**.
- A **parent thread's children nest inside its card** (not a separate spatial tier), and the **left-tree splits** into them the same way threads branch from projects.

This is the key correction from the prior pass: tiling belongs to the *tiers within a project*, not to the projects themselves.

## 1. Status lanes (the tiled tiers)

Five `tokenFlowStatus` values fold into four lanes; Needs You absorbs error (the operator's call):

| Lane (left → right) | Source statuses | Color |
|---|---|---|
| **Working** | `running` | `--attn-working` (blue) |
| **Needs You** | `waiting`, `error`, `queued` | `--attn-needs-you` (amber); error = `--attn-error` half-dot |
| **Unread** | `done`, `interrupted` | `--attn-unread` (green) |
| **Idle** | `idle` | grey ramp (age) |

**Working is far left**, closest to the incoming flow. Every lane sorts its threads **highest-consuming at the top** (the Working lane is where this matters most: the runaway thread is always the first row).

## 2. Collapsed project = one wide row (Tier 2 at rest)

A row (~full width × 94px) carries the project name, total tokens, live **tok/min**, thread/working counts, a **provider-mix strip**, and a **burn sparkline** for the hottest thread. Flow lines run provider → row: **thickness = historical burn, beads = current activity**. Quiet projects sit dim.

## 3. Expanded project = tiled status lanes (Tier 3)

Expanding a row reveals the four lanes across the width.

- Each lane stacks its thread cards (dot, title, consumption bar, tok/min).
- **The left-tree carries the flow.** From the project header a trunk runs down the Working lane's left gutter and **branches into each thread card** (branch thickness = that thread's flow, beads = live activity). Because the lane is sorted by flow, the runaway thread carries the thickest branch at the top. This is the primary read.
- **Row height is capped at the Working lane's height.** Needs You / Unread / Idle get the same height.
- **Each lane scrolls independently** (its own scroll rail); scrolling one lane never moves another.
- Needs You / Unread / Idle carry **no tree** (they are not burning); they show their cards and counts only.
- No sky beam: the branching tree is the flow.

## 4. Nested children (contained inside the parent's card)

A working thread that is a **parent** shows a `▸ N sub` chip. Opened, its children are **contained inside the parent's card** (indented, not laid out as siblings), and:

- The parent's flow number and bar become the **sum of its own and its children's flow**.
- The **left-tree splits at the parent** into its children — a short sub-trunk down the card's inner-left with a branch into each child — the same way threads branch from projects.

Parent/child stays inside the card; it is never a project-level tier. Recommend clamping at one nested level in v1.

## 5. Invariants preserved

- **One thread = one card** (inside its lane); a child lives inside its parent's card.
- **No status-derived region fills** — lane/row fill is neutral; status shows only as dots and lane headers. Provider strips/branches use `--attn-prov-*`, never status.
- **Idle age via the grey ramp.**
- **Line-work** is confined to the flow view and is now the point (the left-tree lines).
- **Theme tokens only**, light + dark.
- Dashed beads mark live activity only.

## 6. What this retires

- **The project-bar↔candle-run invariant** (the tiled direction's headache): there is no drawn project bar to the candles. Per-thread consumption bars live in the lane cards; the collapsed row shows totals + a sparkline. The invariant dissolves.
- **`droppedThreads`**: overflow is absorbed by lane scrolling and the vertical project stack. Keep only a pitch-shrink safety ceiling.
- **`TOTAL_PX = 200`**: consumption bars are now lane-relative, not a fixed 200px artboard constant.

## 7. Open questions for the operator

1. **Stack order:** order project rows by hotness (busiest at top) rather than alphabetically?
2. **Lane sort:** every lane sorts by consumption (proposed) — or should Needs You sort error-first/most-urgent?
3. **Best-case confirm:** should an all-folded project with no live burn collapse to a single thin line instead of a full row?
4. **Nested depth:** clamp the nested children at one level (proposed) or allow full recursion?
5. **Rows vs. columns for very wide panels:** cap the lane count at 4 (fixed) — confirmed?
