# ARCHITECTURE

The plugin is a standard BB plugin: a TypeScript package whose frontend bundle (`app.tsx` → `dist/app.js`) is loaded by the BB client. There is no backend entry: every view renders from the host's live sidebar thread data, and the plugin owns no RPC, storage, or state. Detail lives in `technical-architecture/`.

## Containers (C4 level 2)

| Container | Runtime | Tech |
|---|---|---|
| frontend bundle | BB client webview | React (host-shimmed), Tailwind via host theme |
| views model | frontend bundle | plain TS (classification, squarify, shelf pack) |

External system: the BB host itself (thread/project data, sidebar hooks). The plugin owns no database and reaches no network.

## Spokes
- `technical-architecture/c4/context.md`, `container.md`, `component.md`, `deployment.md`
- `technical-architecture/tech-stack.md`
