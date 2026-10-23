// bb-plugin-activity-overview — shared model + layout math for the three views.
// Ported from the prototype generators (gen-attention-board.js): one thread is
// one status light; color = status, volume = count. Dominance is read from the
// dot color pattern only — no painted project health anywhere.

export type AttnThread = {
  id: string;
  projectId: string | null;
  title: string | null;
  parentThreadId: string | null;
  status: string;
  runtimeStatus: string;
  hasPendingInteraction: boolean;
  isUnread: boolean;
  archivedAt: number | null;
  lastReadAt: number | null;
  latestAttentionAt: number;
  updatedAt: number;
  createdAt: number;
};

export type AttnProject = { id: string; name: string };

export type Status = "error" | "needs-you" | "working" | "unread" | "idle";

// Status colors are theme tokens (views/theme.ts): one value per theme block,
// but the same four ADR-0001 hues in both light and dark.
export const HOT_COLORS: Record<Exclude<Status, "idle">, string> = {
  error: "var(--attn-error)",
  "needs-you": "var(--attn-needs-you)",
  working: "var(--attn-working)",
  unread: "var(--attn-unread)",
};

export const STATUS_NAMES: Record<Status, string> = {
  error: "error",
  "needs-you": "needs-you",
  working: "working",
  unread: "unread",
  idle: "idle",
};

/**
 * Idle dots fade with age into the stage: fresh muted ink through five mixes
 * toward near-background. The tokens (views/theme.ts) resolve against
 * whatever stage color the active theme hands over, so the fade is
 * theme-relative in both light and dark.
 */
export const GREYS: Array<[number, string]> = [
  [0.75, "var(--attn-grey-0)"],
  [6, "var(--attn-grey-1)"],
  [24, "var(--attn-grey-2)"],
  [72, "var(--attn-grey-3)"],
  [168, "var(--attn-grey-4)"],
  [Number.POSITIVE_INFINITY, "var(--attn-grey-5)"],
];

export function classify(t: AttnThread): Status {
  if (t.hasPendingInteraction) return "needs-you";
  const st = t.runtimeStatus || t.status;
  if (st === "error") return "error";
  if (st === "active") return "working";
  const unread = t.isUnread || (t.latestAttentionAt ?? 0) > (t.lastReadAt ?? 0);
  if (unread) return "unread";
  return "idle";
}

export function ageMs(t: AttnThread, nowMs: number): number {
  const at = t.latestAttentionAt ?? t.updatedAt ?? t.createdAt;
  return typeof at === "number" ? nowMs - at : Number.MAX_SAFE_INTEGER;
}

export function ageLabel(t: AttnThread, nowMs: number): string {
  const m = ageMs(t, nowMs) / 60000;
  if (m < 1) return "now";
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export function cellColor(t: AttnThread, nowMs: number): string {
  const st = classify(t);
  if (st !== "idle") return HOT_COLORS[st];
  const d = ageMs(t, nowMs) / 86400000;
  return (GREYS.find((g) => d <= g[0]) ?? GREYS[GREYS.length - 1])[1];
}

export function tip(t: AttnThread, nowMs: number): string {
  return `${t.title || t.id} · ${classify(t)} · ${ageLabel(t, nowMs)}`;
}

/** Collapse every whitespace run to one space and trim. Card text is one line. */
function flatten(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The full one-line title a hover card shows. Precedence mirrors the host's
 * own display text (title, then the untitled fallback, then the id), so a card
 * never shows an empty heading.
 */
export function threadTitle(t: {
  title: string | null;
  titleFallback?: string | null;
  id: string;
}): string {
  return flatten(t.title ?? t.titleFallback ?? "") || t.id;
}

/** One conversation message as the outline RPC exposes it. */
export type OutlineItem = { role: "user" | "assistant"; preview: string };

/**
 * The card's orientation snippet: the newest message that actually has text,
 * with its role so the card can say who last spoke. Blank trailing messages
 * (an empty pending assistant row) are skipped, and a thread with no usable
 * history yields null — the card then shows no snippet rather than inventing
 * one. `cap` bounds the text; longer text is cut with an ellipsis.
 */
export function endSnippet(
  items: readonly OutlineItem[],
  cap = 160,
): { role: "user" | "assistant"; text: string } | null {
  if (cap < 1) throw new RangeError(`endSnippet: cap must be >= 1, got ${cap}`);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    const text = flatten(item.preview);
    if (text.length === 0) continue;
    return { role: item.role, text: text.length > cap ? `${text.slice(0, cap - 1)}…` : text };
  }
  return null;
}

/** attentionScore: lower = hotter. */
export function attentionScore(t: AttnThread, nowMs: number): number {
  switch (classify(t)) {
    case "error":
      return 0;
    case "needs-you":
      return 1;
    case "working":
      return 2;
    case "unread":
      return 3;
    default:
      return 10 + Math.min(Math.max(0, ageMs(t, nowMs)) / 86400000, 90);
  }
}

export type Cell = { t: AttnThread; fam: string };

export type ProjectModel = {
  pid: string;
  name: string;
  cells: Cell[];
  n: number;
  best: number;
  hot: number;
};

/**
 * Resolve the thread-family tree (used for family grouping and tints):
 * archived threads are filtered out, parents that are themselves invisible promote their children
 * to roots, and any parentThreadId cycle is severed so a tree walk stays
 * finite (every thread caught inside a loop becomes a root).
 */
export type Family = { visible: readonly AttnThread[]; roots: readonly AttnThread[]; childrenOf: Map<string, AttnThread[]> };

export function buildAgentTree(threads: readonly AttnThread[]): Family {
  const visible = threads.filter((t) => !t.archivedAt);
  const ids = new Set(visible.map((t) => t.id));
  const directParent = new Map<string, string | null>();
  for (const t of visible) {
    directParent.set(
      t.id,
      t.parentThreadId && t.parentThreadId !== t.id && ids.has(t.parentThreadId) ? t.parentThreadId : null,
    );
  }
  const cyclic = new Set<string>();
  for (const t of visible) {
    const seen = new Set<string>([t.id]);
    let cur = directParent.get(t.id) ?? null;
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      cur = directParent.get(cur) ?? null;
    }
    if (cur !== null) cyclic.add(t.id);
  }
  const childrenOf = new Map<string, AttnThread[]>();
  const roots: AttnThread[] = [];
  for (const t of visible) {
    const p = cyclic.has(t.id) ? null : (directParent.get(t.id) ?? null);
    if (p) {
      const list = childrenOf.get(p);
      if (list) list.push(t);
      else childrenOf.set(p, [t]);
    } else {
      roots.push(t);
    }
  }
  return { visible, roots, childrenOf };
}

/**
 * Group visible threads by project, parents before their children, both
 * attention-ascending; projects sorted hottest-first.
 */
export function buildProjects(
  threads: readonly AttnThread[],
  projects: readonly AttnProject[],
  nowMs: number,
): { projects: ProjectModel[]; total: number } {
  const family = buildAgentTree(threads);
  const visible = family.visible;
  const childrenOf = family.childrenOf;
  const roots = family.roots;
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const byPid = new Map<string, AttnThread[]>();
  for (const t of visible) {
    const pid = t.projectId ?? "projectless";
    const list = byPid.get(pid);
    if (list) list.push(t);
    else byPid.set(pid, [t]);
  }
  const models: ProjectModel[] = [];
  for (const [pid, pool] of byPid) {
    const projRoots = roots
      .filter((t) => (t.projectId ?? "projectless") === pid)
      .sort((a, b) => attentionScore(a, nowMs) - attentionScore(b, nowMs));
    const cells: Cell[] = [];
    for (const r of projRoots) {
      cells.push({ t: r, fam: r.id });
      for (const k of (childrenOf.get(r.id) ?? []).slice().sort(
        (a, b) => attentionScore(a, nowMs) - attentionScore(b, nowMs),
      )) {
        cells.push({ t: k, fam: r.id });
      }
    }
    if (cells.length === 0) continue;
    const best = Math.min(...cells.map((c) => attentionScore(c.t, nowMs)));
    const hot = cells.filter((c) => classify(c.t) !== "idle").length;
    models.push({
      pid,
      name: nameOf.get(pid) ?? (pid === "projectless" ? "Projectless" : pid),
      cells,
      n: cells.length,
      best,
      hot,
    });
  }
  models.sort((a, b) => a.best - b.best || b.hot - a.hot);
  return { projects: models, total: visible.length };
}

export function statusCounts(projects: ProjectModel[], nowMs: number): Record<Status, number> {
  const counts: Record<Status, number> = { error: 0, "needs-you": 0, working: 0, unread: 0, idle: 0 };
  for (const p of projects) for (const c of p.cells) counts[classify(c.t)]++;
  return counts;
}

// ---------- unit treemap: family tints + zoom-to-project ----------

/**
 * Subtle family background tints over the neutral region fill (a
 * var(--attn-card) token): each family inside a project gets one
 * slightly-hued slot so its dots' grouping is visible without painting any
 * status-derived color. Theme tokens (views/theme.ts) — pastels on light,
 * low-key near-blacks on dark.
 */
export const FAMILY_TINTS: readonly string[] = [
  "var(--attn-tint-0)",
  "var(--attn-tint-1)",
  "var(--attn-tint-2)",
  "var(--attn-tint-3)",
  "var(--attn-tint-4)",
  "var(--attn-tint-5)",
];

/**
 * Per-cell tint-index for a project's ordered cells (families contiguous from
 * their root in cell order): cell i belongs to family run i, and run r gets
 * `r % paletteSize`. So every family tints, adjacent runs always differ, and
 * the assignment is deterministic.
 */
export function familyTints(fams: readonly string[], paletteSize = FAMILY_TINTS.length): number[] {
  const out: number[] = [];
  let run = -1;
  let prev: string | null = null;
  for (const fam of fams) {
    if (fam !== prev) {
      run++;
      prev = fam;
    }
    out.push(run % paletteSize);
  }
  return out;
}

export type ZoomTransform = { scale: number; tx: number; ty: number };

// ---------- zoomed-in interaction gate ----------

/**
 * The single camera-scale threshold past which a thread unit (a dot) becomes
 * actionable. Below it — at the fitted view and any near-fit zoom — dots stay
 * inert so the region-focus / pan gestures are unambiguous; above it, a dot
 * click opens its thread and any non-dot click returns to the fitted view.
 * Strictly greater: the threshold itself is not zoomed in.
 */
export const ZOOMED_IN_SCALE = 1.2;

/** Whether the camera scale is past the zoomed-in threshold. */
export function isZoomedIn(scale: number, threshold = ZOOMED_IN_SCALE): boolean {
  return scale > threshold;
}

/**
 * What a click on one unit should do at camera scale `k`: `"open"` its thread
 * while zoomed in, `"inert"` otherwise. One rule, two spellings of the same
 * threshold — the DOM reads the verb, the gates read the boolean.
 */
export function dotAction(scale: number, threshold = ZOOMED_IN_SCALE): "open" | "inert" {
  return isZoomedIn(scale, threshold) ? "open" : "inert";
}

// ---------- working-dot pulse rate (token burn) ----------
//
// A working dot's pulse is a slow blink (opacity 1 → 0.55 → 1). Its period is
// inversely proportional to the thread's measured token burn, so a thread
// consuming 10× the tokens pulses 10× as fast. The mapping stays legible: a
// floor keeps a very fast burn from strobing, and a ceiling keeps a very slow
// one from looking frozen.

/** The burn rate that pulses at the historical 2.2s period. Measured context
 *  growth on this machine's live roster ran ~0.2–10 tok/s, so 1 tok/s is a
 *  mid-range anchor; 10× that (10 tok/s) lands exactly on the fast floor. */
export const PULSE_REFERENCE_RATE = 1;
/** The slowest (and the pre-change) pulse period, for a zero or tiny burn. */
export const PULSE_MAX_PERIOD_MS = 2200;
/** The fastest legible pulse period, for an enormous burn. The band spans
 *  exactly 10× (2200 → 220), so a 10× burn really does pulse 10× as fast
 *  across the whole usable range; only rates outside it clamp. */
export const PULSE_MIN_PERIOD_MS = 220;
/** The period of an unmeasured thread: the pre-existing pulse, unchanged. */
export const PULSE_BASE_PERIOD_MS = PULSE_MAX_PERIOD_MS;

/**
 * The pulse period for a measured burn rate (tokens/second).
 *
 * - `null` means "no measurable rate yet" (the sampler needs two readings):
 *   the thread keeps the base pulse. No rate is invented for it.
 * - `0` is a measured zero: the thread holds the slowest pulse rather than
 *   freezing (an unchanging dot would read as idle) or strobing.
 * - Otherwise `PULSE_MAX_PERIOD_MS × reference / rate`, clamped to the band.
 *
 * Non-finite rates throw: a NaN sneaking in from a bad sample must surface,
 * never silently become a frozen or frantic dot.
 */
export function pulsePeriodMs(
  rate: number | null,
  opts: { reference?: number; min?: number; max?: number } = {},
): number {
  const reference = opts.reference ?? PULSE_REFERENCE_RATE;
  const min = opts.min ?? PULSE_MIN_PERIOD_MS;
  const max = opts.max ?? PULSE_MAX_PERIOD_MS;
  if (rate === null) return max;
  if (!Number.isFinite(rate)) throw new RangeError(`pulsePeriodMs: rate must be finite, got ${rate}`);
  if (rate <= 0) return max;
  const period = (max * reference) / rate;
  return Math.min(max, Math.max(min, period));
}

/** The measured burn rate (tokens/second) from a sample ring, over the newest
 * `windowMs`. Returns null when fewer than two in-window readings exist — the
 * honest "unknown", distinct from a measured zero. Growth is the sum of
 * positive deltas (context use is flat or rising between compactions, and a
 * shrink is compaction, not negative burn), divided by the elapsed time from
 * the first to the last in-window reading.
 */
export function burnRate(
  samples: readonly FlowSample[],
  nowMs: number,
  windowMs: number,
): number | null {
  const start = nowMs - windowMs;
  const fresh = samples.filter((s) => s.at >= start && s.at <= nowMs).sort((a, b) => a.at - b.at);
  if (fresh.length < 2) return null;
  let growth = 0;
  for (let i = 1; i < fresh.length; i++) {
    const delta = fresh[i]!.used - fresh[i - 1]!.used;
    if (delta > 0) growth += delta;
  }
  const spanMs = fresh[fresh.length - 1]!.at - fresh[0]!.at;
  if (spanMs <= 0) return null;
  return (growth * 1000) / spanMs;
}

// ---------- hover card placement ----------

export type Box = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

/** Where the hover card sits, relative to the dot. */
export type CardPlacement = { left: number; top: number; side: "above" | "below" };

/**
 * Seat a hover card next to its dot without letting it leave the panel.
 * Preference is above the dot (out of the way of the legend, which floats at
 * the bottom); a dot too close to the top flips the card below it. Both axes
 * clamp inside the panel, so a card near an edge slides inward instead of
 * being cut off. A card taller than the panel pins to the top edge and stays
 * finite — it is never pushed off-screen to "clear" the dot.
 */
export function hoverCardPlacement(
  dot: Box,
  card: Size,
  panel: Size,
  gap = 8,
): CardPlacement {
  const above = dot.y - gap - card.h;
  const below = dot.y + dot.h + gap;
  const maxTop = Math.max(0, panel.h - card.h);
  // Prefer above the dot when the whole card fits there; otherwise below when
  // that fits. When neither fits (a card taller than the room on either side)
  // keep the nearer edge, then clamp into the panel — the card stays finite
  // and visible instead of being pushed off-screen to "clear" the dot.
  let side: "above" | "below" = "above";
  let top = above;
  if (above < 0 && below + card.h <= panel.h) {
    side = "below";
    top = below;
  } else if (above < 0) {
    // Neither side fits: pin to the top edge, still marked above-or-below by
    // which side has more room.
    side = below <= panel.h - (above + card.h) ? "below" : "above";
    top = side === "below" ? below : above;
  }
  top = Math.min(maxTop, Math.max(0, top));
  const centered = dot.x + dot.w / 2 - card.w / 2;
  const maxLeft = Math.max(0, panel.w - card.w);
  const left = Math.min(maxLeft, Math.max(0, centered));
  return { left, top, side };
}

/** Clamp one pan axis to a band: the content's low edge keeps `mLow` from the
 * viewport's start (the top, where the nav chrome floats) and `mHigh` from its
 * end. Unlike `clampPan` the two ends differ — chrome-safe asymmetric clamped
 * panning (the map canvas uses `SAFE.top` up and `GAP` down). */
export function clampPanEdges(t: number, span: number, view: number, mLow: number, mHigh: number): number {
  const lo = Math.min(mLow, view - mHigh - span);
  const hi = Math.max(view - mHigh - span, mLow);
  return Math.min(hi, Math.max(lo, t));
}

export type ClampOpts = { pad?: number; maxScale?: number };

/** Scale + translate so `rect` fills the (vw × vh) viewport with padding. */
export function zoomToRect(
  rect: { x: number; y: number; w: number; h: number },
  vw: number,
  vh: number,
  opts: ClampOpts = {},
): ZoomTransform {
  const pad = opts.pad ?? 24;
  const max = opts.maxScale ?? 6;
  const scale = Math.min(
    max,
    Math.max(1, Math.min((vw - 2 * pad) / rect.w, (vh - 2 * pad) / rect.h)),
  );
  const tx = vw / 2 - scale * (rect.x + rect.w / 2);
  const ty = vh / 2 - scale * (rect.y + rect.h / 2);
  return { scale, tx, ty };
}

/** Clamp a pan so the scaled world never fully leaves the viewport. */
export function clampPan(
  tx: number,
  ty: number,
  scale: number,
  vw: number,
  vh: number,
  W: number,
  H: number,
): { tx: number; ty: number } {
  const axis = (t: number, world: number, view: number) => {
    const span = world * scale;
    if (span <= view) return (view - span) / 2;
    return Math.max(view - span, Math.min(0, t));
  };
  return { tx: axis(tx, W, vw), ty: axis(ty, H, vh) };
}

// ---------- squarified treemap (Bruls/Huizing/van Wijk) ----------
export type SquarifyInput = { key: string; weight: number };
export type Rect = { key: string; x: number; y: number; w: number; h: number };

export function squarify(items: SquarifyInput[], W: number, H: number): Rect[] {
  if (W <= 0 || H <= 0 || items.length === 0) return [];
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total <= 0) return [];
  const unit = (W * H) / total;
  const scaled = items
    .map((i) => ({ ...i, area: i.weight * unit }))
    .sort((a, b) => b.area - a.area);
  const rects: Rect[] = [];
  let x = 0, y = 0, w = W, h = H;
  const sum = (r: Array<typeof scaled[number]>) => r.reduce((s, i) => s + i.area, 0);
  const worst = (r: Array<typeof scaled[number]>, side: number) => {
    if (side <= 0 || r.length === 0) return Number.POSITIVE_INFINITY;
    const t = sum(r) / side;
    let mn = Number.POSITIVE_INFINITY, mx = 0;
    for (const i of r) {
      mn = Math.min(mn, i.area);
      mx = Math.max(mx, i.area);
    }
    return Math.max((t * t) / mn, mx / (t * t));
  };
  let i = 0;
  while (i < scaled.length) {
    const side = Math.min(w, h);
    const row = [scaled[i++]];
    while (i < scaled.length) {
      const next = worst([...row, scaled[i]], side);
      if (next <= worst(row, side)) row.push(scaled[i++]);
      else break;
    }
    const s = sum(row);
    if (w >= h) {
      const sw = s / h;
      let yy = y;
      for (const it of row) {
        const hh = it.area / sw;
        rects.push({ key: it.key, x, y: yy, w: sw, h: hh });
        yy += hh;
      }
      x += sw;
      w -= sw;
    } else {
      const sh = s / w;
      let xx = x;
      for (const it of row) {
        const ww = it.area / sh;
        rects.push({ key: it.key, x: xx, y, w: ww, h: sh });
        xx += ww;
      }
      y += sh;
      h -= sh;
    }
  }
  return rects;
}

// ---------- fixed-slot cards + shelf packing ----------
export type CardSpec = {
  key: string;
  name: string;
  n: number;
  hot: number;
  cols: number;
  rows: number;
  w: number;
  h: number;
  cells: Cell[];
};

/**
 * minW: optional minimum card width in px. When a card's dot grid is narrower
 * than minW minus the 8px side padding, cols widen so the slot grid fills the
 * card — keeps short project names truncating instead of vanishing.
 */
export function makeCards(projects: ProjectModel[], P: number, label: number, minW = 0): CardSpec[] {
  const byN = [...projects].sort((a, b) => b.n - a.n || a.best - b.best);
  return byN.map((p) => {
    const minCols = minW > P + 16 ? Math.ceil((minW - 16) / P) : 1;
    const cols = Math.max(1, Math.ceil(Math.sqrt(p.n * 1.35)), minCols);
    const rows = Math.ceil(p.n / cols);
    const w = Math.max(minW, cols * P + 16);
    const h = rows * P + label + 16;
    return { key: p.pid, name: p.name, n: p.n, hot: p.hot, cols, rows, w, h, cells: p.cells };
  });
}

export type Placed<T> = { card: T; x: number; y: number };

/** Shelf pack: tallest first, left to right, wrap into new shelves. */
export function shelfPack<T extends { w: number; h: number }>(cards: T[], W: number, dx: number, dy: number): { placed: Placed<T>[]; H: number } {
  const order = [...cards].sort((a, b) => b.h - a.h || b.w - a.w);
  const placed: Placed<T>[] = [];
  let x = 0, y = 0, shelfH = 0;
  for (const card of order) {
    if (x > 0 && x + card.w > W) {
      x = 0;
      y += shelfH + dy;
      shelfH = 0;
    }
    placed.push({ card, x, y });
    x += card.w + dx;
    shelfH = Math.max(shelfH, card.h);
  }
  return { placed, H: y + shelfH };
}

/**
 * The opening fill scale for a shelf-packed view: the largest scale in
 * `[min, cap]` whose packed height still fits `budget`. This is the Board and
 * Strip-tiles analogue of the treemap's world-equals-fit-box construction —
 * grow the pack until the shelves use the chrome-free height, then let the
 * camera open at k = 1. The cap is the anti-poster guard: with only one or two
 * projects, `budget / packed.H` can be enormous, so without a cap a single
 * card would balloon. `heightAt` must be the real pack height at a given
 * scale; a monotone-ish height in `s` lets the bisection land in ~40 steps.
 * When even `min` overflows, `min` is returned — never shrink below legible.
 */
export function fillScale(
  heightAt: (s: number) => number,
  budget: number,
  cap: number,
  min = 1,
): number {
  if (!(budget > 0) || !(cap > min)) return Math.max(min, Math.min(cap, min));
  if (heightAt(cap) <= budget) return cap;
  let lo = min;
  let hi = cap;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (heightAt(mid) <= budget) lo = mid;
    else hi = mid;
  }
  // Re-shelving can make the height non-monotone; fall back to the floor if
  // the bisected scale does not actually fit.
  return heightAt(lo) <= budget ? lo : min;
}

// ---------- unit treemap: layout + always-visible labels ----------

export type TreemapRegion = {
  p: ProjectModel;
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  cellTints: number[];
};

export type TreemapLayout = {
  regions: TreemapRegion[];
  pitch: number;
  d: number;
  projectCount: number;
};

/**
 * Squarified region layout for the unit treemap. Region area = project thread
 * count; each region is inset by `pad` so thin voids separate projects (no
 * strokes or seams). Every visible project gets exactly one region, however
 * small — the layout never drops a project, which is what keeps a label for
 * every project possible. Returns null when there is nothing to draw.
 */
export function treemapLayout(
  projects: readonly ProjectModel[],
  W: number,
  H: number,
  pad = 2,
): TreemapLayout | null {
  const total = projects.reduce((s, p) => s + p.n, 0);
  if (total === 0 || projects.length === 0 || W <= 0 || H <= 0) return null;
  const rect = squarify(projects.map((p, i) => ({ key: String(i), weight: p.n })), W, H);
  const pitch = Math.sqrt((W * H) / total);
  const d = Math.max(5, Math.min(22, Math.round(pitch * 0.38)));
  const regions = rect.map((r) => {
    const p = projects[Number(r.key)]!;
    const x = r.x + pad, y = r.y + pad;
    const w = Math.max(1, r.w - 2 * pad), h = Math.max(1, r.h - 2 * pad);
    let cols = Math.max(1, Math.floor(w / pitch));
    let rows = Math.max(1, Math.floor(h / pitch));
    let cap = cols * rows;
    while (cap < p.n) {
      if (w / cols >= h / rows) cols++;
      else rows++;
      cap = cols * rows;
    }
    const cw = w / cols, ch = h / rows;
    return { p, x, y, w, h, cols, rows, cw, ch, cellTints: familyTints(p.cells.map((c) => c.fam)) };
  });
  return { regions, pitch, d, projectCount: projects.length };
}

/**
 * The unit treemap's always-visible title layer.
 *
 * The old treatment drew a region's title only when the region was big enough
 * (`w > 64 && h > 30`) and inside the world layer, so small projects had no
 * title at fit and every title shrank away as the camera zoomed out. The fix
 * decouples the layer from the camera: each chip is drawn at a fixed screen
 * size and placed by a deterministic greedy pass that keeps it inside the
 * chrome-free box and clear of the chips already placed. Association is by
 * anchor — a chip starts at its own region's corner and is nudged outward only
 * as far as the next free slot, so distance keeps a title legible as its
 * own. Because positions are computed in screen space, the layer never
 * inherits the camera's scale.
 */
export const LABEL_H = 15;
export const LABEL_PAD = 4;
export const LABEL_CHAR_W = 6.2;
export const LABEL_SUFFIX_W = 30;
export const LABEL_MAX_W = 190;

/** A world→viewport camera (matches the map canvas transform). */
export type LabelCamera = { k: number; tx: number; ty: number };
/** A viewport-space rectangle; the label layer keeps chips inside it. */
export type ViewBox = { x: number; y: number; w: number; h: number };

/** Natural screen width of a title chip (untruncated), capped for tidiness. */
export function labelNaturalWidth(name: string): number {
  return Math.min(LABEL_MAX_W, Math.round(name.length * LABEL_CHAR_W + LABEL_SUFFIX_W));
}

/**
 * The width budget a region hands its title at camera scale `k`: the region's
 * world width on screen, minus the two side insets, floored at `LABEL_MIN_W`
 * so a title stays legible even when its region is tiny. `LABEL_MIN_W` is the
 * smallest chip that still shows a truncated but readable title; a chip wider
 * than its own region overhangs it, which the greedy pass resolves by
 * nudging.
 */
export const LABEL_MIN_W = 44;

export function labelMaxWidth(regionWorldW: number, k: number): number {
  return Math.max(LABEL_MIN_W, regionWorldW * k - 2 * LABEL_PAD);
}

export type RegionInput = { pid: string; name: string; n: number; x: number; y: number; w: number; h: number };

export type PlacedLabel = {
  pid: string;
  name: string;
  n: number;
  /** Screen-space top-left (0,0 = the canvas's top-left). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the chip could not sit at its anchor and had to shift. */
  displaced: boolean;
  /** True when a focus elsewhere has dimmed this project. */
  dimmed: boolean;
};

const OVERLAPS = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

/**
 * Deterministic candidate offsets on a uniform grid, ordered by squared screen
 * distance from (0,0), nearest first. The grid step is a chip's height plus the
 * inset. Built per call, bounded to the fit box (an anchor never needs a slot
 * farther than the box's own span), so the scan is at most a few thousand cells
 * and a real roster frees a slot within the first few rings.
 */
function labelSlots(box: ViewBox): ReadonlyArray<readonly [number, number]> {
  const step = LABEL_H + LABEL_PAD;
  const mi = Math.ceil(box.w / step);
  const mj = Math.ceil(box.h / step);
  const cells: Array<[number, number]> = [];
  for (let i = -mi; i <= mi; i++) for (let j = -mj; j <= mj; j++) cells.push([i * step, j * step]);
  cells.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0]);
  return cells;
}

/**
 * Place one fixed-size chip per on-screen region — the always-visible-title
 * layer. Chips are drawn at a constant screen size and laid out in screen
 * space, so the layer is decoupled from the camera scale and a title never
 * shrinks away with the zoom.
 *
 * Search, in priority order:
 *  1. The nearest free slot that still overlaps the chip's OWN region — the
 *     title stays over the project it names whenever the region is roomy
 *     enough (at the opening fit that is all but the two smallest projects).
 *  2. The nearest free slot anywhere in the box — a region too small to hold
 *     its own chip still keeps a visible title, nudged just past its edge.
 *  3. The clamped anchor itself — the box is full, so the chip renders on top
 *     (visible; only then possibly overlapping). Visibility wins over tidiness,
 *     which is the operator's requirement.
 *  A region wholly outside the box contributes no chip. Ordering is
 *  largest-region-first so big titles win their anchors and small ones route
 *  around them; the result is deterministic for a given (regions, cam, box,
 *  focus).
 */
export function placeRegionLabels(
  regions: readonly RegionInput[],
  cam: LabelCamera,
  box: ViewBox,
  focusPid: string | null,
): PlacedLabel[] {
  const order = [...regions].sort((a, b) => b.w * b.h - a.w * a.h || (a.pid < b.pid ? -1 : 1));
  const slots = labelSlots(box);
  const placed: PlacedLabel[] = [];
  for (const r of order) {
    const sx = r.x * cam.k + cam.tx;
    const sy = r.y * cam.k + cam.ty;
    const sw = r.w * cam.k;
    const sh = r.h * cam.k;
    if (sx + sw <= box.x || sy + sh <= box.y || sx >= box.x + box.w || sy >= box.y + box.h) continue;
    const natural = labelNaturalWidth(r.name);
    const w = Math.min(natural, labelMaxWidth(r.w, cam.k));
    const h = LABEL_H;
    // Anchor at the top-left of the region's VISIBLE intersection with the
    // box, clamped so the whole chip fits. Anchoring on the visible part (not
    // the raw corner, which may be far off-screen) keeps a title near its own
    // project instead of stranding it at the box edge.
    const visX = Math.max(box.x, sx);
    const visY = Math.max(box.y, sy);
    const ax = Math.max(box.x, Math.min(visX + LABEL_PAD, box.x + box.w - w));
    const ay = Math.max(box.y, Math.min(visY + LABEL_PAD, box.y + box.h - h));
    const own = { x: sx, y: sy, w: sw, h: sh };
    const fits = (cx: number, cy: number) =>
      cx >= box.x && cy >= box.y && cx + w <= box.x + box.w && cy + h <= box.y + box.h &&
      !placed.some((p) => OVERLAPS(p, { x: cx, y: cy, w, h }));
    let slot: { x: number; y: number } | null = null;
    // Tier 1: a fine scan inside the region's visible rect, so the chip lands
    // over its own project wherever the region is big enough to hold it. The
    // scan is bounded by the region (small), so a 4px step stays cheap.
    const rl = Math.max(box.x, sx), rt = Math.max(box.y, sy);
    const rr = Math.min(box.x + box.w - w, sx + sw - w);
    const rb = Math.min(box.y + box.h - h, sy + sh - h);
    const STEP = 4;
    for (let cy = rt; cy <= rb && slot === null; cy += STEP) {
      for (let cx = rl; cx <= rr; cx += STEP) {
        if (fits(cx, cy)) { slot = { x: cx, y: cy }; break; }
      }
    }
    if (slot === null) {
      for (const [ox, oy] of slots) { // tier 2: anywhere free in the box
        const cx = ax + ox, cy = ay + oy;
        if (!fits(cx, cy)) continue;
        slot = { x: cx, y: cy };
        break;
      }
    }
    const displaced = slot !== null && (slot.x !== ax || slot.y !== ay);
    const at = slot ?? { x: ax, y: ay }; // tier 3: visibility fallback
    placed.push({
      pid: r.pid,
      name: r.name,
      n: r.n,
      x: at.x,
      y: at.y,
      w,
      h,
      displaced,
      dimmed: focusPid !== null && focusPid !== r.pid,
    });
  }
  return placed;
}

// ---------- token flow (provider → project → swimlanes) ----------
//
// Ported from the approved swimlane mockup
// (docs/user-experience/token-flow-swimlane-mockup.html). Projects pile
// vertically, one wide row each; a project's tiers tile across its row as
// four status lanes, and every card's river fans out of one project-level
// mouth. The pipeline below is pure; the view paints it.

/** Buckets of burn history a thread series carries (the burn profile). */
export const FLOW_BUCKETS = 20;

/** A thread as the token flow view consumes it (from the plugin's flow RPC). */
export type FlowThread = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  parentThreadId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  /** Context-window usage — the per-thread token measure the host persists. */
  usedTokens: number | null;
  modelContextWindow: number | null;
  model: string | null;
  provider: string | null;
  /** Sampled burn rate, tokens per second (null: no sample history yet). */
  rate: number | null;
  /** Σ positive context growth the sampler has seen since the plugin started. */
  tracked: number | null;
  /** Per-bucket burn tokens (oldest → newest), the river's shape. Empty when
   *  the host has no burn history for the thread. */
  series: number[];
};

/** One sampled context reading (usedTokens at a wall-clock time). */
export type FlowSample = { at: number; used: number };

/**
 * Resample a thread's context-growth history into `buckets` equal wall-clock
 * intervals covering the newest `windowMs`, oldest first. Each emitted value
 * is the Σ positive growth inside that interval (context-window use is flat
 * or rising, so growth is the honest burn). A reading spanning an interval
 * boundary contributes its growth to the interval it lands in.
 */
export function resampleWindow(
  samples: FlowSample[],
  nowMs: number,
  windowMs: number,
  buckets = FLOW_BUCKETS,
): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (samples.length < 2 || windowMs <= 0) return out;
  const start = nowMs - windowMs;
  const width = windowMs / buckets;
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    const growth = cur.used - prev.used;
    if (growth <= 0 || cur.at <= start) continue; // only fresh, positive growth
    // Attribute the interval's growth to the bucket its end reading falls in.
    const at = Math.min(cur.at, nowMs);
    const index = Math.min(buckets - 1, Math.max(0, Math.floor((at - start) / width)));
    out[index] += growth;
  }
  return out;
}

export const PROVIDER_ORDER = ["anthropic", "openai", "google", "ollama", "other"] as const;
export type ProviderId = (typeof PROVIDER_ORDER)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  ollama: "Ollama",
  other: "Other",
};

/** Ribbon color per provider — theme tokens (theme.ts), both theme blocks. */
export const PROVIDER_TOKENS: Record<ProviderId, string> = {
  anthropic: "var(--attn-prov-anthropic)",
  openai: "var(--attn-prov-openai)",
  google: "var(--attn-prov-google)",
  ollama: "var(--attn-prov-ollama)",
  other: "var(--attn-prov-other)",
};

/**
 * Map a model string ("ollama-cloud/glm…", "anthropic/claude…", "pi") onto a
 * provider row; unknown prefixes land on "other". Single source of truth: the
 * server imports this for the flow RPC, so attribution never drifts between
 * front and back.
 */
export function providerOfModel(model: string | null): ProviderId {
  if (model === null) return "other";
  const m = model.toLowerCase();
  const prefix = m.split("/", 1)[0] ?? m;
  if (prefix.includes("ollama")) return "ollama";
  if (prefix.includes("anthropic") || m.includes("claude")) return "anthropic";
  if (prefix.includes("openai") || m.includes("gpt-") || prefix.includes("codex")) return "openai";
  if (prefix.includes("google") || m.includes("gemini")) return "google";
  return "other";
}

const providerOf = (t: FlowThread): ProviderId =>
  t.provider !== null && (PROVIDER_ORDER as readonly string[]).includes(t.provider)
    ? (t.provider as ProviderId)
    : providerOfModel(t.model);

/** Fold the shape statuses into the five token-flow states. */
export type TokenFlowStatus = "running" | "waiting" | "done" | "error" | "idle";
export function tokenFlowStatus(status: string): TokenFlowStatus {
  switch (status) {
    case "running":
      return "running";
    case "waiting":
    case "queued":
      return "waiting";
    case "error":
      return "error";
    case "interrupted":
    case "done":
      return "done";
    default:
      return "idle";
  }
}

/** Dot + pace per folded state: color token, bead speed factor, ribbon base
 * opacity. Factor 0 = still (error/idle carry no beads). */
export const TOKEN_FLOW_STATUS: Record<
  TokenFlowStatus,
  { color: string; factor: number; base: number }
> = {
  running: { color: "var(--attn-working)", factor: 1, base: 0.32 },
  waiting: { color: "var(--attn-needs-you)", factor: 0.35, base: 0.22 },
  done: { color: "var(--attn-unread)", factor: 0.15, base: 0.18 },
  error: { color: "var(--attn-error)", factor: 0, base: 0.12 },
  idle: { color: "var(--attn-grey-2)", factor: 0, base: 0.09 },
};

/* ============================ swimlane flow ============================ */
// The token flow view's geometry, approved as the swimlane mockup
// (docs/user-experience/token-flow-swimlane-mockup.html). Three tiers, two
// axes: providers are a vertical spine on the left; projects PILE VERTICALLY,
// one wide landscape row each (never tiled); a project's tiers TILE across its
// row as four status lanes (Working, Needs You, Unread, Idle left to right).
// A parent thread's children are CONTAINED inside its card, recursing to a
// grandchild (MAX_DEPTH). Every card in the Working lane draws its river from
// ONE project-level mouth; a collapsed group head carries its whole subtree
// flow (Sigma) and drops to its own flow once expanded. The whole thing is a
// pure function of the roster plus the open sets; the view only paints it.

/** Geometry constants of the swimlane world (the approved mockup). */
export const SWIMLANE = {
  /** Artboard width; the world height grows with the project stack. */
  W: 1860,
  TOP: 60,
  BOTTOM: 30,
  /** Provider spine (Tier 1): a vertical column of colored blocks. */
  SPINE_X: 40,
  SPINE_W: 104,
  SPINE_TOP: 90,
  /** Tier 2: the project stack. Rows span [ROW_X, W - ROW_R]. */
  ROW_X: 200,
  ROW_R: 44,
  COLLAPSED_H: 94,
  EXP_HDR: 80,
  ROW_GAP: 24,
  /** Tier 3: the four status lanes tiled across an expanded row. */
  LANE_GAP: 22,
  LANE_PAD: 13,
  LANE_H: 370,
  LANE_HDR: 28,
  LANE_FOOT: 10,
  HDR_PAD: 22,
  /** Card metrics: a card is a header, plus its open children below it. */
  THREAD_H: 54,
  THREAD_GAP: 10,
  SUB_GAP: 8,
  INDENT: 42,
  /** Working-lane gutter the rivers span before the cards. */
  TRUNK_W: 46,
  /** parent(0) -> child(1) -> grandchild(2); hard cap, no deeper. */
  MAX_DEPTH: 2,
} as const;

/** The four status lanes, left -> right. Needs You absorbs error. */
export type LaneId = "working" | "needs-you" | "unread" | "idle";

export const SWIMLANES: ReadonlyArray<{ id: LaneId; label: string; color: string }> = [
  { id: "working", label: "Working", color: "var(--attn-working)" },
  { id: "needs-you", label: "Needs You", color: "var(--attn-needs-you)" },
  { id: "unread", label: "Unread", color: "var(--attn-unread)" },
  { id: "idle", label: "Idle", color: "var(--attn-grey-2)" },
];

/** Fold a shape status onto its lane. */
export function laneOf(status: string): LaneId {
  const st = tokenFlowStatus(status);
  if (st === "running") return "working";
  if (st === "waiting" || st === "error") return "needs-you";
  if (st === "done") return "unread";
  return "idle";
}

/** Only the Working lane carries rivers; every other lane is cards only. */
export const RIVER_LANES: ReadonlyArray<LaneId> = ["working"];

/** A thread with its in-roster descendants (a contained subtree). */
export type FlowNode = { thread: FlowThread; kids: FlowNode[] };

/**
 * Build the forest of roots: a thread whose parent is absent from the roster
 * (or explicitly has none) is a root; every other thread hangs under its
 * parent. Deterministic: siblings sort by creation time, then title, then id.
 */
export function buildForest(threads: FlowThread[]): FlowNode[] {
  const byId = new Map(threads.map((t) => [t.id, t] as const));
  const kids = new Map<string, FlowThread[]>();
  const roots: FlowThread[] = [];
  for (const t of threads) {
    const parent = t.parentThreadId !== null ? byId.get(t.parentThreadId) : undefined;
    if (parent === undefined) roots.push(t);
    else {
      const list = kids.get(parent.id);
      if (list === undefined) kids.set(parent.id, [t]);
      else list.push(t);
    }
  }
  const sortThreads = (list: FlowThread[]) =>
    [...list].sort(
      (a, b) =>
        (a.createdAt ?? a.updatedAt ?? 0) - (b.createdAt ?? b.updatedAt ?? 0) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
  const node = (t: FlowThread): FlowNode => ({
    thread: t,
    kids: sortThreads(kids.get(t.id) ?? []).map(node),
  });
  return sortThreads(roots).map(node);
}

/** A whole subtree's consumption: own tokens + every descendant's. */
export function subtreeFlow(n: FlowNode): number {
  return Math.max(0, n.thread.usedTokens ?? 0) + n.kids.reduce((s, k) => s + subtreeFlow(k), 0);
}

/** A whole subtree's live rate (tok/s): own + every descendant's. */
export function subtreeRate(n: FlowNode): number {
  return Math.max(0, n.thread.rate ?? 0) + n.kids.reduce((s, k) => s + subtreeRate(k), 0);
}

/** True when a node is open AND below the nesting cap AND actually has kids. */
function openKidsOf(n: FlowNode, openThreads: ReadonlySet<string>, depth: number, maxDepth: number): FlowNode[] {
  if (depth >= maxDepth || n.kids.length === 0) return [];
  return openThreads.has(n.thread.id) ? n.kids : [];
}

/** The height a card occupies: its header, plus each open child's block. */
export function cardHeight(
  n: FlowNode,
  openThreads: ReadonlySet<string>,
  depth = 0,
  maxDepth: number = SWIMLANE.MAX_DEPTH,
): number {
  const kids = openKidsOf(n, openThreads, depth, maxDepth);
  return SWIMLANE.THREAD_H + kids.reduce((s, k) => s + SWIMLANE.SUB_GAP + cardHeight(k, openThreads, depth + 1, maxDepth), 0);
}

/** A card's own river band thickness (px), from its shown live rate. */
export function bandW(rate: number, maxRate: number): number {
  if (rate <= 0 || maxRate <= 0) return 2.6;
  return 2.6 + 13 * Math.sqrt(Math.min(1, rate / maxRate));
}

/** A river band's opacity: quiet rivers dim, hot rivers bold (0.3 .. 0.8). */
export function riverOpacity(rate: number, maxRate: number): number {
  const norm = maxRate > 0 ? Math.min(1, Math.max(0, rate) / maxRate) : 0;
  const base = rate <= 0 ? 0.16 : 0.3 + 0.62 * norm;
  return clampN(0.32 + 0.5 * base, 0.3, 0.8);
}

/** The provider -> row link thickness (px); the mockup's rateW, capped at 9. */
export function linkW(rate: number, maxRate: number): number {
  if (rate <= 0 || maxRate <= 0) return 1.6;
  return Math.min(9, 2 + 15 * Math.sqrt(Math.min(1, rate / maxRate)));
}

/** A card's shown flow: subtree sum while collapsed, own flow once expanded. */
export function shownRateOf(n: FlowNode, open: boolean): number {
  const own = Math.max(0, n.thread.rate ?? 0);
  return n.kids.length > 0 && !open ? subtreeRate(n) : own;
}

export type SwimlaneRiver = {
  id: string;
  cardId: string;
  depth: number;
  mouthX: number;
  mouthY: number;
  cardX: number;
  cardY: number;
  w: number;
  color: string;
  opacity: number;
  rate: number;
};

export type SwimlaneCard = {
  id: string;
  thread: FlowThread;
  lane: LaneId;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Subtree consumption (the bar + the total number read from it). */
  flow: number;
  /** The live rate the card reports (subtree when collapsed, own when open). */
  shownRate: number;
  hasGroup: boolean;
  open: boolean;
  canOpen: boolean;
  kidCount: number;
  error: boolean;
  color: string;
};

export type SwimlaneLane = {
  id: LaneId;
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bodyTop: number;
  visibleH: number;
  count: number;
  contentH: number;
  overflow: boolean;
  mouth: { x: number; y: number } | null;
  cards: SwimlaneCard[];
  rivers: SwimlaneRiver[];
};

export type SwimlaneProviderMix = { id: ProviderId; label: string; color: string; total: number };

export type SwimlaneRow = {
  id: string;
  name: string;
  y: number;
  h: number;
  w: number;
  expanded: boolean;
  total: number;
  rate: number;
  threads: number;
  working: number;
  prov: SwimlaneProviderMix[];
  spark: number[];
  lanes: SwimlaneLane[];
};

export type SwimlaneSpineBlock = {
  id: ProviderId;
  label: string;
  color: string;
  y: number;
  h: number;
  total: number;
  rate: number;
};

export type SwimlaneLink = {
  id: string;
  provider: ProviderId;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  opacity: number;
  rate: number;
};

export type SwimlaneLayout = {
  W: number;
  H: number;
  maxThreadRate: number;
  maxShownRate: number;
  maxFlow: number;
  totalRate: number;
  spine: SwimlaneSpineBlock[];
  links: SwimlaneLink[];
  rows: SwimlaneRow[];
};

export type SwimlaneOpts = {
  /** Artboard width (defaults to the mockup's SWIMLANE.W). */
  width?: number;
  /** Project ids whose row is expanded to its four lanes. */
  openProjects?: ReadonlySet<string>;
  /** Thread ids whose children are shown (nested inside the card). */
  openThreads?: ReadonlySet<string>;
  maxDepth?: number;
};

const clampN = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A filled sankey river: a band of thickness w leaving a mouth at (x1,y1)
 *  and landing at (x2,y2). Always paired with an explicit fill at the call
 *  site (a path with no fill defaults to black — the mockup's dark wedge). */
export function riverPath(r: { mouthX: number; mouthY: number; cardX: number; cardY: number; w: number }): string {
  const { mouthX: x1, mouthY: y1, cardX: x2, cardY: y2, w } = r;
  const mx = (x1 + x2) / 2;
  const a1 = y1 - w / 2;
  const b1 = y1 + w / 2;
  const a2 = y2 - w / 2;
  const b2 = y2 + w / 2;
  const n = (v: number) => Math.round(v * 10) / 10;
  return (
    `M ${n(x1)} ${n(a1)} C ${n(mx)} ${n(a1)}, ${n(mx)} ${n(a2)}, ${n(x2)} ${n(a2)}` +
    ` L ${n(x2)} ${n(b2)} C ${n(mx)} ${n(b2)}, ${n(mx)} ${n(b1)}, ${n(x1)} ${n(b1)} Z`
  );
}

/** The river band's top edge (a stroked hairline, fill:'none' at the call). */
export function riverEdgePath(r: { mouthX: number; mouthY: number; cardX: number; cardY: number; w: number }): string {
  const { mouthX: x1, mouthY: y1, cardX: x2, cardY: y2, w } = r;
  const mx = (x1 + x2) / 2;
  const n = (v: number) => Math.round(v * 10) / 10;
  return `M ${n(x1)} ${n(y1 - w / 2)} C ${n(mx)} ${n(y1 - w / 2)}, ${n(mx)} ${n(y2 - w / 2)}, ${n(x2)} ${n(y2 - w / 2)}`;
}

/** The river centerline the white beads ride (fill:'none' at the call). */
export function riverBeadPath(r: { mouthX: number; mouthY: number; cardX: number; cardY: number }): string {
  const { mouthX: x1, mouthY: y1, cardX: x2, cardY: y2 } = r;
  const mx = (x1 + x2) / 2;
  const n = (v: number) => Math.round(v * 10) / 10;
  return `M ${n(x1)} ${n(y1)} C ${n(mx)} ${n(y1)}, ${n(mx)} ${n(y2)}, ${n(x2)} ${n(y2)}`;
}

/** Cards paint parent-first, so a contained child sits atop its parent rect. */
export function cardPaintOrder(cards: readonly SwimlaneCard[]): SwimlaneCard[] {
  return [...cards].sort((a, b) => a.depth - b.depth || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
}

/** Rivers paint in front of every card; deepest first so the parent is front. */
export function riverPaintOrder(rivers: readonly SwimlaneRiver[]): SwimlaneRiver[] {
  return [...rivers].sort((a, b) => b.depth - a.depth || a.cardY - b.cardY || a.id.localeCompare(b.id));
}

const totalFlowOf = (nodes: readonly FlowNode[]): number => nodes.reduce((s, n) => s + subtreeFlow(n), 0);
const totalRateOf = (nodes: readonly FlowNode[]): number => nodes.reduce((s, n) => s + subtreeRate(n), 0);
const flatNodes = (nodes: readonly FlowNode[]): FlowNode[] =>
  nodes.flatMap((n) => [n, ...flatNodes(n.kids)]);

/**
 * The full swimlane layout for a roster (already window-filtered by the view).
 * Deterministic. Projects pile in one vertical stack, ordered by subtree flow
 * (the hottest project first) so the out-of-control project is at the top;
 * inside an expanded row the four lanes tile across the width, each sorted by
 * subtree flow (highest-consuming at the top).
 */
export function swimlaneLayout(threads: FlowThread[], opts: SwimlaneOpts = {}): SwimlaneLayout {
  const C = SWIMLANE;
  const W = opts.width ?? C.W;
  const maxDepth = opts.maxDepth ?? C.MAX_DEPTH;
  const openProjects = opts.openProjects ?? new Set<string>();
  const openThreads = opts.openThreads ?? new Set<string>();
  const roots = buildForest(threads);

  let maxThreadRate = 0;
  let maxShownRate = 0;
  let maxFlow = 0;
  for (const n of flatNodes(roots)) {
    maxThreadRate = Math.max(maxThreadRate, Math.max(0, n.thread.rate ?? 0));
    maxShownRate = Math.max(maxShownRate, subtreeRate(n));
    maxFlow = Math.max(maxFlow, subtreeFlow(n));
  }

  // Tier 1 — provider spine (across the whole roster).
  const provTotals = new Map<ProviderId, { total: number; rate: number }>();
  for (const t of threads) {
    const id = providerOf(t);
    const cur = provTotals.get(id) ?? { total: 0, rate: 0 };
    cur.total += Math.max(0, t.usedTokens ?? 0);
    cur.rate += Math.max(0, t.rate ?? 0);
    provTotals.set(id, cur);
  }
  const grandTotal = [...provTotals.values()].reduce((s, v) => s + v.total, 0);
  const presentProviders = PROVIDER_ORDER.filter((id) => (provTotals.get(id)?.total ?? 0) > 0);
  const spine: SwimlaneSpineBlock[] = [];
  {
    let y = C.SPINE_TOP;
    for (const id of presentProviders) {
      const v = provTotals.get(id)!;
      const frac = grandTotal > 0 ? v.total / grandTotal : 1 / Math.max(1, presentProviders.length);
      const h = Math.max(56, 420 * frac);
      spine.push({ id, label: PROVIDER_LABELS[id], color: PROVIDER_TOKENS[id], y, h, total: v.total, rate: v.rate });
      y += h + 14;
    }
  }
  const spineById = new Map(spine.map((b) => [b.id, b] as const));

  // Tier 2 — group roots into projects, hottest first.
  const projectMap = new Map<string, { id: string; name: string; roots: FlowNode[] }>();
  for (const r of roots) {
    const p = projectMap.get(r.thread.projectId);
    if (p === undefined) {
      projectMap.set(r.thread.projectId, {
        id: r.thread.projectId,
        name: r.thread.projectName,
        roots: [r],
      });
    } else p.roots.push(r);
  }
  const projects = [...projectMap.values()].sort(
    (a, b) =>
      totalFlowOf(b.roots) - totalFlowOf(a.roots) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );

  const rowX = C.ROW_X;
  const rowW = W - C.ROW_X - C.ROW_R;
  const lanes = SWIMLANES;
  const laneW = (rowW - 2 * C.HDR_PAD - (lanes.length - 1) * C.LANE_GAP) / lanes.length;

  const rows: SwimlaneRow[] = [];
  const links: SwimlaneLink[] = [];
  let y = C.TOP;

  for (const p of projects) {
    const present = p.roots.some((r) => r.thread.projectId === p.id);
    const nodes = flatNodes(p.roots);
    const threadsAll = nodes.map((n) => n.thread);
    const total = threadsAll.reduce((s, t) => s + Math.max(0, t.usedTokens ?? 0), 0);
    const rate = threadsAll.reduce((s, t) => s + Math.max(0, t.rate ?? 0), 0);
    const working = threadsAll.filter((t) => laneOf(t.status) === "working").length;
    const provMap = new Map<ProviderId, number>();
    for (const t of threadsAll) {
      const id = providerOf(t);
      provMap.set(id, (provMap.get(id) ?? 0) + Math.max(0, t.usedTokens ?? 0));
    }
    const prov: SwimlaneProviderMix[] = PROVIDER_ORDER.filter((id) => (provMap.get(id) ?? 0) > 0).map((id) => ({
      id,
      label: PROVIDER_LABELS[id],
      color: PROVIDER_TOKENS[id],
      total: provMap.get(id) ?? 0,
    }));
    // The burn sparkline follows the hottest thread in the project.
    const busiest = [...nodes].sort(
      (a, b) =>
        Math.max(0, b.thread.rate ?? 0) - Math.max(0, a.thread.rate ?? 0) ||
        subtreeFlow(b) - subtreeFlow(a) ||
        a.thread.id.localeCompare(b.thread.id),
    )[0];
    const spark = busiest !== undefined && busiest.thread.series.length > 0 ? busiest.thread.series : new Array<number>(FLOW_BUCKETS).fill(0);

    const expanded = present && openProjects.has(p.id);
    const h = expanded ? C.EXP_HDR + 12 + C.LANE_H + 16 : C.COLLAPSED_H;
    const row: SwimlaneRow = {
      id: p.id,
      name: p.name,
      y,
      h,
      w: rowW,
      expanded,
      total,
      rate,
      threads: threadsAll.length,
      working,
      prov,
      spark,
      lanes: [],
    };

    if (expanded) {
      const laneTop = y + C.EXP_HDR + 12;
      const bodyTop = laneTop + C.LANE_HDR;
      const visibleH = C.LANE_H - C.LANE_HDR - C.LANE_FOOT;
      for (let i = 0; i < lanes.length; i++) {
        const def = lanes[i]!;
        const lx = rowX + C.HDR_PAD + i * (laneW + C.LANE_GAP);
        const inLane = p.roots
          .filter((r) => laneOf(r.thread.status) === def.id)
          .sort(
            (a, b) =>
              subtreeFlow(b) - subtreeFlow(a) ||
              a.thread.title.localeCompare(b.thread.title) ||
              a.thread.id.localeCompare(b.thread.id),
          );
        const isRiver = RIVER_LANES.includes(def.id);
        const gw = isRiver ? C.TRUNK_W + 10 : 0;
        const cardX = lx + C.LANE_PAD + gw;
        const cardW = laneW - 2 * C.LANE_PAD - gw;
        const mouth = isRiver ? { x: lx + C.LANE_PAD + 4, y: bodyTop + 14 } : null;

        const cards: SwimlaneCard[] = [];
        const rivers: SwimlaneRiver[] = [];

        // `y` is the card's own top (absolute); children are placed below it
        // from that anchor, exactly like the mockup, so a nested child never
        // lands on top of its parent.
        const place = (n: FlowNode, depth: number, x: number, y: number, nodeW: number): void => {
          const kidCount = n.kids.length;
          const canOpen = depth < maxDepth && kidCount > 0;
          const open = canOpen && openThreads.has(n.thread.id);
          const kids = open ? n.kids : [];
          const cardH = cardHeight(n, openThreads, depth, maxDepth);
          const card: SwimlaneCard = {
            id: n.thread.id,
            thread: n.thread,
            lane: def.id,
            depth,
            x,
            y,
            w: nodeW,
            h: cardH,
            flow: subtreeFlow(n),
            shownRate: shownRateOf(n, open),
            hasGroup: kidCount > 0,
            open,
            canOpen,
            kidCount,
            error: tokenFlowStatus(n.thread.status) === "error",
            color: PROVIDER_TOKENS[providerOf(n.thread)],
          };
          cards.push(card);
          if (mouth !== null) {
            rivers.push({
              id: `river:${n.thread.id}`,
              cardId: n.thread.id,
              depth,
              mouthX: mouth.x,
              mouthY: mouth.y,
              cardX: x,
              cardY: y + 16,
              w: bandW(card.shownRate, maxShownRate),
              color: card.color,
              opacity: riverOpacity(card.shownRate, maxShownRate),
              rate: card.shownRate,
            });
          }
          if (kids.length > 0) {
            // The indent shrinks with the card so a nested child stays inside
            // its parent even in a narrow lane.
            const indent = Math.min(C.INDENT, Math.max(12, Math.round(nodeW * 0.22)));
            let childY = y + C.THREAD_H;
            for (const k of kids) {
              childY += C.SUB_GAP;
              place(k, depth + 1, x + indent, childY, nodeW - indent - 8);
              childY += cardHeight(k, openThreads, depth + 1, maxDepth);
            }
          }
        };

        let cy = bodyTop + C.LANE_PAD;
        for (const r of inLane) {
          place(r, 0, cardX, cy, cardW);
          cy += cardHeight(r, openThreads, 0, maxDepth) + C.THREAD_GAP;
        }
        const contentH = cy - bodyTop;
        row.lanes.push({
          id: def.id,
          label: def.label,
          color: def.color,
          x: lx,
          y: laneTop,
          w: laneW,
          h: C.LANE_H,
          bodyTop,
          visibleH,
          count: inLane.length,
          contentH,
          overflow: contentH > visibleH,
          mouth,
          cards,
          rivers,
        });
      }

      // Provider -> row links.
      const cyMid = y + C.EXP_HDR / 2;
      for (const mix of prov) {
        const block = spineById.get(mix.id);
        if (block === undefined) continue;
        links.push({
          id: `link:${p.id}:${mix.id}`,
          provider: mix.id,
          color: mix.color,
          x1: C.SPINE_X + C.SPINE_W,
          y1: block.y + block.h / 2,
          x2: rowX + 4,
          y2: cyMid,
          w: linkW(rate, maxThreadRate),
          opacity: riverOpacity(rate, maxThreadRate),
          rate,
        });
      }
    } else {
      const cyMid = y + C.COLLAPSED_H / 2;
      for (const mix of prov) {
        const block = spineById.get(mix.id);
        if (block === undefined) continue;
        links.push({
          id: `link:${p.id}:${mix.id}`,
          provider: mix.id,
          color: mix.color,
          x1: C.SPINE_X + C.SPINE_W,
          y1: block.y + block.h / 2,
          x2: rowX + 4,
          y2: cyMid,
          w: linkW(rate, maxThreadRate),
          opacity: riverOpacity(rate, maxThreadRate),
          rate,
        });
      }
    }

    rows.push(row);
    y += h + C.ROW_GAP;
  }

  const H = Math.max(240, y - C.ROW_GAP + C.BOTTOM);
  return {
    W,
    H,
    maxThreadRate,
    maxShownRate,
    maxFlow,
    totalRate: threads.reduce((s, t) => s + Math.max(0, t.rate ?? 0), 0),
    spine,
    links,
    rows,
  };
}
