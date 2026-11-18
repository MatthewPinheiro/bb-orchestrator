// Opening Post never moves the Open PRs list (2026-11-18, the owner: "when you click 'post a code review,' the
// checkboxes come up then. it's just too much to scroll"). Run it against a harness or a bb you seeded yourself:
//   node test/e2e/open-prs-post.mjs <Open PRs page URL> [--live]
// The URL is required, and the live app (127.0.0.1:38886) is refused unless --live is given too (live-guard.ts). It
// only opens Post and closes it with Escape: it never presses Post's send or its confirm.
// It fails unless, at 1680 and 800 wide and on a short 1280x600 screen: the list never scrolls sideways; its top and
// height and the page's scroll height are the same with Post open as before; Post is a dialog that fits the screen,
// holding the ticks, the preview and its buttons (the preview scrolls inside it, not the page); and Escape closes it.
import assert from "node:assert/strict";
import { checkBase } from "./live-guard.ts";
const argv = process.argv.slice(2);
const live = argv.includes("--live");
const url = checkBase(argv.find((a) => a !== "--live"), live);
// Playwright loads only after the URL passed the guard
const { chromium } = await import("playwright-core");
const browser = await chromium.launch();
const errors = [];
/** Where the list sits and how tall the page's scrolling box is: what opening Post must not change. */
const measure = (page) =>
  page.evaluate(() => {
    const list = document.querySelector("[data-prs-list], [data-prs-cards]");
    if (!list) return null;
    let box = list.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    const r = list.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height), scroll: (box ?? document.scrollingElement).scrollHeight, sideways: list.scrollWidth > list.clientWidth + 1 };
  });
try {
  for (const [width, height] of [[1680, 1050], [800, 1000], [1280, 600]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.locator("[data-prs-list], [data-prs-cards]").first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
    const before = await measure(page);
    assert.equal(before.sideways, false, `${width}: the list scrolls sideways`);
    await page.click("[data-post-open]");
    await page.locator("[data-post]").waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const open = await measure(page);
    assert.deepEqual(open, before, `${width}: opening Post moved the list or grew the page ${JSON.stringify({ before, open })}`);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 10000 });
    assert.ok((await dialog.locator("[data-tick]").count()) > 0, `${width}: the ticks are in Post's dialog`);
    assert.equal(await dialog.locator("[data-post-text]").count(), 1, `${width}: the preview is in Post's dialog`);
    assert.equal(await page.locator("[data-tick]:not([role=dialog] *)").count(), 0, `${width}: no ticks on the page itself`);
    const db = await dialog.boundingBox();
    assert.ok(db && db.y >= 0 && db.y + db.height <= height, `${width}x${height}: Post's dialog fits the screen ${JSON.stringify(db)}`);
    for (const b of ["[data-post-prepare], [data-post-confirm]", "[data-tick]"]) {
      const bb = await dialog.locator(b).first().boundingBox();
      assert.ok(bb && bb.y >= 0 && bb.y + bb.height <= height, `${width}x${height}: ${b} shows without scrolling`);
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 10000 });
    assert.deepEqual(await measure(page), before, `${width}: closing Post leaves the list as it was`);
    console.log(`${width}x${height}: list ${JSON.stringify(before)} unchanged with Post open; dialog ${Math.round(db.height)}px tall`);
    await page.close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("ok");
} finally {
  await browser.close();
}
