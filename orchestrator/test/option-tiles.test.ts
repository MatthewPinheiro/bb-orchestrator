// Option tiles' badges (2026-11-18): pressing must move nothing, because Needs you arms cards by position and a tile that
// grows on a pick is a mis-click risk. Recommended has a row reserved on every tile only while a tile has it; Picked sits
// in the title row, always laid out, so a pick changes no tile's height, on a card with no Recommended option too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pickedClass, reservesBadgeRow } from "../app/option-tiles.ts";

const src = readFileSync(new URL("../app/answer-ui.tsx", import.meta.url), "utf8");

test("a card with no Recommended option reserves no badge row, ticked or not", () => {
  assert.equal(reservesBadgeRow([{}, {}]), false);
  assert.equal(reservesBadgeRow([{ recommended: false }, { recommended: false }]), false, "a pickable card with nothing picked has no empty row");
  assert.equal(reservesBadgeRow([]), false);
});

test("a Recommended option makes every tile reserve the row, so their heights stay equal", () => {
  assert.equal(reservesBadgeRow([{ recommended: true }, {}]), true);
});

test("a pick changes no tile's height: the Picked badge is the same box ticked or not, in the title row, never a row of its own", () => {
  const off = pickedClass(false).split(" ");
  const on = pickedClass(true).split(" ");
  assert.deepEqual(off.filter((c) => c !== "invisible"), on, "only visibility differs between picked and not");
  assert.ok(off.includes("invisible") && !on.includes("invisible"));
  assert.ok(on.includes("-my-0.5"), "it never makes the title row taller than one line");
  const title = src.slice(src.indexOf('data-tile-title=""'), src.indexOf("{o.detail ?"));
  assert.match(title, /pickedClass\(o\.pressed\)/, "Picked is drawn in the title row, whatever the card recommends");
  assert.doesNotMatch(src.slice(src.indexOf("{badges ? ("), src.indexOf("</Btn>")), /Picked/, "the reserved badge row holds Recommended only, so a pick adds no row");
  assert.match(src, /o\.pressed !== undefined \? \(\s*<Badge variant="outline" className=\{pickedClass\(o\.pressed\)\}/, "drawn whenever the answer can be picked, not only once picked");
});
