// Board (mail rows, dead letters, agents, recent decisions) and Rules (list, add, revoke), as cards with rows.
// Their writes go through the same page gate as Needs you: one at a time, every write off while one is in flight.
// 2026-11-17: shadcn's Card, Item rows with Separators, Input and Label fields, Checkbox, and an AlertDialog to archive;
// loading and read errors are the shared ReadState.
import { Children, Fragment, useId, useState, type ComponentProps, type FormEvent, type ReactElement, type ReactNode } from "react";
import { WRITES, type Board, type archiveBody, type resendBody, type ruleAddBody, type ruleRevokeBody } from "../contract.ts";
import type { z } from "zod";
import { AgentFace } from "./face.tsx";
import { gate, useGate, write } from "./store.ts";
import { KIND_TONES, ROLE_TONES, ruleState } from "./palette.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog.tsx";
import { Button } from "./ui/button.tsx";
import { Card, CardContent } from "./ui/card.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { Input } from "./ui/input.tsx";
import { Item, ItemActions, ItemContent, ItemFooter, ItemGroup, ItemSeparator, ItemTitle } from "./ui/item.tsx";
import { Label } from "./ui/label.tsx";
import { Btn, Kind, Muted, PageError, ReadState, Section, Tag, Who, cx, when } from "./ui.tsx";
import { ownerOnScreen } from "../core/owner.ts";
import { useIdentity } from "./identity.ts";
import { WatchersSection } from "./watchers.tsx";

type Query = { data: Board | undefined; error: { message: string } | null; refetch: () => Promise<void> };

function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240 || text.split("\n").length > 3;
  return (
    <div>
      <p className={cx("m-0 whitespace-pre-wrap text-xs text-muted-foreground [overflow-wrap:anywhere]", !open && long && "line-clamp-3")}>{text}</p>
      {long ? (
        <Button variant="link" size="xs" className="h-6 px-0 text-foreground" onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"}
        </Button>
      ) : null}
    </div>
  );
}

/** One row in a card's list: the main line, a quiet line under it, something on the end, and anything under them. */
function Row({ main, meta, end, children, ...p }: { main: ReactNode; meta?: ReactNode; end?: ReactNode; children?: ReactNode; [data: `data-${string}`]: string | undefined }) {
  return (
    <Item role="listitem" size="sm" className="items-start gap-x-3 gap-y-1 px-0 py-2.5" {...p}>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="w-full [overflow-wrap:anywhere]">{main}</ItemTitle>
        {meta ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">{meta}</div> : null}
      </ItemContent>
      {end ? <ItemActions className="shrink-0">{end}</ItemActions> : null}
      {children ? <ItemFooter className="block min-w-0">{children}</ItemFooter> : null}
    </Item>
  );
}

/** A card's list: its rows with a separator between each two. Each keeps its row's own key, so a new row on top
 * remounts none below it (an open Archive dialog or an opened More stays as it was). */
function Rows({ children }: { children: ReactNode }) {
  return (
    <ItemGroup>
      {Children.toArray(children).map((c, i) => (
        <Fragment key={(c as ReactElement).key ?? i}>
          {i > 0 ? <ItemSeparator /> : null}
          {c}
        </Fragment>
      ))}
    </ItemGroup>
  );
}

/** A labelled text field: shadcn's Label over its Input. */
function Field({ label, optional, ...p }: ComponentProps<typeof Input> & { label: string; optional?: boolean }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">optional</span> : null}
      </Label>
      <Input id={id} {...p} />
    </div>
  );
}

/** What the colours mean: roles are an avatar and an address, kinds a tinted badge. */
function Legend() {
  const { ownerName } = useIdentity();
  return (
    <Card data-legend="" className="py-3">
      <CardContent className="flex flex-col gap-2 px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="w-10 text-muted-foreground">Who</span>
        {Object.entries(ROLE_TONES).map(([k, t]) => (
          <Who key={k} address={k === "system" ? "orchestrator" : k} nowrap>
            {k === "person" ? `${ownerOnScreen(ownerName).name} · ${t.label}` : t.label}
          </Who>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs">
        <span className="w-10 shrink-0 text-muted-foreground">What</span>
        {Object.entries(KIND_TONES).map(([k, t]) => (
          <Kind key={k} of={t.covers[0]}>
            {[...new Set([t.label, ...t.covers])].join(" · ")}
          </Kind>
        ))}
      </div>
      </CardContent>
    </Card>
  );
}

/**
 * A resolved thread's Archive, shown only when resolve couldn't archive it in bb: a first click asks (an AlertDialog); the
 * second archives. The dialog stays open until the write lands, with its error in it if it fails.
 */
function Archive({ threadId, busy, refetchAll }: { threadId: string; busy: boolean; refetchAll: () => void }) {
  const [open, setOpen] = useState(false);
  const archive = async () => {
    const body: z.input<typeof archiveBody> = { threadId };
    const out = await write(WRITES.archive, body, { kind: "other", where: `archive:${threadId}`, after: refetchAll });
    if (out?.ok) setOpen(false);
  };
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Btn data-archive={threadId} disabled={busy}>
          Archive
        </Btn>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this thread in bb?</AlertDialogTitle>
          <AlertDialogDescription>The branch stays.</AlertDialogDescription>
        </AlertDialogHeader>
        <PageError where={`archive:${threadId}`} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-archive-confirm={threadId}
            disabled={busy}
            onClick={(e) => {
              e.preventDefault(); // stays open until the write lands
              void archive();
            }}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function BoardView({ q, refetchAll }: { q: Query; refetchAll: () => void }) {
  useGate();
  const b = q.data;
  const busy = gate.lock !== null;
  if (!b) return <ReadState q={q} what="the board" />;
  const rows = [...b.rows].sort((x, y) => y.at - x.at);
  const archived = new Set(b.rows.filter((r) => r.kind === "archived" && r.ref).map((r) => r.ref));
  const resend = (id: string) => {
    const body: z.input<typeof resendBody> = { id };
    void write(WRITES.resend, body, { kind: "other", where: `resend:${id}`, after: refetchAll });
  };
  return (
    <div className="flex flex-col gap-4 pb-8">
      <Legend />
      <ReadState q={q} what="the board" />
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
              {d.note ? <p className="m-0 mt-1 text-xs text-(--orch-danger)">{d.note}</p> : null}
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
                <div className="mt-1 flex justify-end">
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
                  <AgentFace face={a} address={a.address} size={28} />
                  <Who address={a.address} nowrap />
                </span>
              }
              meta={
                <>
                  <span>{a.project ?? "no project"}</span>
                  <span className="font-mono">{a.threadId}</span>
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
                  <span className="font-mono">{d.id}</span>
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
              {d.answer ? <p className="m-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">Answer: {d.answer}</p> : null}
              {d.ack ? <p className="m-0 mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">Ack: {d.ack}</p> : null}
            </Row>
          ))}
        </Rows>
      </Section>
    </div>
  );
}

const KINDS = ["question", "plan", "practice"] as const;
type RuleKind = (typeof KINDS)[number];

/** A practice stands alone (it settles nothing): ticking it clears question and plan, and ticking either clears it. */
const tick = (s: Record<RuleKind, boolean>, k: RuleKind, on: boolean): Record<RuleKind, boolean> =>
  !on ? { ...s, [k]: false } : k === "practice" ? { question: false, plan: false, practice: true } : { ...s, [k]: true, practice: false };

export function RulesView({ q, refetchAll }: { q: Query; refetchAll: () => void }) {
  useGate();
  const [text, setText] = useState("");
  const [project, setProject] = useState("");
  const [kinds, setKinds] = useState<Record<RuleKind, boolean>>({ question: true, plan: false, practice: false });
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

      <Card>
        <CardContent>
        <form data-rule-form="" onSubmit={(e) => void submit(e)} className="grid gap-4">
          <Field name="text" label="Rule" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="e.g. approve dependency bumps in alpha" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="project" label="Project" optional value={project} onChange={(e) => setProject(e.target.value)} placeholder="Slug; empty: all projects" />
            <Field name="days" label="Expires in days" optional value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" placeholder="Empty: never" />
          </div>
          <Field name="source" label="Source" value={source} onChange={(e) => setSource(e.target.value)} maxLength={200} placeholder="e.g. said in chat 2026-11-13" />
          <div className="flex flex-wrap items-center gap-4">
            {KINDS.map((k) => (
              <Label key={k} className="min-h-6 cursor-pointer font-normal">
                <Checkbox name={`kind-${k}`} data-kind={k} checked={kinds[k]} onCheckedChange={(c) => setKinds((s) => tick(s, k, c === true))} />
                {k}
              </Label>
            ))}
            <span className="ml-auto" />
            <Btn type="submit" tone="primary" disabled={busy}>
              Add rule
            </Btn>
          </div>
          {invalid ? <p className="m-0 text-xs text-(--orch-danger)">{invalid}</p> : null}
        </form>
        </CardContent>
      </Card>

      {!b ? (
        <ReadState q={q} what="the board" />
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
                  main={<span className={cx(st !== "live" && "font-normal text-muted-foreground")}>{r.text}</span>}
                  meta={
                    <>
                      <Kind of={st}>{st === "revoked" ? `revoked ${when(r.revokedAt)}` : st}</Kind>
                      <span className="font-mono">{r.id}</span>
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
