// What the keyboard shortcuts keep between key presses (module level, like store.ts: a tab switch loses nothing), and the
// views' handlers. app.tsx owns the one listener; each view registers what J/K/1-4/Enter/O/A mean in it.
import { useSyncExternalStore } from "react";
import type { Action, Arm } from "./keys.ts";

type Slice = { id: string | null; index: number };
export const keyState = {
  /** The selected card in Needs you and in Deliverables (each remembers its slot, so an answered card's slot is next). */
  sel: { "needs-you": { id: null, index: 0 }, deliverables: { id: null, index: 0 } } as Record<string, Slice>,
  /** Needs you: card id → the answer picked with a number key, waiting for Enter. */
  picked: new Map<string, string>(),
  arm: null as Arm,
  /** The line shown at the bottom of the page: the A hint, or why a key did nothing. */
  note: null as string | null,
  help: false,
};

let version = 0;
const listeners = new Set<() => void>();
export function emitKeys() {
  version++;
  for (const l of listeners) l();
}
export function useKeys(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => version,
  );
}

/** A view's answer to an action; true when it acted (the key is then swallowed). */
export type KeyHandler = (a: Action) => boolean;
const handlers = new Map<string, KeyHandler>();
export function registerKeys(view: string, h: KeyHandler): () => void {
  handlers.set(view, h);
  return () => {
    if (handlers.get(view) === h) handlers.delete(view);
  };
}
export const handlerFor = (view: string | undefined): KeyHandler | undefined => (view ? handlers.get(view) : undefined);

let noteTimer: ReturnType<typeof setTimeout> | undefined;
/** Say something at the bottom of the page for `ms`. */
export function say(text: string, ms = 2500) {
  keyState.note = text;
  emitKeys();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    keyState.note = null;
    emitKeys();
  }, ms);
}
