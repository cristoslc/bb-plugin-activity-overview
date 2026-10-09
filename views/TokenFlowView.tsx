// Token flow view: the provider → project → family sankey, ported from the
// approved mockup (docs/user-experience/sankey-token-flow-mockup.html). The
// layout math is pure (views/model.ts); this component paints it, animates
// the bead flows with one rAF loop, and owns the pause / speed / window
// chrome. All colors are theme tokens (views/theme.ts), both theme blocks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import { rpcContract, type Flow } from "../server";
import { SHAPE_CHANGED } from "../shared";
import {
  PROVIDER_TOKENS,
  TOKEN_FLOW,
  TOKEN_FLOW_STATUS,
  sankeyLayout,
  tokenFlowStatus,
  type FlowThread,
  type SankeyLayout,
} from "./model";

type WindowId = "all" | "15m" | "60m";
const WINDOWS: Array<{ id: WindowId; label: string; ms: number | null }> = [
  { id: "all", label: "All", ms: null },
  { id: "15m", label: "Last 15 min", ms: 15 * 60_000 },
  { id: "60m", label: "Last hour", ms: 60 * 60_000 },
];

type Hover = { kind: "provider" | "project" | "family"; key: string } | null;

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
    // A slow heartbeat keeps tracked totals fresh, view visible only.
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

  useRealtime(SHAPE_CHANGED, () => {
    if (!document.hidden) refetchRef.current();
  });
  return { flow, error, retry: () => refetchRef.current() };
}

/** Bezier ribbon path through the midpoint (straight when already level). */
function ribbonPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

/** Bead color: the provider hue lightened (72% mix against white). */
const beadColor = (providerColor: string) =>
  `color-mix(in srgb, ${providerColor} 72%, #ffffff)`;

const clipTitle = (s: string, cap = 34) =>
  s.length > cap ? `${s.slice(0, cap - 1)}…` : s;

const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(Math.round(n));

export function TokenFlowView() {
  const { flow, error, retry } = useFlow();
  const [paused, setPaused] = useState(false);
  const [speedMul, setSpeedMul] = useState(1);
  const [windowId, setWindowId] = useState<WindowId>("all");
  const [hover, setHover] = useState<Hover>(null);

  // The window filters threads by recent live activity; a kept child keeps
  // its whole family (and vice versa), so families never split.
  const visible = useMemo((): FlowThread[] => {
    if (flow === null) return [];
    const w = WINDOWS.find((entry) => entry.id === windowId);
    if (w?.ms == null) return [...flow.threads];
    const cutoff = Date.now() - w.ms;
    const kept = flow.threads.filter((t) => (t.updatedAt ?? 0) >= cutoff);
    const ids = new Set(kept.map((t) => t.id));
    const byId = new Map(flow.threads.map((t) => [t.id, t] as const));
    for (const t of kept) {
      let parent = t.parentThreadId !== null ? byId.get(t.parentThreadId) : undefined;
      while (parent !== undefined && !ids.has(parent.id)) {
        ids.add(parent.id);
        parent = parent.parentThreadId !== null ? byId.get(parent.parentThreadId) : undefined;
      }
    }
    return flow.threads.filter((t) => ids.has(t.id));
  }, [flow, windowId]);

  const layout = useMemo(
    (): SankeyLayout => sankeyLayout(visible),
    [visible],
  );

  // Keep-sets for the hover highlight: matching ribbons stay, everything
  // else dims; member labels of kept threads stay readable.
  const keepFams = useMemo(() => {
    const fams = new Set<string>();
    if (hover === null) return fams;
    for (const r of layout.ribbons) {
      const match =
        hover.kind === "provider"
          ? r.provider === hover.key
          : hover.kind === "project"
            ? r.projectId === hover.key
            : r.familyKey === hover.key;
      if (match) fams.add(r.familyKey);
    }
    if (hover.kind === "family") fams.add(hover.key);
    return fams;
  }, [hover, layout]);

  // --- camera (viewBox units): zoom about the cursor, drag pan, dblclick reset
  const C = TOKEN_FLOW;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const svgPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (svg === null) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const sf = Math.min(rect.width / C.W, rect.height / C.H);
      const ox = (rect.width - C.W * sf) / 2;
      const oy = (rect.height - C.H * sf) / 2;
      return { x: (clientX - rect.left - ox) / sf, y: (clientY - rect.top - oy) / sf };
    },
    [C.W, C.H],
  );
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const v = viewRef.current;
      const p = svgPoint(event.clientX, event.clientY);
      const k = Math.min(6, Math.max(0.5, event.deltaY < 0 ? v.k * 1.15 : v.k / 1.15));
      setView({ k, x: p.x - (p.x - v.x) * (k / v.k), y: p.y - (p.y - v.y) * (k / v.k) });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgPoint]);
  const dragRef = useRef<{ px: number; py: number } | null>(null);
  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { px: event.clientX, py: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (drag === null || svgRef.current === null) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sf = Math.min(rect.width / C.W, rect.height / C.H);
      setView((v) => ({
        ...v,
        x: v.x + (event.clientX - drag.px) / sf,
        y: v.y + (event.clientY - drag.py) / sf,
      }));
      dragRef.current = { px: event.clientX, py: event.clientY };
    },
    [C.W, C.H],
  );
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // --- beads: one rAF loop; stroke-dash offset per ribbon drifts by the
  // sampled burn rate. Still (rate 0 or factor 0) ribbons do not animate.
  const beadRefs = useRef(new Map<string, SVGPathElement>());
  const offsets = useRef(new Map<string, number>());
  const speedRef = useRef(speedMul);
  speedRef.current = speedMul;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!paused) {
        for (const r of layout.ribbons) {
          const st = TOKEN_FLOW_STATUS[r.status];
          const rate = r.rate ?? 0;
          if (st.factor <= 0 || rate <= 0) continue;
          const speed = Math.max(5, st.factor * (20 + 85 * Math.min(1, rate / 1400)));
          const off = (offsets.current.get(r.id) ?? 0) - speed * speedRef.current * dt;
          offsets.current.set(r.id, off);
          const el = beadRefs.current.get(r.id);
          if (el) el.style.strokeDashoffset = String(off);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [layout, paused]);

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

  const provTotal = (provId: string) =>
    layout.providers.find((p) => p.id === provId)?.slots.reduce(
      (sum, slot) =>
        sum + (visible.find((t) => t.id === slot.threadId)?.usedTokens ?? 0),
      0,
    ) ?? 0;
  const totalRate = visible.reduce((sum, t) => sum + (t.rate ?? 0), 0);
  const totalTracked = visible.reduce((sum, t) => sum + (t.tracked ?? 0), 0);

  const ribbonMatches = (r: { provider: string; projectId: string; familyKey: string }): boolean =>
    hover !== null &&
    (hover.kind === "provider"
      ? r.provider === hover.key
      : hover.kind === "project"
        ? r.projectId === hover.key
        : r.familyKey === hover.key);

  return (
    <div className="absolute inset-0">
      {/* floating chrome (top-right) */}
      <div className="pointer-events-auto absolute right-3 top-3 z-40 flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5 shadow-sm">
        <span className="text-xs" style={{ color: "var(--attn-label)" }} title="Σ sampled context growth per second">
          {Math.round(totalRate)} tok/s
        </span>
        <select
          value={windowId}
          onChange={(e) => setWindowId(e.target.value as WindowId)}
          aria-label="Time window"
          className="rounded border border-border/60 bg-background px-1.5 py-0.5 text-xs"
        >
          {WINDOWS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs" style={{ color: "var(--attn-label)" }}>
          speed
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
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="rounded border border-border/60 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {paused ? "Resume flow" : "Pause flow"}
        </button>
      </div>

      {/* legend (bottom-left) */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-40 max-w-[480px] rounded-md border border-border/60 bg-card px-3 py-2 shadow-sm">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {layout.providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseEnter={() => setHover({ kind: "provider", key: p.id })}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover({ kind: "provider", key: p.id })}
              onBlur={() => setHover(null)}
              className="pointer-events-auto flex items-center gap-1.5 text-xs"
              style={{ color: "var(--attn-sub)" }}
            >
              <span className="inline-block size-2.5 rounded-sm" style={{ background: p.color, opacity: 0.85 }} />
              {p.label} · {fmtTokens(provTotal(p.id))}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px]" style={{ color: "var(--attn-faint)" }}>
          ribbon = context-window usage · beads = sampled growth · {Math.round(totalTracked).toLocaleString()} tokens tracked since plugin start · drag to pan, scroll to zoom, double-click to reset
        </p>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${C.W} ${C.H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={() => setView({ x: 0, y: 0, k: 1 })}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* family zones */}
          {layout.families.map((fam) => {
            const dim = hover !== null && !keepFams.has(fam.key);
            return (
              <g key={fam.key} opacity={dim ? 0.25 : 1}>
                <rect
                  x={C.FX - 10}
                  y={fam.zoneY - 8}
                  width={C.ZONE_W}
                  height={fam.zoneH + 16}
                  rx={10}
                  fill="var(--attn-prov-zone)"
                  stroke="var(--attn-prov-zone-border)"
                  strokeOpacity={0.7}
                  onMouseEnter={() => setHover({ kind: "family", key: fam.key })}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{`Family · ${fam.members
                    .map((m) => m.thread.title)
                    .join(" · ")}`}</title>
                </rect>
                {fam.members.map((member) => {
                  const t = member.thread;
                  const st = TOKEN_FLOW_STATUS[tokenFlowStatus(t.status)];
                  const label = member.isParent
                    ? clipTitle(t.title)
                    : `└ ${clipTitle(t.title, 30)}`;
                  return (
                    <g key={t.id} opacity={dim ? 0.35 : 1}>
                      <circle
                        cx={C.FX + C.FACE_MEM + (member.isParent ? 2 : 16)}
                        cy={member.y + member.h / 2 - 4}
                        r={4}
                        fill={st.color}
                        stroke="none"
                      />
                      <text
                        x={C.FX + C.FACE_MEM + (member.isParent ? 14 : 28)}
                        y={member.y + member.h / 2 + 4}
                        fontSize={member.isParent ? 12 : 11}
                        fontWeight={member.isParent ? 700 : 500}
                        fill={member.isParent ? "var(--attn-emph)" : "var(--attn-sub)"}
                      >
                        <title>{`${t.title} · ${t.usedTokens ?? 0} tokens context · ${t.model ?? "model unknown"} · ${Math.round(t.rate ?? 0)} tok/s`}</title>
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* ribbons + beads */}
          <g>
            {layout.ribbons.map((r) => {
              const st = TOKEN_FLOW_STATUS[r.status];
              const color = PROVIDER_TOKENS[r.provider];
              const keep = hover === null || ribbonMatches(r);
              return (
                <g key={r.id} pointerEvents="none">
                  <path
                    d={ribbonPath(r.x1, r.y1, r.x2, r.y2)}
                    stroke={color}
                    strokeWidth={r.h}
                    fill="none"
                    opacity={keep ? st.base : 0.05}
                  />
                  {(r.rate ?? 0) > 0 && st.factor > 0 ? (
                    <path
                      ref={(el) => {
                        if (el === null) beadRefs.current.delete(r.id);
                        else beadRefs.current.set(r.id, el);
                      }}
                      d={ribbonPath(r.x1, r.y1, r.x2, r.y2)}
                      stroke={beadColor(color)}
                      strokeWidth={Math.max(1.5, Math.min(4, r.h * 0.3))}
                      fill="none"
                      strokeDasharray="0.5 12"
                      strokeLinecap="round"
                      opacity={keep ? 1 : 0}
                    />
                  ) : null}
                </g>
              );
            })}
          </g>

          {/* provider bars + labels */}
          {layout.providers.map((p) => {
            const dim = hover !== null && !(hover.kind === "provider" && hover.key === p.id);
            return (
              <g key={p.id} opacity={dim ? 0.25 : 1}>
                {p.slots.map((slot) => (
                  <rect
                    key={`${p.id}:${slot.threadId}`}
                    x={C.PX}
                    y={slot.y}
                    width={C.FACE_PROV}
                    height={Math.max(0, slot.h)}
                    fill={p.color}
                    opacity={slot.h > 0 ? 0.24 : 0.12}
                    rx={2}
                    onMouseEnter={() => setHover({ kind: "provider", key: p.id })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${p.label} · ${fmtTokens(provTotal(p.id))} tokens context · ${Math.round(visible.reduce((s, t) => s + (t.provider === p.id ? t.rate ?? 0 : 0), 0))} tok/s`}</title>
                  </rect>
                ))}
                <text
                  x={C.PX - 8}
                  y={p.y + 4}
                  textAnchor="end"
                  fontSize={12}
                  fontWeight={700}
                  fill="var(--attn-label)"
                >
                  {p.label}
                </text>
              </g>
            );
          })}

          {/* project pass-through bars + labels */}
          {layout.projects.map((proj) => {
            const dim = hover !== null && !(hover.kind === "project" && hover.key === proj.id);
            return (
              <g key={proj.id} opacity={dim ? 0.25 : 1}>
                {proj.slots.map((slot) => {
                  const threadId = slot.threadId;
                  const t = visible.find((tt) => tt.id === threadId);
                  return (
                    <rect
                      key={`${proj.id}:${slot.threadId}`}
                      x={C.JX}
                      y={slot.y}
                      width={C.FACE_PROJ}
                      height={Math.max(0, slot.h)}
                      fill={t?.provider !== undefined && t.provider !== null ? PROVIDER_TOKENS[t.provider as keyof typeof PROVIDER_TOKENS] ?? PROVIDER_TOKENS.other : "var(--attn-grey-2)"}
                      opacity={slot.h > 0 ? 0.18 : 0.08}
                      onMouseEnter={() => setHover({ kind: "project", key: proj.id })}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
                <text
                  x={C.JX - 8}
                  y={proj.y + 4}
                  textAnchor="end"
                  fontSize={12}
                  fontWeight={600}
                  fill="var(--attn-sub)"
                >
                  <title>{`${proj.label} · ${fmtTokens(visible.filter((t) => t.projectId === proj.id).reduce((s, t) => s + (t.usedTokens ?? 0), 0))} tokens context`}</title>
                  {clipTitle(proj.label, 40)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}