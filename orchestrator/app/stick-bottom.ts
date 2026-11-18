// Every in-page chat opens at its newest message and stays there (2026-11-17, the owner: "make sure those scroll wheels
// just go to the bottom when you click away from them instead of scrolling back to the top"). One helper for each chat
// or log drawn in a pane: the direct-message log and the host's transcript in the Projects and Scope chat cards
// (direct-line.tsx). Each one opens, and opens again after a tab, project or entry switch or a collapsed card reopening,
// at the bottom; while the owner is there a new message keeps it there; once they scroll up to read nothing pulls them
// down, and "Jump to latest" shows; older messages loading above keep the message they were reading where it was.
// The rules (StickBottom) know nothing of the DOM, so node --test checks the code that ships; useStickBottom wires them
// to whatever element scrolls (a div of ours, the host's unmarked scroller, a ScrollArea's viewport later), without JSX.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** What scrolls: an element's scroll box, or a stand-in in the tests. */
export type Scroller = { scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number };
/** The message being read: one of the chat's messages, and its top edge's offset from the scroller's top edge. */
export type Anchor<K> = { key: K; top: number };
/** Where the messages are: the first one in view (its bottom below the scroller's top), and where one is now (null: gone). */
export type Reader<K> = { first(): Anchor<K> | null; top(key: K): number | null };

/** Px from the bottom that still count as at the bottom (a fractional scrollTop, a hairline). */
export const SLACK = 8;
/** How far the view is above the bottom. */
export const below = (s: Scroller) => s.scrollHeight - s.clientHeight - s.scrollTop;

/**
 * One chat's scroll rules. `pinned`: the owner is at the newest message, so growth keeps them there. Only a scroll that
 * moved up unpins: a browser dispatches the scroll event of our own move to the bottom before it reports a size change
 * in the same frame, so "not at the bottom" alone would unpin on growth that came without a DOM change (an image, a font).
 * Unpinned, a change keeps the anchor message at its offset, measured before and after (never the height difference: it
 * is the same whether the growth is above or below the reader).
 */
export class StickBottom<K> {
  pinned = true;
  private last = 0;
  private anchor: Anchor<K> | null = null;
  private readonly s: Scroller;
  private readonly r: Reader<K>;
  private readonly onAway: (away: boolean) => void;
  constructor(s: Scroller, r: Reader<K>, onAway: (away: boolean) => void = () => {}) {
    this.s = s;
    this.r = r;
    this.onAway = onAway;
  }
  /** Opening (a mount, a switch back, a reopened card): at the newest message. */
  open() {
    this.pin(true);
    this.bottom();
  }
  /** A scroll event: the owner's, or the echo of one of ours. */
  scrolled() {
    const top = this.s.scrollTop;
    if (below(this.s) <= SLACK) this.pin(true);
    else if (top < this.last) this.pin(false);
    this.last = top;
    this.anchor = this.pinned ? null : this.r.first();
  }
  /** The content or the box changed size: a message came, a page of older ones loaded, the card was resized. */
  changed() {
    if (this.pinned) return this.bottom();
    const a = this.anchor;
    const now = a ? this.r.top(a.key) : null;
    if (a && now !== null && now !== a.top) this.s.scrollTop += now - a.top;
    this.last = this.s.scrollTop;
    this.anchor = this.r.first();
  }
  /** "Jump to latest". */
  jump() {
    this.pin(true);
    this.bottom();
  }
  private bottom() {
    this.s.scrollTop = Math.max(0, this.s.scrollHeight - this.s.clientHeight);
    this.last = this.s.scrollTop;
  }
  private pin(on: boolean) {
    if (this.pinned !== on) this.onAway(!on);
    this.pinned = on;
  }
}

/** The DOM reader: `items` are the chat's messages, in order; offsets from the scroller's top edge. */
function domReader(el: HTMLElement, items: string): Reader<Element> {
  return {
    first() {
      const edge = el.getBoundingClientRect().top;
      for (const m of Array.from(el.querySelectorAll(items))) {
        const r = m.getBoundingClientRect();
        if (r.bottom > edge) return { key: m, top: r.top - edge };
      }
      return null;
    },
    top: (m) => (m.isConnected && el.contains(m) ? m.getBoundingClientRect().top - el.getBoundingClientRect().top : null),
  };
}

/**
 * The first element under `root`, in document order, that scrolls vertically: the host transcript's own scroller, which
 * carries no hook of ours (a code block deeper in it scrolls too, and comes later).
 */
export function firstScroller(root: HTMLElement): HTMLElement | null {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (/(auto|scroll)/.test(getComputedStyle(n as Element).overflowY)) return n as HTMLElement;
  return null;
}

/**
 * The hook. `ref` goes on the chat's root; `find` says which element under it scrolls (default: the root itself), and is
 * asked again whenever the one found leaves the DOM (the host drew a new one). `items` selects the messages. `reset`: a
 * new value (another thread) opens at the bottom again. The browser's own scroll anchoring is turned off on the scroller,
 * so a load of older messages is corrected once, by these rules.
 */
export function useStickBottom<T extends HTMLElement>({ items, find, reset }: { items: string; find?: (root: HTMLElement) => HTMLElement | null; reset?: unknown }): { ref: RefObject<T | null>; away: boolean; jump: () => void } {
  const ref = useRef<T>(null);
  const [away, setAway] = useState(false);
  const ctl = useRef<StickBottom<Element> | null>(null);
  const findRef = useRef(find);
  findRef.current = find;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let el: HTMLElement | null = null;
    let undo = () => {};
    const sizes = new ResizeObserver(() => ctl.current?.changed());
    const onScroll = () => ctl.current?.scrolled();
    const resolve = () => {
      if (el && root.contains(el)) return;
      undo();
      el = findRef.current ? findRef.current(root) : root;
      if (!el) return;
      const s = el;
      const anchoring = s.style.overflowAnchor;
      s.style.overflowAnchor = "none";
      s.addEventListener("scroll", onScroll, { passive: true });
      sizes.observe(s);
      undo = () => {
        s.removeEventListener("scroll", onScroll);
        s.style.overflowAnchor = anchoring;
        sizes.disconnect();
        ctl.current = null;
        el = null;
        // the next scroller opens pinned: a Jump to latest left from this one would never clear
        setAway(false);
      };
      ctl.current = new StickBottom<Element>(s, domReader(s, items), setAway);
      ctl.current.open();
    };
    // the content's own size: each direct child of the scroller (a message's height can change without a DOM change)
    const watchChildren = () => {
      if (el) for (const c of Array.from(el.children)) sizes.observe(c);
    };
    resolve();
    watchChildren();
    const dom = new MutationObserver(() => {
      resolve();
      watchChildren();
      ctl.current?.changed();
    });
    dom.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      dom.disconnect();
      undo();
      setAway(false);
    };
  }, [items, reset]);
  const jump = useCallback(() => ctl.current?.jump(), []);
  return { ref, away, jump };
}
