// bb-plugin-activity-overview — the views (tab pages). The three aggregate
// views render from live sidebar thread data; pure functions of the model; no
// other server state.
//
// The page is a map canvas in the Google Maps / OpenStreetMap sense: each
// view lays out into a fixed-size world layer that fills the panel viewport;
// the operator pans by dragging, zooms with the wheel or the floating corner
// controls, and all chrome (tabs, legend and footer) floats above the canvas
// instead of scrolling above the content.
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
} from "@get-bb/plugin-sdk/app";
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
  shelfPack,
  squarify,
  tip,
  familyTints,
  FAMILY_TINTS,
  zoomToRect,
  clampPanEdges,
  type AttnProject,
  type AttnThread,
  type Cell,
  type Status,
} from "./model";
import { THEME_CSS } from "./theme";
import {
  APP_VERSION,
  CURRENT_UNRELEASED_FINGERPRINT,
  EMPTY_UNRELEASED_FINGERPRINT,
  hasUnseenWhatsNew,
  readLastSeenUnreleased,
  readLastSeenVersion,
  whatsNewEntriesFor,
  writeLastSeenUnreleased,
  writeLastSeenVersion,
  type WhatsNewEntry,
} from "../lib/whats-new";

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
/** Padding around a treemap project the focus zoom keeps visible. */
const FOCUS_PAD = 28;
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
/** Imperative map controls handed back to views (the treemap's zoom focus). */
type MapApi = {
  fit: () => void;
  /** Zoom (past 1×) so the treemap's focused project fills the fit box. */
  openRect: (rect: { x: number; y: number; w: number; h: number }) => void;
  /** The live camera scale (the treemap's hover gates read it at event time). */
  scale: () => number;
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
 * `world` gives the world bounds views report for fit/clamping. The opening
 * zoom is "fit" (whole world in the fit box).
 */
function MapCanvas({
  world,
  apiRef,
  persistKey,
  children,
}: {
  world: WorldSize | null;
  apiRef: RefObject<MapApi | null>;
  /** Session key this canvas's camera persists under (the tab id). */
  persistKey?: string;
  children: ReactNode;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ k: 1, tx: 0, ty: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const sizeRef = useRef({ vw: 0, vh: 0 });
  const worldRef = useRef<WorldSize | null>(world);
  worldRef.current = world;
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
      // Vertical pan keeps the top nav chrome clear: content can never ride
      // under the floating tab bar (the bug where zooming hid project titles).
      next.ty = clampPanEdges(next.ty, wy, vh, SAFE.top, GAP);
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

  /** Zoom so a world rect fills the chrome-free fit box (treemap focus). */
  const openRect = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      const box = fitBox(sizeRef.current.vw, sizeRef.current.vh);
      if (box.w <= 1 || box.h <= 1) return;
      const { scale, tx, ty } = zoomToRect(rect, box.w, box.h, { pad: FOCUS_PAD, maxScale: ZOOM_MAX });
      applyT({ k: scale, tx: box.x + tx, ty: box.y + ty });
    },
    [applyT],
  );

  // Publish the imperative API for views (the treemap's zoom focus).
  // A layout effect: views' passive effects must see the API on first mount.
  useLayoutEffect(() => {
    const api = { fit, openRect, scale: () => tRef.current.k };
    apiRef.current = api;
    return () => {
      if (apiRef.current === api) apiRef.current = null;
    };
  }, [apiRef, fit, openRect]);

  // The opening view: fill the fit box. Whichever of world/viewport arrives
  // later fires it, so a remount after a tab change always ends fitted.
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

// ---------- view 2: unit treemap (honest fill + zoom-to-project) ----------
/** Zoom-in scale past which hovering a project previews family tints. */
const HOVER_TINT_SCALE = 1.2;
/** Touch press-and-hold duration for the same family-tint preview. */
const LONG_PRESS_MS = 400;

export function UnitTreemapView({
  data,
  nowMs,
  w,
  h,
  onWorld,
  apiRef,
}: {
  data: SidebarData;
  nowMs: number;
  w: number;
  /** Height budget from the panel viewport, so the treemap fills the view. */
  h: number;
  onWorld: (s: WorldSize | null) => void;
  apiRef: RefObject<MapApi | null>;
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
      const cellTints = familyTints(p.cells.map((c) => c.fam));
      return { p, x, y, w, h, showLabel, top, cols, rows, cw, ch, cellTints };
    });
    return { regions, pitch, d, projectCount: projects.length };
  }, [data, nowMs, w, h]);

  // Focus: tapping a project dims the rest and zooms the board until the
  // project fills the fit box with its family tints locked on (family-derived
  // only, never status-derived). Tapping anything else — another project, a
  // void, the fit box — fits the zoomed-out world back out. The camera
  // itself stays with MapCanvas; the view only aims it.
  const [focusPid, setFocusPid] = useState<string | null>(null);
  // Hover (mouse) / press-and-hold (touch) family-tint preview target.
  const [hoverPid, setHoverPid] = useState<string | null>(null);
  const holdRef = useRef<number | null>(null);
  const suppressTapRef = useRef(false);
  const clearHold = () => {
    if (holdRef.current !== null) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  };

  if (!model) {
    return <p className="text-sm text-muted-foreground">No visible threads.</p>;
  }

  // Family tints are a zoomed-in affordance: the camera must be past
  // HOVER_TINT_SCALE (a focused project keeps them regardless of scale).
  const zoomedIn = () => apiRef.current !== null && apiRef.current.scale() > HOVER_TINT_SCALE;
  const setFocus = (pid: string | null) => {
    setHoverPid(null);
    suppressTapRef.current = false;
    setFocusPid(pid);
    if (pid === null) apiRef.current?.fit();
    else {
      const r = model.regions.find((rr) => rr.p.pid === pid);
      if (r !== undefined) apiRef.current?.openRect({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
  };

  return (
    <Stage w={w} contentH={h}>
      {/* Voids leave the fold: any tap that is not a region (or a pan) leaves focus. */}
      <div
        className="pointer-events-auto absolute inset-0"
        style={{ width: w, height: h }}
        onClick={() => {
          suppressTapRef.current = false;
          if (focusPid !== null) setFocus(null);
        }}
      />
      {model.regions.map((r) => {
        const dim = focusPid !== null && focusPid !== r.p.pid;
        const tinted = focusPid === r.p.pid || hoverPid === r.p.pid;
        return (
          <div
            key={r.p.pid}
            title={`${r.p.name} · ${r.p.n} threads`}
            className="absolute overflow-hidden rounded-sm"
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              background: "var(--attn-card)",
              opacity: dim ? 0.3 : 1,
              cursor: "pointer",
              transition: "opacity 200ms ease",
            }}
            onClick={() => {
              // MapCanvas swallows clicks right after a pan; a held tap (the
              // touch peek) also never lands as a click.
              if (suppressTapRef.current) {
                suppressTapRef.current = false;
                return;
              }
              setFocus(focusPid === null ? r.p.pid : null);
            }}
            onPointerDown={(e) => {
              if (e.pointerType === "touch") {
                suppressTapRef.current = false;
                clearHold();
                // Press-and-hold previews the family tints (peek); the
                // preview stays on until the next press.
                holdRef.current = window.setTimeout(() => {
                  suppressTapRef.current = true;
                  if (zoomedIn()) setHoverPid(r.p.pid);
                }, LONG_PRESS_MS);
              }
            }}
            onPointerUp={clearHold}
            onPointerLeave={() => {
              clearHold();
              if (hoverPid === r.p.pid) setHoverPid(null);
            }}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse" && zoomedIn()) setHoverPid(r.p.pid);
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
                      opacity: 1,
                    }}
                  />
                ))
              : null}
            {r.p.cells.map((cell, i) => {
              const j = i % r.cols, k = Math.floor(i / r.cols);
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
              color: "var(--attn-label)",
              opacity: focusPid !== null && focusPid !== r.p.pid ? 0.3 : 1,
              zIndex: 3,
            }}
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

// ---------- the tabbed page ----------
const TABS = [
  { id: "board", label: "Board" },
  { id: "treemap", label: "Unit treemap" },
  { id: "tiles", label: "Strip tiles" },
] as const;

/** The gift glyph for the What's-new button (no host icon to lean on). */
function GiftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

/**
 * The What's-new modal behind the tab bar's gift button. Lists the condensed
 * changelog entries — either the delta since the stored last-seen version
 * (after an update) or every recent entry (opened unprompted from the quiet
 * button); a dev build leads with its [Unreleased] group. Opening marks the
 * version seen; the button stays.
 *
 * Styled with inline styles over the theme's CSS variables, not tailwind:
 * the spinner lesson — classes the compiled app.css did not carry rendered
 * invisibly, so this surface relies on nothing outside its own file.
 */
function WhatsNewModal({
  open,
  onOpenChange,
  entries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly WhatsNewEntry[];
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-[420px] max-w-[calc(100%_-_2rem)] rounded-lg border border-border/60 bg-card p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="What's new"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold text-foreground">What&apos;s new in Activity Overview</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {entries.length === 0
            ? `You are on version ${APP_VERSION}.`
            : "Recent changes since you last looked."}
        </p>
        <div className="max-h-[60vh] min-h-0 overflow-y-auto">
          {entries.map((entry) => (
            <section key={`${entry.version}:${entry.unreleased === true}`} className="mb-3 last:mb-0">
              <h3 className="mb-1 text-xs font-semibold text-foreground">
                {entry.unreleased ? `Unreleased ${entry.version}` : `Version ${entry.version}`}
              </h3>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                {entry.items.map((item) => (
                  <li key={item.lead}>
                    {item.lead}
                    {item.children && item.children.length > 0 ? (
                      <ul className="list-disc mt-1 space-y-1 pl-4">
                        {item.children.map((child) => (
                          <li key={child}>{child}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border/60 bg-background px-3 py-1 text-xs text-foreground hover:bg-accent"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

type TabId = (typeof TABS)[number]["id"];

export function OverviewPage() {
  const live = useLiveModel();
  // What's new: two "seen" models, picked by the running build. A stable
  // build compares versions: a fresh install (nothing stored) is stamped
  // silently — everything is new, so nothing counts as new — and an upgrade
  // pulses until the modal is opened. A prerelease build (dev's
  // "X.Y.Z-dev") keys "seen" to the [Unreleased] group's content instead:
  // its fingerprint is stamped silently on first load, and the button pulses
  // again whenever the group's bullets change (each merge to dev). Opening
  // marks seen; the button itself never leaves.
  const [lastSeenVersion, setLastSeenVersion] = useState<string | null>(() => readLastSeenVersion());
  const [lastSeenUnreleased, setLastSeenUnreleased] = useState<string | null>(() => readLastSeenUnreleased());
  useEffect(() => {
    if (lastSeenVersion === null) {
      writeLastSeenVersion(APP_VERSION); // fresh install: stamp silently
      setLastSeenVersion(APP_VERSION);
    }
  }, [lastSeenVersion]);
  // The unreleased fingerprint is NOT stamped at load: a fresh dev build
  // pulses its standing group until opened (hasUnseenWhatsNew); only opening
  // the modal records it as seen (openWhatsNew).
  const whatsNewUnseen = hasUnseenWhatsNew({
    runningVersion: APP_VERSION,
    lastSeenVersion,
    unreleasedFingerprint: CURRENT_UNRELEASED_FINGERPRINT,
    lastSeenUnreleasedFingerprint: lastSeenUnreleased,
  });
  // The delta is captured at load (before opening marks it seen): a dev
  // build leads with its unreleased group; stable builds show entries since
  // the stored version when one is pending, all recent entries otherwise.
  const whatsNewEntries: readonly WhatsNewEntry[] = whatsNewEntriesFor(
    APP_VERSION,
    whatsNewUnseen,
    lastSeenVersion,
  );
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const openWhatsNew = useCallback(() => {
    writeLastSeenUnreleased(CURRENT_UNRELEASED_FINGERPRINT);
    setLastSeenUnreleased(CURRENT_UNRELEASED_FINGERPRINT);
    writeLastSeenVersion(APP_VERSION);
    setLastSeenVersion(APP_VERSION);
    setWhatsNewOpen(true);
  }, []);
  // The last-visited tab survives bb back-navigation (same session store the
  // cameras use) — an unknown id falls back to the board.
  const [tab, setTab] = useState<TabId>(() => {
    const stored = readCameraStore().tab;
    return TABS.some((t) => t.id === stored) ? (stored as TabId) : "board";
  });
  // World bounds of the active aggregate view, reported through onWorld.
  // The report is cached per tab: re-clicking the active tab (or landing on a
  // view that re-reports nothing new) must never leave `world` null, or the
  // canvas's fit() no-ops and every pan clamp goes dead — the bug that let
  // zoomed content slide under the top nav.
  const [world, setWorld] = useState<WorldSize | null>(null);
  const worldCache = useRef<Map<TabId, WorldSize>>(new Map());
  const tabRef = useRef<TabId>(tab);
  tabRef.current = tab;
  const onWorld = useCallback((size: WorldSize | null) => {
    if (size !== null) worldCache.current.set(tabRef.current, size);
    setWorld(size);
  }, []);
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
    // Seed the canvas from the tab's cached world (null only if never
    // reported); the new view's report effect refreshes it on mount.
    setWorld(worldCache.current.get(id) ?? null);
  };
  return (
    <div ref={panelRef} className="attn-theme relative h-full min-h-0 flex-1 overflow-hidden">
      <style>
        {THEME_CSS +
          "\n.attn-pulse { animation: attn-pulse 2.2s ease-in-out infinite; } @keyframes attn-pulse { 50% { opacity: 0.55; } } @keyframes attn-spin { to { transform: rotate(360deg); } }"}
      </style>
      <MapCanvas key={tab} world={world ?? worldCache.current.get(tab) ?? null} apiRef={apiRef} persistKey={tab}>
        {tab === "board" ? <BoardView data={live.data} nowMs={nowMs} w={w} h={hBudget} onWorld={onWorld} /> : null}
        {tab === "treemap" ? <UnitTreemapView data={live.data} nowMs={nowMs} w={w} h={hBudget} onWorld={onWorld} apiRef={apiRef} /> : null}
        {tab === "tiles" ? <StripTilesView data={live.data} nowMs={nowMs} w={w} h={hBudget} onWorld={onWorld} /> : null}
      </MapCanvas>
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
          {/* Always present — the changelog never becomes unreachable. The
              pulse (and the amber tint) is the only state, and it clears on
              open. */}
          <button
            type="button"
            onClick={openWhatsNew}
            aria-label="What's new"
            title="What's new"
            className={
              "inline-flex items-center justify-center rounded px-2 py-1 " +
              (whatsNewUnseen
                ? "text-amber-500 hover:text-amber-400"
                : "text-muted-foreground hover:text-foreground")
            }
            style={
              whatsNewUnseen ? { animation: "attn-pulse 2.2s ease-in-out infinite" } : undefined
            }
          >
            <GiftIcon className="size-4" />
          </button>
        </div>
      </div>
      <WhatsNewModal open={whatsNewOpen} onOpenChange={setWhatsNewOpen} entries={whatsNewEntries} />
      <div className="pointer-events-none absolute bottom-3 left-3 z-40 max-w-[420px] rounded-md border border-border/60 bg-card px-3 py-2 shadow-sm">
        <LegendRow counts={counts} />
        <p className="mt-1 text-[10px] text-muted-foreground">
          one dot = one thread · {total} visible · color = status, volume = count · drag to pan, scroll to zoom
        </p>
      </div>
    </div>
  );
}
