// Board fill-scale + treemap label-visibility contracts.
//
// Two operator-requested behaviors, both pure and testable:
//  1. The Board's opening pack must use the chrome-free fit box the way the
//     treemap does — the shelves grow to fill the available height — while a
//     fill-scale cap keeps a one- or two-project roster from becoming a poster.
//  2. Every treemap project keeps its title at every camera scale: a screen-
//     space label layer, decoupled from the camera, seats one chip per visible
//     region with no overlap across the whole zoom range.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProjects, makeCards, shelfPack,
  fillScale, treemapLayout, labelMaxWidth, labelNaturalWidth, placeRegionLabels,
  LABEL_H, LABEL_MIN_W, LABEL_PAD, LABEL_MAX_W,
  type AttnThread, type AttnProject, type ProjectModel, type RegionInput,
} from "../views/model.ts";

const NOW = Date.parse("2026-10-04T19:00:00Z");

// The operator's real 21-project roster shape (threads per project) at the
// measured fit box on this host (panel 1120x852 -> pack width 1064, budget 672).
const ROSTER_N = [149, 54, 44, 39, 21, 13, 12, 10, 10, 6, 3, 3, 3, 3, 2, 2, 1, 1, 1, 1, 1];
const ROSTER_NAMES = [
  "Focus Board plugin", "proj_personal", "bv-brain2", "Homelab", "Protect South Portland",
  "cove", "202604-workstation", "HouseOps", "AssetCALC", "Activity Overview bb plugin",
  "Project Hal", "research-keeper", "Hattrick: Spend, Save, Share", "bb-thread-model-defaults",
  "subsentinel", "ai-output-humanizer-skill", "devops-60_mysql-investigation",
  "bb-plugin-session-janitor", "vikunja-pwa-fork", "Code Pane plugin", "bb-plugin-dkam",
];
const W = 1064, H = 672;
// The chrome-free fit box MapCanvas hands views (SAFE top 60 / bottom 88 /
// sides 12, plus a 16px GAP) at the measured panel size.
const VIEW = { w: 1120, h: 852 };
const BOX = { x: 12 + 16, y: 60 + 16, w: 1064, h: 672 };

function projectOfN(n: number, i: number): ProjectModel {
  return { pid: `p${i}`, name: ROSTER_NAMES[i] ?? `proj-${i}`, cells: [], n, best: i, hot: 0 };
}

const boardPackAt = (projects: ProjectModel[], w: number, s: number) =>
  shelfPack(makeCards(projects, 13 * s, 13 * s, 120 * s), w, 14, 14);

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

// ---------- change 1: board fills the fit box ----------

test("fillScale: largest scale in [min, cap] whose packed height fits the budget", () => {
  assert.equal(fillScale((s) => 100 * s, 250, 2), 2); // cap fits
  assert.equal(fillScale((s) => 300 * s, 600, 2), 2); // exactly at cap
  assert.ok(Math.abs(fillScale((s) => 300 * s, 450, 2) - 1.5) < 1e-6);
  assert.equal(fillScale((s) => 300 * s, 100, 2), 1); // even 1x overflows -> never shrink below legible
  assert.equal(fillScale((s) => 10 * s, 20, 1), 1); // cap 1 -> 1
  assert.equal(fillScale((s) => 100 * s, 0, 2), 1); // no budget -> 1
  assert.equal(fillScale(() => 100, 250, 2), 2); // scale-independent pack -> cap
});

test("fillScale never returns a scale whose real pack overflows a budget it can fit", () => {
  const projects = ROSTER_N.map(projectOfN);
  const baseH = boardPackAt(projects, W, 1).H;
  for (const budget of [200, 400, 672, 900]) {
    const s = fillScale((x) => boardPackAt(projects, W, x).H, budget, 2);
    assert.ok(s >= 1 && s <= 2, `scale ${s} out of range`);
    if (budget >= baseH) {
      assert.ok(boardPackAt(projects, W, s).H <= budget + 1e-6, `pack overflows at budget ${budget}`);
    } else {
      // a budget even 1x cannot fit: the floor is 1, never smaller (legibility wins)
      assert.equal(s, 1, `budget ${budget} below the 1x pack must floor at 1`);
    }
  }
});

test("board opening: the real roster fills the fit-box height (old capped pack opened at k<1)", () => {
  const projects = ROSTER_N.map(projectOfN);
  const scale = fillScale((s) => boardPackAt(projects, W, s).H, H, 2);
  const packed = boardPackAt(projects, W, scale);
  assert.ok(packed.H <= H + 0.5, `packed ${packed.H} overflows ${H}`);
  assert.ok(packed.H > H * 0.9, `packed ${packed.H} underfills ${H}: the opening would land zoomed out`);
  assert.ok(scale <= 2, "the fill cap must not exceed 2x");
  // the opening fit is k = min(1, H/packed.H) = 1 because packed.H <= H and the
  // world width is W <= box.w (the pack never exceeds its width target).
  assert.equal(Math.min(1, H / packed.H), 1);
});

test("board opening: one and two projects stay capped — no poster", () => {
  for (const k of [1, 2]) {
    const projects = ROSTER_N.slice(0, k).map(projectOfN);
    const scale = fillScale((s) => boardPackAt(projects, W, s).H, H, 2);
    assert.ok(scale <= 2, `scale ${scale} exceeds the cap`);
    assert.ok(8 * scale <= 22 + 1e-6, `dot ${8 * scale}px exceeds the treemap dot ceiling`);
  }
});

// ---------- change 2: always-visible treemap titles ----------

function rosterThreads(): { threads: AttnThread[]; projects: AttnProject[] } {
  const threads: AttnThread[] = [];
  let id = 0;
  ROSTER_N.forEach((n, pi) => {
    for (let j = 0; j < n; j++) {
      threads.push({
        id: `t${id++}`, projectId: `proj_${pi}`, title: "t", parentThreadId: null,
        status: "idle", runtimeStatus: "idle", hasPendingInteraction: false,
        isUnread: false, archivedAt: null, lastReadAt: NOW, latestAttentionAt: NOW,
        updatedAt: NOW, createdAt: NOW,
      });
    }
  });
  return { threads, projects: ROSTER_N.map((_, i) => ({ id: `proj_${i}`, name: ROSTER_NAMES[i]! })) };
}

function layoutFor(names: string[]): RegionInput[] {
  const threads: AttnThread[] = [];
  let id = 0;
  ROSTER_N.slice(0, names.length).forEach((n, pi) => {
    for (let j = 0; j < n; j++) {
      threads.push({
        id: `t${id++}`, projectId: `proj_${pi}`, title: "t", parentThreadId: null,
        status: "idle", runtimeStatus: "idle", hasPendingInteraction: false,
        isUnread: false, archivedAt: null, lastReadAt: NOW, latestAttentionAt: NOW,
        updatedAt: NOW, createdAt: NOW,
      });
    }
  });
  const projects = ROSTER_N.slice(0, names.length).map((_, i) => ({ id: `proj_${i}`, name: names[i]! }));
  const { projects: models } = buildProjects(threads, projects, NOW);
  const layout = treemapLayout(models, W, H)!;
  return layout.regions.map((r) => ({ pid: r.p.pid, name: r.p.name, n: r.p.n, x: r.x, y: r.y, w: r.w, h: r.h }));
}

test("treemapLayout: one region per project, tiny projects included", () => {
  const { threads, projects } = rosterThreads();
  const { projects: models } = buildProjects(threads, projects, NOW);
  const layout = treemapLayout(models, W, H);
  assert.ok(layout !== null);
  assert.equal(layout.regions.length, models.length);
  for (const r of layout.regions) {
    assert.ok(r.w > 0 && r.h > 0);
    assert.ok(r.p.pid.length > 0);
  }
  assert.ok(layout.regions.some((r) => r.p.n === 1), "the n=1 regions must be present");
});

test("treemapLayout: empty roster, zero weight and zero viewport all return null", () => {
  assert.equal(treemapLayout([], W, H), null);
  assert.equal(treemapLayout([projectOfN(0, 0)], W, H), null);
  assert.equal(treemapLayout([projectOfN(3, 0)], 0, H), null);
  assert.equal(treemapLayout([projectOfN(3, 0)], W, 0), null);
});

test("labelMaxWidth: a legible floor, growing with the region as the camera zooms in", () => {
  assert.equal(labelMaxWidth(10, 1), LABEL_MIN_W); // tiny region still gets a floor
  assert.equal(labelMaxWidth(26, 1), LABEL_MIN_W);
  assert.ok(labelMaxWidth(400, 3) > labelMaxWidth(400, 1), "zooming in widens the budget");
  assert.equal(labelMaxWidth(400, 3), 400 * 3 - 2 * LABEL_PAD);
  assert.equal(labelMaxWidth(1000, 1), 1000 - 2 * LABEL_PAD);
});

test("labelNaturalWidth: name plus suffix, capped at LABEL_MAX_W", () => {
  assert.ok(labelNaturalWidth("cove") < labelNaturalWidth("Focus Board plugin"));
  assert.ok(labelNaturalWidth("x".repeat(200)) <= LABEL_MAX_W);
});

test("placeRegionLabels: one chip per visible region at fit, no overlap", () => {
  const regions = layoutFor(ROSTER_NAMES);
  const cam = { k: 1, tx: BOX.x, ty: BOX.y };
  const labels = placeRegionLabels(regions, cam, BOX, null);
  assert.equal(labels.length, regions.length, "every project is labeled at fit");
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      assert.ok(!overlaps(labels[i]!, labels[j]!), `labels ${labels[i]!.pid}/${labels[j]!.pid} overlap at fit`);
    }
  }
  // every chip is inside the chrome-free box
  for (const l of labels) {
    assert.ok(l.x >= BOX.x && l.y >= BOX.y && l.x + l.w <= BOX.x + BOX.w + 1e-6 && l.y + l.h <= BOX.y + BOX.h + 1e-6);
    assert.equal(l.h, LABEL_H, "chip height is fixed, decoupled from the camera");
  }
});

test("placeRegionLabels: every on-screen region carries a chip at every zoom", () => {
  const regions = layoutFor(ROSTER_NAMES);
  const intersects = (
    r: RegionInput, cam: { k: number; tx: number; ty: number },
  ) => {
    const sx = r.x * cam.k + cam.tx, sy = r.y * cam.k + cam.ty;
    const sw = r.w * cam.k, sh = r.h * cam.k;
    return !(sx + sw <= BOX.x || sy + sh <= BOX.y || sx >= BOX.x + BOX.w || sy >= BOX.y + BOX.h);
  };
  for (const k of [0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 5]) {
    const cam = { k, tx: BOX.x + (BOX.w - W * k) / 2, ty: BOX.y + (BOX.h - H * k) / 2 };
    const labels = placeRegionLabels(regions, cam, BOX, null);
    const onScreen = regions.filter((r) => intersects(r, cam));
    assert.equal(labels.length, onScreen.length, `k=${k}: every on-screen region must carry a title`);
    const got = new Set(labels.map((l) => l.pid));
    for (const r of onScreen) assert.ok(got.has(r.pid), `k=${k}: ${r.pid} on screen but unlabeled`);
    for (const l of labels) assert.equal(l.h, LABEL_H, `k=${k}: fixed chip height`);
  }
});

test("placeRegionLabels: no two chips overlap anywhere a real roster can be panned", () => {
  const regions = layoutFor(ROSTER_NAMES);
  for (const k of [0.2, 0.5, 0.75, 1, 1.5]) {
    for (const fx of [-0.4, 0, 0.4]) {
      for (const fy of [-0.3, 0, 0.3]) {
        const freeW = BOX.w - W * k, freeH = BOX.h - H * k;
        const cam = {
          k,
          tx: BOX.x + (freeW > 0 ? (freeW / 2) + fx * freeW : fx * freeW),
          ty: BOX.y + (freeH > 0 ? (freeH / 2) + fy * freeH : fy * freeH),
        };
        const labels = placeRegionLabels(regions, cam, BOX, null);
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            assert.ok(!overlaps(labels[i]!, labels[j]!), `overlap k=${k} fx=${fx} fy=${fy}: ${labels[i]!.pid}/${labels[j]!.pid}`);
          }
        }
      }
    }
  }
});

test("placeRegionLabels: at fit, every roomy region's chip sits over its own region", () => {
  const regions = layoutFor(ROSTER_NAMES);
  const cam = { k: 1, tx: BOX.x, ty: BOX.y };
  const labels = placeRegionLabels(regions, cam, BOX, null);
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  let roomy = 0;
  for (const l of labels) {
    const r = regions.find((rr) => rr.pid === l.pid)!;
    // project the region into screen space (cam k=1, translate BOX.x/BOX.y)
    const rs = { x: r.x + BOX.x, y: r.y + BOX.y, w: r.w, h: r.h };
    if (rs.w >= l.w && rs.h >= l.h) {
      roomy++;
      assert.ok(overlaps(l, rs), `${r.pid} chip drifted off its own region at fit`);
    }
  }
  assert.ok(roomy >= regions.length - 4, `only ${roomy}/${regions.length} rooms kept their chip on-region`);
});

test("placeRegionLabels: a region outside the box contributes no chip; focus dims the rest", () => {
  const regions: RegionInput[] = [
    { pid: "a", name: "Alpha", n: 5, x: 0, y: 0, w: 80, h: 100 },
    { pid: "b", name: "Beta", n: 5, x: 900, y: 500, w: 80, h: 100 },
  ];
  const onlyA = placeRegionLabels(regions, { k: 1, tx: BOX.x, ty: BOX.y }, { x: 0, y: 0, w: 300, h: 300 }, null);
  assert.deepEqual(onlyA.map((l) => l.pid), ["a"]);
  const focused = placeRegionLabels(regions, { k: 1, tx: BOX.x, ty: BOX.y }, { x: 0, y: 0, w: 1200, h: 800 }, "a");
  assert.equal(focused.find((l) => l.pid === "a")!.dimmed, false);
  assert.equal(focused.find((l) => l.pid === "b")!.dimmed, true);
});
