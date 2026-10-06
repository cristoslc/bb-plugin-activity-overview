// Theme tokens for the views. One CSS string, two blocks, in the same
// convention bb's own theme.css files use: light values first (the default),
// dark values under a `.dark` ancestor (bb tags its app root with it —
// `.attn-theme.dark` also covers a wrapper tagged directly).
//
// Ink, surface and line tokens derive from bb's own CSS custom properties with
// standalone fallbacks, so custom bb themes recolor these views for free. The
// idle age ramp mixes the muted ink color into the stage color, which keeps
// ADR-0001's "age through brightness" fade theme-relative: fresh idle dots are
// strong muted ink, old ones fade toward whatever their stage resolves to,
// in either mode, without extra hues.

export const THEME_CSS = `
.attn-theme {
  /* surfaces (bb tokens, light fallbacks) */
  --attn-stage: var(--surface-recessed-solid, #f3f5f8);
  --attn-card: var(--card, #ffffff);
  --attn-card-border: var(--border, #e2e6ec);
  --attn-selected: var(--surface-selected, #eef4fc);
  --attn-selected-border: var(--ring, #7aa5d8);
  --attn-seam: var(--border-seam, #d3dae1);
  /* ink (bb tokens, light fallbacks) */
  --attn-emph: var(--foreground, #33414f);
  --attn-label: var(--muted-foreground, #5c6a78);
  --attn-dim: var(--subtle-foreground, #717e8b);
  --attn-sub: var(--subtle-foreground, #8a94a0);
  --attn-faint: var(--subtle-foreground, #a3abb5);
  /* family tint previews: one subtly-hued slot per family over the neutral
     region fill (ADR-clean — no status data in the tints). Dark values are
     the originals; light values are pastels of the same six hues. */
  --attn-tint-0: #e6edf5; // blue-grey
  --attn-tint-1: #e7f1e9; // green-grey
  --attn-tint-2: #f1edf6; // purple-grey
  --attn-tint-3: #f5efeb; // warm grey
  --attn-tint-4: #ecf0fb; // indigo
  --attn-tint-5: #f2f4e9; // olive
  /* status hues: ADR-0001's four, held steady per theme, slightly deepened on
     light so they hold against a bright stage. */
  --attn-error: #d34b43;
  --attn-needs-you: #b8862c;
  --attn-working: #2e6fd0;
  --attn-unread: #23813a;
  /* idle age ramp: fresh muted ink fading into the stage. */
  --attn-idle-ink: var(--muted-foreground, #6e7681);
  --attn-grey-0: var(--attn-idle-ink);
  --attn-grey-1: color-mix(in srgb, var(--attn-idle-ink) 78%, var(--attn-stage));
  --attn-grey-2: color-mix(in srgb, var(--attn-idle-ink) 56%, var(--attn-stage));
  --attn-grey-3: color-mix(in srgb, var(--attn-idle-ink) 38%, var(--attn-stage));
  --attn-grey-4: color-mix(in srgb, var(--attn-idle-ink) 24%, var(--attn-stage));
  --attn-grey-5: color-mix(in srgb, var(--attn-idle-ink) 12%, var(--attn-stage));
}

.dark .attn-theme, .attn-theme.dark {
  --attn-stage: var(--surface-recessed-solid, #0f151d);
  --attn-card: var(--card, #131a22);
  --attn-card-border: var(--border, #1c2430);
  --attn-selected: var(--surface-selected, #1a2433);
  --attn-selected-border: var(--ring, #2f4b74);
  --attn-seam: var(--border-seam, #31415a);
  --attn-emph: var(--foreground, #c3d0dc);
  --attn-label: var(--muted-foreground, #9fb4c8);
  --attn-dim: var(--subtle-foreground, #8fa3b5);
  --attn-sub: var(--subtle-foreground, #7d93a8);
  --attn-faint: var(--subtle-foreground, #5f6b76);
  --attn-error: #e5534b;
  --attn-needs-you: #d9a53f;
  --attn-working: #3d84e0;
  --attn-unread: #2e9e45;
  --attn-tint-0: #1a2431; // blue-grey
  --attn-tint-1: #19261f; // green-grey
  --attn-tint-2: #221e2a; // purple-grey
  --attn-tint-3: #252023; // warm grey
  --attn-tint-4: #1a2030; // indigo
  --attn-tint-5: #20241a; // olive
  --attn-idle-ink: var(--muted-foreground, #a8b3bf);
}
`;

/** Color tokens defined per theme block (the greys live only here). */
export const THEME_TOKENS = [
  "attn-stage",
  "attn-card",
  "attn-card-border",
  "attn-selected",
  "attn-selected-border",
  "attn-seam",
  "attn-emph",
  "attn-label",
  "attn-dim",
  "attn-sub",
  "attn-faint",
  "attn-error",
  "attn-needs-you",
  "attn-working",
  "attn-unread",
  "attn-tint-0",
  "attn-tint-1",
  "attn-tint-2",
  "attn-tint-3",
  "attn-tint-4",
  "attn-tint-5",
  "attn-idle-ink",
  "attn-grey-0",
  "attn-grey-1",
  "attn-grey-2",
  "attn-grey-3",
  "attn-grey-4",
  "attn-grey-5",
] as const;