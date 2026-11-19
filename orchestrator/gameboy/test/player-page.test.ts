// The AI player's page side (core/player-page.ts), run as the very text the page embeds, under node:vm. What matters:
// - the owner is always in charge: any input of theirs stops the loop at once, their input still reaches the game, no
//   button is left held, and a pick that arrives after they took over is dropped;
// - only the GBA's buttons are ever pressed (never EmulatorJS's save-state, load-state or speed keys);
// - the compact state is right for the game (map, position, party, battle, text), read from a savestate made in the test
//   harness. The fixtures keep only the bytes the reader reads, with the trainer's names and id scrubbed; the name tables
//   come from a fake ROM built here (no ROM bytes in the repo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PLAYER_JS } from "../core/player-page.ts";

type Player = {
  readState: (raw: Uint8Array, rom: Uint8Array | null) => Record<string, unknown>;
  createLoop: (o: Record<string, unknown>) => { start(): void; stop(why: string): void; readonly running: boolean };
  BUTTON_INDEX: Record<string, number>;
};
function load(): Player {
  const ctx = vm.createContext({});
  vm.runInContext(PLAYER_JS, ctx);
  return (ctx as { gbPlayer: Player }).gbPlayer;
}
const P = load();
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)); // out of the vm's realm, for deepEqual

/** A savestate as EmulatorJS's getState() gives it: RetroArch's RASTATE container around mGBA's state. */
function stateFrom(fixture: string): Uint8Array {
  const f = JSON.parse(readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8")) as { size: number; regions: [number, string][] };
  const mem = Buffer.alloc(f.size);
  for (const [at, hex] of f.regions) Buffer.from(hex, "hex").copy(mem, at);
  const head = Buffer.alloc(16);
  head.write("RASTATE\x01", 0, "latin1");
  head.write("MEM ", 8, "latin1");
  head.writeUInt32LE(mem.length, 12);
  const end = Buffer.alloc(8);
  end.write("END ", 0, "latin1");
  return new Uint8Array(Buffer.concat([head, mem, Buffer.alloc((8 - (mem.length % 8)) % 8), end]));
}

/** Gen 3 text: A-Z, a-z, 0-9 and space, 0xFF-terminated. */
const enc = (t: string) => Buffer.from([...t].map((c) => (c >= "A" && c <= "Z" ? 0xbb + c.charCodeAt(0) - 65 : c >= "a" && c <= "z" ? 0xd5 + c.charCodeAt(0) - 97 : c >= "0" && c <= "9" ? 0xa1 + +c : 0)).concat([0xff]));
/** A fake ROM with only this game's code and the name-table entries the fixtures use. */
function fakeRom(code = "BPEE"): Uint8Array {
  const rom = Buffer.alloc(0x600000);
  rom.write(code, 0xac, "latin1");
  enc("MUDKIP").copy(rom, 0x3185c8 + 283 * 11);
  enc("POOCHYENA").copy(rom, 0x3185c8 + 286 * 11);
  enc("TACKLE").copy(rom, 0x31977c + 33 * 13);
  enc("GROWL").copy(rom, 0x31977c + 45 * 13);
  rom.writeUInt32LE(0x08500000, 0x5a147c + 16 * 8 + 4); // place 16 -> its name at 0x500000
  enc("ROUTE 101").copy(rom, 0x500000);
  return new Uint8Array(rom);
}

test("the overworld fixture reads as the owner's game was: Route 101, one Mudkip at level 5, no battle, no text", () => {
  assert.deepEqual(plain(P.readState(stateFrom("emerald-overworld.json"), fakeRom())), {
    game: "BPEE",
    screen: "overworld",
    map: { group: 0, num: 16, name: "ROUTE 101" },
    position: { x: 8, y: 8 },
    party: [{ species: "MUDKIP", level: 5, hp: 20, maxHp: 20 }],
    battle: null,
    textBox: false,
    controlsLocked: false,
  });
});

test("the battle fixture reads as the screen showed it: a wild Poochyena at level 2, Tackle and Growl with their PP, text up", () => {
  assert.deepEqual(plain(P.readState(stateFrom("emerald-battle.json"), fakeRom())), {
    game: "BPEE",
    screen: "battle",
    map: { group: 0, num: 16, name: "ROUTE 101" },
    position: { x: 14, y: 12 },
    party: [{ species: "MUDKIP", level: 5, hp: 20, maxHp: 20 }],
    battle: { moves: [{ name: "TACKLE", pp: 35 }, { name: "GROWL", pp: 40 }], foe: { species: "POOCHYENA", level: 2, hp: 13, maxHp: 13 } },
    textBox: true,
    controlsLocked: true,
  });
});

test("without the ROM, or with another game's ROM, names fall back to ids instead of reading the wrong table", () => {
  for (const rom of [null, fakeRom("AXVE")]) {
    const s = plain(P.readState(stateFrom("emerald-overworld.json"), rom)) as { party: { species: string }[]; map: { name: string } };
    assert.equal(s.party[0]!.species, "#283");
    assert.equal(s.map.name, "#16");
  }
});

test("an unknown game gets only its code and title, and garbage gets the minimal state", () => {
  const raw = stateFrom("emerald-overworld.json");
  const other = raw.slice();
  other.set(Buffer.from("ZZZE", "latin1"), 16 + 0x1c);
  assert.deepEqual(plain(P.readState(other, null)), { game: "ZZZE", title: "POKEMON EMER" });
  assert.deepEqual(plain(P.readState(new Uint8Array(100), null)), { game: "unknown" });
});

// ---- the loop

class FakeGame {
  log: [number, number][] = [];
  simulateInput(_player: number, index: number, value: number) {
    this.log.push([index, value]);
  }
  getState() {
    return new Uint8Array(0);
  }
}
const tick = () => new Promise((ok) => setImmediate(ok));

function loopRig(answers: (() => Promise<unknown>)[]) {
  const gm = new FakeGame();
  const lines: string[] = [];
  const stops: string[] = [];
  const posts: unknown[] = [];
  const loop = P.createLoop({
    name: "Pilot",
    gm: () => gm,
    shot: async () => "cG5n",
    read: () => ({ game: "BPEE" }),
    post: async (_path: string, body: unknown) => {
      posts.push(body);
      const next = answers.shift();
      return next ? next() : new Promise(() => {}); // later turns never answer
    },
    say: (l: string) => lines.push(l),
    onStop: (why: string) => stops.push(why),
    wait: async () => {},
    waitFrames: async () => {},
    session: () => "s-1234-5678",
  });
  return { gm, loop, lines, stops, posts };
}
const pick = (buttons: string[], why = "walk up to explore", confidence = 0.8) => async () => ({ option: "x", buttons, confidence, why, nextInMs: 0 });

test("the owner pressing a button stops the loop at once, still reaches the game, and nothing stays held", async () => {
  const r = loopRig([pick(["UP", "UP", "UP", "UP"])]);
  r.loop.start();
  await tick();
  await tick();
  assert.equal(r.lines[0], "Pilot: UP x4 (0.80): walk up to explore");
  assert.equal(r.loop.running, true);
  r.gm.log.length = 0;
  r.gm.simulateInput(0, P.BUTTON_INDEX.B!, 1); // what EmulatorJS calls for a key, a touch-pad button or a gamepad
  assert.equal(r.loop.running, false);
  assert.deepEqual(r.stops, ["you pressed a button"]);
  const released = r.gm.log.filter(([, v]) => v === 0).map(([i]) => i).sort((a, b) => a - b);
  assert.deepEqual(released, Object.values(P.BUTTON_INDEX).sort((a, b) => a - b), "every button is released");
  assert.deepEqual(r.gm.log.at(-1), [P.BUTTON_INDEX.B, 1], "the owner's own press goes through, after the release");
  assert.equal(Object.hasOwn(r.gm, "simulateInput"), false, "the hook is gone");
});

test("a pick that arrives after the owner took over is dropped: nothing is pressed", async () => {
  let answer!: (v: unknown) => void;
  const r = loopRig([() => new Promise((ok) => (answer = ok))]);
  r.loop.start();
  await tick();
  r.gm.simulateInput(0, P.BUTTON_INDEX.A!, 1);
  r.gm.log.length = 0;
  answer({ option: "A", buttons: ["A", "A", "A"], confidence: 0.9, why: "read the next text", nextInMs: 0 });
  await tick();
  await tick();
  assert.deepEqual(r.gm.log, []);
  assert.deepEqual(r.lines, []);
});

test("the toggle off, or the page's own stop, ends the loop with its reason", async () => {
  const r = loopRig([]);
  r.loop.start();
  await tick();
  r.loop.stop("you turned it off");
  r.loop.stop("again");
  assert.deepEqual(r.stops, ["you turned it off"]);
});

test("only the GBA's buttons are pressed, whatever the server sends", async () => {
  const r = loopRig([pick(["A", "TURBO", "SAVE_STATE", "START"])]);
  r.loop.start();
  for (let i = 0; i < 6; i++) await tick();
  const pressed = r.gm.log.filter(([, v]) => v === 1).map(([i]) => i);
  assert.deepEqual(pressed, [P.BUTTON_INDEX.A, P.BUTTON_INDEX.START]);
  for (const i of Object.values(P.BUTTON_INDEX)) assert.ok(i < 16, "never EmulatorJS's 24-29 (save/load state, speed)");
});

test("a refused turn (a cap, an error) stops the loop and says why", async () => {
  const r = loopRig([async () => { throw new Error("AI player: today's cap of 500 calls is reached"); }]);
  r.loop.start();
  await tick();
  await tick();
  assert.equal(r.loop.running, false);
  assert.deepEqual(r.stops, ["AI player: today's cap of 500 calls is reached"]);
});

test("one call at a time: the next turn starts only after the last one's buttons", async () => {
  let answer!: (v: unknown) => void;
  const r = loopRig([() => new Promise((ok) => (answer = ok)), pick(["B"])]);
  r.loop.start();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(r.posts.length, 1);
  answer({ option: "A", buttons: ["A"], confidence: 0.5, why: "read the next text", nextInMs: 0 });
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(r.posts.length, 3);
  r.loop.stop("done");
});

test("a quick off and on doesn't let the old pick's remaining buttons fire into the new run", async () => {
  let release!: () => void;
  const gate = new Promise<void>((ok) => (release = ok));
  const gm = new FakeGame();
  const answers = [pick(["UP", "DOWN", "LEFT", "RIGHT"])];
  const loop = P.createLoop({
    name: "Pilot", gm: () => gm, shot: async () => "cG5n", read: () => ({ game: "BPEE" }),
    post: async () => (answers.length ? answers.shift()!() : new Promise(() => {})),
    say: () => {}, onStop: () => {}, wait: async () => {}, session: () => "s-1234-5678",
    waitFrames: async () => { await gate; }, // the first press is held until the gate opens
  });
  loop.start();
  for (let i = 0; i < 4; i++) await tick();
  loop.stop("you turned it off");
  loop.start(); // on again at once: its own turn never answers
  gm.log.length = 0;
  release();
  for (let i = 0; i < 8; i++) await tick();
  assert.deepEqual(gm.log.filter(([, v]) => v === 1), [], "no DOWN, LEFT or RIGHT from the old pick");
  loop.stop("done");
});
