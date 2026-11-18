// Open PRs' Post through Slack (2026-11-17, the owner: "Post as me"). A fake fetch stands in for slack.com; every
// workspace, channel, person and token here is made up. What these guard: the message goes to a team channel under the
// owner's name, so nothing is sent without a token and an explicit confirm, it is sent once, it says exactly what the
// confirm showed, @handles become real mentions or plain names, and Slack's refusals say what to fix.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { buildPrompt, slackLines, slackPost } from "../core/open-prs.ts";
import { slackWords, channelRef } from "../open-prs/slack.ts";

const TOKEN = "made-up-cred"; // not token-shaped: the release scan flags anything that looks like a real one

/** A fake slack.com: a channel list, a user list and chat.postMessage; `fail` makes a method answer an error. */
function fakeSlack(opts: { fail?: Record<string, { error: string; needed?: string }>; hang?: string; postGate?: Promise<void> } = {}) {
  const calls: { method: string; url: string; init: any }[] = [];
  const posts: { channel: string; text: string }[] = [];
  const fetch = async (url: string, init: any) => {
    const method = url.slice("https://slack.com/api/".length).split("?")[0]!;
    calls.push({ method, url, init });
    if (opts.hang === method) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const answer = (j: unknown, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => j });
    const f = opts.fail?.[method];
    if (f) return answer({ ok: false, ...f });
    if (method === "conversations.list") return answer({ ok: true, channels: [{ id: "C0REVIEWS1", name: "team-reviews" }, { id: "C0OTHER001", name: "random" }], response_metadata: { next_cursor: "" } });
    if (method === "users.list")
      return answer({ ok: true, members: [{ id: "U0ALPHA001", name: "alpha.slack", profile: { display_name: "Alpha" } }, { id: "U0GONE0001", name: "gamma", deleted: true }, { id: "U0BETA0001", name: "b.person", profile: { display_name: "beta" } }, { id: "U0SAME0001", name: "sam.one", profile: { display_name: "Sam" } }, { id: "U0SAME0002", name: "sam.two", profile: { display_name: "sam" } }, { id: "U0CLASH001", name: "c.person", profile: { display_name: "alpha.slack" } }], response_metadata: { next_cursor: "" } });
    if (method === "chat.postMessage") {
      if (opts.postGate) await opts.postGate;
      const b = JSON.parse(init.body);
      posts.push({ channel: b.channel, text: b.text });
      return answer({ ok: true, channel: b.channel, ts: `17000000${posts.length}.000100` });
    }
    if (method === "chat.getPermalink") return answer({ ok: true, permalink: "https://example.invalid/archives/C0REVIEWS1/p1700000001000100" });
    return answer({ ok: false, error: "unknown_method" });
  };
  return { fetch, calls, posts };
}

/** The real registerOpenPrs on a fake bb, with the given settings and fake slack. */
async function server(slack: ReturnType<typeof fakeSlack>, s: Partial<{ slackToken: string; reviewChannel: string }> = {}) {
  const { registerOpenPrs } = await import("../open-prs/server.ts");
  const handlers: Record<string, (i: any) => Promise<any>> = {};
  const bb: any = {
    hosts: { experimental_client: () => ({ call: () => new Promise(() => {}) }) },
    sdk: { hosts: { list: async () => [] }, threads: { get: async () => null } },
    storage: { kv: { get: async () => undefined, set: async () => {} } },
    rpc: { register: (_c: unknown, h: any) => Object.assign(handlers, h) },
    realtime: { publish: () => {} },
    log: { warn: () => {}, info: () => {} },
  };
  const settings = { githubLogin: "dev-one", reviewChannel: "team-reviews", reviewExcludedProjects: "", slackHandleMap: "", prPollMinutes: 5, slackToken: TOKEN, ...s };
  const api = registerOpenPrs(bb, { agents: () => [] } as any, () => settings, slack.fetch as any);
  return { prepare: (key: string, text: string) => handlers.openPrsPrepare!({ key, text }), post: api.post, view: () => handlers.openPrs!(null), settings };
}

const pr = (n: number, say: string[]) => ({ url: `https://github.com/acme-co/widgets/pull/${n}`, title: `Widget <change> & ${n}`, repo: "acme-co/widgets", summary: `Spins it ${n}.`, candidates: say.map((x) => ({ name: x.replace(/^@/, ""), say: x, owner: true, recent: 0 })) });
const TEXT = buildPrompt([pr(1, ["@alpha.slack", "@nobody.here"]), pr(2, ["rev-b"])]);
const KEY = "key-0000-aaaa";

test("no token: Post copies as before (the view says so) and nothing reaches Slack", async () => {
  const slack = fakeSlack();
  const s = await server(slack, { slackToken: "" });
  assert.equal((await s.view()).canPost, false, "the page shows Copy and open, not Post");
  await assert.rejects(s.prepare(KEY, TEXT), /No Slack token/);
  await assert.rejects(s.post(KEY), /Nothing is ready|No Slack token/);
  assert.equal(slack.calls.length, 0, "not one request to Slack without a token");
  s.settings.slackToken = "  ";
  assert.equal((await s.view()).canPost, false, "a blank token is no token");
});

test("a token: canPost, and the page draws Post's two steps only then (source)", async () => {
  const s = await server(fakeSlack());
  assert.equal((await s.view()).canPost, true);
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  assert.match(src, /view\.canPost \? \(\s*<Btn tone="primary" data-post-prepare=""/, "with a token: the prepare step");
  assert.match(src, /\) : \(\s*<Btn tone="primary" data-post-confirm=""[^>]*onClick=\{\(\) => void copyAndOpen\(\)\}/, "without: copy and open, as before");
});

test("nothing posts without the explicit confirm: prepare only reads, and a post needs a prepared key", async () => {
  const slack = fakeSlack();
  const s = await server(slack);
  await assert.rejects(s.post("never-prepared-1"), /Nothing is ready to post/, "the confirm's key must have been prepared");
  const ready = await s.prepare(KEY, TEXT);
  assert.equal(ready.channel, "#team-reviews");
  assert.equal(slack.posts.length, 0, "the first click (prepare) sends nothing");
  assert.deepEqual([...new Set(slack.calls.map((c) => c.method))].sort(), ["conversations.list", "users.list"], "prepare only reads");
  await s.post(KEY);
  assert.equal(slack.posts.length, 1, "the confirm sends");
  assert.equal(slack.posts[0]!.channel, "C0REVIEWS1", "to the channel's ID, found from its name");
});

test("a double click, or a resend with the same key, never posts twice", async () => {
  let open!: () => void;
  const slack = fakeSlack({ postGate: new Promise<void>((r) => (open = r)) });
  const s = await server(slack);
  await s.prepare(KEY, TEXT);
  const a = s.post(KEY); // both clicks land while the first post is in flight
  const b = s.post(KEY);
  open();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(slack.posts.length, 1, "one message");
  assert.deepEqual(ra, rb, "the second gets the first's outcome");
  await s.post(KEY);
  assert.equal(slack.posts.length, 1, "a later resend with the key: still one");
  await assert.rejects(s.prepare(KEY, TEXT), /already posted/, "a posted preview can't be prepared again");
});

test("Slack's refusal sends nothing, so the same preview may retry; no answer may have posted, so it never retries", async () => {
  const refused = fakeSlack({ fail: { "chat.postMessage": { error: "not_in_channel" } } });
  const s1 = await server(refused);
  await s1.prepare(KEY, TEXT);
  await assert.rejects(s1.post(KEY), /isn't in #team-reviews/);
  await assert.rejects(s1.post(KEY), /isn't in #team-reviews/, "asked again: Slack is asked again");
  assert.equal(refused.calls.filter((c) => c.method === "chat.postMessage").length, 2);
  const silent = fakeSlack({ hang: "chat.postMessage" });
  const s2 = await server(silent);
  await s2.prepare(KEY, TEXT);
  await assert.rejects(s2.post(KEY), /may have posted/);
  await assert.rejects(s2.post(KEY), /may have posted/);
  assert.equal(silent.calls.filter((c) => c.method === "chat.postMessage").length, 1, "an unanswered post is never sent again");
});

test("the posted text is the confirm's text: Slack shows exactly what the owner confirmed", async () => {
  const slack = fakeSlack();
  const s = await server(slack);
  const ready = await s.prepare(KEY, TEXT);
  await s.post(KEY);
  const sent = slack.posts[0]!.text;
  // Slack draws <@ID> as the person's @name and un-escapes &amp; &lt; &gt;: undo exactly that, and it is the confirm's text
  const drawn = sent.replace(/<@U0ALPHA001>/g, "@alpha.slack").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.equal(drawn, ready.shown, "what Slack shows = what the confirm drew");
  assert.doesNotMatch(sent.replace(/<@U[A-Z0-9]+>/g, ""), /[<>]/, "no raw < or > that Slack would read as markup");
  assert.equal(ready.shown, TEXT.replace("@nobody.here", "nobody.here"), "and it is the preview's copied text, but for a handle no one has");
  // the confirm draws the server's `shown` through the same SlackMessage as the preview
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  assert.match(src, /<SlackMessage text=\{ready\.shown\}[^>]*data-post-shown/);
  // the same `text` the preview draws; copied (2026-11-18) is only the baseline the post keeps, never message text
  assert.match(src, /rpc\.call\("openPrsPrepare", \{ key, text(?: \}|, copied: \{ section, prs: chosen\.map\(copiedRow\) \} \})\)/, "what is prepared is the preview's own string");
  assert.match(src, /write\(OPEN_PRS_POST, \{ key \}/, "the confirm sends only the key: no text the confirm didn't show");
});

test("mentions: a mapped @handle becomes a real <@ID> mention; one no one has is named in plain words; the list is cached", async () => {
  const text = "These 1 PRs:\n\nSuggested reviewers: @Alpha, @beta, @nobody.here, rev-c";
  const m = slackPost(text, { alpha: "U0ALPHA001", beta: "U0BETA0001", "nobody.here": null });
  assert.equal(m.posted.split("\n").at(-1), "Suggested reviewers: <@U0ALPHA001>, <@U0BETA0001>, nobody.here, rev-c");
  assert.equal(m.shown.split("\n").at(-1), "Suggested reviewers: @Alpha, @beta, nobody.here, rev-c", "no @ on a name that would never notify");
  assert.deepEqual(m.unresolved, ["nobody.here"]);
  assert.equal(slackPost("Suggested reviewers: @x", { x: "not-an-id" }).posted, "Suggested reviewers: x", "only a user ID becomes a mention");
  assert.equal(slackPost("A summary says @alpha", { alpha: "U0ALPHA001" }).posted, "A summary says @alpha", "only the reviewers line mentions anyone");
  const slack = fakeSlack();
  const s = await server(slack);
  const ready = await s.prepare(KEY, TEXT);
  assert.match(ready.notes.join(" "), /Not found in Slack: @nobody\.here/);
  await s.prepare("key-0000-bbbb", TEXT);
  assert.equal(slack.calls.filter((c) => c.method === "users.list").length, 1, "users are listed once, then cached");
  await s.post(KEY);
  assert.match(slack.posts[0]!.text, /Suggested reviewers: <@U0ALPHA001>, nobody\.here, rev-b$/);
});

test("without users:read, @handles are plain words with a note, and the post still goes", async () => {
  const slack = fakeSlack({ fail: { "users.list": { error: "missing_scope", needed: "users:read" } } });
  const s = await server(slack);
  const ready = await s.prepare(KEY, TEXT);
  assert.match(ready.notes[0]!, /lacks the users:read scope/);
  assert.doesNotMatch(ready.shown, /@alpha/);
  await s.post(KEY);
  assert.equal(slack.posts.length, 1);
});

test("Slack's refusals say what to fix, and the token appears nowhere but the Authorization header", async () => {
  assert.match(slackWords("invalid_auth"), /refused the token.*slackToken/);
  assert.match(slackWords("missing_scope", { needed: "chat:write" }), /lacks the chat:write scope.*reinstall/);
  assert.match(slackWords("not_in_channel", { channel: "#team-reviews" }), /isn't in #team-reviews.*invite/);
  assert.match(slackWords("channel_not_found", { channel: "#nope" }), /no channel #nope/);
  const bad = await server(fakeSlack({ fail: { "chat.postMessage": { error: "invalid_auth" } } }));
  await bad.prepare(KEY, TEXT);
  const e = await bad.post(KEY).catch((x: Error) => x);
  assert.match(String(e), /refused the token/);
  const scope = await server(fakeSlack({ fail: { "chat.postMessage": { error: "missing_scope", needed: "chat:write" } } }));
  await scope.prepare(KEY, TEXT);
  await assert.rejects(scope.post(KEY), /lacks the chat:write scope/);
  const nochan = await server(fakeSlack(), { reviewChannel: "no-such-channel" });
  await assert.rejects(nochan.prepare(KEY, TEXT), /no channel #no-such-channel/);
  const unset = await server(fakeSlack(), { reviewChannel: "" });
  await assert.rejects(unset.prepare(KEY, TEXT), /Set reviewChannel/);
  const slack = fakeSlack();
  const s = await server(slack);
  await s.prepare(KEY, TEXT);
  await s.post(KEY);
  for (const c of slack.calls) {
    assert.equal(c.init.headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!c.url.includes(TOKEN) && !(c.init.body ?? "").includes(TOKEN), `${c.method}: the token is only in the header`);
  }
  assert.ok(!String(e).includes(TOKEN));
});

test("reviewChannel: a name is looked up, an ID or a link's ID is used as it is", () => {
  assert.deepEqual(channelRef("#Team-Reviews"), { name: "team-reviews" });
  assert.deepEqual(channelRef("C0REVIEWS1"), { id: "C0REVIEWS1" });
  assert.deepEqual(channelRef("https://example.invalid/archives/C0REVIEWS1"), { id: "C0REVIEWS1" });
  assert.deepEqual(channelRef("https://slack.com/app_redirect?channel=team-reviews"), { name: "team-reviews" });
  assert.equal(channelRef(""), null);
  assert.equal(channelRef("not a channel!"), null);
});

test("the posted message keeps the preview's links and bold: slackLines reads the same tokens from both", () => {
  const m = slackPost(TEXT, { "alpha.slack": "U0ALPHA001" });
  const kinds = (t: string) => slackLines(t).flatMap((l) => l.toks.filter((x) => x.kind === "link" || x.kind === "bold").map((x) => x.show));
  assert.deepEqual(kinds(m.posted.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")), kinds(m.shown));
});

test("a mention never lands on the wrong person: the username wins, and a display name two people share is not used", async () => {
  // Display names aren't unique in Slack: guessing between two people would ping the wrong one in a team channel.
  const slack = fakeSlack();
  const s = await server(slack);
  const text = "These 1 PRs:\n\nSuggested reviewers: @alpha.slack, @Sam, @beta";
  const ready = await s.prepare(KEY, text);
  await s.post(KEY);
  const last = slack.posts[0]!.text.split("\n").at(-1);
  assert.equal(last, "Suggested reviewers: <@U0ALPHA001>, Sam, <@U0BETA0001>", "alpha.slack is a username (not c.person's display name); Sam is two people");
  assert.match(ready.notes.join(" "), /@Sam/);
});
