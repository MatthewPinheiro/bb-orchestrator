// How the core runs a CLI: a fixed argv, no shell, a timeout, and an environment the caller chose. Tests pass their
// own Run; the CLI and the host entry use nodeRun.
import { execFile } from "node:child_process";

/** A command's answer. code null: it could not start, timed out or ended on a signal, and `why` says which. */
export type Reply = { code: number | null; stdout: string; stderr: string; why?: string };
export type Run = (cmd: string, args: string[], opts?: { timeoutMs?: number }) => Promise<Reply>;

export const TIMEOUT_MS = 20_000;

export const nodeRun = (env: NodeJS.ProcessEnv): Run => (cmd, args, opts) =>
  new Promise<Reply>((resolve) => {
    const timeout = opts?.timeoutMs ?? TIMEOUT_MS;
    execFile(cmd, args, { env, timeout, maxBuffer: 4 << 20, shell: false, windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; signal?: string | null; code?: number | string }) | null;
      if (!e) return resolve({ code: 0, stdout, stderr });
      if (typeof e.code === "number") return resolve({ code: e.code, stdout, stderr });
      const why = e.code === "ENOENT" ? `${cmd} is not installed` : e.killed ? `timed out after ${timeout} ms` : e.signal ? `ended on ${e.signal}` : String(e.message);
      resolve({ code: null, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), why });
    });
  });
