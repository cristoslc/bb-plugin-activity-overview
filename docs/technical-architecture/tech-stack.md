# Tech stack

- Node 22 (BB host runtime); plugin package `"type": "module"`.
- TypeScript 5.7 strict (tsconfig from bb plugin scaffold).
- React 19 — provided by the BB host, type-only dev dependency.
- Tailwind utility classes compile against BB theme tokens for chrome; the stage canvases use plugin theme tokens (views/theme.ts) with light defaults and dark overrides under bb's `.dark` ancestor — ink/surface tokens derive from bb's CSS custom properties with standalone fallbacks from the prototype's dark palette.
- Tests: `node --test` with native TS type stripping (no test framework dependency).
