# C4 components (frontend)

- `AttentionPage` — tabs (Board / Unit treemap / Strip tiles), legend, counts.
- `BoardView` — fixed-slot cards, shelf-packed tallest-first at slot pitch 13px.
- `UnitTreemapView` — squarify regions weighted by visible thread count; constant-pitch dot fill; neutral region fill; labels only where they fit.
- `StripTilesView` — flow-wrapped tiles of 4px-per-thread strips, hottest left.
- `views/model.ts` — classification needs-you > error > working > unread > idle; grey age ramp; `buildProjects`; `squarify`; `makeCards`; `shelfPack`.
