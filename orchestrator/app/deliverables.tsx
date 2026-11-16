// Deliverables (docs/deliverables-plan.md): what leads hand the owner, each with its proof shown inline, newest first. The owner
// approves one, or requests changes in their own words and the lead re-delivers. Approved and sent-back ones move to
// Recent. Writes go through the page's one write gate (store.ts): one at a time, every button off while one is in
// flight, and each write carries the revision the owner is looking at (a newer one is refused, never approved blind).
import { useEffect, useRef, useState } from "react";
import { Markdown, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { PROOF_ROUTE, WRITE_BASE, WRITES, type Deliverables, type approveBody, type requestChangesBody } from "../contract.ts";
import { Card, CardContent, CardHeader } from "./affect/card-clean.tsx";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { TextArea } from "./affect/text-area-clean.tsx";
import { MonSprite } from "./mon.tsx";
import { Blocks } from "./blocks.tsx";
import { lessText } from "./less-text.ts";
import { Points } from "./visual-blocks.tsx";
import { prKind } from "./palette.ts";
import { gate, useGate, write } from "./store.ts";
import { APPROVE_MS, pressApprove } from "./keys.ts";
import { keyState, say, emitKeys } from "./key-state.ts";
import { useViewKeys } from "./key-view.ts";
import { age } from "./lanes.ts";
import { Btn, Kind, Muted, PageError, ReadState, Section, Who, cx, when } from "./ui.tsx";

type Deliverable = Deliverables[number];
type Proof = Deliverable["revisions"][number]["proof"][number];
type Query = { data: Deliverables | undefined; error: { message: string } | null; refetch: () => Promise<void> };

const TEXT_LINES = 200;
const RECENT = 20;
const proofSrc = (id: string) => `${WRITE_BASE}${PROOF_ROUTE}?id=${encodeURIComponent(id)}`;

/** In review, newest first: what the Deliverables tab and the badges count. */
export const inReview = (all: Deliverables | undefined): Deliverable[] => (all ?? []).filter((d) => d.state === "review").sort((a, b) => b.updatedAt - a.updatedAt);

/** A Markdown proof (a .md or .markdown file) is rendered the way bb renders a chat message, not shown as its source. */
const isMarkdown = (p: { path?: string | null; caption: string }) => /\.(md|markdown)$/i.test(p.path ?? "");

/**
 * A text proof: the first TEXT_LINES lines of the (already capped) file. A fixed-height box, so Approve never moves;
 * long lines wrap inside the card (2026-11-13: a wide report ran past the card's edge).
 */
function TextProof({ id, markdown }: { id: string; markdown: boolean }) {
  const [text, setText] = useState<{ lines: string[]; more: number } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(proofSrc(id))
      .then(async (r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => {
        const all = t.split("\n");
        if (live) setText({ lines: all.slice(0, TEXT_LINES), more: Math.max(0, all.length - TEXT_LINES) });
      })
      .catch((e: unknown) => live && setText({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [id]);
  if (text && "error" in text) return <p className="orch-danger m-0 text-xs">Can't show this file: {text.error}</p>;
  return (
    <>
      {markdown && text ? (
        <div className="orch-wash max-h-96 min-w-0 max-w-full overflow-x-hidden overflow-y-auto p-3 text-sm [overflow-wrap:anywhere]">
          <Markdown content={text.lines.join("\n")} />
        </div>
      ) : (
        <pre className="orch-mono orch-wash m-0 max-h-64 min-w-0 max-w-full overflow-auto p-2 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{text ? text.lines.join("\n") : "Loading…"}</pre>
      )}
      {text && text.more > 0 ? <p className="orch-muted m-0 text-xs">{text.more} more lines not shown.</p> : null}
    </>
  );
}

/** A PR's number from its URL, for a PR pr-watch doesn't follow (it shows no live state then, but still says which). */
const prNumber = (url: string | null | undefined) => url?.match(/\/pull\/(\d+)/)?.[1] ?? null;

function ProofView({ p }: { p: Proof }) {
  const navigate = useBbNavigate();
  const [unopened, setUnopened] = useState(false);
  const caption = <figcaption className="orch-muted mt-1 text-xs [overflow-wrap:anywhere]">{p.caption}</figcaption>;
  if (p.kind === "image")
    return (
      <figure className="m-0" data-proof={p.id}>
        {/* full size in a new tab */}
        <a href={proofSrc(p.id)} target="_blank" rel="noopener noreferrer" className="orch-shot inline-block max-w-full">
          <img src={proofSrc(p.id)} alt={p.caption} loading="lazy" decoding="async" className="block h-auto max-h-80 w-auto max-w-full cursor-zoom-in" />
        </a>
        {caption}
      </figure>
    );
  if (p.kind === "video")
    return (
      <figure className="m-0" data-proof={p.id}>
        <video src={proofSrc(p.id)} controls preload="metadata" className="orch-shot block h-64 w-full" />
        {caption}
      </figure>
    );
  if (p.kind === "text")
    return (
      <figure className="m-0 min-w-0 max-w-full" data-proof={p.id}>
        <TextProof id={p.id} markdown={isMarkdown(p)} />
        {caption}
      </figure>
    );
  if (p.kind === "pr")
    return (
      <div className="flex flex-wrap items-center gap-2" data-proof={p.id}>
        <a href={p.url ?? undefined} target="_blank" rel="noopener noreferrer" className="no-underline">
          <Kind of="pr" group={p.pr ? prKind(p.pr) : undefined}>
            {p.pr ? `PR${p.pr.number ? ` #${p.pr.number}` : ""} · ${p.pr.state ?? "?"}${p.pr.attention && p.pr.attention !== "none" && p.pr.attention !== p.pr.state ? ` · ${p.pr.attention.replace(/_/g, " ")}` : ""}${p.pr.checks ? ` · checks ${p.pr.checks}` : ""}` : `PR${prNumber(p.url) ? ` #${prNumber(p.url)}` : ""}`}
          </Kind>
        </a>
        <span className="orch-muted text-xs [overflow-wrap:anywhere]">{p.caption}</span>
      </div>
    );
  // a doc or a link: a file opens in bb's preview on its host, a URL in a new tab
  const open = () => {
    const ok = p.hostId && p.path ? navigate.experimental_openFilePreview({ target: { kind: "host", hostId: p.hostId, path: p.path }, location: null }) : false;
    setUnopened(!ok);
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-proof={p.id}>
      {p.url ? (
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-inherit underline-offset-2 hover:underline [overflow-wrap:anywhere]">
          {p.kind === "doc" ? "Open doc" : "Open link"} ↗
        </a>
      ) : (
        <Btn onClick={open}>Open doc</Btn>
      )}
      <Kind of={p.kind} />
      <span className="orch-muted text-xs [overflow-wrap:anywhere]">{p.caption}</span>
      {unopened ? (
        <span role="alert" className="orch-danger text-xs">
          bb couldn't open this file here.
        </span>
      ) : null}
    </div>
  );
}

/**
 * The next-action box, then Request changes and the primary button (2026-11-16: "what I usually have to do is say
 * next move: send this to someone"). Empty box: "Done, nothing more" approves and the lead does nothing further. Words
 * in it: "Send to lead" approves and hands the lead those words as an item they must act on and report back on.
 * Request changes opens its own field; the next box's words are never sent as a change request. Off while any write runs.
 */
function Review({ d, refetchAll }: { d: Deliverable; refetchAll: () => void }) {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const [next, setNext] = useState("");
  const busy = gate.lock !== null;
  const action = next.trim();
  const approve = async () => {
    const body: z.input<typeof approveBody> = { id: d.id, rev: d.rev, note: null, next: action || null };
    const out = await write(WRITES.approve, body, { kind: "other", where: d.id, after: refetchAll });
    if (out?.ok) setNext("");
  };
  const sendBack = async () => {
    const body: z.input<typeof requestChangesBody> = { id: d.id, rev: d.rev, text: text.trim() };
    const out = await write(WRITES.requestChanges, body, { kind: "other", where: d.id, after: refetchAll });
    if (out?.ok) {
      setAsking(false);
      setText("");
    }
  };
  return (
    <div className="mt-3 grid gap-2">
      {asking ? (
        <>
          <TextArea label="What to change" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} minRows={3} placeholder="The lead gets these words and re-delivers" data-changes-text={d.id} />
          <div className="flex flex-wrap justify-end gap-2">
            <Btn tone="ghost" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </Btn>
            <Btn tone="primary" data-changes-send={d.id} disabled={busy || !text.trim()} onClick={() => void sendBack()}>
              Send back
            </Btn>
          </div>
        </>
      ) : (
        <>
          <TextArea
            aria-label="Next move"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            maxLength={4000}
            minRows={1}
            maxRows={4}
            placeholder="Next move? e.g. forward this to the team"
            data-next-text={d.id}
            onSubmitShortcut={() => !busy && action && void approve()}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Btn data-changes={d.id} disabled={busy} onClick={() => setAsking(true)}>
              Request changes
            </Btn>
            <Btn
              tone="primary"
              data-approve={d.id}
              data-next-send={action ? d.id : undefined}
              title={action ? "Approve, and the lead does this next" : "Closes it; the lead does nothing further"}
              disabled={busy}
              onClick={() => void approve()}
            >
              {action ? "Send to lead" : "Done, nothing more"}
            </Btn>
          </div>
          {/* said under the button, not only in its tooltip: a phone has no hover */}
          <p data-approve-hint="" className="orch-muted m-0 text-right text-xs">
            {action ? "Approves it; the lead does this and reports back" : "Closes it; the lead does nothing further"}
          </p>
        </>
      )}
      <PageError where={d.id} />
    </div>
  );
}

// Green is for "done" only. "replied" (the lead answered the item with a reply that names it) says they answered, not
// that the next action was carried out, so it stays amber: an ack must not read as done when it isn't.
const NEXT_TONE: Record<string, "done" | "deferred" | "alarm" | "inactive"> = { done: "done", replied: "deferred", refused: "alarm", failed: "alarm", superseded: "inactive" };

/** "Next: forward to the team → done · "posted in #channel" · 12m": the owner's next action and how the lead closed it. */
export function NextLine({ n }: { n: NonNullable<Deliverable["next"]> }) {
  return (
    <p data-next={n.state} className="m-0 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs [overflow-wrap:anywhere]">
      <span className="orch-muted">Next:</span>
      <span className="font-medium">{n.text}</span>
      <span className="orch-muted">→</span>
      {n.state === "closed" ? (
        <>
          <Kind of={n.outcome ?? "closed"} group={NEXT_TONE[n.outcome ?? ""] ?? "inactive"} data-next-outcome={n.outcome ?? ""}>
            {n.outcome ?? "closed"}
          </Kind>
          <span>
            {n.note ? <span data-next-note="">· “{n.note}” </span> : null}
            {n.closedAt ? <span className="orch-muted">· {age(n.closedAt, Date.now())}</span> : null}
          </span>
        </>
      ) : n.state === "dead" ? (
        <Kind of="dead">not delivered</Kind>
      ) : (
        <Kind of="deferred" data-next-outcome="">with the lead</Kind>
      )}
    </p>
  );
}

/** Earlier revisions and the owner's feedback on each, folded under the card. */
function History({ d }: { d: Deliverable }) {
  const earlier = d.revisions.filter((r) => r.rev < d.rev);
  if (earlier.length === 0 && d.feedback.length === 0) return null;
  return (
    <details className="mt-3 text-xs">
      <summary className="orch-muted cursor-pointer">History ({d.revisions.length} revision{d.revisions.length === 1 ? "" : "s"})</summary>
      <ol className="m-0 mt-2 grid list-none gap-2 p-0">
        {d.revisions.map((r) => (
          <li key={r.rev} className="orch-wash p-2">
            <div className="orch-muted">
              rev {r.rev} · {when(r.at)} · {r.proof.length} proof
            </div>
            <div className="mt-1 min-w-0 [overflow-wrap:anywhere]"><Markdown content={r.summary} /></div>
            {d.feedback
              .filter((f) => f.rev === r.rev)
              .map((f) => (
                <p key={f.at} className="m-0 mt-1 flex flex-wrap items-center gap-1.5 [overflow-wrap:anywhere]">
                  <Kind of={f.outcome}>{f.outcome === "changes" ? "changes requested" : "approved"}</Kind>
                  <span className="orch-muted">{when(f.at)}</span>
                  {f.text ? <span className="whitespace-pre-wrap">{f.text}</span> : null}
                </p>
              ))}
            {d.next?.rev === r.rev ? <NextLine n={d.next} /> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function DeliverableCard({ d, refetchAll }: { d: Deliverable; refetchAll: () => void }) {
  const latest = d.revisions.find((r) => r.rev === d.rev) ?? d.revisions[d.revisions.length - 1];
  const proof = latest?.proof ?? [];
  const media = proof.filter((p) => p.kind === "image" || p.kind === "video");
  const rest = proof.filter((p) => p.kind !== "image" && p.kind !== "video");
  const short = latest ? lessText(latest) : null;
  if (short && latest) return <ShortCard d={d} rev={latest} layout={short} media={media} rest={rest} refetchAll={refetchAll} />;
  return (
    <Card as="article" data-deliverable={d.id}>
      <CardHeader title={d.title} titleAs="h3" description={d.project ?? "No project"} action={<Kind of="review">{d.rev > 1 ? `in review · rev ${d.rev}` : "in review"}</Kind>} />
      <CardContent>
        <div className="orch-muted flex flex-wrap items-center gap-2 text-xs">
          <MonSprite mon={d.leadMon} address={d.lead} size={28} />
          <Who address={d.lead} nowrap />
          <span>{when(d.updatedAt)}</span>
        </div>
        <div className="mt-2 min-w-0 [overflow-wrap:anywhere]"><Markdown content={d.summary} /></div>
        {/* Requested 2026-11-13: "a lot more visual". What it looks like first (screenshots, video), then the typed
            parts (decisions, diagram, root cause, what to change, checks), then the rest of the proof. */}
        {media.length > 0 ? (
          <div data-gallery="" className={cx("mt-3 grid gap-3", media.length > 1 && "orch-gallery")}>
            {media.map((p) => (
              <ProofView key={p.id} p={p} />
            ))}
          </div>
        ) : null}
        <Blocks blocks={latest?.blocks ?? []} prs={latest?.prs ?? []} />
        {rest.length > 0 ? (
          <div className="mt-3 grid gap-3">
            {rest.map((p) => (
              <ProofView key={p.id} p={p} />
            ))}
          </div>
        ) : null}
        <Review d={d} refetchAll={refetchAll} />
        <History d={d} />
      </CardContent>
    </Card>
  );
}

/** A deliverable with points (2026-11-14, "way less text"): pictures, then each decision and finding in a line; the rest closed. */
function ShortCard({ d, rev, layout, media, rest, refetchAll }: { d: Deliverable; rev: Deliverable["revisions"][number]; layout: NonNullable<ReturnType<typeof lessText>>; media: Proof[]; rest: Proof[]; refetchAll: () => void }) {
  const part = (p: (typeof layout.parts)[number]) => {
    switch (p) {
      case "context":
        return (
          <p key={p} data-context-line="" className="orch-muted m-0 mt-2 text-sm [overflow-wrap:anywhere]">
            {rev.summary}
          </p>
        );
      case "media":
        return media.length > 0 ? (
          <div key={p} data-gallery="" className={cx("mt-3 grid gap-3", media.length > 1 && "orch-gallery")}>
            {media.map((m) => (
              <ProofView key={m.id} p={m} />
            ))}
          </div>
        ) : null;
      case "visuals":
        return <Blocks key={p} blocks={rev.blocks} prs={rev.prs} only={layout.visual} />;
      case "points":
        return (
          <div key={p} className="mt-3">
            <Points points={rev.points} />
          </div>
        );
      case "review":
        return <Review key={p} d={d} refetchAll={refetchAll} />;
      case "details":
        // no open attribute: Details starts closed, and React never closes it again on a re-render
        return (
          <details key={p} data-details="" className="mt-3">
            <summary className="orch-muted cursor-pointer text-sm">{layout.detailsLabel}</summary>
            <Blocks blocks={rev.blocks} prs={rev.prs} only={layout.rest} />
            {rest.length > 0 ? (
              <div className="mt-3 grid gap-3">
                {rest.map((r) => (
                  <ProofView key={r.id} p={r} />
                ))}
              </div>
            ) : null}
          </details>
        );
      case "history":
        return <History key={p} d={d} />;
    }
  };
  return (
    <Card as="article" data-deliverable={d.id} data-layout="short">
      <CardHeader title={d.title} titleAs="h3" description={d.project ?? "No project"} action={<Kind of="review">{d.rev > 1 ? `in review · rev ${d.rev}` : "in review"}</Kind>} />
      <CardContent>
        <div className="orch-muted flex flex-wrap items-center gap-2 text-xs">
          <MonSprite mon={d.leadMon} address={d.lead} size={28} />
          <Who address={d.lead} nowrap />
          <span>{when(d.updatedAt)}</span>
        </div>
        {layout.parts.map(part)}
      </CardContent>
    </Card>
  );
}

export function DeliverablesView({ q, refetchAll }: { q: Query; refetchAll: () => void }) {
  useGate();
  const root = useRef<HTMLDivElement>(null);
  // Keys (2026-11-16): J/K select a deliverable; A, twice within APPROVE_MS, is "Done, nothing more". It clicks the card's own
  // button, so the page lock applies; with words in the next-move box the button is "Send to lead", which A never presses.
  useViewKeys("deliverables", root, "[data-deliverable]", (el) => el.dataset.deliverable ?? "", (a, sel) => {
    if (a.t !== "approve" || !sel) return false;
    const btn = sel.el.querySelector<HTMLButtonElement>(`[data-approve="${CSS.escape(sel.id)}"]`);
    if (!btn || btn.disabled) {
      say("Can't close this one now");
      return true;
    }
    if (btn.hasAttribute("data-next-send")) {
      say("The next-move box has words: use Send to lead");
      return true;
    }
    const r = pressApprove(keyState.arm, sel.id, performance.now());
    keyState.arm = r.arm;
    if (r.fire) {
      say("Closed", 1200);
      btn.click();
    } else {
      say("Press A again to close", APPROVE_MS);
      emitKeys();
    }
    return true;
  });
  if (!q.data) return <ReadState q={q} what="the deliverables" />;
  const review = inReview(q.data);
  const recent = q.data.filter((d) => d.state === "approved" || d.state === "changes").slice(0, RECENT);
  return (
    <div ref={root} className="flex flex-col gap-4 pb-8">
      <ReadState q={q} what="the deliverables" />
      {review.length === 0 ? (
        <EmptyState title="Nothing to review" text="Leads deliver finished work here with proof (orch_deliver). You approve it or send it back." />
      ) : (
        review.map((d) => <DeliverableCard key={d.id} d={d} refetchAll={refetchAll} />)
      )}
      <Section title="Recent" count={recent.length} data-recent="">
        {recent.length === 0 ? <Muted>None yet.</Muted> : null}
        <ul className="orch-rows m-0 list-none p-0">
          {recent.map((d) => {
            const last = d.feedback[d.feedback.length - 1];
            return (
              <li key={d.id} data-recent-deliverable={d.id} className="py-2.5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium [overflow-wrap:anywhere]">{d.title}</div>
                    <div className="orch-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <Who address={d.lead} nowrap />
                      <span>rev {d.rev}</span>
                      <span>{when(d.updatedAt)}</span>
                    </div>
                  </div>
                  <Kind of={d.state}>{d.state === "changes" ? "changes requested" : d.state}</Kind>
                </div>
                {last?.text ? <p className="orch-muted m-0 mt-1 whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{last.text}</p> : null}
                {d.next ? <NextLine n={d.next} /> : null}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
