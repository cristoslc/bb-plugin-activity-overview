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
