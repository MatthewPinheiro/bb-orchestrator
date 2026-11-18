// The less-text layout in a real browser (2026-11-14). Run it against a bb you seeded yourself, never the live one:
//   node test/e2e/less-text.mjs <bb base URL> <new deliverable id> <old deliverable id> <PR card decision id> [out dir] [--live]
// The base is required (2026-11-18), and the live app (127.0.0.1:38886) is refused unless --live is given too
// (live-guard.ts): this script clicks through tabs and opens cards.
// It fails unless: the new deliverable draws verdicts and points before Approve, and Approve before a closed Details;
// facts and checks wait inside Details; the old deliverable keeps the old card; and the PR card leads with its PR
// and shows no context until More.
import assert from "node:assert/strict";
import { checkBase } from "./live-guard.ts";
const argv = process.argv.slice(2);
const live = argv.includes("--live");
const [given, fresh, old, card, out] = argv.filter((a) => a !== "--live");
const base = checkBase(given, live);
if (!fresh || !old || !card) throw new Error("usage: less-text.mjs <base> <new id> <old id> <card id> [out dir] [--live]");
// Playwright loads only after the base passed the guard
const { chromium } = await import("playwright-core");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 2400 }, colorScheme: "dark" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const pos = (el, sels) => el.evaluate((n, sels) => Object.fromEntries(Object.entries(sels).map(([k, s]) => { const x = n.querySelector(s); return [k, x ? [...n.querySelectorAll("*")].indexOf(x) : -1]; })), sels);
try {
  await page.goto(`${base}/plugins/orchestrator/home`, { waitUntil: "load", timeout: 60000 });
  await page.getByRole("tab", { name: /^Deliverables/ }).first().click({ timeout: 60000 });
  // the wide tab (2026-11-16) shows one deliverable beside the list: pick it there first
  const show = async (id) => {
    const row = page.locator(`[data-review-row="${id}"]`);
    if (await row.count()) await row.click();
  };
  await page.locator("[data-deliverables-width]").waitFor({ timeout: 60000 });
  await show(fresh);
  const d = page.locator(`[data-deliverable="${fresh}"]`);
  await d.waitFor({ timeout: 60000 });
  assert.equal(await d.getAttribute("data-layout"), "short");
  const o = await pos(d, { verdicts: '[data-block="verdicts"]', points: "[data-points]", approve: "[data-approve]", details: "[data-details]" });
  assert.ok(o.verdicts >= 0 && o.verdicts < o.points, `verdicts before points ${JSON.stringify(o)}`);
  assert.ok(o.points < o.approve && o.approve < o.details, `points, then Approve, then Details ${JSON.stringify(o)}`);
  assert.equal(await d.locator("[data-details]").getAttribute("data-state"), "closed", "Details starts closed");
  assert.equal(await d.locator('[data-details] [data-block="facts"], [data-details] [data-block="checks"]').count() >= 1, true, "facts and checks are inside Details");
  assert.equal(await d.locator('[data-block="facts"]:not([data-details] *), [data-block="checks"]:not([data-details] *)').count(), 0, "no table of text above the points");
  if (out) await d.screenshot({ path: `${out}/e2e-new-deliverable.png` });
  await show(old);
  const legacy = page.locator(`[data-deliverable="${old}"]`);
  assert.equal(await legacy.getAttribute("data-layout"), null, "an old deliverable keeps the old card");
  assert.equal(await legacy.locator("[data-details], [data-points]").count(), 0);

  await page.getByRole("tab", { name: /^Needs you/ }).first().click();
  const c = page.locator(`[data-card="${card}"]`);
  await c.waitFor({ timeout: 60000 });
  const q = await pos(c, { pr: '[data-block="pr"]', question: "[data-question-text]" });
  assert.ok(q.pr >= 0 && q.pr < q.question, `the PR leads the card ${JSON.stringify(q)}`);
  assert.equal(await c.locator("[data-context] .orch-md").count(), 0, "no context prose until More");
  await c.locator("[data-more]").click();
  assert.equal(await c.locator("[data-context] .orch-md").count(), 1, "More opens the context");
  assert.deepEqual(errors, []);
  console.log("less-text e2e: ok");
} finally {
  await browser.close();
}
