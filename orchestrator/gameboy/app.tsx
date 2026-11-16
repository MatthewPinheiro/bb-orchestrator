// The Orchestrator's Game Boy tab (it was its own plugin's page until 2026-11-13), so it splits beside any other tab. The
// tab is an iframe on the /gameboy/play route (core/page.ts), which runs EmulatorJS; the iframe keeps EmulatorJS's
// globals and CSS out of bb's page. The ROM and its saves are per user (server files), never per thread.
import { useLayoutEffect, useRef } from "react";
import { PLUGIN_ID } from "../contract.ts";

const BASE = `/api/v1/plugins/${PLUGIN_ID}/http/gameboy`;

type Suspended = { rom: string; save: string | null; state: Uint8Array | null } | null;
type GameWindow = Window & { gameboySuspend?: () => Suspended; gameboyResume?: (state: Uint8Array) => void };

// The tab unmounts when its pane shows another tab (or bb navigates away), which destroys the iframe and the running game. The
// game's state is kept here (module scope outlives the component) and loaded by the next iframe of the same ROM.
let kept: { rom: string; state: Uint8Array } | null = null;

export function GameView() {
  const frame = useRef<HTMLIFrameElement>(null);

  // a layout effect: its cleanup runs before React removes the iframe, while the game is still alive
  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow as GameWindow | null | undefined;
      if (!win || e.source !== win || e.origin !== window.location.origin) return;
      if (e.data?.type === "gameboy:started" && kept && kept.rom === e.data.rom) {
        win.gameboyResume?.(kept.state);
        kept = null;
      }
    };
    window.addEventListener("message", onMessage);
    const el = frame.current;
    return () => {
      window.removeEventListener("message", onMessage);
      let s: Suspended = null;
      try {
        s = (el?.contentWindow as GameWindow | null)?.gameboySuspend?.() ?? null;
      } catch {
        // not loaded yet
      }
      if (!s) return;
      if (s.state) kept = { rom: s.rom, state: new Uint8Array(s.state) }; // a copy in this realm: the iframe's is going away
      // back up the save from bb's page, which outlives the iframe
      if (s.save) {
        void fetch(`${BASE}/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rom: s.rom, data: s.save }) }).catch(() => {});
      }
    };
  }, []);

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, height: "100%", width: "100%" }}>
      <iframe ref={frame} src={`${BASE}/play`} title="Game Boy" allow="gamepad; fullscreen; autoplay" style={{ display: "block", flex: 1, width: "100%", height: "100%", border: 0 }} />
    </div>
  );
}
