// Who the orchestrator works for, in words (core/owner.ts). A public install has no name set: agents must never be
// told a stranger's name, and the owner's own screens speak to them as "you".
import assert from "node:assert/strict";
import { test } from "node:test";
import { cosTitleOf, ownerOnScreen, ownerWords } from "../core/owner.ts";

test("without ownerName, agents read \"the owner\" and the owner's screens read \"you\"", () => {
  assert.deepEqual(ownerWords(""), { name: "the owner", Name: "The owner" });
  assert.deepEqual(ownerWords("   "), { name: "the owner", Name: "The owner" }, "blank is unset");
  assert.deepEqual(ownerWords(undefined), { name: "the owner", Name: "The owner" });
  assert.deepEqual(ownerOnScreen(""), { name: "you", Name: "You" });
});

test("a set ownerName is used as written, in agents' text and on screen alike", () => {
  assert.deepEqual(ownerWords(" Sam "), { name: "Sam", Name: "Sam" });
  assert.deepEqual(ownerOnScreen("Sam"), { name: "Sam", Name: "Sam" });
});

test("the CoS is \"Chief of Staff\" until cosTitle names it", () => {
  assert.equal(cosTitleOf(""), "Chief of Staff");
  assert.equal(cosTitleOf(undefined), "Chief of Staff");
  assert.equal(cosTitleOf("Number One"), "Number One");
});
