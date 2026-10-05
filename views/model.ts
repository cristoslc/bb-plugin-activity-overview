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

export const HOT_COLORS: Record<Exclude<Status, "idle">, string> = {
  error: "#e5534b",
  "needs-you": "#d9a53f",
  working: "#3d84e0",
  unread: "#2e9e45",
};

export const STATUS_NAMES: Record<Status, string> = {
  error: "error",
  "needs-you": "needs-you",
  working: "working",
  unread: "unread",
  idle: "idle",
};

/** Idle dots fade with age: fresh grey to near-invisible late grey. */
const GREYS: Array<[number, string]> = [
  [0.75, "#a8b3bf"],
  [6, "#8b949e"],
  [24, "#6e7681"],
  [72, "#545b63"],
  [168, "#3d444c"],
  [Number.POSITIVE_INFINITY, "#2a3038"],
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