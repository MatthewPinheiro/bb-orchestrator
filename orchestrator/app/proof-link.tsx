// The one link every proof item, PR chip and verdict tile renders: a plain click opens it as a bb pane (open-proof.ts);
// when bb declines (no preview here, no file on a host) the anchor's own href opens in a new tab, so it always opens.
import type { ComponentPropsWithoutRef } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { openInBb, plainClick, type Openable } from "./open-proof.ts";

type Props = Omit<ComponentPropsWithoutRef<"a">, "href" | "target" | "rel" | "onClick"> & {
  open: Openable;
  /** Where a declined open goes instead (the proof route for a file); the URL itself when omitted. */
  fallback?: string;
};

export function ProofLink({ open, fallback, children, ...rest }: Props) {
  const nav = useBbNavigate();
  return (
    <a
      {...rest}
      href={fallback ?? open.url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      data-open-in-bb=""
      onClick={(e) => {
        if (plainClick(e) && openInBb(nav, open)) e.preventDefault();
      }}
    >
      {children}
    </a>
  );
}
