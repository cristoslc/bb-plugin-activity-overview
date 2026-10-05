// bb-plugin-activity-overview — frontend entry.
// Compiled by `bb plugin build` into dist/app.js + dist/app.css. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time (never
// bundled), so this file must be loaded by BB, not imported directly.
//
// One sidebar nav panel ("Activity Overview") with an internal tab bar carrying the
// four views: Board (fixed-slot cards), Unit treemap (honest fill), Strip
// tiles, and Agent lanes (edge-less thread-family tree). All views render
// from the host's live sidebar thread data.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { OverviewPage } from "./views/Views";

// bb's built-in icon set has no "Activity" glyph, so the host falls back to the
// generic plugin icon (the lightning bolt). Register a heartbeat/pulse line
// under a namespaced name — a registered name resolves anywhere a BbIconName is
// accepted, including this plugin's nav panel registration.
const PULSE_ICON_NAME = "activity-overview/pulse";

const PulseIcon = ({ className }: { className?: string }) => (
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
    <path d="M22 12h-4l-3 9L9 6l-3 9H2" />
  </svg>
);

export default definePluginApp((app) => {
  app.experimental_icons.register({
    name: PULSE_ICON_NAME,
    component: PulseIcon,
  });
  app.slots.navPanel({
    id: "board",
    title: "Activity Overview",
    icon: PULSE_ICON_NAME,
    // Routed at /plugins/activity-overview/board
    path: "board",
    component: OverviewPage,
  });
});