/**
 * Animated hero GIF for the README and store page: a scripted tour of the
 * panel's four tabs (Board to Unit treemap to Strip tiles to Token flow),
 * driven with real mouse clicks against the seeded `?demo=1` showcase fixture
 * and assembled with ffmpeg (palettegen/paletteuse) into
 * docs/screenshots/tab-tour.gif.
 *
 * Deterministic: fixed viewport, the fixture's pinned `now`, no wall-clock in
 * any filename or in the assembly. A synthetic cursor rides the frames (a
 * headless screenshot carries no OS pointer, so the GIF shows its own).
 *
 * One-time setup: `npm i` (puppeteer-core drives the system Chrome; ffmpeg
 * must be on PATH). Then:
 *   npm run build        # the harness loads dist/app.css
 *   npm run gif          # boots the harness, captures frames, encodes
 * HARNESS_PORT, CHROME_PATH, OUT_DIR, FRAMES_DIR and GIF_WIDTH override.
 */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const run = promisify(execFile);
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = process.env.OUT_DIR ?? fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const FRAMES_DIR = process.env.FRAMES_DIR ?? (await mkdtemp(path.join(os.tmpdir(), "tab-tour-gif-")));
const GIF_PATH = path.join(OUT_DIR, "tab-tour.gif");
const GIF_WIDTH = Number(process.env.GIF_WIDTH ?? "1100");
const PORT = Number(process.env.HARNESS_PORT ?? 5311);

const CURSOR_SVG = `
<svg id="gif-cursor" width="21" height="28" viewBox="0 0 21 28"
     style="position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;
            filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.55))" aria-hidden="true">
  <path d="M2.5 1.5 L2.5 20.5 L7.6 15.8 L10.7 23.4 L14.3 21.9 L11.2 14.4 L17.5 14.4 Z"
        fill="#fff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`;

const harness = await startHarness(PORT);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const frames = [];

async function moveCursor(x, y) {
  await page.mouse.move(x, y);
  await page.evaluate(
    (px, py) => {
      const cursor = document.getElementById("gif-cursor");
      if (cursor !== null) cursor.style.transform = `translate(${px}px, ${py}px)`;
    },
    x,
    y,
  );
}

/** The center of the tab button reading `label`, scrolled into view. */
async function tabCenter(label) {
  const rect = await page.evaluate((text) => {
    const button = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === text);
    if (button === undefined) return null;
    button.scrollIntoView({ block: "nearest", behavior: "instant" });
    const r = button.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (rect === null) throw new Error(`no tab button reading "${label}"`);
  return rect;
}

async function shoot(name) {
  await page.screenshot({ path: path.join(FRAMES_DIR, `${name}.png`), timeout: 30_000 });
  frames.push(name);
  console.log(`  ${name}`);
}

/** The working-dot pulse and bead motion are live; hold each tab long enough
 *  to read, and carry every duration in the concat list (fps is constant). */
const HELD_MS = 1500;
const APPROACH_MS = 260;

try {
  await mkdir(OUT_DIR, { recursive: true });
  await page.goto(`${harness.base}?demo=1&tab=board`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-attn-stage]", { timeout: 30_000 });
  // Dark, matching the static screenshots and the store shots: the `dark` class
  // drives the token set, prefers-color-scheme drives media-based dark: rules.
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.evaluate((svg) => document.body.insertAdjacentHTML("beforeend", svg), CURSOR_SVG);
  await sleep(900);
  await moveCursor(1150, 720);
  await shoot("00-board");

  const tour = [
    { label: "Unit treemap", ready: "[data-attn-stage]" },
    { label: "Strip tiles", ready: "[data-attn-stage]" },
    { label: "Token flow", ready: 'svg[aria-label="token flow swimlanes"]' },
  ];

  let index = 1;
  for (const step of tour) {
    const n = String(index).padStart(2, "0");
    const target = await tabCenter(step.label);
    await moveCursor(target.x - 26, target.y - 14);
    await sleep(APPROACH_MS);
    await shoot(`${n}-approach`);
    await moveCursor(target.x, target.y);
    await page.mouse.click(target.x, target.y);
    await page.waitForSelector(step.ready, { timeout: 15_000 });
    await sleep(HELD_MS);
    await shoot(`${n}-${step.label.split(" ")[0].toLowerCase()}`);
    index += 1;
  }
  // The token-flow beads keep drifting; one more held frame reads as motion.
  await sleep(HELD_MS);
  await shoot(`${String(index).padStart(2, "0")}-flow-live`);

  const durations = {
    "00-board": 1.6,
    "01-approach": 0.3,
    "01-unit": 1.6,
    "02-approach": 0.3,
    "02-strip": 1.6,
    "03-approach": 0.3,
    "03-token": 1.6,
    "04-flow-live": 1.6,
  };
  const list = path.join(FRAMES_DIR, "frames.txt");
  const entries = frames.map((name) => `file '${name}.png'\nduration ${durations[name] ?? 0.3}`);
  // The concat demuxer ignores the last entry's duration, so list the final
  // frame twice to carry its hold.
  entries.push(`file '${frames.at(-1)}.png'\nduration 0.1`);
  await writeFile(list, `${entries.join("\n")}\n`);

  const filter = [
    "fps=12",
    `scale=${GIF_WIDTH}:-2:flags=lanczos`,
    "split[a][b]",
    "[a]palettegen=max_colors=192[p]",
    "[b][p]paletteuse=dither=bayer:bayer_scale=4",
  ].join(",");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", filter, "-loop", "0", GIF_PATH]);
  console.log(`done — ${frames.length} frames in ${FRAMES_DIR}; wrote ${GIF_PATH}`);
} finally {
  await browser.close().catch(() => {});
  harness.stop();
}
