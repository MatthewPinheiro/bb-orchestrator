// A worktree is archived only when nothing in it would be lost (core/clean.ts). What matters: uncommitted files and
// commits that exist only in the worktree refuse, with a reason the lead can act on; a branch in its base branch (also
// merged locally without a PR, as in a repo with no remote) or pushed to its remote is clean.
import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteBranchFor, worktreeVerdict, type WorkspaceRead } from "../core/clean.ts";

function ws(o: { files?: (string | { path: string; status: string })[]; ahead?: number; unmerged?: boolean; squashDone?: boolean; base?: string | null; branch?: string; state?: string; fileCount?: number }): WorkspaceRead {
  const files = o.files ?? [];
  const ahead = o.ahead ?? 0;
  return {
    outcome: "available",
    workspace: {
      workingTree: { hasUncommittedChanges: files.length > 0, state: o.state ?? (files.length ? "dirty" : "clean"), fileCount: o.fileCount ?? files.length, files: files.map((f) => (typeof f === "string" ? { path: f, status: "M" } : f)) },
      checkout: { kind: "branch", branchName: o.branch ?? "feat" },
      branch: { currentBranch: o.branch ?? "feat", defaultBranch: "main" },
      mergeBase:
        o.base === null
          ? null
          : {
              mergeBaseBranch: o.base ?? "main",
              aheadCount: ahead,
              hasCommittedUnmergedChanges: o.unmerged ?? ahead > 0,
              squashMergeCheckComplete: o.squashDone ?? true,
              commits: Array.from({ length: ahead }, (_, i) => ({ shortSha: `c${i}`, subject: `commit ${i}` })),
            },
    },
  };
}

test("uncommitted files refuse, naming them", () => {
  const v = worktreeVerdict(ws({ files: ["a.ts", "b.ts"] }), [], null);
  assert.deepEqual(v, { clean: false, why: "uncommitted changes in 2 file(s): a.ts, b.ts" });
  const many = worktreeVerdict(ws({ files: ["1", "2", "3", "4", "5", "6", "7"] }), [], null);
  assert.match(many.why, /\(\+2 more\)/);
});

test("untracked handoff-*.md and report.md at the root don't make a worktree dirty (they never go into a PR branch); anything else does", () => {
  const note = { path: "handoff-2026-11-14.md", status: "??" };
  const report = { path: "report.md", status: "??" };
  assert.deepEqual(worktreeVerdict(ws({ files: [note, report], state: "untracked" }), [], null), { clean: true, inBase: true, why: "its branch is in main" });
  assert.deepEqual(worktreeVerdict(ws({ files: [note, report, { path: "notes.txt", status: "??" }], state: "untracked" }), [], null), { clean: false, why: "uncommitted changes in 1 file(s): notes.txt" });
  assert.equal(worktreeVerdict(ws({ files: [{ path: "report.md", status: "M" }] }), [], null).clean, false, "a tracked report.md that changed is a real change");
  assert.equal(worktreeVerdict(ws({ files: [{ path: "handoff-2026-11-14.md", status: "M" }] }), [], null).clean, false, "a tracked, edited handoff file is a real change");
  assert.equal(worktreeVerdict(ws({ files: [{ path: "docs/handoff-x.md", status: "??" }] }), [], null).clean, false, "only at the worktree root");
  assert.equal(worktreeVerdict(ws({ files: [note], fileCount: 40, state: "untracked" }), [], null).clean, false, "bb truncated the list: the rest may be real changes");
  assert.match(worktreeVerdict(ws({ files: [note], state: "untracked", ahead: 1 }), [], null).why, /^1 commit\(s\) not in main/, "its commits are still judged");
});

test("a branch in its base branch is clean, also when squash-merged or merged locally with no remote", () => {
  assert.deepEqual(worktreeVerdict(ws({ ahead: 0 }), [], null), { clean: true, inBase: true, why: "its branch is in main" });
  // squash merge: the commits are ahead by sha, but their changes are all in main
  assert.equal(worktreeVerdict(ws({ ahead: 3, unmerged: false }), ["origin/main"], null).clean, true);
});

test("never a false clean: an unfinished squash check, or a working tree bb doesn't call clean, refuses", () => {
  assert.equal(worktreeVerdict(ws({ ahead: 3, unmerged: false, squashDone: false }), [], null).clean, false, "bb hasn't finished comparing the squash");
  assert.equal(worktreeVerdict(ws({ state: "conflicted" }), [], null).clean, false, "a state bb--git may add later");
  assert.equal(worktreeVerdict(ws({ state: "untracked" }), [], null).clean, false);
});

test("committed but unmerged work is judged by its commits, not called uncommitted (bb--git's committed_unmerged)", () => {
  assert.match(worktreeVerdict(ws({ ahead: 1, state: "committed_unmerged" }), [], null).why, /^1 commit\(s\) not in main and there is no remote/);
  assert.equal(worktreeVerdict(ws({ ahead: 1, state: "committed_unmerged" }), ["origin/feat"], ws({ ahead: 0, base: "origin/feat" })).clean, true);
});

test("commits only in the worktree refuse: no remote, not pushed, or the remote copy behind", () => {
  assert.deepEqual(worktreeVerdict(ws({ ahead: 2 }), [], null), { clean: false, why: "2 commit(s) not in main and there is no remote: c0 commit 0, c1 commit 1" });
  assert.match(worktreeVerdict(ws({ ahead: 1 }), ["origin/main"], null).why, /feat isn't pushed/);
  assert.match(worktreeVerdict(ws({ ahead: 1 }), ["origin/main", "origin/feat"], ws({ ahead: 1, base: "origin/feat" })).why, /origin\/feat is behind/);
});

test("a branch pushed to its remote is clean, though not merged", () => {
  const v = worktreeVerdict(ws({ ahead: 2 }), ["origin/feat"], ws({ ahead: 0, base: "origin/feat" }));
  assert.deepEqual(v, { clean: true, inBase: false, why: "its branch is pushed (origin/feat)" });
});

test("an unreadable status or no base branch refuses instead of guessing", () => {
  assert.match(worktreeVerdict({ outcome: "unavailable", reason: "not_a_repo", message: "not a git repository" }, [], null).why, /unavailable \(not a git repository\)/);
  assert.match(worktreeVerdict(ws({ base: null }), [], null).why, /can't be compared/);
});

test("the remote copy is origin's, else the only remote's", () => {
  assert.equal(remoteBranchFor("feat", ["upstream/feat", "origin/feat"]), "origin/feat");
  assert.equal(remoteBranchFor("feat", ["upstream/feat"]), "upstream/feat");
  assert.equal(remoteBranchFor("feat", ["a/feat", "b/feat"]), null, "two candidates: no guess");
  assert.equal(remoteBranchFor(null, ["origin/feat"]), null);
});
