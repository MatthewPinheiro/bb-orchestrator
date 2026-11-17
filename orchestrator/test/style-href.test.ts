// A bb window left open across an update keeps a <style> by its href (React dedupes by href). 1.9.0 changed the
// Lead status card's CSS without a new href, so the owner's open window rendered the card flat. The href now follows the CSS.
import assert from "node:assert/strict";
import { test } from "node:test";
import { styleHref } from "../app/style-href.ts";

test("a changed CSS block gets a new href, so an open window loads the new rules", () => {
  const before = ".k-update { display: grid; }";
  const after = ".k-update { display: grid; } .k-lbl { font-weight: 600; }";
  assert.notEqual(styleHref("orch-cc-book", before), styleHref("orch-cc-book", after));
  assert.match(styleHref("orch-cc-book", before), /^orch-cc-book-[0-9a-z]+$/);
});

test("the same CSS gives the same href, so two components sharing a block (orch-cc) keep one style", () => {
  assert.equal(styleHref("orch-cc", ".a{}"), styleHref("orch-cc", ".a{}"));
});
