/**
 * Headless UAT runner: drives YAML suites from tests/manual/ against the real
 * app in the screenshot harness (vite + puppeteer-core on the system Chrome).
 * Machine-executable counterpart to the operator-assisted UAT protocol — the
 * state machine, evidence capture, and report format follow
 * `~/.agents/agents-md-detail/operator-assisted-e2e.md`.
 *
 * Usage:
 *   npm run uat -- tests/manual/uat-flow-throbber.yaml   # one suite
 *   npm run uat                                          # every suite
 *
 * One-time browser setup: the runner uses the system Chrome, so nothing is
 * downloaded. Set CHROME_PATH if Chrome is not in the default place.
 */
import { spawn } from "node:child_process";
import { mkdir, access, readFile, readdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { parse } from "yaml";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HARNESS_CONFIG = "scripts/screenshot/vite.config.ts";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const REPORT_DIR = `${repo}/docs/uat/`;
const SPINNER_SELECTOR = 'span[style*="attn-spin"]';
const WATCH_SELECTORS = [SPINNER_SELECTOR];

const suites = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const suiteFiles =
  suites.length > 0
    ? suites.map((s) => (s.startsWith("/") ? s : `${repo}/${s}`))
    : (await readdir(`${repo}/tests/manual`))
        .filter((name) => name.endsWith(".yaml"))
        .sort()
        .map((name) => `${repo}/tests/manual/${name}`);

if (suiteFiles.length === 0) {
  console.error("uat: no suites found under tests/manual/");
  process.exit(2);
}

// The harness serves the plugin's compiled CSS from dist/ — build first.
try {
  await access(`${repo}/dist/app.css`);
} catch {
  console.error("uat: dist/app.css is missing — run `npm run build` first (the harness serves the compiled bundle).");
  process.exit(2);
}

function startHarness(port) {
  // Spawn the local vite binary directly: going through npx leaves the
  // underlying vite process orphaned when the wrapper is killed.
  const child = spawn(
    process.execPath,
    [`${repo}node_modules/vite/bin/vite.js`, "--config", HARNESS_CONFIG, "--port", String(port), "--strictPort"],
    { cwd: repo, stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.on("data", (chunk) => {
    if (/error/i.test(String(chunk))) process.stderr.write(`  vite: ${String(chunk)}`);
  });
  const base = `http://localhost:${port}/`;
  return {
    base,
    stop: () => child.kill(),
    async waitUp() {
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const response = await fetch(base);
          if (response.ok) return;
        } catch {
          // Not up yet.
        }
        await sleep(200);
      }
      child.kill();
      throw new Error(`uat: harness did not come up on ${base}`);
    },
  };
}

// ---------- in-page probes ----------

const THROBBER_PROBE = `(() => {
  const el = document.querySelector(${JSON.stringify(SPINNER_SELECTOR)});
  if (el === null) return { present: false };
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const animations = el.getAnimations();
  // Occlusion: whatever sits at the ring's painted center point must be the
  // ring itself (or its row) — a chrome overlay painting over the throbber
  // makes it invisible no matter how well it animates (UAT TC-01 regression).
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const atPoint = document.elementFromPoint(cx, cy);
  const hit = atPoint === el ? "ring" : el.contains(atPoint) || atPoint?.contains(el) === true ? "row" : atPoint?.tagName?.toLowerCase() ?? "none";
  return {
    present: true,
    width: rect.width,
    height: rect.height,
    animationName: cs.animationName,
    animationCount: animations.length,
    t0: animations[0]?.currentTime ?? null,
    hit,
  };
})()`;

const THROBBER_PROGRESS = `(() => {
  const el = document.querySelector(${JSON.stringify(SPINNER_SELECTOR)});
  if (el === null) return { present: false };
  return { present: true, t: el.getAnimations()[0]?.currentTime ?? null };
})()`;

function consoleCapture(page) {
  const lines = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) lines.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => lines.push(`pageerror: ${error.message}`));
  return lines;
}

async function clickTab(page, label) {
  await page.evaluate(() => window.__profile?.mark("click-flow-tab"));
  return page.evaluate((target) => {
    const buttons = [...document.querySelectorAll("button")];
    const button = buttons.find((candidate) => candidate.textContent?.trim() === target);
    if (button === undefined) return false;
    button.click();
    return true;
  }, label);
}

/**
 * Hover the first element matching `selector` with a real mouse move, then
 * report what the hover card did. `puppeteer`'s own `hover` is used (not a
 * synthetic pointer event) so the pointerType is genuinely "mouse" and the
 * card's own mouse gate admits it.
 */
async function hoverCard(page, evidenceDir, slug, selector) {
  const handle = await page.$(selector);
  if (handle === null) return { pass: false, detail: `no element for ${selector}`, checks: [] };
  await handle.hover();
  // The card fetches its snippet on hover, so give it a beat to land.
  await sleep(400);
  const probe = await page.evaluate(() => {
    const card = document.querySelector("[data-attn-hover-card]");
    if (card === null) return { present: false };
    const rect = card.getBoundingClientRect();
    const panel = card.closest("[data-bb-plugin]") ?? document.body;
    const panelRect = panel.getBoundingClientRect();
    const title = card.querySelector("[data-attn-hover-title]");
    const snippet = card.querySelector("[data-attn-hover-snippet]");
    // Occlusion: the card is deliberately pointer-events:none (it must never
    // eat a hover), so elementFromPoint is blind to it by design and cannot be
    // used. Paint order is the real question: does any other visible element
    // with a higher stacking order cover the card's center? Compare the card's
    // z-index against every positioned ancestor-sibling that also covers the
    // point, which is what the floating chrome would be.
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const cardZ = Number(getComputedStyle(card).zIndex) || 0;
    const covers = (el) => {
      if (el === card || card.contains(el) || el.contains(card)) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") return false;
      return (Number(cs.zIndex) || 0) >= cardZ;
    };
    const blockers = [...panel.querySelectorAll("*")].filter(covers);
    return {
      present: true,
      width: rect.width,
      height: rect.height,
      title: title?.textContent?.trim() ?? "",
      snippetState: snippet?.getAttribute("data-attn-hover-snippet") ?? "missing",
      snippetText: snippet?.textContent?.trim() ?? "",
      insidePanel:
        rect.left >= panelRect.left - 1 &&
        rect.top >= panelRect.top - 1 &&
        rect.right <= panelRect.right + 1 &&
        rect.bottom <= panelRect.bottom + 1,
      blockerCount: blockers.length,
      blockers: blockers.slice(0, 3).map((el) => el.getAttribute("class") ?? el.tagName),
    };
  });
  const shot = `${evidenceDir}/${slug}.png`;
  await page.screenshot({ path: shot });
  if (!probe.present) {
    return {
      pass: false,
      detail: "no hover card mounted",
      checks: [{ name: "card mounted", ok: false }],
      evidence: shot.replace(`${repo}/`, ""),
    };
  }
  const checks = [
    { name: "card mounted", ok: probe.present },
    { name: "full title present", ok: probe.title.length > 0, detail: probe.title },
    { name: "snippet resolved", ok: probe.snippetState !== "loading" && probe.snippetState !== "missing", detail: probe.snippetState },
    { name: "card inside panel", ok: probe.insidePanel },
    { name: "card not occluded", ok: probe.blockerCount === 0, detail: probe.blockers.join(", ") },
  ];
  const pass = checks.every((c) => c.ok);
  return {
    pass,
    checks,
    detail: pass ? `card "${probe.title}" (${probe.snippetState})` : checks.filter((c) => !c.ok).map((c) => c.name).join("; "),
    evidence: shot.replace(`${repo}/`, ""),
  };
}

/**
 * Assert the burn-rate pulse: every working unit with a rate carries an inline
 * `attn-pulse` animation whose duration follows `pulsePeriodMs`, and a busier
 * thread's duration is strictly shorter. Reads the DOM, so it verifies what the
 * operator actually sees rather than the mapper in isolation.
 */
async function assertPulse(page) {
  const probe = await page.evaluate(() => {
    const units = [...document.querySelectorAll("[data-attn-unit][data-attn-pulse]")];
    if (units.length === 0) return { units: [] };
    return {
      units: units.map((el) => ({
        threadId: el.getAttribute("data-thread-id") ?? "",
        period: Number(el.getAttribute("data-attn-pulse")),
        animation: getComputedStyle(el).animationName,
        duration: getComputedStyle(el).animationDuration,
      })),
    };
  });
  if (probe.units.length === 0) {
    return { pass: false, detail: "no pulsing units carry a period", checks: [{ name: "pulsing units present", ok: false }] };
  }
  const animated = probe.units.filter((u) => u.animation === "attn-pulse");
  const byPeriod = new Map(probe.units.map((u) => [u.period, u]));
  const find = (id) => probe.units.find((u) => u.threadId === id);
  const hot = find("thr_running");
  const slow = find("thr_running_slow");
  // The operator's literal requirement: 10× the tokens, 10× the pulses.
  const ratio = hot && slow ? slow.period / hot.period : null;
  const checks = [
    { name: "every pulsing unit animates", ok: animated.length === probe.units.length, detail: `${animated.length}/${probe.units.length}` },
    { name: "periods are positive", ok: probe.units.every((u) => Number.isFinite(u.period) && u.period > 0) },
    { name: "rates produce distinct periods", ok: byPeriod.size > 1, detail: `${byPeriod.size} distinct period(s)` },
    {
      name: "10× burn is 10× the pulse",
      ok: ratio !== null && Math.abs(ratio - 10) < 0.01,
      detail: ratio === null ? "missing thr_running or thr_running_slow" : `ratio ${ratio.toFixed(3)}`,
    },
  ];
  const pass = checks.every((c) => c.ok);
  return {
    pass,
    checks,
    detail: pass ? `${probe.units.length} pulsing units, ${byPeriod.size} periods` : checks.filter((c) => !c.ok).map((c) => c.name).join("; "),
  };
}

/** The TC-01 heart: mounted/size/animation assertions with a mid-spin screenshot. */async function assertThrobber(page, evidenceDir, slug) {
  const first = await page.evaluate(THROBBER_PROBE);
  if (!first.present) {
    return { pass: false, detail: `no spinner element is mounted during the shape load (selector: ${SPINNER_SELECTOR})` };
  }
  await sleep(300);
  const second = await page.evaluate(THROBBER_PROGRESS);
  const shot = `${evidenceDir}/${slug}.png`;
  await page.screenshot({ path: shot });
  const checks = [
    { name: "spinner mounted", ok: first.present },
    { name: "non-zero box", ok: first.width > 8 && first.height > 8, detail: `${first.width}×${first.height}` },
    { name: "animation is attn-spin", ok: first.animationName === "attn-spin", detail: first.animationName },
    { name: "animation attached", ok: first.animationCount > 0, detail: `${first.animationCount} animation(s)` },
    {
      name: "animation time advances",
      ok: second.present && first.t0 !== null && second.t !== null && second.t > first.t0,
      detail: `${first.t0}ms → ${second.t}ms over the 300ms sample`,
    },
    {
      name: "not occluded by chrome",
      ok: first.hit === "ring" || first.hit === "row",
      detail: first.hit,
    },
  ];
  const pass = checks.every((check) => check.ok);
  return {
    pass,
    checks,
    screenshot: shot.replace(`${repo}/`, ""),
    detail: pass ? "spinner visible and rotating" : checks.filter((check) => !check.ok).map((check) => check.name).join("; "),
  };
}

// ---------- execution ----------

async function runCase(page, evidenceDir, kase) {
  const results = [];
  for (const step of kase.steps) {
    const entry = { order: step.order, action: step.action, pass: false, evidence: "", detail: "" };
    const slug = `${kase.id}-step${step.order}`;
    try {
      switch (step.action) {
        case "goto": {
          // Each case starts clean: drop the recorded navigate calls and the
          // persisted camera/tab store before the app boots, so a previous
          // case's zoom or navigation never leaks into this one.
          await page.evaluateOnNewDocument(() => {
            window.__navCalls = [];
            try {
              window.localStorage.removeItem("activity-overview:camera");
            } catch {
              // localStorage can throw in embedded contexts; a clean start is
              // best-effort and the app tolerates a null store.
            }
          });
          await page.goto(`${harness.base}${step.params?.query ?? ""}`, { waitUntil: "networkidle0", timeout: 20_000 });
          await page.evaluate((selectors) => window.__profile?.watch(selectors), WATCH_SELECTORS);
          await page.evaluate(() => window.__profile?.mark("harness-opened"));
          // Cold-start insurance: the app's module graph (and React mount) can
          // lag the network-idle signal on vite's first transform; wait for
          // the readiness level this scenario needs before touching the UI.
          const level = step.params?.ready ?? "tabs";
          const ready = await page.waitForFunction(
            (mode) => {
              if (window.__profile === undefined) return false;
              if (mode === "profile") return true; // loading UI present is fine
              return document.querySelectorAll("button").length >= 6;
            },
            { polling: 200, timeout: 30_000 },
            level,
          );
          entry.pass = ready !== null;
          entry.detail = entry.pass ? `ready (${level})` : "harness never became ready";
          break;
        }
        case "clickTab": {
          entry.pass = await clickTab(page, step.params.label);
          entry.detail = entry.pass ? `clicked "${step.params.label}"` : `no button with text "${step.params.label}"`;
          break;
        }
        case "assertThrobber": {
          const outcome = await assertThrobber(page, evidenceDir, slug);
          entry.pass = outcome.pass;
          entry.detail = outcome.detail;
          entry.checks = outcome.checks;
          entry.evidence = outcome.screenshot ?? "";
          break;
        }
        case "waitFor": {
          const deadline = Date.now() + (step.params.timeout ?? 8000);
          let found = false;
          while (Date.now() < deadline) {
            found = await page.evaluate((text) => document.body?.innerText?.includes(text) ?? false, step.params.text);
            if (found) break;
            await sleep(100);
          }
          await page.evaluate(() => window.__profile?.mark("flow-tree-found"));
          // One more beat so the profile marks (spinner gone) settle, then
          // verify the spinner unmounted.
          await sleep(250);
          const spinnerGone = await page.evaluate(
            (selector) => document.querySelector(selector) === null,
            SPINNER_SELECTOR,
          );
          entry.pass = found && spinnerGone;
          entry.detail = found
            ? spinnerGone
              ? `tree text "${step.params.text}" painted; spinner unmounted`
              : `tree text "${step.params.text}" painted but the spinner is still mounted`
            : `timeout waiting for text "${step.params.text}"`;
          break;
        }
        case "assertGone": {
          entry.pass = await page.evaluate((selector) => document.querySelector(selector) === null, step.params.selector);
          entry.detail = entry.pass ? "absent" : "still mounted";
          break;
        }
        case "click": {
          // Click the first element matching `selector` (the harness's generic
          // gesture; the app's own attributes are the selectors).
          entry.pass = await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el === null) return false;
            el.click();
            return true;
          }, step.params.selector);
          entry.detail = entry.pass ? `clicked ${step.params.selector}` : `no element for ${step.params.selector}`;
          break;
        }
        case "assertExists": {
          entry.pass = await page.evaluate((selector) => document.querySelector(selector) !== null, step.params.selector);
          entry.detail = entry.pass ? `${step.params.selector} present` : `${step.params.selector} absent`;
          break;
        }
        case "hover": {
          const outcome = await hoverCard(page, evidenceDir, slug, step.params.selector);
          entry.pass = outcome.pass;
          entry.detail = outcome.detail;
          entry.checks = outcome.checks;
          entry.evidence = outcome.evidence ?? "";
          break;
        }
        case "assertPulse": {
          const outcome = await assertPulse(page);
          entry.pass = outcome.pass;
          entry.detail = outcome.detail;
          entry.checks = outcome.checks;
          break;
        }
        case "pointerAway": {
          // Move the real mouse off every unit so hover state can be asserted
          // to clear. A synthetic click would not move the pointer.
          await page.mouse.move(1, 1);
          await sleep(200);
          entry.pass = await page.evaluate(() => document.querySelector("[data-attn-hover-card]") === null);
          entry.detail = entry.pass ? "pointer left; card dismissed" : "card still open after the pointer left";
          break;
        }
        case "assertCount": {          const n = await page.evaluate((selector) => document.querySelectorAll(selector).length, step.params.selector);
          const want = step.params.equals ?? 1;
          entry.pass = n === want;
          entry.detail = `${n} match${n === 1 ? "" : "es"} for ${step.params.selector} (want ${want})`;
          break;
        }
        case "assertNavCalls": {
          // The mock SDK records every toThread call; assert the recorded
          // navigation, its count, and the thread id it fired with.
          const ids = await page.evaluate(() => (window.__navCalls ?? []).map((c) => c.toThread));
          const want = step.params.equals ?? 1;
          const wanted = step.params.threadId;
          const okCount = ids.length === want;
          const okId = wanted === undefined || ids.includes(wanted);
          entry.pass = okCount && okId;
          entry.detail = `nav calls ${JSON.stringify(ids)} (count ${ids.length}, want ${want}${wanted !== undefined ? `, id ${wanted}` : ""})`;
          break;
        }
        case "profile": {
          const shot = `${evidenceDir}/${slug}-final.png`;
          await page.screenshot({ path: shot });
          entry.evidence = shot.replace(`${repo}/`, "");
          entry.profile = await page.evaluate(() => window.__profile.read());
          entry.pass = true;
          break;
        }
        default:
          entry.detail = `unknown action "${step.action}"`;
      }
    } catch (error) {
      entry.detail = `error: ${error.message}`;
      entry.evidence = `${evidenceDir}/${slug}-error.png`;
      await page.screenshot({ path: entry.evidence }).catch(() => {});
    }
    results.push(entry);
  }
  return { results, passed: results.every((entry) => entry.pass) };
}

// Unique port per run: a stray server from an earlier session must never
// serve stale transformed modules to a fresh suite run.
const harness = startHarness(Number(process.env.HARNESS_PORT ?? String(5300 + (process.pid % 600))));
await harness.waitUp();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  // PaintHolding can hide a slow first paint behind the compositor; UAT needs
  // honest paint evidence, not the browser's smoothing.
  args: ["--no-first-run", "--disable-features=PaintHolding,BackForwardCache"],
  defaultViewport: { width: 1280, height: 800 },
});

let anyFailed = false;
await mkdir(REPORT_DIR, { recursive: true });

for (const suiteFile of suiteFiles) {
  const doc = parse(await readFile(suiteFile, "utf8"));
  const suite = doc.test_suite;
  const page = await browser.newPage();
  const consoleLines = consoleCapture(page);
  const evidenceDir = `${REPORT_DIR}/evidence/${suite.id}`;
  await mkdir(evidenceDir, { recursive: true });

  const caseOutputs = [];
  for (const kase of doc.test_cases) {
    const before = await page.metrics();
    const caseResult = await runCase(page, evidenceDir, kase);
    const after = await page.metrics();
    caseOutputs.push({ kase, caseResult, before, after });
    if (!caseResult.passed) anyFailed = true;
  }

  const total = caseOutputs.length;
  const passed = caseOutputs.filter((output) => output.caseResult.passed).length;
  const markdown = [
    `# Test Report: ${suite.title}`,
    "",
    `**Suite ID:** ${suite.id}`,
    `**Date:** ${new Date().toISOString()}`,
    "**Mode:** headless (vite harness + system Chrome)",
    "",
    "## Summary",
    "",
    "| Total | Passed | Failed |",
    "|-------|--------|--------|",
    `| ${total} | ${passed} | ${total - passed} |`,
    "",
    "## Results",
  ];
  for (const { kase, caseResult, before, after } of caseOutputs) {
    markdown.push(
      "",
      `### ${kase.id}: ${kase.title} — ${caseResult.passed ? "PASSED" : "FAILED"}`,
      "",
      `**Criticality:** ${kase.criticality}`,
      "",
      "| Step | Action | Result | Evidence | Notes |",
      "|------|--------|--------|----------|-------|",
    );
    for (const entry of caseResult.results) {
      const notes = [
        entry.detail,
        ...(entry.checks ?? []).map((check) =>
          `${check.ok ? "✔" : "✖"} ${check.name}${check.detail !== undefined ? ` (${check.detail})` : ""}`,
        ),
      ]
        .filter(Boolean)
        .join(" · ");
      markdown.push(`| ${entry.order} | ${entry.action} | ${entry.pass ? "p" : "f"} | ${entry.evidence || "—"} | ${notes.replaceAll("|", "/")} |`);
    }
    const lastProfile = [...caseResult.results].reverse().find((entry) => entry.profile !== undefined)?.profile;
    if (lastProfile !== undefined) {
      const delta = (name) => (after[name] - before[name]).toFixed(1);
      markdown.push(
        "",
        "**Paint profile:**",
        "",
        "- marks (performance.now, ms): " + JSON.stringify(lastProfile.marks),
        "- paint entries: " + JSON.stringify(lastProfile.paint),
        "- longtasks (first 10): " + JSON.stringify(lastProfile.longtasks.slice(0, 10)),
        `- Chrome metrics Δ across the case: Layout ${delta("LayoutDuration")}ms · Script ${delta("ScriptDuration")}ms · Task ${delta("TaskDuration")}ms`,
      );
    }
  }
  if (consoleLines.length > 0) {
    markdown.push("", "## Console capture", "", ...consoleLines.map((line) => `- ${line}`));
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = `${REPORT_DIR}${suite.id}-${stamp}.md`;
  await writeFile(reportPath, markdown.join("\n") + "\n");
  console.log(`uat: ${suite.id} — ${passed}/${total} cases passed; report: ${reportPath.replace(repo + "/", "")}`);

  for (const { kase, caseResult } of caseOutputs) {
    if (caseResult.passed) continue;
    console.error(`uat: FAILED ${kase.id}`);
    for (const entry of caseResult.results) {
      if (entry.pass) continue;
      console.error(`  step ${entry.order} (${entry.action}): ${entry.detail}`);
    }
  }
  await page.close();
}

await browser.close();
harness.stop();
process.exit(anyFailed ? 1 : 0);