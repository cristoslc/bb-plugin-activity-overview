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
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import {
  ARMED_LATCH,
  CAMERA_STORE_KEY,
  DEFAULT_CAMERA_STORE,
  disarm,
  mergeCameraStore,
  parseCameraStore,
  reportWorld,
  type Camera,
  type CameraStore,
  type OpeningLatch,
} from "./camera";
import {
  buildProjects,
  statusCounts,
  cellColor,
  classify,
  makeCards,
  shelfPack,
  fillScale,
  treemapLayout,
  placeRegionLabels,
  tip,
  ageLabel,
  pulsePeriodMs,
  threadTitle,
  FAMILY_TINTS,
  zoomToRect,
  clampPanEdges,
  isZoomedIn,
  treemapMarkMode,
  tileForSlot,
  IDLE_STOP_ALL,
  idleStopCaption,
  chromeStacks,
  chromeBottomReserve,
  NARROW_BAND_SEED_PX,
  type AttnProject,
  type AttnThread,
  type Cell,
  type Status,
} from "./model";
import { THEME_CSS } from "./theme";
import { TokenFlowView } from "./TokenFlowView";
import { ThreadHoverCard, useCardSnippets, type CardSnippet, type HoverTarget } from "./HoverCard";
import { usePulseRates } from "./pulse";
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
/** The rect the opening fit and fit-button target: safe area plus gap. The
 * bottom margin comes from the caller: the desktop chrome's fixed figure, or
 * the stacked narrow-column band's measured height. */
const fitBox = (vw: number, vh: number, bottom: number = SAFE.bottom) => ({
  x: SAFE.left + GAP,
  y: SAFE.top + GAP,
  w: Math.max(1, vw - SAFE.left - SAFE.right - GAP * 2),
  h: Math.max(1, vh - SAFE.top - bottom - GAP * 2),
});
const ZOOM_MIN = 0.2; // zoom-out floor
const ZOOM_MAX = 5; // zoom-in ceiling
/** Relative tolerance for a restored camera's world dims: a world within 2%
 * of the one the camera was captured on is the same world (absorbs sub-pixel
 * drift); beyond it the roster changed shape and the fitted opening runs. */
const CAMERA_WORLD_TOL = 0.02;
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
  /**
   * Subscribe to camera changes (the treemap's label layer projects each
   * region through the live transform). Fires on mount and on every committed
   * transform; returns an unsubscribe.
   */
  subscribe: (cb: (cam: Cam) => void) => () => void;
  /**
   * Return to the regular fitted view: fit the camera and notify any view
   * state to clear (the treemap drops its project focus). This is what the
   * top-right close control and a background click both do.
   */
  resetView: () => void;
  /**
   * Pin the top-right close control visible regardless of camera scale. Views
   * that hold a linear "focused" state (the treemap's project focus) pin it so
   * the control appears whenever the operator is zoomed in OR focused.
   */
  setResetPinned: (on: boolean) => void;
  /** Subscribe to resetView requests; returns an unsubscribe. */
  onReset: (cb: () => void) => () => void;
};

/** The live screen→world camera (the map canvas transform). */
type Cam = { k: number; tx: number; ty: number };

/**
 * Mirror the map canvas's live camera into view state, so a view can gate its
 * affordances (dot actionability, the zoomed-in chrome) on the current scale.
 * Returns the opening camera until the canvas subscribes.
 */
function useCamera(apiRef: RefObject<MapApi | null>): Cam {
  const [cam, setCam] = useState<Cam>({ k: 1, tx: 0, ty: 0 });
  useEffect(() => {
    const api = apiRef.current;
    if (api === null) return;
    return api.subscribe(setCam);
  }, [apiRef]);
  return cam;
}

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
  safeBottom,
  children,
}: {
  world: WorldSize | null;
  apiRef: RefObject<MapApi | null>;
  /** Session key this canvas's camera persists under (the tab id). */
  persistKey?: string;
  /**
   * How much of the viewport's bottom the floating chrome can occupy: the
   * fit box keeps it clear. Defaults to the desktop chrome's fixed figure;
   * a narrow panel passes the stacked chrome band's measured height.
   */
  safeBottom?: number;
  children: ReactNode;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ k: 1, tx: 0, ty: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const sizeRef = useRef({ vw: 0, vh: 0 });
  const worldRef = useRef<WorldSize | null>(world);
  worldRef.current = world;
  /** The opening latch: while armed the opening auto-fits each world report;
   * the first operator interaction disarms it for good. */
  const latchRef = useRef<OpeningLatch>(ARMED_LATCH);
  /** Camera saved by a previous visit, consumed by the first world report. */
  const restoreRef = useRef<Camera | null>(persistKey === undefined ? null : storedCamera(persistKey));
  const dragRef = useRef<{ id: number; px: number; py: number; tx: number; ty: number; captured: boolean } | null>(null);
  const lastPanRef = useRef(0);
  const [panning, setPanning] = useState(false);
  /** Camera subscribers (the treemap's label layer). */
  const subsRef = useRef<Set<(cam: Cam) => void>>(new Set());
  /** Reset-view subscribers (views clear their focus state on demand). */
  const resetSubsRef = useRef<Set<() => void>>(new Set());
  /** View-pinned close-control visibility (the treemap's focus state). */
  const [resetPinned, setResetPinned] = useState(false);
  /** The prop mirrored into a ref: the callbacks read the current figure at
   * call time, so a band measurement that lands after mount corrects the fit
   * without wiring every callback to the prop. */
  const safeBottomRef = useRef<number>(safeBottom ?? SAFE.bottom);
  safeBottomRef.current = safeBottom ?? SAFE.bottom;

  /** The operator took the camera: stop the opening auto-fit permanently. */
  const ownCamera = useCallback(() => {
    latchRef.current = disarm(latchRef.current);
  }, []);

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
    ownCamera();
    const { vw, vh } = sizeRef.current;
    const sz = worldRef.current;
    if (sz === null || sz.W <= 0 || sz.H <= 0 || vw <= 0 || vh <= 0) return;
    // The opening fit never blows a small world up past legibility (1×) and
    // centers it inside the chrome-free fit box, not the raw viewport.
    const box = fitBox(vw, vh, safeBottomRef.current);
    const k = clampT(Math.min(box.w / sz.W, box.h / sz.H, 1), ZOOM_MIN, 1);
    applyT({
      k,
      tx: box.x + (box.w - sz.W * k) / 2,
      ty: box.y + (box.h - sz.H * k) / 2,
    });
  }, [applyT, ownCamera]);

  /** Return to the regular fitted view and let views clear their own state. */
  const resetView = useCallback(() => {
    fit();
    for (const cb of resetSubsRef.current) cb();
  }, [fit]);

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      ownCamera();
      const cur = tRef.current;
      const k2 = clampT(cur.k * factor, ZOOM_MIN, ZOOM_MAX);
      if (k2 === cur.k) return;
      applyT({
        k: k2,
        tx: cx - (cx - cur.tx) * (k2 / cur.k),
        ty: cy - (cy - cur.ty) * (k2 / cur.k),
      });
    },
    [applyT, ownCamera],
  );

  /** Zoom so a world rect fills the chrome-free fit box (treemap focus). */
  const openRect = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      ownCamera();
      const box = fitBox(sizeRef.current.vw, sizeRef.current.vh, safeBottomRef.current);
      if (box.w <= 1 || box.h <= 1) return;
      const { scale, tx, ty } = zoomToRect(rect, box.w, box.h, { pad: FOCUS_PAD, maxScale: ZOOM_MAX });
      applyT({ k: scale, tx: box.x + tx, ty: box.y + ty });
    },
    [applyT, ownCamera],
  );

  // Publish the imperative API for views (the treemap's zoom focus).
  // A layout effect: views' passive effects must see the API on first mount.
  useLayoutEffect(() => {
    const api = {
      fit,
      openRect,
      resetView,
      scale: () => tRef.current.k,
      subscribe: (cb: (cam: Cam) => void) => {
        subsRef.current.add(cb);
        cb(tRef.current);
        return () => {
          subsRef.current.delete(cb);
        };
      },
      onReset: (cb: () => void) => {
        resetSubsRef.current.add(cb);
        return () => {
          resetSubsRef.current.delete(cb);
        };
      },
      setResetPinned,
    };
    apiRef.current = api;
    return () => {
      if (apiRef.current === api) apiRef.current = null;
    };
  }, [apiRef, fit, openRect, resetView, setResetPinned]);

  // Fan every committed camera out to subscribers (the label layer). A layout
  // effect, so the layer re-projects in the same frame the world moves.
  useLayoutEffect(() => {
    for (const cb of subsRef.current) cb(t);
  }, [t]);

  // The opening: run on every world report while the latch is armed. The
  // panel's first world is its pre-measurement placeholder (MIN_STAGE_W wide),
  // so a fit computed then would latch off-centre; instead the opening
  // re-computes as the world settles, and the first operator interaction (pan,
  // wheel, ⤢, treemap focus) disarms it. A matching saved camera wins once and
  // disarms immediately.
  const applyOpening = useCallback(() => {
    const { vw, vh } = sizeRef.current;
    if (vw <= 0 || vh <= 0) return;
    const box = fitBox(vw, vh, safeBottomRef.current);
    const result = reportWorld(
      latchRef.current,
      worldRef.current,
      restoreRef.current,
      box,
      { minScale: ZOOM_MIN, tol: CAMERA_WORLD_TOL },
    );
    latchRef.current = result.latch; // a restored camera disarms here
    // A null opening means the latch is disarmed (nothing to do) or the world
    // is not yet usable; either way the saved camera is left for the real
    // world report, so only consume it when an opening actually resolved.
    if (result.opening === null) return;
    restoreRef.current = null;
    applyT({ k: result.opening.k, tx: result.opening.tx, ty: result.opening.ty });
  }, [applyT]);
  useLayoutEffect(applyOpening, [applyOpening, world]);

  // Write-through persistence: a committed transform lands in the session
  // store under this tab, stamped with the live world, so bb back-navigation
  // restores the last camera AND a later roster change can tell the saved
  // transform is stale. Gated on the operator owning the camera (the latch
  // disarmed by a pan, wheel, ⤢ or focus): the default opening and any
  // provisional pre-measurement fit are never recorded.
  useLayoutEffect(() => {
    const sz = worldRef.current;
    if (persistKey === undefined || latchRef.current.armed) return;
    if (sz === null || sz.W <= 0 || sz.H <= 0) return;
    writeCameraStore({ cams: { [persistKey]: { ...tRef.current, W: sz.W, H: sz.H } } });
  }, [persistKey, t]);

  // Measure the viewport and re-clamp the transform when it resizes.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const read = () => {
      sizeRef.current = { vw: view.clientWidth, vh: view.clientHeight };
      if (sizeRef.current.vw > 0 && sizeRef.current.vh > 0) applyOpening();
      else applyT({ ...tRef.current });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(view);
    return () => ro.disconnect();
  }, [applyT, applyOpening]);

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
    ownCamera(); // a real drag is the operator taking the camera
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
        {/* The close control: shown while the camera is past the zoomed-in
            threshold, or while a view pins it (the treemap's project focus).
            It returns to the fitted view, the same reset a background click
            does. Top-right, clear of the tab bar (top-left) and the corner
            controls (bottom-right). */}
        {isZoomedIn(t.k) || resetPinned ? (
          <button
            type="button"
            data-attn-reset=""
            onClick={resetView}
            title="Zoom out to the fitted view"
            aria-label="Zoom out to the fitted view"
            className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-card text-muted-foreground shadow-sm hover:text-foreground"
          >
            ✕
          </button>
        ) : null}
        <div data-attn-zoom-controls="" className="absolute bottom-3 right-3 z-20 flex gap-1">
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
              data-attn-control={label}
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

// ---------- hover card state (shared by all dot surfaces) ----------

/** What every dot surface needs to open the shared hover card and pulse. */
type DotWiring = {
  /** threadId → measured tokens/second (absent = not measurable yet). */
  pulseRates: ReturnType<typeof usePulseRates>;
  onHover: (thread: AttnThread, el: HTMLElement) => void;
  onHoverEnd: () => void;
};

/**
 * The operator's hover target, owned by the panel so one card serves every
 * view. Coordinates are captured from the dot's live rect relative to the
 * panel root: the world layer is camera-scaled, so world coordinates would be
 * wrong the moment the operator zooms.
 */
function useHoverCard(
  panelRef: RefObject<HTMLDivElement | null>,
  snippets: ReturnType<typeof useCardSnippets>,
): {
  target: HoverTarget | null;
  thread: AttnThread | null;
  snippet: CardSnippet | undefined;
  onHover: DotWiring["onHover"];
  onHoverEnd: DotWiring["onHoverEnd"];
} {
  const [hover, setHover] = useState<{ target: HoverTarget; thread: AttnThread } | null>(null);
  const onHover = (thread: AttnThread, el: HTMLElement) => {
    const panel = panelRef.current;
    if (panel === null) return;
    // Re-measure on every enter: the card must land on the dot as it is now,
    // not where it was when this handler was created.
    const dotRect = el.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    setHover({
      thread,
      target: {
        threadId: thread.id,
        title: threadTitle(thread),
        x: dotRect.left - panelRect.left,
        y: dotRect.top - panelRect.top,
        w: dotRect.width,
        h: dotRect.height,
      },
    });
    snippets.request(thread.id);
  };
  const onHoverEnd = () => setHover(null);
  return {
    target: hover?.target ?? null,
    thread: hover?.thread ?? null,
    // Tri-state: undefined while the fetch is in flight, null when the thread
    // has nothing to quote, the object once resolved.
    snippet: hover === null ? undefined : snippets.snippets.get(hover.target.threadId),
    onHover,
    onHoverEnd,
  };
}

/** World-space root of a view: the fixed-region layer the map pans/zooms. An
 * optional `onClick` fires for any click in the world that is NOT a thread
 * unit — the units stop propagation when actionable, so a background click
 * (a void, a card's padding) reaching here is the "click away" gesture. */
function Stage({
  w,
  contentH,
  onClick,
  children,
}: {
  w: number;
  contentH: number;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-attn-stage=""
      className="absolute left-0 top-0"
      style={{ width: w, height: Math.ceil(contentH) }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

function Dot({
  cell,
  x,
  y,
  d,
  nowMs,
  actionable = false,
  onOpen,
  pulseRate,
  onHover,
  onHoverEnd,
}: {
  cell: Cell;
  x: number;
  y: number;
  d: number;
  nowMs: number;
  /** Zoomed in: the dot is a control that opens its thread. */
  actionable?: boolean;
  /** Open this dot's thread (called only when actionable). */
  onOpen?: (id: string) => void;
  /** Measured burn (tok/s) for a working dot; null/absent = not measurable. */
  pulseRate?: number | null;
  /** Pointer entered this dot. */
  onHover?: (thread: AttnThread, el: HTMLElement) => void;
  /** Pointer left this dot (or the panel). */
  onHoverEnd?: () => void;
}) {
  const status = classify(cell.t);
  const working = status === "working";
  const open = () => onOpen?.(cell.t.id);
  // A working dot's blink period tracks its burn. Unmeasured keeps the base
  // pulse; a measured zero holds the slowest pulse (never a frozen dot).
  const period = working ? pulsePeriodMs(pulseRate ?? null) : null;
  return (
    <div
      data-attn-unit=""
      data-attn-mark="dot"
      data-thread-id={cell.t.id}
      data-attn-pulse={working ? (period === null ? "none" : String(Math.round(period))) : undefined}
      role={actionable ? "button" : undefined}
      tabIndex={actionable ? 0 : undefined}
      className={
        "rounded-full" +
        (actionable ? " cursor-pointer hover:ring-2 hover:ring-foreground/40" : "")
      }
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: d,
        height: d,
        background: cellColor(cell.t, nowMs),
        // The blink rides an inline animation so each dot carries its own
        // period; the keyframes live in the panel's style block.
        animation: period === null ? undefined : `attn-pulse ${period}ms ease-in-out infinite`,
      }}
      onPointerEnter={
        onHover === undefined
          ? undefined
          : (e) => {
              if (e.pointerType !== "mouse") return; // touch has no hover
              onHover(cell.t, e.currentTarget);
            }
      }
      onPointerLeave={onHoverEnd}
      onClick={
        actionable
          ? (e) => {
              // Opening the thread owns this click: stop it reaching the
              // region/void handler, which would otherwise toggle focus.
              e.stopPropagation();
              open();
            }
          : undefined
      }
      onKeyDown={
        actionable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                open();
              }
            }
          : undefined
      }
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
  apiRef,
  onOpenThread,
  wiring,
}: {
  data: SidebarData;
  nowMs: number;
  w: number;
  /** Fit-box height budget: shelves rescale to use it like the treemap. */
  h: number;
  onWorld: (s: WorldSize | null) => void;
  apiRef: RefObject<MapApi | null>;
  /** Open a thread (only wired while the board is zoomed in). */
  onOpenThread: (id: string) => void;
  /** Hover card + burn-rate pulse, shared with the other views. */
  wiring: DotWiring;
}) {
  const model = useMemo(() => {
    const { projects } = buildProjects(data.threads, data.projects, nowMs);
    // Fill the fit box the way the treemap fills its rect: solve for the
    // largest slot scale whose shelf pack still fits the chrome-free height,
    // then re-shelve at that scale. Capped at 2× so one or two projects don't
    // balloon into a poster; when even 1× overflows a very short panel the
    // floor stays at 1× (legibility beats filling). The opening camera then
    // lands at k = 1 — the board opens the same size the treemap does.
    const scale =
      h > 0
        ? fillScale((s) => shelfPack(makeCards(projects, P * s, LBL * s, BOARD_MIN_CARD_W * s), w, 14, 14).H, h, 2)
        : 1;
    const packed = shelfPack(makeCards(projects, P * scale, LBL * scale, BOARD_MIN_CARD_W * scale), w, 14, 14);
    return { packed, scale, world: worldOf(w, packed.H) };
  }, [data, nowMs, w, h]);
  useEffect(() => {
    onWorld(model.world);
  }, [model.world, onWorld]);
  const pitch = P * model.scale;
  const labelH = LBL * model.scale;
  const dot = DOT * model.scale;
  // Zoomed in, a dot opens its thread; a background (non-dot) click resets to
  // the fitted view. At the fit view dots stay inert.
  const cam = useCamera(apiRef);
  const zoomed = isZoomedIn(cam.k);
  return (
    <Stage
      w={w}
      contentH={model.packed.H}
      onClick={zoomed ? () => apiRef.current?.resetView() : undefined}
    >
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
                actionable={zoomed}
                onOpen={onOpenThread}
                pulseRate={wiring.pulseRates.get(cell.t.id)}
                onHover={wiring.onHover}
                onHoverEnd={wiring.onHoverEnd}
              />
            ))}
          </div>
        </div>
      ))}
    </Stage>
  );
}

// ---------- view 2: unit treemap (honest fill + zoom-to-project) ----------
/** Touch press-and-hold duration for the family-tint preview. */
const LONG_PRESS_MS = 400;
/** Corner radius of a full-fill tile (world px): softens the mosaic without
 * any stroke or seam work. */
const TILE_RADIUS = 2;

/**
 * The fitted-view treemap mark (treemapMarkMode's "tile"): the thread's status
 * color filling its slot minus a thin gutter. Inert by design — opening only
 * happens zoomed in — so its clicks fall through to the region's
 * zoom-into-project gesture, like an inert dot's did. Working tiles keep the
 * burn pulse; idle tiles keep the age-grey ramp through cellColor.
 */
function Tile({
  cell,
  x,
  y,
  w,
  h,
  nowMs,
  pulseRate,
  onHover,
  onHoverEnd,
}: {
  cell: Cell;
  x: number;
  y: number;
  w: number;
  h: number;
  nowMs: number;
  /** Measured burn (tok/s) for a working tile; null/absent = not measurable. */
  pulseRate?: number | null;
  /** Pointer entered this tile. */
  onHover?: (thread: AttnThread, el: HTMLElement) => void;
  /** Pointer left this tile (or the panel). */
  onHoverEnd?: () => void;
}) {
  const status = classify(cell.t);
  const period = status === "working" ? pulsePeriodMs(pulseRate ?? null) : null;
  return (
    <div
      data-attn-unit=""
      data-attn-mark="tile"
      data-thread-id={cell.t.id}
      data-attn-pulse={period === null ? undefined : String(Math.round(period))}
      className="absolute"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: TILE_RADIUS,
        background: cellColor(cell.t, nowMs),
        animation: period === null ? undefined : `attn-pulse ${period}ms ease-in-out infinite`,
      }}
      onPointerEnter={
        onHover === undefined
          ? undefined
          : (e) => {
              if (e.pointerType !== "mouse") return; // touch has no hover
              onHover(cell.t, e.currentTarget);
            }
      }
      onPointerLeave={onHoverEnd}
    />
  );
}

export function UnitTreemapView({
  data,
  nowMs,
  w,
  h,
  onWorld,
  apiRef,
  onOpenThread,
  wiring,
  idleStop = IDLE_STOP_ALL,
}: {
  data: SidebarData;
  nowMs: number;
  w: number;
  /** Height budget from the panel viewport, so the treemap fills the view. */
  h: number;
  onWorld: (s: WorldSize | null) => void;
  apiRef: RefObject<MapApi | null>;
  /** Open a thread (only wired while the treemap is zoomed in). */
  onOpenThread: (id: string) => void;
  /** Hover card + burn-rate pulse, shared with the other views. */
  wiring: DotWiring;
  /**
   * The idle-visibility slider's stop (OverviewPage owns the session state):
   * idle threads dimmer than this leave the layout entirely — the treemap
   * re-squarifies and every total re-scales to the visible set.
   */
  idleStop?: number;
}) {
  const world = useMemo(() => worldOf(w, h), [w, h]);
  useEffect(() => {
    onWorld(world);
  }, [world, onWorld]);
  const { projects } = useMemo(
    () => buildProjects(data.threads, data.projects, nowMs, { idleStop }),
    [data, nowMs, idleStop],
  );
  const model = useMemo(() => treemapLayout(projects, w, h), [projects, w, h]);

  // Focus: tapping a project dims the rest and zooms the board until the
  // project fills the fit box with its family tints locked on (family-derived
  // only, never status-derived). Tapping anything else — another project, a
  // void, the fit box — fits the zoomed-out world back out. The camera
  // itself stays with MapCanvas; the view only aims it.
  const [focusPid, setFocusPid] = useState<string | null>(null);
  // Hover (mouse) / press-and-hold (touch) family-tint preview target.
  const [hoverPid, setHoverPid] = useState<string | null>(null);
  // The live camera, mirrored here so the always-visible label layer can
  // project each region into screen space at a fixed size, and so a dot's
  // actionability tracks the current scale.
  const cam = useCamera(apiRef);
  const zoomed = isZoomedIn(cam.k);
  // Render mode of the treemap marks: full-fill tiles at/below the zoomed-in
  // threshold, dots past it (treemapMarkMode, single shared threshold).
  const tiles = treemapMarkMode(cam.k) === "tile";
  // A reset (the top-right close control or a background click) also clears
  // the project focus, so the view and the camera return together. While a
  // project is focused the close control is pinned visible even if the
  // project already filled the box at or below the zoomed-in threshold.
  useEffect(() => {
    const api = apiRef.current;
    if (api === null) return;
    api.setResetPinned(focusPid !== null);
    return api.onReset(() => {
      setFocusPid(null);
      setHoverPid(null);
    });
  }, [apiRef, focusPid]);
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

  // The always-visible title layer. Chips are projected into the chrome-free
  // fit box in screen space (never in the world layer), so a title keeps its
  // size and stays on screen at every zoom and pan; the placement pass seats
  // one chip per visible region with no overlap. Because boxes and labels are
  // both in view coordinates, the layer is unaffected by the camera scale.
  const box = { x: SAFE.left + GAP, y: SAFE.top + GAP, w, h };
  const labels = placeRegionLabels(
    model.regions.map((r) => ({ pid: r.p.pid, name: r.p.name, n: r.p.n, x: r.x, y: r.y, w: r.w, h: r.h })),
    cam,
    box,
    focusPid,
  );

  // Family tints are a zoomed-in affordance: the camera must be past the
  // zoomed-in threshold (a focused project keeps them regardless of scale).
  const zoomedIn = () => apiRef.current !== null && isZoomedIn(apiRef.current.scale());
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
          // Zoomed in, a click on a void is the "click away" gesture: back to
          // the regular fitted view (the same reset the close control does).
          if (zoomed || focusPid !== null) apiRef.current?.resetView();
        }}
      />
      {model.regions.map((r) => {
        const dim = focusPid !== null && focusPid !== r.p.pid;
        const tinted = focusPid === r.p.pid || hoverPid === r.p.pid;
        return (
          <div
            key={r.p.pid}
            data-attn-region={r.p.pid}
            title={`${r.p.name} · ${r.p.n} threads`}
            className="absolute overflow-hidden rounded-sm"
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              background: "var(--attn-card)",
              opacity: dim ? 0.3 : 1,
              // Zoomed in the region background is "away" (reset), so it is not
              // a pointer target; at the fit view it is the zoom-in gesture.
              cursor: zoomed ? "default" : "pointer",
              transition: "opacity 200ms ease",
            }}
            onClick={() => {
              // MapCanvas swallows clicks right after a pan; a held tap (the
              // touch peek) also never lands as a click.
              if (suppressTapRef.current) {
                suppressTapRef.current = false;
                return;
              }
              // Zoomed in, anything that is not a dot returns to the fitted
              // view (dots stop propagation, so they never reach here).
              if (zoomed || focusPid !== null) {
                apiRef.current?.resetView();
                return;
              }
              // From the regular view, a region click zooms INTO it (unchanged).
              setFocus(r.p.pid);
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
                      top: Math.floor(i / r.cols) * r.ch,
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
              // Tile mode (fitted view): the status color fills the slot.
              // Dot mode (zoomed in): the constant-size centered dot.
              if (tiles) {
                const tile = tileForSlot(r.cw, r.ch, model.pitch);
                return (
                  <Tile
                    key={cell.t.id}
                    cell={cell}
                    x={j * r.cw + tile.dx}
                    y={k * r.ch + tile.dy}
                    w={tile.w}
                    h={tile.h}
                    nowMs={nowMs}
                    pulseRate={wiring.pulseRates.get(cell.t.id)}
                    onHover={wiring.onHover}
                    onHoverEnd={wiring.onHoverEnd}
                  />
                );
              }
              return (
                <Dot
                  key={cell.t.id}
                  cell={cell}
                  x={(j + 0.5) * r.cw - model.d / 2}
                  y={(k + 0.5) * r.ch - model.d / 2}
                  d={model.d}
                  nowMs={nowMs}
                  actionable={zoomed}
                  onOpen={onOpenThread}
                  pulseRate={wiring.pulseRates.get(cell.t.id)}
                  onHover={wiring.onHover}
                  onHoverEnd={wiring.onHoverEnd}
                />
              );
            })}
          </div>
        );
      })}
      {/* The always-visible title layer. Each chip is rendered counter-scaled
          (scale 1/k about its own top-left) at its screen-space position, so
          it keeps a constant size and never shrinks away with the camera; the
          placement pass seats one chip per visible region with no overlap. */}
      {cam.k > 0
        ? labels.map((l) => (
            <div
              key={`lbl-${l.pid}`}
              className="pointer-events-none absolute truncate"
              title={`${l.name} · ${l.n}`}
              style={{
                left: (l.x - cam.tx) / cam.k,
                top: (l.y - cam.ty) / cam.k,
                width: l.w,
                height: l.h,
                transform: `scale(${1 / cam.k})`,
                transformOrigin: "0 0",
                fontSize: 10,
                lineHeight: `${l.h}px`,
                color: "var(--attn-label)",
                background: "var(--attn-card)",
                opacity: l.dimmed ? 0.3 : 1,
                zIndex: 3,
              }}
            >
              {l.name} · {l.n}
            </div>
          ))
        : null}
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
  apiRef,
  onOpenThread,
  wiring,
}: {
  data: SidebarData;
  nowMs: number;
  w: number;
  /** Fit-box height budget: tiles rescale to use it like the treemap. */
  h: number;
  onWorld: (s: WorldSize | null) => void;
  apiRef: RefObject<MapApi | null>;
  /** Open a thread (only wired while the tiles are zoomed in). */
  onOpenThread: (id: string) => void;
  /** Hover card + burn-rate pulse, shared with the other views. */
  wiring: DotWiring;
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
  // Zoomed in, a unit opens its thread; a click away (a tile's padding, the
  // gap between strips) resets to the fitted view. At the fit view units are
  // inert.
  const cam = useCamera(apiRef);
  const zoomed = isZoomedIn(cam.k);
  return (
    <Stage
      w={w}
      contentH={model.packed.H}
      onClick={zoomed ? () => apiRef.current?.resetView() : undefined}
    >
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
            {card.units.map((cell) => {
              const status = classify(cell.t);
              const period = status === "working" ? pulsePeriodMs(wiring.pulseRates.get(cell.t.id) ?? null) : null;
              return (
                <div
                  key={cell.t.id}
                  data-attn-unit=""
                  data-thread-id={cell.t.id}
                  data-attn-pulse={period === null ? undefined : String(Math.round(period))}
                  role={zoomed ? "button" : undefined}
                  tabIndex={zoomed ? 0 : undefined}
                  className={"rounded-sm" + (zoomed ? " cursor-pointer hover:ring-2 hover:ring-foreground/40" : "")}
                  style={{
                    width: 4 * scale,
                    height: 12 * scale,
                    marginRight: scale,
                    background: cellColor(cell.t, nowMs),
                    animation: period === null ? undefined : `attn-pulse ${period}ms ease-in-out infinite`,
                  }}
                  onPointerEnter={
                    wiring.onHover === undefined
                      ? undefined
                      : (e) => {
                          if (e.pointerType !== "mouse") return;
                          wiring.onHover(cell.t, e.currentTarget);
                        }
                  }
                  onPointerLeave={wiring.onHoverEnd}
                  onClick={
                    zoomed
                      ? (e) => {
                          e.stopPropagation();
                          onOpenThread(cell.t.id);
                        }
                      : undefined
                  }
                  onKeyDown={
                    zoomed
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onOpenThread(cell.t.id);
                          }
                        }
                      : undefined
                  }
                />
              );
            })}
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
  { id: "tokenflow", label: "Token flow" },
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

/**
 * The treemap's idle-visibility slider card, shared by both chrome layouts.
 * Stops are keyed to the grey ramp (`IDLE_STOP_ALL` = every idle thread shown,
 * the default; 0 = none); sliding down hides the dimmest (oldest) idle
 * threads first, session state, never persisted (`idleVisible` in
 * views/model.ts). `stacked` seats the card in the narrow chrome's bottom
 * column: the row stretches, the track grows a touch height, and the caption
 * holds its ground instead of riding the card's width.
 */
function IdleSliderCard({
  stop,
  onSlide,
  stacked = false,
}: {
  stop: number;
  onSlide: (stop: number) => void;
  stacked?: boolean;
}) {
  return (
    <div
      data-attn-idle-slider=""
      className={
        (stacked ? "" : "absolute bottom-[52px] right-3 z-40 ") +
        "pointer-events-auto rounded-md border border-border/60 bg-card px-3 py-2 shadow-sm"
      }
    >
      <div className="mb-1 text-[10px] text-muted-foreground">Idle threads</div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={IDLE_STOP_ALL}
          step={1}
          value={stop}
          onChange={(e) => onSlide(Number(e.target.value))}
          aria-label="Idle thread visibility"
          aria-valuetext={idleStopCaption(stop)}
          title="How much of the idle age range the treemap represents"
          className={stacked ? "min-w-0 flex-1 cursor-pointer" : undefined}
          style={stacked ? { height: 28, accentColor: "var(--attn-working)" } : { width: 120, accentColor: "var(--attn-working)" }}
        />
        <span
          className={(stacked ? "shrink-0 " : "") + "text-[10px] text-muted-foreground"}
          data-attn-idle-slider-caption=""
        >
          {idleStopCaption(stop)}
        </span>
      </div>
    </div>
  );
}

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
  // The treemap's idle-visibility slider: session state (like the cameras'
  // pre-persistence days), never persisted — a fresh panel opens showing every
  // idle thread. Owned here so the shared legend's counts re-scale with the
  // treemap's visible set while the tab is active.
  const [idleStop, setIdleStop] = useState<number>(IDLE_STOP_ALL);
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
    // Dedupe by value: a view whose memo re-runs on every render (the Board
    // recomputes its model against a fresh Date.now()) reports a new-but-equal
    // bounds object each pass. Committing it unconditionally re-renders the
    // page, which re-runs the view, which reports again — an update loop. Only
    // a real change in the world bounds needs to reach the canvas.
    setWorld((prev) =>
      prev !== null && size !== null && prev.W === size.W && prev.H === size.H ? prev : size,
    );
  }, []);
  const apiRef = useRef<MapApi | null>(null);
  // Clicking a thread unit while zoomed in opens that thread in bb's default
  // view (the SDK's real navigate hook; the screenshot mock records calls).
  const nav = useBbNavigate();
  const openThread = useCallback((id: string) => nav.toThread(id), [nav]);
  // Panel viewport: views pack to its width; the treemap fills its height.
  const [panelRef, vw, vh] = usePanelSize(MIN_STAGE_W);
  // Floating chrome at narrow widths (phones, narrow desktop sidebars): the
  // desktop floating bands — legend bottom-left, the treemap's slider above
  // the zoom controls — meet and the legend paints over the slider's track,
  // so below the threshold the chrome stacks into one bottom column and the
  // map's fit reserves the column's real measured height.
  const narrow = chromeStacks(vw);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const [bandH, setBandH] = useState<number>(NARROW_BAND_SEED_PX);
  useLayoutEffect(() => {
    // The column only exists while stacked (the ref binds to it in that
    // branch), so a flip between layouts just disconnects the observer.
    const el = bandRef.current;
    if (el === null || !narrow) return;
    const read = () => {
      if (el.clientHeight > 0) setBandH(Math.ceil(el.clientHeight));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow]);
  // Hover card and burn-rate pulse: one card and one rate feed serve every
  // view, so a dot behaves identically in the board, treemap, and tiles.
  const snippets = useCardSnippets();
  const pulseRates = usePulseRates();
  const hover = useHoverCard(panelRef, snippets);
  const wiring: DotWiring = useMemo(
    () => ({ pulseRates, onHover: hover.onHover, onHoverEnd: hover.onHoverEnd }),
    [pulseRates, hover.onHover, hover.onHoverEnd],
  );
  // The panel's pre-measurement size (w = MIN_STAGE_W, h = 0) must never reach
  // a view: a world packed to it is the off-centre fit the operator saw. Mount
  // the canvas only once the panel has a real height. The measuring layout
  // effect runs before paint, so this gate is synchronous — no flash.
  const measured = vh > 0;
  // The bottom chrome's reservation: the desktop figure, or — while the chrome
  // stacks (narrow, and the panel is measured so the column exists) — the
  // stacked column's real height above the zoom band, never below the desktop
  // figure (the seed bounds the pre-measurement frame; the column's observer
  // corrects it within the first frame).
  const safeBottom =
    narrow && measured
      ? Math.max(SAFE.bottom, chromeBottomReserve(bandH, GAP))
      : SAFE.bottom;
  const w = Math.max(MIN_STAGE_W, vw - SAFE.left - GAP - SAFE.right - GAP);
  const hBudget = Math.max(200, vh - SAFE.top - GAP - safeBottom - GAP);
  if (live.state === "loading") {
    return <p className="p-4 text-sm text-muted-foreground">Loading threads…</p>;
  }
  if (live.state === "error" || live.data === null) {
    return <p className="p-4 text-sm text-muted-foreground">Could not read thread data.</p>;
  }
  const nowMs = Date.now();
  // The legend describes what the active view shows: on the treemap tab that
  // is the idle-visibility slider's visible set, everywhere else the whole
  // roster (the other views have no idle gate).
  const built = buildProjects(
    live.data.threads,
    live.data.projects,
    nowMs,
    tab === "treemap" ? { idleStop } : undefined,
  );
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
          // Dots carry their own period inline (the burn-rate pulse), so the
          // class keeps the fixed 2.2s blink for the What's-new button only.
          "\n.attn-pulse { animation: attn-pulse 2.2s ease-in-out infinite; } @keyframes attn-pulse { 50% { opacity: 0.55; } } @keyframes attn-spin { to { transform: rotate(360deg); } }"}
      </style>
      {tab === "tokenflow" ? (
        <TokenFlowView />
      ) : measured ? (
        <MapCanvas key={tab} world={world ?? worldCache.current.get(tab) ?? null} apiRef={apiRef} persistKey={tab} safeBottom={safeBottom}>
          {tab === "board" ? <BoardView data={live.data} nowMs={nowMs} w={w} h={hBudget} onWorld={onWorld} apiRef={apiRef} onOpenThread={openThread} wiring={wiring} /> : null}
          {tab === "treemap" ? <UnitTreemapView data={live.data} nowMs={nowMs} w={w} h={hBudget} onWorld={onWorld} apiRef={apiRef} onOpenThread={openThread} wiring={wiring} idleStop={idleStop} /> : null}
          {tab === "tiles" ? <StripTilesView data={live.data} nowMs={nowMs} w={w} h={hBudget} onWorld={onWorld} apiRef={apiRef} onOpenThread={openThread} wiring={wiring} /> : null}
        </MapCanvas>
      ) : null}
      {/* The hover card lives above the canvas (portal on the panel root), so
          the camera never scales it and no view can clip it. */}
      {hover.target !== null && hover.thread !== null ? (
        <ThreadHoverCard
          target={hover.target}
          snippet={hover.snippet}
          status={classify(hover.thread)}
          age={ageLabel(hover.thread, nowMs)}
          panel={{ w: vw, h: vh }}
          root={panelRef.current}
        />
      ) : null}
      <div className="absolute left-3 top-3 z-40 flex max-w-[calc(100%_-_1.5rem)] flex-col items-start gap-2">
        <div data-attn-tabbar="" className="pointer-events-auto flex gap-1 rounded-md border border-border/60 bg-card p-1 shadow-sm">
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
      {/* The floating chrome. At narrow widths (phones, narrow sidebars) the
          bands — legend, the treemap's idle slider — meet the zoom controls
          and the legend paints over the slider's track, so the chrome stacks
          into one bottom column with the slider reachable and nothing riding
          under it; at desktop widths the classic floating layout is
          unchanged. */}
      {narrow ? (
        <div
          data-attn-chrome-column=""
          ref={bandRef}
          className="pointer-events-none absolute inset-x-3 bottom-[52px] z-40 flex flex-col gap-2"
        >
          {tab !== "tokenflow" ? (
            <div
              data-attn-legend=""
              className="pointer-events-none rounded-md border border-border/60 bg-card px-3 py-2 shadow-sm text-muted-foreground"
            >
              <LegendRow counts={counts} />
              <p className="mt-1 text-[10px] text-muted-foreground">
                one dot = one thread · {total} visible · color = status, volume = count · drag to pan, scroll to zoom
              </p>
            </div>
          ) : null}
          {tab === "treemap" ? <IdleSliderCard stacked stop={idleStop} onSlide={setIdleStop} /> : null}
        </div>
      ) : null}
      {!narrow ? (
        tab === "treemap" ? (
          <IdleSliderCard stop={idleStop} onSlide={setIdleStop} />
        ) : null
      ) : null}
      {!narrow && tab !== "tokenflow" ? (
        <div
          data-attn-legend=""
          className="pointer-events-none absolute bottom-3 left-3 z-40 max-w-[420px] rounded-md border border-border/60 bg-card px-3 py-2 shadow-sm"
        >
          <LegendRow counts={counts} />
          <p className="mt-1 text-[10px] text-muted-foreground">
            one dot = one thread · {total} visible · color = status, volume = count · drag to pan, scroll to zoom
          </p>
        </div>
      ) : null}
    </div>
  );
}
