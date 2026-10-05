# Tech stack

- Node 22 (BB host runtime); plugin package `"type": "module"`.
- TypeScript 5.7 strict (tsconfig from bb plugin scaffold).
- React 19 — provided by the BB host, type-only dev dependency.
- Tailwind utility classes compile against BB theme tokens for chrome; the stage canvases use fixed dark palettes from the prototype (#0f151d background family).
- Tests: `node --test` with native TS type stripping (no test framework dependency).
