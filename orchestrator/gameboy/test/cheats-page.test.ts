// The Cheats menu hook (core/cheats-page.ts), run as the very text the page embeds, under node:vm. What matters: a cheat
// is live exactly while its box is ticked, once. mGBA's core ignores the tick box (its set call appends the code whatever
// "enabled" says, and only a reset removes codes), so without the hook every tick and untick stacks another live copy,
// an unticked cheat stays live, and nothing can be switched off without reloading the page.
// The emulator here is a stand-in that makes EmulatorJS 4.2.3's calls in its order (a redraw resets and sends every
// listed code; a tick sends only that code; × sends it once more, removes it, redraws), and the core behaves like mGBA's,
// ROM patches included: a reset doesn't undo them. The codes are made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { CHEATS_JS } from "../core/cheats-page.ts";
import { playHtml } from "../core/page.ts";

type Hook = { hook: (emu: unknown, opts: { rom: () => Uint8Array | null }) => void };
function load(): Hook {
  const ctx = vm.createContext({ console: { info() {}, warn() {} } });
  vm.runInContext(CHEATS_JS, ctx);
  return (ctx as { gbCheats: Hook }).gbCheats;
}

const GPIO = 0xc4; // the cartridge's clock port, which the core keeps in ROM memory

/** A ROM with a recognisable header and body. */
function fakeRom(size = 0x4000): Uint8Array {
  const rom = new Uint8Array(size);
  for (let i = 0; i < size; i++) rom[i] = (i * 7 + 3) & 0xff;
  rom.set([0x2e, 0x00, 0x00, 0xea], 0); // a branch, as GBA ROMs start
  return rom;
}

/**
 * mGBA's libretro core: one cheat set; set appends whatever "enabled" says, reset empties it. A code "PATCH off val"
 * is a ROM patch: it writes the live ROM copy, and a reset leaves it there. The heap holds the core's load buffer
 * (pristine) and its copy-on-write ROM (the live one, with the clock's GPIO bytes set).
 */
function fakeCore(rom: Uint8Array) {
  const heap = new Uint8Array(0x10000 + rom.length * 2 + 0x1000);
  const loadAt = 0x8000, liveAt = loadAt + rom.length + 0x800;
  heap.set(rom, loadAt);
  heap.set(rom, liveAt);
  heap[liveAt + GPIO] = 0x05;
  heap[liveAt + GPIO + 2] = 0x07;
  const set: string[] = [];
  const gm = {
    Module: { HEAPU8: heap },
    resetCheat() { set.length = 0; },
    setCheat(_i: number, _enabled: boolean, code: string) {
      set.push(code);
      const m = /^PATCH ([0-9a-f]+) ([0-9a-f]+)$/.exec(code);
      if (m) heap[liveAt + parseInt(m[1], 16)] = parseInt(m[2], 16);
    },
  };
  return { gm, set, heap, loadAt, liveAt };
}

type Cheat = { desc: string; code: string; checked: boolean };
/** EmulatorJS 4.2.3's Cheats menu, by what it calls and when (methods called through the instance, as it does). */
class StandInEmulator {
  cheats: Cheat[] = [];
  gameManager: ReturnType<typeof fakeCore>["gm"];
  constructor(gm: ReturnType<typeof fakeCore>["gm"]) { this.gameManager = gm; }
  updateCheatUI() {
    if (!this.gameManager) return;
    this.gameManager.resetCheat();
    this.cheats.forEach((c, i) => this.cheatChanged(c.checked, c.code, i));
  }
  cheatChanged(checked: boolean, code: string, i: number) { this.gameManager.setCheat(i, checked, code); }
  // the row's label: flips the box and sends that one code
  clickLabel(desc: string) {
    const i = this.cheats.findIndex((c) => c.desc === desc);
    this.cheats[i].checked = !this.cheats[i].checked;
    this.cheatChanged(this.cheats[i].checked, this.cheats[i].code, i);
  }
  // the row's ×: sends the code as off, removes it, redraws
  clickX(desc: string) {
    const i = this.cheats.findIndex((c) => c.desc === desc);
    this.cheatChanged(false, this.cheats[i].code, i);
    this.cheats.splice(i, 1);
    this.updateCheatUI();
  }
  // Add Cheat > Submit: a new row, unticked, then a redraw
  submit(desc: string, code: string) {
    this.cheats.push({ desc, code, checked: false });
    this.updateCheatUI();
  }
  // the page loads: the stored list comes back, then a redraw
  start(stored: Cheat[]) {
    this.cheats = stored.map((c) => ({ ...c }));
    this.updateCheatUI();
  }
}

function setup(rom = fakeRom()) {
  const core = fakeCore(rom);
  const emu = new StandInEmulator(core.gm);
  load().hook(emu, { rom: () => rom });
  return { emu, core, rom };
}
const sorted = (xs: string[]) => [...xs].sort();

test("ticking switches a cheat on, unticking off, and the core holds each ticked cheat exactly once", () => {
  const { emu, core } = setup();
  emu.submit("Infinite money", "82000000 FFFF");
  emu.submit("No encounters", "82000010 0001");
  assert.deepEqual(core.set, [], "a new cheat is unticked, so it is off");
  emu.clickLabel("Infinite money");
  assert.deepEqual(core.set, ["82000000 FFFF"]);
  emu.clickLabel("Infinite money");
  assert.deepEqual(core.set, [], "unticked is off, with no reload");
  emu.clickLabel("Infinite money");
  emu.clickLabel("No encounters");
  emu.clickLabel("No encounters");
  emu.clickLabel("No encounters");
  assert.deepEqual(sorted(core.set), ["82000000 FFFF", "82000010 0001"], "repeated clicks never stack copies");
});

test("deleting a cheat with × removes it from the core, ticked or not", () => {
  const { emu, core } = setup();
  emu.submit("A", "82000000 0001");
  emu.submit("B", "82000002 0002");
  emu.submit("C", "82000004 0003");
  emu.clickLabel("A");
  emu.clickLabel("B");
  emu.clickX("A");
  assert.deepEqual(core.set, ["82000002 0002"]);
  emu.clickX("C");
  assert.deepEqual(core.set, ["82000002 0002"]);
  emu.clickX("B");
  assert.deepEqual(core.set, [], "the last delete leaves nothing live");
});

test("the cheats restored at start: the ticked ones are live once each, the unticked ones are off", () => {
  const { emu, core } = setup();
  emu.start([
    { desc: "A", code: "82000000 0001", checked: true },
    { desc: "B", code: "82000002 0002", checked: false },
    { desc: "C", code: "82000004 0003", checked: true },
  ]);
  assert.deepEqual(sorted(core.set), ["82000000 0001", "82000004 0003"]);
});

test("unticking or deleting a ROM-patch code undoes its patch at once; a code still ticked keeps its own", () => {
  const { emu, core, rom } = setup();
  const live = (off: number) => core.heap[core.liveAt + off];
  emu.submit("Walls", "PATCH 1000 aa");
  emu.submit("Speed", "PATCH 2000 bb");
  emu.clickLabel("Walls");
  emu.clickLabel("Speed");
  assert.equal(live(0x1000), 0xaa);
  assert.equal(live(0x2000), 0xbb);

  emu.clickLabel("Walls");
  assert.equal(live(0x1000), rom[0x1000], "unticked: the original ROM byte is back without a reload");
  assert.equal(live(0x2000), 0xbb, "the other ticked patch is sent again");
  assert.deepEqual(core.set, ["PATCH 2000 bb"]);

  emu.clickLabel("Walls");
  assert.equal(live(0x1000), 0xaa, "ticked again: patched again");
  emu.clickX("Walls");
  emu.clickX("Speed");
  assert.equal(live(0x1000), rom[0x1000]);
  assert.equal(live(0x2000), rom[0x2000], "the last delete undoes its patch too");
  assert.deepEqual([live(GPIO), live(GPIO + 2)], [0x05, 0x07], "the clock's GPIO bytes are the core's, never overwritten");
  assert.ok(Buffer.from(core.heap.subarray(core.loadAt, core.loadAt + rom.length)).equals(rom), "the load buffer stays as it was");
});

test("a heap region with the ROM's header that differs too much is not a patched ROM and is never written", () => {
  const rom = fakeRom(0x30000);
  const { emu, core } = setup(rom);
  core.heap.fill(0x11, core.liveAt + 0x100, core.liveAt + 0x100 + 0x14000); // reused memory, not a ROM
  const before = core.heap.slice();
  emu.submit("X", "82000000 0001");
  emu.clickLabel("X");
  emu.clickLabel("X");
  assert.deepEqual(core.set, []);
  assert.ok(Buffer.from(core.heap).equals(before), "no byte written");
});

test("the play page hooks the Cheats menu as soon as EmulatorJS creates its emulator", () => {
  const html = playHtml();
  assert.ok(html.includes(CHEATS_JS), "the hook's script is embedded");
  const setter = html.slice(html.indexOf("set: (v) => {"), html.indexOf("v.on(\"exit\""));
  assert.match(setter, /gbCheats\.hook\(v, \{ rom: \(\) => romBytes \}\)/);
  assert.match(html, /romBytes = new Uint8Array\(await rom\.arrayBuffer\(\)\)/, "the ROM's bytes are read before boot");
});
