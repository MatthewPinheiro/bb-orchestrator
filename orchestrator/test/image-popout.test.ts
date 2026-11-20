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
const mod = await importTsx<{ ImagePopout: Any; popsOut: (e: object) => boolean }>("app/image-popout.tsx");
const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the card's picture is a zoom-in anchor to the full-size image that says it opens a dialog, with the dialog closed until clicked", () => {
  const s = renderToStaticMarkup(h(mod.ImagePopout, { src: "/proof/p1", caption: "Settings page", className: "frame" }, h("img", { src: "/proof/p1", alt: "Settings page" })));
  assert.match(s, /<a [^>]*href="\/proof\/p1"/);
  assert.match(s, /data-popout=""/);
  assert.match(s, /aria-haspopup="dialog"/);
  assert.match(s, /class="cursor-zoom-in frame"/);
  assert.match(s, /<img src="\/proof\/p1" alt="Settings page"\/>/);
  assert.doesNotMatch(s, /role="dialog"/, "nothing pops out until a click");
});

test("only a plain left click pops it out; cmd, ctrl, shift, alt and middle clicks keep the browser's own new tab", () => {
  const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(mod.popsOut(base), true);
  for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) assert.equal(mod.popsOut({ ...base, [k]: true }), false, k);
  assert.equal(mod.popsOut({ ...base, button: 1 }), false, "middle click");
});

test("the dialog is Radix's (focus trap, Esc, backdrop), titled by the caption, with a close button and focus back on the picture", () => {
  const s = src("app/image-popout.tsx");
  assert.match(s, /DialogPrimitive\.Title[^>]*>\{caption/);
  assert.match(s, /DialogPrimitive\.Close/);
  assert.match(s, /onCloseAutoFocus=\{\(e\) => \{\s*e\.preventDefault\(\);\s*trigger\.current\?\.focus\(\);/);
  assert.match(s, /max-h-\[calc\(100dvh-6rem\)\][^"]*max-w-full[^"]*object-contain/, "fitted to the viewport, phone included");
  assert.match(s, /stopPropagation/, "the overlay's clicks don't reach the card under it");
});

test("every card that draws a proof image inline pops it out instead of opening bb's pane first", () => {
  const d = src("app/deliverables.tsx");
  assert.match(d, /p\.kind === "image"\)[\s\S]{0,300}<ImagePopout src=\{proofSrc\(p\.id\)\} caption=\{p\.caption\} extra=\{openLink\}/, "deliverable card, with Open ↗ to the pane in the overlay");
  const f = src("app/files.tsx");
  assert.match(f, /export function FileFull[\s\S]{0,400}<ImagePopout/, "a past deliverable's images");
  const feed = src("app/feed.tsx");
  const thumb = feed.slice(feed.indexOf("p.deliverable?.thumb ?"), feed.indexOf("p.card && p.card.options.length"));
  assert.match(thumb, /<ImagePopout src=\{proofSrc\(p\.deliverable\.thumb\)\}/, "the Home feed's screenshot");
  assert.match(thumb, /onClick=\{onOpen\} data-thumb-open=""[\s\S]*screenshot/, "the '1 of N screenshots' line still opens the post");
  assert.doesNotMatch(thumb.slice(0, thumb.indexOf("</ImagePopout>")), /onOpen/, "the picture itself doesn't open the post");
});
