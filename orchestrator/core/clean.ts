// Whether a thread's worktree is safe to archive, from bb's git plugin (bb--git workspaceStatus and branches). Clean
// means nothing would be lost: no uncommitted files, and every commit of its branch is in its base branch (merged,
// also by squash or a local merge without a PR) or on the remote (pushed). Requested 2026-11-14: resolve archives a
// clean thread and refuses a dirty one with the reason. No bb or zod import, so node --test checks it.

/** What bb--git workspaceStatus returns, as far as this reads it. */
export type WorkspaceRead =
  | {
      outcome: "available";
      workspace: {
        workingTree: { hasUncommittedChanges: boolean; state?: string; fileCount: number; files: { path: string; status?: string }[] };
        checkout: { kind: string; branchName?: string | null };
        branch: { currentBranch: string | null; defaultBranch: string };
        mergeBase: {
          mergeBaseBranch: string;
          aheadCount: number;
          hasCommittedUnmergedChanges: boolean;
          squashMergeCheckComplete?: boolean;
          commits: { shortSha: string; subject: string }[];
        } | null;
      };
    }
  | { outcome: string; reason?: string; message?: string; failure?: { message?: string } };

export type Verdict = { clean: true; inBase: boolean; why: string } | { clean: false; why: string };

const available = (r: WorkspaceRead | null): r is Extract<WorkspaceRead, { outcome: "available" }> => r?.outcome === "available";
const unavailable = (r: WorkspaceRead) => {
  const x = r as { reason?: string; message?: string; failure?: { message?: string } };
  return x.message || x.failure?.message || x.reason || r.outcome;
};
// bb--git's working-tree states; committed_unmerged has nothing uncommitted (its commits are judged below). A state
// this doesn't know refuses: a false clean would lose work.
const COMMITTED = new Set(["clean", "committed_unmerged"]);
/**
 * Untracked notes the orchestrator's process leaves at the worktree root: handoff-<UTC date>.md for a successor and
 * report.md. They never go into a PR branch, so they never get committed; they don't make a worktree dirty (or every
 * handed-off thread would stay dirty for good), and archiving keeps a copy (lead, 2026-11-14). Any other untracked or
 * changed file counts.
 */
export const EXEMPT_NOTE = /^(handoff-[^/]*\.md|report\.md)$/;
const exemptNote = (f: { path: string; status?: string }) => f.status === "??" && EXEMPT_NOTE.test(f.path);
const list = (items: string[], max = 5) => items.slice(0, max).join(", ") + (items.length > max ? ` (+${items.length - max} more)` : "");

/** The remote copy of `branch`: origin's, else the only remote's. */
export function remoteBranchFor(branch: string | null, remoteBranches: string[]): string | null {
  if (!branch) return null;
  if (remoteBranches.includes(`origin/${branch}`)) return `origin/${branch}`;
  const others = remoteBranches.filter((r) => r.endsWith(`/${branch}`));
  return others.length === 1 ? others[0]! : null;
}

/**
 * The remote copy of the base branch `base` was compared with, to compare with instead; null when there is none (a repo
 * with no remote, like a local-only repo, keeps its local base) or it already is a remote branch. A local base branch can be far
 * behind: worktrees of one repo share its .git, so its local dev is whatever an old checkout left (a large monorepo: thousands of
 * commits behind origin/dev, 2026-11-15), and every branch read as thousands of commits "not in dev".
 */
export function remoteBase(base: WorkspaceRead, remoteBranches: string[]): string | null {
  const name = baseBranchOf(base);
  return !name || remoteBranches.includes(name) ? null : remoteBranchFor(name, remoteBranches);
}

/** The base branch a reading compared with (else the repo's default branch), or null when it couldn't be read. */
export function baseBranchOf(base: WorkspaceRead): string | null {
  return available(base) ? (base.workspace.mergeBase?.mergeBaseBranch ?? base.workspace.branch.defaultBranch) : null;
}

/**
 * The verdict for one worktree. `base` is workspaceStatus against the base branch; `pushed` is workspaceStatus against
 * the branch's remote copy (null when it has none); `remoteBranches` is every remote branch bb lists (none: no remote).
 */
export function worktreeVerdict(base: WorkspaceRead, remoteBranches: string[], pushed: WorkspaceRead | null): Verdict {
  if (!available(base)) return { clean: false, why: `its git status is unavailable (${unavailable(base)})` };
  const w = base.workspace;
  if (w.workingTree.hasUncommittedChanges || (w.workingTree.state !== undefined && !COMMITTED.has(w.workingTree.state))) {
    const counted = w.workingTree.files.filter((f) => !exemptNote(f));
    // only when bb listed every file: a truncated list may hide a real change
    const onlyNotes = counted.length === 0 && w.workingTree.files.length > 0 && w.workingTree.fileCount === w.workingTree.files.length;
    if (!onlyNotes) {
      const n = w.workingTree.fileCount - (w.workingTree.files.length - counted.length);
      return { clean: false, why: `uncommitted changes in ${n} file(s): ${list(counted.map((f) => f.path))}` };
    }
  }
  const mb = w.mergeBase;
  if (!mb) return { clean: false, why: "its branch can't be compared with a base branch" };
  // ahead by sha but squash-merged counts only once bb finished that check: a false clean would lose work
  if (mb.aheadCount === 0 || (!mb.hasCommittedUnmergedChanges && mb.squashMergeCheckComplete === true)) {
    return { clean: true, inBase: true, why: `its branch is in ${mb.mergeBaseBranch}` };
  }
  const branch = w.checkout.kind === "branch" ? (w.checkout.branchName ?? w.branch.currentBranch) : null;
  const remote = remoteBranchFor(branch, remoteBranches);
  if (remote && available(pushed) && pushed.workspace.mergeBase && pushed.workspace.mergeBase.aheadCount === 0) {
    return { clean: true, inBase: false, why: `its branch is pushed (${remote})` };
  }
  const commits = list(mb.commits.map((c) => `${c.shortSha} ${c.subject}`), 3);
  const where = remoteBranches.length === 0 ? "there is no remote" : remote ? `${remote} is behind` : `${branch ?? "the detached HEAD"} isn't pushed`;
  return { clean: false, why: `${mb.aheadCount} commit(s) not in ${mb.mergeBaseBranch} and ${where}: ${commits}` };
}
