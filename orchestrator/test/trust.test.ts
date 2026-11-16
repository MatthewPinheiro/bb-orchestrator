// The trust boundary between agents and the owner (docs/security-notes.md): what the plugin can check, it checks. These
// checks stop a browser page and an agent's honest mistakes; any local process can still forge headers or drop its
// thread id, which the notes say in plain words.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine, type DeliverResult } from "../core/engine.ts";
import { mayRead, privileged, writeOriginProblem } from "../server.ts";

const LOOPBACK = "http://127.0.0.1:38886";
const APP = "https://factory-owner.example.ts.net:8443";
const check = (origin: string | undefined, requestUrl: string, secFetchSite?: string) =>
  writeOriginProblem({ origin, secFetchSite, requestUrl: `${requestUrl}/api/v1/plugins/orchestrator/http/answer`, appUrls: [APP, LOOPBACK] });

test("The owner's clicks pass from every way they reach the app: loopback, bb's tunnel and the TLS app URL", () => {
  assert.equal(check(LOOPBACK, LOOPBACK, "same-origin"), null, "the local app");
  assert.equal(check("http://localhost:38886", "http://localhost:38886", "same-origin"), null, "localhost is its own origin");
  assert.equal(check(LOOPBACK, LOOPBACK, "same-origin"), null, "bb's tunnel rewrites Origin and Host to loopback");
  assert.equal(check(APP, "http://factory-owner.example.ts.net:8443", "same-origin"), null, "a TLS proxy that keeps Host: https Origin, http backend");
  assert.equal(check(APP, LOOPBACK, "same-origin"), null, "a TLS proxy that rewrites Host to loopback: BB_APP_URL vouches");
  assert.equal(check(LOOPBACK, LOOPBACK), null, "a browser that sends no Sec-Fetch-Site");
});

test("a write without the app's own Origin is refused: no Origin (curl), another site, or a cross-site fetch", () => {
  assert.match(check(undefined, LOOPBACK)!, /no Origin/);
  assert.match(check("https://evil.example", LOOPBACK)!, /isn't this app/);
  assert.match(check("http://127.0.0.1:5173", LOOPBACK)!, /isn't this app/, "another local port (an agent's dev server) isn't the app");
  assert.match(check("null", LOOPBACK)!, /bad Origin/, "a sandboxed frame");
  assert.match(check(LOOPBACK, LOOPBACK, "cross-site")!, /Sec-Fetch-Site cross-site/);
  assert.match(check(LOOPBACK, LOOPBACK, "same-site")!, /Sec-Fetch-Site same-site/);
});

function agents() {
  const e = new Engine(new DatabaseSync(":memory:") as never, {
    now: () => Date.parse("2026-11-13T10:00:00Z"),
    deliver: async (): Promise<DeliverResult> => ({ delivery: "sent" }),
    mirror: () => {},
    changed: () => {},
    log: () => {},
  });
  const opts = [{ label: "a" }, { label: "b" }];
  const cos = e.register("T-cos", "cos", null);
  const la = e.register("T-la", "lead", "alpha");
  const lb = e.register("T-lb", "lead", "beta");
  const w1 = e.register("T-w1", "thread", "alpha", "T-la");
  const w2 = e.register("T-w2", "thread", "alpha", "T-la");
  return { e, cos, la, lb, w1, w2, d: e.ask(w1, { title: "Q?", question: "Q?", options: opts }) };
}

test("`bb orchestrator decision` from an agent shows only its own decisions: a thread can't read its siblings' or another project's", () => {
  const s = agents();
  assert.equal(mayRead(s.w1, s.d), true, "the thread that asked");
  assert.equal(mayRead(s.la, s.d), true, "its lead");
  assert.equal(mayRead(s.cos, s.d), true, "the CoS, which triages");
  assert.equal(mayRead(s.w2, s.d), false, "a sibling thread");
  assert.equal(mayRead(s.lb, s.d), false, "another project's lead");
});

test("every command that changes roles, threads or projects is privileged (audited on the Board); reads are not", () => {
  for (const argv of [["role", "set"], ["spawn", "lead"], ["stop", "x"], ["start", "x"], ["compact-cos"], ["pr-check"], ["project", "a", "--hold"], ["dreams", "run-now"]])
    assert.equal(privileged(argv[0], argv.slice(1)), true, argv.join(" "));
  for (const argv of [["status"], ["inbox"], ["host"], ["decision", "d-1"], ["tick"], ["project", "a"], ["dreams", "status"], ["dreams", "run-now", "--dry-run"]])
    assert.equal(privileged(argv[0], argv.slice(1)), false, argv.join(" "));
});
