// Open PRs' review states and "since your last copy" (2026-11-18, folded in from a contributor's public PR #4). Every
// login, repo, handle and token here is made up. What these guard: the owner asks named people, in a team channel under
// their own name, to review again or for the first time. So only people count (never a bot, never the author), a review
// on an older commit is what makes a re-review, an approval GitHub still shows is never called current when the head
// moved, and "what changed since your last copy" is measured from what was really copied or posted, never from a copy
// or a post that failed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { approversOf, buildPrompt, extractSummary, mentionHandles, prChips, reviewState, slackPost, stateWords, tag, type HumanReview } from "../core/open-prs.ts";
import { CHANGES_LEAD, changeHeader, changesForSent, changesSince, departedUrls, saveCopy, withChanges, type CopiedPr } from "../core/open-prs-copies.ts";
import { copyStore } from "../open-prs/copies.ts";

const HEAD = "head2";
const r = (login: string, state: string, sha = HEAD): HumanReview => ({ login, state, sha });
const pr = (reviews: HumanReview[], o: Partial<{ draft: boolean; requested: string[]; author: string; sha: string }> = {}) => ({ draft: false, sha: HEAD, author: "dev-one", requested: [], reviews, ...o });

// ---------------------------------------------------------------- the review states

test("only people count: the author and bots (CodeRabbit's bare login too) never make a review", () => {
  assert.deepEqual(reviewState(pr([r("dev-one", "COMMENTED"), r("coderabbitai", "APPROVED"), r("lint-helper[bot]", "APPROVED")])), { state: "first", who: [] }, "nobody but the author and bots: still a first review");
  assert.deepEqual(approversOf([{ author: { login: "coderabbitai" }, state: "APPROVED" }]), [], "a CodeRabbit approval is never a person's approval");
  assert.deepEqual(reviewState(pr([r("Dev-One", "APPROVED")])).state, "first", "the author in another case is still the author");
});

test("a draft, or a PR with no head or author, has no state: never ask anyone about unfinished work", () => {
  assert.equal(reviewState(pr([], { draft: true, requested: ["rev-a"] })).state, null);
  assert.equal(reviewState(pr([], { sha: "" })).state, null);
  assert.equal(reviewState(pr([], { author: "" })).state, null);
});

test("an approval on the current head wins; one on an older head means a re-review of those reviewers", () => {
  assert.deepEqual(reviewState(pr([r("rev-a", "APPROVED", "head1"), r("rev-b", "APPROVED")])), { state: "approved", who: ["rev-b"] });
  assert.deepEqual(reviewState(pr([r("rev-a", "APPROVED", "head1"), r("rev-b", "CHANGES_REQUESTED", "head1")])), { state: "rereview", who: ["rev-a", "rev-b"] });
  assert.deepEqual(reviewState(pr([r("rev-a", "APPROVED"), r("rev-a", "COMMENTED")])).state, "approved", "a comment after an approval doesn't take it back");
  assert.equal(reviewState(pr([r("rev-a", "APPROVED"), r("rev-a", "CHANGES_REQUESTED")])).state, null, "changes requested on this head: it waits for the author");
  assert.equal(reviewState(pr([r("rev-a", "APPROVED", "")])).state, null, "a review with no commit can't show the head moved");
});

test("a re-review GitHub still calls approved says so, so it never contradicts the review chip", () => {
  assert.equal(stateWords("rereview", true), "Re-review: approved on an older head");
  assert.equal(stateWords("rereview", false), "Re-review: reviewed on an older head");
  const chips = prChips({ draft: false, review: "approved", approved: true, approvals: "1 approval", ci: "pass", merge: "mergeable", state: "rereview" });
  assert.deepEqual(chips.map((c) => c.key), ["state", "review", "ci", "merge"]);
  assert.equal(chips[0]!.text, "Re-review: approved on an older head");
  assert.equal(prChips({ draft: false, review: "approved", approved: true, approvals: "1 approval", ci: "pass", merge: "mergeable" })[0]!.key, "review", "no state, no chip");
});

test("a first review asks the requested people first, else at most three suggested ones; teams never", () => {
  assert.deepEqual(reviewState(pr([], { requested: ["rev-c", "REV-C", "acme-co/team"] }), ["rev-x"]).who, ["REV-C"], "requested beat suggested, once each");
  assert.deepEqual(reviewState(pr([]), ["rev-x", "dev-one", "coderabbitai", "rev-y", "rev-z", "rev-w"]).who, ["rev-x", "rev-y", "rev-z"]);
});

test("the state's people are tagged only through the owner's map, in any case; an unmapped login stays a plain name", () => {
  const handles = { "Rev-A": "alpha.slack" };
  assert.equal(tag("rev-a", handles), "@alpha.slack");
  assert.equal(tag("rev-b", handles), "rev-b");
  assert.equal(tag("constructor", handles), "constructor", "nothing inherited is a mapping");
});

test("the Re-review ask says the PRs changed since they were reviewed, and asks the earlier reviewers", () => {
  const p = { url: "https://github.com/acme-co/widgets/pull/7", title: "Spin it", repo: "acme-co/widgets", summary: "Spins.", candidates: [{ name: "rev-a", say: "@alpha.slack", owner: true, recent: 0 }] };
  const text = buildPrompt([p], 5, true);
  assert.match(text, /^This PR changed since it was reviewed:/);
  // the owner (2026-11-18): they reviewed before, so the line asks them again rather than "suggesting" them
  assert.match(text, /\n\nReviewers to re-ask: @alpha\.slack$/);
  assert.doesNotMatch(text, /Suggested reviewers/);
  assert.deepEqual(mentionHandles(text), ["alpha.slack"], "the re-ask line's handles are still mentions");
  assert.match(slackPost(text, { "alpha.slack": "U0ALPHA001" }).posted, /\nReviewers to re-ask: <@U0ALPHA001>$/, "and Post sends them as real pings");
  assert.match(buildPrompt([p]), /^This PR is ready for review:/, "the other asks are unchanged");
  assert.match(buildPrompt([p]), /Suggested reviewers: @alpha\.slack$/);
});

// ---------------------------------------------------------------- the summary stays ours

test("the summary is the author's own words, never a generated summary section further down", () => {
  // on the owner's real PRs, preferring a Summary/What heading picked CodeRabbit's generated block 13 times in 38
  const body = "Fixes the widget's spin when the page reloads. Nothing else changes.\n\n<!-- generated -->\n## Summary by CodeRabbit\n\n* **New Features**\n  * Added spin.";
  assert.equal(extractSummary(body, "fix: spin"), "Fixes the widget's spin when the page reloads. Nothing else changes.");
});

// ---------------------------------------------------------------- since your last copy

const row = (n: number, o: Partial<CopiedPr> = {}): CopiedPr => ({ url: `https://github.com/acme-co/widgets/pull/${n}`, repo: "acme-co/widgets", number: n, title: `PR ${n}`, sha: "a", state: "first", review: "no review yet", ci: "pass", ...o });

test("the first copy sets a baseline and lists nothing; later ones compare every field the ask depends on", () => {
  assert.deepEqual(changesSince(undefined, [row(1)], [row(1)], {}), []);
  const base = { prs: [row(1), row(2)] };
  const now = [row(1, { sha: "b", ci: "fail", title: "PR one", review: "changes requested" }), row(2), row(3)];
  assert.deepEqual(
    changesSince(base, now, now, {}).map((c) => [c.number, c.reasons]),
    [
      [1, ["new commits", "review: no review yet → changes requested", "CI: passing → failing", "title changed"]],
      [3, ["new here"]],
    ],
  );
});

test("a PR that left the list is merged or closed only when GitHub said so; still open says where it went", () => {
  const base = { prs: [row(1), row(2), row(3), row(4)] };
  const open = [row(4, { state: "rereview" })];
  const got = changesSince(base, [], open, { [row(1).url]: "MERGED", [row(2).url]: "CLOSED" });
  assert.deepEqual(got.map((c) => [c.number, c.reasons]), [
    [1, ["merged"]],
    [2, ["closed"]],
    [3, ["no longer listed (status unconfirmed)"]],
    [4, ["left this list", "now re-review"]],
  ]);
  assert.deepEqual(departedUrls({ first: { at: 1, prs: base.prs }, needs: { at: 2, prs: [row(1)] } }, [row(4).url]), [row(1).url, row(2).url, row(3).url], "each once, open ones never asked about");
});

test("a section's copy replaces only its own baseline, an empty one included", () => {
  const h = saveCopy(saveCopy({}, "first", [row(1)], 10), "rereview", [row(2)], 20);
  const next = saveCopy(h, "first", [], 30);
  assert.deepEqual(next.first, { at: 30, prs: [] });
  assert.deepEqual(next.rereview, { at: 20, prs: [row(2)] }, "the other section is untouched");
});

test("the change header: at most six PRs then a count; nothing when nothing changed or without a baseline", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ url: row(i + 1).url, repo: "acme-co/widgets", number: i + 1, title: "", reasons: ["new here"] }));
  const h = changeHeader(many).split("\n");
  assert.equal(h[0], CHANGES_LEAD);
  assert.equal(h.length, 8);
  assert.equal(h[1], "• widgets#1: new here");
  assert.equal(h[7], "• 2 more changed PRs");
  assert.equal(changeHeader([]), "");
  assert.equal(withChanges("ASK", null), "ASK", "no baseline, or the box unticked: the ask alone");
  // the owner (2026-11-18): a message never opens with "Since the last copy: no changes."
  assert.equal(withChanges("ASK", []), "ASK", "nothing changed: the ask alone");
});

/** An in-memory kv; `failSets` makes the next sets throw. */
function memKv() {
  const m = new Map<string, unknown>();
  const kv = { failSets: 0, get: async <T>(k: string) => structuredClone(m.get(k)) as T, set: async <T>(k: string, v: T) => {
    await new Promise((res) => setTimeout(res, 1));
    if (kv.failSets > 0) {
      kv.failSets--;
      throw new Error("kv down");
    }
    m.set(k, structuredClone(v));
  } };
  return kv;
}

test("baselines: overlapping writes keep both sections, logins are apart, and a failed write keeps the old one", async () => {
  const kv = memKv();
  let t = 0;
  const store = copyStore(kv, () => ++t);
  await Promise.all([store.remember("Dev-One", "first", [row(1)]), store.remember("dev-one", "rereview", [row(2)])]);
  const h = await store.read("dev-one");
  assert.deepEqual([h.first?.prs.map((p) => p.number), h.rereview?.prs.map((p) => p.number)], [[1], [2]], "neither write erased the other");
  assert.deepEqual(await store.read("dev-two"), {});
  kv.failSets = 1;
  await assert.rejects(store.remember("dev-one", "first", [row(9)]));
  assert.deepEqual((await store.read("dev-one")).first?.prs.map((p) => p.number), [1], "the failed write moved nothing");
  await store.remember("dev-one", "first", [row(3)]);
  assert.deepEqual((await store.read("dev-one")).first?.prs.map((p) => p.number), [3], "and didn't block the next");
});

// ---------------------------------------------------------------- the baseline moves only on a successful copy or post

const TOKEN = "made-up-cred";
function slack(postAnswer: "ok" | "refused" | "silent") {
  return async (url: string, init: any) => {
    const method = url.slice("https://slack.com/api/".length).split("?")[0]!;
    const answer = (j: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => j });
    if (method === "conversations.list") return answer({ ok: true, channels: [{ id: "C0REVIEWS1", name: "team-reviews" }], response_metadata: { next_cursor: "" } });
    if (method === "users.list") return answer({ ok: true, members: [{ id: "U0ALPHA001", name: "alpha.slack", profile: { display_name: "alpha.slack" } }], response_metadata: { next_cursor: "" } });
    if (method === "chat.postMessage") {
      if (postAnswer === "silent") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      return answer(postAnswer === "ok" ? { ok: true, channel: JSON.parse(init.body).channel, ts: "1700000001.000100" } : { ok: false, error: "not_in_channel" });
    }
    if (method === "chat.getPermalink") return answer({ ok: true, permalink: "https://example.invalid/p1" });
    return answer({ ok: false, error: "unknown_method" });
  };
}
async function server(postAnswer: "ok" | "refused" | "silent") {
  const { registerOpenPrs } = await import("../open-prs/server.ts");
  const handlers: Record<string, (i: any) => Promise<any>> = {};
  const kv = memKv();
  const bb: any = {
    hosts: { experimental_client: () => ({ call: () => new Promise(() => {}) }) },
    sdk: { hosts: { list: async () => [] }, threads: { get: async () => null } },
    storage: { kv },
    rpc: { register: (_c: unknown, h: any) => Object.assign(handlers, h) },
    realtime: { publish: () => {} },
    log: { warn: () => {}, info: () => {} },
  };
  const settings = { githubLogin: "dev-one", reviewChannel: "team-reviews", reviewExcludedProjects: "", slackHandleMap: "", prPollMinutes: 5, slackToken: TOKEN };
  const api = registerOpenPrs(bb, { agents: () => [] } as any, () => settings, slack(postAnswer) as any);
  const baseline = async () => (await copyStore(kv).read("dev-one")).rereview?.prs.map((p) => p.number) ?? null;
  return { handlers, api, baseline };
}
const TEXT = "This PR changed since it was reviewed:\n\n*Spin it*\nhttps://github.com/acme-co/widgets/pull/7\n• Spins.\n\nSuggested reviewers: @alpha.slack";

test("a post that went out keeps what it held as the section's baseline; a refused or unanswered one never does", async () => {
  for (const [answer, kept] of [["ok", [7]], ["refused", null], ["silent", null]] as const) {
    const s = await server(answer);
    await s.handlers.openPrsPrepare!({ key: `key-${answer}-0001`, text: TEXT, copied: { section: "rereview", prs: [row(7, { state: "rereview" })] } });
    await s.api.post(`key-${answer}-0001`).catch(() => null);
    assert.deepEqual(await s.baseline(), kept, `post ${answer}`);
  }
});

test("a successful copy's write keeps exactly the copied PRs, and the view hands every baseline to the page", async () => {
  const s = await server("ok");
  await s.api.copied({ section: "rereview", prs: [row(7), row(8)] });
  assert.deepEqual(await s.baseline(), [7, 8]);
  const v = await s.handlers.openPrs!(null);
  assert.deepEqual(v.copied.rereview.prs.map((p: CopiedPr) => p.number), [7, 8]);
});

test("the page keeps a baseline only after the clipboard took the copy, and the confirm names who gets pinged (source)", () => {
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  const ask = src.slice(src.indexOf("const doCopy"), src.indexOf("const doCopy") + 300);
  assert.ok(ask.indexOf("if (!(await copy(text))) return") >= 0 && ask.indexOf("if (!(await copy(text))) return") < ask.indexOf("keepCopy("), "Copy: a failed clipboard write returns before the baseline");
  const open = src.slice(src.indexOf("const copyAndOpen"), src.indexOf("const prepare"));
  assert.ok(open.indexOf("if (!ok) return") < open.indexOf("keepCopy("), "Copy and open: the same");
  assert.match(src, /data-pings=""[\s\S]{0,120}Pings: /, "the Post confirm lists the mentions it will send");
  assert.match(src, /copied: \{ section, prs: chosen\.map\(copiedRow\) \}/, "a post holds exactly the ticked PRs");
});

test("Post, its ticks and the review ask sit in a dialog over the list, so opening it can't move the list (source)", () => {
  // the owner (2026-11-18): "when you click 'post a code review,' the checkboxes come up then. it's just too much to
  // scroll". The browser check is test/e2e/open-prs-post.mjs; this keeps the page from growing an inline block again.
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  const post = src.slice(src.indexOf("function Post("), src.indexOf("function PostConfirm("));
  assert.match(post, /return \(\s*<Dialog open /, "Post draws only a Dialog");
  assert.match(post, /<DialogContent[\s\S]*data-tick=[\s\S]*<SinceLastCopy [\s\S]*data-post-text[\s\S]*data-pings-draft/, "with the ticks, since-last-copy, the preview and the pings inside it");
  const body = src.slice(src.indexOf("function OpenPrsBody("));
  assert.doesNotMatch(body, /<SinceLastCopy |<SlackMessage |data-tick/, "the page itself holds only the filters and the list");
});

test("a Post that leaves a PR unticked never names it in its header, so the next one can't call it new", () => {
  // Post keeps only the ticked PRs as the baseline; a PR from an excluded project starts unticked every time
  const base = { prs: [row(1), row(2)] };
  const listed = [row(1, { sha: "b" }), row(2), row(3)];
  const all = changesSince(base, listed, listed, {});
  assert.deepEqual(all.map((c) => c.number), [1, 3]);
  assert.deepEqual(changesForSent(all, [row(1).url, row(2).url], listed.map((p) => p.url)).map((c) => c.number), [1], "3 is unticked: not in this message");
  const gone = changesSince({ prs: [row(4)] }, [], [], { [row(4).url]: "MERGED" });
  assert.deepEqual(changesForSent(gone, [], []).map((c) => c.reasons), [["merged"]], "a PR that left the list is still said");
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  assert.match(src, /askText\(chosen, section, changes && changesForSent\(changes, chosen\.map/, "Post's text uses it");
});

// ---------------------------------------------------------------- the server's read, through a fake host

const GH = "https://github.com/acme-co/widgets/pull/";
const raw = (n: number, o: Record<string, unknown> = {}) => ({
  url: `${GH}${n}`, number: n, title: `PR ${n}`, body: "Spins it.", repo: "acme-co/widgets", draft: false, updatedAt: "2026-01-02T03:04:05Z", branch: `b${n}`, sha: `s${n}`,
  reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE", mergeState: "BLOCKED", checks: "SUCCESS", approvedBy: [], required: 1, author: "dev-one", reviews: [], requested: [], ...o,
});
async function readServer(o: { host?: (m: string, i: any) => Promise<any>; seed?: Record<string, unknown> } = {}) {
  const { registerOpenPrs } = await import("../open-prs/server.ts");
  const handlers: Record<string, (i: any) => Promise<any>> = {};
  const kv = memKv();
  for (const [k, v] of Object.entries(o.seed ?? {})) await kv.set(k, v);
  const bb: any = {
    hosts: { experimental_client: () => ({ call: (m: string, i: any) => (o.host ?? (() => new Promise(() => {})))(m, i) }) },
    sdk: { hosts: { list: async () => [{ id: "h1", type: "persistent", lifecycle: { phase: "active" }, status: "connected" }] }, threads: { get: async () => null } },
    storage: { kv },
    rpc: { register: (_c: unknown, h: any) => Object.assign(handlers, h) },
    realtime: { publish: () => {} },
    log: { warn: () => {}, info: () => {} },
  };
  const settings = { githubLogin: "dev-one", reviewChannel: "", reviewExcludedProjects: "", slackHandleMap: JSON.stringify({ "Rev-A": "alpha.slack" }), prPollMinutes: 5 };
  registerOpenPrs(bb, { agents: () => [], prByUrl: () => null } as any, () => settings);
  const read = async () => {
    for (let i = 0; i < 100; i++) {
      const v = await handlers.openPrs!(null);
      if (v.state === "ok" && !v.checking) return v;
      await new Promise((res) => setTimeout(res, 10));
    }
    throw new Error("the read never landed");
  };
  return { read, view: () => handlers.openPrs!(null) };
}

test("the server's read: states and their people through the owner's map, candidates for a failing first review, departed PRs only as GitHub says", async () => {
  const s = await readServer({
    seed: { "openPrs.copied.v1.dev-one": { first: { at: 1, prs: [row(8), row(9)] } } },
    host: async (m, i) => {
      if (m === "prs.open") return { prs: [raw(1, { checks: "FAILURE", requested: ["rev-a"] }), raw(2, { reviews: [{ login: "rev-a", state: "APPROVED", sha: "old" }] }), raw(3, { draft: true })], more: false };
      if (m === "prs.files") return { sha: `s${i.url.split("/").pop()}`, files: ["apps/web/x.ts"] };
      if (m === "prs.area") return { codeowners: "apps/web/ @rev-b\n", recent: [] };
      if (m === "prs.wait") {
        if (i.url.endsWith("/9")) throw new Error("gh down");
        return { outcome: "available", pullRequest: { url: i.url, state: "merged" } };
      }
      throw new Error(m);
    },
  });
  const v = await s.read();
  const by = Object.fromEntries(v.prs.map((p: any) => [p.number, p]));
  assert.equal(by[1].needsReview, false, "CI failing: not in Needs review");
  assert.equal(by[1].state, "first");
  assert.deepEqual(by[1].stateWho.map((c: any) => c.say), ["@alpha.slack"], "the requested person, tagged through slackHandleMap in any case");
  assert.deepEqual(by[1].candidates.map((c: any) => c.name), ["rev-b"], "a first review with failing CI still gets candidates");
  assert.equal(by[2].state, "rereview");
  assert.deepEqual(by[2].stateWho.map((c: any) => c.say), ["@alpha.slack"]);
  assert.equal(by[3].state, null, "a draft has no state");
  assert.deepEqual(v.departed, { [`${GH}8`]: "MERGED" }, "8 merged as GitHub said; 9's read failed, so nothing is claimed");
  const gone = changesSince(v.copied.first, [], [], v.departed);
  assert.deepEqual(gone.map((c) => c.reasons[0]), ["merged", "no longer listed (status unconfirmed)"]);
});

test("a snapshot kept before the review states still paints at once, with no state until the next read", async () => {
  const kept = { v: 1, login: "dev-one", at: 1, more: false, prs: [{ url: `${GH}1`, number: 1, title: "PR 1", repo: "acme-co/widgets", draft: false, updatedAt: "2026-01-02T03:04:05Z", reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE", mergeState: "BLOCKED", checks: "SUCCESS", approvedBy: [], required: 1, summary: "Spins it.", agent: null, cands: [] }] };
  const s = await readServer({ seed: { "openPrs.snapshot.v1": kept } });
  const v = await s.view();
  assert.equal(v.state, "ok");
  assert.deepEqual([v.prs[0].state, v.prs[0].stateWho, v.prs[0].sha], [null, [], ""]);
});
