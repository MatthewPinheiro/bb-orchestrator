// The proof of the phone layout against the real bb app: the Game Boy tab at 390px wide with touch (iPhone 13 emulation,
// so EmulatorJS shows its touch gamepad), then a desktop window. On the phone, the gamepad must sit below the game screen
// (none of its controls over the screen, all on the pane, each at least 44px), with the screen at the top at 3:2. On the
// desktop, no gamepad and the screen fills the pane at 3:2 as before. It plays the ROM already uploaded and reads the save
// backup's info before and after, to show it left the save alone. On the phone it taps Fast twice: after the first tap
// lifts, Fast stays lit and the game runs faster (EmulatorJS's count of emulated frames per second); after the second,
// it is unlit and back to normal speed. Fast never saves. With --press it holds a touch on Start (which never
// saves) and screenshots the game before, during and after. Screenshots go to $EVIDENCE_DIR (default ./evidence).
//   node gameboy/test/e2e/phone.mjs [--press [--press-after=<seconds>]]
import { chromium, devices } from "playwright-core";

const PRESS = process.argv.includes("--press");
// --press-after=<s>: wait this long before the press, e.g. for the title screen, where Start opens a menu only a press can show
const PRESS_AFTER = Number(process.argv.find((a) => a.startsWith("--press-after="))?.split("=")[1] ?? 0);
const APP = process.env.APP ?? "http://127.0.0.1:38886";
const TAB = `${APP}/plugins/orchestrator/home/gameboy`;
const OUT = process.env.EVIDENCE_DIR ?? "./evidence";
let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const gameFrame = (page) => page.frames().find((f) => f.url().includes("/gameboy/play"));
async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(TAB, { waitUntil: "load" });
  const t0 = Date.now();
  let f = null;
  while (Date.now() - t0 < 120000) {
    f = gameFrame(page);
    if (f && (await f.evaluate(() => !!(window.EJS_emulator && window.EJS_emulator.started)).catch(() => false))) break;
    f = null;
    await page.waitForTimeout(500);
  }
  if (!f) throw new Error("the game didn't start");
  await page.waitForTimeout(8000); // EmulatorJS's menu bar hides itself after a few seconds
  return { ctx, page, f };
}
// boxes in the page's coordinates (the iframe's offset added)
async function measure(page, f) {
  const off = await page.locator('iframe[title="Game Boy"]').boundingBox();
  const m = await f.evaluate(() => {
    const q = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const c = document.querySelector("#game canvas");
    const c2 = {};
    for (const k of ["dpad", "a", "b", "start", "select", "l", "r"]) c2[k] = q(k === "dpad" ? ".ejs_dpad_main" : `.b_${k}`);
    return { coarse: matchMedia("(pointer: coarse)").matches, game: q("#game"), canvas: q("#game canvas"), backing: [c.width, c.height], padShown: window.EJS_emulator.virtualGamepad.style.display !== "none", c: c2, fast: q(".b_speed_fast") };
  });
  const sh = (b) => b && { x: b.x + off.x, y: b.y + off.y, w: b.w, h: b.h };
  for (const k of Object.keys(m.c)) m.c[k] = sh(m.c[k]);
  return { ...m, frame: off, game: sh(m.game), canvas: sh(m.canvas), fast: sh(m.fast) };
}
const overlap = (p, q) => p.x < q.x + q.w - 0.5 && q.x < p.x + p.w - 0.5 && p.y < q.y + q.h - 0.5 && q.y < p.y + p.h - 0.5;
// emulated frames per second over `ms` (fast-forward runs more of them per second)
async function rate(page, f, ms = 3000) {
  const read = () => f.evaluate(() => [window.EJS_emulator.gameManager.getFrameNum(), performance.now()]);
  const [n0, t0] = await read();
  await page.waitForTimeout(ms);
  const [n1, t1] = await read();
  return Math.round(((n1 - n0) / (t1 - t0)) * 10000) / 10;
}
const fastState = (f) => f.evaluate(() => ({ lit: document.querySelector(".b_speed_fast").classList.contains("gb-on"), on: !!window.EJS_emulator.isFastForward }));
// a tap: the finger goes down and lifts; the state is read after the lift, since a held button is lit and fast anyway
async function tap(page, cdp, b) {
  const pt = [{ x: b.x + b.w / 2, y: b.y + b.h / 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt });
  await page.waitForTimeout(100);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
}
const saveInfo = async (page) => (await page.evaluate(async (u) => (await fetch(u, { cache: "no-store" })).json(), `${APP}/api/v1/plugins/orchestrator/http/gameboy/rom/info`)).save;

// 1. phone: 390px wide, touch, a phone's user agent
{
  const { ctx, page, f } = await open({ ...devices["iPhone 13"] });
  const save0 = await saveInfo(page);
  const m = await measure(page, f);
  const vw = page.viewportSize().width;
  console.log("phone frame", JSON.stringify(m.frame), "screen", JSON.stringify(m.canvas));
  check("phone: touch pointer and EmulatorJS's gamepad shown", m.coarse && m.padShown);
  check("phone: the screen sits at the top of the game area", Math.abs(m.canvas.y - m.game.y) < 1, `screen y ${m.canvas.y}, game y ${m.game.y}`);
  check("phone: the screen keeps 3:2 (CSS and pixels)", Math.abs(m.canvas.w / m.canvas.h - 1.5) < 0.02 && Math.abs(m.backing[0] / m.backing[1] - 1.5) < 0.02, `${m.canvas.w}x${m.canvas.h}, backing ${m.backing}`);
  for (const [k, b] of Object.entries(m.c)) {
    const inPane = b && b.x >= m.frame.x && b.y >= m.frame.y && b.x + b.w <= Math.min(vw, m.frame.x + m.frame.width) + 0.5 && b.y + b.h <= m.frame.y + m.frame.height + 0.5;
    check(`phone: ${k} is below the screen, fully on the pane, at least 44px`, b && inPane && !overlap(b, m.canvas) && b.y >= m.canvas.y + m.canvas.h - 0.5 && b.w >= 44 && b.h >= 44, JSON.stringify(b));
  }
  const keys = Object.keys(m.c);
  const clash = keys.flatMap((k, i) => keys.slice(i + 1).filter((j) => overlap(m.c[k], m.c[j])).map((j) => `${k}/${j}`));
  check("phone: no two controls overlap", !clash.length, clash.join(" "));
  await page.screenshot({ path: `${OUT}/phone-1-layout.png` });
  const cdp = await ctx.newCDPSession(page);
  {
    const fb = m.fast;
    const s0 = await fastState(f);
    const fps0 = await rate(page, f);
    await page.screenshot({ path: `${OUT}/phone-fast-a-off.png` });
    await tap(page, cdp, fb);
    const s1 = await fastState(f);
    const fps1 = await rate(page, f);
    await page.screenshot({ path: `${OUT}/phone-fast-b-on.png` });
    // EmulatorJS's stored settings: the toggle must not be saved (each load starts at normal speed)
    const stored = await f.evaluate(() => Object.keys(localStorage).filter((k) => /^ejs-.*-settings$/.test(k)).map((k) => { try { return JSON.parse(localStorage.getItem(k)).settings.fastForward ?? null; } catch { return null; } }));
    await tap(page, cdp, fb);
    const s2 = await fastState(f);
    const fps2 = await rate(page, f);
    await page.screenshot({ path: `${OUT}/phone-fast-c-off-again.png` });
    console.log("fast: frames/s off", fps0, "on", fps1, "off again", fps2, "states", JSON.stringify([s0, s1, s2]), "stored", JSON.stringify(stored));
    check("phone: Fast starts off and unlit", !s0.lit && !s0.on, JSON.stringify(s0));
    check("phone: one tap turns fast-forward on, and Fast stays lit after the finger lifts", s1.lit && s1.on, JSON.stringify(s1));
    check("phone: with Fast on, the game runs faster (at least 1.5x the emulated frames per second)", fps1 >= 1.5 * fps0, `${fps0} -> ${fps1} frames/s`);
    check("phone: the toggle isn't stored in EmulatorJS's settings", !stored.includes("enabled"), JSON.stringify(stored));
    check("phone: a second tap turns it off and unlit, back to normal speed", !s2.lit && !s2.on && fps2 < 1.25 * fps0 && fps1 >= 1.5 * fps2, `${JSON.stringify(s2)}, ${fps2} frames/s`);
  }
  if (PRESS) {
    const s = m.c.start;
    const pt = [{ x: s.x + s.w / 2, y: s.y + s.h / 2 }];
    // the screen as shown (a WebGL canvas reads back blank, so this crops a page screenshot)
    const clip = { x: m.canvas.x, y: m.canvas.y, width: m.canvas.w, height: m.canvas.h };
    if (PRESS_AFTER) await page.waitForTimeout(PRESS_AFTER * 1000);
    await page.screenshot({ path: `${OUT}/phone-2-before-start.png` });
    const screenBefore = await page.screenshot({ clip });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt });
    await page.waitForTimeout(200);
    const held = await f.evaluate(() => document.querySelector(".b_start").classList.contains("ejs_virtualGamepad_button_down"));
    await page.screenshot({ path: `${OUT}/phone-3-start-held.png` });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/phone-4-after-start.png` });
    const screenAfter = await page.screenshot({ clip });
    check("phone: touching Start shows it held, and the game reacts (the screen changes)", held && !screenBefore.equals(screenAfter), `held ${held}, screen changed ${!screenBefore.equals(screenAfter)}`);
  }
  const save1 = await saveInfo(page);
  check("phone: the save backup is untouched", JSON.stringify(save0) === JSON.stringify(save1), JSON.stringify({ save0, save1 }));
  await ctx.close();
}

// 2. desktop: no gamepad; the screen fills the pane's width at 3:2 under the bar, as before
{
  const { ctx, page, f } = await open({ viewport: { width: 1600, height: 1000 } });
  const m = await measure(page, f);
  const want = Math.min(m.frame.width, (m.frame.height - 40) * 1.5);
  check("desktop: no gamepad; the screen is the whole game area at 3:2, as wide as the pane allows", !m.padShown && JSON.stringify(m.canvas) === JSON.stringify(m.game) && Math.abs(m.canvas.w - want) < 1 && Math.abs(m.canvas.w / m.canvas.h - 1.5) < 0.01, JSON.stringify({ frame: m.frame, game: m.game, canvas: m.canvas }));
  await page.screenshot({ path: `${OUT}/desktop.png` });
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
