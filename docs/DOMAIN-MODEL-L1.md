# Domain model L1

## Ubiquitous language (glossary)

- **Status light (dot)** — one visible thread rendered as one dot. Its color is the thread status; the number of dots is the thread count.
- **Status** — needs-you (thread awaits interaction), error, working (active), unread (attention newer than last read), idle (rest, aging by recency).
- **Family** — a parent thread plus its visible children, grouped so children sit adjacent to their parent.
- **Project island** — all lights of one project.
- **Dominance (emergent)** — project health read from the pattern of dot colors; never painted on containers.

## Business rules

- The classification is fixed-priority: needs-you > error > working > unread > idle.
- One thread = exactly one visual unit in every view; thread weights never scale area.
- Idle lights gray out with age; hue is reserved for status.
- Project containers carry no health color of their own (contrast with the rejected "status-dominant treemap").
