// An image in a card pops out full-size on one click (2026-11-20, the owner: one click on the screenshot itself, no side
// panel step first). A plain click opens shadcn's Dialog (Radix: dialog role, focus trapped, Esc / backdrop / close button
// close it, focus goes back to the image) with the picture fitted to the viewport and its caption; a cmd, ctrl, shift or
// middle click keeps the browser's own behaviour on the anchor's href. No bb SDK here, so tests can render it.
import { useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { plainClick } from "./open-proof.ts";
import { PORTAL, cn } from "./ui/utils.ts";

type Props = {
  /** The full-size picture (also the anchor's href, for a modifier or middle click). */
  src: string;
  /** Names the dialog and sits under the picture; the alt text when the thumbnail has none of its own. */
  caption: string;
  /** The picture as the card draws it. */
  children: ReactNode;
  /** The anchor's classes (the card's frame). */
  className?: string;
  /** Beside the caption in the overlay, e.g. an "Open ↗" link to bb's pane. */
  extra?: ReactNode;
};

/** True when the click is ours to take: a plain left click; anything else keeps the browser's own behaviour. */
export const popsOut = plainClick;

export function ImagePopout({ src, caption, children, className, extra }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLAnchorElement>(null);
  return (
    <>
      <a
        ref={trigger}
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        data-popout=""
        aria-haspopup="dialog"
        className={cn("cursor-zoom-in", className)}
        onClick={(e) => {
          if (!popsOut(e)) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {/* a portal's events still bubble up the React tree: keep the overlay's clicks from reaching the card (a phone's post opens on a tap) */}
      <span className="contents" onClick={(e) => e.stopPropagation()}>
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay {...PORTAL} className="fixed inset-0 z-50 bg-black/80" data-popout-backdrop="" />
            <DialogPrimitive.Content
              {...PORTAL}
              data-popout-dialog=""
              aria-describedby={undefined}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                trigger.current?.focus();
              }}
              // a click on the empty space around the picture closes it, as the backdrop does
              onClick={(e) => (e.target === e.currentTarget ? setOpen(false) : undefined)}
              className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 p-4 outline-none sm:p-8"
            >
              <DialogPrimitive.Title className="sr-only">{caption || "Image"}</DialogPrimitive.Title>
              <img src={src} alt={caption} decoding="async" className="block h-auto max-h-[calc(100dvh-6rem)] w-auto max-w-full rounded-md bg-background object-contain shadow-lg" />
              <div className="flex max-w-full flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-center text-sm text-white [overflow-wrap:anywhere] [&_a]:text-white">
                {caption ? <span>{caption}</span> : null}
                {extra}
              </div>
              <DialogPrimitive.Close className="absolute top-3 right-3 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none" data-popout-close="">
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
