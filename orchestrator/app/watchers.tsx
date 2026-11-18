// The Watchers section on the Board (Activity) tab (2026-11-17, core/watchers.ts): every open PR wait and every timed
// job. The owner retargets, moves, drops and adds PR waits here, through the page gate like every other write. A job's
// interval is a plugin setting the page can't write, so a job with a setting shows the exact `bb plugin config` line to
// run (with the value the owner types), and a fixed job is read-only.
// 2026-11-17: shadcn's Item rows, Input, Select and Label fields, a Table for the jobs and an AlertDialog to drop a wait.
import { Fragment, useEffect, useId, useRef, useState, type ComponentProps, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import type { z } from "zod";
import { WRITES, type Board, type Watchers, type watchAddBody, type watchDropBody, type watchMoveBody, type watchRetargetBody } from "../contract.ts";
import { prRef } from "../core/open-prs.ts";
import { rel, settingCommand, type JobSetting } from "../core/watchers.ts";
import { ProofLink } from "./proof-link.tsx";
import { write } from "./store.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog.tsx";
import { Input } from "./ui/input.tsx";
import { Item, ItemActions, ItemContent, ItemFooter, ItemGroup, ItemSeparator, ItemTitle } from "./ui/item.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.tsx";
import { Btn, Muted, PageError, Section, Tag, Who, cx } from "./ui.tsx";

type Wait = Watchers["waits"][number];
type Job = Watchers["jobs"][number];
type Agents = Board["agents"];

const WHEN_WORDS: Record<string, string> = { approved: "approved", green: "green (checks passing)", ready: "ready to merge", merged: "merged" };

/** "widgets#7" for a GitHub PR URL; the URL's last parts otherwise. */
function prLabel(url: string): string {
  const m = /^https:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(url);
  return m ? prRef({ repo: m[1]!, number: Number(m[2]) }) : url;
}

function readingWords(r: NonNullable<Wait["reading"]>, now: number): string {
  const facts = [r.state, r.checks ? `checks ${r.checks}` : null, r.review && r.review !== "none" ? r.review.replace(/_/g, " ") : null].filter(Boolean).join(", ");
  const at = r.readAt ?? r.changedAt;
  return `${facts || "no state"} · ${r.source === "gh" ? "read with gh" : "bb's reading"} ${rel(at, now)}`;
}

/** A labelled text box in a wait's form; `grow` takes the row's spare room. */
function TextBox({ label, grow, ...p }: ComponentProps<typeof Input> & { label: string; grow?: boolean }) {
  const id = useId();
  return (
    <div className={cx("grid min-w-0 gap-2", grow && "flex-[1_1_16rem]")}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...p} />
    </div>
  );
}

/** A labelled choice in a wait's form: shadcn's Select. `placeholder` shows while nothing is picked (value ""). */
function Choice({ label, name, value, onChange, options, placeholder }: { label: string; name: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select name={name} value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="min-w-40">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const FORM = "mt-1 flex flex-wrap items-end gap-2 rounded-md bg-muted/50 p-3";

function WaitRow({ w, agents, busy, refetchAll, now, conditions }: { w: Wait; agents: Agents; busy: boolean; refetchAll: () => void; now: number; conditions: string[] }) {
  const [mode, setMode] = useState<null | "retarget" | "move">(null);
  const [dropping, setDropping] = useState(false);
  const [pr, setPr] = useState(w.prUrl);
  const [when, setWhen] = useState(w.when);
  const [to, setTo] = useState("");
  const where = `watch:${w.id}`;
  const done = (ok: boolean | undefined) => ok && setMode(null);
  const retarget = async (e: FormEvent) => {
    e.preventDefault();
    const body: z.input<typeof watchRetargetBody> = { id: w.id, pr: pr.trim() !== w.prUrl ? pr.trim() : null, when: when !== w.when ? (when as never) : null };
    done((await write(WRITES.watchRetarget, body, { kind: "other", where, after: refetchAll }))?.ok);
  };
  const move = async (e: FormEvent) => {
    e.preventDefault();
    const body: z.input<typeof watchMoveBody> = { id: w.id, to };
    done((await write(WRITES.watchMove, body, { kind: "other", where, after: refetchAll }))?.ok);
  };
  const drop = async () => {
    const body: z.input<typeof watchDropBody> = { id: w.id };
    if ((await write(WRITES.watchDrop, body, { kind: "other", where, after: refetchAll }))?.ok) setDropping(false);
  };
  const others = agents.filter((a) => a.status !== "archived" && a.address !== w.owner);
  const whens = conditions.map((c) => ({ value: c, label: WHEN_WORDS[c] ?? c }));
  return (
    <Item role="listitem" size="sm" className="items-start gap-x-3 gap-y-1 px-0 py-2.5" data-wait={w.id}>
      <ItemContent className="min-w-0 gap-1">
        <ItemTitle className="w-full flex-wrap gap-x-2 gap-y-1 font-normal [overflow-wrap:anywhere]">
          <span className="inline-flex items-center gap-1.5">
            <Who address={w.owner} nowrap />
            {w.ownerLive ? null : <Tag>retired</Tag>}
          </span>
          <span>
            waits until{" "}
            <ProofLink open={{ url: w.prUrl }} className="font-semibold text-inherit underline underline-offset-2" data-wait-pr={w.prUrl} title={w.prUrl}>
              {prLabel(w.prUrl)}
            </ProofLink>{" "}
            is <span className="font-semibold">{WHEN_WORDS[w.when] ?? w.when}</span>
          </span>
        </ItemTitle>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground [&>span]:[overflow-wrap:anywhere]">
          <span className="font-mono">{w.id}</span>
          <span>for {w.ref === w.id ? "a note" : <span className="font-mono">{w.ref}</span>}</span>
          <span>bound {rel(w.createdAt, now)}</span>
          <span data-wait-reading="">{w.reading ? readingWords(w.reading, now) : "not read yet"}</span>
        </div>
      </ItemContent>
      <ItemActions className="flex-wrap gap-1">
        <Btn tone="ghost" data-wait-retarget={w.id} aria-expanded={mode === "retarget"} disabled={busy} onClick={() => setMode(mode === "retarget" ? null : "retarget")}>
          Retarget
        </Btn>
        <Btn tone="ghost" data-wait-move={w.id} aria-expanded={mode === "move"} disabled={busy || others.length === 0} onClick={() => setMode(mode === "move" ? null : "move")}>
          Move
        </Btn>
        <AlertDialog open={dropping} onOpenChange={setDropping}>
          <AlertDialogTrigger asChild>
            <Btn tone="ghost" data-wait-drop={w.id} disabled={busy}>
              Drop
            </Btn>
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Drop this wait?</AlertDialogTitle>
              <AlertDialogDescription>Nothing comes back to {w.owner} for it.</AlertDialogDescription>
            </AlertDialogHeader>
            <PageError where={where} />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                data-wait-drop-confirm={w.id}
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault(); // stays open until the write lands
                  void drop();
                }}
              >
                Drop
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ItemActions>
      {mode === "retarget" ? (
        <ItemFooter className="block min-w-0">
          <form className={FORM} data-wait-form="retarget" onSubmit={(e) => void retarget(e)}>
            <TextBox label="PR URL" grow name="pr" value={pr} onChange={(e) => setPr(e.target.value)} maxLength={300} />
            <Choice label="Until it is" name="when" value={when} onChange={setWhen} options={whens} />
            <Btn type="submit" tone="primary" disabled={busy || (pr.trim() === w.prUrl && when === w.when)}>
              Save
            </Btn>
            <Btn tone="ghost" onClick={() => setMode(null)}>
              Cancel
            </Btn>
          </form>
        </ItemFooter>
      ) : mode === "move" ? (
        <ItemFooter className="block min-w-0">
          <form className={FORM} data-wait-form="move" onSubmit={(e) => void move(e)}>
            <Choice label="Give it to" name="to" value={to} onChange={setTo} placeholder="Pick an agent" options={others.map((a) => ({ value: a.address, label: a.address }))} />
            <Btn type="submit" tone="primary" disabled={busy || !to}>
              Move
            </Btn>
            <Btn tone="ghost" onClick={() => setMode(null)}>
              Cancel
            </Btn>
          </form>
        </ItemFooter>
      ) : null}
      {dropping ? null : (
        <ItemFooter className="block min-w-0 empty:hidden">
          <PageError where={where} />
        </ItemFooter>
      )}
    </Item>
  );
}

function AddWait({ agents, busy, refetchAll, conditions }: { agents: Agents; busy: boolean; refetchAll: () => void; conditions: string[] }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [pr, setPr] = useState("");
  const [when, setWhen] = useState(conditions[0] ?? "approved");
  const [note, setNote] = useState("");
  const live = agents.filter((a) => a.status !== "archived");
  if (!open)
    return (
      <Btn data-wait-add="" disabled={busy || live.length === 0} onClick={() => setOpen(true)}>
        Add a PR wait
      </Btn>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: z.input<typeof watchAddBody> = { to, pr: pr.trim(), when: when as never, note: note.trim() };
    const out = await write(WRITES.watchAdd, body, { kind: "other", where: "watch:add", after: refetchAll });
    if (out?.ok) {
      setOpen(false);
      setPr("");
      setNote("");
    }
  };
  return (
    <form className={cx(FORM, "basis-full")} data-wait-form="add" onSubmit={(e) => void submit(e)}>
      <Choice label="For" name="to" value={to} onChange={setTo} placeholder="Pick an agent" options={live.map((a) => ({ value: a.address, label: a.address }))} />
      <TextBox label="PR URL" grow name="pr" value={pr} onChange={(e) => setPr(e.target.value)} maxLength={300} placeholder="https://github.com/…/pull/123" />
      <Choice label="Until it is" name="when" value={when} onChange={setWhen} options={conditions.map((c) => ({ value: c, label: WHEN_WORDS[c] ?? c }))} />
      <TextBox label="Then carry out" grow name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} placeholder="e.g. merge it and tell me" />
      <Btn type="submit" tone="primary" disabled={busy || !to || !pr.trim() || !note.trim()}>
        Add
      </Btn>
      <Btn tone="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Btn>
      <div className="basis-full empty:hidden">
        <PageError where="watch:add" />
      </div>
    </form>
  );
}

/** The command to run, read-only, with Copy (no clipboard, as on an insecure page: the text is selected, so ⌘C works). */
function CommandBox({ id, value }: { id: string; value: string }) {
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      input.current?.select();
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="flex min-w-0 gap-2">
      <Input ref={input} id={id} aria-label="Command" readOnly value={value} className="min-w-0 flex-1 font-mono text-xs md:text-xs" />
      <Btn icon={copied ? <Check /> : <Copy />} aria-label={copied ? "Copied" : "Copy"} onClick={() => void copy()} />
    </div>
  );
}

/** A job with a setting: on Change, a row under it with the exact command for the value typed (the page writes no
 * settings). The row spans the table, so the command reads in full. */
function SettingCommand({ j }: { j: Job }) {
  const [v, setV] = useState(String(j.value ?? ""));
  const id = useId();
  return (
    <TableRow data-job-command={j.id} className="hover:bg-transparent">
      <TableCell colSpan={5} className="pt-0 whitespace-normal">
        <div className="flex flex-wrap items-end gap-2">
          <TextBox label={`New value (${j.unit})`} name="value" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} className="w-24" />
          <div className="grid min-w-0 flex-[1_1_16rem] gap-2">
            <Label htmlFor={id}>Run it in a terminal: the page can't write plugin settings</Label>
            <CommandBox id={id} value={settingCommand(j.setting as JobSetting, v || "<value>")} />
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function JobRow({ j, now }: { j: Job; now: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow data-job={j.id} data-off={j.off ? "true" : "false"} className="data-[off=true]:text-muted-foreground">
        <TableCell className="align-top whitespace-normal">
          <div className="text-foreground">{j.what}</div>
          <div className="font-mono text-xs text-muted-foreground">{j.id}</div>
        </TableCell>
        <TableCell className="align-top">{j.interval}</TableCell>
        <TableCell className="align-top">{j.off ? "—" : j.last === null ? "not yet" : rel(j.last, now)}</TableCell>
        <TableCell className="align-top">{j.off || j.next === null ? "—" : rel(j.next, now)}</TableCell>
        <TableCell className="align-top">
          {j.setting ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs">{j.setting}</span>
              <Btn tone="ghost" size="sm" data-job-change={j.id} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {open ? "Done" : "Change"}
              </Btn>
            </span>
          ) : (
            <span className="text-muted-foreground">fixed</span>
          )}
        </TableCell>
      </TableRow>
      {open && j.setting ? <SettingCommand j={j} /> : null}
    </>
  );
}

export function WatchersSection({ w, agents, busy, refetchAll }: { w: Watchers; agents: Agents; busy: boolean; refetchAll: () => void }) {
  const now = Date.now();
  return (
    <Section title="Watchers" count={w.waits.length + w.jobs.length} data-watchers="">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="m-0 text-sm font-semibold">PR waits ({w.waits.length})</h4>
          <AddWait agents={agents} busy={busy} refetchAll={refetchAll} conditions={w.conditions} />
        </div>
        {w.waits.length === 0 ? <Muted>No open PR waits.</Muted> : null}
        <ItemGroup>
          {w.waits.map((x, i) => (
            <Fragment key={x.id}>
              {i > 0 ? <ItemSeparator /> : null}
              <WaitRow w={x} agents={agents} busy={busy} refetchAll={refetchAll} now={now} conditions={w.conditions} />
            </Fragment>
          ))}
        </ItemGroup>
        <h4 className="m-0 text-sm font-semibold">Timed jobs ({w.jobs.length})</h4>
        <Table data-jobs="">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs text-muted-foreground">What</TableHead>
              <TableHead className="text-xs text-muted-foreground">Interval</TableHead>
              <TableHead className="text-xs text-muted-foreground">Last</TableHead>
              <TableHead className="text-xs text-muted-foreground">Next</TableHead>
              <TableHead className="text-xs text-muted-foreground">Setting</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {w.jobs.map((j) => (
              <JobRow key={j.id} j={j} now={now} />
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
