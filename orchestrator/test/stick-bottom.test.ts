// Chats open at the newest message (2026-11-17, the owner: "make sure those scroll wheels just go to the bottom when you
// click away from them instead of scrolling back to the top"). Each rule of stick-bottom.ts on a made-up transcript: a
// column of messages of known heights in a box, so the scroll offsets are plain sums. Each test fails if its rule goes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SLACK, StickBottom, below, type Reader, type Scroller } from "../app/stick-bottom.ts";

/** A transcript: messages stacked top to bottom in a box `height` px tall, scrollTop clamped as a browser clamps it. */
function transcript(n: number, height = 300, each = 50) {
  const msgs = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, h: each }));
  let top = 0;
  const offset = (id: string) => {
    let y = 0;
    for (const m of msgs) {
      if (m.id === id) return y;
      y += m.h;
    }
    return null;
  };
  const box: Scroller = {
    get scrollTop() {
      return top;
    },
    set scrollTop(v: number) {
      top = Math.min(Math.max(0, v), Math.max(0, box.scrollHeight - box.clientHeight));
    },
    get scrollHeight() {
      return msgs.reduce((s, m) => s + m.h, 0);
    },
    clientHeight: height,
  };
  const reader: Reader<string> = {
    first() {
      let y = 0;
      for (const m of msgs) {
        if (y + m.h > top) return { key: m.id, top: y - top };
        y += m.h;
      }
      return null;
    },
    top: (id) => {
      const y = offset(id);
      return y === null ? null : y - top;
    },
  };
  const aways: boolean[] = [];
  const stick = new StickBottom(box, reader, (a) => aways.push(a));
  let next = n;
  return {
    box,
    stick,
    aways,
    reader,
    /** a new message at the bottom */
    add: (h = 50) => msgs.push({ id: `m${next++}`, h }),
    /** a page of older messages above */
    older: (k: number, h = 50) => msgs.unshift(...Array.from({ length: k }, (_, i) => ({ id: `old${next}-${i}`, h }))),
    /** the newest message grows (an image loads, a reply streams in): a size change with no new message */
    grow: (by: number) => (msgs[msgs.length - 1]!.h += by),
  };
}

test("it opens at the bottom, on the newest message", () => {
  const t = transcript(40);
  assert.equal(t.box.scrollTop, 0, "a fresh scroller starts at the top: what the owner saw on every switch before");
  t.stick.open();
  assert.equal(t.box.scrollTop, 40 * 50 - 300);
  assert.equal(below(t.box), 0);
});

test("opening again (a tab, project or entry switch, a reopened card) is at the bottom, wherever the owner left it", () => {
  const t = transcript(40);
  t.stick.open();
  t.box.scrollTop = 100;
  t.stick.scrolled();
  // the remount: a new scroller would be at 0; the same one reopening is where it was. Either way open() goes down
  t.stick.open();
  assert.equal(below(t.box), 0);
  assert.equal(t.stick.pinned, true);
});

test("at the bottom, a new message keeps it pinned there", () => {
  const t = transcript(40);
  t.stick.open();
  t.add();
  assert.equal(below(t.box), 50, "the message came in under the view");
  t.stick.changed();
  assert.equal(below(t.box), 0);
  assert.equal(t.stick.pinned, true);
  assert.deepEqual(t.aways, [], "no Jump to latest while at the bottom");
});

test("content that arrives after the chat opens (the host's transcript fills in late) still ends at the bottom", () => {
  const t = transcript(0);
  t.stick.open();
  for (let i = 0; i < 30; i++) t.add();
  t.stick.changed();
  assert.equal(below(t.box), 0);
});

test("our own move's scroll event, landing after growth it didn't see, doesn't unpin", () => {
  // a browser fires the scroll event of the move to the bottom before it reports a size change in the same frame: the
  // view is then above the bottom without the owner having scrolled. Only a scroll that moved up unpins.
  const t = transcript(40);
  t.stick.open();
  t.grow(120);
  t.stick.scrolled();
  assert.equal(t.stick.pinned, true, "an echo of our own scroll read as the owner scrolling up");
  t.stick.changed();
  assert.equal(below(t.box), 0);
});

test("scrolled up to read: a new message doesn't move the view, and Jump to latest shows", () => {
  const t = transcript(40);
  t.stick.open();
  t.box.scrollTop = 600;
  t.stick.scrolled();
  assert.equal(t.stick.pinned, false);
  assert.deepEqual(t.aways, [true], "Jump to latest shows once the owner scrolls up");
  const reading = t.reader.first()!;
  t.add();
  t.add();
  t.stick.changed();
  assert.equal(t.box.scrollTop, 600, "the owner was pulled down while reading");
  assert.deepEqual(t.reader.first(), reading);
});

test("a few px above the bottom still counts as the bottom", () => {
  const t = transcript(40);
  t.stick.open();
  t.box.scrollTop -= SLACK - 1;
  t.stick.scrolled();
  assert.equal(t.stick.pinned, true);
  t.box.scrollTop -= 40;
  t.stick.scrolled();
  assert.equal(t.stick.pinned, false);
});

test("scrolling back down to the bottom pins it again, and Jump to latest goes", () => {
  const t = transcript(40);
  t.stick.open();
  t.box.scrollTop = 200;
  t.stick.scrolled();
  t.box.scrollTop = t.box.scrollHeight;
  t.stick.scrolled();
  assert.equal(t.stick.pinned, true);
  assert.deepEqual(t.aways, [true, false]);
  t.add();
  t.stick.changed();
  assert.equal(below(t.box), 0);
});

test("Jump to latest goes to the newest message and follows it again", () => {
  const t = transcript(40);
  t.stick.open();
  t.box.scrollTop = 0;
  t.stick.scrolled();
  t.add();
  t.stick.changed();
  t.stick.jump();
  assert.equal(below(t.box), 0);
  assert.deepEqual(t.aways, [true, false]);
  t.add();
  t.stick.changed();
  assert.equal(below(t.box), 0);
});

test("loading older messages keeps the message being read where it was", () => {
  const t = transcript(40);
  t.stick.open();
  // the owner scrolls up to the top, where "Older messages" is, reading m2 part-way down the view
  t.box.scrollTop = 0;
  t.stick.scrolled();
  t.box.scrollTop = 120;
  t.stick.scrolled();
  const reading = t.reader.first()!;
  assert.equal(reading.key, "m2");
  t.older(30);
  t.stick.changed();
  assert.deepEqual(t.reader.first(), reading, "the older page pushed the message being read out of view");
  assert.equal(t.box.scrollTop, 120 + 30 * 50);
});

test("an older page loading while the owner is at the very top keeps the old first message in view", () => {
  const t = transcript(40);
  t.stick.open();
  t.box.scrollTop = 0;
  t.stick.scrolled();
  t.older(30);
  t.stick.changed();
  assert.equal(t.reader.top("m0"), 0, "the view jumped to the oldest message just loaded");
});

// One helper for every in-page chat: the surfaces don't scroll themselves.
const src = (f: string) => readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");

test("every chat in a pane uses the one helper, and no surface sets its own scrollTop", () => {
  const dl = src("direct-line.tsx");
  const box = dl.slice(dl.indexOf("export function ThreadBox("), dl.indexOf("function JumpToLatest("));
  assert.match(box, /useStickBottom<HTMLDivElement>\(\{ items: "\[data-timeline-items\] > \*", find: firstScroller, reset: threadId \}\)/, "the host transcript's box");
  assert.match(box, /ref=\{stick\.ref\}/);
  const pages = dl.slice(dl.indexOf("function ChatPages("), dl.indexOf("function ChatPage("));
  assert.match(pages, /useStickBottom<HTMLDivElement>\(\{ items: "\[data-chat-msg\]", reset: project\.slug \}\)/, "the direct-message log");
  assert.match(pages, /ref=\{stick\.ref\}/);
  // the 1.10.0 effect forced the bottom on every message, pulling a reader who had scrolled up back down
  for (const f of ["direct-line.tsx", "scope.tsx", "projects.tsx", "project-detail.tsx", "../app.tsx"]) assert.doesNotMatch(src(f), /\.scrollTop\s*=[^=]/, `${f} scrolls a chat by itself`);
});

test("Jump to latest is a plain 24 px target", () => {
  const dl = src("direct-line.tsx");
  // shadcn's outline button at its xs size (h-6: 24 px), and the rule that keeps it that tall in the log's column
  assert.match(dl.slice(dl.indexOf("function JumpToLatest(")), /<Button type="button" variant="outline" size="xs" className=\{JUMP\} data-jump-latest=""/);
  // it floats over the messages: solid in both themes, on bb's tokens. The outline variant's dark fill (bg-input/30) and
  // hover (bg-input/50) let the text under it through, so the dark ones are overridden (bb's .dark form, not plain dark:)
  const cls = (dl.match(/const JUMP = "([^"]+)";/) ?? [])[1] ?? "";
  for (const c of ["k-jump", "bg-background", "shadow-xs", "[&:is(.dark_*)]:bg-background", "[&:is(.dark_*)]:hover:bg-accent"]) assert.ok(cls.split(" ").includes(c), `Jump to latest lacks ${c}`);
  assert.doesNotMatch(cls, /\/\d|opacity/, "a see-through fill");
  const css = dl.split("\n").find((l) => l.startsWith("[data-orch] .orch-cc .k-jump {")) ?? "";
  assert.match(css, /height: 24px;/);
  assert.doesNotMatch(css, /border-left|inset\s+[1-9]/);
});
