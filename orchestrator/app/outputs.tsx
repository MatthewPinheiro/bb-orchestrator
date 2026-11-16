// Outputs: the finished artefacts leads and threads recorded for the owner (orch_output), as folders: one per project (the
// project with the newest output first and open), its files inside with a kind icon. A file opens in bb's own preview on the host it is on (a video plays there);
// a link opens in a new tab. Remove takes an output off the record (never the file) through the page's write gate.
import { useCallback, useRef, useState, type ReactNode } from "react";
import { experimental_useRpcQuery, useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { CHANGED_CHANNEL, WRITES, rpcContract, type Outputs, type outputRemoveBody } from "../contract.ts";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { gate, useGate, write } from "./store.ts";
import { Btn, Muted, when } from "./ui.tsx";

type Output = Outputs[number];

/** One card per project, each newest first, the project with the newest output first (the list comes newest first). */
function byProject(outputs: Outputs): { project: string | null; items: Output[] }[] {
  const groups = new Map<string | null, Output[]>();
  for (const o of outputs) groups.set(o.project, [...(groups.get(o.project) ?? []), o]);
  return [...groups].map(([project, items]) => ({ project, items }));
}

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const host = (u: string | null) => {
  try {
    return u ? new URL(u).host : "";
  } catch {
    return u ?? "";
  }
};

const Chevron = ({ open }: { open: boolean }) => (
  <svg className="orch-tree__chev" data-open={open || undefined} viewBox="0 0 16 16" width="12" height="12" aria-hidden>
    <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const FolderIcon = ({ open }: { open: boolean }) => (
  <svg className="orch-tree__icon orch-tree__icon--folder" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
    {open ? (
      <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.5h5c.83 0 1.5.67 1.5 1.5v.5H4.6a1.5 1.5 0 0 0-1.42 1.02L1.75 11.5z M3.2 7.3A1 1 0 0 1 4.15 6.6h10.1a.6.6 0 0 1 .57.79l-1.4 4.3a1.5 1.5 0 0 1-1.42 1.03H2.1z" fill="currentColor" />
    ) : (
      <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.5h5c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5z" fill="currentColor" />
    )}
  </svg>
);
const KIND_PATHS: Record<Output["kind"], ReactNode> = {
  doc: <path d="M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5M6 8h4.5M6 10.5h4.5" />,
  report: <path d="M4 1.75h8.5v12.5H4zM6.5 11.5V9M8.25 11.5V6.5M10 11.5V8" />,
  image: <path d="M2.25 3h11.5v10H2.25zM2.25 11l3.5-3.5 3 3 2-2 3 3M10.5 6.25h.01" />,
  video: <path d="M2.25 3.5h8.5v9h-8.5zM10.75 7l3-1.75v5.5l-3-1.75" />,
  link: <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.5.5M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.5-.5" />,
};
const KindIcon = ({ kind }: { kind: Output["kind"] }) => (
  <svg className="orch-tree__icon" data-kind={kind} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-label={kind}>
    {KIND_PATHS[kind]}
  </svg>
);

const treeCss = /* css */ `
[data-orch] .orch-tree, [data-orch] .orch-tree ul { margin: 0; padding: 0; list-style: none; }
[data-orch] .orch-tree { border-radius: 10px; background: light-dark(#fff, #1c1c1e); box-shadow: 0 0 0 0.5px light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.1)), 0 1px 2px rgba(0,0,0,0.05); overflow: hidden; font-size: 13px; line-height: 20px; }
[data-orch] .orch-tree__folder + .orch-tree__folder { border-top: 0.5px solid var(--orch-line); }
[data-orch] .orch-tree__row { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 8px 12px; text-align: start; }
[data-orch] .orch-tree__head { align-items: center; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; padding-block: 10px; }
[data-orch] .orch-tree__head:hover, [data-orch] .orch-tree__file:hover { background: var(--orch-wash); }
[data-orch] .orch-tree__chev { flex: none; color: var(--orch-muted); transition: transform 160ms ease; }
[data-orch] .orch-tree__chev[data-open] { transform: rotate(90deg); }
[data-orch] .orch-tree__icon { flex: none; margin-top: 2px; color: var(--orch-muted); }
[data-orch] .orch-tree__head .orch-tree__icon { margin-top: 0; }
[data-orch] .orch-tree__icon--folder { color: light-dark(#5b8def, #7aa7ff); }
[data-orch] .orch-tree__icon[data-kind="video"] { color: light-dark(#c2410c, #fb923c); }
[data-orch] .orch-tree__icon[data-kind="image"] { color: light-dark(#7c3aed, #c4b5fd); }
[data-orch] .orch-tree__icon[data-kind="report"] { color: light-dark(#15803d, #86efac); }
[data-orch] .orch-tree__count { flex: none; min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--orch-wash); color: var(--orch-muted); font-size: 12px; text-align: center; }
[data-orch] .orch-tree__when { flex: none; width: 7rem; text-align: right; color: var(--orch-muted); font-size: 12px; }
[data-orch] .orch-tree__files { padding-bottom: 4px; }
[data-orch] .orch-tree__file .orch-tree__row { padding-left: 44px; }
[data-orch] .orch-tree__sub { display: flex; flex-wrap: wrap; gap: 2px 6px; margin-top: 1px; font-size: 12px; line-height: 16px; color: var(--orch-muted); min-width: 0; }
[data-orch] .orch-tree__end { flex: none; opacity: 0; transition: opacity 120ms ease; }
[data-orch] .orch-tree__file:hover .orch-tree__end, [data-orch] .orch-tree__end:focus-within, [data-orch] .orch-tree__end:has([data-remove-confirm]) { opacity: 1; }
@media (hover: none) { [data-orch] .orch-tree__end { opacity: 1; } }
@media (max-width: 480px) { [data-orch] .orch-tree__when { display: none; } [data-orch] .orch-tree__file .orch-tree__row { padding-left: 28px; } }
`;

const LINKISH = "cursor-pointer border-0 bg-transparent p-0 text-start font-medium text-inherit no-underline underline-offset-2 hover:underline [overflow-wrap:anywhere]";

/** Remove, as the Board's Archive: a first click asks, inline; the second takes it off the record. */
function Remove({ id, busy, remove }: { id: string; busy: boolean; remove: (id: string) => Promise<boolean> }) {
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

export function OutputsView() {
  useGate();
  const q = experimental_useRpcQuery({ contract: rpcContract, method: "outputs", input: null });
  const latest = useRef(q.refetch);
  latest.current = q.refetch;
  const refetch = useCallback(() => void latest.current(), []);
  useRealtime(CHANGED_CHANNEL, refetch);
  const navigate = useBbNavigate();
  const [unopened, setUnopened] = useState<string | null>(null);
  // which project folders are open (unset: only the newest), for this visit
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const busy = gate.lock !== null;

  if (!q.data) {
    return q.error ? (
      <EmptyState title="Can't read the outputs" text={q.error.message} icon={null} action={<Btn onClick={refetch}>Retry</Btn>} />
    ) : (
      <Muted>Loading…</Muted>
    );
  }
  if (q.data.length === 0) {
    return <EmptyState title="No outputs yet" text="Leads and threads record finished docs, videos, images, reports and links here with orch_output." />;
  }

  const openFile = (o: Output) => {
    const opened = o.hostId && o.path ? navigate.experimental_openFilePreview({ target: { kind: "host", hostId: o.hostId, path: o.path }, location: null }) : false;
    setUnopened(opened ? null : o.id);
  };
  const remove = async (id: string) => {
    const body: z.input<typeof outputRemoveBody> = { id };
    return (await write(WRITES.outputRemove, body, { kind: "other", where: "outputs", after: refetch }))?.ok === true;
  };

  const groups = byProject(q.data);
  const isOpen = (key: string, i: number) => (key in openFolders ? openFolders[key]! : i === 0);
  return (
    <div className="flex flex-col gap-3 pb-8">
      {q.error ? <p className="orch-danger m-0 text-xs">Stale: {q.error.message}</p> : null}
      {gate.error?.where === "outputs" ? (
        <p role="alert" className="orch-danger m-0 text-xs">
          {gate.error.message}
        </p>
      ) : null}
      {/* Requested 2026-11-13: "make outputs a folder style": a folder per project, the newest open; files inside */}
      <ul className="orch-tree" role="tree" aria-label="Outputs by project">
        {groups.map((g, i) => {
          const key = g.project ?? "";
          const open = isOpen(key, i);
          return (
            <li key={key} role="treeitem" aria-expanded={open} data-outputs={key} className="orch-tree__folder">
              <button type="button" className="orch-tree__row orch-tree__head" data-folder={key} onClick={() => setOpenFolders((m) => ({ ...m, [key]: !open }))}>
                <Chevron open={open} />
                <FolderIcon open={open} />
                <span className="min-w-0 flex-1 truncate font-medium">{g.project ?? "No project"}</span>
                <span className="orch-tree__count">{g.items.length}</span>
                <span className="orch-tree__when">{when(g.items[0]!.at)}</span>
              </button>
              {open ? (
                <ul role="group" className="orch-tree__files">
                  {g.items.map((o) => (
                    <li key={o.id} role="treeitem" data-output={o.id} className="orch-tree__file">
                      <div className="orch-tree__row">
                        <KindIcon kind={o.kind} />
                        <div className="min-w-0 flex-1">
                          {o.url ? (
                            <a href={o.url} target="_blank" rel="noopener noreferrer" className={LINKISH} title={o.url}>
                              {o.title}
                            </a>
                          ) : (
                            <button type="button" className={LINKISH} title={o.path ?? ""} onClick={() => openFile(o)}>
                              {o.title}
                            </button>
                          )}
                          <div className="orch-tree__sub">
                            <span className="orch-mono">{o.author}</span>
                            <span aria-hidden>·</span>
                            <span>{when(o.at)}</span>
                            <span aria-hidden>·</span>
                            <span className="orch-mono min-w-0 truncate">{o.path ? base(o.path) : host(o.url)}</span>
                          </div>
                          {o.note ? <p className="orch-muted m-0 mt-1 whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{o.note}</p> : null}
                          {unopened === o.id ? (
                            <p role="alert" className="orch-danger m-0 mt-1 text-xs">
                              bb couldn't open this file here.
                            </p>
                          ) : null}
                        </div>
                        <div className="orch-tree__end">
                          <Remove id={o.id} busy={busy} remove={remove} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <style href="orch-tree" precedence="default">
        {treeCss}
      </style>
    </div>
  );
}
