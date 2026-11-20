// Why: Home first step 2 (2026-11-20) puts the page's whole navigation in one Sidebar (web) and a 4-item bar (phone); nothing may become unreachable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FOLDED, MAIN, SECTIONS, navOf, placeOf } from "../app/nav.ts";
import { startSteps } from "../app/start-steps.ts";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const app = src("app.tsx");
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const ALL = ["home", "deliverables", "needs-you", "chat", "projects", "open-prs", "multiplayer", "coderabbit", "cloud", "gameboy", "rules", "board"].map((id) => ({ id, label: id }));

test("four places, in order, and the phone's bar is those four", () => {
  assert.deepEqual(ids(MAIN), ["home", "chat", "projects", "open-prs"]);
  assert.deepEqual(MAIN.map((m) => m.label), ["Home", "Chat", "Projects", "Reviews"]);
  assert.match(src("app/page-nav.tsx"), /className="grid shrink-0 grid-cols-4 border-t/);
});

test("every page the strip had is still in the nav: a place, a sub-item, a Home filter or a place's section (step 3), or a Tool", () => {
  const nav = navOf(ALL, new Set(["multiplayer", "coderabbit", "cloud", "gameboy"]));
  const reachable = new Set([...ids(nav.main), ...nav.main.flatMap((m) => ids(m.subs)), ...ids(nav.tools), ...Object.values(FOLDED), ...Object.keys(SECTIONS)]);
  for (const v of ALL) assert.ok(reachable.has(v.id), `${v.id} is reachable`);
  assert.ok(reachable.has("how-it-works"));
});

test("unused tabs are not sub-items; Tools offers Set up instead, and Cloud and Game Boy only when on", () => {
  const nav = navOf(ALL, new Set());
  assert.deepEqual(ids(nav.main.find((m) => m.id === "open-prs")!.subs), [], "Reviews has no unused boards");
  assert.deepEqual(ids(nav.tools), ["rules", "board", "how-it-works", "multiplayer", "coderabbit"]);
  assert.deepEqual(nav.tools.slice(-2).map((t) => t.label), ["Set up Multiplayer", "Set up CodeRabbit"]);
  const used = navOf(ALL, new Set(["multiplayer"]));
  assert.deepEqual(ids(used.main.find((m) => m.id === "open-prs")!.subs), [], "once used it is a section of Reviews (step 3), not a sub-item");
  assert.equal(SECTIONS.multiplayer, "open-prs");
  assert.ok(!ids(used.tools).includes("multiplayer"));
});

test("a page hidden by hiddenTabs (not in the shown views) leaves the nav; the four places stay", () => {
  const nav = navOf(ALL.filter((v) => v.id !== "rules" && v.id !== "deliverables"), new Set());
  assert.ok(!ids(nav.tools).includes("rules"));
  assert.ok(!ids(nav.main.find((m) => m.id === "home")!.subs).includes("deliverables"));
  assert.deepEqual(ids(nav.main), ["home", "chat", "projects", "open-prs"]);
});

test("the active place: a sub-page lights its place on the phone's bar; a Tool lights Tools", () => {
  assert.equal(placeOf("needs-you"), "home");
  assert.equal(placeOf("multiplayer"), "open-prs");
  assert.equal(placeOf("rules"), "tools");
  assert.equal(placeOf("chat"), "chat");
});

test("Start here marks a step done from the agents read: a live CoS, then a lead", () => {
  assert.deepEqual(startSteps(undefined), { cos: false, project: false });
  const a = (address: string, status = "idle") => ({ address, status }) as never;
  assert.deepEqual(startSteps([a("cos")]), { cos: true, project: false });
  assert.deepEqual(startSteps([a("cos", "archived"), a("lead:kite")]), { cos: false, project: true }, "an archived CoS is not running");
  assert.match(src("app/feed.tsx"), /filter === "all" \? \(\s*<StartHere /, "only the empty All view is Start here; a filter's empty view says it is empty");
  assert.match(src("app/start-here.tsx"), /<EmptyHeader className="max-w-none items-start self-stretch text-left">/, "the title lines up with the steps, as start-here-1440 and -390");
});

test("the mic sits in Home's header, and draws nothing while voice mode is off", () => {
  const feed = src("app/feed.tsx");
  const header = feed.slice(feed.indexOf("const header = alone"), feed.indexOf("const list = ("));
  assert.equal(header.match(/<VoiceMic \/>/g)?.length, 3, "web, phone, and an empty Home on web");
  assert.match(src("voice/app/voice-mic.tsx"), /if \(!enabled\) return null;/);
});

test("the bottom bar and the pages row step aside while an item is open full screen (card-390); the title bar names the place; ⚙ Tools only on a phone", () => {
  assert.match(app, /const phoneNav = compact && !itemOpen\.current\.has\(layout\.focus\);/, "an item open in the focused pane");
  assert.match(app, /onItemOpen=\{onItemOpen\(id\)\}/, "each Home pane says whether its own item is open");
  assert.match(app, /\{phoneNav \? <BottomBar /);
  assert.match(app, /experimental_usePageTitle: usePageTitle,/);
  assert.match(app, /headerContent: PhoneTools,/);
  assert.match(app, /if \(!phone\) return null;/);
  const tools = app.slice(app.indexOf("function PhoneTools("), app.indexOf("export default definePluginApp"));
  assert.match(tools, /useSyncExternalStore\(subscribeCompact, \(\) => compactNow\)/, "⚙ follows the page's own width: a narrow panel in a wide window has no Sidebar, so it needs ⚙");
  assert.doesNotMatch(tools, /matchMedia/);
  assert.match(app, /setCompactNow\(compact\);/);
});

test("on a phone a place's pages sit in a row atop its page (the lead's call), and ⚙ holds Tools only", () => {
  assert.match(app, /\{phoneNav \? <PlaceLinks nav=\{nav\} view=\{focusedView\} onGo=\{go\} \/> : null\}/);
  const tools = app.slice(app.indexOf("function PhoneTools("), app.indexOf("export default definePluginApp"));
  assert.doesNotMatch(tools, /more=/);
  assert.match(src("app/page-nav.tsx"), /if \(!place \|\| !place\.subs\.length\) return null;/, "a place with no pages draws no row");
});
