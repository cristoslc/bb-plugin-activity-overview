# Domain model L2

Entity: Thread (id, projectId, parentThreadId, status fields, attention timestamps). Value object: Classification (fixed priority order, pure function). Aggregate: ProjectModel — cells (ordered family runs: roots attention-ascending, each followed by its children attention-ascending), best (min attentionScore), hot (non-idle count). Invariants: one cell per visible thread; archived threads excluded; children never precede their parent within a project.

View-specific value objects: CardSpec (cols, rows, w, h), Rect (squarify output), Placed (shelfpack output). Layout functions are pure and unit-tested (tests/model.test.ts).
