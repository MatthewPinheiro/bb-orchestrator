// The Deliverables tab's lower half (2026-11-16: Deliverables and Outputs in one, "organize the All subtab by project", "the
// folder style view and hierarchy"): a file-explorer tree of everything delivered. Project folders (the sidebar's order,
// the project's type accent on the folder icon), then each past deliverable, newest first, with its proof files; and a
// Files folder with the project's outputs that never became proof. The rows and their order come from past.ts.
// Expanding is remembered per viewer (localStorage) when nothing narrows the tree; under a filter or search the folders on
// the way to a match open by themselves, and toggles last until the filter changes.
import { styleHref } from "./style-href.ts";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Markdown, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { Deliverables } from "../contract.ts";
import { projectTitle } from "../core/model.ts";
import { accentText } from "./accent.ts";
import { Blocks } from "./blocks.tsx";
import { Points } from "./visual-blocks.tsx";
import { FILES_WHERE, FileRow, KindIcon, Remove, useRemoveOutput } from "./files.tsx";
import { openInBb } from "./open-proof.ts";
import { ProofLink } from "./proof-link.tsx";
import { gate } from "./store.ts";
import { ALL_PROJECTS, FILTERS, START, flatten, folderKeys, isFolder, narrowed, openByDefault, shownRevision, treeKey, type Filter, type Folder, type Node, type ProofNode, type Row, type Tab, type View } from "./past.ts";
import { REVEAL_EVENT, takeDeliverable } from "./reveal.ts";
import { History, NextLine, proofSrc } from "./deliverables.tsx";
import { Btn, Muted, PageError, when } from "./ui.tsx";

type Deliverable = Deliverables[number];

export const STATE_WORD: Record<Deliverable["state"], string> = { review: "in review", approved: "approved", changes: "changes requested", withdrawn: "withdrawn" };
const PROOF_ICON = { image: "image", video: "video", text: "report", doc: "doc", pr: "link", link: "link" } as const;
const OPEN_KEY = "orchestrator.deliverables.tree.v1";
const OPEN_MAX = 1500;

/** What the viewer opened and closed, by folder key; {} when storage is blocked or unreadable. */
function loadOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, b]) => typeof b === "boolean")) : {};
  } catch {
    return {};
  }
}
function saveOpen(m: Record<string, boolean>) {
  try {
    const entries = Object.entries(m);
    localStorage.setItem(OPEN_KEY, JSON.stringify(Object.fromEntries(entries.slice(Math.max(0, entries.length - OPEN_MAX)))));
  } catch {
    // a private window or blocked storage: this visit only
  }
}

const Chevron = ({ open }: { open: boolean | null }) =>
  open === null ? (
    <span className="orch-tree2__chev" aria-hidden />
  ) : (
    <svg className="orch-tree2__chev" data-open={open || undefined} viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
const FolderIcon = ({ open, color }: { open: boolean; color?: string }) => (
  <svg className="orch-past__icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden style={color ? { color } : undefined}>
    {open ? (
      <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.5h5c.83 0 1.5.67 1.5 1.5v.5H4.6a1.5 1.5 0 0 0-1.42 1.02L1.75 11.5z M3.2 7.3A1 1 0 0 1 4.15 6.6h10.1a.6.6 0 0 1 .57.79l-1.4 4.3a1.5 1.5 0 0 1-1.42 1.03H2.1z" fill="currentColor" />
    ) : (
      <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.5h5c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5z" fill="currentColor" />
    )}
  </svg>
);

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const prNumber = (url: string | null | undefined) => url?.match(/\/pull\/(\d+)/)?.[1] ?? null;
/** A proof file's name in the tree: the file, the PR, or the link's host and path. */
function proofName(p: ProofNode["p"]): string {
  if (p.kind === "pr") {
    const n = p.pr?.number ?? prNumber(p.url);
    return `PR${n ? ` #${n}` : ""}${p.pr?.state ? ` · ${p.pr.state}` : ""}`;
  }
  if (p.path) return base(p.path);
  try {
    const u = new URL(p.url ?? "");
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return p.url ?? p.caption;
  }
}

/** A proof file: opens as a bb pane through the shared opener; a file bb can't preview falls back to the proof route. */
function ProofRowBody({ n, after }: { n: ProofNode; after: () => void }) {
  const nav = useBbNavigate();
  const [unopened, setUnopened] = useState(false);
  const remove = useRemoveOutput(after);
  const p = n.p;
  const file = p.kind === "image" || p.kind === "video" || p.kind === "text" ? proofSrc(p.id) : undefined;
  const name = proofName(p);
  return (
    <>
      <KindIcon kind={PROOF_ICON[p.kind]} label={p.kind} />
      <div className="min-w-0 flex-1" data-proof={p.id}>
        {file || p.url ? (
          <ProofLink open={p} fallback={file} data-open="" className="orch-past__open orch-tree2__name" title={p.path ?? p.url ?? ""}>
            {name}
          </ProofLink>
        ) : (
          <button type="button" data-open="" className="orch-past__open orch-tree2__name" title={p.path ?? ""} onClick={() => setUnopened(!openInBb(nav, p))}>
            {name}
          </button>
        )}
        <div className="orch-past__meta">
          <span>{p.kind === "pr" ? "PR" : p.kind}</span>
          {p.caption ? <span className="[overflow-wrap:anywhere]">{p.caption}</span> : null}
        </div>
        {n.output ? (
          <div className="orch-past__meta" data-output={n.output.id}>
            <span>Recorded as output by {n.output.author}</span>
            <span>{when(n.output.at)}</span>
          </div>
        ) : null}
        {n.output?.note ? <p className="orch-past__note">{n.output.note}</p> : null}
        {unopened ? (
          <p role="alert" className="orch-danger m-0 mt-1 text-xs">
            bb couldn't open this file here.
          </p>
        ) : null}
      </div>
      {n.output ? (
        <div className="orch-past__end">
          <Remove id={n.output.id} busy={gate.lock !== null} remove={remove} />
        </div>
      ) : null}
    </>
  );
}

/** An open deliverable's own words, above its proof rows: what its card showed, without the review controls. */
function DeliverableDetail({ d, level }: { d: Deliverable; level: number }) {
  const rev = shownRevision(d);
  return (
    <div data-past-body={d.id} className="orch-tree2__detail" style={{ paddingInlineStart: 8 + (level + 1) * 16 + 28 }}>
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <Markdown content={rev?.summary ?? d.summary} />
      </div>
      {rev && rev.points.length > 0 ? (
        <div className="mt-3">
          <Points points={rev.points} />
        </div>
      ) : null}
      <Blocks blocks={rev?.blocks ?? []} prs={rev?.prs ?? []} />
      {d.withdrawn ? (
        <p className="orch-past__note">
          Withdrawn {when(d.withdrawn.at)}
          {d.withdrawn.reason ? `: ${d.withdrawn.reason}` : ""}
        </p>
      ) : null}
      {d.next ? <NextLine n={d.next} /> : null}
      <History d={d} />
    </div>
  );
}

function DeliverableRowBody({ d, open, proofs }: { d: Deliverable; open: boolean; proofs: number }) {
  const last = d.feedback[d.feedback.length - 1];
  return (
    <>
      <FolderIcon open={open} />
      <div className="min-w-0 flex-1">
        <span className="orch-tree2__name orch-tree2__strong" data-toggle="">
          {d.title}
        </span>
        <div className="orch-past__meta">
          <span className="orch-past__state">
            <span className="orch-past__dot" data-state={d.state} aria-hidden />
            {STATE_WORD[d.state]}
          </span>
          <span>{d.lead}</span>
          {d.rev > 1 ? <span>rev {d.rev}</span> : null}
          <span>{when(d.updatedAt)}</span>
          <span>
            {proofs} proof file{proofs === 1 ? "" : "s"}
          </span>
        </div>
        {last?.text ? (
          <span className="orch-past__line" title={last.text}>
            {last.outcome === "changes" ? "Changes: " : "You said: "}
            {last.text}
          </span>
        ) : null}
        {d.next ? (
          <span className="orch-past__line" title={d.next.text}>
            Next: {d.next.text} · {d.next.state === "closed" ? (d.next.outcome ?? "closed") : d.next.state === "dead" ? "not delivered" : "with the lead"}
          </span>
        ) : null}
      </div>
    </>
  );
}

function rowBody(r: Row, after: () => void): ReactNode {
  const n = r.node;
  switch (n.t) {
    case "project": {
      const ds = n.children.filter((c) => c.t === "deliverable").length;
      const fs = n.children.find((c) => c.t === "files")?.children.length ?? 0;
      return (
        <>
          <FolderIcon open={!!r.open} color={accentText(n.monType)} />
          <span className="orch-tree2__name orch-tree2__strong min-w-0 flex-1" data-toggle="">
            {n.project ? projectTitle(n.project) : "No project"}
          </span>
          <span className="orch-tree2__aside">
            {[ds ? `${ds} deliverable${ds === 1 ? "" : "s"}` : "", fs ? `${fs} file${fs === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}
          </span>
          <span className="orch-tree2__aside orch-tree2__when">{when(n.at)}</span>
        </>
      );
    }
    case "deliverable":
      return <DeliverableRowBody d={n.d} open={!!r.open} proofs={n.children.length} />;
    case "files":
      return (
        <>
          <FolderIcon open={!!r.open} />
          <span className="orch-tree2__name orch-tree2__strong min-w-0 flex-1" data-toggle="">
            Files
          </span>
          <span className="orch-tree2__aside">{n.children.length}</span>
        </>
      );
    case "proof":
      return <ProofRowBody n={n} after={after} />;
    case "file":
      return <FileRow o={n.o} after={after} />;
  }
}

const dataOf = (n: Node): Record<string, string> =>
  n.t === "project" ? { "data-tree-project": n.project ?? "" } : n.t === "deliverable" ? { "data-past": n.d.id, "data-state": n.d.state } : n.t === "files" ? { "data-files-project": n.project ?? "" } : n.t === "proof" ? { "data-tree-proof": n.p.id } : { "data-tree-file": n.o.id };

// Readability (the rules approved for the Projects tab, 2026-11-16): sizes 16, 14 and 12 only; weights 400 and 600; colour
// only on the state dots and the project's folder icon; no uppercase labels, chips or boxed rows. 16 px per level.
const treeCss = /* css */ `
[data-orch] .orch-past { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; font-size: 14px; line-height: 20px; font-weight: 400; }
[data-orch] .orch-past h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
[data-orch] .orch-past__bar { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
[data-orch] .orch-past__filters { display: flex; flex-wrap: wrap; gap: 4px; }
[data-orch] .orch-past__filters button, [data-orch] .orch-tree2__all button { border: 0; border-radius: 6px; padding: 4px 10px; background: none; font: inherit; font-size: 14px; color: var(--orch-muted); cursor: pointer; }
[data-orch] .orch-past__filters button:hover, [data-orch] .orch-tree2__all button:hover { color: var(--orch-ink); }
[data-orch] .orch-past__filters button[aria-pressed="true"] { background: light-dark(rgba(0, 0, 0, 0.07), rgba(255, 255, 255, 0.1)); color: var(--orch-ink); font-weight: 600; }
[data-orch] .orch-past__find { display: flex; flex-wrap: wrap; gap: 8px; }
[data-orch] .orch-past__find select, [data-orch] .orch-past__find input { font: inherit; font-size: 14px; color: var(--orch-ink); background: transparent; border: 1px solid light-dark(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.22)); border-radius: 6px; padding: 5px 8px; min-width: 0; }
[data-orch] .orch-past__find select { flex: 0 1 14rem; }
[data-orch] .orch-past__find select option { background: Canvas; color: CanvasText; }
[data-orch] .orch-past__find input { flex: 1 1 14rem; }
[data-orch] .orch-past__find input::placeholder { color: var(--orch-muted); opacity: 1; }
[data-orch] .orch-tree2__all { display: flex; gap: 4px; margin-inline-start: -10px; }
[data-orch] .orch-tree2 { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; }
[data-orch] .orch-tree2__row { display: flex; align-items: flex-start; gap: 8px; min-height: 36px; padding: 8px 8px 8px 0; border-radius: 6px; outline: none; }
[data-orch] .orch-tree2__row[aria-expanded], [data-orch] .orch-tree2__row[aria-selected] { cursor: pointer; }
[data-orch] .orch-tree2__row[data-picked], [data-orch] .orch-tree2__row[data-picked]:hover { background: light-dark(rgba(0, 0, 0, 0.07), rgba(255, 255, 255, 0.1)); }
[data-orch] .orch-tree2__row:hover { background: var(--orch-wash); }
[data-orch] .orch-tree2__row:focus-visible { box-shadow: inset 0 0 0 2px var(--orch-accent, #4f7cff); }
[data-orch] .orch-tree2__chev { flex: none; width: 12px; height: 12px; margin-top: 4px; color: var(--orch-muted); transition: transform 160ms ease; }
[data-orch] .orch-tree2__chev[data-open] { transform: rotate(90deg); }
[data-orch] .orch-tree2__name { font-size: 14px; line-height: 20px; color: var(--orch-ink); overflow-wrap: anywhere; }
[data-orch] .orch-tree2__strong { font-weight: 600; }
[data-orch] .orch-tree2__aside { flex: none; font-size: 12px; line-height: 20px; color: var(--orch-muted); }
[data-orch] .orch-tree2__when { min-width: 7rem; text-align: right; }
[data-orch] .orch-tree2__detail { min-width: 0; padding-block: 0 8px; padding-inline-end: 8px; }
[data-orch] .orch-tree2__row .orch-past__file { display: contents; }
[data-orch] .orch-past__open { border: 0; padding: 0; background: none; font: inherit; font-size: 14px; font-weight: 400; text-align: start; color: var(--orch-ink); text-decoration: none; cursor: pointer; overflow-wrap: anywhere; }
[data-orch] .orch-past__open:hover { text-decoration: underline; text-underline-offset: 2px; }
[data-orch] .orch-past__title { font-weight: 400; }
[data-orch] .orch-past__meta { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--orch-muted); min-width: 0; }
[data-orch] .orch-past__state { display: inline-flex; align-items: center; gap: 6px; color: var(--orch-ink); }
[data-orch] .orch-past__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--orch-muted); }
[data-orch] .orch-past__dot[data-state="approved"] { background: light-dark(#15803d, #4ade80); }
[data-orch] .orch-past__dot[data-state="changes"] { background: light-dark(#b45309, #fbbf24); }
[data-orch] .orch-past__line { display: block; margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--orch-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
[data-orch] .orch-past__note { margin: 4px 0 0; font-size: 12px; line-height: 16px; color: var(--orch-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
[data-orch] .orch-past__icon { flex: none; margin-top: 2px; color: var(--orch-muted); }
[data-orch] .orch-past__file { display: flex; align-items: flex-start; gap: 8px; padding: 8px 4px; }
[data-orch] .orch-past__folded { display: grid; margin-top: 4px; }
[data-orch] .orch-past__end { flex: none; opacity: 0; transition: opacity 120ms ease; }
[data-orch] .orch-tree2__row:hover .orch-past__end, [data-orch] .orch-past__file:hover .orch-past__end, [data-orch] .orch-past__end:focus-within, [data-orch] .orch-past__end:has([data-remove-confirm]) { opacity: 1; }
@media (hover: none) { [data-orch] .orch-past__end { opacity: 1; } }
@media (max-width: 480px) {
  [data-orch] .orch-tree2__row { min-height: 44px; flex-wrap: wrap; }
  [data-orch] .orch-tree2__when { display: none; }
  [data-orch] .orch-past__end { flex-basis: 100%; padding-inline-start: 44px; }
}
`;

/**
 * The filters, the search, Expand all / Collapse all, and the tree. `files`: the outputs read's state. `pick` (the wide
 * tab's master-detail): a deliverable's row selects it for the detail beside the list instead of opening in place.
 */
export function DeliverablesTree({ tab, view, setView, files, outputsAfter, pick }: { tab: Tab; view: View; setView: (f: (v: View) => View) => void; files: { loaded: boolean; error: string | null }; outputsAfter: () => void; pick?: { id: string | null; on: (id: string) => void } }) {
  const narrow = narrowed(view);
  const [stored, setStored] = useState<Record<string, boolean>>(loadOpen);
  const [session, setSession] = useState<Record<string, boolean>>({});
  const viewKey = JSON.stringify(view);
  useEffect(() => setSession({}), [viewKey]); // a new filter or search opens its own matches again
  const isOpen = (n: Folder) => (pick && n.t === "deliverable" ? false : ((narrow ? session : stored)[n.key] ?? openByDefault(n, narrow)));
  const rows = flatten(tab.tree, isOpen);
  const setOpen = (patch: Record<string, boolean>) => {
    if (narrow) setSession((m) => ({ ...m, ...patch }));
    else
      setStored((m) => {
        const next = { ...m };
        for (const [k, v] of Object.entries(patch)) {
          delete next[k]; // the newest toggles last when the store is trimmed
          next[k] = v;
        }
        saveOpen(next);
        return next;
      });
  };
  const toggle = (r: Row) => (pick && r.node.t === "deliverable" ? pick.on(r.node.d.id) : setOpen({ [r.node.key]: !r.open }));

  // a link elsewhere asked for a deliverable (reveal.ts): every filter off, its project folder open, then it scrolls
  const want = useRef<string | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    want.current = takeDeliverable() ?? want.current;
    const on = (e: Event) => {
      takeDeliverable();
      want.current = (e as CustomEvent<string>).detail;
      setAsked((n) => n + 1);
    };
    window.addEventListener(REVEAL_EVENT, on);
    return () => window.removeEventListener(REVEAL_EVENT, on);
  }, []);
  useEffect(() => {
    const id = want.current;
    const folder = id ? tab.tree.find((p) => p.children.some((c) => c.key === `d:${id}`)) : undefined;
    if (!folder) return; // not loaded yet: kept until the tree has it
    want.current = null;
    if (id && pick) pick.on(id);
    setView(() => START);
    setStored((m) => {
      const next = { ...m, [folder.key]: true };
      saveOpen(next);
      return next;
    });
  }, [tab.tree, asked]);
  const keys = useMemo(() => folderKeys(tab.tree), [tab.tree]);

  // the roving focus: one row is in the tab order; the arrow keys move it
  const [focus, setFocus] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const focusKey = rows.some((r) => r.node.key === focus) ? focus : (rows[0]?.node.key ?? null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    treeRef.current?.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(focusKey ?? "")}"]`)?.focus();
  });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).getAttribute("role") !== "treeitem" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const m = treeKey(rows, focusKey, e.key);
    if (!m) return;
    e.preventDefault();
    if (m.toggle) {
      const r = rows.find((x) => x.node.key === m.toggle);
      if (r) toggle(r);
    }
    if (m.activate) treeRef.current?.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(m.activate)}"] [data-open]`)?.click();
    if (m.focus) {
      moved.current = true;
      setFocus(m.focus);
    }
  };

  const heading = view.filter === "files" ? "Files" : "Past deliverables";
  return (
    <section className="orch-past" data-past-list="" aria-label={heading}>
      <h2>{heading}</h2>
      <div className="orch-past__bar">
        <div role="group" aria-label="Show" className="orch-past__filters">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" data-filter={f.id} aria-pressed={view.filter === f.id} onClick={() => setView((v) => ({ ...v, filter: f.id as Filter }))}>
              {f.label} {tab.counts[f.id]}
            </button>
          ))}
        </div>
        <div className="orch-past__find">
          <select aria-label="Project" data-past-project="" value={view.project} onChange={(e) => setView((v) => ({ ...v, project: e.target.value }))}>
            <option value={ALL_PROJECTS}>All projects</option>
            {tab.projects.map((p) => (
              <option key={p ?? ""} value={p ?? ""}>
                {p ? projectTitle(p) : "No project"}
              </option>
            ))}
          </select>
          <input
            type="search"
            aria-label="Search past deliverables and files"
            data-past-search=""
            placeholder={view.filter === "files" ? "Search titles and notes" : "Search titles, summaries and points"}
            value={view.query}
            maxLength={200}
            onChange={(e) => setView((v) => ({ ...v, query: e.target.value }))}
          />
        </div>
        {rows.length > 0 ? (
          <div className="orch-tree2__all">
            <button type="button" data-expand-all="" onClick={() => setOpen(Object.fromEntries(keys.map((k) => [k, true])))}>
              Expand all
            </button>
            <button type="button" data-collapse-all="" onClick={() => setOpen(Object.fromEntries(keys.map((k) => [k, false])))}>
              Collapse all
            </button>
          </div>
        ) : null}
      </div>
      {files.error ? (
        <p className="orch-danger m-0 text-xs">
          {files.loaded ? "Stale outputs" : "Can't read the outputs"}: {files.error}{" "}
          <Btn tone="ghost" onClick={outputsAfter}>
            Retry
          </Btn>
        </p>
      ) : null}
      <PageError where={FILES_WHERE} />
      {rows.length === 0 ? (
        <Muted>
          {view.filter === "files" && !files.loaded && !files.error
            ? "Loading…"
            : narrow && (view.project !== ALL_PROJECTS || view.query.trim())
              ? "Nothing matches this project and search."
              : view.filter === "files"
                ? "No files: every output is a deliverable's proof, or none were recorded yet (orch_output)."
                : "Nothing here yet."}
        </Muted>
      ) : (
        <div ref={treeRef} role="tree" aria-label={heading} className="orch-tree2" onKeyDown={onKeyDown}>
          {rows.map((r) => (
            <TreeItem key={r.node.key} r={r} focusable={r.node.key === focusKey} onFocus={() => setFocus(r.node.key)} onToggle={() => toggle(r)} after={outputsAfter} picked={pick ? r.node.t === "deliverable" && r.node.d.id === pick.id : undefined} />
          ))}
        </div>
      )}
      <style href={styleHref("orch-past", treeCss)} precedence="default">
        {treeCss}
      </style>
    </section>
  );
}

/** `picked`: set in the wide tab only, where a deliverable's row selects it (its detail sits beside the list). */
function TreeItem({ r, focusable, onFocus, onToggle, after, picked }: { r: Row; focusable: boolean; onFocus: () => void; onToggle: () => void; after: () => void; picked?: boolean }) {
  const pickRow = picked !== undefined && r.node.t === "deliverable";
  const folder = isFolder(r.node) && !pickRow;
  return (
    <>
      <div
        role="treeitem"
        data-tree-key={r.node.key}
        data-node={r.node.t}
        {...dataOf(r.node)}
        aria-level={r.level + 1}
        aria-expanded={folder ? !!r.open : undefined}
        aria-selected={pickRow ? picked : undefined}
        data-picked={pickRow && picked ? "" : undefined}
        tabIndex={focusable ? 0 : -1}
        className="orch-tree2__row"
        style={{ paddingInlineStart: 8 + r.level * 16 }}
        onFocus={(e) => e.target === e.currentTarget && onFocus()}
        onClick={(e) => {
          // a folder opens or closes on a click anywhere on its row, except on a control inside it
          if ((folder || pickRow) && !(e.target as HTMLElement).closest("a,button,input,select,textarea,summary")) onToggle();
        }}
      >
        <Chevron open={pickRow ? null : r.open} />
        {rowBody(r, after)}
      </div>
      {r.node.t === "deliverable" && r.open && !pickRow ? <DeliverableDetail d={r.node.d} level={r.level} /> : null}
    </>
  );
}

