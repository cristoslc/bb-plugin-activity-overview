# Activity Overview

Activity Overview is a bb nav panel that shows every visible thread as a status light, updating live as your threads change. One dot is one thread: its color reads status, the number of dots reads volume, and a project's health emerges from the pattern of colors rather than any painted verdict.

## What you get

- **Four views of one roster.** The Board packs a fixed-slot card per project, so an empty slot keeps a project's shape as threads come and go. The Unit treemap sizes each project by thread count: at the fitted view each thread fills its area as a full-fill status tile, and zoomed past the fit it becomes one constant-size dot per thread. Strip tiles reflow a four-pixel-per-thread strip per project, hottest statuses at the left edge. And the Token flow tab stacks projects vertically and fans each one's token spend across its status lanes, so the runaway thread leads its own row.
- **Status you can read without opening a thread.** Needs-you, error, working, unread, and idle each own a color. Idle dots fade with age, so a stale thread recedes, and working dots pulse at the thread's measured token rate, so the busiest thread blinks fastest.
- **Zoom to explore, click to open.** Pan and zoom any aggregate view. Past the fitted view every dot becomes a control that opens its thread, and clicking away or the top-right close control returns you to the fit. Hovering a dot shows the thread's title and where its conversation left off.
- **A changelog that stays reachable.** A gift button in the tab bar lists recent changes after an update and never disappears, so the What's-new feed is always one click away.

Activity Overview installs from the bb community marketplace and updates the same way. The [repository README](https://github.com/cristoslc/bb-plugin-activity-overview) carries the current feature list, screenshots, and install options.

## Requirements

- bb with plugin SDK 0.6.15 or newer.
- No configuration. The plugin declares no settings, secrets, CLI commands, or storage. Its backend is a single stateless read that samples token usage; the aggregate views run in the frontend.
