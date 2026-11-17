// The Watchers section on the Board (Activity) tab (2026-11-17, core/watchers.ts): every open PR wait and every timed
// job. The owner retargets, moves, drops and adds PR waits here, through the page gate like every other write. A job's
// interval is a plugin setting the page can't write, so a job with a setting shows the exact `bb plugin config` line to
// run (with the value the owner types), and a fixed job is read-only.
import { useState, type FormEvent } from "react";
import type { z } from "zod";
import { WRITES, type Board, type Watchers, type watchAddBody, type watchDropBody, type watchMoveBody, type watchRetargetBody } from "../contract.ts";
import { prRef } from "../core/open-prs.ts";
import { rel, settingCommand, type JobSetting } from "../core/watchers.ts";
import { TextField } from "./affect/text-field-clean.tsx";
import { ProofLink } from "./proof-link.tsx";
import { write } from "./store.ts";
import { styleHref } from "./style-href.ts";
import { Btn, Muted, PageError, Section, Tag, Who } from "./ui.tsx";

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

function WaitRow({ w, agents, busy, refetchAll, now, conditions }: { w: Wait; agents: Agents; busy: boolean; refetchAll: () => void; now: number; conditions: string[] }) {
  const [mode, setMode] = useState<null | "retarget" | "move" | "drop">(null);
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
    done((await write(WRITES.watchDrop, body, { kind: "other", where, after: refetchAll }))?.ok);
  };
  const others = agents.filter((a) => a.status !== "archived" && a.address !== w.owner);
  return (
    <li className="orch-watch__row" data-wait={w.id}>
      <div className="orch-watch__line">
        <div className="orch-watch__main">
          <span className="orch-watch__who">
            <Who address={w.owner} nowrap />
            {w.ownerLive ? null : <Tag>retired</Tag>}
          </span>
          <span>
            waits until{" "}
            <ProofLink open={{ url: w.prUrl }} className="orch-watch__pr" data-wait-pr={w.prUrl} title={w.prUrl}>
              {prLabel(w.prUrl)}
            </ProofLink>{" "}
            is <b>{WHEN_WORDS[w.when] ?? w.when}</b>
          </span>
        </div>
        <div className="orch-watch__end">
          <Btn tone="ghost" data-wait-retarget={w.id} aria-expanded={mode === "retarget"} disabled={busy} onClick={() => setMode(mode === "retarget" ? null : "retarget")}>
            Retarget
          </Btn>
          <Btn tone="ghost" data-wait-move={w.id} aria-expanded={mode === "move"} disabled={busy || others.length === 0} onClick={() => setMode(mode === "move" ? null : "move")}>
            Move
          </Btn>
          <Btn tone="ghost" data-wait-drop={w.id} aria-expanded={mode === "drop"} disabled={busy} onClick={() => setMode(mode === "drop" ? null : "drop")}>
            Drop
          </Btn>
        </div>
      </div>
      <div className="orch-watch__meta">
        <span className="orch-mono">{w.id}</span>
        <span>for {w.ref === w.id ? "a note" : <span className="orch-mono">{w.ref}</span>}</span>
        <span>bound {rel(w.createdAt, now)}</span>
        <span data-wait-reading="">{w.reading ? readingWords(w.reading, now) : "not read yet"}</span>
      </div>
      {mode === "retarget" ? (
        <form className="orch-watch__form" data-wait-form="retarget" onSubmit={(e) => void retarget(e)}>
          <label className="orch-watch__field orch-watch__grow">
            <span>PR URL</span>
            <input name="pr" value={pr} onChange={(e) => setPr(e.target.value)} maxLength={300} />
          </label>
          <label className="orch-watch__field">
            <span>Until it is</span>
            <select name="when" value={when} onChange={(e) => setWhen(e.target.value)}>
              {conditions.map((c) => (
                <option key={c} value={c}>
                  {WHEN_WORDS[c] ?? c}
                </option>
              ))}
            </select>
          </label>
          <Btn type="submit" tone="primary" disabled={busy || (pr.trim() === w.prUrl && when === w.when)}>
            Save
          </Btn>
          <Btn tone="ghost" onClick={() => setMode(null)}>
            Cancel
          </Btn>
        </form>
      ) : mode === "move" ? (
        <form className="orch-watch__form" data-wait-form="move" onSubmit={(e) => void move(e)}>
          <label className="orch-watch__field">
            <span>Give it to</span>
            <select name="to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Pick an agent</option>
              {others.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.address}
                </option>
              ))}
            </select>
          </label>
          <Btn type="submit" tone="primary" disabled={busy || !to}>
            Move
          </Btn>
          <Btn tone="ghost" onClick={() => setMode(null)}>
            Cancel
          </Btn>
        </form>
      ) : mode === "drop" ? (
        <div className="orch-watch__form" role="group" aria-label="Confirm drop">
          <span className="orch-muted">Drop this wait? Nothing comes back to {w.owner} for it.</span>
          <Btn tone="danger" data-wait-drop-confirm={w.id} disabled={busy} onClick={() => void drop()}>
            Drop
          </Btn>
          <Btn tone="ghost" onClick={() => setMode(null)}>
            Cancel
          </Btn>
        </div>
      ) : null}
      <PageError where={where} />
    </li>
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
    <form className="orch-watch__form" data-wait-form="add" onSubmit={(e) => void submit(e)}>
      <label className="orch-watch__field">
        <span>For</span>
        <select name="to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Pick an agent</option>
          {live.map((a) => (
            <option key={a.address} value={a.address}>
              {a.address}
            </option>
          ))}
        </select>
      </label>
      <label className="orch-watch__field orch-watch__grow">
        <span>PR URL</span>
        <input name="pr" value={pr} onChange={(e) => setPr(e.target.value)} maxLength={300} placeholder="https://github.com/…/pull/123" />
      </label>
      <label className="orch-watch__field">
        <span>Until it is</span>
        <select name="when" value={when} onChange={(e) => setWhen(e.target.value)}>
          {conditions.map((c) => (
            <option key={c} value={c}>
              {WHEN_WORDS[c] ?? c}
            </option>
          ))}
        </select>
      </label>
      <label className="orch-watch__field orch-watch__grow">
        <span>Then carry out</span>
        <input name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} placeholder="e.g. merge it and tell me" />
      </label>
      <Btn type="submit" tone="primary" disabled={busy || !to || !pr.trim() || !note.trim()}>
        Add
      </Btn>
      <Btn tone="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Btn>
      <PageError where="watch:add" />
    </form>
  );
}

/** A job with a setting: on Change, a row under it with the exact command for the value typed (the page writes no
 * settings). The row spans the table, so the command reads in full. */
function SettingCommand({ j }: { j: Job }) {
  const [v, setV] = useState(String(j.value ?? ""));
  return (
    <tr className="orch-watch__cmdrow" data-job-command={j.id}>
      <td colSpan={5}>
        <div className="orch-watch__cmd">
          <label className="orch-watch__field">
            <span>New value ({j.unit})</span>
            <input name="value" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} size={6} />
          </label>
          <label className="orch-watch__field orch-watch__grow">
            <span>Run it in a terminal: the page can't write plugin settings</span>
            <TextField aria-label="Command" readOnly copyable value={settingCommand(j.setting as JobSetting, v || "<value>")} inputClassName="orch-mono" />
          </label>
        </div>
      </td>
    </tr>
  );
}

function JobRow({ j, now }: { j: Job; now: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr data-job={j.id} data-off={j.off ? "true" : "false"}>
        <td>
          <div className="orch-watch__what">{j.what}</div>
          <div className="orch-watch__sub orch-mono">{j.id}</div>
        </td>
        <td>{j.interval}</td>
        <td className="orch-watch__nowrap">{j.off ? "—" : j.last === null ? "not yet" : rel(j.last, now)}</td>
        <td className="orch-watch__nowrap">{j.off || j.next === null ? "—" : rel(j.next, now)}</td>
        <td>
          {j.setting ? (
            <span className="orch-watch__setting">
              <span className="orch-mono">{j.setting}</span>
              <Btn tone="ghost" data-job-change={j.id} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {open ? "Done" : "Change"}
              </Btn>
            </span>
          ) : (
            <span className="orch-muted">fixed</span>
          )}
        </td>
      </tr>
      {open && j.setting ? <SettingCommand j={j} /> : null}
    </>
  );
}

export function WatchersSection({ w, agents, busy, refetchAll }: { w: Watchers; agents: Agents; busy: boolean; refetchAll: () => void }) {
  const now = Date.now();
  return (
    <Section title="Watchers" count={w.waits.length + w.jobs.length} data-watchers="">
      <style href={styleHref("orch-watch", CSS)} precedence="default">
        {CSS}
      </style>
      <div className="orch-watch">
        <div className="orch-watch__head">
          <h4>PR waits ({w.waits.length})</h4>
          <AddWait agents={agents} busy={busy} refetchAll={refetchAll} conditions={w.conditions} />
        </div>
        {w.waits.length === 0 ? <Muted>No open PR waits.</Muted> : null}
        <ul className="orch-watch__list">
          {w.waits.map((x) => (
            <WaitRow key={x.id} w={x} agents={agents} busy={busy} refetchAll={refetchAll} now={now} conditions={w.conditions} />
          ))}
        </ul>
        <div className="orch-watch__head">
          <h4>Timed jobs ({w.jobs.length})</h4>
        </div>
        <div className="orch-watch__scroll">
          <table className="orch-watch__jobs" data-jobs="">
            <thead>
              <tr>
                <th>What</th>
                <th>Interval</th>
                <th>Last</th>
                <th>Next</th>
                <th>Setting</th>
              </tr>
            </thead>
            <tbody>
              {w.jobs.map((j) => (
                <JobRow key={j.id} j={j} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

const CSS = `
[data-orch] .orch-watch { display: grid; gap: 12px; min-width: 0; }
[data-orch] .orch-watch h4 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }
[data-orch] .orch-watch__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
[data-orch] .orch-watch__list { display: grid; margin: 0; padding: 0; list-style: none; min-width: 0; }
[data-orch] .orch-watch__row { display: grid; gap: 4px; padding: 10px 0; border-bottom: 1px solid var(--orch-line); min-width: 0; }
[data-orch] .orch-watch__row:first-child { padding-top: 0; }
[data-orch] .orch-watch__line { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; }
[data-orch] .orch-watch__main { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 14px; line-height: 20px; min-width: 0; overflow-wrap: anywhere; }
[data-orch] .orch-watch__who { display: inline-flex; align-items: center; gap: 6px; }
[data-orch] .orch-watch__pr { font-weight: 600; color: inherit; text-decoration: underline; text-underline-offset: 2px; }
[data-orch] .orch-watch__end { display: flex; flex-wrap: wrap; gap: 4px; }
[data-orch] .orch-watch__meta { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 12px; line-height: 16px; color: var(--orch-muted); min-width: 0; }
[data-orch] .orch-watch__meta > span { overflow-wrap: anywhere; }
[data-orch] .orch-watch__form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; margin-top: 6px; padding: 10px; border-radius: 8px; background: var(--orch-wash); font-size: 13px; }
[data-orch] .orch-watch__field { display: grid; gap: 2px; font-size: 12px; line-height: 16px; color: var(--orch-muted); min-width: 0; }
[data-orch] .orch-watch__grow { flex: 1 1 16rem; }
[data-orch] .orch-watch__field input, [data-orch] .orch-watch__field select { font: inherit; font-size: 14px; line-height: 20px; color: var(--orch-ink); background: light-dark(#ffffff, rgba(255, 255, 255, 0.04)); border: 1px solid light-dark(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.22)); border-radius: 6px; padding: 5px 8px; min-width: 0; }
[data-orch] .orch-watch__field select option { background: Canvas; color: CanvasText; }
[data-orch] .orch-watch__scroll { overflow-x: auto; min-width: 0; }
[data-orch] .orch-watch__jobs { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 18px; }
[data-orch] .orch-watch__jobs th { padding: 6px 8px; text-align: start; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--orch-muted); border-bottom: 1px solid var(--orch-line); white-space: nowrap; }
[data-orch] .orch-watch__jobs td { padding: 8px; vertical-align: top; border-bottom: 1px solid var(--orch-line); }
[data-orch] .orch-watch__jobs tr[data-off="true"] td { color: var(--orch-muted); }
[data-orch] .orch-watch__what { color: var(--orch-ink); }
[data-orch] .orch-watch__sub { font-size: 11px; line-height: 14px; color: var(--orch-muted); }
[data-orch] .orch-watch__setting { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
[data-orch] .orch-watch__cmd { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; }
[data-orch] .orch-watch__cmdrow td { padding-top: 0; }
[data-orch] .orch-watch__nowrap { white-space: nowrap; }
`;
