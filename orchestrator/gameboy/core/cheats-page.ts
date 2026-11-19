// EmulatorJS's Cheats menu, made to mean what its tick boxes show. Plain JavaScript the /play page embeds in a <script>
// (core/page.ts), as a string so the page needs no build step; the tests run the very same text under node:vm
// (test/cheats-page.test.ts). It defines `gbCheats.hook(emulator, opts)` on the page's global object.
//
// Why: mGBA's libretro core ignores the tick box. retro_cheat_set(index, enabled, code) declares index and enabled
// UNUSED and appends the code to its one cheat set, and retro_cheat_reset (mCheatDeviceClear) empties that set.
// EmulatorJS 4.2.3 resets and re-sends every listed code when it redraws the list (at start, on Submit and on ×), but a
// tick or untick calls setCheat on its own, so each click adds another live copy and nothing is ever switched off.
// The hook replaces the emulator's cheatChanged and wraps its updateCheatUI, the paths every tick, untick, ×, Submit
// and the cheats restored at start go through: each change rebuilds the core's set from scratch, resetCheat() and
// then setCheat(i, true, code) for each ticked cheat only. One rebuild per redraw, so the list is sent once.
//
// ROM patches: a reset frees the cheat set without undoing its ROM patches (mCheatDeviceClear never calls
// _unpatchROM), and nothing in the libretro API reaches that. So when a rebuild drops a code that was live (untick or
// ×), the page writes the original ROM bytes (its own copy of the ROM, opts.rom()) back over the core's ROM in the
// emulator's heap before re-sending the ticked codes, which patch again. The core's ROM is found by its header: the
// load buffer (never patched, 0 differences) and, once something wrote to ROM, mGBA's copy-on-write copy (the live
// one). Bytes 0xC4-0xC9 are the cartridge's GPIO port (the clock), which the core keeps in ROM memory: never touched.
// A region that differs in more than MAX_DIFF bytes isn't a patched ROM and is left alone.
export const CHEATS_JS = String.raw`(function () {
  "use strict";
  var G = typeof window !== "undefined" ? window : globalThis;

  var HEADER = 0xc0, GPIO_FROM = 0xc4, GPIO_TO = 0xca, MAX_DIFF = 0x10000;

  /** Offsets in the heap where a copy of the ROM starts (its first 0xC0 bytes match). */
  function romCopies(heap, rom) {
    var out = [];
    if (!rom || rom.length < HEADER || heap.byteOffset % 4) return out;
    var words = new Uint32Array(heap.buffer, heap.byteOffset, heap.length >>> 2);
    var first = (rom[0] | (rom[1] << 8) | (rom[2] << 16) | (rom[3] << 24)) >>> 0;
    for (var j = 0; j < words.length; j++) {
      if (words[j] !== first) continue;
      var at = j * 4;
      if (at + rom.length > heap.length) break;
      var same = true;
      for (var k = 4; k < HEADER; k++) if (heap[at + k] !== rom[k]) { same = false; break; }
      if (same) out.push(at);
    }
    return out;
  }

  /** Writes the original ROM bytes back over every patched copy in the heap; returns the bytes written. */
  function restoreRom(heap, rom) {
    var written = 0;
    romCopies(heap, rom).forEach(function (at) {
      var diff = [];
      for (var k = 0; k < rom.length; k++) {
        if (k === GPIO_FROM) { k = GPIO_TO - 1; continue; }
        if (heap[at + k] !== rom[k] && diff.push(k) > MAX_DIFF) break;
      }
      if (diff.length > MAX_DIFF) return console.warn("gameboy: cheats: a ROM copy differs in over " + MAX_DIFF + " bytes, left alone");
      for (var i = 0; i < diff.length; i++) heap[at + diff[i]] = rom[diff[i]];
      written += diff.length;
    });
    return written;
  }

  /**
   * emu: EmulatorJS's emulator (window.EJS_emulator), hooked as soon as EmulatorJS creates it.
   * opts.rom(): the ROM's original bytes, or null while they aren't loaded.
   */
  function hook(emu, opts) {
    var live = [];        // the codes the core holds, as the last rebuild sent them
    var redrawing = false;
    function rebuild() {
      var gm = emu.gameManager;
      if (!gm) return;
      var send = [];
      for (var i = 0; i < emu.cheats.length; i++) if (emu.cheats[i].checked) send.push([i, emu.cheats[i].code]);
      var dropped = live.some(function (c) { return !send.some(function (s) { return s[1] === c; }); });
      gm.resetCheat();
      if (dropped) {
        var rom = opts && opts.rom ? opts.rom() : null;
        var heap = gm.Module && gm.Module.HEAPU8; // read fresh: the heap's view changes when memory grows
        if (rom && heap) {
          var n = restoreRom(heap, rom);
          if (n) console.info("gameboy: cheats: undid " + n + " ROM patch bytes");
        } else console.warn("gameboy: cheats: can't undo ROM patches (no ROM bytes or heap)");
      }
      for (var j = 0; j < send.length; j++) gm.setCheat(send[j][0], true, send[j][1]);
      live = send.map(function (s) { return s[1]; });
    }
    emu.cheatChanged = function () { if (!redrawing) rebuild(); };
    var redraw = emu.updateCheatUI;
    emu.updateCheatUI = function () {
      redrawing = true;
      try { redraw.apply(emu, arguments); } finally { redrawing = false; }
      rebuild();
    };
  }

  G.gbCheats = { hook: hook, romCopies: romCopies, restoreRom: restoreRom };
})();
`;
