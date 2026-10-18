// Token flow view: the provider → project → family amplitude wave, ported from
// the approved mockup (docs/user-experience/sankey-amplitude-wave-mockup.html,
// v19.1). One thread is one river that leaves its provider block, passes the
// project's stacked bar, and lands on the thread's own card row, whose
// left-edge candle is the thread's total spend. Three encodings share the
// geometry: A (ribbon wave — burn per interval all the way back), B (trace
// lane — totals + per-member share bars), C (burn envelope — totals band with
// an inner per-interval crest). The layout math is pure (views/model.ts); this
// component paints it, tweens card growth, animates beads, and owns the chrome.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import { rpcContract, type Flow } from "../server";
import { FLOW_CHANGED } from "../shared";
import {
  FLOW_BUCKETS,
  PROVIDER_TOKENS,
  TOKEN_FLOW,
  TOKEN_FLOW_STATUS,
  buildRiverPaths,
  providerOfModel,
  riverCenterPath,
  riverWidthAt,
  tokenFlowLayout,
  tokenFlowStatus,
  type FlowCard,
  type FlowEncoding,
  type FlowFamilyCard,
  type FlowLayout,
  type FlowThread,
} from "./model";

type WindowId = "15m" | "60m";
const WINDOWS: Array<{ id: WindowId; label: string; buckets: number }> = [
  { id: "15m", label: "Last 15 min", buckets: 5 },
  { id: "60m", label: "Last hour", buckets: FLOW_BUCKETS },
];

const ENCODINGS: Array<{ id: FlowEncoding; label: string }> = [
  { id: "A", label: "A · ribbon wave" },
  { id: "B", label: "B · trace lane" },
  { id: "C", label: "C · burn envelope" },
];

type Hover = { kind: "provider" | "project" | "family"; key: string } | null;

const fmtK = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k`.replace(".0k", "k") : String(Math.round(n));
const fmtTokMin = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1000 ? `${(n / 1000).toFixed(1)}k`
  : String(Math.round(n));
const clip = (s: string, cap: number): string => (s.length > cap ? `${s.slice(0, cap - 1)}…` : s);
const beadColor = (providerColor: string): string =>
  `color-mix(in srgb, ${providerColor} 72%, #ffffff)`;

/** Slice the newest `buckets` from the sampled burn series (a shorter window). */
function windowSeries(series: number[], buckets: number): number[] {
  if (series.length <= buckets) return series;
  return series.slice(series.length - buckets);
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

export function TokenFlowView() {
  const { flow, error, retry } = useFlow();
  const [paused, setPaused] = useState(false);
  const [speedMul, setSpeedMul] = useState(1);
  const [windowId, setWindowId] = useState<WindowId>("60m");
  const [enc, setEnc] = useState<FlowEncoding>("A");
  const [hover, setHover] = useState<Hover>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mix, setMix] = useState(0);

  // The active burn window slices the sampled series; candles stay the honest
  // context-usage totals (the only per-thread measure the host persists).
  const threads = useMemo((): FlowThread[] => {
    if (flow === null) return [];
    const buckets = WINDOWS.find((w) => w.id === windowId)?.buckets ?? FLOW_BUCKETS;
    return flow.threads.map((t) => ({ ...t, series: windowSeries(t.series, buckets) }));
  }, [flow, windowId]);

  // --- tweened selection growth (no teleporting; 250ms ease-out) ---
  const tweenRef = useRef<number | null>(null);
  const animateMix = useCallback((to: number, from: number) => {
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 250);
      const u = 1 - Math.pow(1 - t, 3);
      setMix(from + (to - from) * u);
      if (t < 1) tweenRef.current = requestAnimationFrame(step);
      else {
        tweenRef.current = null;
        setMix(to);
      }
    };
    tweenRef.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => {
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
  }, []);

  const mixRef = useRef(mix);
  mixRef.current = mix;
  const selectedRef = useRef<string | null>(selected);
  selectedRef.current = selected;
  const selectFamily = useCallback(
    (key: string | null) => {
      const cur = selectedRef.current;
      if (key === null || key === cur) {
        selectedRef.current = null;
        setSelected(null);
        animateMix(0, mixRef.current);
        return;
      }
      selectedRef.current = key;
      setSelected(key);
      animateMix(1, mixRef.current);
    },
    [animateMix],
  );

  const layout = useMemo(
    (): FlowLayout => tokenFlowLayout(threads, { selected, mix }),
    [threads, selected, mix],
  );

  const C = TOKEN_FLOW;

  // --- camera (viewBox units): zoom about cursor, drag pan, dblclick reset ---
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const svgPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (svg === null) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const sf = Math.min(rect.width / C.W, rect.height / layout.H);
      const ox = (rect.width - C.W * sf) / 2;
      const oy = (rect.height - layout.H * sf) / 2;
      return { x: (clientX - rect.left - ox) / sf, y: (clientY - rect.top - oy) / sf };
    },
    [C.W, layout.H],
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
      const sf = Math.min(rect.width / C.W, rect.height / layout.H);
      setView((v) => ({
        ...v,
        x: v.x + (event.clientX - drag.px) / sf,
        y: v.y + (event.clientY - drag.py) / sf,
      }));
      dragRef.current = { px: event.clientX, py: event.clientY };
    },
    [C.W, layout.H],
  );
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // --- beads: one rAF loop; dash offset per river drifts with its burn rate ---
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
        for (const r of layout.rivers) {
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

  const totalRate = threads.reduce((s, t) => s + (t.rate ?? 0), 0);

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

  // --- focus lighting ---
  const selFamily = selected;
  const keepFams = new Set<string>();
  if (selFamily !== null) keepFams.add(selFamily);
  if (hover !== null) {
    for (const r of layout.rivers) {
      const match =
        hover.kind === "provider"
          ? r.provider === hover.key
          : hover.kind === "project"
            ? r.projectId === hover.key
            : r.familyKey === hover.key;
      if (match) keepFams.add(r.familyKey);
    }
    if (hover.kind === "family") keepFams.add(hover.key);
  }
  const focusing = selFamily !== null || hover !== null;
  const riverDim = selFamily !== null ? 0.12 : 0.22;
  const zoneDim = selFamily !== null ? 0.25 : 0.5;
  const riverLit = (familyKey: string): boolean => !focusing || keepFams.has(familyKey);

  const provTotal = (provId: string) =>
    layout.providers.find((p) => p.id === provId)?.total ?? 0;
  const caption =
    enc === "A"
      ? "river = burn per interval, all the way back · candle = total spent"
      : enc === "B"
        ? "everything = totals · bar = member's share of the family's window"
        : "band = total · crest = tokens per interval (its own mini-scale)";
  const hiddenNote =
    layout.droppedThreads.length > 0
      ? ` · ${layout.droppedThreads.length} smaller thread${layout.droppedThreads.length === 1 ? "" : "s"} hidden`
      : "";

  return (
    <div className="absolute inset-0">
      {/* chrome (top-right) */}
      <div className="pointer-events-auto absolute right-3 top-3 z-40 flex flex-col items-end gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-2 shadow-sm">
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--attn-label)" }}>
          <span className="inline-block size-2 rounded-full" style={{ background: "var(--attn-working)" }} />
          <span className="text-base font-bold" style={{ color: "var(--attn-emph)" }}>
            {fmtTokMin(Math.round(totalRate * 60))}
          </span>
          <span>tok/min</span>
        </div>
        <div className="flex items-center gap-1">
          {ENCODINGS.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setEnc(e.id)}
              className={
                "rounded border border-border/60 px-2 py-0.5 text-[11px] " +
                (enc === e.id
                  ? "bg-background font-semibold text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {e.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="rounded border border-border/60 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {paused ? "Resume flow" : "Pause flow"}
          </button>
        </div>
        <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--attn-label)" }}>
          flow ×{speedMul.toFixed(1)}
          <input
            type="range"
            min={0.4}
            max={3}
            step={0.1}
            value={speedMul}
            onChange={(e) => setSpeedMul(Number(e.target.value))}
            className="w-24"
          />
        </label>
      </div>

      {/* legend (bottom-left) */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-40 max-w-[600px] rounded-md border border-border/60 bg-card px-3 py-2 shadow-sm">
        <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1">
          {layout.providers.map((p) => (
            <span key={p.id} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--attn-sub)" }}>
              <span className="inline-block size-2.5 rounded-sm" style={{ background: p.color, opacity: 0.85 }} />
              {p.label} · {fmtK(provTotal(p.id))}
            </span>
          ))}
        </div>
        <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--attn-faint)" }}>
          <span style={{ color: "var(--attn-dim)" }}>candles</span> = total spend, one row per thread · quiet
          threads = flat streams · columns are topology, not time{hiddenNote}
        </p>
        <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--attn-faint)" }}>{caption}</p>
        <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--attn-faint)" }}>
          click = pin family · click space = release · wheel = zoom · drag = pan · double-click = reset
        </p>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${C.W} ${layout.H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={() => setView({ x: 0, y: 0, k: 1 })}
        onClick={(e) => {
          if (e.target === svgRef.current && selected !== null) selectFamily(null);
        }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* family zones (cards) */}
          {layout.families.map((fam) => {
            const lit = riverLit(fam.key);
            return (
              <g key={fam.key} opacity={lit ? 1 : zoneDim}>
                {fam.selected ? (
                  <rect
                    x={C.FX - 14}
                    y={fam.zoneY - 6}
                    width={C.ZONE_W + 18}
                    height={fam.zoneH + 10}
                    rx={14}
                    fill="none"
                    stroke="var(--attn-selected-border)"
                    strokeWidth={5}
                    strokeOpacity={0.5}
                  />
                ) : null}
                <rect
                  x={C.FX - 10}
                  y={fam.zoneY}
                  width={C.ZONE_W}
                  height={fam.zoneH}
                  rx={fam.selected ? 8 : 10}
                  fill="var(--attn-prov-zone)"
                  stroke="var(--attn-prov-zone-border)"
                  strokeOpacity={fam.selected ? 0.95 : 0.7}
                  onMouseEnter={() => setHover({ kind: "family", key: fam.key })}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>
                    {`Family · ${fam.members.map((m) => m.thread.title).join(" · ")}`}
                  </title>
                </rect>
                {/* member rows */}
                {fam.members.map((card) => {
                  const t = card.thread;
                  const st = TOKEN_FLOW_STATUS[tokenFlowStatus(t.status)];
                  const inZone = card.isParent ? 0 : 14;
                  const labelX = C.FX + 12 + inZone;
                  const dot = st.color;
                  return (
                    <g key={t.id} opacity={lit ? 1 : 0.35}>
                      <circle
                        cx={labelX + 3}
                        cy={card.y + card.h / 2 - 4}
                        r={3.5}
                        fill={dot}
                      />
                      <text
                        x={labelX + 10}
                        y={card.y + card.h / 2 + 4}
                        fontSize={card.isParent ? 11 : 10.5}
                        fontWeight={card.isParent ? 700 : 500}
                        fill={card.isParent ? "var(--attn-emph)" : "var(--attn-sub)"}
                      >
                        <title>{`${t.title} · ${t.usedTokens ?? 0} tokens context · ${t.model ?? "model unknown"} · ${Math.round(t.rate ?? 0)} tok/s`}</title>
                        {card.isParent ? clip(t.title, 30) : `└ ${clip(t.title, 27)}`}
                      </text>
                      {t.status === "running" && (t.rate ?? 0) > 0 ? (
                        <text
                          x={C.FX + C.ZONE_W - 10}
                          y={card.y + card.h / 2 + 4}
                          textAnchor="end"
                          fontSize={10}
                          fontWeight={500}
                          fill={st.color}
                        >
                          {fmtTokMin((t.rate ?? 0) * 60)} tok/min
                        </text>
                      ) : null}
                      {enc === "B" ? <ShareBar card={card} family={fam} /> : null}
                      {/* selection hit */}
                      <rect
                        x={C.FX - 16}
                        y={card.y - 2}
                        width={C.ZONE_W + 6}
                        height={card.h + 4}
                        fill="#000"
                        fillOpacity={0}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setHover({ kind: "family", key: fam.key })}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => selectFamily(fam.key)}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* project captions (over each cluster) */}
          {layout.clusters.map((cl) =>
            cl.families.length > 0 ? (
              <text
                key={`cap:${cl.name}`}
                x={C.FX - 8}
                y={cl.captionY}
                fontSize={10}
                fill="var(--attn-faint)"
              >
                {cl.name}
              </text>
            ) : null,
          )}

          {/* rivers: band + mouth + crest + beads */}
          {layout.rivers.map((r) => {
            const lit = riverLit(r.familyKey);
            const st = TOKEN_FLOW_STATUS[r.status];
            const color = PROVIDER_TOKENS[r.provider];
            const paths = buildRiverPaths(r, layout.bucketScale, enc);
            const base = Math.max(0.5, st.base + 0.18);
            return (
              <g key={r.id} opacity={lit ? 1 : riverDim} pointerEvents="none">
                {enc !== "A" ? (
                  <path
                    d={riverCenterPath(r)}
                    stroke={color}
                    strokeWidth={Math.max(1.5, r.w)}
                    fill="none"
                    opacity={base}
                  />
                ) : null}
                <path d={paths.bandD} fill={color} opacity={base} />
                <path d={paths.mouthD} fill={color} opacity={0.5} />
                {paths.crestD !== null ? (
                  <path
                    d={paths.crestD}
                    stroke={color}
                    strokeWidth={enc === "A" ? 1.1 : 1.3}
                    fill="none"
                    opacity={enc === "A" ? 0.5 : 0.85}
                  />
                ) : null}
                {r.status === "running" && (r.rate ?? 0) > 0 ? (
                  <path
                    ref={(el) => {
                      if (el === null) beadRefs.current.delete(r.id);
                      else beadRefs.current.set(r.id, el);
                    }}
                    d={riverCenterPath(r)}
                    stroke={beadColor(color)}
                    strokeWidth={Math.max(1.5, Math.min(4, r.w * 0.3))}
                    fill="none"
                    strokeDasharray="0.5 12"
                    strokeLinecap="round"
                    opacity={0.85}
                  />
                ) : null}
              </g>
            );
          })}

          {/* rivers: hover/click corridors (floored at 14px) */}
          {layout.rivers.map((r) => (
            <path
              key={`hit:${r.id}`}
              d={riverCenterPath(r)}
              stroke="#000"
              strokeOpacity={0}
              strokeWidth={Math.max(14, riverWidthAt(r, (C.PX + C.PW + C.FX) / 2, layout.bucketScale, enc))}
              fill="none"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover({ kind: "family", key: r.familyKey })}
              onMouseLeave={() => setHover(null)}
              onClick={() => selectFamily(r.familyKey)}
            />
          ))}

          {/* project boxes (middle): stacked provider slices + labels */}
          {layout.projects.map((p) => {
            const lit =
              !focusing ||
              (hover !== null && hover.kind === "project" && hover.key === p.id) ||
              p.threads.some((id) => {
                const fk = layout.cards.find((c) => c.thread.id === id)?.familyKey;
                return fk !== undefined && keepFams.has(fk);
              });
            return (
              <g key={p.id} opacity={lit ? 1 : zoneDim}>
                {p.slices.map((s) => (
                  <rect
                    key={`${s.threadId}:${s.provider}`}
                    x={C.JX + 1}
                    y={s.y}
                    width={C.JW - 2}
                    height={Math.max(0, s.h)}
                    fill={layout.providers.find((pr) => pr.id === s.provider)?.color ?? "var(--attn-grey-2)"}
                    opacity={0.55}
                    onMouseEnter={() => setHover({ kind: "project", key: p.id })}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
                <text x={C.JX + C.JW + 12} y={p.y + 10} fontSize={12} fontWeight={700} fill="var(--attn-emph)">
                  <title>{`${p.label} · ${fmtK(p.total)} tokens`}</title>
                  {clip(p.label, 30)}
                </text>
                <text x={C.JX + C.JW + 12} y={p.y + 25} fontSize={10.5} fill="var(--attn-sub)">
                  {fmtK(p.total)} tokens
                </text>
              </g>
            );
          })}

          {/* provider blocks (left) */}
          {layout.providers.map((p) => {
            const dim = hover !== null && hover.kind === "provider" && hover.key !== p.id;
            return (
              <g key={p.id} opacity={dim ? 0.25 : 1}>
                <rect x={C.PX} y={p.y} width={C.PW} height={Math.max(2, p.h)} rx={3} fill={p.color} opacity={0.92} />
                <text x={C.PX - 10} y={p.y + Math.max(2, p.h) / 2 - 1} textAnchor="end" fontSize={13} fontWeight={700} fill="var(--attn-emph)">
                  <title>{`${p.label} · ${fmtK(p.total)} tokens · ${Math.round((p.total / Math.max(1, threads.reduce((s, t) => s + Math.max(0, t.usedTokens ?? 0), 0))) * 100)}%`}</title>
                  {p.label}
                </text>
                <text x={C.PX - 10} y={p.y + Math.max(2, p.h) / 2 + 13} textAnchor="end" fontSize={11} fill="var(--attn-sub)">
                  {fmtK(p.total)} tokens
                </text>
                <rect
                  x={C.PX - 140}
                  y={p.y - 4}
                  width={148}
                  height={Math.max(8, p.h + 8)}
                  fill="#000"
                  fillOpacity={0}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover({ kind: "provider", key: p.id })}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}

          {/* candles: card-row left-edge bars */}
          {layout.cards.map((card) => {
            const lit = riverLit(card.familyKey);
            const color = PROVIDER_TOKENS[providerOfModel(card.thread.model)];
            return (
              <rect
                key={`candle:${card.thread.id}`}
                x={C.FX - 10}
                y={card.candleY}
                width={7}
                height={Math.max(3, card.candleH)}
                rx={2}
                fill={card.burn ? color : "var(--attn-grey-2)"}
                opacity={lit ? (card.burn ? 0.95 : 0.35) : riverDim}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover({ kind: "family", key: card.familyKey })}
                onMouseLeave={() => setHover(null)}
                onClick={() => selectFamily(card.familyKey)}
              >
                <title>{`${card.thread.title} · ${fmtK(Math.max(0, card.thread.usedTokens ?? 0))} tokens total`}</title>
              </rect>
            );
          })}

          {/* enlarged family panel below the selected card */}
          {layout.families
            .filter((f) => f.selected && mix > 0.02)
            .map((fam) => {
              const y0 = fam.zoneY + fam.zoneH - fam.panelH;
              const famTotal = fam.members.reduce((s, m) => s + Math.max(0, m.thread.usedTokens ?? 0), 0);
              return (
                <g key={`panel:${fam.key}`} opacity={mix}>
                  <text x={C.FX + 2} y={y0 + 9} fontSize={11} fill="var(--attn-sub)">
                    {fam.projectName} · parent
                  </text>
                  <rect x={C.FX + C.ZONE_W - 160} y={y0 - 9} width={158} height={18} rx={9} fill="var(--attn-card)" stroke="var(--attn-card-border)" />
                  <text x={C.FX + C.ZONE_W - 81} y={y0 + 4} fontSize={10} textAnchor="middle" fill="var(--attn-sub)">
                    {fmtK(famTotal)} tokens · {fam.members.length} member{fam.members.length === 1 ? "" : "s"}
                  </text>
                  {fam.members.map((m, i) => (
                    <text
                      key={`pm:${m.thread.id}`}
                      x={C.FX + 16}
                      y={y0 + 26 + i * 13}
                      fontSize={11}
                      fill={(m.thread.rate ?? 0) > 0 ? "var(--attn-working)" : "var(--attn-dim)"}
                    >
                      {clip(m.thread.title, 20)} · {fmtK(Math.max(0, m.thread.usedTokens ?? 0))} tok
                    </text>
                  ))}
                </g>
              );
            })}
        </g>
      </svg>
    </div>
  );
}

/** B encoding: a member's share of its family's window total, as a 4px bar. */
function ShareBar({ card, family }: { card: FlowCard; family: FlowFamilyCard }) {
  const C = TOKEN_FLOW;
  const own = Math.max(0, card.thread.usedTokens ?? 0);
  if (own <= 0) return null;
  const famTotal = family.members.reduce((s, m) => s + Math.max(0, m.thread.usedTokens ?? 0), 0);
  if (famTotal <= 0) return null;
  const barW = (own / famTotal) * 262;
  const color = PROVIDER_TOKENS[providerOfModel(card.thread.model)];
  return (
    <rect
      x={C.FX + 12 + (card.isParent ? 0 : 14) + 10}
      y={card.y + card.h - 4}
      width={barW}
      height={4}
      rx={2}
      fill={color}
      opacity={0.75}
    />
  );
}
