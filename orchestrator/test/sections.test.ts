import assert from "node:assert/strict";
import { test } from "node:test";
import { sectionTitle } from "../core/model.ts";
import { placeable, pruneSections, type SectionsApi } from "../core/sections.ts";

// A fake bb holding sections and the live threads in each; remove() mutates it like bb's delete does.
function fakeBb(sections: Record<string, string>, live: Record<string, string[]> = {}) {
  const st = { sections: { ...sections }, deleted: [] as string[] };
  const api: SectionsApi = {
    list: async () => Object.entries(st.sections).map(([id, name]) => ({ id, name })),
    liveThreadsIn: async (id) => live[id] ?? [],
    remove: async (id) => {
      delete st.sections[id];
      st.deleted.push(id);
    },
  };
  return { st, api };
}
const FDE = sectionTitle("fde-onboarding");
const P = (slug: string, archivedAt: number | null) => ({ slug, archivedAt });

test("an archived project's section is removed; live projects, Orchestrator and the owner's own sections stay", async () => {
  const { st, api } = fakeBb({ s1: FDE, s2: "Search LLMs", s3: "Orchestrator", s4: "Later" });
  const r = await pruneSections(api, [P("fde-onboarding", 1), P("search-llms", null)]);
  assert.deepEqual(r.removed, [FDE]);
  assert.deepEqual(Object.values(st.sections).sort(), ["Later", "Orchestrator", "Search LLMs"]);
});

test("a section still holding a live thread is kept: deleting it would only drop the thread into the loose bucket", async () => {
  const { st, api } = fakeBb({ s1: FDE }, { s1: ["thr_a"] });
  const r = await pruneSections(api, [P("fde-onboarding", 1)]);
  assert.deepEqual(r.removed, []);
  assert.equal(r.kept.length, 1);
  assert.deepEqual(st.deleted, []);
});

test("an archived project named orchestrator never takes the CoS's Orchestrator section with it", async () => {
  const { st, api } = fakeBb({ s1: "Orchestrator" });
  await pruneSections(api, [P("orchestrator", 1)]);
  assert.deepEqual(st.deleted, []);
});

test("un-archiving: a second pass removes nothing, and a project that is live again keeps its section", async () => {
  const { st, api } = fakeBb({ s1: FDE });
  await pruneSections(api, [P("fde-onboarding", 1)]);
  assert.deepEqual(st.deleted, ["s1"]);
  const again = await pruneSections(api, [P("fde-onboarding", 1)]);
  assert.deepEqual(again.removed, []);
  // brought back: placeSections recreates the section by name, and a live project is never pruned
  st.sections.s9 = FDE;
  await pruneSections(api, [P("fde-onboarding", null)]);
  assert.deepEqual(st.deleted, ["s1"]);
});

test("placement skips the threads of an archived project, so its section isn't made again", () => {
  const ag = [
    { threadId: "t1", status: "idle", project: "fde-onboarding" },
    { threadId: "t2", status: "idle", project: "search-llms" },
    { threadId: "t3", status: "idle", project: null },
    { threadId: "t4", status: "archived", project: "search-llms" },
  ];
  const got = placeable(ag, new Set(), [P("fde-onboarding", 1), P("search-llms", null)]).map((a) => a.threadId);
  assert.deepEqual(got, ["t2", "t3"]);
  // un-archived: its thread is placeable again, so placeSections makes the section anew
  assert.deepEqual(placeable(ag, new Set(), [P("fde-onboarding", null), P("search-llms", null)]).map((a) => a.threadId), ["t1", "t2", "t3"]);
});
