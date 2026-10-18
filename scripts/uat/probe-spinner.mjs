/**
 * One-off forensic probe: during the flow view's loading window, measure the
 * throbber's computed styles, run a bare utility-class control element, and
 * pull CDP's matched-styles stack to find which rule (if any) actually wins
 * for width/height — chasing the invisible-spinner root cause.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const port = 5300 + Math.floor(Math.random() * 600);
const child = spawn(process.execPath, [`${repo}node_modules/vite/bin/vite.js`, "--config", "scripts/screenshot/vite.config.ts", "--port", String(port), "--strictPort"], { cwd: repo, stdio: "ignore" });
const base = `http://localhost:${port}/`;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(base)).ok) break; } catch { /**/ }
  await sleep(200);
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));

await page.goto(`${base}?shapeDelay=3000`, { waitUntil: "networkidle0" });
for (let i = 0; i < 200; i++) {
  const ready = await page.evaluate(() => window.__profile !== undefined && document.querySelectorAll("button").length >= 6);
  if (ready) break;
  await sleep(100);
}
await page.evaluate(() => {
  window.__profile.watch(['span[style*="attn-spin"]']);
  window.__profile.mark("click");
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Activity flow");
  button?.click();
});
await sleep(1200);

const basic = await page.evaluate(() => {
  const el = document.querySelector('span[style*="attn-spin"]');
  if (el === null) return { present: false };
  const cs = getComputedStyle(el);
  const make = (wrapper) => {
    const control = document.createElement("div");
    control.className = "w-4 h-4 bg-card";
    control.style.border = "2px solid red";
    if (wrapper === null) document.body.appendChild(control);
    else { wrapper.setAttribute("data-bb-plugin", "activity-overview"); document.body.appendChild(wrapper); wrapper.appendChild(control); }
    const r = control.getBoundingClientRect();
    const c = getComputedStyle(control);
    return { wrap: wrapper === null ? "plain" : "scoped", width: r.width, height: r.height, bg: c.backgroundColor, display: c.display };
  };
  const results = [make(null), make(document.createElement("div")), make(document.createElement("div"))];
  return {
    spinnerRect: (() => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
    spinnerComputed: { display: cs.display, width: cs.width, height: cs.height, boxSizing: cs.boxSizing },
    parentComputed: { display: getComputedStyle(el.parentElement).display },
    controls: results,
  };
});
console.log(JSON.stringify(basic, null, 2));
if (basic.present) {
  const cdp = await page.createCDPSession();
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const controlNode = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".w-4.h-4" });
  const cardNode = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".bg-card" });
  if (cardNode.nodeId !== 0) await dumpMatched("flowcard.bg-card", cardNode.nodeId);
  const dumpMatched = async (label, nodeId) => {
    const { matchedCSSRules } = await cdp.send("CSS.getMatchedStylesForNode", { nodeId });
    const summarized = (matchedCSSRules ?? []).map((entry) => ({
      selector: entry.rule.selectorList?.text?.slice(0, 100),
      origin: entry.rule.origin,
      css: entry.rule.style?.cssText?.slice(0, 100) ?? JSON.stringify({ noStyleRule: true, type: entry.rule.__type, media: entry.rule.media?.text }),
    }));
    console.log(`MATCHED(${label}) count=${summarized.length}`, JSON.stringify(summarized, null, 2));
  };
  await dumpMatched("control.w-4", controlNode.nodeId);
  if (cardNode.nodeId !== 0) await dumpMatched("flowcard.bg-card", cardNode.nodeId);
  // Sheet structure: where does .w-4 sit (layer/media nesting), and is the
  // sheet disabled/media-limited?
  const structure = await page.evaluate(() => {
    const out = [];
    const walk = (rules, path, depth) => {
      for (const rule of rules) {
        if (depth > 3) return;
        const name = rule.constructor.name;
        if (rule.selectorText !== undefined) {
          if (rule.selectorText.includes(".w-4") || rule.selectorText.includes(".bg-card")) {
            out.push({ path: path.join(">"), selector: rule.selectorText.slice(0, 90) });
          }
        } else if (rule.cssRules !== undefined) {
          walk(rule.cssRules, [...path, `${name}${rule.conditionText ?? rule.name ?? "" ? `(${rule.conditionText ?? rule.name})` : ""}`], depth + 1);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { out.push({ path: "INACCESSIBLE", href: sheet.href }); continue; }
      out.push({ sheetHead: (sheet.ownerNode?.textContent ?? sheet.href ?? "?").slice(0, 120) });
      walk(rules, [], 0);
    }
    return { sheets: document.styleSheets.length, out };
  });
  console.log("STRUCTURE:", JSON.stringify(structure, null, 2));
}
await browser.close();
child.kill();