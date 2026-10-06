# Dev-merge visual-check loop

Every merge that lands on `dev` in this repo is not done until the served
plugin has been visually verified against the merge head. The unit suite and
`tsc` prove the math; this loop proves the pixels — and pixels is where the
treemap tints and the chrome-occlusion bugs hid.

## Loop (in order)

1. **Land the merge on `dev`** (tests + tsc + changelog bullets per the
   release discipline first — the visual loop never reviews unmerged code).
2. **Serve the merge head.** The plugin runs from its registered source
   (`bb plugin source activity-overview` reports it). If that source points
   at another thread's worktree, bring it to the merge head: with a clean
   tree and an idle thread, rebase its branch onto `dev`; otherwise
   `bb plugin install <merge-worktree-path>` to point at the merge head.
   Then `bb plugin build` in the served checkout and
   `bb plugin reload activity-overview`; verify the reported source path
   and version moved.
3. **Drive the headless browser** (`bb browser-automation open --backend
   local --headless --machine <host-id>`; get the host id from
   `bb browser instances --host <host> --json`; desktop backend needs the
   getbb sign-in, local headless against the local app shell does not —
   resolve `bb status`'s server URL with `BB_SERVER_URL` or `bb guide`'s
   printed value and open it). The accessibility snapshot does not reach
   the map canvas; drive by viewport coordinates through `p.mouse`, and
   take a fresh screenshot to locate targets first.
4. **Check each of the five tabs**: open every tab at fit and screenshot it
   — no card, label or dot may sit under the floating chrome (top tab bar
   ≈ top 60px; legend bottom-left; corner zoom controls).
5. **Check the treemap loop specifically**: wheel-zoom into a region
   (`p.mouse.move(x, y)` over a region center, `p.mouse.wheel({ deltaY:
   -N })`) — the project title must stay clear of the top nav; click a
   project — the other regions dim, the focused region shows one visible
   background slot tint per family; click a dimmed neighbor or a void —
   the fit view returns and the dimming clears.
6. **Evidence and verdict**: keep the screenshots (copy them out of the
   session's temp dir before closing it), state one line per check
   (pass/fail with what was seen) in the merge report. A failed check is
   fixed on the feature branch (failing test first where it is pure math)
   and re-merged — the dev merge is never declared done with a red visual
   check.
7. **Clean up**: `bb browser-automation close <session-id>` when finished;
   remove any temporary merge worktree after the served source reaches the
   merge head.

## Notes

- Local bb app shell (no sign-in) is reachable where bb listens locally;
  the remote getbb.app URL needs an authenticated profile (headless local
  Chrome is not signed in — use the desktop backend for that, or the local
  shell).
- Snapshots cap depth: interactive targets inside the canvas come only
  from coordinates, so re-screenshot after every camera move before
  computing the next click point.
- The zoom controls sit at the bottom-right of the canvas; ⤢ there re-fits
  the camera without clearing a treemap focus (one tap on any region or
  void does that).