// The proof run against the real bb app: the standalone Game Boy page (/plugins/gameboy/play, no thread), opened in a
// split beside the Orchestrator's page from the rail's "Open in split". Upload a homebrew test ROM through the page's
// file picker, see it render, reload, leave and come back, replace the ROM, check saves (this browser's IndexedDB, the
// 30-second flush, the server backup, a fresh browser) and an Emerald-sized upload. Screenshots go to evidence/gameboy/.
//   node test/e2e/play.mjs <romDir>
import { chromium } from "playwright-core";

const [romDir] = process.argv.slice(2);
const APP = "http://127.0.0.1:38886";
const PAGE = `${APP}/plugins/gameboy/play`;
const OUT = process.env.EVIDENCE_DIR ?? "./evidence";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const game = (page) => page.frameLocator('iframe[title="Game Boy"]');
const gameFrame = (page) => page.frames().find((f) => f.url().includes("/plugins/gameboy/http/play"));
async function waitStarted(page, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const f = gameFrame(page);
    if (f && (await f.evaluate(() => !!(window.EJS_emulator && window.EJS_emulator.started)).catch(() => false))) return f;
    await page.waitForTimeout(500);
  }
  return null;
}
const info = (page) => page.evaluate(async () => (await fetch("/api/v1/plugins/gameboy/http/rom/info")).json());
const saveOf = (f) =>
  f.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    const p = gm.getSaveFilePath();
    const b = gm.FS.analyzePath(p).exists ? gm.FS.readFile(p) : null;
    return { path: p, size: b ? b.length : 0, sum: b ? Array.from(b).reduce((a, x) => (a * 31 + x) >>> 0, 7) : 0 };
  });
const railGame = (page) => page.getByRole("button", { name: "Game Boy", exact: true }).first();
async function openInSplit(page) {
  await railGame(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in split" }).click();
}

const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(m.text()));

// 1. the Orchestrator's page, then the rail's Game Boy entry > Open in split: the game opens beside it, no thread
await page.goto(`${APP}/plugins/orchestrator/home`, { waitUntil: "load" });
await railGame(page).waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);
await openInSplit(page);
await game(page).locator("#choose").waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/01-split-beside-orchestrator-before-upload.png` });
const url1 = page.url();
check("the Game Boy page opens in a split beside the Orchestrator, with no thread in the URL", !/threads\//.test(url1) && (await page.getByText("Deliverables").first().isVisible()), url1);
check("the page shows the ROM picker before any upload", await game(page).locator("#choose").isVisible());

// 2. upload arm.gba through the page's file input; the page reloads and boots it
await game(page).locator("#file").setInputFiles(`${romDir}/arm.gba`);
let f = await waitStarted(page);
check("arm.gba boots in the split pane after upload", !!f);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/02-arm-running-in-split.png` });
const canvasBox = await game(page).locator("#game canvas").first().boundingBox();
const iframeBox = await page.locator('iframe[title="Game Boy"]').boundingBox();
check(
  "the GBA screen fills the pane's width at 3:2",
  canvasBox && iframeBox && canvasBox.width >= iframeBox.width - 2 && Math.abs(canvasBox.width / canvasBox.height - 1.5) < 0.02,
  `canvas ${Math.round(canvasBox?.width)}x${Math.round(canvasBox?.height)} in a ${Math.round(iframeBox?.width)} px pane`,
);

// 3. keyboard: a click on the game focuses the emulator's element, and a key reaches it
await game(page).locator("#game canvas").first().click();
f = gameFrame(page);
check("clicking the game gives it keyboard focus", await f.evaluate(() => document.activeElement === window.EJS_emulator.elements.parent));
await f.evaluate(() => {
  window.__lastKey = null;
  window.EJS_emulator.elements.parent.addEventListener("keydown", (e) => { window.__lastKey = e.key; });
});
await page.keyboard.press("Enter");
const lastKey = await f.evaluate(() => window.__lastKey);
check("a key press reaches the emulator after the click", lastKey === "Enter", `emulator saw ${lastKey}`);

// 4. reload bb on the standalone page: the uploaded ROM is still there
await page.goto(PAGE, { waitUntil: "load" });
f = await waitStarted(page);
const name1 = f && (await f.evaluate(() => document.getElementById("name").textContent));
check("after a reload the page boots the uploaded ROM again, without a new upload", name1 === "arm.gba", `name ${name1}`);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/03-arm-after-reload.png` });

// 5. leaving the page in a single pane (bb unmounts it) and coming back resumes the game from the kept state. Its own
// browser context: this one keeps the split from step 1, where the Orchestrator rail button focuses the other pane.
{
  const c = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await c.newPage();
  const l = [];
  p.on("console", (m) => l.push(m.text()));
  const frames = () => p.frames().filter((x) => x.url().includes("/plugins/gameboy/http/play")).length;
  await p.goto(PAGE, { waitUntil: "load" });
  await waitStarted(p);
  await p.waitForTimeout(2000);
  await p.getByRole("button", { name: /^Orchestrator/ }).first().click();
  await p.waitForTimeout(2000);
  const gone = frames() === 0;
  await railGame(p).click();
  await waitStarted(p);
  await p.waitForTimeout(1500);
  check("leaving the page unmounts it, and coming back resumes the game from the kept state", gone && l.includes("gameboy: resumed from the suspended state"), `iframe gone while away: ${gone}`);
  await c.close();
}

// 6. Replace ROM with sram.gba (a homebrew save test)
await game(page).locator("#file").setInputFiles(`${romDir}/sram.gba`);
await page.waitForTimeout(1500);
f = await waitStarted(page);
const name2 = f && (await f.evaluate(() => document.getElementById("name").textContent));
check("Replace ROM swaps the game", name2 === "sram.gba", `name ${name2}`);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/04-sram-running.png` });
// the 30-second flush, untouched by the test: EmulatorJS's interval, the page's hook and the upload, as the user gets them
const infoBefore = await info(page);
await page.waitForTimeout(36000);
const infoAfter = await info(page);
check(
  "the 30-second flush backs the save up with no help from the test",
  infoBefore.save === null && infoAfter.save && infoAfter.save.size > 0,
  `before ${JSON.stringify(infoBefore.save)}, after ${JSON.stringify(infoAfter.save)}`,
);
const save1 = await saveOf(f);
check("the game's SRAM is in its save file, the same size as the server copy", save1.size > 0 && save1.size === infoAfter.save?.size, `${save1.path}, ${save1.size} bytes`);

// 7. reload: the save is found in this browser's IndexedDB at boot, with no server restore
const mark7 = logs.length;
await page.goto(PAGE, { waitUntil: "load" });
f = await waitStarted(page);
const save2 = await saveOf(f);
const boot7 = logs.slice(mark7).filter((l) => l.startsWith("gameboy:"));
check(
  "after a reload the save is still in this browser",
  save2.sum === save1.sum && boot7.includes("gameboy: local save present at boot") && !boot7.includes("gameboy: restored the server save"),
  `${save2.size} bytes; ${boot7.join("; ")}`,
);

// 8. a fresh browser (empty IndexedDB, like another device) restores the server's save before the game boots
const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page2 = await ctx2.newPage();
const logs2 = [];
page2.on("console", (m) => logs2.push(m.text()));
await page2.goto(PAGE, { waitUntil: "load" });
const f2 = await waitStarted(page2);
const save3 = await saveOf(f2);
const boot8 = logs2.filter((l) => l.startsWith("gameboy:"));
check(
  "a fresh browser gets the server's save before the game boots",
  save3.sum === save1.sum && boot8.includes("gameboy: local save absent at boot") && boot8.includes("gameboy: restored the server save"),
  `${save3.size} bytes; ${boot8.join("; ")}`,
);
await page2.waitForTimeout(2000);
await page2.screenshot({ path: `${OUT}/05-fresh-browser-restored.png` });
await ctx2.close();

// 9. an Emerald-sized (16 MiB) ROM through the page's own upload path: base64 in the browser, POST, download, boot
await game(page).locator("#file").setInputFiles(`${romDir}/big16.gba`);
await page.waitForTimeout(1500);
f = await waitStarted(page, 120000);
const big = await info(page);
check("a 16 MiB ROM uploads through the page and boots", !!f && big.rom && big.rom.size === 16777216, `server ROM ${big.rom && big.rom.size} bytes`);

// 10. back to sram.gba (its save comes back), shown in a split beside a thread, left in place for the user to replace
await game(page).locator("#file").setInputFiles(`${romDir}/sram.gba`);
await page.waitForTimeout(1500);
f = await waitStarted(page);
await page.getByText(/^Lead · /).first().click();
await page.waitForTimeout(2000);
await openInSplit(page);
f = await waitStarted(page);
await page.waitForTimeout(3000);
const iw = await page.locator('iframe[title="Game Boy"]').boundingBox();
await page.screenshot({ path: `${OUT}/06-split-beside-thread.png` });
check("the page opens in a split beside a thread too, with the game running", !!f && iw && iw.width < 1000, `pane ${Math.round(iw?.width)} px wide`);
await game(page).locator("#game").hover();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/07-controls-on-hover.png` });

console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
await browser.close();
