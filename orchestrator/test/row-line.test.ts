// The sidebar's metadata line, rendered (app/row-line.tsx). 2026-11-18, the owner: "the side bar isn't accurate". Lead
// rows read "Lead Lv 28 D…  normal": the priority chip took the trainer name's room. With a personas pack the name wins:
// it is the line's last part, whole, and the priority is a mark in the role chip, told apart by shape. Rows without a
// person (pokemon on with no pack, or off) are drawn exactly as before. Personas here are made up.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement as h, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanTsx, importTsx } from "./tsx-render.ts";

after(cleanTsx);

type Any = ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const { RowLine } = await importTsx<Record<string, Any>>("app/row-line.tsx");
const html = (a: Record<string, unknown>) => renderToStaticMarkup(h(RowLine!, { a }));
// the text a reader sees: tags and <title> (a tooltip) dropped
const seen = (s: string) => s.replace(/<title>.*?<\/title>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// wider than the owner's longest live trainer names (seven letters)
const person = { name: "Wilhelmina", title: "Admiral", image: "https://personas.example.test/w.png", credit: null, team: [], teamDex: [], roster: [], partner: null };
const lead = (priority: string | null, persona: unknown = person) =>
  ({ threadId: "thr_l", address: "lead:edge-cli", role: "lead", project: "edge-cli", level: 43, mon: persona ? null : "Shinx", form: persona ? null : "Luxray", formDex: persona ? null : 405, monType: "electric", priority, persona });

test("a lead row with a person ends with its whole name: the priority is a mark in the role chip, not a chip after the name", () => {
  for (const priority of ["urgent", "high", "normal", "low"]) {
    const s = html(lead(priority));
    assert.equal(seen(s), "Lead Lv 43 Wilhelmina", `${priority}: no priority word takes the name's room`);
    assert.match(s, /Wilhelmina<\/span><\/span>$/, `${priority}: the name is the line's last part`);
    assert.match(s, new RegExp(`<span [^>]*>Lead<svg data-priority="${priority}" role="img" aria-label="${priority} priority"`), `${priority}: the mark sits in the role chip`);
    assert.match(s, /title="Wilhelmina · lead:edge-cli · \w+ priority"/, "the line's tooltip still names the priority");
  }
});

test("the four priority marks differ in shape, not only colour", () => {
  const paths = ["urgent", "high", "normal", "low"].map((p) => /<path d="([^"]+)"/.exec(html(lead(p)))![1]);
  assert.equal(new Set(paths).size, 4, paths.join(" | "));
});

test("rows without a person are drawn as before: the priority chip after the Pokémon's name", () => {
  const s = html(lead("high", null));
  assert.equal(seen(s), "Lead Lv 43 Luxray high");
  assert.doesNotMatch(s, /<svg/);
  const t = html({ threadId: "thr_t", address: "thread:edge-cli:3", role: "thread", project: "edge-cli", level: 12, mon: "Shinx", form: "Shinx", formDex: 403, monType: "electric", priority: null, persona: null });
  assert.equal(seen(t), "Thread Lv 12 Shinx");
});
