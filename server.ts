// bb-plugin-activity-overview — backend entry.
//
// The four views (Board, Unit treemap, Strip tiles, Agent lanes) are entirely
// frontend-rendered from the host's live sidebar thread data, so the backend
// owns no state. It exists only to make the package loadable (bb.server is
// required) and to log lifecycle.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("activity-overview plugin loaded (views are client-rendered)");
  bb.onDispose(() => {
    bb.log.info("activity-overview plugin disposed");
  });
}