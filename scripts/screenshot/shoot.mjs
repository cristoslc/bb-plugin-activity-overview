/**
 * Screenshot driver: renders the harness (the real plugin app against the mock
 * SDK) in headless Chrome and captures the README + store screenshots into
 * docs/screenshots/. Deterministic by construction: fixed viewports, the
 * seeded `?demo=1` showcase fixture, and no wall-clock in any filename or in
 * the captured content (the fixture pins its own `now`).
 *
 * The store listing (store/entry.json) references a subset of these by name, so
 * a rename here is a listing change; `npm run store:check` catches the drift.
 *
 * One-time setup: `npm i` (puppeteer-core drives the system Chrome). Then:
 *   npm run build        # the harness loads dist/app.css
 *   npm run shots        # boots the harness, captures, exits
 * CHROME_PATH, OUT_DIR and HARNESS_PORT override the defaults.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.OUT_DIR ?? fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const PORT = Number(process.env.HARNESS_PORT ?? 5310);

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2 },
};

// name → the file the README and store/entry.json reference.
const SHOTS = [
  { name: "board-dark", viewport: "desktop", tab: "board", theme: "dark" },
  { name: "board-light", viewport: "desktop", tab: "board", theme: "light" },
  { name: "treemap-dark", viewport: "desktop", tab: "treemap", theme: "dark" },
  { name: "tiles-dark", viewport: "desktop", tab: "tiles", theme: "dark" },
  { name: "tokenflow-dark", viewport: "desktop", tab: "tokenflow", theme: "dark" },
  { name: "phone-board-dark", viewport: "phone", tab: "board", theme: "dark" },
];

/** Tab ids whose view has extra layout to settle before it is photographed. */
const READY = {
  board: "[data-attn-stage]",
  treemap: "[data-attn-stage]",
  tiles: "[data-attn-stage]",
  tokenflow: 'svg[aria-label="token flow swimlanes"]',
};

const harness = await startHarness(PORT);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

const failures = [];
try {
  await mkdir(OUT, { recursive: true });
  for (const shot of SHOTS) {
    console.log(`  ${shot.name}`);
    // One page per shot: flipping a shared page's emulation state wedges
    // Chrome's emulation mid-run, so each shot gets its own page.
    const page = await browser.newPage();
    try {
      await page.setViewport(VIEWPORTS[shot.viewport]);
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: shot.theme }]);
      await page.goto(`${harness.base}?demo=1&tab=${shot.tab}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector(READY[shot.tab], { timeout: 30_000 });
      // The `dark` class drives the token set; prefers-color-scheme drives any
      // media-based dark: utilities. Production parity needs both.
      await page.evaluate((theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
      }, shot.theme);
      await sleep(700);
      await page.screenshot({ path: `${OUT}${shot.name}.png`, timeout: 30_000 });
    } catch (error) {
      failures.push(`${shot.name}: ${error?.message ?? error}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close().catch(() => {});
  harness.stop();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAILED ${failure}`);
  throw new Error(`${failures.length} of ${SHOTS.length} screenshots failed`);
}
console.log(`${SHOTS.length} screenshots in ${OUT}`);
