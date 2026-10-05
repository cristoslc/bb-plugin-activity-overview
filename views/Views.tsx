// bb-plugin-activity-overview — the views (tab pages). The four aggregate
// views render from live sidebar thread data; the Activity flow tab reads the
// turn/work shape from the plugin's own `shape` RPC. Pure functions of the
// model; no other server state.
//
// The page is a map canvas in the Google Maps / OpenStreetMap sense: each
// view lays out into a fixed-size world layer that fills the panel viewport;
// the operator pans by dragging, zooms with the wheel or the floating corner
// controls, and all chrome (tabs, legend, flow toolbar and footer) floats
// above the canvas instead of scrolling above the content.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  experimental_useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { Shape, rpcContract } from "../server";
import {
  CAMERA_STORE_KEY,
  DEFAULT_CAMERA_STORE,
  mergeCameraStore,
  parseCameraStore,
  type Camera,
  type CameraStore,
} from "./camera";
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
import { THEME_CSS } from "./theme";

const MIN_STAGE_W = 320; // pack floor for very narrow panels
/** Chrome-free zone the opening fit keeps visible content inside: tab bar
 * (top), the zoom-control row and legend (bottom). */
const SAFE = { top: 60, bottom: 88, left: 12, right: 12 };
/** Breathing room between the content block and the chrome/view edges. */
const GAP = 16;
/** The rect the opening fit and fit-button target: safe area plus gap. */
const fitBox = (vw: number, vh: number) => ({
  x: SAFE.left + GAP,
  y: SAFE.top + GAP,
  w: Math.max(1, vw - SAFE.left - SAFE.right - GAP * 2),
  h: Math.max(1, vh - SAFE.top - SAFE.bottom - GAP * 2),
});
const ZOOM_MIN = 0.2; // zoom-out floor
const ZOOM_MAX = 5; // zoom-in ceiling
/** Contain-mode zoom floor: card labels stay readable when opening flow. */
const MIN_LEGIBLE = 0.8;
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

/** World-space bounds of a view: what the map canvas pans and zooms over. */
type WorldSize = { W: number; H: number };
/** Imperative map controls handed back to views (e.g. flow's "To running"). */
type MapApi = {
  fit: () => void;
  panTo: (x: number, y: number) => void;
  /** Legible contain-width opening centered on a world point (a scope change). */
  openAt: (x: number, y: number) => void;
};

/** World bounds that Stage renders a content region of `contentH` px into. */
const worldOf = (w: number, contentH: number): WorldSize => ({
  W: w,
  H: Math.ceil(contentH),
});

function useLiveModel(): LiveModel {
  const { status, threads, projects } = experimental_useSidebarThreads();
  return useMemo(() => {
    if (status === "loading") return { data: null, state: "loading" as const };
    if (status === "error" || !threads) return { data: null, state: "error" as const };
    return { data: { threads, projects }, state: "ready" as const };
  }, [status, threads, projects]);
}

/**
 * Measure the panel viewport (the wrapper the map canvas fills) so views pack
 * to the visible width and the treemap fills the visible height.
 */
function usePanelSize(min: number): [RefObject<HTMLDivElement | null>, number, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(min);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      if (el.clientWidth > 0) setW(Math.floor(el.clientWidth));
      if (el.clientHeight > 0) setH(Math.floor(el.clientHeight));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w, h];
}

const clampT = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------- camera persistence (bb forward/back) ----------
// The map canvas's last transform and the last-visited tab live in the
// session store, keyed per tab, so returning to the panel restores the
// operator's camera instead of the default opening. Pure codec: views/camera.ts.

function readCameraStore(): CameraStore {
  try {
    return parseCameraStore(sessionStorage.getItem(CAMERA_STORE_KEY), TABS.map((t) => t.id));
  } catch {
    // No session storage available (privacy modes, sandboxed frames): the
    // panel works, it just reopens at the default camera every time.
    return { tab: DEFAULT_CAMERA_STORE.tab, cams: {} };
  }
}

/** Write-through, read-merge-write: a tab's camera lands, others survive. */
function writeCameraStore(patch: { tab?: string; cams?: Record<string, Camera> }): void {
  try {
    const merged = mergeCameraStore(readCameraStore(), patch);
    sessionStorage.setItem(CAMERA_STORE_KEY, JSON.stringify(merged));
  } catch {
    // As above: a full or unavailable session store only loses the nicety.
  }
}

/** The stored camera for one tab, or null when that tab opens by default. */
function storedCamera(tabId: string): Camera | null {
  return readCameraStore().cams[tabId] ?? null;
}

/** Clamp a pan axis so the content keeps at least `m` margin from the view
 * edges at every extreme (flush edges read as mis-centered). */
const clampPan = (tx: number, span: number, view: number, m: number) => {
  const lo = Math.min(m, view - m - span);
  const hi = Math.max(view - m - span, m);
  return clampT(tx, lo, hi);
};

/**
 * A maps-style full-bleed canvas: `children` live in a world-space layer the
 * operator pans by dragging and zooms with the wheel or the corner controls.
 * `world` gives the world bounds views report for fit/clamping; `overlay` is
 * untransformed chrome rendered above the canvas (flow toolbar and footer).
 * The opening zoom is "fit" (whole world in the fit box) or "contain" (a
 * legible contain-width scale centered on `focus` — the flow tree).
 */
function MapCanvas({
  world,
  apiRef,
  zoomMode = "fit",
  focus = null,
  persistKey,
  overlay,
  children,
}: {
  world: WorldSize | null;
  apiRef: RefObject<MapApi | null>;
  zoomMode?: "fit" | "contain";
  focus?: { x: number; y: number } | null;
  /** Session key this canvas's camera persists under (the tab id). */
  persistKey?: string;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ k: 1, tx: 0, ty: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const sizeRef = useRef({ vw: 0, vh: 0 });
  const worldRef = useRef<WorldSize | null>(world);
  worldRef.current = world;
  const zoomModeRef = useRef(zoomMode);
  zoomModeRef.current = zoomMode;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const initialDoneRef = useRef(false);
  /** Camera saved by a previous visit, consumed by the opening effect once. */
  const restoreRef = useRef<Camera | null>(persistKey === undefined ? null : storedCamera(persistKey));
  const dragRef = useRef<{ id: number; px: number; py: number; tx: number; ty: number; captured: boolean } | null>(null);
  const lastPanRef = useRef(0);
  const [panning, setPanning] = useState(false);

  const applyT = useCallback((next: { k: number; tx: number; ty: number }) => {
    const { vw, vh } = sizeRef.current;
    const sz = worldRef.current;
    if (sz !== null && sz.W > 0 && sz.H > 0 && vw > 0 && vh > 0) {
      next.k = clampT(next.k, ZOOM_MIN, ZOOM_MAX);
      const wx = next.k * sz.W;
      const wy = next.k * sz.H;
      next.tx = clampPan(next.tx, wx, vw, GAP);
      next.ty = clampPan(next.ty, wy, vh, GAP);
    }
    setT((prev) =>
      prev.k === next.k && prev.tx === next.tx && prev.ty === next.ty ? prev : next,
    );
  }, []);

  const fit = useCallback(() => {
    const { vw, vh } = sizeRef.current;
    const sz = worldRef.current;
    if (sz === null || sz.W <= 0 || sz.H <= 0 || vw <= 0 || vh <= 0) return;
    // The opening fit never blows a small world up past legibility (1×) and
    // centers it inside the chrome-free fit box, not the raw viewport.
    const box = fitBox(vw, vh);
    const k = clampT(Math.min(box.w / sz.W, box.h / sz.H, 1), ZOOM_MIN, 1);
    applyT({
      k,
      tx: box.x + (box.w - sz.W * k) / 2,
      ty: box.y + (box.h - sz.H * k) / 2,
    });
  }, [applyT]);

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      const cur = tRef.current;
      const k2 = clampT(cur.k * factor, ZOOM_MIN, ZOOM_MAX);
      if (k2 === cur.k) return;
      applyT({
        k: k2,
        tx: cx - (cx - cur.tx) * (k2 / cur.k),
        ty: cy - (cy - cur.ty) * (k2 / cur.k),
      });
    },
    [applyT],
  );

  const panTo = useCallback(
    (x: number, y: number) => {
      const k = tRef.current.k;
      // Land the point in the middle of the fit box, clear of the chrome.
      const box = fitBox(sizeRef.current.vw, sizeRef.current.vh);
      applyT({ k, tx: box.x + box.w / 2 - x * k, ty: box.y + box.h / 2 - y * k });
    },
    [applyT],
  );

  /** Legible contain-width opening centered on a world point. */
  const openAt = useCallback(
    (x: number, y: number) => {
      const sz = worldRef.current;
      if (sz === null || sz.W <= 0 || sz.H <= 0) return;
      const box = fitBox(sizeRef.current.vw, sizeRef.current.vh);
      const k = clampT(Math.min(1, box.w / sz.W), MIN_LEGIBLE, 1);
      applyT({ k, tx: box.x + box.w / 2 - x * k, ty: box.y + box.h / 2 - y * k });
    },
    [applyT],
  );

  // Publish the imperative API for views ("To running", scope re-centers).
  // A layout effect: views' passive effects must see the API on first mount.
  useLayoutEffect(() => {
    const api = { fit, panTo, openAt };
    apiRef.current = api;
    return () => {
      if (apiRef.current === api) apiRef.current = null;
    };
  }, [apiRef, fit, panTo, openAt]);

  // The opening view: fill the fit box the way the view asks — "fit" covers
  // the whole world, "contain" keeps a legible scale and centers on `focus`
  // (the flow tree opens on its root instead of shrunken to specks).
  // Whichever of world/viewport arrives later fires it, so a remount after a
  // tab change always ends fitted.
  const openOnce = useCallback(() => {
    if (initialDoneRef.current) return;
    const sz = worldRef.current;
    const { vw, vh } = sizeRef.current;
    if (sz === null || sz.W <= 0 || sz.H <= 0 || vw <= 0 || vh <= 0) return;
    initialDoneRef.current = true;
    const restored = restoreRef.current;
    if (restored !== null) {
      // A camera saved by a previous visit beats the default opening;
      // applyT clamps the stale transform against the live viewport/world.
      restoreRef.current = null;
      applyT(restored);
      return;
    }
    const box = fitBox(vw, vh);
    if (zoomModeRef.current === "contain") {
      const k = clampT(Math.min(1, box.w / sz.W), MIN_LEGIBLE, 1);
      const f = focusRef.current;
      applyT({
        k,
        tx: box.x + (box.w - sz.W * k) / 2,
        ty: f !== null ? box.y + box.h / 2 - f.y * k : box.y + (box.h - sz.H * k) / 2,
      });
      return;
    }
    const k = clampT(Math.min(box.w / sz.W, box.h / sz.H, 1), ZOOM_MIN, 1);
    applyT({ k, tx: box.x + (box.w - sz.W * k) / 2, ty: box.y + (box.h - sz.H * k) / 2 });
  }, [applyT]);
  useLayoutEffect(openOnce, [openOnce, world]);

  // Write-through persistence: every committed transform lands in the session
  // store under this tab, so bb back-navigation restores the last camera.
  useLayoutEffect(() => {
    if (persistKey === undefined || !initialDoneRef.current) return;
    writeCameraStore({ cams: { [persistKey]: tRef.current } });
  }, [persistKey, t]);

  // Measure the viewport and re-clamp the transform when it resizes.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const read = () => {
      sizeRef.current = { vw: view.clientWidth, vh: view.clientHeight };
      if (sizeRef.current.vw > 0 && sizeRef.current.vh > 0) openOnce();
      else applyT({ ...tRef.current });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(view);
    return () => ro.disconnect();
  }, [applyT, openOnce]);

  // Wheel zooms around the cursor (non-passive so the page never scrolls).
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = view.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
    };
    view.addEventListener("wheel", onWheel, { passive: false });
    return () => view.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button") !== null) return;
    const cur = tRef.current;
    dragRef.current = { id: e.pointerId, px: e.clientX, py: e.clientY, tx: cur.tx, ty: cur.ty, captured: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d === null || e.pointerId !== d.id) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) <= 3) return;
    if (!d.captured) {
      // Capture only once the drag is real: while a capture is active the
      // browser retargets clicks to the capturing element, which would eat
      // the cards' click and double-click handlers.
      e.currentTarget.setPointerCapture(e.pointerId);
      d.captured = true;
      setPanning(true);
    }
    lastPanRef.current = Date.now();
    applyT({ k: tRef.current.k, tx: d.tx + dx, ty: d.ty + dy });
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d === null || e.pointerId !== d.id) return;
    dragRef.current = null;
    setPanning(false);
    if (d.captured && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  // A drag must not land as a click/double-click on a card under the cursor.
  const swallowIfPanned = (e: React.SyntheticEvent) => {
    if (Date.now() - lastPanRef.current < 200) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <>
      <div
        ref={viewRef}
        className="absolute inset-0 touch-none select-none"
        style={{ background: "var(--attn-stage)", cursor: panning ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={swallowIfPanned}
        onDoubleClickCapture={swallowIfPanned}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: world?.W,
            height: world?.H,
            transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.k})`,
            transformOrigin: "0 0",
          }}
        >
          {children}
        </div>
        {overlay != null ? (
          <div className="pointer-events-none absolute inset-0 z-10">{overlay}</div>
        ) : null}
        <div className="absolute bottom-3 right-3 z-20 flex gap-1">
          {(
            [
              ["Fit to view", "⤢", fit],
              ["Zoom in", "+", () => zoomAt(sizeRef.current.vw / 2, sizeRef.current.vh / 2, 1.3)],
              ["Zoom out", "−", () => zoomAt(sizeRef.current.vw / 2, sizeRef.current.vh / 2, 1 / 1.3)],
            ] as Array<[string, string, () => void]>
          ).map(([title, label, onClick]) => (
            <button
              key={title}
              type="button"
              title={title}
              aria-label={title}
              onClick={onClick}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card text-muted-foreground shadow-sm hover:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function LegendRow({ counts }: { counts: Record<Status, number> }) {
  const colors: Array<[string, string, number]> = [
    ["error", "var(--attn-error)", counts.error],
    ["needs-you", "var(--attn-needs-you)", counts["needs-you"]],
    ["working", "var(--attn-working)", counts.working],
    ["unread", "var(--attn-unread)", counts.unread],
    ["idle aging", "var(--attn-grey-1)", counts.idle],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {colors.filter(([, , n]) => n > 0).map(([label, color, n]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block rounded-full"
            style={label === "idle aging" ? { width: 5, height: 5, background: color, boxShadow: "5px 0 0 var(--attn-grey-3)" } : { width: 5, height: 5, background: color }}
          />
          {label}&thinsp;{n}
        </span>
      ))}
    </div>
  );
}

/** World-space root of a view: the fixed-region layer the map pans/zooms. */
function Stage({ w, contentH, children }: { w: number; contentH: number; children: ReactNode }) {
  return (
    <div className="absolute left-0 top-0" style={{ width: w, height: Math.ceil(contentH) }}>
      {children}
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
export function BoardView({
  data,
  nowMs,
  w,
  h,
  onWorld,
}: {
  data: SidebarData;
  nowMs: number;
  w: number;
  /** Fit-box height budget: shelves rescale to use it like the treemap. */
  h: number;
  onWorld: (s: WorldSize | null) => void;
}) {
  const model = useMemo(() => {
    const { projects } = buildProjects(data.threads, data.projects, nowMs);
    // Fill the fit box the way the treemap fills its rect: grow the slot
    // pitch and re-shelve so the shelves use the available height. Capped at
    // 2× so one or two projects don't become a poster.
    let scale = 1;
    let packed = shelfPack(makeCards(projects, P, LBL, BOARD_MIN_CARD_W), w, 14, 14);
    if (h > 0 && packed.H > 0) {
      const s = Math.min(2, h / packed.H);
      if (s > 1.02) {
        scale = s;
        packed = shelfPack(makeCards(projects, P * s, LBL * s, BOARD_MIN_CARD_W * s), w, 14, 14);
        const s2 = h / packed.H;
        if (s2 < 1 && s2 > 0.8) {
          scale *= s2;
          packed = shelfPack(makeCards(projects, P * scale, LBL * scale, BOARD_MIN_CARD_W * scale), w, 14, 14);
        }
      }
    }
    return { packed, scale, world: worldOf(w, packed.H) };
  }, [data, nowMs, w, h]);
  useEffect(() => {
    onWorld(model.world);
  }, [model.world, onWorld]);
  const pitch = P * model.scale;
  const labelH = LBL * model.scale;
  const dot = DOT * model.scale;
  return (
    <Stage w={w} contentH={model.packed.H}>
      {model.packed.placed.map(({ card, x, y }) => (
        <div
          key={card.key}
          title={`${card.name} · ${card.n} threads · ${card.hot} hot`}
          className="absolute rounded-md"
          style={{ left: x, top: y, width: card.w, height: card.h, background: "var(--attn-card)", border: "1px solid var(--attn-card-border)" }}
        >
          <div className="absolute truncate" style={{ left: 8, top: 4, right: 8, fontSize: 11, color: "var(--attn-label)" }}>
            {card.name} · {card.n}
          </div>
          <div className="absolute" style={{ left: 8, top: labelH + 6, width: card.cols * pitch, height: card.rows * pitch }}>
            {card.cells.map((cell, i) => (
              <Dot
                key={cell.t.id}
                cell={cell}
                x={(i % card.cols) * pitch + 2}
                y={Math.floor(i / card.cols) * pitch + 2}
                d={dot}
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
export function UnitTreemapView({
  data,
  nowMs,
  w,
  h,
  onWorld,
}: {
  data: SidebarData;
  nowMs: number;
  w: number;
  /** Height budget from the panel viewport, so the treemap fills the view. */
  h: number;
  onWorld: (s: WorldSize | null) => void;
}) {
  const world = useMemo(() => worldOf(w, h), [w, h]);
  useEffect(() => {
    onWorld(world);
  }, [world, onWorld]);
  const model = useMemo(() => {
    const W = w, H = h, PAD = 2;
    const { projects, total } = buildProjects(data.threads, data.projects, nowMs);
    if (total === 0 || projects.length === 0) return null;
    const rect = squarify(projects.map((p, i) => ({ key: String(i), weight: p.n })), W, H);
    const pitch = Math.sqrt((W * H) / total);
    const d = Math.max(5, Math.min(22, Math.round(pitch * 0.38)));
    const regions = rect.map((r) => {
      const p = projects[Number(r.key)];
      const x = r.x + PAD, y = r.y + PAD, w = r.w - 2 * PAD, h = r.h - 2 * PAD;
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
  }, [data, nowMs, w, h]);
  if (!model) {
    return <p className="text-sm text-muted-foreground">No visible threads.</p>;
  }
  return (
    <Stage w={w} contentH={h}>
      {model.regions.map((r) => (
        <div
          key={r.p.pid}
          title={`${r.p.name} · ${r.p.n} threads`}
          className="absolute rounded-sm"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: "var(--attn-card)" }}
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
            style={{ left: r.x + 5, top: r.y + 2, maxWidth: r.w - 10, fontSize: 10, color: "var(--attn-label)", zIndex: 3 }}
          >
            {r.p.name} · {r.p.n}
          </div>
        ))}
    </Stage>
  );
}

// ---------- view 3: strip tiles ----------
export function StripTilesView({
  data,
  nowMs,
  w,
  h,
  onWorld,
}: {
  data: SidebarData;
  nowMs: number;
  w: number;
  /** Fit-box height budget: tiles rescale to use it like the treemap. */
  h: number;
  onWorld: (s: WorldSize | null) => void;
}) {
  const model = useMemo(() => {
    const { projects } = buildProjects(data.threads, data.projects, nowMs);
    const byN = [...projects].sort((a, b) => b.n - a.n);
    const base = byN.map((p) => ({ p, units: p.cells, w: Math.max(120, p.n * 5 + 20), h: 34 }));
    // Fill the fit box the way the treemap fills its rect: grow the tile
    // scale and re-wrap until the tiles use the available height. Capped 2×.
    let scale = 1;
    let packed = shelfPack(base, w, 12, 10);
    if (h > 0 && packed.H > 0) {
      const s = Math.min(2, h / packed.H);
      if (s > 1.02) {
        scale = s;
        packed = shelfPack(base.map((t) => ({ ...t, w: t.w * s, h: t.h * s })), w, 12, 10);
        const s2 = h / packed.H;
        if (s2 < 1 && s2 > 0.8) {
          scale *= s2;
          packed = shelfPack(base.map((t) => ({ ...t, w: t.w * scale, h: t.h * scale })), w, 12, 10);
        }
      }
    }
    return { packed, scale, world: worldOf(w, packed.H) };
  }, [data, nowMs, w, h]);
  useEffect(() => {
    onWorld(model.world);
  }, [model.world, onWorld]);
  const scale = model.scale;
  return (
    <Stage w={w} contentH={model.packed.H}>
      {model.packed.placed.map(({ card, x, y }) => (
        <div
          key={card.p.pid}
          title={`${card.p.name} · ${card.p.n} threads · ${card.p.hot} hot`}
          className="absolute"
          style={{ left: x, top: y, width: card.w }}
        >
          <div className="truncate" style={{ fontSize: 11, color: "var(--attn-label)", marginBottom: 4 * scale }}>
            {card.p.name} · {card.p.n}
          </div>
          <div className="flex">
            {card.units.map((cell) => (
              <div
                key={cell.t.id}
                title={tip(cell.t, nowMs)}
                className="rounded-sm"
                style={{ width: 4 * scale, height: 12 * scale, marginRight: scale, background: cellColor(cell.t, nowMs) }}
              />
            ))}
          </div>
        </div>
      ))}
    </Stage>
  );
}

// ---------- view 4: agent graph (edge-less lane tree) ----------
export function AgentLanesView({
  data,
  nowMs,
  w,
  onWorld,
}: {
  data: SidebarData;
  nowMs: number;
  w: number;
  onWorld: (s: WorldSize | null) => void;
}) {
  const model = useMemo(() => {
    const { lanes, total } = laneRows(data.threads, data.projects, nowMs);
    const cards = makeLaneCards(lanes, LBL);
    const packed = shelfPack(cards, w, 14, 14);
    return { packed, total, world: worldOf(w, packed.H) };
  }, [data, nowMs, w]);
  useEffect(() => {
    onWorld(model.world);
  }, [model.world, onWorld]);
  if (model.total === 0) {
    return <p className="text-sm text-muted-foreground">No visible threads.</p>;
  }
  return (
    <Stage w={w} contentH={model.packed.H}>
      {model.packed.placed.map(({ card, x, y }) => (
        <div
          key={card.pid}
          title={`${card.name} · ${card.n} threads · ${card.hot} hot`}
          className="absolute rounded-md"
          style={{ left: x, top: y, width: card.w, height: card.h, background: "var(--attn-card)" }}
        >
          <div className="absolute truncate" style={{ left: 8, top: 4, right: 8, fontSize: 11, color: "var(--attn-label)" }}>
            {card.name} · {card.n}
          </div>
          {card.rows.map((row, i) => (
            <div
              key={row.t.id}
              className="absolute flex items-center"
              style={{ left: 8 + row.depth * LANE_INDENT, top: LBL + 6 + i * LANE_ROW_PITCH, width: LANE_LABEL_W, height: LANE_DOT }}
            >
              <Dot cell={{ t: row.t, fam: row.fam }} x={0} y={0} d={LANE_DOT} nowMs={nowMs} />
              <span className="ml-2 truncate" style={{ fontSize: 9, color: "var(--attn-sub)" }}>
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

function ActivityFlowView({
  apiRef,
}: {
  apiRef: RefObject<MapApi | null>;
}) {
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
  const nowMs = Date.now();
  const layout = useMemo(
    () => (shape === null ? null : flowLayout(shape, fold.open, { scope: scopeId, statusFilter })),
    [shape, fold.open, scopeId, statusFilter],
  );
  // Opening/re-centering focus: the root card's center, the tree's entry.
  const flowFocus = useMemo(() => {
    if (layout === null) return null;
    const root = layout.placed.find((p) => p.node.kind === "root");
    return root === undefined ? null : { x: root.x + NODE_W / 2, y: root.y + NODE_H / 2 };
  }, [layout]);
  // Recenters on the root when the scope or the status filter changes; data
  // refetches keep the operator's camera where they left it. The first layout
  // must not re-center over a camera restored from the session store, so the
  // scope key starts "already applied" in that case.
  const restored = useRef<Camera | null>(storedCamera("flow"));
  const scopeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (flowFocus === null) return;
    const key = `${scopeId ?? ""}|${[...statusFilter].sort().join(",")}`;
    if (scopeKeyRef.current === null && restored.current !== null) {
      restored.current = null;
      scopeKeyRef.current = key;
      return;
    }
    if (scopeKeyRef.current === key) return;
    scopeKeyRef.current = key;
    apiRef.current?.openAt(flowFocus.x, flowFocus.y);
  }, [flowFocus, scopeId, statusFilter, apiRef]);

  if (error !== null && shape === null) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Could not load activity shape: {error}</p>
        <button type="button" onClick={retry} className="mt-2 text-xs text-muted-foreground underline">
          Retry
        </button>
      </div>
    );
  }
  if (layout === null || shape === null) {
    // The host's CSS does not compile plugin tailwind, so the spinner is
    // inline styles over a plugin-local keyframes rule (see OverviewPage).
    return (
      <div className="p-4">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className="h-4 w-4 flex-none rounded-full"
            style={{
              animation: "attn-spin 0.9s linear infinite",
              border: "2px solid color-mix(in srgb, var(--attn-dim) 30%, transparent)",
              borderTopColor: "var(--attn-dim)",
            }}
          />
          Loading activity — building the shape from live thread timelines…
        </span>
      </div>
    );
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
    <>
      <MapCanvas
        world={layout === null ? null : { W: layout.W, H: layout.H }}
        apiRef={apiRef}
        zoomMode="contain"
        focus={flowFocus}
        persistKey="flow"
        overlay={
          <>
            <div className="pointer-events-auto absolute right-3 top-3 z-10 flex max-w-[min(560px,calc(100%_-_18rem))] flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card p-2 text-[11px] text-muted-foreground shadow-sm">
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
                  if (running === undefined) return;
                  selected === running.node.id ? setSelected(null) : setSelected(running.node.id);
                  apiRef.current?.panTo(running.x + NODE_W / 2, running.y + NODE_H / 2);
                }}
              >
                To running
              </ToolbarButton>
              <span className="ml-auto">
                {shape.nodes.filter((n) => n.kind === "thread").length} threads
                {shape.truncated ? " · truncated (coldest dropped)" : ""}
              </span>
            </div>
            <div className="pointer-events-auto absolute bottom-3 left-3 right-14 z-10 flex max-h-28 flex-wrap items-center gap-x-4 gap-y-1 overflow-y-auto rounded-md border border-border/60 bg-card p-2 text-[11px] text-muted-foreground shadow-sm">
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
                <span>Click a project or thread to focus it · turns and steps unlock inside a scope · drag to pan, scroll to zoom</span>
              )}
            </div>
          </>
        }
      >
        <div className="absolute left-0 top-0" style={{ width: layout.W, height: layout.H }}>
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
                    stroke={p.node.status === "running" ? "var(--attn-working)" : "var(--attn-seam)"}
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
      </MapCanvas>
    </>
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
        background: selected ? "var(--attn-selected)" : "var(--attn-card)",
        border: `1px solid ${selected ? "var(--attn-selected-border)" : "var(--attn-card-border)"}`,
        padding: "7px 8px",
        opacity: isWorkMore || n.kind === "more" ? 0.8 : 1,
      }}
    >
      <div className="flex h-full items-start gap-2 overflow-hidden">
        <span className="mt-1 flex-none">
          <FlowDotSafe status={n.status} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px]" style={{ color: n.kind === "thread" ? "var(--attn-emph)" : "var(--attn-dim)" }}>
            {n.label}
          </div>
          <div className="truncate text-[10px]" style={{ color: "var(--attn-faint)" }}>
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
    <span className="w-full min-w-0 text-[10px]" style={{ color: "var(--attn-dim)" }}>
      <span style={{ color: "var(--attn-emph)" }}>{node.label}</span>
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

type TabId = (typeof TABS)[number]["id"];

export function OverviewPage() {
  const live = useLiveModel();
  // The last-visited tab survives bb back-navigation (same session store the
  // cameras use) — an unknown id falls back to the board.
  const [tab, setTab] = useState<TabId>(() => {
    const stored = readCameraStore().tab;
    return TABS.some((t) => t.id === stored) ? (stored as TabId) : "board";
  });
  // World bounds of the active aggregate view, reported through onWorld.
  const [world, setWorld] = useState<WorldSize | null>(null);
  const onWorld = useCallback((size: WorldSize | null) => setWorld(size), []);
  const apiRef = useRef<MapApi | null>(null);
  // Panel viewport: views pack to its width; the treemap fills its height.
  const [panelRef, vw, vh] = usePanelSize(MIN_STAGE_W);
  const w = Math.max(MIN_STAGE_W, vw - SAFE.left - GAP - SAFE.right - GAP);
  const hBudget = Math.max(200, vh - SAFE.top - GAP - SAFE.bottom - GAP);
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
  const switchTab = (id: TabId) => {
    setTab(id);
    writeCameraStore({ tab: id }); // remembered for the next visit
    setWorld(null); // drop the previous view's world before the canvas remounts
  };
  return (
    <div ref={panelRef} className="attn-theme relative h-full min-h-0 flex-1 overflow-hidden">
      <style>
        {THEME_CSS +
          "\n.attn-pulse { animation: attn-pulse 2.2s ease-in-out infinite; } @keyframes attn-pulse { 50% { opacity: 0.55; } } @keyframes attn-spin { to { transform: rotate(360deg); } }"}
      </style>
      {tab === "flow" ? (
        <ActivityFlowView apiRef={apiRef} />
      ) : (
        <MapCanvas key={tab} world={world} apiRef={apiRef} persistKey={tab}>
          {tab === "board" ? <BoardView data={live.data} nowMs={nowMs} w={w} h={hBudget} onWorld={onWorld} /> : null}
          {tab === "treemap" ? <UnitTreemapView data={live.data} nowMs={nowMs} w={w} h={hBudget} onWorld={onWorld} /> : null}
          {tab === "tiles" ? <StripTilesView data={live.data} nowMs={nowMs} w={w} h={hBudget} onWorld={onWorld} /> : null}
          {tab === "graph" ? <AgentLanesView data={live.data} nowMs={nowMs} w={w} onWorld={onWorld} /> : null}
        </MapCanvas>
      )}
      <div className="absolute left-3 top-3 z-40 flex max-w-[calc(100%_-_1.5rem)] flex-col items-start gap-2">
        <div className="pointer-events-auto flex gap-1 rounded-md border border-border/60 bg-card p-1 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
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
      </div>
      {tab !== "flow" ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-40 max-w-[420px] rounded-md border border-border/60 bg-card px-3 py-2 shadow-sm">
          <LegendRow counts={counts} />
          <p className="mt-1 text-[10px] text-muted-foreground">
            one dot = one thread · {total} visible · color = status, volume = count · drag to pan, scroll to zoom
          </p>
        </div>
      ) : null}
    </div>
  );
}