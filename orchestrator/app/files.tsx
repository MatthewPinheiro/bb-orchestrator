// Outputs (orch_output) on the Deliverables tab (2026-11-16, was the Outputs tab): a loose one is a row under the Files
// filter; one that is a deliverable's proof sits folded inside that deliverable. Either opens through the shared opener
// (open-proof.ts): a file in bb's preview pane on its host, a link through bb's link handling. Remove takes an output off
// the record (never the file) through the page's write gate.
import { useState, type ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { WRITES, type Outputs, type outputRemoveBody } from "../contract.ts";
import { openInBb } from "./open-proof.ts";
import { ProofLink } from "./proof-link.tsx";
import { gate, write } from "./store.ts";
import { Btn, when } from "./ui.tsx";

type Output = Outputs[number];

/** Where Remove's failure shows. */
export const FILES_WHERE = "outputs";

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const host = (u: string | null) => {
  try {
    return u ? new URL(u).host : "";
  } catch {
    return u ?? "";
  }
};

const KIND_PATHS: Record<Output["kind"], ReactNode> = {
  doc: <path d="M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5M6 8h4.5M6 10.5h4.5" />,
  report: <path d="M4 1.75h8.5v12.5H4zM6.5 11.5V9M8.25 11.5V6.5M10 11.5V8" />,
  image: <path d="M2.25 3h11.5v10H2.25zM2.25 11l3.5-3.5 3 3 2-2 3 3M10.5 6.25h.01" />,
  video: <path d="M2.25 3.5h8.5v9h-8.5zM10.75 7l3-1.75v5.5l-3-1.75" />,
  link: <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.5.5M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.5-.5" />,
};
/** The kind as a muted outline icon: the word is in its label; colour is kept for state. */
export const KindIcon = ({ kind, label }: { kind: Output["kind"]; label?: string }) => (
  <svg className="orch-past__icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label ?? kind}>
    {KIND_PATHS[kind]}
  </svg>
);

/** Remove, as the Board's Archive: a first click asks, inline; the second takes it off the record. */
export function Remove({ id, busy, remove }: { id: string; busy: boolean; remove: (id: string) => Promise<boolean> }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Btn tone="ghost" data-remove={id} disabled={busy} onClick={() => setAsking(true)}>
        Remove
      </Btn>
    );
  return (
    <span role="group" aria-label="Confirm remove" className="flex flex-wrap items-center justify-end gap-2">
      <span className="orch-muted text-xs">Off the record; the file stays.</span>
      <Btn tone="ghost" disabled={busy} onClick={() => setAsking(false)}>
        Cancel
      </Btn>
      <Btn tone="danger" data-remove-confirm={id} disabled={busy} onClick={() => void remove(id).then((ok) => ok && setAsking(false))}>
        Remove
      </Btn>
    </span>
  );
}

export function useRemoveOutput(after: () => void) {
  return async (id: string) => {
    const body: z.input<typeof outputRemoveBody> = { id };
    return (await write(WRITES.outputRemove, body, { kind: "other", where: FILES_WHERE, after }))?.ok === true;
  };
}

/** One output: its title opens it; then who recorded it, when, and the file or host; its note; Remove. */
export function FileRow({ o, after, project }: { o: Output; after: () => void; project?: boolean }) {
  const navigate = useBbNavigate();
  const [unopened, setUnopened] = useState(false);
  const remove = useRemoveOutput(after);
  const busy = gate.lock !== null;
  return (
    <div data-output={o.id} className="orch-past__file">
      <KindIcon kind={o.kind} />
      <div className="min-w-0 flex-1">
        {o.url ? (
          <ProofLink open={o} data-open="" className="orch-past__title orch-past__open" title={o.url}>
            {o.title}
          </ProofLink>
        ) : (
          <button type="button" data-open="" className="orch-past__title orch-past__open" title={o.path ?? ""} onClick={() => setUnopened(!openInBb(navigate, o))}>
            {o.title}
          </button>
        )}
        <div className="orch-past__meta">
          {project ? <span>{o.project ?? "No project"}</span> : null}
          <span>{o.author}</span>
          <span>{when(o.at)}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{o.path ? base(o.path) : host(o.url)}</span>
        </div>
        {o.note ? <p className="orch-past__note">{o.note}</p> : null}
        {unopened ? (
          <p role="alert" className="orch-danger m-0 mt-1 text-xs">
            bb couldn't open this file here.
          </p>
        ) : null}
      </div>
      <div className="orch-past__end">
        <Remove id={o.id} busy={busy} remove={remove} />
      </div>
    </div>
  );
}

/** The outputs that are this deliverable's proof, folded: closed, so the card reads as before. */
export function FoldedOutputs({ outputs, after }: { outputs: Output[]; after: () => void }) {
  if (outputs.length === 0) return null;
  return (
    <details data-folded-outputs="" className="mt-3">
      <summary className="orch-muted cursor-pointer text-xs">
        Recorded as {outputs.length} output{outputs.length === 1 ? "" : "s"}
      </summary>
      <div className="orch-past__folded">
        {outputs.map((o) => (
          <FileRow key={o.id} o={o} after={after} />
        ))}
      </div>
    </details>
  );
}
