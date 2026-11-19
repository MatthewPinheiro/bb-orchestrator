// The AI player's server side, kept pure so node:test can drive it: the owner's settings, the caps, the call to the
// owner's decision API and the check of its answer. The page sends the game screen (a PNG) and a compact game state; this
// asks the API one typed `choice` question (which intent, and so which buttons, next) and hands back the pick.
// The key stays here: it is read from the owner's dotenv file (or the secret setting) on each turn, and never goes into a
// response, a log line or an error. Only the screen, the compact state and this module's own words go to the API.
import { randomUUID } from "node:crypto";
import { z } from "zod";

/** The owner's settings for the AI player (all empty by default: the player is off until they're set). */
export type PlayerSettings = {
  aiPlayerEndpoint: string;
  aiPlayerModel: string;
  aiPlayerKeyFile: string;
  aiPlayerKeyName: string;
  aiPlayerKey?: string | undefined;
  aiPlayerHeaders: string;
  aiPlayerName: string;
  aiPlayerGapSeconds: number;
  aiPlayerSessionCalls: number;
  aiPlayerDayCalls: number;
};

/** The buttons the page may press, by name. Nothing else reaches the emulator (no save-state or speed keys). */
export const BUTTONS = ["A", "B", "UP", "DOWN", "LEFT", "RIGHT", "START", "SELECT", "L", "R"] as const;
export type Button = (typeof BUTTONS)[number];

/**
 * The choice question's options. Each one is an intent and the buttons that carry it out, so the pick and its reason
 * come from one typed answer and can't disagree: the page shows "<buttons> (<confidence>): <why>", the why being the
 * option's name. The options cover every button, a few short runs, and `other` (press nothing, look again).
 */
export const OPTIONS: Record<string, { buttons: Button[]; about: string; why?: string }> = {
  "read the next text": { buttons: ["A"], about: "Text is on screen: press A once to go on." },
  "read through the text": { buttons: ["A", "A", "A"], about: "A long run of text is on screen: press A three times." },
  "talk to or check what is in front": { buttons: ["A"], about: "Facing a person, a sign or an object, with no text up: press A." },
  "pick the highlighted option": { buttons: ["A"], about: "A menu, a yes/no box or the battle menu is open: press A on the highlighted entry." },
  "back out": { buttons: ["B"], about: "Cancel, or close the menu that's open: press B." },
  "back out of several menus": { buttons: ["B", "B", "B"], about: "Close several menus: press B three times." },
  "step up": { buttons: ["UP"], about: "Walk or turn up one tile, or move a menu cursor up one row." },
  "step down": { buttons: ["DOWN"], about: "Walk or turn down one tile, or move a menu cursor down one row." },
  "step left": { buttons: ["LEFT"], about: "Walk or turn left one tile, or move a menu cursor left." },
  "step right": { buttons: ["RIGHT"], about: "Walk or turn right one tile, or move a menu cursor right." },
  "walk up to explore": { buttons: ["UP", "UP", "UP", "UP"], about: "No text or menu is up: walk four tiles up, toward a path, a door or someone new." },
  "walk down to explore": { buttons: ["DOWN", "DOWN", "DOWN", "DOWN"], about: "No text or menu is up: walk four tiles down, toward a path, a door or someone new." },
  "walk left to explore": { buttons: ["LEFT", "LEFT", "LEFT", "LEFT"], about: "No text or menu is up: walk four tiles left, toward a path, a door or someone new." },
  "walk right to explore": { buttons: ["RIGHT", "RIGHT", "RIGHT", "RIGHT"], about: "No text or menu is up: walk four tiles right, toward a path, a door or someone new." },
  "open the main menu": { buttons: ["START"], about: "Press Start to open the main menu (party, bag, save)." },
  "press Select": { buttons: ["SELECT"], about: "Press Select (a registered item)." },
  "press L": { buttons: ["L"], about: "Press the L shoulder button." },
  "press R": { buttons: ["R"], about: "Press the R shoulder button." },
  other: { buttons: [], about: "None of these fits: press nothing this turn and look again.", why: "none of these fits" },
};

const INPUT_QUESTION =
  "You are playing a Game Boy Advance game for its owner, one input at a time. `screen` shows the game right now. " +
  "`game` is read from the game's memory as a cross-check: the map, position, party, battle (your moves and the foe), " +
  "whether text is up (`textBox`) and whether a script or menu holds the player (`controlsLocked`); it can be partial. " +
  "`recent` lists your last choices, oldest first, with where you were and whether you `moved` after it. Choose what " +
  "moves the game forward: read text " +
  "on, answer menus, explore new places and talk to people, and win battles by fighting with damaging moves. In the " +
  "overworld with no text up, prefer walking several steps toward somewhere new. A walk with `moved` false was blocked " +
  "(a wall, a ledge, a tree): go another way.";

/** The one line that says what to set, when the player can't run. */
export const SETUP_LINE =
  "AI player: set aiPlayerEndpoint, and aiPlayerKeyFile with aiPlayerKeyName (or aiPlayerKey), in the Orchestrator's settings";

const DEFAULT_GAP_S = 3;
const DEFAULT_SESSION = 100;
const DEFAULT_DAY = 500;
const CALL_TIMEOUT_MS = 30_000;
const RECENT = 6;

/** The page's compact state: checked strictly, so nothing but game state is forwarded. */
const text = z.string().max(40);
const mon = z.object({ species: text, level: z.number().int().min(0).max(255), hp: z.number().int().min(0).max(65535), maxHp: z.number().int().min(0).max(65535) }).strict();
export const stateSchema = z
  .object({
    game: z.string().max(8),
    title: text.optional(),
    screen: z.enum(["overworld", "battle", "other"]).optional(),
    map: z.object({ group: z.number().int(), num: z.number().int(), name: text }).strict().optional(),
    position: z.object({ x: z.number().int(), y: z.number().int() }).strict().optional(),
    party: z.array(mon).max(6).optional(),
    battle: z
      .object({ moves: z.array(z.object({ name: text, pp: z.number().int().min(0).max(255) }).strict()).max(4), foe: mon.nullable() })
      .strict()
      .nullable()
      .optional(),
    textBox: z.boolean().optional(),
    controlsLocked: z.boolean().optional(),
  })
  .strict();
export type GameState = z.infer<typeof stateSchema>;

const SESSION = /^[A-Za-z0-9-]{8,64}$/;
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const SCREEN_MAX_BYTES = 2 * 1024 * 1024;

/** A PNG's width and height from its IHDR, or null if it isn't a PNG. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIG) || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** `KEY=value` lines of a dotenv file (quotes stripped, `export ` allowed, comments ignored). */
export function parseDotenv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const v = m[2]!;
    out.set(m[1]!, /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v.replace(/\s+#.*$/, ""));
  }
  return out;
}

/** `Name: value` lines (the extra headers setting). Authorization and Content-Type are this module's own. */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || /^(authorization|content-type|content-length|host)$/i.test(name)) continue;
    out[name] = line.slice(i + 1).trim();
  }
  return out;
}

const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : dflt);
export const displayName = (s: PlayerSettings) => s.aiPlayerName.trim().slice(0, 24) || "AI";

/** Today's calls, kept on disk so a plugin reload doesn't reset the day's cap. */
export type DayCount = { day: string; calls: number };

export type PlayerDeps = {
  settings: () => PlayerSettings;
  fetch: typeof fetch;
  readFile: (path: string) => string;
  home: string;
  now: () => number;
  loadDay: () => DayCount | null;
  saveDay: (d: DayCount) => void;
  log: (line: string) => void;
};

export type TurnResult = { status: number; body: { ok: true; result: TurnPick } | { ok: false; error: { message: string } } };
export type TurnPick = {
  option: string;
  buttons: Button[];
  confidence: number;
  why: string;
  nextInMs: number;
  calls: { session: number; sessionCap: number; day: number; dayCap: number };
};

export function createPlayer(deps: PlayerDeps) {
  let inFlight = false;
  let lastCallAt = 0;
  const sessions = new Map<string, { calls: number; recent: { choice: string; map?: string; x?: number; y?: number; screen?: string; moved?: boolean }[] }>();

  const day = () => new Date(deps.now()).toISOString().slice(0, 10);
  const dayCount = (): DayCount => {
    const d = deps.loadDay();
    return d && d.day === day() && Number.isInteger(d.calls) ? d : { day: day(), calls: 0 };
  };
  const caps = (s: PlayerSettings) => ({
    gapMs: num(s.aiPlayerGapSeconds, DEFAULT_GAP_S) * 1000,
    session: Math.floor(num(s.aiPlayerSessionCalls, DEFAULT_SESSION)),
    day: Math.floor(num(s.aiPlayerDayCalls, DEFAULT_DAY)),
  });

  /** The key, or why there is none. Its value never goes into the returned problem text. */
  const loadKey = (s: PlayerSettings): { key: string } | { problem: string } => {
    const secret = (s.aiPlayerKey ?? "").trim();
    if (secret) return { key: secret };
    const file = s.aiPlayerKeyFile.trim().replace(/^~(?=\/|$)/, deps.home);
    const name = s.aiPlayerKeyName.trim();
    if (!file || !name) return { problem: SETUP_LINE };
    let text: string;
    try {
      text = deps.readFile(file);
    } catch {
      return { problem: "AI player: the key file in aiPlayerKeyFile can't be read" };
    }
    const key = parseDotenv(text).get(name)?.trim();
    return key ? { key } : { problem: `AI player: the key file has no ${name.slice(0, 64)}` };
  };

  /** What the page needs to show the toggle: never the key, the endpoint or the file path. */
  function info() {
    const s = deps.settings();
    const ready = !!s.aiPlayerEndpoint.trim() && ((s.aiPlayerKey ?? "").trim() !== "" || (!!s.aiPlayerKeyFile.trim() && !!s.aiPlayerKeyName.trim()));
    const c = caps(s);
    return { ready, name: displayName(s), setup: ready ? null : SETUP_LINE, caps: { gapSeconds: c.gapMs / 1000, session: c.session, day: c.day }, today: dayCount().calls };
  }

  const refuse = (status: number, message: string): TurnResult => ({ status, body: { ok: false, error: { message } } });

  async function turn(raw: unknown): Promise<TurnResult> {
    const s = deps.settings();
    if (!s.aiPlayerEndpoint.trim()) return refuse(409, SETUP_LINE);
    const k = loadKey(s);
    if ("problem" in k) return refuse(409, k.problem);
    const key = k.key;
    const scrub = (t: string) => (key.length >= 4 ? t.split(key).join("[key]") : t);
    try {
      return await turnWith(s, key, raw);
    } catch (e) {
      const msg = scrub(String((e as Error)?.message ?? e)).slice(0, 200);
      deps.log(`gameboy AI player: turn failed: ${msg}`);
      return refuse(500, `AI player: ${msg}`);
    }
  }

  async function turnWith(s: PlayerSettings, key: string, raw: unknown): Promise<TurnResult> {
    const b = (raw ?? {}) as { session?: unknown; screen?: unknown; state?: unknown };
    if (typeof b.session !== "string" || !SESSION.test(b.session)) return refuse(400, "AI player: bad session id");
    if (typeof b.screen !== "string" || b.screen.length > Math.ceil(SCREEN_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.screen))
      return refuse(400, "AI player: the screen must be a base64 PNG");
    const png = Buffer.from(b.screen, "base64");
    const size = pngSize(png);
    if (!size || size.width < 160 || size.height < 144 || size.width > 2048 || size.height > 2048) return refuse(400, "AI player: the screen isn't a game-sized PNG");
    const parsed = stateSchema.safeParse(b.state);
    if (!parsed.success) return refuse(400, "AI player: the game state doesn't match the expected shape");

    // the caps, checked and the call reserved before anything is sent
    const c = caps(s);
    const now = deps.now();
    const g = parsed.data;
    if (inFlight) return refuse(429, "AI player: a turn is already running");
    if (now - lastCallAt < c.gapMs) return refuse(429, `AI player: wait ${Math.ceil((c.gapMs - (now - lastCallAt)) / 1000)} s between calls`);
    const sess = sessions.get(b.session) ?? { calls: 0, recent: [] };
    if (sess.calls >= c.session) return refuse(429, `AI player: this session's cap of ${c.session} calls is reached`);
    const today = dayCount();
    if (today.calls >= c.day) return refuse(429, `AI player: today's cap of ${c.day} calls is reached`);
    lastCallAt = now;
    sess.calls++;
    sessions.set(b.session, sess);
    if (sessions.size > 50) sessions.delete(sessions.keys().next().value!);
    deps.saveDay({ day: today.day, calls: today.calls + 1 });
    inFlight = true; // after the save: a failed save mustn't leave a turn "running" for good

    // did the last choice move the player? (a walk into a wall or a ledge doesn't)
    const last = sess.recent.at(-1);
    if (last && last.moved === undefined && last.x !== undefined && g.position && g.map)
      last.moved = !(last.x === g.position.x && last.y === g.position.y && last.map === g.map.name);

    const offered = optionsFor(sess.recent, g);

    try {
      const ref = `${randomUUID()}-screen`;
      const request: Record<string, unknown> = {
        state: { screen: ref, game: parsed.data, recent: sess.recent },
        assets: { [ref]: { type: "image", format: "png", data_base64: png.toString("base64") } },
        questions: {
          input: { type: "choice", instructions: INPUT_QUESTION, criteria: Object.fromEntries(offered.map((k) => [k, OPTIONS[k]!.about])) },
        },
      };
      if (s.aiPlayerModel.trim()) request.model = s.aiPlayerModel.trim();
      let res: Response;
      try {
        res = await deps.fetch(s.aiPlayerEndpoint.trim(), {
          method: "POST",
          headers: { ...parseHeaders(s.aiPlayerHeaders), Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(request),
          redirect: "error",
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
      } catch {
        return refuse(502, "AI player: the decision API didn't answer");
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return refuse(502, `AI player: the decision API said HTTP ${res.status}`);
      }
      const answer = pick(await res.json().catch(() => null), offered);
      if (!answer) return refuse(502, "AI player: the decision API's answer didn't match the questions");
      sess.recent.push({ choice: answer.option, map: g.map?.name, x: g.position?.x, y: g.position?.y, screen: roam(g) });
      if (sess.recent.length > RECENT) sess.recent.shift();
      return {
        status: 200,
        body: {
          ok: true,
          result: { ...answer, buttons: OPTIONS[answer.option]!.buttons, nextInMs: Math.max(0, c.gapMs - (deps.now() - now)), calls: { session: sess.calls, sessionCap: c.session, day: today.calls + 1, dayCap: c.day } },
        },
      };
    } finally {
      inFlight = false;
    }
  }

  return { info, turn };
}

const DIRS: Button[] = ["UP", "DOWN", "LEFT", "RIGHT"];
/** The screen as the recent list tells it: "overworld" only while the player can walk; a menu or text up is its own. */
export const roam = (g: GameState) => (g.screen === "overworld" && (g.controlsLocked || g.textBox) ? "menu or text" : g.screen);
/**
 * The options for this turn: all of them, except walks in a direction that just got the player nowhere. Walks made from
 * where the player stands now, while free to walk, that didn't move them (a wall, a ledge, a tree) are left out until the
 * player moves. In a menu, text or a battle nothing is left out: a cursor press never moves the player.
 */
export function optionsFor(recent: { choice: string; x?: number; y?: number; map?: string; screen?: string; moved?: boolean }[], g: GameState): string[] {
  const blocked = new Set<Button>();
  for (let i = recent.length - 1; i >= 0; i--) {
    const r = recent[i]!;
    if (r.moved !== false || r.screen !== "overworld" || roam(g) !== "overworld" || !g.position || r.x !== g.position.x || r.y !== g.position.y || r.map !== g.map?.name) break;
    const b = OPTIONS[r.choice]?.buttons ?? [];
    if (b.length && b.every((x) => x === b[0]) && DIRS.includes(b[0]!)) blocked.add(b[0]!);
  }
  return Object.keys(OPTIONS).filter((k) => {
    const b = OPTIONS[k]!.buttons;
    return !(b.length && DIRS.includes(b[0]!) && blocked.has(b[0]!));
  });
}

/** The pick from the API's typed answer, or null when it doesn't match what was asked. */
export function pick(res: unknown, offered: string[] = Object.keys(OPTIONS)): { option: string; confidence: number; why: string } | null {
  const input = (res as { answers?: Record<string, { type?: unknown; choice?: unknown; confidence?: unknown }> } | null)?.answers?.input;
  if (!input || input.type !== "choice" || typeof input.choice !== "string" || !offered.includes(input.choice) || !Object.hasOwn(OPTIONS, input.choice)) return null;
  if (typeof input.confidence !== "number" || !(input.confidence >= 0 && input.confidence <= 1)) return null;
  return { option: input.choice, confidence: input.confidence, why: OPTIONS[input.choice]!.why ?? input.choice };
}
