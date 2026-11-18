// Voice mode's guards: off means no routes at all; the socket needs the page's own origin; the Google credential never
// reaches a response, a page event or a log line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerVoice } from "../voice/server.ts";
import { VOICE_SETTINGS } from "../voice/settings.ts";
import { writeOriginProblem } from "../server.ts";
import type { LiveSocket } from "../voice/gemini.ts";
import type { Engine } from "../core/engine.ts";
import * as keys from "../voice/app/keys.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const KEY = JSON.stringify({ type: "service_account", client_email: "voice@service-account.example", private_key: PEM, token_uri: "https://oauth2.example.test/token" });
const APP = "http://127.0.0.1:41234";

const engine = {
  agents: () => [],
  projects: () => [],
  leadStatus: () => null,
  watchList: () => [],
  deliverables: () => [],
  needsYou: () => ({ cards: [], deferred: [], triaging: [], held: [] }),
  decision: () => null,
  decisions: () => [],
  directHistory: () => ({ messages: [], more: false }),
  liveAt: () => null,
} as unknown as Engine;

type Handler = (ctx: { request: Request; url: URL; headers: Headers }) => {
  onOpen?(s: FakePage): void | Promise<void>;
  onMessage?(s: FakePage, d: string | Uint8Array): void;
  onClose?(s: FakePage, e: { code: number; reason: string }): void;
};
class FakePage {
  readyState = 1;
  sent: (string | Uint8Array)[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(d: string | Uint8Array) {
    this.sent.push(d);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
}

function fakeBb(values: Record<string, unknown>) {
  const logs: string[] = [];
  const routes: { path: string; handler: Handler; auth?: string }[] = [];
  const rpcs: Record<string, (input: unknown) => Promise<unknown>> = {};
  const changes: ((n: Record<string, unknown>) => void)[] = [];
  const bb = {
    settings: {
      define: (d: Record<string, { default?: unknown }>) => {
        const all = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k in values ? values[k] : v.default]));
        return { get: async () => all, onChange: (fn: (n: Record<string, unknown>) => void) => changes.push((n) => fn({ ...all, ...n })) };
      },
    },
    http: { experimental_websocket: (path: string, handler: Handler, opts?: { auth?: string }) => routes.push({ path, handler, auth: opts?.auth }), route: () => assert.fail("voice registers no plain HTTP route") },
    rpc: { register: (_c: unknown, h: Record<string, (i: unknown) => Promise<unknown>>) => Object.assign(rpcs, h) },
    events: { on: () => {} },
    onDispose: () => {},
    log: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) },
  };
  return { bb: bb as never, logs, routes, rpcs, change: (n: Record<string, unknown>) => changes.forEach((f) => f(n)) };
}

const deps = (extra: Record<string, unknown> = {}) => ({
  engine,
  ownerName: () => "Sam",
  originProblem: (h: { origin: string | undefined; secFetchSite: string | undefined; requestUrl: string }) => writeOriginProblem({ ...h, appUrls: [APP] }),
  socket: () => ({ send() {}, close() {}, onopen: null, onmessage: null, onclose: null, onerror: null }) as LiveSocket,
  ...extra,
});

function ctx(headers: Record<string, string>) {
  const url = new URL(`${APP}/api/v1/plugins/orchestrator/http/voice/socket?zone=UTC`);
  return { request: new Request(url, { headers }), url, headers: new Headers(headers) };
}

// Bring your own key: each person's own Gemini API key is all voice needs, and it is theirs alone. Built at run time so
// the source holds no key-shaped string.
const OWN_KEY = "AIza" + "Sy" + "OwnKeyForVoiceTestsOnly".padEnd(33, "x");
const SAME = { origin: APP, "sec-fetch-site": "same-origin" };

class FakeLive implements LiveSocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number, reason: string) => void) | null = null;
  onerror: ((message: string) => void) | null = null;
  readonly url: string;
  readonly headers: Record<string, string>;
  constructor(url: string, headers: Record<string, string>) {
    this.url = url;
    this.headers = headers;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
}
const noToken = (async () => assert.fail("the API-key path never asks Google for a token")) as unknown as typeof fetch;
function withLives() {
  const lives: FakeLive[] = [];
  return { lives, socket: (u: string, h: Record<string, string>) => (lives.push(new FakeLive(u, h)), lives[lives.length - 1]!) };
}

test("off by default: no socket route and no read exist", async () => {
  const f = fakeBb({});
  const out = await registerVoice(f.bb, deps());
  assert.equal(out, null);
  assert.equal(f.routes.length, 0);
  assert.deepEqual(Object.keys(f.rpcs), []);
});

test("on: one socket, local auth only (never token or none)", async () => {
  const f = fakeBb({ voiceEnabled: true, voiceProject: "example-project" });
  await registerVoice(f.bb, deps({ auth: { setting: () => "", env: {}, home: "/nonexistent" } }));
  assert.equal(f.routes.length, 1);
  assert.equal(f.routes[0]!.path, "/voice/socket");
  assert.equal(f.routes[0]!.auth, "local");
});

test("a socket with no Origin, or from another site, is refused before anything starts", async () => {
  const f = fakeBb({ voiceEnabled: true, voiceProject: "example-project" });
  let opened = 0;
  await registerVoice(f.bb, deps({ socket: () => (opened++, { send() {}, close() {}, onopen: null, onmessage: null, onclose: null, onerror: null }) }));
  const cases: Record<string, string>[] = [{}, { origin: "https://evil.example" }, { origin: APP, "sec-fetch-site": "cross-site" }];
  for (const h of cases) {
    const page = new FakePage();
    await f.routes[0]!.handler(ctx(h)).onOpen?.(page);
    assert.equal(page.closed?.code, 1008, JSON.stringify(h));
    assert.match(String(page.sent[0]), /Refused/);
  }
  assert.equal(opened, 0, "no provider connection was opened");
});

test("voice switched off at runtime refuses new calls", async () => {
  const f = fakeBb({ voiceEnabled: true, voiceProject: "example-project" });
  await registerVoice(f.bb, deps());
  f.change({ voiceEnabled: false });
  const page = new FakePage();
  await f.routes[0]!.handler(ctx({ origin: APP, "sec-fetch-site": "same-origin" })).onOpen?.(page);
  assert.equal(page.closed?.code, 1008);
  assert.match(String(page.sent[0]), /voice is off/);
});

// Voice on with no key must never fail silently or show a raw error: a new user sees, in the mic's popover, which setting
// to fill in and where it is, in a line or two.
test("voice on with no key: a setup prompt that names the setting and where it is, and no call is attempted", async () => {
  const f = fakeBb({ voiceEnabled: true });
  const { lives, socket } = withLives();
  await registerVoice(f.bb, deps({ auth: { setting: () => "", env: {}, home: "/nonexistent", fetch: noToken }, socket }));
  const st = (await f.rpcs.voiceStatus!(null)) as { ready: boolean; problem: string; credential: string };
  assert.equal(st.ready, false);
  assert.equal(st.credential, "none");
  assert.match(st.problem, /your own Gemini API key/);
  assert.match(st.problem, /"Voice: Gemini API key"/, "the setting, by the name the settings page shows");
  assert.match(st.problem, /the Orchestrator's plugin settings/, "and where to find it");
  assert.ok(st.problem.length <= 100, `short enough for two lines of the 360px popover (${st.problem.length} characters)`);
  assert.doesNotMatch(st.problem, /Error|undefined|HTTP \d|\bat .*\.ts|\{/, "not a raw error");
  // the mic opened anyway (Space held, or a stale page): the same prompt, and no provider connection
  const page = new FakePage();
  await f.routes[0]!.handler(ctx(SAME)).onOpen?.(page);
  assert.deepEqual(JSON.parse(String(page.sent[0])), { type: "status", state: "error", message: st.problem });
  assert.equal(lives.length, 0, "no call without a key");
});

test("Vertex AI with no login of your own on the bb host names both fixes", async () => {
  const g = fakeBb({ voiceEnabled: true, voiceProject: "example-project" });
  await registerVoice(g.bb, deps({ auth: { setting: () => "", env: {}, home: "/nonexistent" } }));
  const st = (await g.rpcs.voiceStatus!(null)) as { problem: string; credential: string };
  assert.match(st.problem, /gcloud auth application-default login/);
  assert.match(st.problem, /"Voice: service-account key"/);
  assert.equal(st.credential, "none");
});

test("a fixed key is tried at once: a settings change clears the last call's failure", async () => {
  const f = fakeBb({ voiceEnabled: true, voiceApiKey: "own-gemini-key-mistyped-0001" });
  const { lives, socket } = withLives();
  await registerVoice(f.bb, deps({ auth: { setting: () => "", env: {}, home: "/nonexistent", fetch: noToken }, socket }));
  await f.routes[0]!.handler(ctx(SAME)).onOpen?.(new FakePage());
  assert.equal(lives.length, 1, "the call with the mistyped key opened");
  lives[0]!.onopen?.();
  lives[0]!.onclose?.(1008, "API key not valid. Please pass a valid API key.");
  const before = (await f.rpcs.voiceStatus!(null)) as { ready: boolean; problem: string | null };
  assert.equal(before.ready, false, "the failure is shown");
  assert.match(String(before.problem), /didn't accept your key/);
  f.change({ voiceApiKey: OWN_KEY });
  const after = (await f.rpcs.voiceStatus!(null)) as { ready: boolean; problem: string | null };
  assert.equal(after.ready, true, "the new key isn't held back by the old failure");
  assert.equal(after.problem, null);
});

// The popover's rule in voice-mic.tsx, run over the status events a page really gets from the server.
function popover(sent: (string | Uint8Array)[]) {
  let open = true; // the click that starts a call opens it
  let failed = false;
  let problem: string | null = null;
  const states: string[] = [];
  for (const d of sent) {
    if (typeof d !== "string") continue;
    const e = JSON.parse(d) as { type: string; state?: string; message?: string | null };
    if (e.type !== "status" || !e.state) continue;
    states.push(e.state);
    if (e.message) problem = e.message;
    if (e.state === "error") failed = true;
    if (keys.closesOnStatus(e.state, failed)) open = false;
  }
  return { open, problem, states };
}

test("a refused key stays on screen: the popover keeps Google's refusal after that call ends, and a hang-up still closes it", async () => {
  // A mistyped key is the first thing a new user may hit: a refusal that flashes and closes leaves them guessing.
  assert.equal(typeof keys.closesOnStatus, "function", "the popover's close rule is closesOnStatus in voice/app/keys.ts");
  const f = fakeBb({ voiceEnabled: true, voiceApiKey: "own-gemini-key-mistyped-0001" });
  const { lives, socket } = withLives();
  await registerVoice(f.bb, deps({ auth: { setting: () => "", env: {}, home: "/nonexistent", fetch: noToken }, socket }));

  const refused = new FakePage();
  await f.routes[0]!.handler(ctx(SAME)).onOpen?.(refused);
  lives[0]!.onopen?.();
  lives[0]!.onclose?.(1008, "API key not valid. Please pass a valid API key.");
  const shown = popover(refused.sent);
  const err = shown.states.indexOf("error");
  assert.ok(err >= 0 && err < shown.states.lastIndexOf("ended"), `the server sends the refusal, then ends the call (${shown.states.join(", ")})`);
  assert.equal(shown.open, true, "the refusal stays on screen after the call ends");
  assert.match(String(shown.problem), /didn't accept your key: check "Voice: Gemini API key"/);

  // the key fixed, the next call goes live, and hanging up closes the popover as before
  f.change({ voiceApiKey: OWN_KEY });
  const page = new FakePage();
  const h = f.routes[0]!.handler(ctx(SAME));
  await h.onOpen?.(page);
  assert.equal(lives.length, 2, "the fixed key's call opened");
  lives[1]!.onopen?.();
  lives[1]!.onmessage?.(JSON.stringify({ setupComplete: {} }));
  h.onMessage?.(page, JSON.stringify({ type: "hangup" }));
  const hung = popover(page.sent);
  assert.ok(hung.states.includes("live") && hung.states.includes("ended"), `live, then ended (${hung.states.join(", ")})`);
  assert.equal(hung.open, false, "a hang-up closes the popover");
});

test("the credential never appears in a response, a page event or a log line, even when Google echoes it", async () => {
  const f = fakeBb({ voiceEnabled: true, voiceProject: "example-project", voiceCredential: KEY });
  const echo = (async (_u: string, init?: RequestInit) =>
    new Response(JSON.stringify({ error: "invalid_grant", error_description: `bad key ${PEM} for ${String(init?.body)}` }), { status: 400 })) as typeof fetch;
  await registerVoice(f.bb, deps({ auth: { setting: () => KEY, env: {}, home: "/nonexistent", fetch: echo } }));
  const st = (await f.rpcs.voiceStatus!(null)) as { problem: string; credential: string };
  assert.equal(st.credential, "setting");
  assert.match(st.problem, /Google refused the credential \(invalid_grant/);
  const page = new FakePage();
  await f.routes[0]!.handler(ctx({ origin: APP, "sec-fetch-site": "same-origin" })).onOpen?.(page);
  const everything = [JSON.stringify(st), ...page.sent.map(String), ...f.logs].join("\n");
  const body = PEM.split("\n")[1]!; // a line of the key itself
  assert.ok(!everything.includes(body), "no key material");
  assert.ok(!everything.includes("BEGIN PRIVATE KEY"), "no PEM header");
  assert.ok(!/assertion=[\w-]{20}/.test(everything), "no signed assertion");
});

test("your own Gemini API key is all voice needs: ready with no project or login, and the call goes to the Gemini API with it", async () => {
  const f = fakeBb({ voiceEnabled: true, voiceApiKey: `  ${OWN_KEY}\n` }); // pasted with stray whitespace
  const { lives, socket } = withLives();
  await registerVoice(f.bb, deps({ auth: { setting: () => "", env: {}, home: "/nonexistent", fetch: noToken }, socket }));
  const st = (await f.rpcs.voiceStatus!(null)) as { ready: boolean; problem: string | null; credential: string };
  assert.equal(st.ready, true, "no project and no Google login needed");
  assert.equal(st.problem, null);
  assert.equal(st.credential, "api-key", "the status says where the credential came from, never what it is");
  const page = new FakePage();
  const h = f.routes[0]!.handler(ctx(SAME));
  await h.onOpen?.(page);
  assert.equal(lives.length, 1, "the call opened");
  assert.match(lives[0]!.url, /^wss:\/\/generativelanguage\.googleapis\.com\//);
  assert.deepEqual(lives[0]!.headers, { "x-goog-api-key": OWN_KEY }, "the key, trimmed once, only in its header");
  h.onClose?.(page, { code: 1000, reason: "" });
});

for (const [kind, key] of [
  ["a key with the usual shape", OWN_KEY],
  ["a key of any other shape", "own-gemini-key-for-tests-0042"],
] as const)
  test(`your API key never reaches a log line, the status read or the page, even when Google echoes it (${kind})`, async () => {
    const everything: string[] = [];
    const call = async () => {
      const f = fakeBb({ voiceEnabled: true, voiceApiKey: key });
      const { lives, socket } = withLives();
      await registerVoice(f.bb, deps({ auth: { setting: () => "", env: {}, home: "/nonexistent", fetch: noToken }, socket }));
      const page = new FakePage();
      await f.routes[0]!.handler(ctx(SAME)).onOpen?.(page);
      assert.equal(lives.length, 1, "the call opened");
      lives[0]!.onopen?.();
      return { f, lives, page, collect: async () => everything.push(JSON.stringify(await f.rpcs.voiceStatus!(null)), ...page.sent.map(String), ...f.logs, ...lives.map((l) => l.url)) };
    };
    // 1: Google refuses the key and echoes it in the close reason, before the call is ready
    const one = await call();
    one.lives[0]!.onclose?.(1008, `API key not valid. Please pass a valid API key. (${key})`);
    assert.match(one.page.sent.map(String).join("\n"), /didn't accept your key: check \\"Voice: Gemini API key\\"/, "a status line a person can act on");
    await one.collect();
    // 2: ready, then dropped with the key in a URL in the reason; the quiet reconnect fails with more echoes
    const two = await call();
    two.lives[0]!.onmessage?.(JSON.stringify({ setupComplete: {} }));
    two.lives[0]!.onclose?.(1011, `Internal error while serving wss://generativelanguage.googleapis.com/ws/x?key=${key}`);
    await new Promise((r) => setImmediate(r));
    assert.equal(two.lives.length, 2, "one quiet reconnect");
    two.lives[1]!.onerror?.(`socket failed for ${key}`);
    two.lives[1]!.onclose?.(1011, `backend error, request carried ${key}`);
    assert.ok(two.page.sent.some((d) => String(d).includes('"state":"error"')), "the failure is still said");
    await two.collect();
    assert.ok(!everything.join("\n").includes(key), "the key is in no log line, status read, page event or URL");
  });

test("no default points at any account, and no setting or README text suggests someone else's key", () => {
  for (const k of ["voiceApiKey", "voiceCredential"] as const) {
    assert.ok(k in VOICE_SETTINGS, `a ${k} setting for the person's own credential`);
    assert.equal(VOICE_SETTINGS[k].secret, true, `${k} is a secret setting`);
    assert.ok(!("default" in VOICE_SETTINGS[k]), `${k} has no default`);
  }
  assert.equal(VOICE_SETTINGS.voiceProject.default, "", "no default project");
  const words = Object.values(VOICE_SETTINGS).map((v) => `${v.label}\n${v.description}`).join("\n");
  const readme = readFileSync(new URL("../voice/README.md", import.meta.url), "utf8");
  for (const [where, text] of [["the settings", words], ["voice/README.md", readme]] as const) {
    assert.doesNotMatch(text, /\b(?:team|shared|company|organi[sz]ation)\b/i, `${where} suggest no team or shared key`);
  }
  assert.ok(readme.indexOf("Gemini API key") < readme.indexOf("Vertex AI User"), "the README lists your own API key first");
});

// Voice uses only a credential the person set up. A cloud VM's own account (its metadata server) is one nobody chose: on
// a shared or company machine it is a shared account in effect, so voice never reaches for it.
for (const [setup, values, prompt] of [
  ["nothing set", {}, /Paste your own Gemini API key into "Voice: Gemini API key"/],
  ["only a Vertex AI project set", { voiceProject: "example-project" }, /gcloud auth application-default login.*"Voice: service-account key"/],
] as const)
  test(`no credential of your own means the setup prompt, even on a cloud VM that would hand out a token (${setup})`, async () => {
    const empty = mkdtempSync(join(tmpdir(), "voice-no-login-")); // an empty home, as voice-auth.test.ts uses
    const saved = { HOME: process.env.HOME, CLOUDSDK_CONFIG: process.env.CLOUDSDK_CONFIG, GAC: process.env.GOOGLE_APPLICATION_CREDENTIALS, fetch: globalThis.fetch };
    const asked: string[] = [];
    try {
      process.env.HOME = empty; // no gcloud login here
      process.env.CLOUDSDK_CONFIG = empty;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      // a cloud VM: its metadata server answers any request with the machine's own token
      globalThis.fetch = (async (u: string | URL | Request) => {
        asked.push(String(u));
        return new Response(JSON.stringify({ access_token: "machine-token-0001", expires_in: 3600, token_type: "Bearer" }), { status: 200 });
      }) as typeof fetch;
      const f = fakeBb({ voiceEnabled: true, ...values });
      const { lives, socket } = withLives();
      await registerVoice(f.bb, deps({ socket })); // no test auth: the server's own default
      const st = (await f.rpcs.voiceStatus!(null)) as { ready: boolean; credential: string; problem: string };
      assert.deepEqual(asked, [], "no request to any token or metadata endpoint");
      assert.equal(st.credential, "none");
      assert.equal(st.ready, false);
      assert.match(st.problem, prompt, "the setup prompt for the person's own credential");
      await f.routes[0]!.handler(ctx(SAME)).onOpen?.(new FakePage());
      assert.equal(lives.length, 0, "no call on the machine's account");
    } finally {
      globalThis.fetch = saved.fetch;
      for (const [k, v] of [["HOME", saved.HOME], ["CLOUDSDK_CONFIG", saved.CLOUDSDK_CONFIG], ["GOOGLE_APPLICATION_CREDENTIALS", saved.GAC]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(empty, { recursive: true, force: true });
    }
  });
