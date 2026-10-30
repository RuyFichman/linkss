// Local-only gallery regression: trusted touch input, autoplay, reduced motion and previews.
// BASE_URL defaults to http://localhost:3100; PLAYWRIGHT_MODULE may point to bundled Playwright.
// No account, database access or external request is needed.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = process.env.BASE_URL ?? "http://localhost:3100";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Only a local app may be tested.");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("test-results/showcase-gallery");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "chrome" }) });
const results = {};
const errors = [];
const touchSessions = new WeakMap();
const railOffset = (page) => page.locator(".showcase-rail").evaluate((rail) => rail.scrollLeft);

async function open(options) {
  const context = await browser.newContext({ deviceScaleFactor: 1, ...options });
  await context.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator(".showcase-rail[data-looping]").waitFor();
  await page.locator(".showcase-rail").scrollIntoViewIfNeeded();
  return { context, page };
}

async function swipe(page, dx, dy) {
  const rail = page.locator(".showcase-rail");
  const box = await rail.boundingBox();
  const x = dx < 0 ? 300 : 70;
  const y = Math.max(100, box.y + 250);
  let cdp = touchSessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    touchSessions.set(page, cdp);
  }
  const touch = (x, y) => ({ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(x, y)] });
  const offsets = [];
  for (let step = 1; step <= 12; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touch(x + dx * step / 12, y + dy * step / 12)] });
    offsets.push(await railOffset(page));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  offsets.push(await railOffset(page));
  return offsets;
}

try {
  const { context: mobile, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  // Verify native taps before CDP gestures: Chromium's injected swipe stream suppresses
  // later compatibility clicks even on a plain button with no application listeners.
  await page.locator('[data-showcase-original="photography"]').tap();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Fechar janela", exact: true }).tap();
  await page.evaluate(() => {
    window.galleryPointerEvents = [];
    const rail = document.querySelector(".showcase-rail");
    for (const type of ["pointerdown", "gotpointercapture", "lostpointercapture", "pointercancel", "pointerup"]) {
      rail.addEventListener(type, (event) => window.galleryPointerEvents.push({ type, target: event.target.className, trusted: event.isTrusted }));
    }
  });
  const before = await railOffset(page);
  const forward = await swipe(page, -240, 0);
  results.touch = { before, offsets: forward, tapPreview: true, events: await page.evaluate(() => window.galleryPointerEvents) };
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  assert(forward.at(-1) - before > 200, "A touch swipe must continue moving after capture transfers from the preview button to the rail.");
  assert(forward.at(-1) - forward[3] > 100, "Later touch moves must keep advancing the gallery.");
  assert.equal(await page.getByRole("dialog").count(), 0, "Dragging must not open a preview.");
  const reverse = await swipe(page, 200, 0);
  results.touch.reverse = reverse;
  results.touch.events = await page.evaluate(() => window.galleryPointerEvents);
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  assert(forward.at(-1) - reverse.at(-1) > 170, "Touch dragging must work in both directions.");
  const verticalBefore = await page.evaluate(() => scrollY);
  const horizontalBefore = await railOffset(page);
  await swipe(page, 0, -160);
  await page.waitForFunction((before) => scrollY > before + 80, verticalBefore);
  assert(Math.abs(await railOffset(page) - horizontalBefore) < 5, "Vertical page scrolling must not drag the gallery sideways.");
  results.touch.verticalScroll = true;
  await page.locator(".showcase-controls").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Iniciar movimento", exact: true }).click();
  const started = await railOffset(page);
  await page.waitForFunction((before) => document.querySelector(".showcase-rail").scrollLeft > before + 10, started);
  await page.getByRole("button", { name: "Pausar movimento", exact: true }).click();
  results.reducedMotionOptIn = true;
  await page.screenshot({ path: resolve(output, "mobile.png") });
  await mobile.close();

  const { context: desktop, page: pc } = await open({ viewport: { width: 1280, height: 1000 }, reducedMotion: "no-preference" });
  const start = await railOffset(pc);
  await pc.waitForFunction((before) => document.querySelector(".showcase-rail").scrollLeft > before + 15, start);
  results.desktopAutoplay = true;
  await pc.getByRole("button", { name: "Pausar movimento", exact: true }).click();
  const paused = await railOffset(pc);
  // Observe browser frames instead of sleeping against the wall clock.
  await pc.evaluate(() => new Promise((resolve) => { let frames = 0; function next() { if (++frames >= 12) resolve(); else requestAnimationFrame(next); } requestAnimationFrame(next); }));
  assert.equal(await railOffset(pc), paused, "Pause must hold the carousel still.");
  const railBox = await pc.locator(".showcase-rail").boundingBox();
  await pc.mouse.move(650, railBox.y + 250);
  await pc.mouse.down();
  await pc.mouse.move(400, railBox.y + 250, { steps: 12 });
  await pc.mouse.up();
  assert(await railOffset(pc) - paused > 200, "Mouse dragging must still work on desktop.");
  assert.equal(await pc.getByRole("dialog").count(), 0);
  await pc.getByRole("button", { name: "Retomar movimento", exact: true }).click();
  const resumed = await railOffset(pc);
  await pc.waitForFunction((before) => document.querySelector(".showcase-rail").scrollLeft > before + 10, resumed);
  results.desktopPauseResumeAndDrag = true;
  await pc.getByRole("button", { name: "Pausar movimento", exact: true }).click();
  const originals = pc.locator("[data-showcase-original]");
  const count = await originals.count();
  assert(count >= 10);
  const newPages = ["jewelry", "bakery", "yoga", "bookshop", "outdoors"];
  for (const id of newPages) {
    const button = pc.locator(`[data-showcase-original="${id}"]`);
    assert.equal(await button.count(), 1, `The ${id} page must have one accessible preview.`);
    await button.focus();
    await button.press("Enter");
    assert(await pc.getByRole("dialog").isVisible());
    await pc.locator(".showcase-full").screenshot({ path: resolve(output, `${id}.png`) });
    await pc.getByRole("dialog").press("Escape");
    assert(await button.evaluate((element) => element === document.activeElement));
  }
  results.newPreviews = newPages.length;
  results.accessibility = await pc.evaluate(() => ({ originals: document.querySelectorAll("[data-showcase-original]").length, tabbableClones: document.querySelectorAll('.showcase-item[aria-hidden="true"] button:not([tabindex="-1"])').length }));
  assert.equal(results.accessibility.tabbableClones, 0);
  await pc.screenshot({ path: resolve(output, "desktop.png") });
  results.responsive = [];
  for (const width of [320, 390, 768, 1280]) {
    await pc.setViewportSize({ width, height: 1000 });
    const overflow = await pc.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `The document must not overflow at ${width}px.`);
    results.responsive.push({ width, overflow });
  }
  await desktop.close();
  assert.deepEqual(errors, []);
  results.errors = errors;
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log("PASS touch, vertical scrolling, reduced-motion opt-in, desktop autoplay/pause/drag and previews");
} finally {
  await browser.close();
}
