// bb-plugin-activity-overview — frontend entry.
// Compiled by `bb plugin build` into dist/app.js + dist/app.css. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time (never
// bundled), so this file must be loaded by BB, not imported directly.
//
// One sidebar nav panel ("Activity Overview") with an internal tab bar carrying the
// three views: Board (fixed-slot cards), Unit treemap (honest fill), and
// Strip tiles. All views render from the host's live sidebar thread data.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { OverviewPage } from "./views/Views";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "board",
    title: "Activity Overview",
    icon: "Activity",
    // Routed at /plugins/activity-overview/board
    path: "board",
    component: OverviewPage,
  });
});