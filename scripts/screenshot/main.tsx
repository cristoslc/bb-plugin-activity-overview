/**
 * Screenshot/UAT harness entry: mounts the real plugin app (app.tsx) against
 * the mocked SDK, seeds persisted state from the query string, and installs
 * the paint-profiling hooks the UAT runner reads.
 */
import "../../dist/app.css";
import "../../app";
import { mountRegisteredPanel } from "./mock-sdk";

interface Profile {
  mark: (name: string) => void;
  read: () => {
    marks: Record<string, number>;
    paint: { name: string; startTime: number }[];
    longtasks: { startTime: number; duration: number }[];
  };
  watch: (selectors: string[]) => void;
}

declare global {
  interface Window {
    __profile?: Profile;
  }
}

// Seed persisted state BEFORE the app's useState initializers read it (they
// run at render time below).
const params = new URLSearchParams(window.location.search);
// `?tab=flow` restores the flow tab (the camera store's persisted last tab);
// `?cams=` is the JSON `cams` document to seed alongside it.
const storedTab = params.get("tab");
const storedCams = params.get("cams");
if (storedTab !== null || storedCams !== null) {
  window.sessionStorage.setItem(
    "activity-overview:camera",
    JSON.stringify({ tab: storedTab ?? "board", cams: storedCams === null ? {} : JSON.parse(storedCams) }),
  );
} else {
  window.sessionStorage.removeItem("activity-overview:camera");
}

const marks: Record<string, number> = {};
const longtasks: { startTime: number; duration: number }[] = [];
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longtasks.push({ startTime: entry.startTime, duration: entry.duration });
    }
  }).observe({ entryTypes: ["longtask"] });
} catch {
  // longtask timing unsupported: the marks and paint entries still hold.
}

window.__profile = {
  mark(name) {
    performance.mark(`uat:${name}`);
    marks[name] = performance.now();
  },
  read: () => ({
    marks: { ...marks },
    paint: performance
      .getEntriesByType("paint")
      .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
    longtasks: [...longtasks],
  }),
  // Appearance watcher: record a performance timestamp the first time each
  // selector matches (and when a seen selector stops matching, once — marked
  // with a "gone:" prefix). The runner times the spinner's window with this.
  watch(selectors) {
    const states: Record<string, boolean> = {};
    const scan = () => {
      for (const selector of selectors) {
        const present = document.querySelector(selector) !== null;
        if (present === states[selector]) continue;
        states[selector] = present;
        window.__profile?.mark(`${present ? "appear" : "gone"}:[${selector}]`);
      }
    };
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    scan();
  },
};

mountRegisteredPanel();