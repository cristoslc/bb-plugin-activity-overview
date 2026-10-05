// bb-plugin-attention — the three views (tab pages) rendered from live
// sidebar thread data. Pure functions of the model; no server state.
import { useMemo, useState, type ReactNode } from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import {
  buildProjects,
  statusCounts,
  cellColor,
  classify,
  makeCards,
  shelfPack,
  squarify,
  tip,
  type AttnProject,
  type AttnThread,
  type Cell,
  type Status,
} from "./model";

const BOARD_W = 1120;
const P = 13; // card slot pitch
const DOT = 8;
const LBL = 13;

type SidebarData = {
  threads: AttnThread[];
  projects: AttnProject[];
};

type LiveModel = {
  data: SidebarData | null;
  state: "loading" | "error" | "ready";
};

function useLiveModel(): LiveModel {
  const { status, threads, projects } = experimental_useSidebarThreads();
  return useMemo(() => {
    if (status === "loading") return { data: null, state: "loading" as const };
    if (status === "error" || !threads) return { data: null, state: "error" as const };
    return { data: { threads, projects }, state: "ready" as const };
  }, [status, threads, projects]);
}

function LegendRow({ counts }: { counts: Record<Status, number> }) {
  const colors: Array<[string, string, number]> = [
    ["error", "#e5534b", counts.error],
    ["needs-you", "#d9a53f", counts["needs-you"]],
    ["working", "#3d84e0", counts.working],
    ["unread", "#2e9e45", counts.unread],
    ["idle aging", "#8b949e", counts.idle],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {colors.filter(([, , n]) => n > 0).map(([label, color, n]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block rounded-full"
            style={label === "idle aging" ? { width: 5, height: 5, background: color, boxShadow: "5px 0 0 #545b63" } : { width: 5, height: 5, background: color }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

function Stage({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border/60 p-3" style={{ background: "#0f151d" }}>
      <div className="relative" style={{ width: w, height: Math.ceil(h) }}>
        {children}
      </div>
    </div>
  );
}

function Dot({ cell, x, y, d, nowMs }: { cell: Cell; x: number; y: number; d: number; nowMs: number }) {
  const working = classify(cell.t, nowMs) === "working";
  return (
    <div
      title={tip(cell.t, nowMs)}
      className={working ? "attn-pulse rounded-full" : "rounded-full"}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: d,
        height: d,
        background: cellColor(cell.t, nowMs),
      }}
    />
  );
}

// ---------- view 1: small-multiples board (fixed-slot cards) ----------
export function BoardView({ data, nowMs }: { data: SidebarData; nowMs: number }) {
  const model = useMemo(() => {
    const { projects } = buildProjects(data.threads, data.projects, nowMs);
    const cards = makeCards(projects, P, LBL);
    const packed = shelfPack(cards, BOARD_W, 14, 14);
    return { packed, count: projects.length };
  }, [data, nowMs]);
  return (
    <Stage w={BOARD_W} h={model.packed.H}>
      {model.packed.placed.map(({ card, x, y }) => (
        <div
          key={card.key}
          title={`${card.name} · ${card.n} threads · ${card.hot} hot`}
          className="absolute rounded-md"
          style={{ left: x, top: y, width: card.w, height: card.h, background: "#10161f", border: "1px solid #1c2430" }}
        >
          <div className="absolute truncate" style={{ left: 8, top: 4, right: 8, fontSize: 10, color: "#8fa3b8" }}>
            {card.name} · {card.n}
          </div>
          <div className="absolute" style={{ left: 8, top: LBL + 6, width: card.cols * P, height: card.rows * P }}>
            {card.cells.map((cell, i) => (
              <Dot
                key={cell.t.id}
                cell={cell}
                x={(i % card.cols) * P + 2}
                y={Math.floor(i / card.cols) * P + 2}
                d={DOT}
                nowMs={nowMs}
              />
            ))}
          </div>
        </div>
      ))}
    </Stage>
  );
}

// ---------- view 2: unit treemap (honest fill) ----------
export function UnitTreemapView({ data, nowMs }: { data: SidebarData; nowMs: number }) {
  const model = useMemo(() => {
    const W = BOARD_W, H = 240, INSET = 2;
    const { projects, total } = buildProjects(data.threads, data.projects, nowMs);
    if (total === 0 || projects.length === 0) return null;
    const rect = squarify(projects.map((p, i) => ({ key: String(i), weight: p.n })), W, H);
    const pitch = Math.sqrt((W * H) / total);
    const d = Math.max(5, Math.min(22, Math.round(pitch * 0.38)));
    const regions = rect.map((r) => {
      const p = projects[Number(r.key)];
      const x = r.x + INSET, y = r.y + INSET, w = r.w - 2 * INSET, h = r.h - 2 * INSET;
      const showLabel = w > 64 && h > 30;
      const top = showLabel ? 13 : 0;
      const h2 = Math.max(1, h - top);
      let cols = Math.max(1, Math.floor(w / pitch));
      let rows = Math.max(1, Math.floor(h2 / pitch));
      let cap = cols * rows;
      while (cap < p.n) {
        if (w / cols >= h2 / rows) cols++;
        else rows++;
        cap = cols * rows;
      }
      const cw = w / cols, ch = h2 / rows;
      return { p, x, y, w, h, showLabel, top, cols, rows, cw, ch };
    });
    return { regions, pitch, d, projectCount: projects.length };
  }, [data, nowMs]);
  if (!model) {
    return <p className="text-sm text-muted-foreground">No visible threads.</p>;
  }
  return (
    <Stage w={BOARD_W} h={240}>
      {model.regions.map((r) => (
        <div
          key={r.p.pid}
          title={`${r.p.name} · ${r.p.n} threads`}
          className="absolute rounded-sm"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: "#131a22" }}
        />
      ))}
      {model.regions.flatMap((r) =>
        r.p.cells.map((cell, i) => {
          const j = i % r.cols, k = Math.floor(i / r.cols);
          return (
            <Dot
              key={cell.t.id}
              cell={cell}
              x={r.x + (j + 0.5) * r.cw - model.d / 2}
              y={r.y + r.top + (k + 0.5) * r.ch - model.d / 2}
              d={model.d}
              nowMs={nowMs}
            />
          );
        }),
      )}
      {model.regions
        .filter((r) => r.showLabel)
        .map((r) => (
          <div
            key={`lbl-${r.p.pid}`}
            className="pointer-events-none absolute truncate"
            style={{ left: r.x + 5, top: r.y + 2, maxWidth: r.w - 10, fontSize: 9, color: "#55636f", zIndex: 3 }}
          >
            {r.p.name} · {r.p.n}
          </div>
        ))}
    </Stage>
  );
}

// ---------- view 3: strip tiles ----------
export function StripTilesView({ data, nowMs }: { data: SidebarData; nowMs: number }) {
  const model = useMemo(() => {
    const { projects } = buildProjects(data.threads, data.projects, nowMs);
    const byN = [...projects].sort((a, b) => b.n - a.n);
    const tiles = byN.map((p) => {
      const w = Math.max(120, p.n * 5 + 20);
      return { p, units: p.cells, w, h: 34 };
    });
    const packed = shelfPack(tiles, BOARD_W, 12, 10);
    return { packed };
  }, [data, nowMs]);
  return (
    <Stage w={BOARD_W} h={model.packed.H}>
      {model.packed.placed.map(({ card, x, y }) => (
        <div
          key={card.p.pid}
          title={`${card.p.name} · ${card.p.n} threads · ${card.p.hot} hot`}
          className="absolute"
          style={{ left: x, top: y, width: card.w }}
        >
          <div className="truncate" style={{ fontSize: 10, color: "#8fa3b8", marginBottom: 4 }}>
            {card.p.name} · {card.p.n}
          </div>
          <div className="flex">
            {card.units.map((cell) => (
              <div
                key={cell.t.id}
                title={tip(cell.t, nowMs)}
                className="rounded-sm"
                style={{ width: 4, height: 12, marginRight: 1, background: cellColor(cell.t, nowMs) }}
              />
            ))}
          </div>
        </div>
      ))}
    </Stage>
  );
}

// ---------- the tabbed page ----------
const TABS = [
  { id: "board", label: "Board" },
  { id: "treemap", label: "Unit treemap" },
  { id: "tiles", label: "Strip tiles" },
] as const;

export function AttentionPage() {
  const live = useLiveModel();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("board");
  if (live.state === "loading") {
    return <p className="p-4 text-sm text-muted-foreground">Loading threads…</p>;
  }
  if (live.state === "error" || live.data === null) {
    return <p className="p-4 text-sm text-muted-foreground">Could not read thread data.</p>;
  }
  const nowMs = Date.now();
  const counts = statusCounts(
    buildProjects(live.data.threads, live.data.projects, nowMs).projects,
    nowMs,
  );
  const total = buildProjects(live.data.threads, live.data.projects, nowMs).total;
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <style>{`.attn-pulse { animation: attn-pulse 2.2s ease-in-out infinite; } @keyframes attn-pulse { 50% { opacity: 0.55; } }`}</style>
      <div className="mx-auto box-border w-full max-w-6xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-md border border-border/60 bg-card p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={
                  "rounded px-3 py-1 text-xs " +
                  (tab === t.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <LegendRow counts={counts} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          one dot = one thread · {total} visible · color = status, volume = count · hover any dot for the thread
        </p>
        <div className="mt-3">
          {tab === "board" ? <BoardView data={live.data} nowMs={nowMs} /> : null}
          {tab === "treemap" ? <UnitTreemapView data={live.data} nowMs={nowMs} /> : null}
          {tab === "tiles" ? <StripTilesView data={live.data} nowMs={nowMs} /> : null}
        </div>
      </div>
    </div>
  );
}