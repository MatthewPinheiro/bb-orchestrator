// Proof opens inside bb (2026-11-16, the owner: "make sure any links open it up as a pane within BB"). What matters: a
// click on any proof item (image, video, text, doc, PR, link) or a PR chip goes to bb's pane API first, so it opens beside
// the card instead of in an outside browser tab; only when bb declines does the anchor's own new-tab href run.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openInBb, plainClick } from "../app/open-proof.ts";
import { PROOF_KINDS } from "../core/model.ts";

function fakeNav(accept = { file: true, url: true }) {
  const calls: string[] = [];
  return {
    calls,
    nav: {
      openUrl: (url: string) => (calls.push(`url ${url}`), accept.url),
      experimental_openFilePreview: (o: { target: { kind: string; path: string } }) => (calls.push(`file ${o.target.kind}:${o.target.path}`), accept.file),
    } as never,
  };
}

const FILE = { hostId: "h1", path: "/state/proof/x", url: null };
const sample: Record<string, { hostId: string | null; path: string | null; url: string | null }> = {
  image: { ...FILE, path: "/state/proof/shot.png" },
  video: { ...FILE, path: "/state/proof/run.webm" },
  text: { ...FILE, path: "/state/proof/README.md" },
  doc: { ...FILE, path: "/state/proof/report.json" },
  pr: { hostId: null, path: null, url: "https://github.com/acme/app/pull/12" },
  link: { hostId: null, path: null, url: "https://claude.ai/artifact/abc" },
};

test("every proof kind opens through bb's pane API, never left to a plain external link", () => {
  for (const kind of PROOF_KINDS) {
    const p = sample[kind];
    assert.ok(p, `a new proof kind (${kind}) needs a way to open as a bb pane`);
    const { nav, calls } = fakeNav();
    assert.equal(openInBb(nav, p), true, `${kind} is taken by bb`);
    assert.deepEqual(calls, [p.path ? `file host:${p.path}` : `url ${p.url}`], `${kind} goes to ${p.path ? "the file preview pane" : "bb's link handling"}`);
  }
});

test("a file with a URL too opens its file in the preview pane; the URL only when the preview is declined", () => {
  const p = { hostId: "h1", path: "/state/proof/doc.md", url: "https://example.com/doc" };
  const yes = fakeNav();
  assert.equal(openInBb(yes.nav, p), true);
  assert.deepEqual(yes.calls, ["file host:/state/proof/doc.md"]);
  const no = fakeNav({ file: false, url: true });
  assert.equal(openInBb(no.nav, p), true);
  assert.deepEqual(no.calls, ["file host:/state/proof/doc.md", "url https://example.com/doc"]);
});

test("when bb takes nothing, the caller's new-tab fallback runs (false), and a non-http URL is never handed to bb", () => {
  assert.equal(openInBb(fakeNav({ file: false, url: false }).nav, sample.image), false);
  const js = fakeNav();
  assert.equal(openInBb(js.nav, { url: "javascript:alert(1)" }), false);
  assert.deepEqual(js.calls, []);
});

test("only a plain left click is taken over; cmd/ctrl/middle clicks keep the browser's own new tab", () => {
  const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(plainClick(base), true);
  assert.equal(plainClick({ ...base, metaKey: true }), false);
  assert.equal(plainClick({ ...base, button: 1 }), false);
});

test("proof, outputs (folded or under Files), verdict tiles, project-page PR chips and Open PRs rows render no plain target=_blank anchor that skips bb's panes", () => {
  for (const f of ["app/deliverables.tsx", "app/past-view.tsx", "app/files.tsx", "app/visual-blocks.tsx", "app/project-detail.tsx", "app/open-prs.tsx"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /<a\b[^>]*target="_blank"/, `${f} has a raw new-tab link; use ProofLink so it opens as a bb pane`);
  }
  assert.match(readFileSync(new URL("../app/proof-link.tsx", import.meta.url), "utf8"), /openInBb\(nav, open\)\) e\.preventDefault\(\)/, "ProofLink opens in bb first");
});

test("a thread or one of the plugin's own views opens in bb; without those navigators the old callers behave as before", () => {
  const calls: string[] = [];
  const nav = { openUrl: () => false, experimental_openFilePreview: () => false, toThread: (id: string) => void calls.push(`thread ${id}`), toPluginPanel: (p: string, o: { subPath: string }) => void calls.push(`panel ${p}/${o.subPath}`) } as never;
  assert.equal(openInBb(nav, { threadId: "T1" }), true);
  assert.equal(openInBb(nav, { panel: { subPath: "needs-you" } }), true);
  assert.deepEqual(calls, ["thread T1", "panel home/needs-you"]);
  const { nav: old } = fakeNav();
  assert.equal(openInBb(old, { threadId: "T1" }), false, "a navigator without toThread declines, and the caller's fallback runs");
});
