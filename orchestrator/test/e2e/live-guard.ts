// The e2e scripts' guard (2026-11-18): they click, answer and defer, so a run against the live app answers real
// decisions. The base URL is required, and the live app's port on this machine is refused unless the run also says
// --live. It runs before Playwright is loaded, so a refused run never opens a browser.

/** The live app's port (bb's own server on this machine). */
export const LIVE_PORT = "38886";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]);

/** Is this base URL the live app: a loopback name on its port? */
export function isLiveBase(base: string): boolean {
  const u = new URL(base);
  return u.port === LIVE_PORT && LOOPBACK.has(u.hostname.toLowerCase());
}

/** The base to use, or a throw: none given, not a URL, or the live app without --live. */
export function checkBase(base: string | undefined, live: boolean): string {
  if (!base) throw new Error("a base URL is required (your harness, e.g. --base http://127.0.0.1:<port>); there is no default");
  try {
    new URL(base);
  } catch {
    throw new Error(`not a URL: ${base}`);
  }
  if (isLiveBase(base) && !live) throw new Error(`${base} is the live app: it would answer real decisions. Use your harness, or pass --live on purpose`);
  return base.replace(/\/+$/, "");
}
