// Pinned documents (2026-11-17): a strip directly under a project's message box, above its goal. Up to four small cards
// (a neutral kind icon, the title, "updated …"), then "+N more" and "+"; hidden while there are none. A click opens the
// target inside bb (openInBb): a file in bb's file preview pane, a URL through bb's link handling, a deliverable on the
// Deliverables tab. The pin's ⋯: Open, Copy path, Unpin. "+" (or "Pin a document…" in the project's ⋯) opens a paste
// field. The plugin never serves a pinned page itself.
// 2026-11-17 (the shadcn pass): each pin an outline box with a ghost Button that opens it and app/ui's DropdownMenu; the
// paste field an Input; the rest Buttons.
import { useState, type FormEvent } from "react";
import type { z } from "zod";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { WRITES, type ProjectBook, type pinBody, type unpinBody } from "../contract.ts";
import { Copy, Ellipsis, PanelRight, PinOff, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { openInBb, type Openable } from "./open-proof.ts";
import { panel } from "./refs.ts";
import { write } from "./store.ts";
import { Btn, PageError } from "./ui.tsx";
import { Icon } from "./kit-ui.tsx";
import { PINS_SHOWN, pinWhen } from "./kit.ts";

export type PinView = NonNullable<ProjectBook["pins"]>[number];

export const pinsCss = /* css */ `
[data-orch] .k-pins { display: flex; align-items: stretch; gap: 8px; min-width: 0; }
[data-orch] .k-pins-h { display: inline-flex; align-items: center; gap: 4px; flex: none; width: 64px; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--orch-muted); }
[data-orch] .k-pin { display: grid; grid-template-columns: minmax(0, 1fr) 32px; align-items: center; flex: 0 1 232px; min-width: 0; height: 48px; padding: 0 4px 0 0; }
[data-orch] .k-pin .k-pt { min-width: 0; display: flex; flex-direction: column; }
[data-orch] .k-pin[data-missing="true"] .k-pt span { color: var(--warning-text); }
[data-orch] .k-pins .k-rest { display: inline-flex; align-items: center; gap: 4px; flex: none; }
[data-orch] .k-pins.all { flex-wrap: wrap; }
[data-orch] .k-pins.all .k-pin { flex-basis: 232px; }
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
    <div className="k-pin rounded-lg border bg-card hover:bg-accent/50" data-pin={p.id} data-pin-kind={p.kind} data-missing={p.missing ? "true" : "false"}>
      <Button variant="ghost" className="h-full min-w-0 justify-start gap-2 rounded-lg py-0 pr-0 pl-3 text-left font-normal hover:bg-transparent" data-open-in-bb="" data-pin-open={p.id} title={where} onClick={open}>
        <span className="inline-flex shrink-0 text-muted-foreground">
          <Icon name={p.icon} label={KIND_WORD[p.icon]} />
        </span>
        <span className="k-pt">
          <span className="truncate text-sm font-semibold">{p.title}</span>
          <span className="truncate text-xs text-muted-foreground">{failed ? "couldn't open it here" : pinWhen(p, now)}</span>
        </span>
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Btn tone="ghost" size="sm" icon={<Ellipsis aria-hidden />} data-pin-more={p.id} aria-label={`More for ${p.title}`} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label={p.title}>
          <DropdownMenuItem data-pin-menu-open={p.id} onSelect={open}>
            <PanelRight aria-hidden />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem data-pin-copy={p.id} onSelect={() => void navigator.clipboard?.writeText(where).catch(() => {})}>
            <Copy aria-hidden />
            {p.kind === "link" ? "Copy link" : p.kind === "deliverable" ? "Copy id" : "Copy path"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} data-unpin={p.id} onSelect={unpin}>
            <PinOff aria-hidden />
            {`Unpin from ${slug}`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
    <form className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2" data-pin-form={slug} onSubmit={(e) => void submit(e)}>
      <Input
        className="min-w-0 flex-[1_1_320px]"
        autoFocus
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        onKeyDown={(e) => (e.key === "Escape" ? onClose() : undefined)}
        placeholder="Paste a path or a link"
        aria-label={`Pin a document to ${slug}`}
        data-pin-input={slug}
      />
      <Btn type="submit" tone="primary" data-pin-submit={slug} disabled={busy || !target.trim()}>
        <Icon name="pin" />
        Pin
      </Btn>
      <Btn tone="ghost" onClick={onClose}>
        Cancel
      </Btn>
      <span className="basis-full text-xs text-muted-foreground">A file in the project's folders, a link, or a deliverable.</span>
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
              <Btn tone="ghost" size="sm" className="text-muted-foreground" data-pins-more={rest} onClick={() => setAll(true)}>
                +{rest} more
              </Btn>
            ) : all && pins.length > PINS_SHOWN ? (
              <Btn tone="ghost" size="sm" className="text-muted-foreground" onClick={() => setAll(false)}>
                fewer
              </Btn>
            ) : null}
            <Btn tone="ghost" size="sm" icon={<Plus aria-hidden />} data-pin-add={slug} aria-label="Pin a document" title="Pin a document" onClick={() => setAdding(true)} />
          </span>
        </div>
      ) : null}
      {adding ? <PinForm slug={slug} refetch={refetch} onClose={() => setAdding(false)} busy={busy} /> : null}
      <PageError where={`pins:${slug}`} />
    </>
  );
}
