# User experience

- The panel is one glance surface: legend (status colors + counts), one line of framing, then the tabbed stage.
- All four aggregate views share the encoding contract: one dot = one thread, color = status, volume = count; idle dots fade with age.
- Every dot and unit is hoverable (native title tooltip): thread title, status, age.
- Dominance is emergent; containers stay neutral (dark fills, thin voids), no strokes.
- Views reflow to the panel width: card shelves, treemap and strip tiles all pack into the measured available stage width (never narrower than 320px); a one-dot board card is at least 120px wide so project names stay readable.
- The fifth tab, Activity flow, is the dive surface: project cards list thread rows (dot = status, title, since-last-update age), and folds walk project → thread → turn → work. Projects open by default; hot threads (running/waiting/queued/error) expand to their turns (newest first); idle threads stay collapsed but still show their row and age; "Hide idle" (on by default) clears idle rows entirely. Expanding a turn reveals its newest 8 work rows with "+N earlier steps" above them when the server trimmed more. Click a thread row to open the thread.
- The Activity flow reads the plugin's own `shape` RPC (server-side turn timelines), refreshed by a coalesced `thread:changed` realtime push and a 15s heartbeat while visible. The flow's status colors keep the same five-hue contract: running pulses blue, waiting/error reuse the dot palette, the rest age in greys.
