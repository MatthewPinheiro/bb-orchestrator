// Needs you: the owner's answerable cards, then what waits on an agent, what the CoS is triaging, and the deferred cards.
//
// The double-tap fix (gate.ts has the rules as pure functions, store.ts the write gate):
// - Arming (useArming): each card's top, measured against this view's own wrapper (so scrolling moves nothing), and its
//   rev are tracked; a card that just appeared, moved or changed takes no write for ARM_MS. Its buttons say so in
//   `data-armed`, and the click itself re-measures before it counts.
// - No reflow (shown below): while a pointer is down on the panel, or a write holds the page, the view keeps drawing
//   the list it last drew. The written card stays in its slot, marked, and every write on the page is off until the
//   request finished and SETTLE_MS passed since both the response and the last release. Then the list moves, and the
//   card that moves into the slot is armed afresh, so the second click of a double-click can't answer it.
// - Arming gates options, "Send my answer" (the Other field) and the defer presets; Bring back answers nothing and is under the page lock only.
import { styleHref } from "./style-href.ts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Markdown, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { WRITES, type Card, type NeedsYou, type Preset, type answerBody, type deferBody, type interactionAnswerBody, type returnBody, type secretBody } from "../contract.ts";
import { Blocks, untickedText } from "./blocks.tsx";
import { QuestionCard, ixKey } from "./question-card.tsx";
import { Details, OtherBox, Options, answerCss } from "./answer-ui.tsx";
import { cardBlockOrder } from "./less-text.ts";
import { Badge } from "./affect/badge-clean.tsx";
import type { Answers } from "../interactions.ts";
import type { z } from "zod";
import { ARM_MS, armed, track, type Seen } from "./gate.ts";
import { keyState, emitKeys, say } from "./key-state.ts";
import { useViewKeys } from "./key-view.ts";
import { changed, gate, gone, pruneGone, useGate, write, type Hide, type WriteKind } from "./store.ts";
import { KIND_TONES, css } from "./palette.ts";
import { ACCENT, accentTone, accentVars } from "./accent.ts";
import { AlertIcon, DoneIcon, css as inboxCss } from "./affect/decision-inbox-clean.tsx";
import { DropdownMenu } from "./affect/dropdown-menu-clean.tsx";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { TextArea } from "./affect/text-area-clean.tsx";
import { MonSprite } from "./mon.tsx";
import { Btn, Kind, Muted, Section, Tag, Who, cx, when } from "./ui.tsx";

/** The device's zone, which the server works the defer presets out in. One value, so every read shares a cache entry. */
export const ZONE: string = (() => {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return z && z.length <= 64 ? z : "UTC";
  } catch {
    return "UTC";
  }
})();

function via(): "phone" | "desktop" {
  try {
    return window.matchMedia("(pointer: coarse)").matches ? "phone" : "desktop";
  } catch {
    return "desktop";
  }
}

type List = "cards" | "deferred";

/** The view without the cards a write took (this id at this rev), for the lists the write moved them out of. */
function visible(v: NeedsYou): NeedsYou {
  if (gone.size === 0) return v;
  const keep = (list: List) => (c: Card) => {
    const h = gone.get(`${c.id}@${c.rev}`);
    return !h || (h !== "both" && h !== list);
  };
  return { ...v, cards: v.cards.filter(keep("cards")), deferred: v.deferred.filter(keep("deferred")), interactions: v.interactions.filter((i) => !gone.has(`${ixKey(i)}@0`)) };
}

/** Arming: when each card last appeared, moved or changed rev. */
function useArming(root: RefObject<HTMLDivElement | null>) {
  const seen = useRef(new Map<string, Seen>());
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);
  /** Measure every card; true when one appeared, moved or changed (its clock restarted). */
  const measure = useCallback((): boolean => {
    const el = root.current;
    if (!el) return false;
    const base = el.getBoundingClientRect().top;
    const now = performance.now();
    const next = new Map<string, Seen>();
    let restarted = false;
    el.querySelectorAll<HTMLElement>("[data-card]").forEach((c) => {
      const id = c.dataset.card ?? "";
      const prev = seen.current.get(id);
      const s = track(prev, Number(c.dataset.rev), c.getBoundingClientRect().top - base, now);
      if (s !== prev) restarted = true;
      next.set(id, s);
    });
    seen.current = next;
    return restarted;
  }, [root]);
  // after every render, before paint
  useLayoutEffect(() => {
    if (measure()) rerender();
  });
  // a card above growing or shrinking (a note opened, text wrapping) moves the ones below without a render here
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (measure()) rerender();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, rerender, root]);
  // flip data-armed when the next clock runs out
  useEffect(() => {
    const now = performance.now();
    let next = Number.POSITIVE_INFINITY;
    for (const s of seen.current.values()) if (s.at + ARM_MS > now) next = Math.min(next, s.at + ARM_MS);
    if (next === Number.POSITIVE_INFINITY) return;
    const t = setTimeout(rerender, next - now + 5);
    return () => clearTimeout(t);
  });
  return {
    /** For drawing `data-armed`. */
    isArmed: (id: string, rev: number) => armed(seen.current.get(id), rev, performance.now()),
    /** For a click: measured again first, so a move not yet seen still drops it. */
    check: (id: string, rev: number) => {
      if (measure()) rerender();
      return armed(seen.current.get(id), rev, performance.now());
    },
  };
}

type Act = {
  answer: (card: Card, list: List, option: string | null, note: string) => void;
  defer: (card: Card, preset: Preset["id"]) => void;
  bringBack: (card: Card) => void;
  /** A code pasted into a login block: it goes to the asker as a file path, never into the decision. */
  secret: (card: Card, list: List, value: string) => void;
};

function CardView({ card, list, presets, isArmed, act, mon, monType = null }: { card: Card; list: List; presets: Preset[]; isArmed: boolean; act: Act; mon: string | null; monType?: string | null }) {
  const [note, setNote] = useState("");
  const [unticked, setUnticked] = useState<Map<number, Set<number>>>(() => new Map());
  const toggle = (block: number, item: number) =>
    setUnticked((m) => {
      const next = new Map(m);
      const off = new Set(next.get(block) ?? []);
      if (off.has(item)) off.delete(item);
      else off.add(item);
      next.set(block, off);
      return next;
    });
  // an option's answer carries the lists' unticked items along with any note
  const withLists = (n: string) => [n.trim(), untickedText(card.blocks, unticked)].filter(Boolean).join("\n\n");
  const order = cardBlockOrder(card.blocks);
  // the answer a number key picked, waiting for Enter (keys.ts); a card that changed rev starts without one
  const picked = keyState.picked.get(`${card.id}@${card.rev}`);

  const lock = gate.lock;
  const busy = lock !== null; // a write anywhere on the page turns every write off
  const mine = lock && lock.cardId === card.id && lock.ok !== false ? lock : null;
  const state = mine?.kind === "answer" ? "answered" : mine?.kind === "defer" || card.deferred ? "deferred" : "open";
  const mark = mine?.kind === "answer" ? "Answered ✓" : mine?.kind === "defer" ? "Deferred" : mine?.kind === "return" ? "Bringing back" : null;
  const markColor = mine ? css(KIND_TONES[mine.kind === "answer" ? "done" : mine.kind === "defer" ? "deferred" : "asked"]) : undefined;
  // notices change the card's height, so they show only while nothing holds the page
  const notice = busy ? null : (changed.get(card.id) ?? (gate.error?.where === card.id ? gate.error.message : null));

  // One row of affectUI's decision inbox (its classes and CSS; never data-gone, always data-open, so it never folds or glides)
  return (
    <article data-card={card.id} data-rev={card.rev} data-asker={card.asker} data-state={state} data-accent={monType ?? undefined} aria-busy={busy || undefined} className={cx("ui-dic__row", mine && "opacity-80")} style={accentVars(monType)}>
      <div className="ui-dic__row-inner">
        <div className="ui-dic__item" data-open="">
          <header className="flex items-start gap-3">
            {/* always drawn at its fixed size (the role avatar until the board names the mon), so the card never changes height */}
            <MonSprite mon={mon} address={card.origin} size={28} />
            <div className="min-w-0 flex-1">
              <h4 className="ui-dic__title">{card.title}</h4>
              {/* affectUI's quiet line: where it comes from, who asked, and any state */}
              <p className="orch-meta">
                {/* the project in its accent (accent.ts) */}
                <span style={accentTone(monType) ? { color: ACCENT, fontWeight: 600 } : undefined}>{card.project ?? "no project"}</span>
                <span aria-hidden>·</span>
                <span className="orch-mono">{card.origin}</span>
                {card.asker !== card.origin ? (
                  <>
                    <span aria-hidden>via</span>
                    <span className="orch-mono">{card.asker}</span>
                  </>
                ) : null}
                {card.escalated ? <Badge tone="warning" data-escalated="">CoS didn't triage</Badge> : null}
                {card.merge ? <Badge tone="purple" data-merge="">Merge</Badge> : null}
                {card.returnedAt ? <Badge tone="neutral">Back</Badge> : null}
                {card.queued ? <Badge tone="neutral" data-queued="">{`+${card.queued} next from ${card.asker}`}</Badge> : null}
                {list === "deferred" ? <Badge tone="neutral">{card.deferredUntil ? `Deferred until ${when(card.deferredUntil)}` : "Deferred until you bring it back"}</Badge> : null}
              </p>
            </div>
            {/* one fixed slot: the mark replaces the time, so marking moves nothing */}
            <span data-mark={mark ? "" : undefined} className={cx("orch-when", mark && "font-medium")} style={{ color: markColor }}>
              {mark ?? when(card.askedAt)}
            </span>
          </header>
          {notice ? (
            <p role="status" data-notice="" className="orch-danger m-0 mt-2 text-xs">
              {notice}
            </p>
          ) : null}
          {/* a PR or merge card leads with its PR: the chip, its live state and the one-line verdict (2026-11-14) */}
          <Blocks blocks={card.blocks} prs={card.prs} only={order.lead} />
          <p className="ui-dic__detail !mt-2 whitespace-pre-wrap">{card.question}</p>
          {/* no prose on the card (2026-11-14): at most one decision line; the context and the decisions open from More */}
          {order.line ? (
            <p data-card-line="" className="orch-muted m-0 mt-1 truncate text-sm" title={order.line}>
              {order.line}
            </p>
          ) : null}
          {card.context || order.more.length > 0 ? (
            <Details markdown={card.context ?? ""}>
              <Blocks blocks={card.blocks} prs={card.prs} only={order.more} />
            </Details>
          ) : null}
          <Blocks blocks={card.blocks} prs={card.prs} busy={busy} onPaste={(v) => act.secret(card, list, v)} unticked={unticked} onToggle={toggle} only={order.after} />

          <Options
            disabled={busy}
            options={card.options.map((o) => ({
              key: o.id,
              label: o.label,
              detail: o.detail,
              recommended: o.recommended,
              pressed: picked ? picked === o.id : undefined,
              data: { "data-option": o.id, "data-armed": isArmed ? "true" : "false", "data-recommended": o.recommended ? "true" : undefined },
              onPick: () => act.answer(card, list, o.id, withLists(note)),
            }))}
          />

          {/* Requested 2026-11-13: "other should just be an open text box and command enter should send it". Typed text
              also rides along with an option picked above. */}
          {card.allowText ? (
            <OtherBox
              value={note}
              onChange={setNote}
              disabled={busy}
              onSend={() => act.answer(card, list, null, withLists(note))}
              placeholder="Other: your own answer, or a note to go with an option. ⌘↵ sends"
            />
          ) : null}

          <footer className="mt-2 flex items-center gap-2">
            <span className="ml-auto" />
            {list === "deferred" ? (
              <Btn data-return="" disabled={busy} onClick={() => act.bringBack(card)}>
                Bring back
              </Btn>
            ) : presets.length > 0 ? (
              // affectUI's menu, in the top layer: opening it changes no card's height
              <DropdownMenu
                align="end"
                aria-label="Defer until"
                items={presets.map((p) => ({ label: p.label, disabled: busy, data: { "data-preset": p.id }, onSelect: () => act.defer(card, p.id) }))}
                trigger={({ triggerProps }) => (
                  <Btn tone="ghost" data-defer="" disabled={busy} {...triggerProps}>
                    Defer ▾
                  </Btn>
                )}
              />
            ) : null}
          </footer>
        </div>
      </div>
    </article>
  );
}

type Query = { data: NeedsYou | undefined; error: { message: string } | null; refetch: () => Promise<void> };

/** `mons`: address → its Pokémon, from the board's agents (for the asker's sprite on each card). */
export function NeedsYouView({ q, refetchAll, mons, threads, accents }: { q: Query; refetchAll: () => void; mons: ReadonlyMap<string, string | null>; threads: ReadonlyMap<string, string>; accents?: ReadonlyMap<string, string | null> }) {
  useGate();
  const navigate = useBbNavigate();
  const live = q.data;
  // no reflow under a pressed pointer or while a write holds the page: draw what was drawn last
  const frozen = gate.pointerDown || gate.lock !== null;
  const last = useRef<NeedsYou | undefined>(undefined);
  const view = frozen && last.current ? last.current : live ? visible(live) : undefined;
  useLayoutEffect(() => {
    last.current = view;
  });
  useEffect(() => {
    if (live) pruneGone(new Set([...live.cards.map((c) => `${c.id}@${c.rev}`), ...live.interactions.map((i) => `${ixKey(i)}@0`)]), new Set(live.deferred.map((c) => `${c.id}@${c.rev}`)));
  }, [live]);

  const root = useRef<HTMLDivElement>(null);
  const arming = useArming(root);
  // Keys (2026-11-16): J/K select, 1-4 pick an answer on the selected card, Enter sends it, O opens its asker's thread.
  // Answering goes through the card's own button, so the arming and the page lock apply to the key as to a click.
  useViewKeys("needs-you", root, '[data-list="cards"] [data-card]', (el) => el.dataset.card ?? "", (a, sel) => {
    if (!sel) return false;
    const rev = `${sel.id}@${sel.el.dataset.rev ?? 0}`;
    if (a.t === "pick") {
      const btn = sel.el.querySelectorAll<HTMLElement>("[data-option]")[a.n - 1];
      if (!btn) say(sel.el.hasAttribute("data-question-card") ? "An agent's question: open it with O to answer" : `This card has no answer ${a.n}`);
      else {
        keyState.picked.set(rev, btn.dataset.option ?? "");
        emitKeys();
        say(`Picked ${a.n}: Enter sends it`);
      }
      return true;
    }
    if (a.t === "send") {
      const id = keyState.picked.get(rev);
      if (!id) return false;
      const btn = Array.from(sel.el.querySelectorAll<HTMLButtonElement>("[data-option]")).find((b) => b.dataset.option === id);
      if (!btn || btn.disabled) return false;
      if (btn.dataset.armed !== "true") {
        say("The card just changed: wait a moment");
        return true;
      }
      keyState.picked.delete(rev);
      btn.click();
      return true;
    }
    if (a.t === "open") {
      const thread = sel.el.dataset.thread ?? threads.get(sel.el.dataset.asker ?? "");
      if (thread) navigate.toThread(thread);
      else say("No thread to open for this card");
      return true;
    }
    if (a.t === "approve") {
      say("A closes a deliverable: use it in Deliverables");
      return true;
    }
    return false;
  });

  const send = (card: Card, kind: WriteKind, hide: Hide, path: string, body: unknown) => {
    if (gate.lock) return; // one write at a time, page-wide
    // not sat still for ARM_MS: dropped, no request. Bring back is under the page lock only (it answers nothing).
    if (kind !== "return" && !arming.check(card.id, card.rev)) return;
    void write(path, body, { card: { id: card.id, rev: card.rev, hide }, kind, after: refetchAll });
  };
  // an agent's own question: the same lock and arming as a card, keyed ix:<interaction id> at rev 0
  const answerQuestion = (i: NeedsYou["interactions"][number], answers: Answers) => {
    if (gate.lock) return;
    const key = ixKey(i);
    if (!arming.check(key, 0)) return;
    const body: z.input<typeof interactionAnswerBody> = { threadId: i.threadId, interactionId: i.id, answers };
    void write(WRITES.interactionAnswer, body, { card: { id: key, rev: 0, hide: "both" }, kind: "answer", after: refetchAll });
  };
  const act: Act = {
    answer(card, _list, option, note) {
      const body: z.input<typeof answerBody> = { id: card.id, rev: card.rev, option, text: note.trim() ? note : null, via: via() };
      send(card, "answer", "both", WRITES.answer, body);
    },
    defer(card, preset) {
      const body: z.input<typeof deferBody> = { id: card.id, rev: card.rev, preset, zone: ZONE, via: via() };
      send(card, "defer", "cards", WRITES.defer, body);
    },
    secret(card, _list, value) {
      const body: z.input<typeof secretBody> = { id: card.id, rev: card.rev, value, via: via() };
      send(card, "answer", "both", WRITES.secret, body);
    },
    bringBack(card) {
      const body: z.input<typeof returnBody> = { id: card.id, rev: card.rev };
      send(card, "return", "deferred", WRITES.return, body);
    },
  };

  if (!view) {
    return (
      <div ref={root}>
        {q.error ? (
          <EmptyState title="Can't read Needs you" text={q.error.message} icon={null} action={<Btn onClick={() => void q.refetch()}>Retry</Btn>} />
        ) : (
          <Muted>Loading…</Muted>
        )}
      </div>
    );
  }

  const n = view.badge;
  const questions = view.interactions.filter((i) => i.questions.length > 0);
  const prompts = view.interactions.filter((i) => i.questions.length === 0);
  return (
    <div ref={root} className="flex flex-col gap-4 pb-8">
      <style href={styleHref("ui-decision-inbox-clean", inboxCss)} precedence="default">
        {inboxCss}
      </style>
      <style href={styleHref("orch-answer", answerCss)} precedence="default">
        {answerCss}
      </style>
      {/* affectUI's decision inbox: a heading row with the count, then one row per card */}
      <section className="ui-dic" data-clear={n === 0 || undefined}>
        <header className="ui-dic__head">
          {n > 0 ? <AlertIcon /> : <DoneIcon />}
          <span data-count={String(n)}>{n > 0 ? `${n} ${n === 1 ? "needs" : "need"} your input` : "All caught up"}</span>
          {q.error ? <span className="orch-danger ml-auto text-xs font-normal">Stale: {q.error.message}</span> : null}
        </header>
        <div className="ui-dic__card" data-list="cards">
          {view.cards.map((c) => (
            <CardView key={c.id} card={c} list="cards" presets={view.presets} isArmed={arming.isArmed(c.id, c.rev)} act={act} mon={mons.get(c.origin) ?? null} monType={c.project ? (accents?.get(c.project) ?? null) : null} />
          ))}
          {questions.map((i) => (
            <QuestionCard key={i.id} ix={i} isArmed={arming.isArmed(ixKey(i), 0)} mon={mons.get(i.address) ?? null} onSend={(a) => answerQuestion(i, a)} onOpen={() => navigate.toThread(i.threadId)} />
          ))}
          {view.cards.length + questions.length === 0 && n > 0 ? <p className="orch-muted m-0 px-4 py-3.5">No cards to answer: the threads below wait on you.</p> : null}
          <p className="ui-dic__empty">Nothing waiting on you – new decisions show up here.</p>
        </div>
      </section>

      {prompts.length > 0 ? (
        <Section title="Waiting on an agent" count={prompts.length}>
          <ul className="orch-rows m-0 list-none p-0">
            {prompts.map((i) => (
              <li key={i.id} data-interaction={i.threadId}>
                <button type="button" className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-0 bg-transparent px-1 py-2 text-left text-inherit hover:bg-[var(--orch-wash)]" onClick={() => navigate.toThread(i.threadId)} title={i.threadId}>
                  <Who address={i.address} nowrap />
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <Tag>{i.kind}</Tag>
                  {i.since ? <span className="orch-muted text-xs">{when(i.since)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {view.triaging.length > 0 ? (
        <Section title="Being triaged by the CoS" count={view.triaging.length}>
          <ul className="orch-rows m-0 list-none p-0">
            {view.triaging.map((t) => (
              <li key={t.id} data-triaging={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Kind of="open">triaging</Kind>
                <span className="min-w-0 flex-1">{t.title}</span>
                <span className="orch-muted inline-flex items-center gap-1.5 text-xs">
                  {t.project ?? "no project"} · <Who address={t.origin} nowrap />
                </span>
                <span className="orch-muted text-xs">due {when(t.dueAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {view.deferred.length > 0 ? (
        <section className="ui-dic">
          <header className="ui-dic__head">
            <span>Deferred</span>
            <Tag>{view.deferred.length}</Tag>
          </header>
          <div className="ui-dic__card" data-list="deferred">
            {view.deferred.map((c) => (
              <CardView key={c.id} card={c} list="deferred" presets={view.presets} isArmed={arming.isArmed(c.id, c.rev)} act={act} mon={mons.get(c.origin) ?? null} monType={c.project ? (accents?.get(c.project) ?? null) : null} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
