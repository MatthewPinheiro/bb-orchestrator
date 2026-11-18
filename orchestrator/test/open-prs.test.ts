// The Open PRs tab's rules (core/open-prs.ts). Everything here is made up: logins, orgs, repos, handles and projects.
// What these guard: the owner pastes this text into a team channel under their own name, so it must ask only for PRs
// that are really ready, tag only people the owner mapped, leave out what they excluded, and stay cheap to keep current.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PR_CHIP_TONES } from "../app/palette.ts";
import {
  BARE_REF,
  buildPrompt,
  prChips,
  prRef,
  slackHtml,
  slackLines,
  slackText,
  candidatesFor,
  channelOf,
  dueToFetch,
  extractSummary,
  fullyApproved,
  initialTicks,
  needsReview,
  noBareRefs,
  ownersOf,
  parseCodeowners,
  parseExcluded,
  parseHandleMap,
  pruneCache,
  suggestReviewers,
  summaryFor,
  tag,
  type Candidate,
  type RawPr,
  type SummaryCache,
} from "../core/open-prs.ts";

const pr = (p: Partial<RawPr> = {}): RawPr => ({
  url: "https://github.com/acme-co/widgets/pull/101",
  number: 101,
  title: "Make the widget spin",
  body: "",
  repo: "acme-co/widgets",
  draft: false,
  updatedAt: "2026-01-02T03:04:05Z",
  branch: "dev-one/spin",
  sha: "aaaa",
  reviewDecision: "REVIEW_REQUIRED",
  mergeable: "MERGEABLE",
  mergeState: "BLOCKED",
  checks: "SUCCESS",
  approvedBy: [],
  required: 2,
  author: "dev-one",
  reviews: [],
  requested: [],
  ...p,
});

// ---------------------------------------------------------------- Needs review

test("a draft never enters Needs review: asking people to review unfinished work wastes their time", () => {
  assert.equal(needsReview(pr()), true, "the ready baseline needs review");
  assert.equal(needsReview(pr({ draft: true })), false);
  assert.equal(needsReview(pr({ draft: true, checks: "PENDING" })), false);
});

test("a PR with failing CI never enters Needs review: it must go green before anyone is asked", () => {
  assert.equal(needsReview(pr({ checks: "FAILURE" })), false);
  assert.equal(needsReview(pr({ checks: "ERROR" })), false);
  assert.equal(needsReview(pr({ checks: "PENDING" })), true, "running CI is not failing");
  assert.equal(needsReview(pr({ checks: null })), true, "a repo with no checks is not failing");
});

test("a fully approved PR leaves Needs review; GitHub's decision wins over counting approvals", () => {
  assert.equal(needsReview(pr({ reviewDecision: "APPROVED", approvedBy: ["rev-a", "rev-b"] })), false);
  assert.equal(needsReview(pr({ reviewDecision: "REVIEW_REQUIRED", approvedBy: ["rev-a"] })), true, "1 of 2 is not enough");
  assert.equal(needsReview(pr({ reviewDecision: "CHANGES_REQUESTED", approvedBy: ["rev-a", "rev-b"] })), true, "changes requested: not approved");
});

test("with no review rule (no decision from GitHub), one approval or the rules' count is fully approved", () => {
  assert.equal(fullyApproved(pr({ reviewDecision: null, required: null, approvedBy: [] })), false);
  assert.equal(fullyApproved(pr({ reviewDecision: null, required: null, approvedBy: ["rev-a"] })), true);
  assert.equal(fullyApproved(pr({ reviewDecision: null, required: 2, approvedBy: ["rev-a"] })), false);
});

// ---------------------------------------------------------------- reading GitHub's answer

// (the gh JSON shapes, bots and the required count: gh-reads.test.ts)

// ---------------------------------------------------------------- the summary

test("the summary is the TL;DR section, in plain words, not the rest of the body", () => {
  const body = "## TL;DR\n\nMakes the **widget** spin [faster](https://x.test/a) in `prod_mode`.\n\n## Details\n\nLots of other text.";
  assert.equal(extractSummary(body, "title"), "Makes the widget spin faster in prod_mode.");
  assert.equal(extractSummary("Intro line.\n\n**TL;DR:** Fixes the spin.\n\nMore.", "t"), "Fixes the spin.");
});

test("without a TL;DR, the first prose paragraph, cut near 200 characters; no body gives the title", () => {
  const long = "word ".repeat(80).trim();
  const s = extractSummary(`<!-- template -->\n# Title here\n\n${long}\n\nSecond paragraph.`, "t");
  assert.ok(s.length <= 200, `cut: ${s.length}`);
  assert.ok(s.endsWith("…"));
  assert.equal(extractSummary("", "Make the widget spin"), "Make the widget spin");
  assert.equal(extractSummary("```\ncode only\n```", "Fallback"), "Fallback", "code is never the summary");
});

test("the summary cache recomputes only when the head sha changes", () => {
  const cache: SummaryCache = {};
  let runs = 0;
  const compute = (b: string) => (runs++, `S:${b}`);
  assert.deepEqual(summaryFor(cache, pr({ body: "one" }), compute), { summary: "S:one", computed: true });
  assert.deepEqual(summaryFor(cache, pr({ body: "edited body, same head" }), compute), { summary: "S:one", computed: false }, "same sha: the cached summary");
  assert.equal(runs, 1, "an unchanged sha must not recompute");
  assert.deepEqual(summaryFor(cache, pr({ sha: "bbbb", body: "two" }), compute), { summary: "S:two", computed: true });
  assert.equal(runs, 2);
  assert.deepEqual(Object.keys(pruneCache(cache, [])), [], "closed PRs leave the cache");
});

// ---------------------------------------------------------------- reviewers and tags

const handles = { "Rev-A": "alpha.slack", "rev-c": "@gamma" };

test("only a mapped login gets an @handle; an unmapped one stays its plain name, never a guess", () => {
  assert.equal(tag("rev-a", handles), "@alpha.slack", "case-insensitive login match");
  assert.equal(tag("rev-c", handles), "@gamma", "a handle written with @ isn't doubled");
  assert.equal(tag("rev-b", handles), "rev-b");
  assert.equal(tag("@acme-co/platform", handles), "acme-co/platform", "a team is never tagged");
  assert.equal(tag("team-lead@acme", handles), "team-lead@acme", "an email is never tagged");
  assert.doesNotMatch(tag("rev-b", {}), /@/);
});

test("CODEOWNERS: last match wins, folders match below them, unanchored names match anywhere", () => {
  const rules = parseCodeowners("# owners\n* @rev-d\n/apps/api/ @rev-a @acme-co/platform\n*.md @rev-b\ndocs/** @rev-c\n");
  assert.deepEqual(ownersOf(rules, "apps/api/x/y.py"), ["@rev-a", "@acme-co/platform"]);
  assert.deepEqual(ownersOf(rules, "apps/api/README.md"), ["@rev-b"]);
  assert.deepEqual(ownersOf(rules, "docs/a/b.txt"), ["@rev-c"]);
  assert.deepEqual(ownersOf(rules, "other/file.ts"), ["@rev-d"]);
});

test("candidates: CODEOWNERS first, then recent reviewers of the same area; never the author, never a bot", () => {
  const area = {
    codeowners: "/apps/api/ @rev-a @dev-one\n",
    recent: [
      { files: ["apps/api/z.py"], reviewers: ["rev-b", "dev-one", "helper[bot]"] },
      { files: ["apps/api/q.py"], reviewers: ["rev-b"] },
      { files: ["web/elsewhere.ts"], reviewers: ["rev-e"] },
    ],
  };
  const c = candidatesFor(["apps/api/x.py"], area, "Dev-One", handles);
  assert.deepEqual(c.map((x) => [x.name, x.say, x.owner, x.recent]), [
    ["rev-a", "@alpha.slack", true, 0],
    ["rev-b", "rev-b", false, 2],
  ]);
});

// ---------------------------------------------------------------- the prompt

const cand = (name: string, say = name): Candidate => ({ name, say, owner: true, recent: 0 });
const promptPr = (n: number, summary: string, candidates: Candidate[] = [], title = `Widget change ${n}`) => ({ url: `https://github.com/acme-co/widgets/pull/${n}`, title, repo: "acme-co/widgets", summary, candidates });

test("the prompt: each PR's title in bold, its full URL on its own line, a summary bullet under it, reviewers at the end", () => {
  const text = buildPrompt([promptPr(1, "Spins the widget.", [cand("rev-a", "@alpha.slack")]), promptPr(2, "Stops the widget.", [cand("rev-b")])]);
  assert.equal(
    text,
    [
      "These 2 PRs are ready for review:",
      "*Widget change 1*\nhttps://github.com/acme-co/widgets/pull/1\n• Spins the widget.",
      "*Widget change 2*\nhttps://github.com/acme-co/widgets/pull/2\n• Stops the widget.",
      "Suggested reviewers: @alpha.slack, rev-b",
    ].join("\n\n"),
  );
  assert.equal(buildPrompt([]), "", "nothing ticked, nothing to copy");
});

test("the prompt never holds a bare #number, even when a PR body says 'Fixes #45'", () => {
  const body = "## TL;DR\nFixes #45 and follows up on #7 (see acme-co/widgets#9).";
  const text = buildPrompt([promptPr(3, extractSummary(body, "t"), [], "fix: the *spin* bug from #12")]);
  assert.doesNotMatch(text, BARE_REF, text);
  assert.match(text, /^\*fix: the spin bug from https:\/\/github\.com\/acme-co\/widgets\/issues\/12\*$/m, "a title's #n is a URL too, and its own * can't break the bold");
  assert.match(text, /https:\/\/github\.com\/acme-co\/widgets\/issues\/45/);
  assert.match(text, /acme-co\/widgets#9/, "an owner/repo#n reference is already full");
  assert.equal(noBareRefs("&#123; entity", "acme-co/widgets"), "&#123; entity");
});

test("suggested reviewers come only from the ticked PRs: an unticked PR's reviewers are not tagged", () => {
  const a = promptPr(1, "A", [cand("rev-a", "@alpha.slack")]);
  const b = promptPr(2, "B", [cand("rev-c", "@gamma")]);
  assert.match(buildPrompt([a, b]), /@gamma/);
  assert.doesNotMatch(buildPrompt([a]), /@gamma/);
  assert.equal(suggestReviewers([a, b], 1).length, 1, "capped");
});

// ---------------------------------------------------------------- Post

test("an excluded project's PRs start unticked in the Post preview; others and unmapped PRs start ticked", () => {
  const ticks = initialTicks(
    [
      { url: "u1", project: "skunkworks" },
      { url: "u2", project: "widgets" },
      { url: "u3", project: null },
    ],
    parseExcluded("skunkworks, other\nthird"),
  );
  assert.deepEqual(ticks, { u1: false, u2: true, u3: true });
});

test("settings: the handle map must be a JSON object; the channel is a name or an https link", () => {
  assert.deepEqual(parseHandleMap(""), { map: {}, error: null });
  assert.equal(parseHandleMap("not json").error, "slackHandleMap is not valid JSON");
  assert.equal(parseHandleMap("[1]").error, "slackHandleMap is not a JSON object");
  assert.deepEqual(parseHandleMap('{"rev-a":"alpha","x":3}').map, { "rev-a": "alpha" });
  assert.deepEqual(channelOf("#team-reviews"), { url: "https://slack.com/app_redirect?channel=team-reviews", name: "#team-reviews" });
  assert.deepEqual(channelOf("https://example.invalid/archives/C0000000"), { url: "https://example.invalid/archives/C0000000", name: "the review channel" });
  assert.equal(channelOf(""), null);
  assert.equal(channelOf("javascript:alert(1)"), null);
  assert.equal(channelOf("http://insecure.invalid"), null, "only https links are opened");
});

// ---------------------------------------------------------------- how often GitHub is read

test("a failed read never retries at once: the next one waits the poll interval like a good one", () => {
  const min = 60_000;
  assert.equal(dueToFetch({ hasSnapshot: false, lastAttempt: null, now: 0, pollMs: 5 * min }), true, "the first look reads");
  assert.equal(dueToFetch({ hasSnapshot: false, lastAttempt: 0, now: 1_000, pollMs: 5 * min }), false, "failed, no snapshot: no retry loop");
  assert.equal(dueToFetch({ hasSnapshot: true, lastAttempt: 0, now: 4 * min, pollMs: 5 * min }), false, "never faster than the board's PR checks");
  assert.equal(dueToFetch({ hasSnapshot: true, lastAttempt: 0, now: 5 * min, pollMs: 5 * min }), true);
  assert.equal(dueToFetch({ hasSnapshot: true, lastAttempt: 0, now: 999 * min, pollMs: 0 }), false, "polling off: the snapshot stays");
  assert.equal(dueToFetch({ hasSnapshot: false, lastAttempt: 0, now: 1_000, pollMs: 0 }), false, "polling off, failed first read: no loop");
  assert.equal(dueToFetch({ hasSnapshot: false, lastAttempt: 0, now: 5 * min, pollMs: 0 }), true, "then one retry after five minutes");
});

// ---------------------------------------------------------------- rev 2: the Slack preview, links and chips

const slackPrs = () => [
  promptPr(7, "Spins it; see https://github.com/acme-co/widgets/issues/3: the old spin. Thanks @nobody.", [cand("rev-a", "@alpha.slack"), cand("rev-b")], "feat(api): spin the widget [ABC-1]"),
  promptPr(8, "Stops it.", [cand("acme-co/team")]),
];

test("the Slack preview is the copied text: its tokens join back to the exact string, and the HTML holds the same PRs and handles", () => {
  // The owner checks the preview, then pastes the copy under their own name: any gap between them is a surprise in a team channel.
  const text = buildPrompt(slackPrs());
  const lines = slackLines(text);
  assert.equal(slackText(lines), text, "the preview draws every character the copy holds, and nothing else");
  const toks = lines.flatMap((l) => l.toks);
  const of = (k: string) => toks.filter((t) => t.kind === k).map((t) => t.show);
  assert.deepEqual(of("link"), ["https://github.com/acme-co/widgets/pull/7", "https://github.com/acme-co/widgets/issues/3", "https://github.com/acme-co/widgets/pull/8"], "each PR URL is a link; a trailing ':' is not part of it");
  assert.deepEqual(of("bold"), ["feat(api): spin the widget [ABC-1]", "Widget change 8"], "each title is bold, without its * markers");
  assert.deepEqual(of("mention"), ["@alpha.slack"], "only the mapped handle on the reviewers line is a mention; rev-b and a summary's @ stay plain");
  assert.equal(lines.filter((l) => l.bullet).length, 2, "one bullet per PR");
  const html = slackHtml(lines);
  const htmlText = html.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  assert.equal(htmlText, text.replace(/\*(feat\(api\): spin the widget \[ABC-1\]|Widget change 8)\*/g, "$1"), "the HTML says the same words, bold as <b> instead of *");
  for (const u of of("link")) assert.ok(html.includes(`<a href="${u}">${u}</a>`), `${u} is a link whose words are the URL itself`);
  assert.match(html, /<b>feat\(api\): spin the widget \[ABC-1\]<\/b>/);
  const cutAfterRef = slackLines(`• the same fix as ${"https://github.com/acme-co/widgets/issues/5"}…`)[0]!.toks.find((t) => t.kind === "link");
  assert.equal(cutAfterRef?.raw, "https://github.com/acme-co/widgets/issues/5", "a summary cut right after a reference keeps its … out of the link");
});

test("the preview component takes only the copied string, so it cannot show anything the copy doesn't hold", () => {
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  assert.match(src, /function SlackMessage\(\{ text, name, \.\.\.p \}: \{ text: string; name: string;/);
  assert.match(src, /slackLines\(text\)\.map/, "it draws through core's formatter");
  assert.match(src, /const html = slackHtml\(slackLines\(text\)\)/, "the clipboard's HTML comes from the same tokens");
  // 2026-11-18: the review ask and Post are one preview now, in Post's dialog: what it draws is what Copy and Post take
  assert.match(src, /<SlackMessage text=\{text\}[^>]*data-post-text/, "the preview is the copied string drawn");
  assert.doesNotMatch(src, /data-ask-text/, "no second ask on the page that could drift from Post's text");
});

test("every row carries a visible repo#n PR link that opens through bb, never a bare #number", () => {
  // Without it the owner can't jump to a PR from the row they're looking at; a bare #n means nothing in a team channel.
  assert.equal(prRef({ repo: "acme-co/widgets", number: 8540 }), "widgets#8540");
  assert.doesNotMatch(prRef({ repo: "acme-co/widgets", number: 1 }), BARE_REF);
  const src = readFileSync(new URL("../app/open-prs.tsx", import.meta.url), "utf8");
  // 2026-11-17: each PR is a folding card now (PrCard); its link sits in the header, so it shows while the card is folded
  const row = src.slice(src.indexOf("function PrCard("), src.indexOf("<CollapsibleContent", src.indexOf("function PrCard(")));
  assert.ok(row.length > 200, "the card's header is found");
  // 2026-11-17: the link's classes are Tailwind's now (shadcn pass), so the check reads the link, not its class name
  assert.match(row, /<ProofLink open=\{\{ url: pr\.url \}\}[^>]*data-pr-link=\{pr\.url\}[^>]*>\s*\{prRef\(pr\)\}\s*<\/ProofLink>/, "the folded header renders the link unconditionally");
  assert.doesNotMatch(row, /\?\s*<ProofLink[^>]*data-pr-link/, "and not behind a condition");
  // 2026-11-18: a wide pane draws table rows (PrRow); the link is in the row itself, not behind its expand
  const wide = src.slice(src.indexOf("function PrRow("), src.indexOf("{open ? (", src.indexOf("function PrRow(")));
  assert.ok(wide.length > 200, "the row is found");
  assert.match(wide, /<ProofLink open=\{\{ url: pr\.url \}\}[^>]*data-pr-link=\{pr\.url\}[^>]*>\s*\{prRef\(pr\)\}\s*<\/ProofLink>/, "the folded row renders the link unconditionally");
  assert.doesNotMatch(wide, /\?\s*<ProofLink[^>]*data-pr-link/, "and not behind a condition");
});

test("chip colours follow the state: green good, amber act, red broken, grey running, neutral waiting, muted draft", () => {
  const base = { draft: false, review: "review required", approved: false, approvals: "0 of 2 approvals", ci: "pass" as "pass" | "pending" | "fail" | "none", merge: "blocked by rules" };
  const tone = (pr: Partial<typeof base>, key: string) => prChips({ ...base, ...pr }).find((c) => c.key === key)?.tone;
  assert.equal(tone({ review: "approved", approved: true }, "review"), "ok");
  assert.equal(tone({ review: "changes requested" }, "review"), "warn");
  assert.equal(tone({ review: "review required" }, "review"), "neutral");
  assert.equal(tone({ review: "no review yet" }, "review"), "neutral");
  assert.equal(tone({ ci: "pass" }, "ci"), "ok");
  assert.equal(tone({ ci: "pending" }, "ci"), "pending");
  assert.equal(tone({ ci: "fail" }, "ci"), "fail");
  assert.equal(tone({ merge: "blocked by rules" }, "merge"), "neutral", "blocked by rules is the normal state of an unapproved PR, not an alarm");
  assert.equal(tone({ draft: true }, "draft"), "muted");
  assert.equal(tone({}, "draft"), undefined, "a ready PR has no draft chip");
  // the tones are the colours they claim: green, amber, red
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  const hue = (h: string) => {
    const [r, g, b] = rgb(h);
    return g! > r! && g! > b! ? "green" : r! > b! && g! > b! && r! >= g! ? "amber" : r! > g! && r! > b! ? "red" : "other";
  };
  for (const th of ["light", "dark"] as const) {
    assert.equal(hue(PR_CHIP_TONES.ok[th]), "green", th);
    assert.equal(hue(PR_CHIP_TONES.warn[th]), "amber", th);
    assert.equal(hue(PR_CHIP_TONES.fail[th]), "red", th);
    for (const k of ["pending", "neutral", "muted"] as const) {
      const c = rgb(PR_CHIP_TONES[k][th]);
      assert.ok(Math.max(...c) - Math.min(...c) < 48, `${k} ${th} is a grey, not a signal colour`);
    }
  }
});

test("the wide table's sort: ascending puts what needs a hand first, and ties keep the newest on top", async () => {
  const { sortPrs } = await import("../core/open-prs.ts");
  const pr = (url: string, x: Partial<{ approved: boolean; review: string; ci: "pass" | "pending" | "fail" | "none"; project: string | null; updatedAt: string }>) => ({ url, approved: false, review: "review required", ci: "pass" as const, project: "alpha", updatedAt: "2026-11-17T10:00:00Z", ...x });
  const prs = [pr("a", { ci: "pass", updatedAt: "2026-11-17T09:00:00Z" }), pr("b", { ci: "fail" }), pr("c", { ci: "pending", review: "changes requested", project: null }), pr("d", { approved: true, review: "approved", updatedAt: "2026-11-17T11:00:00Z" })];
  assert.deepEqual(sortPrs(prs, "ci", false).map((p) => p.url), ["b", "c", "d", "a"]); // failing CI first; d and a both pass, d newer
  assert.deepEqual(sortPrs(prs, "review", false).map((p) => p.url)[0], "c"); // changes requested first
  assert.deepEqual(sortPrs(prs, "review", false).map((p) => p.url).at(-1), "d"); // approved last
  assert.deepEqual(sortPrs(prs, "updated", true).map((p) => p.url), ["d", "b", "c", "a"]);
  assert.equal(sortPrs(prs, "project", false).at(-1)!.url, "c"); // no project sorts last
});

// ---------------------------------------------------------------- fast first paint: the kept snapshot (2026-11-17)

test("a kept snapshot is used only for the same login and version, and a malformed one is no snapshot", async () => {
  // A wrong snapshot shown at once is worse than a skeleton: another login's PRs, or a shape the page can't draw.
  const { parseKept, KEPT_VERSION } = await import("../core/open-prs.ts");
  const kp = { url: "https://github.com/acme-co/widgets/pull/1", number: 1, title: "t", repo: "acme-co/widgets", updatedAt: "2026-11-17T10:00:00Z", draft: false, reviewDecision: null, mergeable: null, mergeState: null, checks: null, approvedBy: [], required: null, summary: "s", agent: null, cands: [] };
  const good = { v: KEPT_VERSION, login: "dev-one", at: 1000, more: false, prs: [kp] };
  assert.equal(parseKept(good, "dev-one")?.prs.length, 1);
  assert.equal(parseKept(good, "dev-two"), null, "another login's PRs are never shown");
  assert.equal(parseKept({ ...good, v: 0 }, "dev-one"), null, "an older shape is dropped, not misread");
  assert.equal(parseKept({ ...good, prs: [{ ...kp, url: "javascript:alert(1)" }] }, "dev-one"), null, "a link that isn't a PR URL is never served");
  assert.equal(parseKept(undefined, "dev-one"), null);
  assert.equal(parseKept("junk", "dev-one"), null);
});

test("kept reviewers get their @handle from the current map, so a map edited after the read still applies", async () => {
  const { keptCands, sayCands } = await import("../core/open-prs.ts");
  const kept = keptCands([{ name: "rev-a", say: "rev-a", owner: true, recent: 1 }]);
  assert.equal("say" in kept[0]!, false, "the handle isn't kept");
  assert.equal(sayCands(kept, { "rev-a": "alpha" })[0]!.say, "@alpha");
  assert.equal(sayCands(kept, {})[0]!.say, "rev-a", "unmapped: the plain name");
});

/** registerOpenPrs on a fake bb: kv in memory, one connected machine whose gh read waits until `release` is called. */
async function openPrsServer(kv: Map<string, unknown>, opts: { login?: string } = {}) {
  const { registerOpenPrs } = await import("../open-prs/server.ts");
  const handlers: Record<string, (i: unknown) => Promise<any>> = {};
  const routes: Record<string, (c: any) => Promise<Response>> = {};
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const calls: string[] = [];
  const raw = { url: "https://github.com/acme-co/widgets/pull/2", number: 2, title: "Fresh one", body: "", repo: "acme-co/widgets", draft: false, updatedAt: "2026-11-17T11:00:00Z", branch: "b", sha: "s2", reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE", mergeState: "BLOCKED", checks: "SUCCESS", approvedBy: [], required: 2 };
  const bb: any = {
    hosts: { experimental_client: () => ({ call: async (m: string) => (calls.push(m), m === "prs.open" ? (await gate, { prs: [raw], more: false }) : m === "prs.files" ? { sha: "s2", files: [] } : { codeowners: null, recent: [] }) }) },
    sdk: { hosts: { list: async () => [{ id: "h1", type: "persistent", lifecycle: { phase: "active" }, status: "connected" }] }, threads: { get: async () => null } },
    storage: { kv: { get: async (k: string) => kv.get(k), set: async (k: string, v: unknown) => void kv.set(k, JSON.parse(JSON.stringify(v))) } },
    rpc: { register: (_c: unknown, h: any) => Object.assign(handlers, h) },
    http: { route: (_m: string, path: string, h: any) => (routes[path] = h) },
    realtime: { publish: () => {} },
    log: { warn: () => {}, info: () => {} },
  };
  const engine: any = { agents: () => [], prByUrl: () => null, agentByThreadEver: () => null };
  const settings = { githubLogin: opts.login ?? "dev-one", reviewChannel: "", reviewExcludedProjects: "", slackHandleMap: "", prPollMinutes: 5 };
  const api = registerOpenPrs(bb, engine, () => settings);
  return { read: () => handlers.openPrs!(null), release, calls, settings, api, routes };
}

test("after a restart the read answers at once from the kept snapshot, marked with its time, while GitHub is read", async () => {
  // The owner waited 18-21 s on an empty tab after each install: the page must never wait on gh when a snapshot exists.
  const { KEPT_VERSION } = await import("../core/open-prs.ts");
  const kept = { v: KEPT_VERSION, login: "dev-one", at: 1_000, more: false, prs: [{ url: "https://github.com/acme-co/widgets/pull/1", number: 1, title: "Kept one", repo: "acme-co/widgets", updatedAt: "2026-11-17T10:00:00Z", draft: false, reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE", mergeState: "BLOCKED", checks: "SUCCESS", approvedBy: [], required: 2, summary: "s", agent: null, cands: [{ name: "rev-a", owner: true, recent: 0 }] }] };
  const kv = new Map<string, unknown>([["openPrs.snapshot.v1", kept]]);
  const s = await openPrsServer(kv);
  s.settings.slackHandleMap = '{"rev-a":"alpha"}';
  const v = await s.read(); // gh's read is held open: this must still answer
  assert.equal(v.state, "ok");
  assert.equal(v.fetchedAt, 1_000, "marked with when it was checked");
  assert.equal(v.checking, true, "and says a check runs");
  assert.deepEqual(v.prs.map((p: any) => p.title), ["Kept one"]);
  assert.equal(v.prs[0].candidates[0].say, "@alpha", "kept reviewers tagged from the current map");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(s.calls, ["prs.open"], "the GitHub read started in the background");
  s.release();
  await new Promise((r) => setTimeout(r, 20));
  const after = await s.read();
  assert.deepEqual(after.prs.map((p: any) => p.title), ["Fresh one"], "the new read replaces it when it lands");
  assert.equal(after.checking, false);
  assert.ok(after.fetchedAt > 1_000);
  assert.deepEqual((kv.get("openPrs.snapshot.v1") as any).prs.map((p: any) => p.title), ["Fresh one"], "and is kept for the next restart");
  assert.equal("body" in (kv.get("openPrs.snapshot.v1") as any).prs[0], false, "PR bodies are not kept");
});

test("with no snapshot ever, the read says loading (the page's skeleton) and doesn't wait on GitHub either", async () => {
  const s = await openPrsServer(new Map());
  const v = await s.read();
  assert.equal(v.state, "loading");
  assert.equal(v.checking, true);
  s.release();
});

test("another login's kept snapshot is never served", async () => {
  const { KEPT_VERSION } = await import("../core/open-prs.ts");
  const s = await openPrsServer(new Map([["openPrs.snapshot.v1", { v: KEPT_VERSION, login: "dev-one", at: 1, more: false, prs: [] }]]), { login: "dev-two" });
  assert.equal((await s.read()).state, "loading");
  s.release();
});
