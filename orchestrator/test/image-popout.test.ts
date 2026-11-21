// An image in a card pops out full-size on one click (2026-11-20, the owner: no side panel step first). What matters: the
// picture is an anchor whose plain click opens the in-page dialog (not bb's file preview pane), a modifier or middle click
// keeps the browser's own behaviour on the full-size href, and every card that draws a proof image inline uses it: the
// deliverable card, a past deliverable's files, and the Home feed's screenshot (whose line under it still opens the post).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { createElement as h, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanTsx, importTsx } from "./tsx-render.ts";

after(cleanTsx);

type Any = ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mod = await importTsx<{ ImagePopout: Any; popsOut: (e: object) => boolean; swipedDown: (dx: number, dy: number) => boolean }>("app/image-popout.tsx");
const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the card's picture is a zoom-in anchor to the full-size image that says it opens a dialog, with the dialog closed until clicked", () => {
  const s = renderToStaticMarkup(h(mod.ImagePopout, { src: "/proof/p1", caption: "Settings page", className: "frame" }, h("img", { src: "/proof/p1", alt: "Settings page" })));
  assert.match(s, /<a [^>]*href="\/proof\/p1"/);
  assert.match(s, /data-popout=""/);
  assert.match(s, /aria-haspopup="dialog"/);
  assert.match(s, /class="cursor-zoom-in \[-webkit-touch-callout:none\] frame"/, "no iOS image callout on a long-press: the menu shows instead");
  assert.match(s, /<img src="\/proof\/p1" alt="Settings page"\/>/);
  assert.doesNotMatch(s, /role="dialog"/, "nothing pops out until a click");
});

test("only a plain left click pops it out; cmd, ctrl, shift, alt and middle clicks keep the browser's own new tab", () => {
  const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(mod.popsOut(base), true);
  for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) assert.equal(mod.popsOut({ ...base, [k]: true }), false, k);
  assert.equal(mod.popsOut({ ...base, button: 1 }), false, "middle click");
});

test("the dialog is Radix's (focus trap, Esc, backdrop), titled by the caption, with focus back on the picture and no Open link", () => {
  const s = src("app/image-popout.tsx");
  assert.match(s, /DialogPrimitive\.Title[^>]*>\{caption/);
  assert.match(s, /onCloseAutoFocus=\{\(e\) => \{\s*e\.preventDefault\(\);\s*trigger\.current\?\.focus\(\);/);
  assert.match(s, /stopPropagation/, "the overlay's clicks don't reach the card under it");
  assert.doesNotMatch(s, /\{extra\}|>\s*Open ↗/, "the overlay has no Open link (2026-11-21); the right-click menu replaces it");
});

test("a tall picture never traps you: it fits the screen, the close button floats top-right in the safe area at 44 px, a tap or a swipe down closes it", () => {
  const s = src("app/image-popout.tsx");
  assert.match(s, /data-popout-frame="" className="[^"]*\bmin-h-0\b[^"]*\bflex-1\b/, "the picture's box is what's left above the caption");
  assert.match(s, /data-popout-image=""[\s\S]{0,200}className="[^"]*\bmax-h-full max-w-full\b[^"]*\bobject-contain\b/);
  const close = s.slice(s.indexOf("<DialogPrimitive.Close"), s.indexOf("</DialogPrimitive.Close>"));
  assert.match(close, /\bfixed\b/);
  assert.match(close, /top-\[max\(0\.5rem,env\(safe-area-inset-top\)\)\]/);
  assert.match(close, /right-\[max\(0\.5rem,env\(safe-area-inset-right\)\)\]/);
  assert.match(close, /\bsize-11\b/, "44 px tap target");
  assert.match(s, /onClick=\{\(\) => \(touchOnly\(\) \? setOpen\(false\)/, "a tap on the picture closes it on a touch screen");
  assert.equal(mod.swipedDown(0, 120), true);
  assert.equal(mod.swipedDown(10, 40), false, "too short");
  assert.equal(mod.swipedDown(150, 100), false, "more sideways than down");
  assert.equal(mod.swipedDown(0, -200), false, "up");
});

test("a right-click (long-press on touch) on the picture, in the card and in the overlay, offers the side panel and a new tab", () => {
  const s = src("app/image-popout.tsx");
  assert.match(s, /ContextMenu as MenuPrimitive/, "Radix's ContextMenu from radix-ui, already a dependency");
  assert.equal((s.match(/<ImageMenu /g) ?? []).length, 2, "on the card's picture and the overlay's");
  assert.match(s, />\s*Open in side panel\s*</);
  assert.match(s, />\s*Open in new tab\s*</);
  assert.match(s, /if \(sidePanel\(\)\) onPicked\?\.\(\);\s*else window\.open\(src/, "bb declining the pane falls back to a new tab");
});

test("every card that draws a proof image inline pops it out instead of opening bb's pane first", () => {
  const d = src("app/deliverables.tsx");
  assert.match(d, /p\.kind === "image"\)[\s\S]{0,300}<ImagePopout src=\{proofSrc\(p\.id\)\} caption=\{p\.caption\} sidePanel=\{\(\) => openInBb\(navigate, p\)\}/, "deliverable card, its side panel through bb's pane");
  const f = src("app/files.tsx");
  assert.match(f, /export function FileFull[\s\S]{0,500}<ImagePopout[\s\S]{0,200}sidePanel=\{\(\) => openInBb\(navigate, openable\(f, host\)\)\}/, "a past deliverable's images");
  const feed = src("app/feed.tsx");
  const thumb = feed.slice(feed.indexOf("p.deliverable?.thumb ?"), feed.indexOf("p.card && p.card.options.length"));
  assert.match(thumb, /<ImagePopout src=\{proofSrc\(p\.deliverable\.thumb\)\}[^>]*sidePanel=\{p\.deliverable\.thumbFile \? \(\) => openInBb\(navigate, p\.deliverable!\.thumbFile!\)/, "the Home feed's screenshot, its side panel by the file's host and path");
  assert.match(thumb, /onClick=\{onOpen\} data-thumb-open=""[\s\S]*screenshot/, "the '1 of N screenshots' line still opens the post");
  assert.doesNotMatch(thumb.slice(0, thumb.indexOf("</ImagePopout>")), /onOpen/, "the picture itself doesn't open the post");
});
