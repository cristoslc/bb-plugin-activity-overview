---
title: Token flow — project stack + flow-river spec
status: proposed
owner: thr_e92b7ef398
mockup: docs/user-experience/token-flow-swimlane-mockup.html
supersedes: token-flow-tiled-spec.md (declined)
---

# Token flow — project stack + flow-river spec

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
- A **parent thread's children nest inside its card** (not a separate spatial tier), the containment **recursing to a grandchild and hard-capping there**. **Every card's river fans from the one project-level mouth**; a **collapsed** group head carries its **subtree sum**, and **expanding** it drops the river to its **own flow**, because the set has disaggregated. The card's total stays the subtree sum.

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

- Each lane stacks its thread cards (dot, title, subtree bar, tok/min).
- **Every river fans from ONE project-level mouth.** All rivers — parent, child and grandchild alike — leave the **single dot at the lane's top-left** (fed by the project header) and land on their card: a filled, provider-colored band whose thickness is that card's shown flow, with white beads for live activity. Rivers are **never inherited through ancestry**; they all originate from the same mouth. Because the lane is sorted by flow, the runaway thread's river is the widest at the top. This is the primary read.
- **Collapsed shows the subtree sum; expanded drops to own flow.** A card that heads a group carries its **whole subtree's flow** (Σ own + descendants) while the group is **collapsed**, because it stands in for the set. Once **expanded**, its river drops to **its own flow only** — the descendants now show theirs, so the set has disaggregated. The card's bar and total number stay the subtree sum either way.
- **Row height is capped at the Working lane's height.** Needs You / Unread / Idle get the same height.
- **Each lane scrolls independently** (its own scroll rail); scrolling one lane never moves another.
- Needs You / Unread / Idle carry **no rivers** (they are not burning); they show their cards and counts only.
- No sky beam, and no pale connecting line: the flow is drawn as real sankey rivers in provider colors, all from the one project mouth.

## 4. Nested children (contained, recursing to grandchildren)

A thread with children shows a `▸ N sub` / `▾ N nested` chip. Opened, its children are **contained inside the parent's card** (indented, not laid out as siblings), and the containment **recurses one further level**: parent → child → **grandchild**. **Hard cap at grandchild** (operator's call, `MAX_DEPTH = 2`): a grandchild does not open its own children. At each level:

- **Every level's river comes from the same project mouth.** A child or grandchild is fed by the one top-left dot exactly like a top-level card; nothing is inherited through the parent (there is no sub-trunk).
- **The shown flow depends on expansion.** A group head that is **collapsed** carries its **subtree sum** (Σ); once **expanded** it carries **only its own flow**, since the descendants now report theirs. Leaves always carry their own flow. The **card's bar and total number show the whole-subtree sum** regardless, so while expanded a parent reads "own 15.8k tok/min · 46.5k total" — the river is its own, the total is not.
- Children stay inside the card; nesting is never a project-level tier.

## 5. Invariants preserved

- **One thread = one card** (inside its lane); a child lives inside its parent's card, at any depth.
- **No status-derived region fills** — lane/row fill is neutral; status shows only as dots and lane headers. Provider strips/branches use `--attn-prov-*`, never status.
- **Idle age via the grey ramp.**
- **Line-work** is confined to the flow view and is now the point (the rivers from the project mouth).
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
4. **Nesting depth cap:** hard cap at grandchild (operator's call; `MAX_DEPTH = 2`) — confirmed. Anything deeper would be shown collapsed at the grandchild.
5. **Rows vs. columns for very wide panels:** cap the lane count at 4 (fixed) — confirmed?
