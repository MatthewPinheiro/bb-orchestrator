// Board (mail rows, dead letters, agents, recent decisions) and Rules (list, add, revoke), as affectUI cards with rows.
// Their writes go through the same page gate as Needs you: one at a time, every write off while one is in flight.
import { useState, type FormEvent, type ReactNode } from "react";
import { WRITES, type Board, type archiveBody, type resendBody, type ruleAddBody, type ruleRevokeBody } from "../contract.ts";
import type { z } from "zod";
import { Card } from "./affect/card-clean.tsx";
import { Checkbox } from "./affect/checkbox-clean.tsx";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { TextField } from "./affect/text-field-clean.tsx";
import { MonSprite } from "./mon.tsx";
import { gate, useGate, write } from "./store.ts";
import { KIND_TONES, ROLE_TONES, ruleState } from "./palette.ts";
import { Btn, Kind, Muted, PageError, Section, Tag, Who, cx, when } from "./ui.tsx";
import { ownerOnScreen } from "../core/owner.ts";
import { useIdentity } from "./identity.ts";
import { WatchersSection } from "./watchers.tsx";

type Query = { data: Board | undefined; error: { message: string } | null; refetch: () => Promise<void> };

function Status({ q }: { q: Query }) {
  if (q.data) return q.error ? <p className="orch-danger m-0 mt-2 text-xs">Stale: {q.error.message}</p> : null;
  return q.error ? (
    <EmptyState title="Can't read the board" text={q.error.message} icon={null} action={<Btn onClick={() => void q.refetch()}>Retry</Btn>} />
  ) : (
    <Muted>Loading…</Muted>
  );
}

function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240 || text.split("\n").length > 3;
  return (
    <div className="mt-1">
      <p className={cx("orch-muted m-0 whitespace-pre-wrap text-xs [overflow-wrap:anywhere]", !open && long && "line-clamp-3")}>{text}</p>
      {long ? (
        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-inherit underline-offset-2 hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}

/** One row in a card's list: the main line, a quiet line under it, and something on the end. */
function Row({ main, meta, end, children, ...p }: { main: ReactNode; meta?: ReactNode; end?: ReactNode; children?: ReactNode; [data: `data-${string}`]: string | undefined }) {
  return (
    <li {...p} className="py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium [overflow-wrap:anywhere]">{main}</div>
          {meta ? <div className="orch-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">{meta}</div> : null}
        </div>
        {end ? <div className="flex shrink-0 items-center gap-2">{end}</div> : null}
      </div>
      {children}
    </li>
  );
}

const Rows = ({ children }: { children: ReactNode }) => <ul className="orch-rows m-0 list-none p-0">{children}</ul>;

/** What the colours mean: roles are an avatar and an address, kinds a tinted badge. */
function Legend() {
  const { ownerName } = useIdentity();
  return (
    <Card data-legend="" className="!gap-2 !py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="orch-muted w-10">Who</span>
        {Object.entries(ROLE_TONES).map(([k, t]) => (
          <Who key={k} address={k === "system" ? "orchestrator" : k} nowrap>
            {k === "person" ? `${ownerOnScreen(ownerName).name} · ${t.label}` : t.label}
          </Who>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs">
        <span className="orch-muted w-10 shrink-0">What</span>
        {Object.entries(KIND_TONES).map(([k, t]) => (
          <Kind key={k} of={t.covers[0]}>
            {[...new Set([t.label, ...t.covers])].join(" · ")}
          </Kind>
        ))}
      </div>
    </Card>
  );
}

/** A resolved thread's Archive, shown only when resolve couldn't archive it in bb: a first click asks, inline; the second archives. */
function Archive({ threadId, busy, refetchAll }: { threadId: string; busy: boolean; refetchAll: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Btn data-archive={threadId} disabled={busy} onClick={() => setAsking(true)}>
        Archive
      </Btn>
    );
  const archive = async () => {
    const body: z.input<typeof archiveBody> = { threadId };
    const out = await write(WRITES.archive, body, { kind: "other", where: `archive:${threadId}`, after: refetchAll });
    if (out?.ok) setAsking(false);
  };
  return (
    <div className="flex flex-col items-end">
      <span role="group" aria-label="Confirm archive" className="flex flex-wrap items-center justify-end gap-2">
        <span className="orch-muted text-xs">Archive this thread in bb? The branch stays.</span>
        <Btn tone="ghost" disabled={busy} onClick={() => setAsking(false)}>
          Cancel
        </Btn>
        <Btn tone="danger" data-archive-confirm={threadId} disabled={busy} onClick={() => void archive()}>
          Archive
        </Btn>
      </span>
      <PageError where={`archive:${threadId}`} />
    </div>
  );
}

export function BoardView({ q, refetchAll }: { q: Query; refetchAll: () => void }) {
  useGate();
  const b = q.data;
  const busy = gate.lock !== null;
  if (!b) return <Status q={q} />;
  const rows = [...b.rows].sort((x, y) => y.at - x.at);
  const archived = new Set(b.rows.filter((r) => r.kind === "archived" && r.ref).map((r) => r.ref));
  const resend = (id: string) => {
    const body: z.input<typeof resendBody> = { id };
    void write(WRITES.resend, body, { kind: "other", where: `resend:${id}`, after: refetchAll });
  };
  return (
    <div className="flex flex-col gap-4 pb-8">
      <Legend />
      <Status q={q} />
      <PageError where="board" />

      <Section title="Dead letters" count={b.dead.length}>
        {b.dead.length === 0 ? <Muted>None.</Muted> : null}
        <Rows>
          {b.dead.map((d) => (
            <Row
              key={d.id}
              data-dead={d.id}
              main={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <Who address={d.sender} nowrap /> → <Who address={d.recipient} nowrap />
                </span>
              }
              meta={
                <>
                  <Kind of="dead">dead</Kind>
                  <Kind of={d.kind} />
                  <span>{when(d.createdAt)}</span>
                </>
              }
              end={
                <Btn data-resend={d.id} disabled={busy} onClick={() => resend(d.id)}>
                  Resend
                </Btn>
              }
            >
              <Body text={d.body} />
              {d.note ? <p className="orch-danger m-0 mt-1 text-xs">{d.note}</p> : null}
              <PageError where={`resend:${d.id}`} />
            </Row>
          ))}
        </Rows>
      </Section>

      {b.watchers ? <WatchersSection w={b.watchers} agents={b.agents} busy={busy} refetchAll={refetchAll} /> : null}

      <Section title="Activity" count={rows.length}>
        {rows.length === 0 ? <Muted>Nothing yet.</Muted> : null}
        <Rows>
          {rows.map((r) => (
            <Row
              key={r.id}
              data-row={r.id}
              main={r.title}
              meta={
                <>
                  {r.from ? <Who address={r.from} nowrap /> : null}
                  {r.project ? <span>{r.project}</span> : null}
                  <span>{when(r.at)}</span>
                </>
              }
              end={<Kind of={r.kind} />}
            >
              {r.body ? <Body text={r.body} /> : null}
              {r.kind === "resolved" && r.ref && !archived.has(r.ref) ? (
                <div className="mt-2 flex justify-end">
                  <Archive threadId={r.ref} busy={busy} refetchAll={refetchAll} />
                </div>
              ) : null}
            </Row>
          ))}
        </Rows>
      </Section>

      <Section title="Agents" count={b.agents.length}>
        {b.agents.length === 0 ? <Muted>No agents with a role.</Muted> : null}
        <Rows>
          {b.agents.map((a) => (
            <Row
              key={a.threadId}
              data-agent={a.address}
              main={
                <span className="inline-flex items-center gap-2">
                  <MonSprite mon={a.mon} address={a.address} size={28} />
                  <Who address={a.address} nowrap />
                </span>
              }
              meta={
                <>
                  <span>{a.project ?? "no project"}</span>
                  <span className="orch-mono">{a.threadId}</span>
                </>
              }
              end={
                <>
                  <Who address={a.role} nowrap />
                  <Tag>{a.status}</Tag>
                </>
              }
            />
          ))}
        </Rows>
      </Section>

      <Section title="Decisions" count={b.decisions.length}>
        <Rows>
          {b.decisions.map((d) => (
            <Row
              key={d.id}
              data-decision={d.id}
              main={d.title}
              meta={
                <>
                  <span className="orch-mono">{d.id}</span>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Who address={d.origin} nowrap />
                    {d.asker !== d.origin ? (
                      <>
                        → <Who address={d.asker} nowrap />
                      </>
                    ) : null}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    at <Who address={d.level} nowrap />
                  </span>
                  <span>updated {when(d.updatedAt)}</span>
                </>
              }
              end={<Kind of={d.state} />}
            >
              {d.answer ? <p className="orch-muted m-0 mt-1 text-xs [overflow-wrap:anywhere]">Answer: {d.answer}</p> : null}
              {d.ack ? <p className="orch-muted m-0 mt-0.5 text-xs [overflow-wrap:anywhere]">Ack: {d.ack}</p> : null}
            </Row>
          ))}
        </Rows>
      </Section>
    </div>
  );
}

const KINDS = ["question", "plan"] as const;

export function RulesView({ q, refetchAll }: { q: Query; refetchAll: () => void }) {
  useGate();
  const [text, setText] = useState("");
  const [project, setProject] = useState("");
  const [kinds, setKinds] = useState<Record<(typeof KINDS)[number], boolean>>({ question: true, plan: false });
  const [days, setDays] = useState("");
  const [source, setSource] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const b = q.data;
  const busy = gate.lock !== null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const picked = KINDS.filter((k) => kinds[k]);
    const n = days.trim() === "" ? null : Number(days);
    const why = !text.trim() ? "Write the rule." : picked.length === 0 ? "Pick at least one kind." : n !== null && !(n > 0) ? "Expiry is a positive number of days, or empty for never." : !source.trim() ? "Say where the rule comes from." : null;
    setInvalid(why);
    if (why) return;
    const body: z.input<typeof ruleAddBody> = { text: text.trim(), project: project.trim() || null, kinds: picked, expiresInDays: n, source: source.trim() };
    const out = await write(WRITES.ruleAdd, body, { kind: "other", where: "rules", after: refetchAll });
    if (out?.ok) {
      setText("");
      setProject("");
      setDays("");
      setSource("");
    }
  };
  const revoke = (id: string) => {
    const body: z.input<typeof ruleRevokeBody> = { id };
    void write(WRITES.ruleRevoke, body, { kind: "other", where: "rules", after: refetchAll });
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageError where="rules" />

      <Card as="section">
        <form data-rule-form="" onSubmit={(e) => void submit(e)} className="grid gap-3">
          <TextField name="text" label="Rule" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="e.g. approve dependency bumps in alpha" />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="project" label="Project" optional value={project} onChange={(e) => setProject(e.target.value)} placeholder="Slug; empty: all projects" />
            <TextField name="days" label="Expires in days" optional value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" placeholder="Empty: never" />
          </div>
          <TextField name="source" label="Source" value={source} onChange={(e) => setSource(e.target.value)} maxLength={200} placeholder="e.g. said in chat 2026-11-13" />
          <div className="flex flex-wrap items-center gap-4">
            {KINDS.map((k) => (
              <Checkbox key={k} name={`kind-${k}`} data-kind={k} label={k} checked={kinds[k]} onChange={(e) => setKinds((s) => ({ ...s, [k]: e.target.checked }))} />
            ))}
            <span className="ml-auto" />
            <Btn type="submit" tone="primary" disabled={busy}>
              Add rule
            </Btn>
          </div>
          {invalid ? <p className="orch-danger m-0 text-xs">{invalid}</p> : null}
        </form>
      </Card>

      {!b ? (
        <Status q={q} />
      ) : (
        <Section title="Rules" count={b.rules.length}>
          {b.rules.length === 0 ? <Muted>No rules yet.</Muted> : null}
          <Rows>
            {b.rules.map((r) => {
              // no opacity on a revoked row: it would take its colours under their contrast; the text is muted instead
              const st = ruleState(r, Date.now());
              return (
                <Row
                  key={r.id}
                  data-rule={r.id}
                  data-revoked={r.revokedAt !== null ? "true" : "false"}
                  main={<span className={cx(st !== "live" && "orch-muted font-normal")}>{r.text}</span>}
                  meta={
                    <>
                      <Kind of={st}>{st === "revoked" ? `revoked ${when(r.revokedAt)}` : st}</Kind>
                      <span className="orch-mono">{r.id}</span>
                      <Tag>{r.project ?? "all"}</Tag>
                      {r.kinds.map((k) => (
                        <Tag key={k}>{k}</Tag>
                      ))}
                      <span>{r.expiresAt !== null ? `expires ${when(r.expiresAt)}` : "never expires"}</span>
                      <span>from {r.source}</span>
                      <span>added {when(r.createdAt)}</span>
                    </>
                  }
                  end={
                    r.revokedAt === null ? (
                      <Btn tone="danger" data-revoke={r.id} disabled={busy} onClick={() => revoke(r.id)}>
                        Revoke
                      </Btn>
                    ) : undefined
                  }
                />
              );
            })}
          </Rows>
        </Section>
      )}
    </div>
  );
}
