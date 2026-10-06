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
 * Resolve the thread-family tree for the agent graph: archived threads are
 * filtered out, parents that are themselves invisible promote their children
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

// ---------- agent graph: lane rows (edge-less family tree) ----------
export const LANE_ROW_PITCH = 18;
export const LANE_INDENT = 16;
export const LANE_LABEL_W = 220;
export const LANE_DOT = 8;

export type LaneRow = { t: AttnThread; fam: string; depth: number };

export type LaneProject = {
  pid: string;
  name: string;
  rows: LaneRow[];
  n: number;
  best: number;
  hot: number;
};

/**
 * One projected lane list per project: families contiguous from their root,
 * depth = hierarchy level (the hierarchy encoding of the graph view; no
 * connector line-work), children attention-ascending under each parent,
 * projects hottest-first.
 */
export function laneRows(
  threads: readonly AttnThread[],
  projects: readonly AttnProject[],
  nowMs: number,
): { lanes: LaneProject[]; total: number } {
  const family = buildAgentTree(threads);
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const byPid = new Map<string, AttnThread[]>();
  for (const t of family.visible) {
    const pid = t.projectId ?? "projectless";
    const list = byPid.get(pid);
    if (list) list.push(t);
    else byPid.set(pid, [t]);
  }
  const lanes: LaneProject[] = [];
  for (const [pid, pool] of byPid) {
    const projRoots = family.roots
      .filter((t) => (t.projectId ?? "projectless") === pid)
      .sort((a, b) => attentionScore(a, nowMs) - attentionScore(b, nowMs));
    const rows: LaneRow[] = [];
    const walk = (t: AttnThread, depth: number, fam: string) => {
      rows.push({ t, fam, depth });
      for (const k of (family.childrenOf.get(t.id) ?? []).slice().sort(
        (a, b) => attentionScore(a, nowMs) - attentionScore(b, nowMs),
      )) {
        walk(k, depth + 1, fam);
      }
    };
    for (const r of projRoots) walk(r, 0, r.id);
    if (rows.length === 0) continue;
    const best = Math.min(...rows.map((r) => attentionScore(r.t, nowMs)));
    const hot = rows.filter((r) => classify(r.t) !== "idle").length;
    lanes.push({
      pid,
      name: nameOf.get(pid) ?? (pid === "projectless" ? "Projectless" : pid),
      rows,
      n: rows.length,
      best,
      hot,
    });
  }
  lanes.sort((a, b) => a.best - b.best || b.hot - a.hot);
  return { lanes, total: family.visible.length };
}

export type LaneCard = LaneProject & { w: number; h: number; maxDepth: number };

/** Region card per project lane list: widest depth sets the card width. */
export function makeLaneCards(lanes: LaneProject[], label: number): LaneCard[] {
  return [...lanes].sort((a, b) => b.n - a.n || a.best - b.best).map((p) => {
    const maxDepth = p.rows.reduce((m, r) => Math.max(m, r.depth), 0);
    const w = 16 + (maxDepth + 1) * LANE_INDENT + LANE_LABEL_W;
    const h = p.rows.length * LANE_ROW_PITCH + label + 16;
    return { ...p, maxDepth, w, h };
  });
}

// ---------- activity flow: fold policy over the server shape ----------
// The server (`shape` RPC) sends a flat node tree: root → project → thread →
// turn → work, plus static "more" nodes where it capped turns/steps. These
// helpers are pure so the fold policy is unit-testable.

export type FlowKind = "root" | "project" | "thread" | "turn" | "work" | "more";
export type FlowStatus =
  | "running"
  | "waiting"
  | "queued"
  | "done"
  | "error"
  | "interrupted"
  | "idle";

export type FlowNode = {
  id: string;
  parentId: string | null;
  kind: FlowKind;
  label: string;
  sublabel: string | null;
  status: FlowStatus;
  threadId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  input: string | null;
  output: string | null;
  meta: Record<string, string>;
};

export type ShapeDto = { nodes: FlowNode[]; generatedAt: number; truncated: boolean };

/**
 * Status colors for flow dots: the same four hot hues as the dot views;
 * done/interrupted/queued/idle borrow the idle age ramp (cooler = further
 * down the ramp), so they fade the same way in either theme.
 */
export const FLOW_COLORS: Record<FlowStatus, string> = {
  running: "var(--attn-working)",
  waiting: "var(--attn-needs-you)",
  error: "var(--attn-error)",
  done: "var(--attn-grey-2)",
  interrupted: "var(--attn-grey-1)",
  queued: "var(--attn-grey-3)",
  idle: "var(--attn-grey-4)",
};

/** Statuses worth showing expanded by default. */
export const ACTIVE_STATUSES: ReadonlySet<FlowStatus> = new Set([
  "running",
  "waiting",
  "queued",
  "error",
]);

/** Newest work rows shown per expanded turn; older ones fold under "+N". */
export const WORK_SHOWN = 8;

export type FlowIndex = {
  childrenOf: Map<string, FlowNode[]>;
  /** threadId → its newest turn's id (empty when the thread has no turns). */
  newestTurn: Map<string, string>;
  threadsOf: Map<string, FlowNode[]>; // projectId → thread nodes, server order
};

export function indexShape(shape: ShapeDto): FlowIndex {
  const childrenOf = new Map<string, FlowNode[]>();
  for (const node of shape.nodes) {
    if (node.parentId === null) continue;
    const list = childrenOf.get(node.parentId);
    if (list) list.push(node);
    else childrenOf.set(node.parentId, [node]);
  }
  const newestTurn = new Map<string, string>();
  for (const node of shape.nodes) {
    if (node.kind === "turn" && node.threadId !== null) {
      newestTurn.set(node.threadId, node.id); // server order: oldest → newest
    }
  }
  const threadsOf = new Map<string, FlowNode[]>();
  for (const node of shape.nodes) {
    if (node.kind !== "thread") continue;
    const pid = node.parentId ?? "";
    const list = threadsOf.get(pid);
    if (list) list.push(node);
    else threadsOf.set(pid, [node]);
  }
  return { childrenOf, newestTurn, threadsOf };
}

/**
 * Default fold policy: projects open, active threads open, idle/done threads
 * closed, and only the newest turn of a *running* thread expanded (its work
 * list stays closed until clicked).
 */
export function flowDefaultOpen(shape: ShapeDto): Set<string> {
  const index = indexShape(shape);
  const open = new Set<string>();
  for (const node of shape.nodes) {
    if (node.kind === "project") open.add(node.id);
    if (node.kind === "thread" && ACTIVE_STATUSES.has(node.status)) open.add(node.id);
  }
  for (const thread of shape.nodes) {
    if (thread.kind !== "thread" || thread.status !== "running") continue;
    const newest = index.newestTurn.get(thread.id);
    if (newest !== undefined) open.add(newest);
  }
  return open;
}

/**
 * Children of `parentId` as the view renders them. `hideIdleThreads` drops
 * idle thread rows of a project card. `foldWork` trims a turn's work list to
 * the newest WORK_SHOWN rows behind a synthetic "+N earlier steps" node
 * (id `parentId::earlier`); expanding that turn's `parentId::all` key reveals
 * every row the server kept.
 */
export function flowChildren(
  parentId: string,
  index: FlowIndex,
  open: ReadonlySet<string>,
  opts: { hideIdleThreads?: boolean; foldWork?: boolean } = {},
): FlowNode[] {
  let children = index.childrenOf.get(parentId) ?? [];
  if (opts.hideIdleThreads) {
    children = children.filter((c) => !(c.kind === "thread" && c.status === "idle"));
  }
  if (opts.foldWork && children.length > WORK_SHOWN && !open.has(`${parentId}::all`)) {
    const shown = children.slice(-WORK_SHOWN);
    const folded = children.length - shown.length;
    return [
      {
        id: `${parentId}::earlier`,
        parentId,
        kind: "more",
        label: `+${folded} earlier steps`,
        sublabel: null,
        status: "done",
        threadId: shown[0]?.threadId ?? null,
        startedAt: null,
        completedAt: null,
        input: null,
        output: null,
        meta: {},
      },
      ...shown,
    ];
  }
  return children;
}

/** "now · Xm · Xh · Xd" for a past timestamp. */
export function sinceLabel(at: number, nowMs: number): string {
  const m = (nowMs - at) / 60000;
  if (m < 1) return "now";
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Right-aligned age: threads age since their last update (meta.updated);
 * turns and work rows show their duration while done, or running time.
 */
export function flowAge(node: FlowNode, nowMs: number): string {
  if (node.kind === "thread") {
    const at = Number(node.meta.updated ?? "");
    return Number.isFinite(at) && at > 0 ? sinceLabel(at, nowMs) : "";
  }
  const end = node.completedAt ?? (node.status === "running" || node.status === "waiting" ? null : node.startedAt);
  if (end !== null && node.startedAt !== null && end >= node.startedAt) {
    return sinceLabel(end, nowMs) === "now" ? "<1m" : spanOf(end - node.startedAt);
  }
  return node.startedAt !== null ? `${sinceLabel(node.startedAt, nowMs)} running` : "";
}

function spanOf(ms: number): string {
  const m = ms / 60000;
  if (m < 1) return "<1m";
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

// ---------- activity flow: tidy-tree layout over the fold policy ----------
// Horizontal node cards, one column per depth level, like the Agent Graph
// panel: children stack vertically under an expanded parent and the parent
// card centers on its children's extent.

export const NODE_W = 240;
export const NODE_H = 58;
export const COL_GAP = 64;
export const ROW_GAP = 14;

export type PlacedNode = {
  node: FlowNode;
  x: number;
  y: number;
  depth: number;
  parentId: string | null;
  childCount: number;
  expanded: boolean;
};

/**
 * Positions for the flow tree. Fold state decides which nodes expand.
 * Scope gates depth: at top scope (scope = null) projects expand to thread
 * rows only; once a project or thread is in scope, turns and work unlock.
 * statusFilter keeps only threads whose status is included (empty set = all);
 * nodes on the scope path are always exempt from filtering.
 */
export function flowLayout(
  shape: ShapeDto,
  open: ReadonlySet<string>,
  opts: { statusFilter?: ReadonlySet<FlowStatus>; scope?: string | null } = {},
): { placed: PlacedNode[]; W: number; H: number } {
  const index = indexShape(shape);
  const byId = new Map(shape.nodes.map((n) => [n.id, n]));
  const scopePath = new Set<string>();
  if (opts.scope != null) {
    let cur = byId.get(opts.scope);
    while (cur !== undefined && cur.kind !== "root") {
      scopePath.add(cur.id);
      cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
    }
  }
  const deep = scopePath.size > 0; // focused inside a project or thread
  const scopedThreadId =
    opts.scope !== null && opts.scope !== undefined && byId.get(opts.scope)?.kind === "thread"
      ? opts.scope
      : null;
  const passes = (t: FlowNode) =>
    scopePath.has(t.id) ||
    opts.statusFilter === undefined ||
    opts.statusFilter.size === 0 ||
    opts.statusFilter.has(t.status);
  const kids = (node: FlowNode): FlowNode[] => {
    switch (node.kind) {
      case "root": {
        let projects = (index.childrenOf.get(node.id) ?? []).filter((n) => n.kind === "project");
        if (deep) projects = projects.filter((p) => scopePath.has(p.id));
        // Projects with no surviving threads drop out (unless on the path —
        // a project has no thread status to filter by, but keep the chain).
        return projects.filter(
          (p) => scopePath.has(p.id) || (index.threadsOf.get(p.id) ?? []).some((t) => passes(t)),
        );
      }
      case "project": {
        let threads = index.childrenOf.get(node.id) ?? [];
        if (scopedThreadId !== null) threads = threads.filter((t) => t.id === scopedThreadId);
        return threads.filter((t) => passes(t));
      }
      case "thread":
        // Turn level is gated: thread children exist only in scope.
        return deep ? index.childrenOf.get(node.id) ?? [] : [];
      case "turn":
        return flowChildren(node.id, index, open, { foldWork: true });
      default:
        return [];
    }
  };
  const effOpen = new Set(open);
  for (const id of scopePath) effOpen.add(id);
  const root = shape.nodes.find((n) => n.kind === "root");
  if (root === undefined) return { placed: [], W: 0, H: 0 };
  const placed: PlacedNode[] = [];
  const walk = (
    node: FlowNode,
    depth: number,
    x: number,
    top: number,
  ): { h: number; mid: number } => {
    // The root is the canvas anchor, not a fold: it always expands.
    const nodeKids = node.kind === "root" || effOpen.has(node.id) ? kids(node) : [];
    const spans: Array<{ h: number; mid: number }> = [];
    let cursor = top;
    // Parent card is placed before its subtree (preorder) so lists read
    // top-down in tree order; its y is filled in once children are placed.
    const self: PlacedNode = {
      node,
      x,
      y: top,
      depth,
      parentId: node.parentId,
      childCount: nodeKids.length,
      expanded: effOpen.has(node.id),
    };
    placed.push(self);
    for (const kid of nodeKids) {
      const sub = walk(kid, depth + 1, x + NODE_W + COL_GAP, cursor);
      spans.push(sub);
      cursor += sub.h + ROW_GAP;
    }
    // `cursor` is absolute; the subtree height is the span from this
    // subtree's own top to the packed bottom of the children.
    const h = nodeKids.length === 0 ? NODE_H : Math.max(cursor - ROW_GAP - top, NODE_H);
    const mid =
      nodeKids.length === 0
        ? top + NODE_H / 2
        : (spans[0]!.mid + spans[spans.length - 1]!.mid) / 2;
    self.y = mid - NODE_H / 2;
    return { h, mid };
  };
  const tree = walk(root, 0, 0, 0);
  const W = placed.reduce((m, p) => Math.max(m, p.x + NODE_W), 0);
  const H = Math.max(tree.h, placed.reduce((m, p) => Math.max(m, p.y + NODE_H), 0));
  return { placed, W, H };
}