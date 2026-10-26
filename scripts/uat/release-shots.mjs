/**
 * Store-evidence run: the release-safety screenshot matrix a cut reviews before
 * tagging — the four tabs at desktop, a light-theme board, narrower and phone
 * layouts, and the What's-new modal a first-time updater sees. Rendered from
 * the seeded `?demo=1` showcase fixture against the real app in the harness.
 *
 * Ported from the Focus Board plugin's scripts/uat/release-shots.mjs. Captures
 * into docs/release-safety/ (gitignored, release-time evidence — never the
 * committed store screenshots, which docs/screenshot/shoot.mjs owns) and exits
 * non-zero if any shot fails, so a broken view stops the release.
 *
 *   npm run build          # the harness loads dist/app.css
 *   npm run release-shots  # boots the harness, captures, exits
 * CHROME_PATH, OUT_DIR and HARNESS_PORT override the defaults.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { startHarness } from "./harness.mjs";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = process.env.OUT_DIR ?? fileURLToPath(new URL("../../docs/release-safety/", import.meta.url));
const PORT = Number(process.env.HARNESS_PORT ?? 5312);

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  narrow: { width: 1280, height: 800, deviceScaleFactor: 2 },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 2 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2 },
};

const READY = {
  board: "[data-attn-stage]",
  treemap: "[data-attn-stage]",
  tiles: "[data-attn-stage]",
  tokenflow: 'svg[aria-label="token flow swimlanes"]',
};

const SHOTS = [
  { name: "board-desktop", viewport: "desktop", tab: "board" },
  { name: "treemap-desktop", viewport: "desktop", tab: "treemap" },
  { name: "tiles-desktop", viewport: "desktop", tab: "tiles" },
  { name: "tokenflow-desktop", viewport: "desktop", tab: "tokenflow" },
  { name: "board-desktop-light", viewport: "desktop", tab: "board", theme: "light" },
  { name: "board-narrow", viewport: "narrow", tab: "board" },
  { name: "board-tablet", viewport: "tablet", tab: "board" },
  { name: "board-phone", viewport: "phone", tab: "board" },
  { name: "tokenflow-phone", viewport: "phone", tab: "tokenflow" },
  { name: "modal-whats-new-desktop", viewport: "desktop", tab: "board", modal: true },
];

const harness = await startHarness(PORT);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });

const failures = [];
try {
  await mkdir(OUT_DIR, { recursive: true });
  for (const shot of SHOTS) {
    const theme = shot.theme ?? "dark";
    console.log(`  ${shot.name}`);
    const page = await browser.newPage();
    try {
      await page.setViewport(VIEWPORTS[shot.viewport]);
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
      await page.goto(`${harness.base}?demo=1&tab=${shot.tab}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector(READY[shot.tab], { timeout: 30_000 });
      await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
      await sleep(600);
      if (shot.modal) {
        await page.evaluate(() => {
          const button = document.querySelector('button[aria-label="What\'s new"]');
          if (button === null) throw new Error("the What's-new button is missing");
          button.click();
        });
        await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
        await sleep(400);
      }
      await page.screenshot({ path: `${OUT_DIR}${shot.name}.png`, timeout: 30_000 });
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
  throw new Error(`${failures.length} of ${SHOTS.length} release-safety shots failed`);
}
console.log(`${SHOTS.length} shots captured in ${OUT_DIR}`);
