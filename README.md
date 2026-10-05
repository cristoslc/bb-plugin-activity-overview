# bb-plugin-attention

Attention: three glanceable status views of all visible BB threads, in one sidebar nav panel. One dot = one thread.

## Install

```sh
git clone <repo> bb-plugin-attention && cd bb-plugin-attention
npm install
bb plugin install . --yes
```

The **Attention** panel appears in the sidebar (routed at `/plugins/attention/board`).

## Views (tabs)

- **Board** — one card per project, fixed dot slots. Volume of dots = thread count, color = status, empty slots keep their place.
- **Unit treemap** — region area = thread count (squarified); each thread fills its true unit area as one constant-size dot; projects separate by a thin void, no strokes.
- **Strip tiles** — one tile per project: name over a strip, one 4px unit per thread, hottest statuses at the left edge; tiles flow-wrap.

## Reading the dots

Classification (most urgent wins): needs-you > error > working > unread > idle. Colors: error `#e5534b`, needs-you `#d9a53f`, working `#3d84e0` (pulses), unread `#2e9e45`, idle grey fading with age. Dominance is always emergent from the dot color pattern.

## Development

`bb plugin dev` rebuilds and reloads on save. Tests: see AGENTS.md.
