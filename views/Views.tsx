// bb-plugin-activity-overview — the views (tab pages). The four aggregate
// views render from live sidebar thread data; the Activity flow tab reads the
// turn/work shape from the plugin's own `shape` RPC. Pure functions of the
// model; no other server state.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  experimental_useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { Shape, rpcContract } from "../server";
import {
  buildProjects,
  statusCounts,
  cellColor,
  classify,
  makeCards,
  laneRows,
  makeLaneCards,
  shelfPack,
  squarify,
  tip,
  flowLayout,
  flowDefaultOpen,
  flowAge,
  FLOW_COLORS,
  familyTints,
  FAMILY_TINTS,
  zoomToRect,
  clampPan,
  NODE_W,
  NODE_H,
  LANE_ROW_PITCH,
  LANE_INDENT,
  LANE_LABEL_W,
  LANE_DOT,
  type AttnProject,
  type AttnThread,
  type Cell,
  type FlowNode,
  type FlowStatus,
  type PlacedNode,
  type ShapeDto,
  type Status,
} from "./model";
import { SHAPE_CHANGED, type ShapeChangedPayload } from "../shared";

const MIN_STAGE_W = 320; // pack floor for very narrow panels
const STAGE_CHROME = 26; // stage p-3 (2×12) + 1px border each side
const P = 13; // card slot pitch
const DOT = 8;
const LBL = 13;
const BOARD_MIN_CARD_W = 120; // keeps one-dot cards readable (name fits)

type SidebarData = {
  threads: readonly AttnThread[];
  projects: readonly AttnProject[];
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

/**
 * Measure the width available for the stage (the wrapper the views mount into)
 * so packing reflows to the panel instead of overflowing it.
 */
function useStageWidth(min: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(min);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const cw = el.clientWidth;
      if (cw > 0) setW(Math.floor(cw));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
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
          {label}&thinsp;{n}
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
  const working = classify(cell.t) === "working";
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
export function BoardView({ data, nowMs, w }: { data: SidebarData; nowMs: number; w: number }) {
  const model = useMemo(() => {
    const { projects } = buildProjects(data.threads, data.projects, nowMs);
    const cards = makeCards(projects, P, LBL, BOARD_MIN_CARD_W);
    const packed = shelfPack(cards, w, 14, 14);
    return { packed, count: projects.length };
  }, [data, nowMs, w]);
  return (
    <Stage w={w} h={model.packed.H}>
      {model.packed.placed.map(({ card, x, y }) => (
        <div
          key={card.key}
          title={`${card.name} · ${card.n} threads · ${card.hot} hot`}
          className="absolute rounded-md"
          style={{ left: x, top: y, width: card.w, height: card.h, background: "#10161f", border: "1px solid #1c2430" }}
        >
          <div className="absolute truncate" style={{ left: 8, top: 4, right: 8, fontSize: 11, color: "#9fb4c8" }}>
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

// ---------- view 2: unit treemap (honest fill + zoom-to-project) ----------
const TREEMAP_H = 360; // board viewport height; the world fills it at 1× (fit)
const MAX_ZOOM = 6; // wheel/pinch ceiling
const ZOOM_SENS = 0.0025; // wheel pixels → zoom-factor exponent
const HOVER_TINT_SCALE = 1.2; // family tints preview only when zoomed in past this
const LONG_PRESS_MS = 400; // touch hold previews family tints
const FOCUS_PAD = 28; // zoom-to-project padding, world px

type ViewState = { scale: number; tx: number; ty: number };
const FIT: ViewState = { scale: 1, tx: 0, ty: 0 };

export function UnitTreemapView({ data, nowMs, w }: { data: SidebarData; nowMs: number; w: number }) {
  const model = useMemo(() => {
    const W = w, H = TREEMAP_H, INSET = 2;
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
      return {
        p,
        x,
        y,
        w,
        h,
        showLabel,
        top,
        cols,
        rows,
        cw,
        ch,
        cellTints: familyTints(p.cells.map((c) => c.fam)),
      };
    });
    return { regions, d };
  }, [data, nowMs, w]);

  const boxRef = useRef<HTMLDivElement>(null);
  // Board pan/zoom (wheel = around the cursor; pinch = two pointers; fit = 1×).
  const [view, setView] = useState<ViewState>(FIT);
  // Focus: clicking/tapping a project dims the rest, zooms the board until the
  // project fills the viewport, and locks the family tints on. Tapping
  // anywhere else (or ⤢) restores the fit view.
  const [focusPid, setFocusPid] = useState<string | null>(null);
  const [hoverPid, setHoverPid] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);

  const dragRef = useRef<{ moved: boolean; lastX: number; lastY: number } | null>(null);
  const pinchRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDistRef = useRef(0);
  const holdRef = useRef<number | null>(null);
  const suppressTapRef = useRef(false);
  const modelRef = useRef(model);
  modelRef.current = model;

  const restore = () => {
    setHoverPid(null);
    setFocusPid(null);
  };

  // Wheel zoom requires a non-passive listener. When the zoom lands back at
  // 1× the pan clamp re-centers the world, so fit is always {1, 0, 0}.
  useEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((prev) => {
        const scale = Math.max(1, Math.min(MAX_ZOOM, prev.scale * Math.exp(-e.deltaY * ZOOM_SENS)));
        const k = scale / prev.scale;
        const { tx, ty } = clampPan(cx - (cx - prev.tx) * k, cy - (cy - prev.ty) * k, scale, w, TREEMAP_H, w, TREEMAP_H);
        return { scale, tx, ty };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [w, model]);

  // Focus zooms the tapped project to fill the board; clearing focus re-fits.
  // Model data drift re-reading is accepted; only focus changes re-aim the view.
  useEffect(() => {
    if (focusPid === null) {
      setView(FIT);
      setHoverPid(null);
      return;
    }
    const regions = modelRef.current?.regions ?? [];
    const r = regions.find((rr) => rr.p.pid === focusPid);
    if (r === undefined) {
      // The focused project dropped out of the live data.
      setFocusPid(null);
      setView(FIT);
      return;
    }
    const zoom = zoomToRect({ x: r.x, y: r.y, w: r.w, h: r.h }, w, TREEMAP_H, { pad: FOCUS_PAD, maxScale: MAX_ZOOM });
    const { tx, ty } = clampPan(zoom.tx, zoom.ty, zoom.scale, w, TREEMAP_H, w, TREEMAP_H);
    setView({ scale: zoom.scale, tx, ty });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPid]);

  const zoomAround = (mx: number, my: number, factor: number) => {
    setView((prev) => {
      const scale = Math.max(1, Math.min(MAX_ZOOM, prev.scale * factor));
      const k = scale / prev.scale;
      const { tx, ty } = clampPan(mx - (mx - prev.tx) * k, my - (my - prev.ty) * k, scale, w, TREEMAP_H, w, TREEMAP_H);
      return { scale, tx, ty };
    });
  };

  const onBoxDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current.size === 2) {
      const [a, b] = [...pinchRef.current.values()];
      pinchDistRef.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    dragRef.current = { moved: false, lastX: e.clientX, lastY: e.clientY };
    setPanning(true);
  };

  const onBoxMove = (e: ReactPointerEvent) => {
    if (pinchRef.current.has(e.pointerId)) pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = dragRef.current;
    if (d === null) return;
    if (pinchRef.current.size === 2) {
      const [a, b] = [...pinchRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const prev = pinchDistRef.current;
      const box = boxRef.current;
      if (prev > 0 && dist > 0 && box !== null) {
        const rect = box.getBoundingClientRect();
        zoomAround((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, dist / prev);
      }
      pinchDistRef.current = dist;
      d.moved = true;
      return;
    }
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    setView((prev) => {
      const { tx, ty } = clampPan(prev.tx + dx, prev.ty + dy, prev.scale, w, TREEMAP_H, w, TREEMAP_H);
      return { scale: prev.scale, tx, ty };
    });
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  };

  // One release path for taps, pans and pinch ends. A tap on a region while
  // nothing is focused focuses it; a tap while focused (on anything, region
  // or void) restores. Pans and long-press releases never tap.
  const onBoxUp = (e: ReactPointerEvent) => {
    const moved = dragRef.current?.moved ?? false;
    dragRef.current = null;
    pinchRef.current.delete(e.pointerId);
    if (pinchRef.current.size < 2) pinchDistRef.current = 0;
    setPanning(false);
    if (holdRef.current !== null) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
    if (moved || suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const pid = (e.target as HTMLElement).closest<HTMLElement>("[data-region]")?.dataset.region ?? null;
    if (focusPid !== null) {
      restore();
      return;
    }
    if (pid !== null) setFocusPid(pid);
  };

  const onBoxCancel = (e: ReactPointerEvent) => {
    dragRef.current = null;
    pinchRef.current.delete(e.pointerId);
    if (pinchRef.current.size < 2) pinchDistRef.current = 0;
    setPanning(false);
    if (holdRef.current !== null) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
    suppressTapRef.current = false;
  };

  if (!model) {
    return <p className="text-sm text-muted-foreground">No visible threads.</p>;
  }

  const tintedPid = (pid: string) => focusPid === pid || (focusPid === null && hoverPid === pid);

  return (
    <div
      ref={boxRef}
      className="relative touch-none select-none overflow-hidden rounded-md border border-border/60"
      style={{ width: w, height: TREEMAP_H, background: "#0f151d", cursor: panning ? "grabbing" : "grab" }}
      onPointerDown={onBoxDown}
      onPointerMove={onBoxMove}
      onPointerUp={onBoxUp}
      onPointerCancel={onBoxCancel}
    >
      <div
        className="absolute"
        style={{
          width: w,
          height: TREEMAP_H,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: "0 0",
          transition: panning ? "none" : "transform 220ms ease",
        }}
      >
        {model.regions.map((r) => {
          const tinted = tintedPid(r.p.pid) && (focusPid !== null || view.scale > HOVER_TINT_SCALE);
          const dim = focusPid !== null && focusPid !== r.p.pid;
          return (
            <div
              key={r.p.pid}
              data-region={r.p.pid}
              title={`${r.p.name} · ${r.p.n} threads`}
              className="absolute overflow-hidden rounded-sm"
              style={{
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                background: "#131a22",
                opacity: dim ? 0.3 : 1,
                cursor: "pointer",
                transition: "opacity 200ms ease",
              }}
              onPointerLeave={() => {
                if (holdRef.current !== null) {
                  clearTimeout(holdRef.current);
                  holdRef.current = null;
                }
                if (hoverPid === r.p.pid) setHoverPid(null);
              }}
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") setHoverPid(r.p.pid);
              }}
              onPointerDown={(e) => {
                if (e.pointerType === "touch") {
                  suppressTapRef.current = false;
                  if (holdRef.current !== null) clearTimeout(holdRef.current);
                  // A press-and-hold previews the family tints (peek); the
                  // preview stays on until the next press.
                  holdRef.current = window.setTimeout(() => {
                    suppressTapRef.current = true;
                    setHoverPid(r.p.pid);
                  }, LONG_PRESS_MS);
                }
              }}
            >
              {tinted
                ? r.cellTints.map((tint, i) => (
                    <div
                      key={i}
                      className="pointer-events-none absolute"
                      style={{
                        left: (i % r.cols) * r.cw,
                        top: r.top + Math.floor(i / r.cols) * r.ch,
                        width: r.cw,
                        height: r.ch,
                        background: FAMILY_TINTS[tint],
                        opacity: 0.5,
                      }}
                    />
                  ))
                : null}
              {r.p.cells.map((cell, i) => {
                const j = i % r.cols;
                const k = Math.floor(i / r.cols);
                return (
                  <Dot
                    key={cell.t.id}
                    cell={cell}
                    x={(j + 0.5) * r.cw - model.d / 2}
                    y={r.top + (k + 0.5) * r.ch - model.d / 2}
                    d={model.d}
                    nowMs={nowMs}
                  />
                );
              })}
            </div>
          );
        })}
        {model.regions
          .filter((r) => r.showLabel)
          .map((r) => (
            <div
              key={`lbl-${r.p.pid}`}
              className="pointer-events-none absolute truncate"
              style={{
                left: r.x + 5,
                top: r.y + 2,
                maxWidth: r.w - 10,
                fontSize: 10,
                color: "#98a8b6",
                opacity: focusPid !== null && focusPid !== r.p.pid ? 0.3 : 1,
                zIndex: 3,
              }}
            >
              {r.p.name} · {r.p.n}
            </div>
          ))}
      </div>
      <button
        type="button"
        title="Fit view (leave the focused project)"
        onClick={(e) => {
          e.stopPropagation();
          restore();
        }}
        className="absolute right-2 bottom-2 rounded-md border border-border/60 bg-card px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        style={{ zIndex: 4 }}
      >
        ⤢
      </button>
    </div>
  );
}

// ---------- view 3: strip tiles ----------
export function StripTilesView({ data, nowMs, w }: { data: SidebarData; nowMs: number; w: number }) {
  const model = useMemo(() => {
    const { projects } = buildProjects(data.threads, data.projects, nowMs);
    const byN = [...projects].sort((a, b) => b.n - a.n);
    const tiles = byN.map((p) => {
      const w = Math.max(120, p.n * 5 + 20);
      return { p, units: p.cells, w, h: 34 };
    });
    const packed = shelfPack(tiles, w, 12, 10);
    return { packed };
  }, [data, nowMs, w]);
  return (
    <Stage w={w} h={model.packed.H}>
      {model.packed.placed.map(({ card, x, y }) => (
        <div
          key={card.p.pid}
          title={`${card.p.name} · ${card.p.n} threads · ${card.p.hot} hot`}
          className="absolute"
          style={{ left: x, top: y, width: card.w }}
        >
          <div className="truncate" style={{ fontSize: 11, color: "#9fb4c8", marginBottom: 4 }}>
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

// ---------- view 4: agent graph (edge-less lane tree) ----------
export function AgentLanesView({ data, nowMs, w }: { data: SidebarData; nowMs: number; w: number }) {
  const model = useMemo(() => {
    const { lanes, total } = laneRows(data.threads, data.projects, nowMs);
    const cards = makeLaneCards(lanes, LBL);
    const packed = shelfPack(cards, w, 14, 14);
    return { packed, total };
  }, [data, nowMs, w]);
  if (model.total === 0) {
    return <p className="text-sm text-muted-foreground">No visible threads.</p>;
  }
  return (
    <Stage w={w} h={model.packed.H}>
      {model.packed.placed.map(({ card, x, y }) => (
        <div
          key={card.pid}
          title={`${card.name} · ${card.n} threads · ${card.hot} hot`}
          className="absolute rounded-md"
          style={{ left: x, top: y, width: card.w, height: card.h, background: "#131a22" }}
        >
          <div className="absolute truncate" style={{ left: 8, top: 4, right: 8, fontSize: 11, color: "#9fb4c8" }}>
            {card.name} · {card.n}
          </div>
          {card.rows.map((row, i) => (
            <div
              key={row.t.id}
              className="absolute flex items-center"
              style={{ left: 8 + row.depth * LANE_INDENT, top: LBL + 6 + i * LANE_ROW_PITCH, width: LANE_LABEL_W, height: LANE_DOT }}
            >
              <Dot cell={{ t: row.t, fam: row.fam }} x={0} y={0} d={LANE_DOT} nowMs={nowMs} />
              <span className="ml-2 truncate" style={{ fontSize: 9, color: "#7d93a8" }}>
                {row.t.title || row.t.id}
              </span>
            </div>
          ))}
        </div>
      ))}
    </Stage>
  );
}

// ---------- view 5: activity flow (project → thread → turn → work) ----------
/** The shape from the plugin's `shape` RPC, refetched on live changes. */
function useShape(): { shape: ShapeDto | null; error: string | null; retry: () => void } {
  const rpc = useRpc<typeof rpcContract>();
  const [shape, setShape] = useState<Shape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shapeRef = useRef<Shape | null>(null);
  const refetchRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let again = false;
    shapeRef.current = null;
    setShape(null);
    setError(null);
    const refetch = () => {
      // One request at a time; a change during a fetch schedules one more.
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      rpc
        .call("shape", {})
        .then(
          (result) => {
            if (cancelled) return;
            shapeRef.current = result;
            setShape(result);
            setError(null);
          },
          (cause: unknown) => {
            if (cancelled) return;
            setError(cause instanceof Error ? cause.message : String(cause));
          },
        )
        .finally(() => {
          inFlight = false;
          if (again && !cancelled) {
            again = false;
            refetch();
          }
        });
    };
    refetchRef.current = refetch;
    refetch();
    // A slow heartbeat keeps ages honest, but only while someone can see it.
    const timer = setInterval(() => {
      if (!document.hidden) refetch();
    }, 15_000);
    const onVisible = () => {
      if (!document.hidden) refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [rpc]);

  useRealtime(SHAPE_CHANGED, (payload: unknown) => {
    if (document.hidden) return;
    const current = shapeRef.current;
    const changed = (payload as Partial<ShapeChangedPayload> | null)?.threadIds;
    // Skip pushes that only touch threads the shape cut off.
    if (current !== null && changed && changed.length > 0) {
      const known = new Set(current.nodes.map((node) => node.threadId));
      if (!changed.some((id) => known.has(id))) return;
    }
    refetchRef.current();
  });

  return { shape, error, retry: () => refetchRef.current() };
}

/**
 * Fold state: the pure default policy, overlaid with explicit user toggles.
 * `overrides` wins over the default for any id it carries.
 */
function useFold(shape: ShapeDto | null) {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const open = useMemo(() => {
    const base = shape === null ? new Set<string>() : flowDefaultOpen(shape);
    for (const [id, value] of overrides) {
      if (value) base.add(id);
      else base.delete(id);
    }
    return base;
  }, [shape, overrides]);
  const toggle = (id: string) => {
    setOverrides((prev) => new Map(prev).set(id, !open.has(id)));
  };
  const expandAll = (ids: Iterable<string>) => {
    setOverrides(() => new Map(Array.from(ids, (id) => [id, true] as const)));
  };
  const collapseAll = (ids: Iterable<string>) => {
    setOverrides(() => new Map(Array.from(ids, (id) => [id, false] as const)));
  };
  return { open, toggle, expandAll, collapseAll };
}

function ActivityFlowView() {
  const { shape, error, retry } = useShape();
  const navigate = useBbNavigate();
  const fold = useFold(shape);
  // Scope narrows the tree: click a project or thread card to focus its
  // subtree; turn/step chevrons only unlock inside a scope.
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<FlowStatus>>(
    // Idle excluded by default (the "Active only" preset); chips adjust it.
    new Set(["running", "waiting", "error", "queued"] as FlowStatus[]),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowMs = Date.now();
  const layout = useMemo(
    () => (shape === null ? null : flowLayout(shape, fold.open, { scope: scopeId, statusFilter })),
    [shape, fold.open, scopeId, statusFilter],
  );

  // Center the root card in the scroller whenever the layout changes, so the
  // tall tree opens on the whole rather than on its top edge.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null || layout === null) return;
    const root = layout.placed.find((p) => p.node.kind === "root");
    if (root !== undefined) {
      scroller.scrollTop = Math.max(0, root.y + NODE_H / 2 - scroller.clientHeight / 2);
    }
  }, [layout]);

  if (error !== null && shape === null) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">Could not load activity shape: {error}</p>
        <button type="button" onClick={retry} className="mt-2 text-xs text-muted-foreground underline">
          Retry
        </button>
      </div>
    );
  }
  if (layout === null || shape === null) {
    return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  }

  const byId = new Map(layout.placed.map((p) => [p.node.id, p]));
  const selectedPlaced = selected !== null ? byId.get(selected) : undefined;
  const selectedNode = selectedPlaced?.node ?? null;
  // Expand/collapse-all fold projects, threads and turns; work-fold keys
  // ("turn::all") ride along so Expand all also reveals trimmed step rows.
  const foldableIds: string[] = [];
  const turnCount = new Map<string, number>();
  for (const node of shape.nodes) {
    if (node.kind === "project" || node.kind === "thread" || node.kind === "turn") {
      foldableIds.push(node.id, `${node.id}::all`);
    }
    if (node.kind === "turn" && node.parentId !== null) {
      turnCount.set(node.parentId, (turnCount.get(node.parentId) ?? 0) + 1);
    }
  }
  const running = layout.placed.find((p) => p.node.status === "running" && p.node.kind === "thread");
  // Scope path for the breadcrumb (focused node + its ancestors).
  const shapeById = new Map(shape.nodes.map((n) => [n.id, n]));
  const scopePath = new Set<string>();
  if (scopeId !== null) {
    let cur = shapeById.get(scopeId);
    while (cur !== undefined && cur.kind !== "root") {
      scopePath.add(cur.id);
      cur = cur.parentId === null ? undefined : shapeById.get(cur.parentId);
    }
  }
  const scopeProject =
    scopeId === null
      ? null
      : (() => {
          const n = shapeById.get(scopeId);
          if (n === undefined) return null;
          return n.kind === "thread" ? shapeById.get(n.parentId ?? "") ?? null : n;
        })();
  // Legend counts cover threads inside the current scope; chips filter on top.
  const legendCounts = new Map<FlowStatus, number>();
  for (const node of shape.nodes) {
    if (node.kind !== "thread") continue;
    if (scopeId !== null && !scopePath.has(node.id) && node.parentId !== scopeId) continue;
    legendCounts.set(node.status, (legendCounts.get(node.status) ?? 0) + 1);
  }
  // Chips are solo: click a status to see only it, click again to reset to
  // all. Active only stays the quick idle-excluding preset.
  const chipToggle = (status: FlowStatus) => {
    setStatusFilter((prev) =>
      prev.size === 1 && prev.has(status) ? new Set() : new Set([status]),
    );
  };
  const activeOnlyPressed = statusFilter.size === 4 && !statusFilter.has("idle");
  const selectNode = (p: PlacedNode) => {
    const id = p.node.id;
    setSelected((prev) => (prev === id ? null : id));
    if (p.node.kind === "project" || p.node.kind === "thread") {
      setScopeId((prev) => {
        if (prev === id) {
          // Clicking the focused card again climbs one level out.
          return p.node.kind === "thread" ? p.node.parentId : null;
        }
        return id;
      });
    }
  };

  return (
    <div className="rounded-md border border-border/60" style={{ background: "#0f151d" }}>
      <div className="flex flex-wrap items-center gap-2 p-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            className={scopeId === null ? "text-foreground underline" : "underline hover:text-foreground"}
            onClick={() => setScopeId(null)}
          >
            All
          </button>
          {scopeProject !== null ? (
            <>
              <span>/</span>
              <button
                type="button"
                onClick={() => setScopeId(scopeProject.id)}
                className={scopeId === scopeProject.id ? "text-foreground underline" : "underline hover:text-foreground"}
              >
                {scopeProject.label}
              </button>
            </>
          ) : null}
          {scopeId !== null && shapeById.get(scopeId)?.kind === "thread" ? (
            <>
              <span>/</span>
              <span className="truncate text-foreground" style={{ maxWidth: 180 }}>
                {shapeById.get(scopeId)!.label}
              </span>
            </>
          ) : null}
        </span>
        <ToolbarButton
          pressed={activeOnlyPressed}
          onClick={() => setStatusFilter(activeOnlyPressed ? new Set() : new Set(["running", "waiting", "error", "queued"] as FlowStatus[]))}
        >
          Active only
        </ToolbarButton>
        <ToolbarButton onClick={() => fold.expandAll(foldableIds)}>Expand</ToolbarButton>
        <ToolbarButton onClick={() => fold.collapseAll(foldableIds)}>Collapse</ToolbarButton>
        <ToolbarButton
          onClick={() => {
            if (running === undefined || scrollRef.current === null) return;
            selected === running.node.id ? setSelected(null) : setSelected(running.node.id);
            scrollRef.current.scrollTo({ left: Math.max(0, running.x - 120), behavior: "smooth" });
          }}
        >
          To running
        </ToolbarButton>
        <span className="ml-auto">
          {shape.nodes.filter((n) => n.kind === "thread").length} threads
          {shape.truncated ? " · truncated (coldest dropped)" : ""}
        </span>
      </div>
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: "calc(100vh - 290px)" }}>
        <div className="relative" style={{ width: layout.W, height: layout.H }}>
          <svg className="pointer-events-none absolute inset-0" width={layout.W} height={layout.H}>
            {layout.placed
              .filter((p) => p.parentId !== null && byId.has(p.parentId))
              .map((p) => {
                const parent = byId.get(p.parentId!)!;
                const x1 = parent.x + NODE_W, y1 = parent.y + NODE_H / 2, x2 = p.x, y2 = p.y + NODE_H / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path
                    key={p.node.id}
                    d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={p.node.status === "running" ? "#3d84e0" : "#31415a"}
                    strokeOpacity={0.55}
                    strokeDasharray="4 5"
                  />
                );
              })}
          </svg>
          {layout.placed.map((p) => (
            <FlowCard
              key={p.node.id}
              p={p}
              selected={selected === p.node.id}
              nowMs={nowMs}
              locked={p.node.kind === "thread" && scopeId === null}
              turnCount={turnCount.get(p.node.id) ?? 0}
              onSelect={() => selectNode(p)}
              onToggle={() =>
                p.node.kind === "more"
                  ? fold.toggle(`${p.node.parentId}::all`)
                  : fold.toggle(p.node.id)
              }
              onOpenThread={() => p.node.threadId !== null && navigate.toThread(p.node.threadId)}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/40 p-2 text-[11px] text-muted-foreground">
        {[...legendCounts].filter(([, n]) => n > 0).map(([status, n]) => (
          <button
            key={status}
            type="button"
            onClick={() => chipToggle(status)}
            title={statusFilter.has(status) ? `Showing only: ${[...statusFilter].join(", ")}` : `Show only ${status} threads`}
            className={
              "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 " +
              (statusFilter.has(status)
                ? "border border-border bg-background text-foreground"
                : "border border-transparent hover:bg-background/60")
            }
          >
            <FlowDotSafe status={status} />
            {status}&thinsp;{n}
          </button>
        ))}
        {statusFilter.size > 0 ? (
          <button type="button" className="underline" onClick={() => setStatusFilter(new Set())}>
            clear filter
          </button>
        ) : null}
        {selectedNode !== null ? (
          <FlowDetails node={selectedNode} nowMs={nowMs} onOpenThread={() => selectedNode.threadId !== null && navigate.toThread(selectedNode.threadId)} />
        ) : (
          <span>Click a project or thread to focus it · turns and steps unlock inside a scope · scroll to pan</span>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  pressed,
}: {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded border px-2 py-0.5 text-[11px] " +
        (pressed
          ? "border-border bg-background text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function FlowDotSafe({ status }: { status: FlowStatus }) {
  return (
    <span
      className={status === "running" ? "attn-pulse rounded-full" : "rounded-full"}
      style={{ display: "inline-block", width: 7, height: 7, background: FLOW_COLORS[status], flex: "none" }}
    />
  );
}

/** One node card in the tree; chevron folds turn/project/thread subtrees. */
function FlowCard({
  p,
  selected,
  nowMs,
  locked,
  turnCount,
  onSelect,
  onToggle,
  onOpenThread,
}: {
  p: PlacedNode;
  selected: boolean;
  nowMs: number;
  /** Thread at top scope: turns are gated off, so no chevron. */
  locked: boolean;
  turnCount: number;
  onSelect: () => void;
  onToggle: () => void;
  onOpenThread: () => void;
}) {
  const n = p.node;
  const collapsible =
    (n.kind === "project" || n.kind === "turn") || (n.kind === "thread" && !locked);
  const isWorkMore = n.kind === "more" && n.id.endsWith("::earlier");
  const sub =
    n.kind === "thread"
      ? `${turnCount} turn${turnCount === 1 ? "" : "s"}${turnCount === 0 ? "" : ` · ${flowAge(n, nowMs)}`}`
      : (n.sublabel ?? (isWorkMore ? "click to unfold" : n.kind === "more" ? "hidden on server" : ""));
  const openable = n.threadId !== null;
  return (
    <div
      onClick={onSelect}
      onDoubleClick={() => openable && onOpenThread()}
      title={`${n.label} · ${n.status}${n.sublabel ? ` · ${n.sublabel}` : ""}`}
      className={openable ? "absolute cursor-pointer rounded-md" : "absolute rounded-md"}
      style={{
        left: p.x,
        top: p.y,
        width: NODE_W,
        height: NODE_H,
        background: selected ? "#1a2433" : "#131a22",
        border: `1px solid ${selected ? "#2f4b74" : "#1c2430"}`,
        padding: "7px 8px",
        opacity: isWorkMore || n.kind === "more" ? 0.8 : 1,
      }}
    >
      <div className="flex h-full items-start gap-2 overflow-hidden">
        <span className="mt-1 flex-none">
          <FlowDotSafe status={n.status} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px]" style={{ color: n.kind === "thread" ? "#a5b8c9" : "#8fa3b5" }}>
            {n.label}
          </div>
          <div className="truncate text-[10px]" style={{ color: "#5f6b76" }}>
            {sub}
          </div>
        </div>
        {collapsible ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            aria-label={p.expanded ? "Collapse" : "Expand"}
            className="mt-0.5 flex-none text-[9px] text-muted-foreground hover:text-foreground"
          >
            {p.expanded ? "▾" : "▸"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Selected-node details, shown inline in the footer. */
function FlowDetails({
  node,
  nowMs,
  onOpenThread,
}: {
  node: FlowNode;
  nowMs: number;
  onOpenThread: () => void;
}) {
  return (
    <span className="w-full min-w-0 text-[10px]" style={{ color: "#8fa3b5" }}>
      <span style={{ color: "#c3d0dc" }}>{node.label}</span>
      {" · "}
      {node.status}
      {node.kind === "thread" ? ` · ${flowAge(node, nowMs)}` : ""}
      {node.input !== null ? ` · in: ${node.input.slice(0, 140)}` : ""}
      {node.output !== null ? ` · out: ${node.output.slice(0, 140)}` : ""}
      {node.threadId !== null ? (
        <>
          {" · "}
          <button type="button" className="underline" onClick={onOpenThread}>
            open thread
          </button>
        </>
      ) : null}
    </span>
  );
}

// ---------- the tabbed page ----------
const TABS = [
  { id: "board", label: "Board" },
  { id: "treemap", label: "Unit treemap" },
  { id: "tiles", label: "Strip tiles" },
  { id: "graph", label: "Agent lanes" },
  { id: "flow", label: "Activity flow" },
] as const;

export function OverviewPage() {
  const live = useLiveModel();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("board");
  // `w` is the pack width handed to every view: measured available stage width
  // (the mount wrapper's client width minus the stage's own padding/border).
  const [stageRef, measured] = useStageWidth(MIN_STAGE_W + STAGE_CHROME);
  const w = Math.max(MIN_STAGE_W, measured - STAGE_CHROME);
  if (live.state === "loading") {
    return <p className="p-4 text-sm text-muted-foreground">Loading threads…</p>;
  }
  if (live.state === "error" || live.data === null) {
    return <p className="p-4 text-sm text-muted-foreground">Could not read thread data.</p>;
  }
  const nowMs = Date.now();
  const built = buildProjects(live.data.threads, live.data.projects, nowMs);
  const counts = statusCounts(built.projects, nowMs);
  const total = built.total;
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
        <div ref={stageRef} className="mt-3">
          {tab === "board" ? <BoardView data={live.data} nowMs={nowMs} w={w} /> : null}
          {tab === "treemap" ? <UnitTreemapView data={live.data} nowMs={nowMs} w={w} /> : null}
          {tab === "tiles" ? <StripTilesView data={live.data} nowMs={nowMs} w={w} /> : null}
          {tab === "graph" ? <AgentLanesView data={live.data} nowMs={nowMs} w={w} /> : null}
          {tab === "flow" ? <ActivityFlowView /> : null}
        </div>
      </div>
    </div>
  );
}