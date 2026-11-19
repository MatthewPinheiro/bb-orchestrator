// The AI player's proof run, against a test harness only (never the live app: each turn is a paid API call). The
// harness must have a ROM and a save in place and the aiPlayer* settings set. It opens the /play page, continues the
// game to the overworld, turns "<name> plays" on, records a clip while the AI plays, then presses a key as the owner and
// checks that the loop stopped and said so. The clip, a screenshot with the line showing, and every line seen go to OUT.
//   node gameboy/test/e2e/ai-player.mjs <base> <outDir> [playSeconds]
import { mkdirSync, writeFileSync } from "node:fs";
import { checkBase } from "../../../test/e2e/live-guard.ts";

const [given, OUT, secs = "45"] = process.argv.slice(2);
const base = checkBase(given, false); // no --live: this spends real calls
if (!OUT) throw new Error("an output folder is required");
mkdirSync(OUT, { recursive: true });
const PLAY_MS = Math.min(60, Math.max(20, Number(secs))) * 1000;
const PAGE = `${base}/api/v1/plugins/orchestrator/http/gameboy/play`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 720, height: 560 }, recordVideo: { dir: OUT, size: { width: 720, height: 560 } } });
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(PAGE, { waitUntil: "load" });
await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, null, { timeout: 120000 });
const info = await page.evaluate(async () => (await fetch("player/info", { cache: "no-store" })).json());
check("the harness has the AI player set up", info.ready, `name ${info.name}, today ${info.today}`);
await page.locator("#aiwrap").waitFor({ state: "visible", timeout: 10000 });
const label = await page.locator("#ainame").textContent();
check('the toggle reads "<name> plays"', label === `${info.name} plays`, label);

// to the overworld as the owner would (title, Continue), before the AI is on: these presses must not count
const B = { A: 8, START: 3 };
const press = async (i) => {
  await page.evaluate((i) => window.EJS_emulator.gameManager.simulateInput(0, i, 1), i);
  await page.waitForTimeout(120);
  await page.evaluate((i) => window.EJS_emulator.gameManager.simulateInput(0, i, 0), i);
};
const overworld = () =>
  page.evaluate(() => {
    const s = window.gbPlayer.readState(window.EJS_emulator.gameManager.getState(), null);
    return s.screen === "overworld" && !s.controlsLocked;
  });
await page.waitForTimeout(5000);
for (let i = 0; i < 40 && !(await overworld()); i++) {
  await press(i % 3 === 0 ? B.START : B.A);
  await page.waitForTimeout(1200);
}
check("the game reached the overworld", await overworld());
await page.waitForTimeout(3000);

// on: the AI plays
const lines = [];
const startedAt = Date.now();
await page.locator("#ai").check();
let shot = false;
while (Date.now() - startedAt < PLAY_MS) {
  const l = await page.locator("#ailine").textContent();
  if (l && lines.at(-1)?.text !== l) lines.push({ at: Date.now() - startedAt, text: l });
  if (!shot && /: .+ \(\d\.\d\d\): /.test(l ?? "")) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/ai-line.png` });
    shot = true;
  }
  if (/stopped/.test(l ?? "")) break;
  await page.waitForTimeout(250);
}
const picks = lines.filter((l) => new RegExp(`^${info.name}: .+ \\(\\d\\.\\d\\d\\): `).test(l.text));
check("the AI played: several picks shown as <name>: <buttons> (<confidence>): <why>", picks.length >= 3, `${picks.length} picks`);
check("it was still playing when the owner stepped in", await page.locator("#ai").isChecked());

// the owner presses a key: the loop stops at once and says why
const stoppedAt = Date.now();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(500);
const after = await page.locator("#ailine").textContent();
check("a key press of the owner's stops it, and the line says so", !(await page.locator("#ai").isChecked()) && after === `${info.name} stopped: you pressed a key`, after);
await page.screenshot({ path: `${OUT}/ai-stopped.png` });
lines.push({ at: Date.now() - startedAt, text: after });
const turnsBefore = (await page.evaluate(async () => (await fetch("player/info", { cache: "no-store" })).json())).today;
await page.waitForTimeout(6000);
const turnsAfter = (await page.evaluate(async () => (await fetch("player/info", { cache: "no-store" })).json())).today;
check("no call is made after it stopped", turnsAfter === turnsBefore, `${turnsBefore} -> ${turnsAfter} today`);

// the video starts with the page: these offsets let the clip be cut to the playing part
writeFileSync(`${OUT}/lines.json`, JSON.stringify({ calls: turnsAfter - info.today, videoOnAtMs: startedAt - t0, videoStopAtMs: stoppedAt - t0, lines }, null, 1));
const video = page.video();
await ctx.close();
console.log(`video ${video ? await video.path() : "none"}, ${((Date.now() - t0) / 1000).toFixed(0)} s in all`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
await browser.close();
