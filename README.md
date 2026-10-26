# Activity Overview

<p align="center">
  Every visible bb thread as one status light, in one sidebar panel.
</p>

<p align="center">
  <a href="#install"><img alt="bb plugin" src="https://img.shields.io/badge/install%20with-bb%20plugin-8a2be2"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-339933">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/cristoslc/bb-plugin-activity-overview"></a>
</p>

<p align="center">
  <a href="docs/screenshots/board-dark.png">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/board-dark.png">
      <img src="docs/screenshots/board-light.png" alt="Activity Overview's Board: one fixed-slot dot card per project" width="100%">
    </picture>
  </a>
</p>

<p align="center">
  <a href="docs/screenshots/tab-tour.gif">
    <img src="docs/screenshots/tab-tour.gif" alt="Touring the four tabs: Board, Unit treemap, Strip tiles, and Token flow" width="90%">
  </a>
  <br>
  <strong>Four views of one roster</strong> — Board, Unit treemap, Strip tiles, and Token flow
</p>

> [!NOTE]
> **What is bb?** An open-source, local-first IDE for coding agents where work runs in *threads*: live agent conversations you can follow, steer mid-run, or hand off. Activity Overview is a bb *plugin* that turns those threads into a glanceable status board. Learn more at [getbb.app](https://getbb.app) or [github.com/get-bb/bb](https://github.com/get-bb/bb).

## What it does

One dot is one thread. Its color reads status, the number of dots reads volume, and a project's health emerges from the pattern of colors rather than any painted verdict. The panel lives in bb's sidebar as a nav panel and updates live as your threads change.

- **Board** — one card per project with fixed dot slots, so an empty slot keeps a project's shape as threads come and go.
- **Unit treemap** — region area reads thread count (squarified): at the fitted view each thread fills its unit area as one full-fill status tile, and zoomed past the fit it becomes one constant-size dot per thread. Projects separate by a thin void, with no strokes.
- **Strip tiles** — one tile per project: the name over a strip with one 4px unit per thread, hottest statuses at the left edge; tiles flow-wrap.
- **Token flow** — projects pile vertically, one wide row each; expanding a row tiles its status tiers as four lanes (Working, Needs You, Unread, Idle) and every card's river fans from the project's one mouth. The plugin's `flow` RPC serves it.

Reading a view:

- **Status by color.** Needs-you, error, working, unread, and idle each own a color (classification is most-urgent-wins: needs-you > error > working > unread > idle). Idle dots fade with age, so a stale thread recedes.
- **Burn-rate pulse.** A working dot blinks at the thread's measured token rate, so a thread consuming 10× the tokens pulses 10× as fast.
- **Zoom and open.** Pan and zoom any aggregate view. Past the fitted view every dot becomes a control that opens its thread; clicking away or the top-right close control returns to the fit. Hovering a dot shows its title and where the conversation left off.
- **What's new.** A gift button in the tab bar lists recent changes after an update and never disappears.

Colors are theme tokens (`views/theme.ts`): the four status hues hold steady across light and dark (error red, needs-you amber, working blue, unread green), while idle is a grey ramp that fades with age toward the stage color.

## Screenshots

<p align="center">
  <img src="docs/screenshots/board-dark.png" alt="Board: fixed-slot dot cards, drawn from the demo fixture" width="90%">
  <br>
  <strong>Board</strong> — one card per project, volume of dots reads thread count
</p>

<p align="center">
  <img src="docs/screenshots/treemap-dark.png" alt="Unit treemap: project regions sized by thread count, filled with one dot per thread" width="90%">
  <br>
  <strong>Unit treemap</strong> — region area reads count, each dot one thread
</p>

<p align="center">
  <img src="docs/screenshots/tiles-dark.png" alt="Strip tiles: one project per tile, a 4px strip per thread" width="90%">
  <br>
  <strong>Strip tiles</strong> — a 4px strip per thread, hottest at the left edge
</p>

<p align="center">
  <img src="docs/screenshots/tokenflow-dark.png" alt="Token flow: project rows with status lanes and token rivers" width="90%">
  <br>
  <strong>Token flow</strong> — projects stack, each row tiles its status lanes
</p>

<p align="center">
  <img src="docs/screenshots/phone-board-dark.png" alt="Board on a phone" width="32%">
  &nbsp;&nbsp;
  <img src="docs/screenshots/board-light.png" alt="Board in light theme" width="32%">
  <br>
  <strong>Everywhere</strong> — phone width and light theme
</p>

## Requirements

- Node ≥ 18
- bb with plugin SDK ≥ 0.6.15

## Install

```sh
git clone https://github.com/cristoslc/bb-plugin-activity-overview && cd bb-plugin-activity-overview
npm install
bb plugin install . --yes
```

The **Activity Overview** panel appears in the sidebar (routed at `/plugins/activity-overview/board`).

A submission to the bb community marketplace is prepared in `store/`; once it is listed the short name installs it:

```sh
bb plugin install activity-overview
```

To update, run the same command again. Straight from GitHub works too, with or without a pinned tag:

```sh
bb plugin install https://github.com/cristoslc/bb-plugin-activity-overview
bb plugin install git:https://github.com/cristoslc/bb-plugin-activity-overview@<tag>
```

## Data and privacy

The panel reads bb's live thread view through the plugin SDK's sidebar hooks and writes nothing. Its only backend is a stateless read that samples token usage for the burn-rate pulse and the Token flow tab; no content leaves your machine.

## Development

```sh
npm install
bb plugin build
bb plugin install . --yes
bb plugin reload activity-overview
# or: bb plugin dev
npm test           # node --test
npx tsc --noEmit   # typecheck
```

The screenshots and the hero GIF in `docs/screenshots/` are produced by scripts in
`scripts/screenshot/` (a vite harness renders the real app against a mocked SDK,
driven by headless Chrome). See [AGENTS.md](AGENTS.md) for the media, UAT, and
store commands.

## Contributing

Issues and PRs are welcome at
[github.com/cristoslc/bb-plugin-activity-overview](https://github.com/cristoslc/bb-plugin-activity-overview).
Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Run `npm test` and
`npx tsc --noEmit` before submitting, and report security problems privately
per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).

## Changelog

Notable changes are documented in [CHANGELOG.md](CHANGELOG.md).
