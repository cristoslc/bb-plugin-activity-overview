# ADR 0001 — dot as status light, containers neutral

Date: 2026-10-04. Status: accepted.

## Context
Iterations on the attention encoding (HTML prototypes in the commissioning thread) showed line-work (seams, outlines, borders) obscures status colors, and pre-painting containers with the worst status hides the information the dots already carry.

## Decision
One thread = one dot. Color = status, volume = count. Idle fades with age via a grey ramp. Containers (cards, regions, tiles) get neutral dark fills and separate by proximity/voids only; no seams, no outlines, no status-tinted containers.

## Consequences
+ Status colors read unobstructed at any scale.
+ Encodings stay interchangeable (same model, three views).
- Project membership is weaker than with borders; mitigated by card labels, region fills, and shelf grouping.
