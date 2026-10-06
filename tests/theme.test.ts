// Theme contract: every --attn-* token the model or views reference must be
// declared in views/theme.ts, mode-flipping tokens must exist in BOTH theme
// blocks (light default + dark override), and the idle age ramp must keep its
// fade order. Guards against a token used in one theme but missing in the
// other rendering unstyled.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  HOT_COLORS,
  FLOW_COLORS,
  GREYS,
  cellColor,
  classify,
  STATUS_NAMES,
  type AttnThread,
  type FlowStatus,
  type Status,
} from "../views/model.ts";
import { THEME_CSS, THEME_TOKENS } from "../views/theme.ts";

function thread(over: Partial<AttnThread> = {}): AttnThread {
  const NOW = Date.parse("2026-10-04T19:00:00Z");
  return {
    id: over.id ?? "thr_x", projectId: over.projectId ?? "proj_a", title: over.title ?? "t",
    parentThreadId: over.parentThreadId ?? null, status: over.status ?? "idle",
    runtimeStatus: over.runtimeStatus ?? "idle", hasPendingInteraction: over.hasPendingInteraction ?? false,
    isUnread: over.isUnread ?? false, archivedAt: over.archivedAt ?? null,
    lastReadAt: over.lastReadAt ?? NOW, latestAttentionAt: over.latestAttentionAt ?? NOW,
    updatedAt: over.updatedAt ?? NOW, createdAt: over.createdAt ?? NOW,
  };
}

const DARK_AT = THEME_CSS.indexOf(".dark .attn-theme");
const LIGHT_BLOCK = THEME_CSS.slice(0, DARK_AT);
const DARK_BLOCK = THEME_CSS.slice(DARK_AT);

function declared(chunk: string): Set<string> {
  return new Set([...chunk.matchAll(/(--attn-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

test("theme: the dark block exists after the light block", () => {
  assert.ok(DARK_AT > 0, "THEME_CSS must declare light values first, then a .dark block");
});

test("theme: mode-flipping tokens are declared in both blocks", () => {
  const both = THEME_TOKENS.filter((name) => !name.startsWith("attn-grey"));
  for (const name of both) {
    assert.ok(declared(LIGHT_BLOCK).has(`--${name}`), `--${name} missing from the light block`);
    assert.ok(declared(DARK_BLOCK).has(`--${name}`), `--${name} missing from the dark block`);
  }
});

test("theme: ramp tokens are declared (resolve via the theme-relative mix)", () => {
  const all = declared(THEME_CSS);
  for (const name of THEME_TOKENS.filter((n) => n.startsWith("attn-grey"))) {
    assert.ok(all.has(`--${name}`), `--${name} missing from THEME_CSS`);
  }
});

test("theme: every --attn-* token referenced by the model and views is declared", () => {
  const model = readFileSync(new URL("../views/model.ts", import.meta.url), "utf8");
  const views = readFileSync(new URL("../views/Views.tsx", import.meta.url), "utf8");
  const refs = new Set<string>();
  for (const src of [model, views, // THEME_CSS itself resolves bb tokens, not --attn ones
  ]) {
    for (const m of src.matchAll(/var\((--attn-[a-z0-9-]+)[),]/g)) refs.add(m[1]!);
  }
  const all = declared(THEME_CSS);
  assert.ok(refs.size >= 8, `expected a real token set, found only ${[...refs].join(", ")}`);
  for (const ref of refs) {
    assert.ok(all.has(ref), `${ref} is referenced but never declared in THEME_CSS`);
  }
});

test("theme: idle ramp thresholds ascend with the fade", () => {
  for (let i = 1; i < GREYS.length; i++) {
    assert.ok(GREYS[i]![0] > GREYS[i - 1]![0]);
  }
  GREYS.forEach(([days, color], i) => {
    assert.equal(color, `var(--attn-grey-${i})`);
  });
});

test("theme: cellColor and FLOW_COLORS emit only hex or themed tokens", () => {
  const acceptable = /^(#[0-9a-fA-F]{6}|var\(--attn-[a-z0-9-]+\))$/;
  const NOW = thread().createdAt;
  const statuses: Status[] = Object.keys(STATUS_NAMES) as Status[];
  for (const st of statuses) {
    for (const ageDays of [0, 2, 10, 400]) {
      const t = thread({
        hasPendingInteraction: st === "needs-you",
        runtimeStatus: st === "working" ? "active" : st === "unread" ? "idle" : st,
        isUnread: st === "unread",
        latestAttentionAt: NOW - ageDays * 86400000,
      });
      assert.match(cellColor(t, NOW), acceptable, `${st} at ${ageDays}d`);
      assert.equal(classify(t), st);
    }
  }
  for (const status of Object.keys(FLOW_COLORS) as FlowStatus[]) {
    assert.match(FLOW_COLORS[status], acceptable, `flow ${status}`);
  }
  for (const color of Object.values(HOT_COLORS)) {
    assert.match(color, acceptable);
  }
});