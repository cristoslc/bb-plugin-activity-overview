# User experience

- The panel is one glance surface: legend (status colors + counts), one line of framing, then the tabbed stage.
- Every dot board floats the same four-layer control surface: choose rendering (the tab bar), choose filters (the shared filters card — idle-visibility slider plus project filter, one shared stop and query across the Board, Unit treemap, and Strip tiles), render-specific controls (the zoom band), then the rendering itself. Token flow keeps its own toolbar; its filter input binds the shared query.
- All three aggregate views share the encoding contract: one dot = one thread, color = status, volume = count; idle dots fade with age. The Unit treemap renders that contract as full-fill status tiles at the fitted view and as constant-size dots once zoomed in past the shared 1.2× threshold — one mark per thread either way.
- The dot boards' idle-visibility slider keys to named duration bounds: the ticks read No idle → <8 h → <24 h → <7 d → <30 d → <90 d → All Idle, an intermediate tick shows the idle threads under its bound, the dimmest (oldest) hide first, hidden threads leave the layout (re-packed, totals re-scaled), and hot threads are never hidden. The project filter beside it matches a project's name or id; a miss vanishes whole.
- Every dot and unit is hoverable: a card shows the full thread title, status, age, and a snippet from the end of the conversation (or a plain "no conversation yet").
- Dominance is emergent; containers stay neutral (dark fills, thin voids), no strokes.
- Views reflow to the panel width: card shelves, treemap and strip tiles all pack into the measured available stage width (never narrower than 320px); a one-dot board card is at least 120px wide so project names stay readable.
