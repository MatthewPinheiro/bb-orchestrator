// Why: the owner found phone Home "so confusing with the double tabs" (2026-11-20): a pages row stacked on the filter row. Home now has one row of tabs, and an empty Home is Start here alone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { navOf } from "../app/nav.ts";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const feed = src("app/feed.tsx");
const app = src("app.tsx");

test("at 390 px Home draws one row of tabs: its filters, with the mic and Mark all read in that row", () => {
  assert.equal((feed.match(/<Tabs /g) ?? []).length, 1, "one Tabs in Home");
  assert.equal((feed.match(/\{tabs\}/g) ?? []).length, 1, "drawn once, in the phone's header row");
  assert.match(feed, /\{tabs\}\s*<VoiceMic \/>\s*<Button type="button" variant="ghost" size="icon" aria-label="Mark all read"/);
  assert.doesNotMatch(feed, /\{filters \?/, "no second row under the header");
  const nav = navOf([{ id: "home", label: "Home" }, { id: "deliverables", label: "Deliverables" }, { id: "needs-you", label: "Needs you" }], new Set());
  assert.deepEqual(nav.main.find((m) => m.id === "home")!.subs, [], "so the pages row (PlaceLinks) draws nothing on Home");
  assert.match(src("app/page-nav.tsx"), /if \(!place \|\| !place\.subs\.length\) return null;/);
  assert.match(app, /\{phoneNav \? <PlaceLinks /);
});

test("an empty Home is Start here alone: no filter row and no Mark all read; the web keeps only its title", () => {
  assert.match(feed, /const alone = !body && filter === "all" && !!view && posts\.length === 0;/);
  const header = feed.slice(feed.indexOf("const header = alone"), feed.indexOf(") : filtersInNav ? ("));
  assert.doesNotMatch(header, /tabs|Mark all read|data-mark-all/);
  assert.match(header, /filtersInNav \? \(\s*<div[^>]*data-home-header="">\s*<h1 className="m-0 text-base font-semibold">Home<\/h1>/);
  assert.match(header, /\) : null/, "on a phone nothing above Start here");
});
