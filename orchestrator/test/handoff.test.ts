// orch_handoff's file check: the successor is told to read this file first, so it must really be the thread's own.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handoffFile } from "../server.ts";

// No /tmp: a scratch folder beside the tests (.scratch/ is git-ignored), removed afterwards.
const scratchRoot = join(import.meta.dirname, ".scratch");
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "handoff-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("a handoff file is resolved through symlinks, so a link in the worktree can't hand the successor a file outside it", () => {
  const root = join(scratch, "wt");
  mkdirSync(root);
  const real = realpathSync(root);
  writeFileSync(join(root, "handoff-2026-11-13.md"), "# handoff");
  writeFileSync(join(scratch, "elsewhere.md"), "not the thread's");
  symlinkSync(join(scratch, "elsewhere.md"), join(root, "handoff-link.md"));
  assert.equal(handoffFile(real, "handoff-2026-11-13.md"), join(real, "handoff-2026-11-13.md"));
  assert.throws(() => handoffFile(real, "handoff-link.md"), /resolves outside/);
  assert.throws(() => handoffFile(real, "../elsewhere.md"), /no handoff file/, "nor a plain path out of it");
  assert.throws(() => handoffFile(real, "missing.md"), /no handoff file/);
});
