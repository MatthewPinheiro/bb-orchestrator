// Pinned documents (2026-11-17): a strip directly under a project's message box, above its goal. Up to four small cards
// (a neutral kind icon, the title, "updated …"), then "+N more" and "+"; hidden while there are none. A click opens the
// target inside bb (openInBb): a file in bb's file preview pane, a URL through bb's link handling, a deliverable on the
// Deliverables tab. The pin's ⋯: Open, Copy path, Unpin. "+" (or "Pin a document…" in the project's ⋯) opens a paste
// field. The plugin never serves a pinned page itself.
import { useState, type FormEvent } from "react";
import type { z } from "zod";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { WRITES, type ProjectBook, type pinBody, type unpinBody } from "../contract.ts";
import { DropdownMenu } from "./affect/dropdown-menu-clean.tsx";
import { openInBb, type Openable } from "./open-proof.ts";
import { panel } from "./refs.ts";
import { write } from "./store.ts";
import { PageError } from "./ui.tsx";
import { Icon } from "./kit-ui.tsx";
import { PINS_SHOWN, pinWhen } from "./kit.ts";

export type PinView = NonNullable<ProjectBook["pins"]>[number];

export const pinsCss = /* css */ `
[data-orch] .k-pins { display: flex; align-items: stretch; gap: 8px; min-width: 0; }
[data-orch] .k-pins-h { display: inline-flex; align-items: center; gap: 4px; flex: none; width: 64px; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--orch-muted); }
[data-orch] .k-pin { display: grid; grid-template-columns: minmax(0, 1fr) 24px; align-items: center; flex: 0 1 232px; min-width: 0; height: 48px; padding: 0 4px 0 0; border: 1px solid var(--k-border); border-radius: 8px; }
[data-orch] .k-pin:hover { background: var(--k-wash); }
[data-orch] .k-pin .k-pin-open { display: grid; grid-template-columns: 16px minmax(0, 1fr); column-gap: 8px; align-items: center; height: 100%; padding: 0 0 0 12px; min-width: 0; text-align: start; cursor: pointer; }
[data-orch] .k-pin .k-pk { color: var(--orch-muted); display: inline-flex; }
[data-orch] .k-pin .k-pt { min-width: 0; display: flex; flex-direction: column; }
[data-orch] .k-pin .k-pt b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .k-pin .k-pt span { font-size: 12px; line-height: 16px; color: var(--orch-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-orch] .k-pin[data-missing="true"] .k-pt span { color: var(--k-warn); }
[data-orch] .k-pins .k-rest { display: inline-flex; align-items: center; gap: 4px; flex: none; }
[data-orch] .k-pins.all { flex-wrap: wrap; }
[data-orch] .k-pins.all .k-pin { flex-basis: 232px; }
[data-orch] .k-pinform { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--k-border); border-radius: 8px; }
[data-orch] .k-pinform input { flex: 1 1 320px; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--k-border); border-radius: 4px; background: transparent; color: var(--orch-ink); font: inherit; }
[data-orch] .k-pinform input:focus { outline: 2px solid var(--orch-ink); outline-offset: 0; }
[data-orch] .k-pinform .k-note { flex-basis: 100%; font-size: 12px; line-height: 16px; color: var(--orch-muted); }
/* under 1400 px the detail column is narrow (about 736 px at 1280): two cards per row, never four squeezed ones */
@container orchcc (max-width: 1399.98px) {
  [data-orch] .k-pins { display: grid; grid-template-columns: 64px minmax(0, 1fr) minmax(0, 1fr); align-items: stretch; }
  [data-orch] .k-pins .k-pins-h { grid-column: 1; grid-row: 1; }
  [data-orch] .k-pins div.k-pin:nth-of-type(odd) { grid-column: 2; }
  [data-orch] .k-pins div.k-pin:nth-of-type(even) { grid-column: 3; }
  [data-orch] .k-pins .k-rest { grid-column: 2 / -1; }
}
@container orchcc (max-width: 640px) {
  [data-orch] .k-pins { grid-template-columns: minmax(0, 1fr); }
  [data-orch] .k-pins .k-pins-h, [data-orch] .k-pins div.k-pin:nth-of-type(n), [data-orch] .k-pins .k-rest { grid-column: 1; grid-row: auto; }
}
`;

/** Where a pin opens in bb: a file on its host, a link, or the deliverable on its tab. */
export function pinTarget(p: PinView): Openable {
  if (p.kind === "file") return { hostId: p.hostId, path: p.path };
  if (p.kind === "deliverable" && p.deliverable) return panel("deliverables", `[data-deliverable="${p.deliverable}"], [data-tree-key="d:${p.deliverable}"]`, p.deliverable);
  return { url: p.url };
}

const KIND_WORD = { page: "HTML page", doc: "Document", link: "Link", box: "Deliverable" } as const;

function PinCard({ p, slug, now, refetch, busy }: { p: PinView; slug: string; now: number; refetch: () => void; busy: boolean }) {
  const nav = useBbNavigate();
  const [failed, setFailed] = useState(false);
  // a file that is gone, or now resolves elsewhere (pinViews), isn't opened: its old path may show something else
  const open = () => setFailed(p.missing && p.kind === "file" ? true : !openInBb(nav, pinTarget(p)));
  const unpin = () => {
    const body: z.input<typeof unpinBody> = { id: p.id };
    void write(WRITES.unpin, body, { kind: "other", where: `pins:${slug}`, after: refetch });
  };
  const where = p.path ?? p.url ?? p.deliverable ?? "";
  return (
    <div className="k-pin" data-pin={p.id} data-pin-kind={p.kind} data-missing={p.missing ? "true" : "false"}>
      <button type="button" className="k-pin-open" data-open-in-bb="" data-pin-open={p.id} title={where} onClick={open}>
        <span className="k-pk">
          <Icon name={p.icon} label={KIND_WORD[p.icon]} />
        </span>
        <span className="k-pt">
          <b>{p.title}</b>
          <span>{failed ? "couldn't open it here" : pinWhen(p, now)}</span>
        </span>
      </button>
      <DropdownMenu
        align="end"
        title={p.title}
        items={[
          { label: "Open", icon: <Icon name="open" />, data: { "data-pin-menu-open": p.id }, onSelect: open },
          { label: p.kind === "link" ? "Copy link" : p.kind === "deliverable" ? "Copy id" : "Copy path", icon: <Icon name="copy" />, data: { "data-pin-copy": p.id }, onSelect: () => void navigator.clipboard?.writeText(where).catch(() => {}) },
          { label: `Unpin from ${slug}`, icon: <Icon name="unpin" />, disabled: busy, data: { "data-unpin": p.id }, onSelect: unpin },
        ]}
        trigger={({ triggerProps }) => (
          <button type="button" className="k-btn icon" data-pin-more={p.id} aria-label={`More for ${p.title}`} {...triggerProps}>
            <Icon name="more" />
          </button>
        )}
      />
    </div>
  );
}

/** The paste field: a path in the project's folders, a link, or a deliverable id. */
export function PinForm({ slug, refetch, onClose, busy }: { slug: string; refetch: () => void; onClose: () => void; busy: boolean }) {
  const [target, setTarget] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = target.trim();
    if (!t) return;
    const body: z.input<typeof pinBody> = { slug, target: t };
    const out = await write(WRITES.pin, body, { kind: "other", where: `pins:${slug}`, after: refetch });
    if (out?.ok) {
      setTarget("");
      onClose();
    }
  };
  return (
    <form className="k-pinform" data-pin-form={slug} onSubmit={(e) => void submit(e)}>
      <input
        autoFocus
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        onKeyDown={(e) => (e.key === "Escape" ? onClose() : undefined)}
        placeholder="Paste a path or a link"
        aria-label={`Pin a document to ${slug}`}
        data-pin-input={slug}
      />
      <button type="submit" className="k-btn solid" data-pin-submit={slug} disabled={busy || !target.trim()}>
        <Icon name="pin" />
        Pin
      </button>
      <button type="button" className="k-btn" onClick={onClose}>
        Cancel
      </button>
      <span className="k-note">A file in the project's folders, a link, or a deliverable.</span>
    </form>
  );
}

/** The strip: hidden with no pins (unless the paste field is open). */
export function PinStrip({ slug, pins, now, refetch, busy, adding, setAdding }: { slug: string; pins: PinView[]; now: number; refetch: () => void; busy: boolean; adding: boolean; setAdding: (x: boolean) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? pins : pins.slice(0, PINS_SHOWN);
  const rest = pins.length - shown.length;
  return (
    <>
      {pins.length ? (
        <div className={all ? "k-pins all" : "k-pins"} data-pins={slug} data-pin-count={pins.length}>
          <span className="k-pins-h">
            <Icon name="pin" />
            Pinned
          </span>
          {shown.map((p) => (
            <PinCard key={p.id} p={p} slug={slug} now={now} refetch={refetch} busy={busy} />
          ))}
          <span className="k-rest">
            {rest > 0 ? (
              <button type="button" className="k-more" data-pins-more={rest} onClick={() => setAll(true)}>
                +{rest} more
              </button>
            ) : all && pins.length > PINS_SHOWN ? (
              <button type="button" className="k-more" onClick={() => setAll(false)}>
                fewer
              </button>
            ) : null}
            <button type="button" className="k-btn icon" data-pin-add={slug} aria-label="Pin a document" title="Pin a document" onClick={() => setAdding(true)}>
              <Icon name="plus" />
            </button>
          </span>
        </div>
      ) : null}
      {adding ? <PinForm slug={slug} refetch={refetch} onClose={() => setAdding(false)} busy={busy} /> : null}
      <PageError where={`pins:${slug}`} />
    </>
  );
}
