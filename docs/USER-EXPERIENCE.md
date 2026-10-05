# User experience

- The panel is one glance surface: legend (status colors + counts), one line of framing, then the tabbed stage.
- All four aggregate views share the encoding contract: one dot = one thread, color = status, volume = count; idle dots fade with age.
- Every dot and unit is hoverable (native title tooltip): thread title, status, age.
- Dominance is emergent; containers stay neutral (dark fills, thin voids), no strokes.
- Views reflow to the panel width: card shelves, treemap and strip tiles all pack into the measured available stage width (never narrower than 320px); a one-dot board card is at least 120px wide so project names stay readable.
- The Activity flow is the dive surface: a horizontal tidy tree (Agent
  Graph style) over project → thread → turn → work. Node cards sit in depth
  columns with dashed bezier connectors; projects open by default; hot
  threads (running/waiting/queued/error) expand to their turns; idle threads
  stay collapsed but keep their card. Expanding a turn shows its newest
  8 work rows with a "+N earlier steps" card above them when the server
  trimmed more (click to unfold); turns beyond the cap show "+N earlier
  turns". Click a node for details in the footer; double-click a thread to
  open it.
- Flow depth is scope-gated: at top scope, projects expand to thread rows
  only — turn and step chevrons do not exist until you focus a project or
  thread (click its card; the breadcrumb "All / project / thread" climbs
  back out; clicking the focused card steps up one level). Status filters
  live in the footer legend: the counts (running / waiting / error / queued /
  idle) are solo chips — click a status to see only it, click again to show
  all — and "Active only" is the quick idle-excluding preset (on by default;
  a scoped node always stays visible even when its status is filtered out).
- The Activity flow reads the plugin's own `shape` RPC (server-side turn
  timelines), refreshed by a coalesced `thread:changed` realtime push and a
  15s heartbeat while visible. The flow's status colors keep the same
  five-hue contract: running pulses blue, waiting/error reuse the dot
  palette, the rest age in greys.
