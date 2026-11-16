// Phase-1 click-through on the runner's bb: one step per run, so the proof can interleave with real agent turns.
//   node test/e2e/proof.mjs <step> [args…] --out <dir>
// Steps:
//   shot <name> [view]                 screenshot a view (needs-you | board | rules)
//   answer <decisionId> <optionId> <name>   one tap on an option; waits for the card to show answered
//   doubletap <decisionId> <name>      two raw clicks on option 1 of that card, <400 ms apart (and a dblclick);
//                                      prints which decisions changed state
//   note <decisionId> <text> <name>    a note-only answer
//   defer <decisionId> <preset> <name> defer through the menu
//   return <decisionId> <name>         bring a deferred card back
//   resend <itemId> <name>             resend a dead letter from the board
//   rule <text> <project|-> <name>     add a standing rule from the Rules screen
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, base: { type: "string", default: "http://127.0.0.1:38886" } } });
const out = values.out;
if (!out) throw new Error("--out DIR");
mkdirSync(out, { recursive: true });
const [step, ...args] = positionals;
const report = { step, args, at: new Date().toISOString(), console: [], notes: [] };

const state = (id) => JSON.parse(execFileSync("bb", ["orchestrator", "decision", id], { encoding: "utf8" })).state;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("console", (m) => { if (m.type() === "error") report.console.push(m.text()); });
page.on("pageerror", (e) => report.console.push(String(e)));
const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: join(out, `${name}.png`), fullPage: true }); report.notes.push(`screenshot ${name}.png`); };
const go = async (view = "needs-you") => {
  const sub = view === "needs-you" ? "" : `/${view}`;
  await page.goto(`${values.base}/plugins/orchestrator/home${sub}`, { waitUntil: "load", timeout: 60_000 });
  await page.locator(`[data-view="${view}"]`).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
};
const card = (id) => page.locator(`[data-card="${id}"]`);
const armed = async (id, opt = "1") => card(id).locator(`[data-option="${opt}"][data-armed="true"]`).waitFor({ timeout: 10_000 });

try {
  switch (step) {
    case "shot":
      await go(args[1] ?? "needs-you");
      await shot(args[0]);
      break;
    case "answer": {
      const [id, opt, name] = args;
      await go();
      await armed(id, opt);
      report.before = state(id);
      await shot(`${name}-before`);
      await card(id).locator(`[data-option="${opt}"]`).click();
      await card(id).and(page.locator('[data-state="answered"]')).waitFor({ timeout: 15_000 }).catch(() => report.notes.push("no answered placeholder seen"));
      await shot(`${name}-tapped`);
      await page.waitForTimeout(1500);
      await shot(`${name}-after`);
      report.after = state(id);
      break;
    }
    case "doubletap": {
      const [id, name] = args;
      await go();
      await armed(id);
      const ids = await page.locator("[data-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card")));
      report.cardsBefore = Object.fromEntries(ids.map((i) => [i, state(i)]));
      await shot(`${name}-before`);
      const box = await card(id).locator('[data-option="1"]').boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.click(x, y);
      await page.waitForTimeout(120);
      await page.mouse.click(x, y); // the second tap of a fast double tap, same spot
      await page.waitForTimeout(150);
      await page.mouse.dblclick(x, y); // and a real double click on top
      await page.waitForTimeout(250);
      if (process.env.STORM) {
        // keep tapping the same spot every 150 ms for 2 s: across the moment the next card slides into this slot
        report.storm = [];
        for (let t = 0; t < 2000; t += 150) {
          await page.mouse.click(x, y);
          report.storm.push(await page.locator("[data-card]").first().getAttribute("data-card"));
          await page.waitForTimeout(150);
        }
      }
      await shot(`${name}-during`);
      await page.waitForTimeout(2500);
      await shot(`${name}-after`);
      report.cardsAfter = Object.fromEntries(ids.map((i) => [i, state(i)]));
      const changed = ids.filter((i) => report.cardsBefore[i] !== report.cardsAfter[i]);
      report.changed = changed;
      if (changed.length !== 1 || changed[0] !== id) throw new Error(`expected only ${id} answered, changed: ${changed.join(", ")}`);
      break;
    }
    case "arming": {
      // answer card A, then click card B's option 1 the moment B lands where A's option was: it must be unarmed
      const [a, b, name] = args;
      await go();
      await armed(a);
      await armed(b);
      const boxA = await card(a).locator('[data-option="1"]').boundingBox();
      const x = boxA.x + boxA.width / 2, y = boxA.y + boxA.height / 2;
      report.before = { [a]: state(a), [b]: state(b) };
      await page.mouse.click(x, y);
      const t0 = Date.now();
      let landed = null;
      while (Date.now() - t0 < 10_000) {
        const bb2 = await card(b).locator('[data-option="1"]').boundingBox().catch(() => null);
        if (bb2 && y >= bb2.y && y <= bb2.y + bb2.height) { landed = Date.now() - t0; break; }
        await page.waitForTimeout(10);
      }
      if (landed === null) throw new Error(`${b} never reached the clicked spot`);
      report.armedAtClick = await card(b).locator('[data-option="1"]').getAttribute("data-armed");
      await page.mouse.click(x, y);
      report.landedAfterMs = landed;
      await shot(`${name}-at-second-click`);
      await page.waitForTimeout(2000);
      await shot(`${name}-after`);
      report.after = { [a]: state(a), [b]: state(b) };
      if (report.after[b] !== "asked") throw new Error(`${b} was answered by the second click`);
      break;
    }
    case "revoke": {
      const [ruleId, name] = args;
      await go("rules");
      await page.locator(`[data-revoke="${ruleId}"]`).click();
      await page.locator(`[data-rule="${ruleId}"][data-revoked="true"]`).waitFor({ timeout: 15_000 });
      await shot(`${name}-after`);
      break;
    }
    case "note": {
      const [id, text, name] = args;
      await go();
      await armed(id);
      const toggle = card(id).locator("[data-note-toggle]");
      if (await toggle.count()) await toggle.click();
      await card(id).locator("[data-note]").fill(text);
      await shot(`${name}-typed`);
      await card(id).locator("[data-note-send]").click();
      await page.waitForTimeout(2000);
      await shot(`${name}-after`);
      report.after = state(id);
      break;
    }
    case "defer": {
      const [id, preset, name] = args;
      await go();
      await armed(id);
      await card(id).locator("[data-defer]").click();
      await page.locator(`[data-preset="${preset}"]`).waitFor();
      await shot(`${name}-menu`);
      await page.locator(`[data-preset="${preset}"]`).click();
      await page.waitForTimeout(2000);
      await shot(`${name}-after`);
      break;
    }
    case "return": {
      const [id, name] = args;
      await go();
      await card(id).locator("[data-return]").click();
      await page.waitForTimeout(2000);
      await shot(`${name}-after`);
      break;
    }
    case "resend": {
      const [itemId, name] = args;
      await go("board");
      await shot(`${name}-before`);
      await page.locator(`[data-resend="${itemId}"]`).click();
      await page.waitForTimeout(2000);
      await shot(`${name}-after`);
      break;
    }
    case "rule": {
      const [text, project, name] = args;
      await go("rules");
      const form = page.locator("[data-rule-form]");
      await form.locator('input[name="text"]').fill(text);
      if (project !== "-") await form.locator('input[name="project"]').fill(project);
      await form.locator('input[name="source"]').fill("phase-1 proof, a test operator");
      await shot(`${name}-filled`);
      await form.locator('button[type="submit"]').click();
      await page.waitForTimeout(1500);
      await shot(`${name}-after`);
      break;
    }
    default:
      throw new Error(`unknown step ${step}`);
  }
} catch (e) {
  report.error = String(e);
  await page.screenshot({ path: join(out, `error-${step}.png`), fullPage: true }).catch(() => {});
} finally {
  writeFileSync(join(out, `report-${step}-${Date.now()}.json`), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.error ? 1 : 0);
