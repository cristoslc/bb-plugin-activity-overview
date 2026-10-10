// bb-plugin-activity-overview — backend entry.
//
// The three aggregate views (Board, Unit treemap, Strip tiles) are entirely
// frontend-rendered from the host's live sidebar thread data, so the backend
// owns no state: this stub only proves the plugin loaded. The manifest must
// still declare a server entry (`bb plugin build` requires it).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("activity-overview plugin loaded (frontend-only; no RPCs)");
}