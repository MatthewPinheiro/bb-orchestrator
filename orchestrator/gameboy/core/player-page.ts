// The AI player's page side, as plain JavaScript the /play page embeds in a <script> (core/page.ts). It is a string so the
// page needs no build step, and the tests run the very same text under node:vm (test/player-page.test.ts).
// It defines `gbPlayer` on the page's global object:
//   readState(savestate, rom)  the compact game state, read from an emulator savestate (mGBA's, inside RetroArch's
//                              RASTATE container) and, for names, the ROM. Keyed by the ROM's 4-letter game code; an
//                              unknown game gives only its code and title.
//   createLoop(opts)           the turn loop: screen + state, one turn call at a time, press the pick, wait, repeat. It
//                              stops on the toggle, on any input of the owner's (it wraps the emulator's simulateInput,
//                              which the keyboard, touch pad and gamepad all go through), on an error or a cap, and says why.
// Memory addresses are the game's own symbols (the public pokeemerald decomp); the savestate holds IWRAM at 0x19000 and
// WRAM at 0x21000 (mGBA's GBASerializedState).
export const PLAYER_JS = String.raw`(function () {
  "use strict";
  var G = typeof window !== "undefined" ? window : globalThis;

  // EmulatorJS's RetroPad indices for the GBA's buttons. Only these are ever pressed.
  var BUTTON_INDEX = { B: 0, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, L: 10, R: 11 };

  var IWRAM = 0x19000, WRAM = 0x21000, STATE_MIN = 0x61000;

  /** mGBA's state inside RetroArch's container ("RASTATE", then chunks: id, u32 size, data, 8-byte aligned). */
  function stateView(raw) {
    var b = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (b.length > 16 && latin1(b, 0, 7) === "RASTATE") {
      var o = 8;
      while (o + 8 <= b.length) {
        var id = latin1(b, o, 4), size = u32(b, o + 4);
        if (id === "MEM ") return b.subarray(o + 8, o + 8 + size);
        if (id === "END ") break;
        o = (o + 8 + size + 7) & ~7;
      }
      return null;
    }
    return b;
  }
  function latin1(b, at, n) { var s = ""; for (var i = 0; i < n && at + i < b.length; i++) s += String.fromCharCode(b[at + i]); return s; }
  function u8(b, at) { return at >= 0 && at < b.length ? b[at] : 0; }
  function u16(b, at) { return u8(b, at) | (u8(b, at + 1) << 8); }
  function s16(b, at) { var v = u16(b, at); return v & 0x8000 ? v - 0x10000 : v; }
  function u32(b, at) { return (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0; }
  function iw(addr) { return IWRAM + (addr - 0x03000000); }
  function wr(addr) { return WRAM + (addr - 0x02000000); }
  function isWram(p) { return p >= 0x02000000 && p < 0x02040000; }

  /** The game's own text encoding (Gen 3): letters, digits and a few signs; anything else is skipped. */
  function gameText(b, at, max) {
    var s = "";
    for (var i = 0; i < max && at + i < b.length; i++) {
      var c = b[at + i];
      if (c === 0xff) break;
      if (c >= 0xbb && c <= 0xd4) s += String.fromCharCode(65 + c - 0xbb);
      else if (c >= 0xd5 && c <= 0xee) s += String.fromCharCode(97 + c - 0xd5);
      else if (c >= 0xa1 && c <= 0xaa) s += String(c - 0xa1);
      else if (c === 0x00 || c === 0xfe) s += " ";
      else if (c === 0x1b) s += "é";
      else if (c === 0xab) s += "!";
      else if (c === 0xac) s += "?";
      else if (c === 0xad) s += ".";
      else if (c === 0xae) s += "-";
      else if (c === 0xb4) s += "'";
      else if (c === 0xb5) s += "♂";
      else if (c === 0xb6) s += "♀";
      else if (c === 0xb8) s += ",";
      else if (c === 0xba) s += "/";
      else if (c === 0xf0) s += ":";
    }
    return s.replace(/\s+/g, " ").trim();
  }

  // Party structure (100 bytes): personality, OT id, then 48 encrypted bytes in four 12-byte parts whose order is
  // personality % 24 (G growth, A attacks, E EVs, M misc), each word xor (personality ^ OT id).
  var ORDERS = ["GAEM","GAME","GEAM","GEMA","GMAE","GMEA","AGEM","AGME","AEGM","AEMG","AMGE","AMEG",
                "EGAM","EGMA","EAGM","EAMG","EMGA","EMAG","MGAE","MGEA","MAGE","MAEG","MEGA","MEAG"];
  function partyMon(b, at, names) {
    var pid = u32(b, at), key = (pid ^ u32(b, at + 4)) >>> 0, order = ORDERS[pid % 24];
    var grow = at + 0x20 + order.indexOf("G") * 12, misc = at + 0x20 + order.indexOf("M") * 12;
    var species = ((u32(b, grow) ^ key) >>> 0) & 0xffff;
    var egg = (((u32(b, misc + 4) ^ key) >>> 0) >>> 30) & 1;
    return { species: egg ? "Egg" : names.species(species), level: u8(b, at + 0x54), hp: u16(b, at + 0x56), maxHp: u16(b, at + 0x58) };
  }

  /** Name tables read from the ROM (addresses for this game), or "#<id>" without a ROM. */
  function romNames(rom, t) {
    function at(addr) { return addr - 0x08000000; }
    function ok(off, n) { return rom && off >= 0 && off + n <= rom.length; }
    return {
      species: function (id) { var o = at(t.species) + id * 11; return id < t.speciesCount && ok(o, 11) ? gameText(rom, o, 11) || "#" + id : "#" + id; },
      move: function (id) { var o = at(t.moves) + id * 13; return id < t.moveCount && ok(o, 13) ? gameText(rom, o, 13) || "#" + id : "#" + id; },
      place: function (id) {
        var o = at(t.places) + id * 8;
        if (!(id < t.placeCount && ok(o, 8))) return "#" + id;
        var p = at(u32(rom, o + 4));
        return ok(p, 1) ? gameText(rom, p, 24) || "#" + id : "#" + id;
      },
    };
  }

  // Keyed by the ROM's game code (header 0xAC, also at 0x1C in mGBA's state).
  var READERS = {
    // Pokemon Emerald (USA/Europe): symbols from the pokeemerald decomp's symbol file
    BPEE: {
      names: { species: 0x083185c8, speciesCount: 412, moves: 0x0831977c, moveCount: 355, places: 0x085a147c, placeCount: 213 },
      read: function (s, names) {
        var sb1 = u32(s, iw(0x03005d8c));                  // gSaveBlock1Ptr
        var cb2 = u32(s, iw(0x030022c0) + 4);              // gMain.callback2
        var inBattle = !!((u8(s, iw(0x030026f9)) >> 1) & 1); // gMain.inBattle (bit 1 of 0x439)
        var count = Math.min(6, u8(s, wr(0x020244e9)));    // gPlayerPartyCount
        var party = [];
        for (var i = 0; i < count; i++) party.push(partyMon(s, wr(0x020244ec) + i * 100, names)); // gPlayerParty
        var printing = false;                              // sTextPrinters[32], .active at 0x1B
        for (var j = 0; j < 32 && !printing; j++) printing = u8(s, wr(0x020201b0) + j * 0x24 + 0x1b) !== 0;
        var out = {
          game: "BPEE",
          screen: inBattle ? "battle" : cb2 === 0x08085e5d ? "overworld" : "other", // CB2_Overworld (thumb)
          map: isWram(sb1) ? { group: (u8(s, wr(sb1) + 4) << 24) >> 24, num: (u8(s, wr(sb1) + 5) << 24) >> 24, name: names.place(u8(s, wr(0x02037318) + 0x14)).slice(0, 40) } : undefined,
          position: isWram(sb1) ? { x: s16(s, wr(sb1)), y: s16(s, wr(sb1) + 2) } : undefined,
          party: party,
          battle: null,
          textBox: u8(s, wr(0x020375bc)) !== 0 || printing,  // sFieldMessageBoxMode, or any text printing
          controlsLocked: u8(s, iw(0x03000f2c)) !== 0,       // sLockFieldControls: a script or menu holds the field
        };
        if (inBattle) {
          var me = wr(0x02024084), foe = me + 0x58;          // gBattleMons[0] and [1]
          var moves = [];
          for (var m = 0; m < 4; m++) { var id = u16(s, me + 0x0c + m * 2); if (id) moves.push({ name: names.move(id).slice(0, 40), pp: u8(s, me + 0x24 + m) }); }
          var fs = u16(s, foe);
          out.battle = { moves: moves, foe: fs ? { species: names.species(fs).slice(0, 40), level: u8(s, foe + 0x2a), hp: u16(s, foe + 0x28), maxHp: u16(s, foe + 0x2c) } : null };
        }
        return out;
      },
    },
  };

  /** The compact state; an unknown game (or a state this can't read) gives the minimal one. */
  function readState(raw, rom) {
    var s = stateView(raw);
    if (!s || s.length < STATE_MIN) return { game: "unknown" };
    var code = latin1(s, 0x1c, 4).replace(/[^A-Z0-9]/g, "");
    var title = latin1(s, 0x10, 12).replace(/[^ -~]/g, "").trim().slice(0, 40);
    var r = READERS[code];
    if (rom && latin1(rom, 0xac, 4) !== latin1(s, 0x1c, 4)) rom = null; // names only from the game's own ROM
    if (!r) return { game: code || "unknown", title: title };
    var st = r.read(s, romNames(rom, r.names));
    for (var k in st) if (st[k] === undefined) delete st[k];
    return st;
  }

  /** "UP x4" for runs of one button. */
  function buttonsText(list) {
    if (!list.length) return "nothing";
    var out = [], i = 0;
    while (i < list.length) { var j = i; while (j < list.length && list[j] === list[i]) j++; out.push(j - i > 1 ? list[i] + " x" + (j - i) : list[i]); i = j; }
    return out.join(" ");
  }

  /**
   * opts: name, gm() (the game manager or null), shot(gm) (base64 PNG), read(gm) (compact state), post(path, body),
   * say(line), onStop(reason), wait(ms), waitFrames(gm, n), session(), and optionally holdFrames(button), gapFrames,
   * settleMs. Presses are timed in emulator frames, so a step is a step whatever speed the browser runs the game at.
   */
  function createLoop(o) {
    var running = false, gm = null, prev = null, own = false, timer = 0;
    // a direction held 14 frames walks one tile (18 walked two in the harness); a button press is 6 frames; 10 between
    var holdFrames = o.holdFrames || function (b) { return b === "UP" || b === "DOWN" || b === "LEFT" || b === "RIGHT" ? 14 : 6; };
    var gapFrames = o.gapFrames == null ? 10 : o.gapFrames, settleMs = o.settleMs == null ? 600 : o.settleMs;

    function hook(g) {
      gm = g;
      own = Object.prototype.hasOwnProperty.call(g, "simulateInput");
      var p = (prev = g.simulateInput);
      // every input of the owner's (keys, touch pad, gamepad) comes through here; the loop presses through prev directly
      g.simulateInput = function (player, index, value) {
        if (running) stop("you pressed a button");
        return p.call(g, player, index, value);
      };
    }
    function unhook() {
      if (!gm) return;
      if (own) gm.simulateInput = prev; else delete gm.simulateInput;
      for (var k in BUTTON_INDEX) { try { prev.call(gm, 0, BUTTON_INDEX[k], 0); } catch (e) {} } // nothing stays held
      gm = null; prev = null;
    }
    function stop(why) {
      if (!running) return;
      running = false;
      timer++;
      unhook();
      o.onStop(why);
    }
    async function press(buttons, my) {
      for (var i = 0; i < buttons.length && running && my === timer; i++) {
        var idx = BUTTON_INDEX[buttons[i]];
        if (idx === undefined) continue;
        var g = gm;
        prev.call(g, 0, idx, 1);
        await o.waitFrames(g, holdFrames(buttons[i]));
        if (!gm || g !== gm) return; // stopped (and maybe restarted) mid-press: the release was done by the stop
        prev.call(gm, 0, idx, 0);
        await o.waitFrames(g, gapFrames);
      }
    }
    async function run(my) {
      while (running && my === timer) {
        var shot, state, r;
        try {
          shot = await o.shot(gm);
          state = o.read(gm);
        } catch (e) {
          return stop("couldn't read the game (" + ((e && e.message) || e) + ")");
        }
        if (!running || my !== timer) return;
        try {
          r = await o.post("player/turn", { session: o.session(), screen: shot, state: state });
        } catch (e) {
          return stop(String((e && e.message) || e));
        }
        if (!running || my !== timer) return; // the owner took over while the call ran: drop the pick
        o.say(o.name + ": " + buttonsText(r.buttons) + " (" + Number(r.confidence).toFixed(2) + "): " + r.why);
        await press(r.buttons, my);
        if (!running || my !== timer) return;
        await o.wait(Math.max(settleMs, Number(r.nextInMs) || 0));
      }
    }
    return {
      get running() { return running; },
      start: function () {
        if (running) return;
        var g = o.gm();
        if (!g) { o.onStop("the game isn't running"); return; }
        running = true;
        hook(g);
        run(++timer);
      },
      stop: stop,
    };
  }

  G.gbPlayer = { readState: readState, createLoop: createLoop, BUTTON_INDEX: BUTTON_INDEX, gameText: gameText, buttonsText: buttonsText };
})();
`;
