// The /play page: a self-contained HTML document the Game Boy page shows in an iframe, so EmulatorJS's globals and CSS stay out
// of bb's page. It runs EmulatorJS (GPL-3) with the mGBA core from EmulatorJS's CDN at a pinned version. The ROM is the
// one the user uploaded (GET rom.gba); there is no BIOS (mGBA boots without one).
//
// Saves: EmulatorJS keeps SRAM in an IDBFS mount at /data/saves, backed by IndexedDB on this page's origin (bb's own
// origin). It writes SRAM to the file only when it flushes (`saveSaveFiles`), and never syncs IDBFS to IndexedDB, so
// the page syncs after every flush. It flushes every 30 seconds, when the browser tab is hidden, and before a ROM replace.
// Each flush that changed the save is also backed up to the server (POST save), and a new device restores the server
// copy before the game boots.
// All URLs are relative: the page lives at /api/v1/plugins/<id>/http/play, next to its routes.
//
// The AI player (core/player-page.ts, core/player.ts): with an endpoint and a key set, a "<name> plays" toggle shows in the
// bar. While it's on, the page sends the game screen and a compact state to the server, presses what comes back and
// shows "<name>: <buttons> (<confidence>): <why>" under the bar. Any key, touch or gamepad input of the owner's, the
// toggle, a hidden tab, an error or a cap stops it, and the line says why.
//
// Cheats (core/cheats-page.ts): EmulatorJS's Cheats menu, hooked so that a cheat is on exactly while its box is ticked.

import { CHEATS_JS } from "./cheats-page.ts";
import { PLAYER_JS } from "./player-page.ts";

export const EJS_VERSION = "4.2.3";
export const EJS_DATA = `https://cdn.emulatorjs.org/${EJS_VERSION}/data/`;

export function playHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game Boy</title>
<style>
  html, body { margin: 0; height: 100%; background: #0f0f12; color: #d6d6dc; font: 13px/1.4 system-ui, sans-serif; }
  body { display: flex; flex-direction: column; overflow: hidden; }
  #bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; min-height: 28px; flex: none; }
  #name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .75; }
  #status { opacity: .7; white-space: nowrap; }
  #aiwrap { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; }
  #aiwrap[hidden] { display: none; }
  #ailine { flex: none; padding: 0 10px 4px; min-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .9; }
  body.ai #game { width: min(100%, calc((100vh - 62px) * 1.5)); }
  button { font: inherit; color: inherit; background: #26262d; border: 1px solid #3a3a44; border-radius: 6px; padding: 3px 10px; cursor: pointer; }
  button:hover { background: #30303a; }
  #pick { padding: 32px 16px; text-align: center; }
  #pick p { margin: 0 0 14px; opacity: .8; }
  #wrap { flex: 1; min-height: 0; display: flex; align-items: flex-start; justify-content: center; }
  /* the GBA screen is 240x160: fill the pane's width at 3:2, never taller than the space left */
  #game { width: min(100%, calc((100vh - 40px) * 1.5)); aspect-ratio: 3 / 2; height: auto !important; }
  /* A phone held upright: EmulatorJS's touch gamepad is drawn over the bottom of #game, and in bb's phone layout the pane is
     short (458px on a 390x664 phone), too short for its default 330px-tall layout. So #game takes the whole pane, the screen
     sits at its top (3:2, full width unless the pane is shorter still), and the gamepad is one 140px band at the bottom:
     the D-pad left, A/B right, and a middle column of L R / Select Start / Fast Slow. Its own elements, moved with CSS
     (their offsets are inline, hence !important); L/R/Select/Start grow from 31px to 44px. Landscape and desktop are unchanged. */
  @media (pointer: coarse) and (orientation: portrait) {
    #wrap { align-items: stretch; }
    #game { width: 100%; aspect-ratio: auto; }
    #game .ejs_canvas { display: block; width: min(100%, calc((100vh - 40px - 150px) * 1.5)); height: auto; aspect-ratio: 3 / 2; margin: 0 auto; }
    body.ai #game .ejs_canvas { width: min(100%, calc((100vh - 62px - 150px) * 1.5)); } /* the AI line's row */
    #game .ejs_virtualGamepad_parent { bottom: 0; }
    #game .ejs_virtualGamepad_left { left: 6px; bottom: 15px; }
    #game .ejs_virtualGamepad_right { right: 6px; bottom: 10px; }
    #game .ejs_virtualGamepad_bottom { bottom: 10px; width: 108px; height: 130px; margin-left: -54px; }
    #game .ejs_virtualGamepad_button:is(.b_l, .b_r, .b_select, .b_start) { height: 44px !important; line-height: 44px !important; }
    #game .ejs_virtualGamepad_button.b_l { left: calc(50vw - 60px) !important; top: 0 !important; }
    #game .ejs_virtualGamepad_button.b_r { right: calc(50vw - 60px) !important; top: 0 !important; }
    #game .ejs_virtualGamepad_button:is(.b_select, .b_speed_fast) { left: 0 !important; }
    #game .ejs_virtualGamepad_button:is(.b_start, .b_speed_slow) { left: 58px !important; }
    #game .ejs_virtualGamepad_button:is(.b_select, .b_start) { top: 50px !important; }
    #game .ejs_virtualGamepad_button:is(.b_speed_fast, .b_speed_slow) { top: 99px !important; }
  }
  /* Fast on the touch gamepad is a toggle (see the script): lit while fast-forward is on */
  #game .ejs_virtualGamepad_button.b_speed_fast.gb-on { background-color: #3b6ea5; border-color: #9cc0e8; color: #fff; }
</style>
</head>
<body>
<div id="bar"><span id="name"></span><span id="status"></span><label id="aiwrap" hidden><input type="checkbox" id="ai"><span id="ainame"></span></label><button id="replace" hidden>Replace ROM</button></div>
<div id="ailine" hidden></div>
<div id="pick" hidden>
  <p>Upload your own .gba ROM once. It is stored on this bb server, and saves follow it.</p>
  <button id="choose">Choose a .gba file</button>
</div>
<div id="wrap"><div id="game"></div></div>
<input type="file" id="file" accept=".gba" hidden>
<script>${PLAYER_JS}</script>
<script>${CHEATS_JS}</script>
<script>
(() => {
  const MAX = ${32 * 1024 * 1024};
  const $ = (id) => document.getElementById(id);
  const say = (t) => { $("status").textContent = t; };

  const b64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error((j.error && (j.error.message || j.error)) || "HTTP " + r.status);
    return j.result;
  }

  // ---- the ROM picker (first upload and Replace ROM)
  $("choose").onclick = $("replace").onclick = () => $("file").click();
  $("file").onchange = async () => {
    const f = $("file").files[0];
    $("file").value = "";
    if (!f) return;
    if (!/\\.gba$/i.test(f.name)) return say("Only a .gba file");
    if (f.size > MAX) return say("Over 32 MB");
    try {
      await backupNow(); // keep the current game's save before the page reloads
      say("Uploading…");
      await post("rom", { name: f.name, data: b64(new Uint8Array(await f.arrayBuffer())) });
      location.reload();
    } catch (e) {
      say("Upload failed: " + e.message);
    }
  };

  // ---- saves: state shared by the hooks below
  let ejs = null;          // window.EJS_emulator once EmulatorJS creates it
  let sha = null;          // the ROM's sha256; saves are kept per ROM
  let restored = false;    // the server copy was applied or judged older; until then nothing is uploaded
  let backupOff = false;   // the server copy couldn't be read: never overwrite it from here
  let lastSent = null;     // base64 of the save the server holds (or that this page restored)
  let silent = false;      // a flush the parent is backing up itself
  const seenKey = () => "gameboy:save-seen:" + sha;

  async function upload(bytes) {
    if (!restored || backupOff || !bytes || !bytes.length) return;
    const data = b64(bytes);
    if (data === lastSent) return;
    const r = await post("save", { rom: sha, data });
    lastSent = data;
    try { localStorage.setItem(seenKey(), String(r.updatedAt)); } catch {}
    say("Saved " + new Date(r.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }
  function persist(FS) {
    FS.syncfs(false, (err) => { if (err) console.warn("gameboy: saving to IndexedDB failed: errno " + err.errno + " " + (err.stack || "").split("\\n").slice(0, 4).join(" | ")); });
  }
  function flush() {
    // writes SRAM to /data/saves (IDBFS, autoPersist) and fires "saveSaveFiles" with the bytes
    if (ejs && ejs.started && ejs.gameManager) ejs.gameManager.saveSaveFiles();
  }
  async function backupNow() {
    if (!(ejs && ejs.started && ejs.gameManager)) return;
    silent = true;
    try { ejs.gameManager.saveSaveFiles(); } finally { silent = false; }
    await upload(ejs.gameManager.getSaveFile(false));
  }
  // bb unmounts the Game Boy page when its pane navigates away, which destroys this iframe. The page calls this
  // synchronously while it unmounts: it flushes SRAM and hands back the save (to back up from bb's page, which outlives
  // the iframe) and a save state, which the next iframe loads at start so the game carries on where it was. The seen
  // mark is left alone: this browser's IndexedDB may not have the bytes yet, so the next load prefers the server copy.
  window.gameboySuspend = () => {
    if (player) player.stop("the page closed");
    if (!(ejs && ejs.started && ejs.gameManager)) return null;
    const gm = ejs.gameManager;
    let state = null;
    try { state = gm.getState().slice(); } catch (e) { console.warn("gameboy: no save state", e); }
    silent = true;
    try { gm.saveSaveFiles(); } finally { silent = false; }
    let save = null;
    const bytes = gm.getSaveFile(false);
    if (restored && !backupOff && bytes && bytes.length) {
      const data = b64(bytes);
      if (data !== lastSent) {
        lastSent = data;
        save = data;
      }
    }
    return { rom: sha, save, state };
  };
  window.gameboyResume = (state) => {
    if (!(ejs && ejs.started && ejs.gameManager) || !state) return;
    ejs.gameManager.loadState(state);
    console.info("gameboy: resumed from the suspended state");
  };

  // ---- pause while the browser tab or app window is hidden (bb unmounts the page when its pane navigates away)
  let pausedByUs = false;
  function applyVisibility() {
    const hidden = document.visibilityState === "hidden";
    if (hidden && player) player.stop("the tab was hidden");
    if (!(ejs && ejs.started)) return;
    if (hidden && !ejs.paused) {
      ejs.pause();
      pausedByUs = true;
      flush();
    } else if (!hidden && pausedByUs) {
      pausedByUs = false;
      if (ejs.paused) ejs.play();
    }
  }
  document.addEventListener("visibilitychange", applyVisibility);

  // ---- Fast on the touch gamepad: one tap turns fast-forward on, the next turns it off (EmulatorJS makes it
  // hold-to-use, and its gamepad options can't change a button's handler). A capture listener on #game, EmulatorJS's
  // parent element, keeps the touch from reaching the button's own handler and flips EmulatorJS's "fastForward" setting
  // instead, the one its Speed Options menu sets. startup=true keeps it out of the settings EmulatorJS stores, so each
  // load starts at normal speed. The button is lit from ejs.isFastForward, so it also shows a speed set from that menu.
  function syncFast() {
    const b = document.querySelector("#game .b_speed_fast");
    if (b && ejs) b.classList.toggle("gb-on", !!ejs.isFastForward);
  }
  function onFastTouch(e) {
    if (!(e.target instanceof Element && e.target.closest(".b_speed_fast")) || !(ejs && ejs.started)) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.type !== "touchstart") return;
    ejs.changeSettingOption("fastForward", ejs.isFastForward ? "disabled" : "enabled", true);
    syncFast();
  }
  for (const t of ["touchstart", "touchend", "touchcancel"]) $("game").addEventListener(t, onFastTouch, { capture: true, passive: false });

  // ---- the AI player: the toggle, the line, and what the loop reads and presses (core/player-page.ts)
  let player = null;       // gbPlayer.createLoop's loop, made on the first toggle
  let romBlob = null;      // the ROM, for the state reader's name tables
  let romBytes = null;     // its bytes, also what undoes a cheat's ROM patches (read before boot)
  let aiName = "AI";
  let aiSession = "";
  const aiLine = (t) => {
    $("ailine").textContent = t;
    $("ailine").hidden = !t;
    document.body.classList.toggle("ai", !!t);
  };
  const aiPressed = (on) => { $("ai").checked = on; };
  const timeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(what)), ms))]);
  // the game's own screen (EmulatorJS's screenshot: the core's frame, nothing of the page), scaled up by whole pixels to
  // at least 280 px a side, since vision models commonly refuse smaller images
  async function aiShot(gm) {
    const png = await timeout(gm.screenshot(), 3000, "no screenshot");
    const bmp = await createImageBitmap(new Blob([png], { type: "image/png" }));
    const k = Math.max(2, Math.ceil(280 / Math.min(bmp.width, bmp.height)));
    const c = document.createElement("canvas");
    c.width = bmp.width * k;
    c.height = bmp.height * k;
    const x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    x.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
    return b64(new Uint8Array(await blob.arrayBuffer()));
  }
  function aiLoop() {
    return gbPlayer.createLoop({
      name: aiName,
      gm: () => (ejs && ejs.started && ejs.gameManager) || null,
      shot: aiShot,
      read: (gm) => gbPlayer.readState(gm.getState(), romBytes),
      post,
      say: aiLine,
      onStop: (why) => { aiPressed(false); aiLine(aiName + " stopped: " + why); },
      wait: (ms) => new Promise((ok) => setTimeout(ok, ms)),
      // n emulator frames (at most 100 ms a frame, so a paused game can't hold a button forever)
      waitFrames: (gm, n) => new Promise((ok) => {
        const start = gm.getFrameNum(), until = Date.now() + n * 100;
        const tick = () => (gm.getFrameNum() - start >= n || Date.now() > until ? ok() : setTimeout(tick, 8));
        tick();
      }),
      session: () => aiSession,
    });
  }
  $("ai").onchange = async () => {
    if (!$("ai").checked) return player && player.stop("you turned it off");
    if (!(ejs && ejs.started && ejs.gameManager)) { aiPressed(false); return aiLine(aiName + ": the game isn't running yet"); }
    try {
      if (!romBytes && romBlob) romBytes = new Uint8Array(await romBlob.arrayBuffer());
    } catch {}
    aiSession = crypto.randomUUID();
    player = player || aiLoop();
    aiPressed(true);
    aiLine(aiName + " is looking at the screen…");
    player.start();
  };
  // any input of the owner's stops it: keys anywhere on the page, a touch or click on the game (the gamepad and the touch
  // pad also reach the loop's own hook on simulateInput)
  // (Space on the focused toggle is the toggle's own: its change event turns the player off)
  document.addEventListener("keydown", (e) => { if (player && player.running && !(e.target === $("ai") && e.key === " ")) player.stop("you pressed a key"); }, true);
  for (const t of ["pointerdown", "touchstart"]) $("game").addEventListener(t, () => { if (player && player.running) player.stop("you touched the game"); }, { capture: true, passive: true });
  async function aiSetup() {
    try {
      const i = await (await fetch("player/info", { cache: "no-store" })).json();
      if (!i.ready) return; // not set up: no toggle (the turn route answers with what to set)
      aiName = i.name;
      $("ainame").textContent = aiName + " plays";
      $("aiwrap").hidden = false;
    } catch {}
  }

  // ---- boot
  async function main() {
    const info = await (await fetch("rom/info", { cache: "no-store" })).json();
    if (!info.rom) {
      $("pick").hidden = false;
      return;
    }
    sha = info.rom.sha256;
    $("name").textContent = info.rom.name;
    $("replace").hidden = false;
    say("Loading…");
    const romRes = await fetch("rom.gba?v=" + sha);
    if (!romRes.ok) throw new Error("ROM download failed (HTTP " + romRes.status + ")");
    const rom = await romRes.blob();
    romBlob = rom;
    romBytes = new Uint8Array(await rom.arrayBuffer());
    aiSetup();

    // the server's save for this ROM, read before boot so it can be written before the core loads the game
    let serverSave = null;
    if (info.save) {
      try {
        const r = await fetch("save?rom=" + sha, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        serverSave = { bytes: new Uint8Array(await r.arrayBuffer()), updatedAt: info.save.updatedAt };
      } catch (e) {
        backupOff = true;
        console.warn("gameboy: server save unreadable, backup off for this session", e);
      }
    }

    const base = sha.slice(0, 16);
    // RetroArch sorts saves by core: /data/saves/mGBA/<game>.srm (checked against the core's own path at start)
    const saveDir = "/data/saves/mGBA";
    const savePath = saveDir + "/" + base + ".srm";
    const onDatabase = (FS) => {
      // FS is mounted (IDBFS synced in) and the game isn't loaded yet
      try {
        const local = FS.analyzePath(savePath).exists ? FS.readFile(savePath) : null;
        console.info("gameboy: local save " + (local ? "present" : "absent") + " at boot");
        let seen = 0;
        try { seen = Number(localStorage.getItem(seenKey()) || 0); } catch {}
        if (serverSave && (!local || serverSave.updatedAt > seen)) {
          if (!FS.analyzePath(saveDir).exists) FS.mkdir(saveDir);
          FS.writeFile(savePath, serverSave.bytes);
          persist(FS);
          try { localStorage.setItem(seenKey(), String(serverSave.updatedAt)); } catch {}
          lastSent = b64(serverSave.bytes);
          console.info("gameboy: restored the server save");
        } else if (serverSave && local) {
          lastSent = b64(serverSave.bytes);
        }
        restored = true;
      } catch (e) {
        backupOff = true;
        console.warn("gameboy: restore failed, backup off for this session", e);
      }
    };

    Object.defineProperty(window, "EJS_emulator", {
      configurable: true,
      get: () => ejs,
      set: (v) => {
        ejs = v;
        gbCheats.hook(v, { rom: () => romBytes });
        // Registered before EmulatorJS's own exit handler (unload), which flushes and then unmounts /data/saves. With
        // IDBFS autoPersist the unmount syncs an empty tree and deletes the save from IndexedDB (EmulatorJS 4.2.3), so
        // the save would never survive a reload. Keep the mount (the page is going away anyway), so the unload flush's
        // own sync can still store the latest save.
        v.on("exit", () => {
          if (v.gameManager && v.gameManager.FS) v.gameManager.FS.unmount = () => {};
        });
        v.on("saveDatabaseLoaded", onDatabase);
        v.on("saveSaveFiles", (bytes) => {
          // EmulatorJS writes the file but leaves IDBFS's sync to IndexedDB commented out: do it here, on every flush
          persist(v.gameManager.FS);
          if (!silent) upload(bytes).catch((e) => say("Backup failed: " + e.message));
        });
        v.on("start", () => {
          say("");
          const actual = v.gameManager.getSaveFilePath();
          if (actual !== savePath) {
            // the restore wrote to the wrong file: don't let this session's save overwrite the server copy
            backupOff = true;
            console.warn("gameboy: save path is " + actual + ", expected " + savePath + "; backup off");
            say("Save backup off");
          }
          applyVisibility();
          syncFast();
          // the page answers with the state it kept when the previous iframe went away, if it was this ROM
          if (window.parent !== window) window.parent.postMessage({ type: "gameboy:started", rom: sha }, location.origin);
        });
      },
    });

    Object.assign(window, {
      EJS_player: "#game",
      EJS_core: "gba",
      EJS_gameUrl: URL.createObjectURL(rom),
      EJS_gameName: base + ".gba", // the file name the core sees: per ROM, so saves are per ROM
      EJS_pathtodata: ${JSON.stringify(EJS_DATA)},
      EJS_startOnLoaded: true,
      EJS_noAutoFocus: true,   // never steal focus from bb's composer; a click on the game focuses it
      EJS_language: "en-US",
      EJS_disableAutoLang: false,
      EJS_color: "#3b6ea5",
      EJS_defaultOptions: { "save-save-interval": "30" },
    });
    // keyboard input goes to the emulator's element once the game is clicked
    $("game").addEventListener("pointerdown", () => {
      const el = ejs && ejs.elements && ejs.elements.parent;
      if (el && document.activeElement !== el) el.focus();
    });
    const s = document.createElement("script");
    s.src = ${JSON.stringify(EJS_DATA + "loader.js")};
    s.onerror = () => say("Couldn't load EmulatorJS from its CDN");
    document.body.appendChild(s);
  }
  main().catch((e) => say(String(e.message || e)));
})();
</script>
</body>
</html>
`;
}
