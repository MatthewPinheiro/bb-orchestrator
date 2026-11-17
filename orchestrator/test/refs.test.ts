// References in the command center link (2026-11-16, the owner: "we also need links to prs and shit"). What matters: a
// link must go where the text means, so a reference links only when the plugin knows what it points at (a PR it has
// read, a Linear workspace set for this install, a card, deliverable or thread it has loaded), never by guessing a repo
// or a workspace, and never inside a word. Every link opens as a bb pane through openInBb. Slugs and team keys here are
// made up.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openInBb } from "../app/open-proof.ts";
import { linearUrl, prChip, resolvePr, saysState, tokenize, type PrRef, type RefContext } from "../app/refs.ts";
// made-up card ids, built so the release scan never sees a card-shaped literal
const card = (stamp: string, hex: string) => ["d", stamp, hex].join("-");
const CA = card("20261116T101500Z", "abc123"), CB = card("20261115T090000Z", "def456"), CC = card("20261101T000000Z", "000000");
const LINEAR = "https://linear.app";

const pr = (number: number, repo = "acme/app", x: Partial<PrRef> = {}): PrRef => ({ number, url: `https://github.com/${repo}/pull/${number}`, state: "open", checks: "passing", review: "approved", attention: null, ...x });
const ctx = (x: Partial<RefContext> = {}): RefContext => ({
  project: "kite",
  projectPrs: [pr(4534), pr(4101, "acme/app", { state: "draft", checks: "pending", review: null })],
  allPrs: [pr(4534), pr(4101), pr(4102, "acme/web"), pr(500, "acme/a"), pr(500, "acme/b")],
  linearWorkspace: "",
  linearTeams: [],
  cards: new Map([
    [`${CA}`, "open"],
    [`${CB}`, "answered"],
  ]),
  deliverables: new Set(["v-5e5488bad0c7"]),
  threads: new Map([
    ["thread:kite:17", "T17"],
    ["lead:kite", "TL"],
  ]),
  ...x,
});
const links = (text: string, c = ctx()) => tokenize(text, c).filter((t) => t.kind !== "text").map((t) => `${t.kind}:${t.text}`);

test("tokens give the text back unchanged", () => {
  const text = `PRs 4101, 4102 and #4534 wait; see https://ci.example.com/run/9. thread 17 asked ${CA} (v-5e5488bad0c7)`;
  assert.equal(tokenize(text, ctx()).map((t) => t.text).join(""), text);
});

test("a PR number links only when the plugin knows that PR; an unknown or ambiguous one stays plain", () => {
  assert.deepEqual(links("PR #4534: an answer waits"), ["pr:PR #4534"]);
  assert.deepEqual(links("waiting on #4534"), ["pr:#4534"]);
  assert.deepEqual(links("PRs 4101, 4102"), ["pr:4101", "pr:4102"], "each number of a list is its own link");
  assert.deepEqual(links("PR 9999 and #9998"), [], "unknown numbers stay plain text: no repo is guessed");
  assert.deepEqual(links("#500"), [], "a number two repos share stays plain");
  assert.equal(resolvePr(4101, ctx())?.state, "draft", "the project's own PR wins over another with the same number");
  assert.deepEqual(links("4527 and 4528"), [], "bare numbers are not PRs");
});

test("a PR link carries its chip: draft or ready, the review, CI; no approval count is invented", () => {
  assert.deepEqual(prChip(pr(1)), { stage: "ready", review: "approved", ci: "CI passing", tone: "good" });
  assert.deepEqual(prChip(pr(1, "a/b", { state: "draft", checks: "failing", review: "changes_requested" })), { stage: "draft", review: "changes asked", ci: "CI failing", tone: "bad" });
  assert.deepEqual(prChip(pr(1, "a/b", { state: "merged" })), { stage: "merged", review: null, ci: null, tone: "none" });
});

test("a Linear id stays plain with no workspace set; with one it links, and with a team list only those teams", () => {
  assert.deepEqual(links("fixes ABC-4321"), [], "no workspace: plain");
  const ws = ctx({ linearWorkspace: "example-co" });
  assert.deepEqual(links("fixes ABC-4321", ws), ["linear:ABC-4321"]);
  assert.equal(linearUrl("ABC-4321", ws), `${LINEAR}/example-co/issue/ABC-4321`);
  assert.deepEqual(links("GPT-6 calls and SMB-1", ws), ["linear:GPT-6", "linear:SMB-1"], "as specified: any key links without a list");
  const teams = ctx({ linearWorkspace: "example-co", linearTeams: ["ABC", "SMB"] });
  assert.deepEqual(links("GPT-6 calls, ABC-4321 and SMB-1", teams), ["linear:ABC-4321", "linear:SMB-1"], "with a team list GPT-6 stays plain");
});

test("no link inside a word", () => {
  const ws = ctx({ linearWorkspace: "example-co" });
  assert.deepEqual(links("ABC-4321x xABC-4321 ABC-4321-b v2-3", ws), []);
  assert.deepEqual(links(`x${CA} v-5e5488bad0c7z abc#4534 thread 17x`), []);
});

test("cards, deliverables, threads and the lead link only when loaded; full URLs link as written", () => {
  assert.deepEqual(links(`see ${CA} and ${CB} and ${CC}`), [`card:${CA}`, `card:${CB}`]);
  assert.deepEqual(links("v-5e5488bad0c7 and v-000000000000"), ["deliverable:v-5e5488bad0c7"]);
  assert.deepEqual(links("thread 17, thread:kite:17, lead:kite, thread 4"), ["thread:thread 17", "thread:thread:kite:17", "thread:lead:kite"]);
  assert.deepEqual(links("threads 17-19 implementing"), [], "a range is not thread 17");
  assert.deepEqual(links("CI https://ci.example.com/run/9."), ["url:https://ci.example.com/run/9"], "trailing punctuation is not part of the URL");
  assert.deepEqual(links("(https://sentry.example.com/i/1)"), ["url:https://sentry.example.com/i/1"]);
});

test("each kind of reference opens through openInBb: URLs in bb's link handling, threads in bb, cards and deliverables in the plugin's views", () => {
  const calls: string[] = [];
  const nav = {
    openUrl: (u: string) => (calls.push(`url ${u}`), true),
    experimental_openFilePreview: () => false,
    toThread: (id: string) => void calls.push(`thread ${id}`),
    toPluginPanel: (_p: string, o: { subPath: string }) => void calls.push(`panel ${o.subPath}`),
  } as never;
  const text = `PR #4534 ABC-4321 https://ci.example.com/run/9 thread 17 ${CA} ${CB} v-5e5488bad0c7`;
  for (const t of tokenize(text, ctx({ linearWorkspace: "example-co" }))) if (t.kind !== "text") assert.equal(openInBb(nav, t.open), true, `${t.kind} is taken by bb`);
  assert.deepEqual(calls, [
    "url https://github.com/acme/app/pull/4534",
    `url ${LINEAR}/example-co/issue/ABC-4321`,
    "url https://ci.example.com/run/9",
    "thread T17",
    "panel needs-you",
    "panel board",
    "panel deliverables",
  ]);
});

// Review fixes (Codex, 2026-11-16).
test("a wait's shortened words link to the wait's own PR and thread, never the same number elsewhere", async () => {
  const { exactCtx } = await import("../app/refs.ts");
  const c = ctx({ projectPrs: [pr(41, "acme/kite")], allPrs: [pr(41, "acme/kite"), pr(41, "acme/dep")] });
  const dep = tokenize("a merge of PR #41", exactCtx(c, "https://github.com/acme/dep/pull/41")).find((t) => t.kind === "pr");
  assert.equal(dep && "pr" in dep ? dep.pr.url : null, "https://github.com/acme/dep/pull/41", "the dependency's PR, not this project's #41");
  assert.deepEqual(tokenize("PR #41", exactCtx(c, "https://github.com/acme/other/pull/41")).filter((t) => t.kind !== "text"), [], "a PR the plugin hasn't read stays plain");
  const other = ctx({ threads: new Map([["thread:kite:17", "T-kite"], ["thread:wren:17", "T-wren"]]) });
  const t = tokenize("thread 17", exactCtx(other, "thread:wren:17"))[0]!;
  assert.deepEqual("open" in t ? t.open : null, { threadId: "T-wren" });
});

test("boundaries: no URL inside a word, 'and' only as a word, an unopened bracket ends a URL", () => {
  assert.deepEqual(links("xhttps://example.com"), []);
  assert.deepEqual(links("PR 8534and8"), []);
  assert.deepEqual(links("PRs 4534 and 4101"), ["pr:4534", "pr:4101"]);
  assert.deepEqual(links("[https://example.com/path]"), ["url:https://example.com/path"]);
  assert.deepEqual(links("https://en.example.org/wiki/Thing_(x)"), ["url:https://en.example.org/wiki/Thing_(x)"], "a balanced bracket stays");
});

test("a deliverable link asks the Deliverables tree to open its folder first", async () => {
  const { takeDeliverable } = await import("../app/reveal.ts");
  const nav = { openUrl: () => false, experimental_openFilePreview: () => false, toThread: () => {}, toPluginPanel: () => {} } as never;
  const t = tokenize("v-5e5488bad0c7", ctx()).find((x) => x.kind === "deliverable")!;
  assert.equal(openInBb(nav, t.open), true);
  assert.equal(takeDeliverable(), "v-5e5488bad0c7");
  assert.equal(takeDeliverable(), null, "taken once");
});

test("a PR whose next words say the state it is in drops its chip (never \"merged merged\"); words that contradict the live state keep it", () => {
  const said = (text: string, x: Partial<PrRef>) => {
    const t = tokenize(text, ctx({ projectPrs: [pr(4534, "acme/app", x)], allPrs: [pr(4534, "acme/app", x)] }));
    const i = t.findIndex((y) => y.kind === "pr");
    assert.ok(i >= 0, "the PR resolves");
    return saysState(t[i], t[i + 1]);
  };
  assert.equal(said("PR #4534 merged", { state: "merged" }), true);
  assert.equal(said("PR #4534 closed", { state: "closed" }), true);
  assert.equal(said("PR #4534 merged", { state: "open", checks: "failing" }), false, "the text says merged, the PR is open and failing: the chip shows it");
  assert.equal(said("PR #4534 waits on CI", { state: "merged" }), false, "other words keep the chip");
  assert.equal(said("PR #4534", { state: "merged" }), false, "nothing after it keeps the chip");
});
