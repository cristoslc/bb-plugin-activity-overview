// Token flow view: the swimlane flow-control stack, ported from the approved
// mockup (docs/user-experience/token-flow-swimlane-mockup.html). Projects pile
// vertically, one wide landscape row each; expanding a row tiles its tiers
// across the width as four status lanes (Working, Needs You, Unread, Idle);
// every card in the Working lane draws its river from the one project-level
// mouth. A parent thread's children are contained inside its card, recursing
// to a grandchild (hard cap). The layout math is pure (swimlaneLayout in
// views/model.ts); this component only paints it, owns the open sets, scrolls
// the lanes independently, and animates the rivers' live beads.
//
// Rendering lessons carried from the mockup round: every SVG path gets an
// explicit fill (a path with no fill defaults to black — the dark wedges);
// clipPath ids are unique per lane; all card rects paint parent-first so a
// contained child sits atop its parent; all rivers paint in front of every
// card, deepest first.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import { rpcContract, type Flow } from "../server";
import { FLOW_CHANGED } from "../shared";
import {
  GREYS,
  SWIMLANE,
  SWIMLANES,
  cardPaintOrder,
  riverBeadPath,
  riverEdgePath,
  riverPaintOrder,
  riverPath,
  swimlaneLayout,
  type FlowThread,
  type SwimlaneCard,
  type SwimlaneLane,
  type SwimlaneLayout,
  type SwimlaneRow,
} from "./model";

const fmtK = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1000 ? `${Math.round(n / 100) / 10}k`
  : String(Math.round(n));
/** A card's live rate, in tok/min. */
const fmtTokMin = (n: number): string => fmtK(n);
const clip = (s: string, cap: number): string => (s.length > cap ? `${s.slice(0, cap - 1)}…` : s);

const MIN_W = 1240; // below this the four lanes would be too narrow to read

/** A lane's clipPath id: unique per row/lane, and URL-safe. */
const laneClipId = (rowId: string, laneId: string): string =>
  `swim-${rowId}-${laneId}`.replace(/[^a-zA-Z0-9_-]/g, "-");

/** An idle dot's grey, by age (fresh muted ink → near-background). */
function idleGrey(t: FlowThread, nowMs: number): string {
  const at = t.updatedAt ?? t.createdAt;
  const days = at === null ? Number.POSITIVE_INFINITY : (nowMs - at) / 86_400_000;
  return (GREYS.find((g) => days <= g[0]) ?? GREYS[GREYS.length - 1])![1];
}

/** The dot color for a card: its lane hue, or the age ramp when idle. */
function dotColor(card: SwimlaneCard, lane: SwimlaneLane, nowMs: number): string {
  return lane.id === "idle" ? idleGrey(card.thread, nowMs) : lane.color;
}

/** Mirrors the shape hook: one in-flight call, refetch on live changes. */
function useFlow(): { flow: Flow | null; error: string | null; retry: () => void } {
  const rpc = useRpc<typeof rpcContract>();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetchRef = useRef<() => void>(() => {});
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let again = false;
    const refetch = () => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      rpc
        .call("flow", {})
        .then(
          (result) => {
            if (cancelled) return;
            setFlow(result);
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
    // A slow heartbeat keeps sampled buckets fresh while the view is visible.
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

  useRealtime(FLOW_CHANGED, () => {
    if (!document.hidden) refetchRef.current();
  });
  return { flow, error, retry: () => refetchRef.current() };
}

const scrollKey = (rowId: string, laneId: string): string => `${rowId}::${laneId}`;

export function TokenFlowView() {
  const { flow, error, retry } = useFlow();
  const [openProjects, setOpenProjects] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [laneScroll, setLaneScroll] = useState<Record<string, number>>({});
  const [paused, setPaused] = useState(false);
  const [speedMul, setSpeedMul] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState<number>(SWIMLANE.W);

  const threads = useMemo((): FlowThread[] => (flow === null ? [] : flow.threads), [flow]);

  const layout: SwimlaneLayout = useMemo(
    () => swimlaneLayout(threads, { width, openProjects, openThreads }),
    [threads, width, openProjects, openThreads],
  );

  // Seed the view: open the hottest project once, so the lanes are on screen.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || flow === null) return;
    seededRef.current = true;
    if (layout.rows.length > 0) setOpenProjects(new Set([layout.rows[0]!.id]));
  }, [flow, layout]);

  // --- stage measurement: the world is exactly the stage width (floor MIN_W) ---
  // The stage only mounts once the flow has loaded (the early returns above),
  // so the element arrives via a callback ref rather than a mount-time effect.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (stageEl === null) return;
    const measure = () => setWidth(Math.max(MIN_W, Math.round(stageEl.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stageEl);
    return () => ro.disconnect();
  }, [stageEl]);

  const toggleProject = useCallback((id: string) => {
    setOpenProjects((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleThread = useCallback((id: string) => {
    setOpenThreads((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback(
    (open: boolean) => setOpenProjects(open ? new Set(layout.rows.map((r) => r.id)) : new Set<string>()),
    [layout],
  );

  // --- independent lane scrolling: one non-passive wheel listener, hit-tested ---
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const scrollRef = useRef(laneScroll);
  scrollRef.current = laneScroll;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const stageSvgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = stageSvgRef.current;
    if (svg === null) return;
    const onWheel = (event: WheelEvent) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const k = zoomRef.current;
      const wx = (event.clientX - rect.left) / k;
      const wy = (event.clientY - rect.top) / k;
      const L = layoutRef.current;
      for (const row of L.rows) {
        if (!row.expanded) continue;
        for (const lane of row.lanes) {
          if (
            wx < lane.x ||
            wx > lane.x + lane.w ||
            wy < lane.bodyTop ||
            wy > lane.bodyTop + lane.visibleH
          ) {
            continue;
          }
          const max = Math.max(0, lane.contentH - lane.visibleH);
          if (max <= 0) continue; // nothing to scroll: let the stage scroll
          event.preventDefault();
          event.stopPropagation();
          const key = scrollKey(row.id, lane.id);
          const next = Math.min(max, Math.max(0, (scrollRef.current[key] ?? 0) + event.deltaY));
          setLaneScroll((cur) => (cur[key] === next ? cur : { ...cur, [key]: next }));
          return;
        }
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [layout]);

  // --- beads: one rAF loop; each river's dash offset drifts with its rate ---
  const beadRefs = useRef(new Map<string, SVGPathElement>());
  const offsets = useRef(new Map<string, number>());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const speedRef = useRef(speedMul);
  speedRef.current = speedMul;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        for (const row of layoutRef.current.rows) {
          for (const lane of row.lanes) {
            for (const r of lane.rivers) {
              if (r.rate <= 0) continue;
              const speed = Math.max(5, 20 + 85 * Math.min(1, r.rate / 1400));
              const off = (offsets.current.get(r.id) ?? 0) - speed * speedRef.current * dt;
              offsets.current.set(r.id, off);
              const el = beadRefs.current.get(r.id);
              if (el !== undefined) el.style.strokeDashoffset = String(off);
            }
          }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const nowMs = Date.now();
  const totalMin = Math.round(layout.totalRate * 60);
  const anyExpanded = layout.rows.some((r) => r.expanded);

  if (error !== null && flow === null) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Could not load token flow: {error}</p>
        <button type="button" onClick={retry} className="mt-2 text-xs text-muted-foreground underline">
          Retry
        </button>
      </div>
    );
  }
  if (flow === null) {
    return <p className="p-4 text-sm text-muted-foreground">Building token flow…</p>;
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* toolbar — a fixed strip (never under the floating tab bar: its
          controls are right-aligned, the tab bar floats over its empty left) */}
      <div
        className="flex h-[54px] shrink-0 items-center justify-end gap-3 border-b border-border/40 px-3"
        style={{ color: "var(--attn-label)" }}
      >
        <span className="flex items-center gap-1.5 text-xs">
          <span className="inline-block size-2 rounded-full" style={{ background: "var(--attn-working)" }} />
          <span className="text-sm font-bold" style={{ color: "var(--attn-emph)" }}>
            {fmtTokMin(totalMin)}
          </span>
          <span>tok/min all projects</span>
        </span>
        <button
          type="button"
          onClick={() => toggleAll(!anyExpanded)}
          className="rounded border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {anyExpanded ? "Collapse all" : "Expand all"}
        </button>
        <span className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.15) * 100) / 100))}
            className="rounded border border-border/60 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.15) * 100) / 100))}
            className="rounded border border-border/60 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="rounded border border-border/60 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
        </span>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="rounded border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {paused ? "Resume flow" : "Pause flow"}
        </button>
        <label className="flex items-center gap-1 text-[11px]">
          flow ×{speedMul.toFixed(1)}
          <input
            type="range"
            min={0.4}
            max={3}
            step={0.1}
            value={speedMul}
            onChange={(e) => setSpeedMul(Number(e.target.value))}
            className="w-20"
          />
        </label>
      </div>

      {/* stage — a plain vertical/diagonal scroll; the SVG is 1:1 in world px */}
      <div ref={setStageEl} data-attn-stage="" className="relative min-h-0 flex-1 overflow-auto">
        <svg
          ref={stageSvgRef}
          viewBox={`0 0 ${layout.W} ${layout.H}`}
          width={layout.W * zoom}
          height={layout.H * zoom}
          className="block select-none"
          role="img"
          aria-label="token flow swimlanes"
        >
          {/* background: provider→row links (in the spine gutter) */}
          {layout.links.map((k) => (
            <g key={k.id} pointerEvents="none">
              <path d={riverPath({ mouthX: k.x1, mouthY: k.y1, cardX: k.x2, cardY: k.y2, w: k.w })} fill={k.color} opacity={k.opacity} />
              <path d={riverEdgePath({ mouthX: k.x1, mouthY: k.y1, cardX: k.x2, cardY: k.y2, w: k.w })} stroke="#fff" strokeWidth={0.8} opacity={0.18} fill="none" />
            </g>
          ))}

          {/* Tier 1 — the provider spine */}
          {layout.spine.map((b) => (
            <g key={`spine:${b.id}`} pointerEvents="none">
              <rect x={SWIMLANE.SPINE_X} y={b.y} width={SWIMLANE.SPINE_W} height={b.h} rx={7} fill={b.color} opacity={0.93} />
              <text x={SWIMLANE.SPINE_X + SWIMLANE.SPINE_W / 2} y={b.y + 22} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--attn-card)">
                {b.label}
              </text>
              <text x={SWIMLANE.SPINE_X + SWIMLANE.SPINE_W / 2} y={b.y + 40} textAnchor="middle" fontSize={10} fill="var(--attn-card)" opacity={0.85}>
                {fmtK(b.total)} tok
              </text>
              {b.rate > 0 ? (
                <text x={SWIMLANE.SPINE_X + SWIMLANE.SPINE_W / 2} y={b.y + 55} textAnchor="middle" fontSize={9.5} fill="var(--attn-card)" opacity={0.8}>
                  {fmtTokMin(b.rate * 60)} tok/min
                </text>
              ) : null}
            </g>
          ))}
          {layout.spine.length > 0 ? (
            <text x={SWIMLANE.SPINE_X + SWIMLANE.SPINE_W / 2} y={SWIMLANE.SPINE_TOP - 12} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--attn-faint)" pointerEvents="none">
              TIER 1 · providers
            </text>
          ) : null}

          {/* Tier 2 + 3 — the project stack */}
          {layout.rows.map((row) => (
            <RowLayer
              key={row.id}
              row={row}
              nowMs={nowMs}
              maxFlow={layout.maxFlow}
              scroll={laneScroll}
              onToggleProject={toggleProject}
              onToggleThread={toggleThread}
              beadRefs={beadRefs}
            />
          ))}
        </svg>
      </div>

      {/* legend — a fixed strip (no floating card over the stage) */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/40 px-3 py-1.5 text-[10.5px]"
        style={{ color: "var(--attn-faint)" }}
      >
        {layout.spine.map((b) => (
          <span key={`lg:${b.id}`} className="flex items-center gap-1.5" style={{ color: "var(--attn-sub)" }}>
            <span className="inline-block size-2.5 rounded-sm" style={{ background: b.color, opacity: 0.85 }} />
            {b.label}
          </span>
        ))}
        <span className="mx-1 opacity-40">|</span>
        {SWIMLANES.map((lane) => (
          <span key={`lgl:${lane.id}`} className="flex items-center gap-1.5" style={{ color: "var(--attn-sub)" }}>
            <span className="inline-block size-2 rounded-full" style={{ background: lane.color }} />
            {lane.label}
          </span>
        ))}
        <span className="ml-auto opacity-80">
          river = the card's shown flow (Σ subtree while collapsed, own once expanded) · bar = subtree total · beads = live activity
        </span>
      </div>
    </div>
  );
}

type RowProps = {
  row: SwimlaneRow;
  nowMs: number;
  maxFlow: number;
  scroll: Record<string, number>;
  onToggleProject: (id: string) => void;
  onToggleThread: (id: string) => void;
  beadRefs: React.MutableRefObject<Map<string, SVGPathElement>>;
};

function RowLayer({ row, nowMs, maxFlow, scroll, onToggleProject, onToggleThread, beadRefs }: RowProps) {
  const quiet = row.rate <= 0;
  const first = row.prov[0];
  return (
    <g opacity={quiet ? 0.82 : 1} data-attn-row={row.id} data-expanded={row.expanded}>
      {/* the row's own landscape rectangle */}
      <rect
        x={SWIMLANE.ROW_X}
        y={row.y}
        width={row.w}
        height={row.h}
        rx={row.expanded ? 11 : 11}
        fill="var(--attn-card)"
        stroke={row.expanded ? "var(--attn-selected-border)" : "var(--attn-card-border)"}
        strokeWidth={row.expanded ? 2 : 1}
        strokeOpacity={0.9}
        data-attn-row-rect={row.id}
        style={{ cursor: "pointer" }}
        onClick={() => onToggleProject(row.id)}
      />
      {first !== undefined ? (
        <rect x={SWIMLANE.ROW_X} y={row.y} width={4} height={row.h} rx={2} fill={first.color} opacity={0.85} pointerEvents="none" />
      ) : null}

      {row.expanded ? <ExpandedHeader row={row} onToggle={() => onToggleProject(row.id)} /> : <CollapsedBody row={row} />}

      {row.expanded
        ? row.lanes.map((lane) => (
            <LaneLayer
              key={lane.id}
              rowId={row.id}
              lane={lane}
              maxFlow={maxFlow}
              nowMs={nowMs}
              scroll={scroll[scrollKey(row.id, lane.id)] ?? 0}
              onToggleThread={onToggleThread}
              beadRefs={beadRefs}
            />
          ))
        : null}
    </g>
  );
}

function CollapsedBody({ row }: { row: SwimlaneRow }) {
  const cx = SWIMLANE.ROW_X + 18;
  const mixW = Math.max(40, row.w - 300);
  const ptotal = row.prov.reduce((s, p) => s + p.total, 0) || 1;
  let px = cx;
  const smax = Math.max(1, ...row.spark);
  const sW = mixW;
  const sx0 = cx;
  const base = row.y + 82;
  const amp = 16;
  const sparkD = row.spark
    .map((v, i) => {
      const x = sx0 + sW * (i / Math.max(1, row.spark.length - 1));
      const y = base - amp * (v / smax);
      return `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <g pointerEvents="none">
      <text x={cx} y={row.y + 24} fontSize={13} fontWeight={700} fill="var(--attn-emph)">
        {clip(row.name, 34)}
      </text>
      <text x={SWIMLANE.ROW_X + row.w - 16} y={row.y + 24} textAnchor="end" fontSize={12} fill="var(--attn-sub)">
        {fmtK(row.total)} tok
      </text>
      <text x={cx} y={row.y + 42} fontSize={10.5} fill={row.rate > 0 ? "var(--attn-working)" : "var(--attn-faint)"}>
        {row.rate > 0 ? `${fmtTokMin(row.rate * 60)} tok/min` : "quiet"}
      </text>
      <text x={cx + 150} y={row.y + 42} fontSize={10} fill="var(--attn-faint)">
        {row.threads} threads · {row.working} working
      </text>
      {row.prov.map((p) => {
        const seg = mixW * (p.total / ptotal);
        const x = px;
        px += seg;
        return <rect key={`mx:${p.id}`} x={x} y={row.y + 52} width={Math.max(1, seg)} height={5} rx={2.5} fill={p.color} opacity={0.9} />;
      })}
      <path d={sparkD} stroke={row.prov[0]?.color ?? "var(--attn-grey-2)"} strokeWidth={1.5} fill="none" opacity={0.65} />
      <text x={sx0} y={row.y + SWIMLANE.COLLAPSED_H - 4} fontSize={8.5} fill="var(--attn-faint)">
        burn · last hour
      </text>
      <text x={SWIMLANE.ROW_X + row.w - 16} y={row.y + SWIMLANE.COLLAPSED_H - 6} textAnchor="end" fontSize={9.5} fill="var(--attn-faint)">
        open swimlanes ▸
      </text>
    </g>
  );
}

function ExpandedHeader({ row, onToggle }: { row: SwimlaneRow; onToggle: () => void }) {
  const cx = SWIMLANE.ROW_X + 18;
  const mixW = 344;
  const mixX = SWIMLANE.ROW_X + row.w - 360;
  const ptotal = row.prov.reduce((s, p) => s + p.total, 0) || 1;
  let px = mixX;
  return (
    <g>
      <g pointerEvents="none">
        <text x={cx} y={row.y + 26} fontSize={14} fontWeight={700} fill="var(--attn-emph)">
          {clip(row.name, 40)}
        </text>
        <text x={cx} y={row.y + 46} fontSize={10.5} fill="var(--attn-sub)">
          {fmtK(row.total)} tok · {row.rate > 0 ? `${fmtTokMin(row.rate * 60)} tok/min` : "quiet"} · {row.threads} threads
        </text>
        <text x={cx} y={row.y + 62} fontSize={8.5} fill="var(--attn-faint)">
          flow splits by status ↓
        </text>
        {row.prov.map((p) => {
          const seg = mixW * (p.total / ptotal);
          const x = px;
          px += seg;
          return <rect key={`hmx:${p.id}`} x={x} y={row.y + 40} width={Math.max(1, seg)} height={6} rx={3} fill={p.color} opacity={0.92} />;
        })}
      </g>
      <rect
        x={SWIMLANE.ROW_X + row.w - 132}
        y={row.y + 12}
        width={116}
        height={20}
        rx={10}
        fill="var(--attn-stage)"
        stroke="var(--attn-card-border)"
        style={{ cursor: "pointer" }}
        onClick={onToggle}
      />
      <text x={SWIMLANE.ROW_X + row.w - 74} y={row.y + 26} textAnchor="middle" fontSize={9.5} fill="var(--attn-sub)" pointerEvents="none">
        ▾ collapse
      </text>
    </g>
  );
}

type LaneProps = {
  rowId: string;
  lane: SwimlaneLane;
  maxFlow: number;
  nowMs: number;
  scroll: number;
  onToggleThread: (id: string) => void;
  beadRefs: React.MutableRefObject<Map<string, SVGPathElement>>;
};

function LaneLayer({ rowId, lane, maxFlow, nowMs, scroll, onToggleThread, beadRefs }: LaneProps) {
  const clipId = laneClipId(rowId, lane.id);
  const cards = cardPaintOrder(lane.cards);
  const rivers = riverPaintOrder(lane.rivers);
  const max = Math.max(0, lane.contentH - lane.visibleH);
  const clamped = Math.min(max, Math.max(0, scroll));
  return (
    <g data-attn-lane={lane.id} data-attn-lane-row={rowId} data-overflow={lane.overflow}>
      <defs>
        <clipPath id={clipId}>
          <rect x={lane.x + 1} y={lane.bodyTop} width={lane.w - 2} height={lane.visibleH} />
        </clipPath>
      </defs>
      {/* lane body */}
      <rect x={lane.x} y={lane.y} width={lane.w} height={lane.h} rx={8} fill="var(--attn-stage)" stroke="var(--attn-card-border)" strokeOpacity={0.85} data-attn-lane-rect={lane.id} />
      {/* lane header */}
      <circle cx={lane.x + 13} cy={lane.y + 16} r={3.4} fill={lane.id === "idle" ? "var(--attn-grey-2)" : lane.color} pointerEvents="none" />
      <text x={lane.x + 22} y={lane.y + 20} fontSize={10.5} fontWeight={600} fill="var(--attn-label)" pointerEvents="none">
        {lane.label}
      </text>
      <text x={lane.x + lane.w - 10} y={lane.y + 20} textAnchor="end" fontSize={10.5} fill="var(--attn-faint)" pointerEvents="none">
        {lane.count}
      </text>

      <g clipPath={`url(#${clipId})`}>
        {/* cards (scrolled), parent-first so a child sits atop its parent */}
        <g data-attn-lane-cards={lane.id} transform={`translate(0 ${-clamped})`}>
          {cards.map((card) => (
            <CardLayer
              key={card.id}
              card={card}
              lane={lane}
              maxFlow={maxFlow}
              nowMs={nowMs}
              onToggle={() => onToggleThread(card.id)}
            />
          ))}
        </g>
        {/* the one project mouth (pinned to the lane's top-left) */}
        {lane.mouth !== null ? (
          <circle cx={lane.mouth.x} cy={lane.mouth.y} r={3} fill="var(--attn-selected-border)" opacity={0.85} pointerEvents="none" data-attn-mouth={lane.id} />
        ) : null}
        {/* rivers in front of every card, deepest first; endpoints follow the
            cards' scroll position so a scrolled card stays connected */}
        {rivers.map((r) => {
          const geo = { mouthX: r.mouthX, mouthY: r.mouthY, cardX: r.cardX, cardY: r.cardY - clamped, w: r.w };
          return (
            <g key={r.id} pointerEvents="none" data-attn-river={r.cardId} data-depth={r.depth} data-mouth-x={r.mouthX} data-mouth-y={r.mouthY}>
              <path d={riverPath(geo)} fill={r.color} opacity={r.opacity} stroke="none" />
              <path d={riverEdgePath(geo)} stroke="#fff" strokeWidth={0.9} opacity={0.22} fill="none" />
              {r.rate > 0 ? (
                <path
                  ref={(el) => {
                    if (el === null) beadRefs.current.delete(r.id);
                    else beadRefs.current.set(r.id, el);
                  }}
                  d={riverBeadPath({ mouthX: r.mouthX, mouthY: r.mouthY, cardX: r.cardX, cardY: r.cardY - clamped })}
                  stroke="#fff"
                  strokeWidth={Math.max(1, Math.min(2.2, r.w * 0.22))}
                  opacity={0.55}
                  strokeDasharray="0.5 11"
                  strokeLinecap="round"
                  fill="none"
                />
              ) : null}
            </g>
          );
        })}
      </g>

      {/* the lane's own scroll rail */}
      {lane.overflow ? (
        <g pointerEvents="none">
          <rect x={lane.x + lane.w - 4} y={lane.bodyTop} width={3} height={lane.visibleH} rx={1.5} fill="var(--attn-card-border)" />
          <rect
            x={lane.x + lane.w - 4}
            y={lane.bodyTop + (max > 0 ? (clamped / max) * (lane.visibleH - Math.max(20, (lane.visibleH * lane.visibleH) / Math.max(lane.contentH, lane.visibleH))) : 0)}
            width={3}
            height={Math.max(20, (lane.visibleH * lane.visibleH) / Math.max(lane.contentH, lane.visibleH))}
            rx={1.5}
            fill="var(--attn-dim)"
          />
          <text x={lane.x + lane.w - 8} y={lane.y + lane.h - 4} textAnchor="end" fontSize={8.5} fill="var(--attn-faint)">
            scroll ↕
          </text>
        </g>
      ) : null}
    </g>
  );
}

function CardLayer({
  card,
  lane,
  maxFlow,
  nowMs,
  onToggle,
}: {
  card: SwimlaneCard;
  lane: SwimlaneLane;
  maxFlow: number;
  nowMs: number;
  onToggle: () => void;
}) {
  const laneColor = lane.id === "idle" ? "var(--attn-grey-2)" : lane.color;
  const barW = Math.max(2, (card.w - 20) * (maxFlow > 0 ? card.flow / maxFlow : 0));
  const dot = card.error ? "var(--attn-error)" : dotColor(card, lane, nowMs);
  const value =
    card.hasGroup
      ? `${card.open ? "own" : "Σ"} ${fmtTokMin(card.shownRate * 60)} tok/min · ${fmtK(card.flow)} total`
      : card.shownRate > 0
        ? `${fmtTokMin(card.shownRate * 60)} tok/min`
        : `${fmtK(card.flow)} tok`;
  return (
    <g data-attn-card={card.id} data-depth={card.depth} data-has-group={card.hasGroup} data-open={card.open}>
      <rect
        x={card.x}
        y={card.y}
        width={card.w}
        height={card.h}
        rx={7}
        fill="var(--attn-card)"
        stroke="var(--attn-card-border)"
        strokeOpacity={0.9}
        data-attn-card-rect={card.id}
        style={{ cursor: card.canOpen ? "pointer" : "default" }}
        onClick={card.canOpen ? onToggle : undefined}
      >
        <title>{`${card.thread.title} · ${fmtK(card.flow)} tokens · ${card.thread.status}`}</title>
      </rect>
      <rect x={card.x} y={card.y} width={3} height={card.h} rx={1.5} fill={card.color} opacity={0.9} pointerEvents="none" />
      <circle cx={card.x + 14} cy={card.y + 16} r={3} fill={dot} pointerEvents="none" />
      {card.error ? <circle cx={card.x + 14} cy={card.y + 16} r={6} fill="none" stroke="var(--attn-error)" strokeWidth={1.2} opacity={0.8} pointerEvents="none" /> : null}
      <text x={card.x + 22} y={card.y + 19} fontSize={10} fill="var(--attn-emph)" pointerEvents="none">
        {clip(card.thread.title, Math.max(10, 24 - card.depth * 3))}
      </text>
      <rect x={card.x + 10} y={card.y + 31} width={barW} height={6} rx={3} fill={card.color} opacity={0.9} pointerEvents="none" />
      <text x={card.x + 22} y={card.y + 47} fontSize={card.hasGroup ? 8.5 : 9} fill={card.hasGroup ? laneColor : card.shownRate > 0 ? laneColor : "var(--attn-faint)"} pointerEvents="none">
        {value}
      </text>
      {card.canOpen ? (
        <g pointerEvents="none">
          <rect x={card.x + card.w - 72} y={card.y + 8} width={64} height={18} rx={9} fill="var(--attn-stage)" stroke="var(--attn-card-border)" opacity={0.95} />
          <text x={card.x + card.w - 40} y={card.y + 21} textAnchor="middle" fontSize={9} fill="var(--attn-sub)">
            {`${card.open ? "▾" : "▸"} ${card.kidCount}${card.depth > 0 ? " nested" : " sub"}`}
          </text>
        </g>
      ) : null}
    </g>
  );
}
