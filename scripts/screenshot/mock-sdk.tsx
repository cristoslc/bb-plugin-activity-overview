/**
 * Stand-in for `@get-bb/plugin-sdk/app`, used only by the screenshot/UAT
 * harness (vite aliases the SDK specifier to this module). The real app code
 * (app.tsx + views/) renders unmodified against simulated host data and a
 * controllable-RPC client.
 *
 * Styling here uses inline styles exclusively: dist/app.css is the plugin's
 * compiled Tailwind output and only contains classes the plugin's own source
 * uses, so utility classes invented here would silently not exist — the
 * exact failure mode the throbber UAT guards against.
 */
import { createRoot, type Root } from "react-dom/client";
import type { ComponentType } from "react";
import { SHAPE_DELAY_MS, SIM_PROJECTS, SIM_SHAPE, SIM_THREADS } from "./fixture";

/** ?sideDelay= — how long the sidebar data stalls in "loading" before ready. */
const SIDE_DELAY_MS = Math.max(
  0,
  Number(new URLSearchParams(window.location.search).get("sideDelay") ?? "0") || 0,
);

export const registeredNavPanel: {
  path?: string;
  component?: ComponentType<{ subPath?: string }>;
} = {};

export function definePluginApp(setup: (app: unknown) => void): unknown {
  setup({
    // Brand-icon registration (app.tsx's pulse icon): no host surface renders
    // icons in the harness, so accept and drop it.
    experimental_icons: {
      register: (_registration: { name: string; component: ComponentType }) => undefined,
    },
    slots: {
      navPanel: (config: { path: string; component: ComponentType<{ subPath?: string }> }) => {
        registeredNavPanel.path = config.path;
        registeredNavPanel.component = config.component;
      },
    },
  });
  return { id: "activity-overview-mock" };
}

let mockRoot: Root | null = null;
const rerender = () => {
  const Component = registeredNavPanel.component;
  const rootElement = document.getElementById("root");
  if (!Component || !rootElement) throw new Error("harness: panel/root missing");
  if (mockRoot === null) mockRoot = createRoot(rootElement);
  mockRoot.render(<Component subPath="" />);
};

/** Mount (once) the panel the app registered, as the host would — inside the host's data-bb-plugin scope, which the compiled tailwind selectors require. */
export function mountRegisteredPanel(): void {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("harness: panel/root missing");
  let scope = rootElement.querySelector(":scope > [data-bb-plugin]");
  if (scope === null) {
    scope = document.createElement("div");
    scope.setAttribute("data-bb-plugin", "activity-overview");
    scope.style.cssText = "width:100%;height:100%";
    rootElement.replaceChildren(scope);
  }
  if (mockRoot === null) mockRoot = createRoot(scope);
  rerender();
}

/** Sidebar data: instantly ready, or stalled in "loading" for ?sideDelay=. */
let sideState: { status: string; ready: boolean } = { status: "ready", ready: true };
if (SIDE_DELAY_MS > 0) {
  sideState = { status: "loading", ready: false };
  setTimeout(() => {
    sideState = { status: "ready", ready: true };
    window.__profile?.mark("mock-sidebar-ready");
    rerender();
  }, SIDE_DELAY_MS);
}

export function experimental_useSidebarThreads(): unknown {
  return sideState.ready
    ? {
        status: "ready",
        threads: SIM_THREADS,
        projects: SIM_PROJECTS,
        experimental_archived: null,
      }
    : { status: "loading" };
}

export function useBbNavigate(): unknown {
  return {
    toThread: () => {},
    toPluginPanel: () => false,
  };
}

/**
 * One stable client across renders (the real host's client is stable; a
 * per-render object feeds set-of-deps effect loops). The `shape` call stalls
 * for `?shapeDelay=` milliseconds before resolving the fixture — the lever
 * the throbber UAT pulls to open a loading window it can assert inside.
 */
const rpcClient = {
  call: async (method: string, _args: unknown): Promise<unknown> => {
    if (method !== "shape") throw new Error(`mock rpc: unknown method ${method}`);
    if (SHAPE_DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, SHAPE_DELAY_MS));
    window.__profile?.mark("mock-shape-resolved");
    return SIM_SHAPE;
  },
};

export function useRpc<T>(): T {
  return rpcClient as unknown as T;
}

/** The plugin subscribes to SHAPE_CHANGED pushes; the mock never pushes. */
export function useRealtime(_event: string, _callback: (payload: never) => void): void {
  // No-op: subscriptions are accepted and dropped, like the host's socket.
}