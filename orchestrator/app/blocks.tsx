// Generative UI: draws an agent's typed blocks (blocks.ts) as components, on Needs you cards (and deliverables).
// Requested 2026-11-13: "different cards for like login codes and flows and also better generative ui components".
import { useEffect, useState } from "react";
import { UrlLink, experimental_SourceCode as SourceCode } from "@get-bb/plugin-sdk/app";
import type { Block } from "../blocks.ts";
import type { Card } from "../contract.ts";
import { PrChip } from "./agent-bits.tsx";
import { Changes, Checks, Decisions, Diagram, Facts, Rca, Verdicts } from "./visual-blocks.tsx";
import { Btn, Tag, cx } from "./ui.tsx";

type Pr = Card["prs"][number];

/** The selectable lists' unticked items, by block index: the card names them in the answer. */
export type Unticked = ReadonlyMap<number, ReadonlySet<number>>;

const TONE: Record<"good" | "warn" | "bad", string> = { good: "var(--success, #2f9e44)", warn: "var(--warning-text, #b7791f)", bad: "var(--destructive-text, #e03131)" };

/** Seconds left until `at`, ticking each second; null without a time. */
function useLeft(at: string | undefined): number | null {
  const end = at ? Date.parse(at) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Number.isNaN(end)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [end]);
  return Number.isNaN(end) ? null : Math.max(0, Math.round((end - now) / 1000));
}

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Btn
      tone="ghost"
      data-copy=""
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied ✓" : label}
    </Btn>
  );
}

function Login({ b, onPaste, busy }: { b: Extract<Block, { kind: "login" }>; onPaste: ((value: string) => void) | null; busy: boolean }) {
  const left = useLeft(b.expires_at);
  const expired = left === 0;
  const [value, setValue] = useState("");
  const clock = left === null ? null : expired ? "Expired" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`;
  return (
    <div data-block="login" data-expired={expired || undefined} className={cx("orch-wash grid gap-3 rounded-lg p-3", expired && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Sign in · {b.service}</span>
        {b.account ? <Tag>{b.account}</Tag> : null}
        {clock ? (
          <span data-clock="" className="ml-auto text-xs font-semibold tabular-nums" style={{ color: expired ? TONE.bad : left !== null && left < 120 ? TONE.warn : undefined }}>
            {clock}
          </span>
        ) : null}
      </div>
      {b.code ? (
        <div className="flex flex-wrap items-center gap-3">
          <code data-code="" className="orch-mono rounded-md px-3 py-1.5 text-xl font-bold tracking-[.18em]" style={{ background: "var(--background, transparent)" }}>
            {b.code}
          </code>
          <Copy text={b.code} label="Copy code" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <UrlLink href={b.url} data-login-open="" className="inline-flex items-center rounded-md bg-[var(--primary,#3b82f6)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground,#fff)] no-underline hover:opacity-90">
          Open sign-in page ↗
        </UrlLink>
        <Copy text={b.url} label="Copy link" />
        <span className="orch-muted min-w-0 truncate text-xs" title={b.url}>
          {(() => {
            try {
              return new URL(b.url).host;
            } catch {
              return "";
            }
          })()}
        </span>
      </div>
      {b.paste && onPaste ? (
        // never kept in the page or the decision: it goes to the asker as a file path (server.ts, secret route)
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onPaste(value);
            setValue("");
          }}
        >
          <input
            data-paste=""
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            maxLength={4000}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste the code the page gives you"
            className="min-w-0 flex-1 rounded-md border border-[var(--border,#8884)] bg-transparent px-3 py-1.5 text-sm"
          />
          <Btn type="submit" data-paste-send="" disabled={busy || !value.trim()}>
            Send code
          </Btn>
          <span className="orch-muted w-full text-xs">Sent straight to the agent as a file it reads once; not saved with the card.</span>
        </form>
      ) : null}
    </div>
  );
}

function Steps({ b }: { b: Extract<Block, { kind: "steps" }> }) {
  return (
    <div data-block="steps" className="grid gap-1.5">
      {b.title ? <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{b.title}</div> : null}
      <ol className="m-0 grid list-none gap-1.5 p-0">
        {b.items.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: "var(--orch-wash, #8882)" }}>
              {i + 1}
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {s.text}
              {s.expect ? <span className="orch-muted block text-xs">You should see: {s.expect}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PrBlock({ b, pr }: { b: Extract<Block, { kind: "pr" }>; pr: Pr | null }) {
  const n = /\/pull\/(\d+)/.exec(b.url)?.[1];
  return (
    <div data-block="pr" className="flex flex-wrap items-center gap-2">
      {pr ? (
        <PrChip pr={pr} />
      ) : (
        <UrlLink href={b.url} className="no-underline hover:underline">
          <Tag>PR {n ? `#${n}` : "link"}</Tag>
        </UrlLink>
      )}
      {b.note ? <span className="orch-muted text-xs">{b.note}</span> : null}
    </div>
  );
}

function List({ b, off, toggle }: { b: Extract<Block, { kind: "list" }>; off: ReadonlySet<number>; toggle: ((i: number) => void) | null }) {
  const n = b.items.length - off.size;
  return (
    <div data-block="list" className="grid gap-1">
      <div className="flex items-center gap-2 text-xs">
        {b.title ? <span className="font-semibold uppercase tracking-wide opacity-70">{b.title}</span> : null}
        <span className="orch-muted ml-auto">{b.selectable ? `${n} of ${b.items.length} selected` : `${b.items.length} items`}</span>
      </div>
      <ul className="orch-wash m-0 grid max-h-64 list-none gap-0 overflow-y-auto rounded-lg p-1">
        {b.items.map((it, i) => (
          <li key={i} className={cx("flex items-center gap-2 rounded px-2 py-1 text-sm", off.has(i) && "opacity-50 line-through")}>
            {b.selectable && toggle ? <input type="checkbox" data-list-item={i} checked={!off.has(i)} onChange={() => toggle(i)} aria-label={it.label} /> : null}
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{it.url ? <UrlLink href={it.url}>{it.label}</UrlLink> : it.label}</span>
            {it.meta ? <span className="orch-muted shrink-0 text-xs tabular-nums">{it.meta}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Command({ b }: { b: Extract<Block, { kind: "command" }> }) {
  return (
    <div data-block="command" className="grid min-w-0 gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide opacity-70">Command</span>
        {b.where ? <Tag>{b.where}</Tag> : null}
        <span className="ml-auto" />
        <Copy text={b.text} />
      </div>
      <div className="min-w-0 max-w-full overflow-hidden rounded-lg">
        <SourceCode content={b.text} path={`command.${b.language ?? "sh"}`} overflow="wrap" />
      </div>
    </div>
  );
}

/**
 * Every block in order. `onPaste` sends a login block's pasted code (null where nothing can be answered); `unticked`
 * and `onToggle` hold a selectable list's choices for the card's answer. `only` draws just those indices (a list's
 * choices stay keyed by its index in `blocks`).
 */
export function Blocks({ blocks, prs, onPaste = null, busy = false, unticked = new Map(), onToggle = null, only = null }: { blocks: readonly Block[]; prs?: readonly Pr[]; onPaste?: ((value: string) => void) | null; busy?: boolean; unticked?: Unticked; onToggle?: ((block: number, item: number) => void) | null; only?: readonly number[] | null }) {
  const shown = only ? blocks.map((_, i) => i).filter((i) => only.includes(i)) : blocks.map((_, i) => i);
  if (shown.length === 0) return null;
  const none = new Set<number>();
  return (
    <div data-blocks="" className="mt-3 grid min-w-0 gap-3">
      {shown.map((i) => {
        const b = blocks[i]!;
        switch (b.kind) {
          case "login":
            return <Login key={i} b={b} onPaste={onPaste} busy={busy} />;
          case "steps":
            return <Steps key={i} b={b} />;
          case "pr":
            return <PrBlock key={i} b={b} pr={prs?.find((p) => p.url === b.url) ?? null} />;
          case "list":
            return <List key={i} b={b} off={unticked.get(i) ?? none} toggle={onToggle ? (j) => onToggle(i, j) : null} />;
          case "facts":
            return <Facts key={i} b={b} />;
          case "command":
            return <Command key={i} b={b} />;
          case "checks":
            return <Checks key={i} b={b} />;
          case "diagram":
            return <Diagram key={i} b={b} />;
          case "decisions":
            return <Decisions key={i} b={b} />;
          case "changes":
            return <Changes key={i} b={b} />;
          case "rca":
            return <Rca key={i} b={b} />;
          case "verdicts":
            return <Verdicts key={i} b={b} />;
        }
      })}
    </div>
  );
}

/** The answer's words for what the owner unticked, or "" when they left every list whole. */
export function untickedText(blocks: readonly Block[], unticked: Unticked): string {
  return blocks
    .flatMap((b, i) => {
      const off = unticked.get(i);
      if (b.kind !== "list" || !off || off.size === 0) return [];
      return [`Left out of ${b.title ? JSON.stringify(b.title) : "the list"}: ${[...off].sort((x, y) => x - y).map((j) => b.items[j]?.label ?? "").join("; ")}`];
    })
    .join("\n");
}
