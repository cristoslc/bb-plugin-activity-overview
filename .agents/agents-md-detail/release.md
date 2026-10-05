# Release Spoke — bb-plugin-activity-overview

How to ship a new Activity Overview version. The pipeline has a fixed shape:
user work appends bullets to the changelog's `[Unreleased]` group when it
merges into `dev`; releasing is a finalize commit on the dev lineage (name
the version, strip `-dev`), a fast-forward of `main`, a tag on that commit,
and a dev-only prep commit that re-arms the next cycle. Release-time
changelog writing is gone: the What's-new modal feed derives from
`CHANGELOG.md` at test/build time. Read this spoke whenever a turn involves
merging into `dev`, releasing, changelog writing, or tagging.

Adopted from the Focus Board plugin's release discipline (proj_p4562js7v2);
the machinery (`lib/whats-new.ts`, the generate scripts, the gift button)
is that port, with this repo's names and branch facts.

## 0. Branch model

- `dev` is the default branch and the integration branch: thread branches
  base on it and merge into it; releases flow from it. While unreleased,
  `dev` carries a provisional prerelease version — the next release
  candidate + `-dev` (e.g. `0.3.0-dev`) — in `package.json`,
  `package-lock.json`, and `APP_VERSION` in `lib/whats-new.ts`. The `-dev`
  suffix marks the number as a guess; the finalize commit makes it real.
- `main` is the stable branch. It moves only by fast-forwarding to a commit
  on the `dev` lineage; a `--ff-only` refusal means main and dev diverged —
  stop and reconcile instead of papering over it with a merge commit.
- Not listed on the bb community marketplace yet as of 2026-10; the
  marketplace check below is skipped until a submission exists. If the
  plugin is ever listed, every cut must verify `source.git.range` covers
  the tagged version and bump the range in that cut's marketplace PR.

## 1. Merging work into `dev` — the changelog happens here

- Every merge into `dev` that lands user-facing behavior appends bullets to
  the `[Unreleased]` group at the top of `CHANGELOG.md`, under the matching
  Keep-a-Changelog subsection: **Added** = new capability, **Changed** =
  behavior change to an existing surface, **Fixed** = bug fix.
- Every changelog write audits the whole `[Unreleased]` group in the same
  edit and never defers the fixes to release: only user-facing behavior
  earns bullets (tests-only, refactor, docs-only, build-plumbing, and
  internal-identifier landings are commit-message material; a mixed landing
  bullets only its user-facing part); every bullet lands under the matching
  subsection, and stray or bare bullets regroup right there.
- One bullet per *behavior*, not per merge or branch. Bullets are
  Slack-style release notes: the behavior in one short sentence, at most a
  second one for texture. A bullet's OPENING SENTENCE is its What's-new
  item, so the bold lead carries the whole behavior and reads standalone; a
  bare noun phrase ("Camera persistence.") is the failure to avoid. Beyond
  the lead, at most two short sentences; a state-list chain gets cut or
  moved to the repo docs. Bullets covering the same behavior fold into one
  with facet sub-bullets; sibling top-level bullets for one surface are the
  failure to avoid.
- Published sections are never back-edited. If a later merge revises
  behavior a published version already described, it gets fresh
  `[Unreleased]` bullets saying what the behavior is *now*.
- A finalize rename sets a changelog trap for the next merge into `dev`:
  the branch's bullets sit under the heading dev renamed to `[X.Y.Z]`, and
  git's auto-merge happily files the new bullets into the published
  section. After any dev merge that carries `[Unreleased]` bullets across a
  finalize boundary, check where they landed and move them into the fresh
  `[Unreleased]`; resolving the conflict by keeping both sides is exactly
  the back-edit the bullet above forbids.
- The What's-new feed is never hand-written: `scripts/generate-unreleased.mjs`
  and `scripts/generate-whats-new.mjs` (wired into `npm test` and
  `npm run build`) embed the current `[Unreleased]` group and derive the
  published feed from the sections, so `CHANGELOG.md` is the single source
  of truth and no sentence is ever written twice. The group also carries a
  parse contract — bullets open with `- ` at column zero, wrap with
  two-space continuation lines, and open with a bold lead sentence —
  exercised in tests; a bullet that violates it simply stops appearing in
  the dev What's-new modal.
- The gift button's pulse on dev keys to the group's CONTENT, not the
  version: the fingerprint is written only when the modal opens, so an
  unopened dev build pulses its standing group (if it has bullets) and
  pulses again every time a merge lands new ones. Empty groups never
  pulse. Stable builds keep the classic version-based pulse.
- The modal stays reachable from the quiet gift button, which lives in the
  tab bar and never disappears or hides.

## 2. Verify, always

- `npm test` — includes the lockstep pin (APP_VERSION === package.json's
  version) and the whats-new tests.
- `npm run build` — the plugin must build into `dist/`. `dist/` is
  gitignored; it is never committed.

## 3. Finalize commit (on the dev lineage)

If your branch doesn't contain `origin/dev` yet, merge `dev` in first. One
commit, subject `Release X.Y.Z: <user-facing summary>` (the summary
condenses the changelog's lead item — same wording rules as the What's-new
item):

1. **Decide the number**: strip the `-dev` suffix and that is the version —
   correct it first if the unreleased work warrants a different bump than
   the suffix guessed (per semver: user-visible additions may take a
   minor; the cadence is per-release judgment).
2. `CHANGELOG.md`: rename `[Unreleased]` → `[X.Y.Z] - <date>`, and add a
   fresh empty `[Unreleased]` group above it in the same commit. The
   renamed section may be elaborated to full record prose freely — its
   bullets' opening sentences become the version's What's-new items
   automatically at the next test/build.
3. `package.json` and the root + package entries in `package-lock.json`:
   strip the suffix.
4. `APP_VERSION` in `lib/whats-new.ts`: strip the suffix.
5. Nothing more: the version's What's-new entry already exists, derived
   from the section renamed in step 2.

This commit is what gets tagged and fast-forwarded onto main — nothing
else should ride in it.

## 4. Promote `main`, tag, push

- From a temp worktree: `git worktree add /tmp/release-main main`, then
  `git merge --ff-only dev`.
- Tag the finalize commit (which is now main's tip):
  `git tag -a vX.Y.Z -m "Release X.Y.Z: <summary>"`. Never move a tag: bb
  records the tag plus the commit it pointed at. A fix after tagging is a
  new version, not a retag.
- Push `dev`, `main`, and the tag to `origin` — a pushed tag is the
  distribution surface (users install semver ranges like `git:...@^X.Y`).
- Remove the temp worktree.

## 5. What's-new derivation (`WHATS_NEW` in `lib/whats-new.ts`)

- The published feed is scraped from `CHANGELOG.md` by
  `scripts/generate-whats-new.mjs`: every `## [version]` heading yields one
  entry and every bullet one item — the bullet's bold lead sentence
  (`lib/changelog-markdown.ts`, `leadFromBullet`: the bold lead when it
  closes a sentence, else the first full sentence running through it;
  "(#N)" references stripped, terminal punctuation ensured). Nothing about
  a new release is hand-written: the finalize commit's section IS the
  entry.
- The item rules are therefore just the rules for writing a section's
  first sentences: one user-facing sentence (at most two), "surface first,
  then the behavior"; behavior, never implementation; no jargon or code
  identifiers unless the identifier is the user-visible surface; don't
  rely on the mechanical "(#N)" strip as permission to write ticket
  numbers in.
- One to three bullets per release. A release with nothing user-visible
  still gets a section — an update whose modal cannot describe itself is a
  silent update.
- Old entries are never back-edited, since the feed derives from those
  sections.

## 6. Post-release prep commit (dev-only)

Immediately after promoting, one commit on the dev lineage, subject like
`Prepare X.Y.(Z+1)-dev: re-arm the cycle`:

- `package.json`, `package-lock.json`, and `APP_VERSION` bumped to the
  next release candidate + `-dev`. The guess defaults to one patch bump
  past the release unless the direction of current work suggests a minor.
- Nothing else: the primed `[Unreleased]` group from the finalize commit is
  already there, and no `WHATS_NEW` entry exists for a `-dev` version —
  that is by design.

## 7. Reload the running plugin

The registered plugin source paths live in the bb host's own worktrees, so
this thread's worktree is where `bb plugin build` was last run; whatever
checkout bb serves from needs the rebuild:

1. `npm run build` in the checkout bb serves (`bb plugin list` shows it).
2. `bb plugin reload activity-overview`.
3. Confirm with `bb plugin list` (version reads `X.Y.Z` right after a
   release, or the `-dev` candidate once §6 lands) and open the panel; the
   What's-new gift button should pulse for the new version after a release
   and stay quiet once the modal is opened.

This is part of every merge into `dev`, not a release-only step. bb does
not watch the plugin's `dist/` — a rebuilt bundle keeps serving the
previously loaded code until the reload runs, so a merged-but-unreloaded
panel looks unshipped: new behavior absent and the gift silent even though
`[Unreleased]` has bullets. Treat a missing pulse after a
changelog-carrying merge as the symptom of a stale bundle first, a code
bug second.

`bb plugin dev activity-overview` is the watch-mode alternative for
iterating, not for releases.

## 8. Release ledger

- `CHANGELOG.md` is the full Keep-a-Changelog record. The `[Unreleased]`
  group is written during merges into dev; the finalize commit renames it
  to its version. Public sections, newest first, never back-edited. The
  group also embeds into dev builds as the What's-new modal's headline
  entry — keep its bullets' opening sentences modal-readable.
- `lib/whats-new.ts` is the user-facing What's-new modal feed, derived
  from `CHANGELOG.md` at build time, newest first. Both surfaces must name
  the same version at the top after a finalize commit — the feed's entry
  exists the moment the section does.
- Git tags plus finalize commits serve as the distribution history; the
  What's-new entry and the CHANGELOG section are the notes.