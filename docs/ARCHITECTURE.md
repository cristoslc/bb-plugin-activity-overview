# ARCHITECTURE

The plugin is a standard BB plugin: a TypeScript package whose backend entry (`server.ts`) is loaded by the BB server and whose frontend bundle (`app.tsx` → `dist/app.js`) renders inside the BB app. Detail lives in `technical-architecture/`.

## Containers (C4 level 2)

| Container | Runtime | Tech |
|---|---|---|
| backend entry | BB server process (Node 22) | TypeScript, `@get-bb/plugin-sdk` (stateless) |
| frontend bundle | BB client webview | React (host-shimmed), Tailwind via host theme |
| views model | frontend bundle | plain TS (classification, squarify, shelf pack) |

External system: the BB host itself (thread/project data, realtime updates, sidebar hooks). The plugin owns no database and reaches no network.

## Spokes
- `technical-architecture/c4/context.md`, `container.md`, `component.md`, `deployment.md`
- `technical-architecture/tech-stack.md`
