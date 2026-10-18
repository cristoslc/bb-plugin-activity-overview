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

// ---------- token flow (provider → project → family, amplitude wave) ----------
//
// Ported from the approved amplitude-wave mockup
// (docs/user-experience/sankey-amplitude-wave-mockup.html, v19.1). One thread
// is one river that leaves its provider block, passes through its project's
// stacked bar, and lands on the thread's own card row in the family column.
// The candle is the thread's total spend (context-window usage), and the
// project's candle run mirrors the middle bar's height exactly.

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

/** A family: a parent thread plus its spawned children (childOf). A family
 * whose parent left the roster collapses to the child thread alone. */
export type FlowFamily = {
  key: string;
  projectId: string;
  projectName: string;
  threads: FlowThread[]; // parent first, then children
};

/**
 * Group threads into families. Deterministic: families ordered by project
 * name, then the parent thread's title, then key; members parent-first, then
 * children by creation time.
 */
export function buildFamilies(threads: FlowThread[]): FlowFamily[] {
  const byId = new Map(threads.map((t) => [t.id, t] as const));
  const sorted = [...threads].sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
  const families = new Map<string, FlowThread[]>();
  for (const t of sorted) {
    const parent = t.parentThreadId !== null ? byId.get(t.parentThreadId) : undefined;
    const key = parent !== undefined ? parent.id : t.id;
    const members = families.get(key);
    if (members === undefined) families.set(key, [t]);
    else members.push(t);
  }
  const built: FlowFamily[] = [...families.entries()].map(([key, members]) => ({
    key,
    projectId: members[0]!.projectId,
    projectName: members[0]!.projectName,
    threads: members.sort(
      (a, b) =>
        Number(a.id === key ? 0 : 1) - Number(b.id === key ? 0 : 1) ||
        (a.createdAt ?? a.updatedAt ?? 0) - (b.createdAt ?? b.updatedAt ?? 0) ||
        a.id.localeCompare(b.id),
    ),
  }));
  built.sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      (a.threads[0]?.title ?? "").localeCompare(b.threads[0]?.title ?? "") ||
      a.key.localeCompare(b.key),
  );
  return built;
}

/** Geometry constants of the amplitude-wave world (the approved mockup). */
export const TOKEN_FLOW = {
  /** Artboard width; the world height grows with the card rail. */
  W: 1740,
  H_MIN: 880,
  H_MAX: 4600,
  /** Column face x positions: faces span [X, X + face width]. */
  PX: 200,
  PW: 16,
  JX: 860,
  JW: 14,
  FX: 1400,
  ZONE_W: 300,
  TOP: 80,
  BOTTOM: 40,
  FAM_TOP: 240,
  CAPTION_H: 18,
  /** Gutter between project card clusters; gap between cards inside one. */
  CLUSTER_GAP: 64,
  FAMILY_GAP: 28,
  /** Compact row metrics; the selected card grows toward the *_SEL values. */
  ROW_H: 26,
  ROW_H_SEL: 32,
  PITCH: 32,
  PITCH_SEL: 42,
  ZONE_PAD: 12,
  /** Minimum gap between middle-column project boxes; provider block gap. */
  PROJ_BOX_GAP: 48,
  PR_GAP: 64,
  /** Design-constant px for the largest thread's total (the mockup's 200px). */
  TOTAL_PX: 200,
  /** Design-constant px for the busiest burn bucket (the mockup's 56px). */
  BUCKET_PX: 56,
  /** Mouth gradient overlay width feeding each candle. */
  MOUTH_PX: 60,
} as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clampN = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type FlowPt = { x: number; y: number };

/** Cubic point + the y at a given x (bisection) — the river centerlines. */
export function cubicPt(p0: FlowPt, p1: FlowPt, p2: FlowPt, p3: FlowPt, t: number): FlowPt {
  const s = 1 - t;
  return {
    x: s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t * t * t * p3.x,
    y: s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t * t * t * p3.y,
  };
}
export function cubicYAt(p0: FlowPt, p1: FlowPt, p2: FlowPt, p3: FlowPt, x: number): number {
  if (p3.x - p0.x < 0.5) return p0.y;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 26; k++) {
    const mid = (lo + hi) / 2;
    if (cubicPt(p0, p1, p2, p3, mid).x < x) lo = mid;
    else hi = mid;
  }
  return cubicPt(p0, p1, p2, p3, (lo + hi) / 2).y;
}
/** Catmull-Rom → cubic path through points (the band edges). */
export function crPath(pts: FlowPt[], first: string): string {
  if (pts.length === 0) return "";
  const r = (n: number) => Math.round(n * 10) / 10;
  let d = `${first} ${r(pts[0]!.x)} ${r(pts[0]!.y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    d +=
      ` C ${r(p1.x + (p2.x - p0.x) / 6)} ${r(p1.y + (p2.y - p0.y) / 6)},` +
      ` ${r(p2.x - (p3.x - p1.x) / 6)} ${r(p2.y - (p3.y - p1.y) / 6)},` +
      ` ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

export type FlowCard = {
  thread: FlowThread;
  familyKey: string;
  projectId: string;
  isParent: boolean;
  y: number;
  h: number;
  candleH: number;
  candleY: number;
  candleMid: number;
  burn: boolean;
};
export type FlowFamilyCard = {
  key: string;
  projectId: string;
  projectName: string;
  y: number;
  rowsH: number;
  pad: number;
  panelH: number;
  zoneY: number;
  zoneH: number;
  selected: boolean;
  threads: string[];
  members: FlowCard[];
};
export type FlowCluster = { name: string; captionY: number; families: FlowFamilyCard[] };
export type FlowSlice = { provider: ProviderId; threadId: string; y: number; h: number };
export type FlowProjectBox = {
  id: string;
  label: string;
  total: number;
  y: number;
  h: number;
  threads: string[];
  members: FlowCard[];
  slices: FlowSlice[];
};
export type FlowProviderBlock = {
  id: ProviderId;
  label: string;
  color: string;
  y: number;
  h: number;
  total: number;
  slots: Array<{ threadId: string; y: number; h: number }>;
};
export type FlowRiver = {
  id: string;
  provider: ProviderId;
  threadId: string;
  familyKey: string;
  projectId: string;
  status: TokenFlowStatus;
  rate: number | null;
  /** Total tokens (context usage); the candle + totals stroke read from it. */
  tokens: number;
  /** Per-bucket burn previews (oldest → newest), the A profile / C crest. */
  series: number[];
  /** Piece 1 (provider → project) and piece 2 (project → card row) cubics. */
  p0: FlowPt;
  p1: FlowPt;
  p2: FlowPt;
  p3: FlowPt;
  q0: FlowPt;
  q1: FlowPt;
  q2: FlowPt;
  q3: FlowPt;
  /** Totals stroke width in world px (B/C bands and the landing). */
  w: number;
};
export type FlowEncoding = "A" | "B" | "C";
export type FlowLayout = {
  /** Effective px-per-token for totals (candles, bars, B/C widths). */
  scale: number;
  /** Effective px-per-token for the busiest burn bucket (A profile, C crest). */
  bucketScale: number;
  H: number;
  clusters: FlowCluster[];
  families: FlowFamilyCard[];
  cards: FlowCard[];
  projects: FlowProjectBox[];
  providers: FlowProviderBlock[];
  rivers: FlowRiver[];
  droppedThreads: FlowThread[];
};

/**
 * The full amplitude-wave layout for a thread list (already window-filtered by
 * the view). Deterministic. `selected` enlarges one family's cards and `mix`
 * (0 → 1) tweens that enlargement. Cards are clustered by project (the middle
 * column's order, so rivers never cross needlessly). The totals px-per-token
 * is the mockup's 200px design constant, shrunk only when the rail would
 * overflow the artboard; the busiest burn bucket gets a fixed 56px.
 */
export function tokenFlowLayout(
  threads: FlowThread[],
  opts: { selected?: string | null; mix?: number } = {},
): FlowLayout {
  const C = TOKEN_FLOW;
  const selected = opts.selected ?? null;
  const mix = clampN(opts.mix ?? 1, 0, 1);
  const tokensOf = (t: FlowThread) => Math.max(0, t.usedTokens ?? 0);

  // Crowding: drop the smallest families until the card rail fits the artboard.
  const dropped: FlowThread[] = [];
  let families = buildFamilies(threads);
  const famTokens = (f: FlowFamily) => f.threads.reduce((s, t) => s + tokensOf(t), 0);

  const spanOf2 = (vals: number[]) => (vals.length ? Math.max(...vals) - Math.min(...vals) : 0);

  /** Positions the card rail for one effective totals scale; returns the
   *  families, cards and the column bottom (world px). */
  const rail = (fams: FlowFamily[], u: number) => {
    const clusters: FlowCluster[] = [];
    const cards: FlowCard[] = [];
    const familyCards: FlowFamilyCard[] = [];
    const rowHOf = (isSel: boolean, total: number) => {
      const base = isSel ? lerp(C.ROW_H, C.ROW_H_SEL, mix) : C.ROW_H;
      const candle = total > 0 ? Math.max(3, total * u) : 3;
      return Math.max(base, candle);
    };
    const gapOf = (isSel: boolean) =>
      isSel ? lerp(C.PITCH - C.ROW_H, C.PITCH_SEL - C.ROW_H_SEL, mix) : C.PITCH - C.ROW_H;
    const padOf = () => C.ZONE_PAD;
    const panelOf = (f: FlowFamily) =>
      selected === f.key ? lerp(0, 6 + 14 + f.threads.length * 13 + 4, mix) : 0;

    // Group families into project clusters (alphabetical, like the mockup).
    const names = [...new Set(fams.map((f) => f.projectName))].sort((a, b) =>
      a.localeCompare(b),
    );
    for (const name of names) {
      const cfams = fams.filter((f) => f.projectName === name);
      clusters.push({ name, captionY: 0, families: [] });
      for (const f of cfams) {
        const isSel = f.key === selected;
        const members: FlowCard[] = [];
        let cy = 0;
        f.threads.forEach((t, i) => {
          const tTotal = tokensOf(t);
          const h = rowHOf(isSel, tTotal);
          if (i) cy += gapOf(isSel);
          members.push({
            thread: t,
            familyKey: f.key,
            projectId: f.projectId,
            isParent: i === 0,
            y: cy,
            h,
            candleH: 0,
            candleY: 0,
            candleMid: 0,
            burn: tTotal > 0,
          });
          cy += h;
        });
        familyCards.push({
          key: f.key,
          projectId: f.projectId,
          projectName: f.projectName,
          y: 0,
          rowsH: cy,
          pad: padOf(),
          panelH: panelOf(f),
          zoneY: 0,
          zoneH: 0,
          selected: isSel,
          threads: f.threads.map((t) => t.id),
          members,
        });
        clusters[clusters.length - 1]!.families.push(familyCards[familyCards.length - 1]!);
      }
    }

    let y = C.FAM_TOP;
    for (const cl of clusters) {
      cl.captionY = y + 12;
      y += C.CAPTION_H;
      cl.families.forEach((fc, fi) => {
        if (fi) y += C.FAMILY_GAP;
        fc.y = y;
        fc.zoneY = y - fc.pad;
        fc.zoneH = fc.rowsH + 2 * fc.pad + fc.panelH;
        let my = y;
        fc.members.forEach((card, mi) => {
          if (mi) my += gapOf(fc.selected);
          card.y = my;
          my += card.h;
        });
        y += fc.rowsH + 2 * fc.pad + fc.panelH;
        for (const card of fc.members) cards.push(card);
      });
      y += C.CLUSTER_GAP;
    }
    y -= C.CLUSTER_GAP; // back off the trailing cluster gap
    return { clusters, familyCards, cards, bottom: y };
  };

  // Effective totals scale: the 200px design constant, shrunk to fit if the
  // rail would overflow the artboard (cards keep their floors; only the fit
  // budget shrinks). Solve by fixed-point over the floors, like the mockup.
  const maxTotal = Math.max(1, ...threads.map(tokensOf));
  const designU = C.TOTAL_PX / maxTotal;
  const availH = C.H_MAX - C.FAM_TOP - C.BOTTOM;
  const solveU = (fams: FlowFamily[], budget: number) => {
    let famGapCount = 0;
    let fixed = 0;
    const names = [...new Set(fams.map((f) => f.projectName))];
    for (const name of names) {
      const cfams = fams.filter((f) => f.projectName === name);
      fixed += C.CAPTION_H;
      fixed += cfams.reduce((s, f) => s + f.threads.length * C.ROW_H + 2 * C.ZONE_PAD, 0);
      famGapCount += Math.max(0, cfams.length - 1);
    }
    const gaps =
      Math.max(0, names.length - 1) * C.CLUSTER_GAP + famGapCount * C.FAMILY_GAP + fixed;
    const room = budget - gaps;
    const all = fams.flatMap((f) => f.threads);
    let u = room > 0 && all.length ? room / all.reduce((s, t) => s + tokensOf(t), 0) : 0;
    for (let pass = 0; pass < 12; pass++) {
      let floored = 0;
      let free = 0;
      for (const t of all) {
        if (tokensOf(t) * u < C.ROW_H) floored += C.ROW_H;
        else free += tokensOf(t);
      }
      const next = free > 0 ? (room - floored) / free : 0;
      if (Math.abs(next - u) < 1e-9) {
        u = Math.max(0, next);
        break;
      }
      u = Math.max(0, next);
    }
    return Math.max(0, u);
  };

  let u = designU;
  for (;;) {
    const r = rail(families, u);
    const need = r.bottom + C.BOTTOM;
    if (need <= C.H_MIN || r.bottom <= C.FAM_TOP + (C.H_MAX - C.FAM_TOP - C.BOTTOM)) {
      // Fits by growing the artboard (or already fits the minimum height).
      break;
    }
    // Overflowed the max artboard: shrink the totals scale to the fit budget.
    const fitU = solveU(families, availH);
    if (fitU < designU - 1e-9) {
      const r2 = rail(families, fitU);
      if (r2.bottom <= C.FAM_TOP + availH) {
        u = fitU;
        break;
      }
    }
    if (families.length <= 1) {
      u = fitU;
      break;
    }
    // Still too crowded: drop the smallest family and retry.
    const smallest = [...families].sort(
      (a, b) =>
        famTokens(a) - famTokens(b) ||
        (a.threads[0]?.updatedAt ?? 0) - (b.threads[0]?.updatedAt ?? 0) ||
        a.key.localeCompare(b.key),
    )[0]!;
    dropped.push(...smallest.threads);
    const gone = new Set(smallest.threads.map((t) => t.id));
    families = families.filter((f) => !f.threads.some((t) => gone.has(t.id)));
  }

  const placed = rail(families, u);
  const H = Math.max(C.H_MIN, placed.bottom + C.BOTTOM);

  // Candles: the card row's left-edge bar; burning rows carry their honest
  // data height, zero rows a full-slot grey stub. The row is sized to hold it.
  for (const card of placed.cards) {
    const total = tokensOf(card.thread);
    card.candleH = total > 0 ? Math.max(3, total * u) : card.h;
    card.candleY = total > 0 ? card.y + card.h - card.candleH : card.y;
    card.candleMid = card.y + card.h / 2;
    card.burn = total > 0;
  }
  const cardById = new Map(placed.cards.map((c) => [c.thread.id, c]));

  // Project boxes (middle): each box spans its members' card rows, with the
  // token-sliced core as the minimum; boxes spread across the column.
  const projectNames = [...new Set(placed.cards.map((c) => c.thread.projectId))];
  const projectBoxes: FlowProjectBox[] = projectNames
    .map((id) => {
      const members = placed.cards.filter((c) => c.thread.projectId === id);
      const total = members.reduce((s, c) => s + tokensOf(c.thread), 0);
      return { id, label: members[0]!.thread.projectName, members, total, y: 0, h: 0, threads: [], slices: [] };
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  for (const p of projectBoxes) {
    const span = spanOf2(p.members.flatMap((c) => [c.y, c.y + c.h]));
    // v19.1: the bar's height IS the candle run — the extent its members'
    // candles span — so a project's candle run mirrors its middle bar exactly.
    // An all-zero project keeps a thin honest bar.
    const tops = p.members.map((c) => c.candleY);
    const bots = p.members.map((c) => c.candleY + c.candleH);
    const run = Math.max(...bots) - Math.min(...tops);
    const burning = p.members.some((c) => c.burn);
    p.h = burning ? Math.max(3, run) : Math.max(8, span, 3);
    p.threads = p.members.map((c) => c.thread.id);
  }
  {
    const boxTotal = projectBoxes.reduce((s, p) => s + p.h, 0);
    const slack =
      projectBoxes.length > 1 ? (H - C.TOP - C.BOTTOM - boxTotal) / (projectBoxes.length - 1) : 0;
    const gapP = Math.max(C.PROJ_BOX_GAP, slack);
    let c = C.TOP + Math.max(0, (H - C.TOP - C.BOTTOM - boxTotal - gapP * Math.max(0, projectBoxes.length - 1)) / 2);
    for (const p of projectBoxes) {
      p.y = c;
      let cc = c;
      for (const m of p.members) {
        const sliceH = p.total > 0 ? (tokensOf(m.thread) * u) / p.total * p.h : p.h / p.members.length;
        p.slices.push({ provider: providerOf(m.thread), threadId: m.thread.id, y: cc, h: sliceH });
        cc += sliceH;
      }
      c += p.h + gapP;
    }
  }
  const sliceById = new Map<string, FlowSlice>();
  for (const p of projectBoxes) for (const s of p.slices) sliceById.set(s.threadId, s);

  // Provider blocks (left): one block per provider, pairs ordered by card y.
  const providers: FlowProviderBlock[] = [];
  {
    const present = PROVIDER_ORDER.filter((id) => placed.cards.some((c) => providerOf(c.thread) === id));
    const blocks = present.map((id) => {
      const pairs = placed.cards
        .filter((c) => providerOf(c.thread) === id)
        .sort((a, b) => a.y - b.y || a.thread.id.localeCompare(b.thread.id));
      return { id, pairs, h: pairs.reduce((s, c) => s + Math.max(2, tokensOf(c.thread) * u), 0) };
    });
    const stackH = blocks.reduce((s, b) => s + b.h, 0) + Math.max(0, blocks.length - 1) * C.PR_GAP;
    let y = C.TOP + Math.max(0, (H - C.TOP - C.BOTTOM - stackH) / 2);
    for (const b of blocks) {
      const start = y;
      const slots: Array<{ threadId: string; y: number; h: number }> = [];
      let sy = start;
      for (const c of b.pairs) {
        const sh = Math.max(2, tokensOf(c.thread) * u);
        slots.push({ threadId: c.thread.id, y: sy, h: sh });
        sy += sh;
      }
      providers.push({
        id: b.id,
        label: PROVIDER_LABELS[b.id],
        color: PROVIDER_TOKENS[b.id],
        y: start,
        h: Math.max(2, b.h),
        total: b.pairs.reduce((s, c) => s + tokensOf(c.thread), 0),
        slots,
      });
      y = sy + C.PR_GAP;
    }
  }
  const provSlot = new Map<string, { y: number; h: number }>();
  for (const p of providers) for (const s of p.slots) provSlot.set(s.threadId, s);

  // Rivers: one per burning thread, provider slot → project slice → card row.
  const rivers: FlowRiver[] = [];
  const seg2X0 = C.JX + C.JW;
  const seg2Span = C.FX - 6 - seg2X0;
  // The busiest burn bucket sets the interval scale (A profile, C crest).
  let maxBucket = 1;
  for (const t of placed.cards.map((c) => c.thread)) {
    for (const v of t.series) if (v > maxBucket) maxBucket = v;
  }
  const bucketScale = C.BUCKET_PX / maxBucket;
  for (const card of placed.cards) {
    const t = card.thread;
    const total = tokensOf(t);
    if (total <= 0) continue;
    const prov = providerOf(t);
    const ps = provSlot.get(t.id);
    const js = sliceById.get(t.id);
    if (ps === undefined || js === undefined) continue;
    const w = Math.max(1.5, total * u - 1);
    const sy = ps.y + ps.h / 2;
    const py = js.y + js.h / 2;
    const p0 = { x: C.PX + C.PW, y: sy };
    const p1 = { x: (p0.x + C.JX) / 2, y: sy };
    const p2 = { x: (p0.x + C.JX) / 2, y: py };
    const p3 = { x: C.JX, y: py };
    const q0 = { x: seg2X0, y: py };
    const q1 = { x: seg2X0 + seg2Span * 0.55, y: py };
    const q2 = { x: seg2X0 + seg2Span * 0.85, y: card.candleMid };
    const q3 = { x: C.FX - 6, y: card.candleMid };
    rivers.push({
      id: `river:${t.id}`,
      provider: prov,
      threadId: t.id,
      familyKey: card.familyKey,
      projectId: t.projectId,
      status: tokenFlowStatus(t.status),
      rate: t.rate,
      tokens: total,
      series: t.series.length ? t.series : new Array<number>(FLOW_BUCKETS).fill(0),
      p0,
      p1,
      p2,
      p3,
      q0,
      q1,
      q2,
      q3,
      w,
    });
  }

  return {
    scale: u,
    bucketScale,
    H,
    clusters: placed.clusters,
    families: placed.familyCards,
    cards: placed.cards,
    projects: projectBoxes,
    providers,
    rivers,
    droppedThreads: dropped,
  };
}

/** The river's centerline y at world x. */
export function riverYAt(r: FlowRiver, x: number): number {
  if (x <= TOKEN_FLOW.JX) return cubicYAt(r.p0, r.p1, r.p2, r.p3, x);
  return cubicYAt(r.q0, r.q1, r.q2, r.q3, x);
}
/** The centerline's unit-normal denominator (hypot(1, slope)) at world x. */
export function riverSlope(r: FlowRiver, x: number): number {
  const xPrev = Math.max(r.p0.x, x - 2);
  const xNext = Math.min(r.q3.x, x + 2);
  const yPrev = riverYAt(r, xPrev);
  const yNext = riverYAt(r, xNext);
  return Math.hypot(1, (yNext - yPrev) / (xNext - xPrev || 2));
}
/** The river's band width (px) at world x for an encoding: A = the per-bucket
 *  burn profile on the bucket scale; B/C = the totals width everywhere. */
export function riverWidthAt(r: FlowRiver, x: number, bucketScale: number, enc: FlowEncoding): number {
  if (enc !== "A") return r.w;
  const prof = riverProfileAt(r, x, bucketScale);
  return Math.max(2, prof);
}
/** Interpolate the A profile (bucket·bucketScale) at world x. */
export function riverProfileAt(r: FlowRiver, x: number, bucketScale: number): number {
  const n = r.series.length || FLOW_BUCKETS;
  const f01 = ((x - r.p0.x) / (r.q3.x - r.p0.x)) * n - 0.5;
  if (f01 <= 0) return r.series[0]! * bucketScale;
  if (f01 >= n - 1) return r.series[n - 1]! * bucketScale;
  const i = Math.floor(f01);
  const fr = f01 - i;
  return (r.series[i]! + (r.series[i + 1]! - r.series[i]!) * fr) * bucketScale;
}

/** Build the filled band, the gradient mouth and (A/C) the bright crest. */
export function buildRiverPaths(
  r: FlowRiver,
  bucketScale: number,
  enc: FlowEncoding,
): { bandD: string; mouthD: string; crestD: string | null; topPts: FlowPt[] } {
  const C = TOKEN_FLOW;
  const widthAt = (x: number) => riverWidthAt(r, x, bucketScale, enc);
  const xs1 = Array.from({ length: 7 }, (_, i) => r.p0.x + (C.JX - r.p0.x) * (i / 6));
  const xs2 = Array.from({ length: 15 }, (_, i) => seg2Start() + seg2Width() * (i / 14));
  const xsAll = enc === "A" ? xs1.concat(xs2) : xs2;
  const top: FlowPt[] = [];
  const bot: FlowPt[] = [];
  for (const x of xsAll) {
    const y = riverYAt(r, x);
    const nl = riverSlope(r, x);
    const half = widthAt(x) / 2;
    top.push({ x, y: y - half / nl });
    bot.push({ x, y: y + half / nl });
  }
  const bandD = crPath(top, "M") + crPath([...bot].reverse(), " L") + " Z";
  const mx0 = C.FX - C.MOUTH_PX;
  const mTop: FlowPt[] = [];
  const mBot: FlowPt[] = [];
  for (let i = 0; i < 7; i++) {
    const x = mx0 + (C.FX - mx0) * (i / 6);
    const y = riverYAt(r, x);
    const nl = riverSlope(r, x);
    const half = widthAt(x) / 2;
    mTop.push({ x, y: y - half / nl });
    mBot.push({ x, y: y + half / nl });
  }
  const mouthD = crPath(mTop, "M") + crPath([...mBot].reverse(), " L") + " Z";
  let crestD: string | null = null;
  if (enc === "A") crestD = crPath(top, "M");
  else if (enc === "C") {
    // The crest rides inside the totals band at its own (bucket) scale.
    const half = r.w / 2;
    const crust: FlowPt[] = [];
    for (const x of xsAll) {
      const y = riverYAt(r, x);
      const nl = riverSlope(r, x);
      const a = Math.min(riverProfileAt(r, x, bucketScale) / 2, half / nl * 0.98);
      crust.push({ x, y: y - a / nl });
    }
    crestD = crPath(crust, "M");
  }
  return { bandD, mouthD, crestD, topPts: top };
  function seg2Start() {
    return C.JX + C.JW;
  }
  function seg2Width() {
    return C.FX - 6 - (C.JX + C.JW);
  }
}

/** The river centerline as one path (beads ride it in A/B/C). */
export function riverCenterPath(r: FlowRiver): string {
  const r2 = (n: number) => Math.round(n * 10) / 10;
  return (
    `M ${r2(r.p0.x)} ${r2(r.p0.y)} C ${r2(r.p1.x)} ${r2(r.p1.y)}, ${r2(r.p2.x)} ${r2(r.p2.y)}, ${r2(r.p3.x)} ${r2(r.p3.y)}` +
    ` L ${r2(r.q0.x)} ${r2(r.q0.y)} C ${r2(r.q1.x)} ${r2(r.q1.y)}, ${r2(r.q2.x)} ${r2(r.q2.y)}, ${r2(r.q3.x)} ${r2(r.q3.y)}`
  );
}
