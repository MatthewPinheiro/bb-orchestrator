// An image in a card pops out full-size on one click (2026-11-20, the owner: one click on the screenshot itself, no side
// panel step first). A plain click opens a Radix Dialog (dialog role, focus trapped, Esc / backdrop / close button close
// it, focus goes back to the image) with the picture fitted inside the screen and its caption; a cmd, ctrl, shift or
// middle click keeps the browser's own behaviour on the anchor's href. 2026-11-21 (the owner, after trying it): no
// "Open ↗" in the overlay; a right-click (a long-press on touch) on the picture, in the card or the overlay, offers
// "Open in side panel" (bb's pane, docked beside the chat) and "Open in new tab". A tall picture never traps you on a
// phone: it fits the screen, the close button floats top-right inside the safe area, and a tap on the picture or a
// swipe down closes it. No bb SDK here, so tests can render it: the caller passes how to open the side panel.
import { useRef, useState, type ReactNode } from "react";
import { ContextMenu as MenuPrimitive, Dialog as DialogPrimitive } from "radix-ui";
import { ExternalLink, PanelRight, XIcon } from "lucide-react";
import { plainClick } from "./open-proof.ts";
import { PORTAL, cn } from "./ui/utils.ts";

type Props = {
  /** The full-size picture (also the anchor's href, for a modifier or middle click). */
  src: string;
  /** Names the dialog and sits under the picture. */
  caption: string;
  /** The picture as the card draws it. */
  children: ReactNode;
  /** The anchor's classes (the card's frame). */
  className?: string;
  /** Opens it in bb's side panel; true when bb took it. Without it the menu offers only a new tab. */
  sidePanel?: () => boolean;
};

/** True when the click is ours to take: a plain left click; anything else keeps the browser's own behaviour. */
export const popsOut = plainClick;

/** A swipe down far enough, and more down than sideways, closes the overlay. */
export const SWIPE_CLOSE_PX = 80;
export const swipedDown = (dx: number, dy: number) => dy >= SWIPE_CLOSE_PX && dy > Math.abs(dx) * 1.5;

/** A touch screen without hover (a phone, a tablet): a tap on the picture closes the overlay there. */
const touchOnly = () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: none) and (pointer: coarse)").matches;

const ITEM = "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/** The right-click (long-press) menu on the picture. */
function ImageMenu({ src, sidePanel, onPicked, children }: { src: string; sidePanel?: () => boolean; onPicked?: () => void; children: ReactNode }) {
  return (
    <MenuPrimitive.Root modal={false}>
      <MenuPrimitive.Trigger asChild>{children}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content {...PORTAL} data-popout-menu="" className="z-[60] min-w-[11rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {sidePanel ? (
            <MenuPrimitive.Item
              className={ITEM}
              data-popout-side=""
              onSelect={() => {
                if (sidePanel()) onPicked?.();
                else window.open(src, "_blank", "noopener,noreferrer");
              }}
            >
              <PanelRight aria-hidden />
              Open in side panel
            </MenuPrimitive.Item>
          ) : null}
          <MenuPrimitive.Item className={ITEM} data-popout-tab="" onSelect={() => void window.open(src, "_blank", "noopener,noreferrer")}>
            <ExternalLink aria-hidden />
            Open in new tab
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export function ImagePopout({ src, caption, children, className, sidePanel }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLAnchorElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  return (
    <>
      <ImageMenu src={src} sidePanel={sidePanel}>
        <a
          ref={trigger}
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          data-popout=""
          aria-haspopup="dialog"
          className={cn("cursor-zoom-in [-webkit-touch-callout:none]", className)}
          onClick={(e) => {
            if (!popsOut(e)) return;
            e.preventDefault();
            setOpen(true);
          }}
        >
          {children}
        </a>
      </ImageMenu>
      {/* a portal's events still bubble up the React tree: keep the overlay's clicks from reaching the card (a phone's post opens on a tap) */}
      <span className="contents" onClick={(e) => e.stopPropagation()}>
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay {...PORTAL} className="fixed inset-0 z-50 bg-black/85" data-popout-backdrop="" />
            <DialogPrimitive.Content
              {...PORTAL}
              data-popout-dialog=""
              aria-describedby={undefined}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                trigger.current?.focus();
              }}
              // a click on the empty space around the picture closes it, as the backdrop does
              onClick={(e) => (e.target === e.currentTarget || (e.target as HTMLElement).dataset.popoutFrame !== undefined ? setOpen(false) : undefined)}
              onPointerDown={(e) => (swipe.current = e.pointerType === "mouse" ? null : { x: e.clientX, y: e.clientY })}
              onPointerUp={(e) => {
                const s = swipe.current;
                swipe.current = null;
                if (s && swipedDown(e.clientX - s.x, e.clientY - s.y)) setOpen(false);
              }}
              className="fixed inset-0 z-50 flex touch-pan-x flex-col items-center gap-2 px-3 pt-[max(3.75rem,calc(env(safe-area-inset-top)+3.25rem))] pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none sm:px-8 sm:pb-6"
            >
              <DialogPrimitive.Title className="sr-only">{caption || "Image"}</DialogPrimitive.Title>
              {/* the picture fits what's left of the screen above its caption, however tall it is */}
              <div data-popout-frame="" className="flex min-h-0 w-full flex-1 items-center justify-center">
                <ImageMenu src={src} sidePanel={sidePanel} onPicked={() => setOpen(false)}>
                  <img
                    src={src}
                    alt={caption}
                    decoding="async"
                    data-popout-image=""
                    draggable={false}
                    onClick={() => (touchOnly() ? setOpen(false) : undefined)}
                    className="block max-h-full max-w-full rounded-md bg-background object-contain shadow-lg [-webkit-touch-callout:none]"
                  />
                </ImageMenu>
              </div>
              {caption ? <p className="m-0 max-w-full shrink-0 text-center text-sm text-white [overflow-wrap:anywhere]">{caption}</p> : null}
              <DialogPrimitive.Close
                className="fixed top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] z-10 flex size-11 items-center justify-center rounded-full bg-black/70 text-white ring-1 ring-white/30 hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                data-popout-close=""
              >
                <XIcon className="size-5" aria-hidden />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </span>
    </>
  );
}
