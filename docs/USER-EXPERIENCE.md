# User experience

- The panel is one glance surface: legend (status colors + counts), one line of framing, then the tabbed stage.
- All three aggregate views share the encoding contract: one dot = one thread, color = status, volume = count; idle dots fade with age. The Unit treemap renders that contract as full-fill status tiles at the fitted view and as constant-size dots once zoomed in past the shared 1.2× threshold — one mark per thread either way.
- The Unit treemap's idle-visibility slider keys to the grey ramp: the default stop shows every idle thread, one stop sits below per shade, and the bottom stop shows none — the dimmest (oldest) idle threads hide first, hidden threads leave the layout (re-squarified, totals re-scaled), and hot threads are never hidden.
- Every dot and unit is hoverable: a card shows the full thread title, status, age, and a snippet from the end of the conversation (or a plain "no conversation yet").
- Dominance is emergent; containers stay neutral (dark fills, thin voids), no strokes.
- Views reflow to the panel width: card shelves, treemap and strip tiles all pack into the measured available stage width (never narrower than 320px); a one-dot board card is at least 120px wide so project names stay readable.
