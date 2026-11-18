// The CodeRabbit review queue's page (2026-11-18, from a contributor's public PR, redrawn on app/ui): one component,
// ReviewQueueView, mounted as the CodeRabbit tab (app.tsx).
// What it shows: the queued PRs in order (CI from required checks, unresolved threads, approvals on the head, the head
// against CodeRabbit's last review, why each is or isn't next), Schedule and Auto (both off by default), the interval,
// the next run, the cooldown and the last outcome. Dry-run (the reviewQueueDryRun plugin setting, on by default) is a
// banner with what a live run would have posted; the page has no switch for it. With dry-run off, Run now first shows
// a confirm naming the PR and the exact comment, and posts only on that click. Queue settings hold the GitHub machine and
// the optional model picker (off until a provider is chosen); the status says who picked the last run's PR.
// Every change is a page write (store.ts write to REVIEW_QUEUE_WRITE), never an RPC. Reorder: drag, or the ↑ ↓ buttons.
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ChevronDown, ChevronUp, GripVertical, ListOrdered } from "lucide-react";
import { experimental_useRpcQuery, useRealtime } from "@get-bb/plugin-sdk/app";
import { assess, INTERVALS, type Entry, type QueueConfig } from "../core/review-queue.ts";
import { QUEUE_CHANNEL, REVIEW_QUEUE_WRITE, queueContract, type QueueAction, type QueueView } from "../review-queue/contract.ts";
import { PR_CHIP_TONES, css, tint } from "./palette.ts";
import { useGate, write } from "./store.ts";
import { Btn, EmptyState, PageError, ReadState, when } from "./ui.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";
import { Input } from "./ui/input.tsx";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "./ui/item.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { Skeleton } from "./ui/skeleton.tsx";

const NOTE = "m-0 text-xs text-muted-foreground";
const WHERE = "review-queue";
/** "acme/app#12" from a PR URL. */
const ref = (url: string) => url.replace(/^https:\/\/github\.com\//, "").replace("/pull/", "#");
const short = (sha: string) => sha.slice(0, 7);
const ANY_HOST = "any";
const NO_PICKER = "off";

function useQueue() {
  const q = experimental_useRpcQuery({ contract: queueContract, method: "reviewQueue", input: null });
  const refetch = useRef(q.refetch);
  refetch.current = q.refetch;
  const again = useCallback(() => void refetch.current(), []);
  useRealtime(QUEUE_CHANNEL, again);
  useEffect(() => {
    const t = setInterval(again, 15_000);
    return () => clearInterval(t);
  }, [again]);
  return { q, again };
}

export function ReviewQueueView() {
  const { q, again } = useQueue();
  useGate();
  const v = q.data;
  return (
    <div className="mx-auto grid max-w-5xl gap-6" data-review-queue="">
      {v ? <Queue v={v} again={again} /> : q.error ? <ReadState q={q} what="the review queue" /> : <QueueSkeleton />}
    </div>
  );
}

/** No read yet: the queue's shape, pulsing. */
function QueueSkeleton() {
  return (
    <div role="status" className="grid gap-3" data-queue-skeleton="">
      <span className="sr-only">Loading the review queue…</span>
      <Skeleton className="h-5 w-56" />
      <Skeleton className="h-16 w-full" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

function Queue({ v, again }: { v: QueueView; again: () => void }) {
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const act = async (a: QueueAction) => {
    const out = await write(REVIEW_QUEUE_WRITE, a, { kind: "other", where: WHERE, after: again });
    return !!out?.ok;
  };
  const config = v.config;
  // only the fields that changed: the server merges, so a toggle never resends (or reverts) the other settings
  const configure = (c: Partial<QueueConfig>) => void act({ action: "configure", config: c });
  const now = Date.now();
  const held = v.spacingUntil > now;
  const run = () => (v.dryRun ? void act({ action: "run" }) : setConfirming(true));
  const last = Object.values(v.history).sort((a, b) => b.at - a.at);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="m-0 text-base font-semibold">CodeRabbit review queue</h2>
          <p className={NOTE}>One "@coderabbitai review" at a time, at most once an hour.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" disabled={v.busy} onClick={() => void act({ action: "refresh" })} data-refresh="">
            {v.busy ? "Checking…" : "Refresh"}
          </Btn>
          <Btn size="sm" tone={v.dryRun ? "outline" : "primary"} disabled={v.busy || held} onClick={run} data-run="">
            {v.dryRun ? "Dry run now" : "Run now"}
          </Btn>
        </div>
      </div>
      {v.dryRun ? (
        <Alert data-dry-run="">
          <AlertTitle>Dry-run: nothing is posted to GitHub</AlertTitle>
          <AlertDescription>
            <p className="m-0">The queue checks and picks a PR, and posts nothing. Turn off reviewQueueDryRun in the plugin settings to go live.</p>
            {v.wouldPost ? (
              <p className="m-0" data-would-post={v.wouldPost.url}>
                Last dry run, {when(v.wouldPost.at)}: would post <code className="font-mono">{v.wouldPost.comment}</code> on{" "}
                <a href={v.wouldPost.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {ref(v.wouldPost.url)}
                </a>{" "}
                at {short(v.wouldPost.head)}.
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Toggle id="rq-schedule" label="Schedule" checked={config.enabled} onChange={(enabled) => configure({ enabled })} />
        <Toggle id="rq-auto" label="Auto" checked={config.auto} onChange={(auto) => configure({ auto })} />
        <div className="flex items-center gap-2">
          <Label htmlFor="rq-interval" className="text-sm font-normal">
            Every
          </Label>
          <Select value={String(config.intervalMinutes)} onValueChange={(m) => configure({ intervalMinutes: Number(m) })}>
            <SelectTrigger id="rq-interval" size="sm" className="w-32" data-interval="">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...INTERVALS, config.intervalMinutes])].sort((a, b) => a - b).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m % 60 === 0 ? `${m / 60} h` : `${m} min`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className={NOTE}>{v.login ? `Signed in to GitHub as ${v.login}` : "Refresh to check the GitHub login"}</span>
      </div>
      <p className={NOTE}>Auto adds your own PRs with passing required checks when nothing queued is eligible. A pin goes first, then one approval on the head, then queue order.</p>
      <dl className={`m-0 grid grid-cols-2 gap-4 border-y py-4 ${config.pickerProvider ? "md:grid-cols-3 lg:grid-cols-5" : "md:grid-cols-4"}`} data-status="">
        <Stat term="Next run" value={config.enabled ? when(Math.max(v.nextAt ?? now, v.spacingUntil)) : "Schedule is off"} />
        <Stat term="Cooldown" value={held ? `Until ${when(v.spacingUntil)}` : "Ready"} />
        <Stat term="Last run" value={when(v.lastAt)} />
        <Stat term="Last outcome" value={v.lastMessage.replace(/https:\/\/github\.com\/\S+\/pull\/\d+/g, ref)} />
        {config.pickerProvider ? <Stat term="Picked by" value={v.lastPicker} /> : null}
      </dl>
      {v.error ? (
        <p role="alert" className="m-0 text-sm text-(--destructive-text)" data-queue-error="">
          {v.error}
        </p>
      ) : null}
      <PageError where={WHERE} />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          // the server reads the new PR itself: one write (a second one here would meet the page's write gate)
          void act({ action: "add", url }).then((ok) => ok && setUrl(""));
        }}
      >
        <Input aria-label="Pull request URL" placeholder="https://github.com/owner/repo/pull/123" value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-48 flex-1" />
        <Btn type="submit" size="sm" disabled={!url.trim()}>
          Add PR
        </Btn>
      </form>
      <section className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="m-0 text-sm font-semibold">
            Queued PRs <span className="font-normal text-muted-foreground">{v.entries.length}</span>
          </h3>
          <span className={NOTE}>Drag, or use ↑ ↓, to reorder</span>
        </div>
        {v.entries.length === 0 ? (
          <EmptyState title="The queue is empty" text={`Add a PR, or turn on Auto and run a ${v.dryRun ? "dry run" : "check"}.`} icon={<ListOrdered />} data-queue-empty="" />
        ) : (
          <Rows v={v} act={act} now={now} />
        )}
      </section>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="justify-self-start" data-settings-toggle="">
            Queue settings
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid max-w-xl gap-2 pt-2" data-settings="">
          <Label htmlFor="rq-host" className="text-sm font-normal">
            GitHub machine (its gh login asks for the reviews)
          </Label>
          <Select value={config.hostId || ANY_HOST} onValueChange={(h) => configure({ hostId: h === ANY_HOST ? "" : h })}>
            <SelectTrigger id="rq-host" size="sm" className="w-full" data-host="">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_HOST}>The only connected machine</SelectItem>
              {v.hosts.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className={NOTE}>Dry-run is the reviewQueueDryRun plugin setting. Keep it on while another CodeRabbit scheduler runs.</p>
          <Picker v={v} configure={configure} />
        </CollapsibleContent>
      </Collapsible>
      {last.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="justify-self-start">
              Recent requests {last.length}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-1 pt-2" data-history="">
            {last.slice(0, 20).map((a) => (
              <p key={a.url} className={NOTE}>
                {when(a.at)} · {a.outcome.replaceAll("_", " ")} · {short(a.head)} ·{" "}
                <a href={a.commentUrl ?? a.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {ref(a.url)}
                </a>
              </p>
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {confirming ? <Confirm v={v} act={act} onClose={() => setConfirming(false)} /> : null}
    </>
  );
}

/** The optional model picker's three settings, saved together. Off ("Deterministic order") by default. */
function Picker({ v, configure }: { v: QueueView; configure: (c: Partial<QueueConfig>) => void }) {
  const c = v.config;
  const [provider, setProvider] = useState(c.pickerProvider);
  const [model, setModel] = useState(c.pickerModel);
  const [project, setProject] = useState(c.pickerProjectId);
  const dirty = provider !== c.pickerProvider || model !== c.pickerModel || project !== c.pickerProjectId;
  const incomplete = !!provider && (!model.trim() || !project.trim());
  const providers = c.pickerProvider && !v.providers.some((p) => p.id === c.pickerProvider) ? [...v.providers, { id: c.pickerProvider, name: c.pickerProvider }] : v.providers;
  return (
    <fieldset className="m-0 mt-2 grid gap-2 border-0 border-t border-border p-0 pt-3" data-picker="">
      <legend className="p-0 text-sm font-medium">Model picker (optional)</legend>
      <p className={NOTE}>
        Off by default: the queue asks the first eligible PR by pin, approvals, then queue order. With a provider set, a short bb thread ranks the eligible PRs from numbers only (approvals, CI, open threads), never
        their titles or links. Any failure, timeout or stale answer falls back to the deterministic order.
      </p>
      <Label htmlFor="rq-picker-provider" className="text-sm font-normal">
        Picker provider
      </Label>
      <Select value={provider || NO_PICKER} onValueChange={(p) => setProvider(p === NO_PICKER ? "" : p)}>
        <SelectTrigger id="rq-picker-provider" size="sm" className="w-full" data-picker-provider="">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_PICKER}>Off: deterministic order</SelectItem>
          {providers.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {provider ? (
        <>
          <Label htmlFor="rq-picker-model" className="text-sm font-normal">
            Picker model
          </Label>
          <Input id="rq-picker-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-haiku-5-5" className="h-8" data-picker-model="" />
          <Label htmlFor="rq-picker-project" className="text-sm font-normal">
            Picker project ID (the bb project its thread belongs to)
          </Label>
          <Input id="rq-picker-project" value={project} onChange={(e) => setProject(e.target.value)} className="h-8" data-picker-project="" />
          <p className={NOTE}>The thread runs in a personal folder on the GitHub machine, not a worktree, and is archived once it answers. bb has no read-only permission mode, so it is told not to use its tools. Scheduled runs and dry runs use the model; a live Run now posts the PR its confirm names, picked by the order above.</p>
        </>
      ) : null}
      <Btn
        size="sm"
        tone="outline"
        className="justify-self-start"
        disabled={!dirty || incomplete}
        onClick={() => configure({ pickerProvider: provider, pickerModel: provider ? model.trim() : "", pickerProjectId: provider ? project.trim() : "" })}
        data-picker-save=""
      >
        Save picker
      </Btn>
    </fieldset>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(c === true)} className="relative after:absolute after:-inset-1 after:content-['']" data-toggle={id} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label} {checked ? "on" : "off"}
      </Label>
    </div>
  );
}

function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div className="grid min-w-0 content-start gap-1">
      <dt className={NOTE}>{term}</dt>
      <dd className="m-0 text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

/** A Badge in one of Open PRs' state tones. */
function Chip({ tone, children, ...p }: { tone: keyof typeof PR_CHIP_TONES; children: string; [data: `data-${string}`]: string | undefined }) {
  const t = PR_CHIP_TONES[tone];
  return (
    <Badge variant="secondary" className="max-w-full shrink" style={{ color: css(t), background: tint(t) }} {...p}>
      <span className="truncate">{children}</span>
    </Badge>
  );
}
const CI_TONE = { pass: "ok", fail: "fail", pending: "pending", unknown: "neutral" } as const;

function Rows({ v, act, now }: { v: QueueView; act: (a: QueueAction) => Promise<boolean>; now: number }) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const urls = v.entries.map((e) => e.url);
  const move = (from: string, to: number) => {
    const next = urls.filter((u) => u !== from);
    next.splice(to, 0, from);
    void act({ action: "reorder", urls: next });
  };
  const drop = (target: string) => (ev: DragEvent) => {
    ev.preventDefault();
    if (dragged && dragged !== target) move(dragged, urls.indexOf(target));
    setDragged(null);
    setOver(null);
  };
  return (
    <ItemGroup className="gap-2" data-queue-rows="">
      {v.entries.map((e, i) => (
        <Item
          key={e.url}
          variant="outline"
          className={over === e.url ? "bg-muted/50" : undefined}
          draggable
          onDragStart={(ev) => {
            setDragged(e.url);
            ev.dataTransfer.setData("text/plain", e.url);
            ev.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            setDragged(null);
            setOver(null);
          }}
          onDragOver={(ev) => {
            ev.preventDefault();
            setOver(e.url);
          }}
          onDrop={drop(e.url)}
          data-row={e.url}
          data-pinned={e.pinned ? "true" : "false"}
        >
          <ItemMedia className="cursor-grab text-muted-foreground" aria-hidden>
            <GripVertical className="size-4" />
          </ItemMedia>
          <Row e={e} v={v} now={now} />
          <ItemActions className="flex-wrap">
            <Btn size="sm" tone="ghost" icon={<ChevronUp />} aria-label={`Move ${ref(e.url)} up`} disabled={i === 0} onClick={() => move(e.url, i - 1)} />
            <Btn size="sm" tone="ghost" icon={<ChevronDown />} aria-label={`Move ${ref(e.url)} down`} disabled={i === v.entries.length - 1} onClick={() => move(e.url, i + 1)} />
            <Btn size="sm" tone="ghost" aria-pressed={e.pinned} onClick={() => void act({ action: "pin", url: e.url })} data-pin="">
              {e.pinned ? "Unpin" : "Pin next"}
            </Btn>
            <Btn size="sm" tone="ghost" onClick={() => void act({ action: "remove", url: e.url })} data-remove="">
              Remove
            </Btn>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}

function Row({ e, v, now }: { e: Entry; v: QueueView; now: number }) {
  const f = e.facts;
  const a = assess(e, v.history[e.url] ?? null, v.login, now);
  return (
    <ItemContent className="min-w-0 gap-1.5">
      <ItemTitle className="min-w-0">
        <a href={e.url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
          {f?.title ?? ref(e.url)}
        </a>
      </ItemTitle>
      <p className={NOTE}>
        {ref(e.url)}
        {f ? ` · by ${f.author}` : ""} · {e.auto ? "found by Auto" : "added by you"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {e.pinned ? (
          <Badge variant="default" data-chip="pinned">
            Pinned next
          </Badge>
        ) : null}
        {f ? (
          <>
            <Chip tone={CI_TONE[f.ci]} data-chip="ci">{`Required checks ${f.ci}`}</Chip>
            <Badge variant="outline" data-chip="threads">{`${f.threads} unresolved ${f.threads === 1 ? "thread" : "threads"}`}</Badge>
            <Badge variant="outline" data-chip="approvals">{`${f.approvals} ${f.approvals === 1 ? "approval" : "approvals"} on head`}</Badge>
          </>
        ) : null}
        {(e.pinned && a.eligible) || e.error ? null : (
          <Chip tone={a.eligible ? "ok" : "muted"} data-chip="reason">
            {a.reason}
          </Chip>
        )}
      </div>
      {f ? (
        <p className={NOTE}>
          Head {short(f.head)} · CodeRabbit: {f.lastReview ? `${short(f.lastReview.head)}, ${when(f.lastReview.at)}${f.reviewedHead ? ", this head" : ", an older head"}` : "no review yet"} · checked {when(e.fetchedAt)}
        </p>
      ) : null}
      {e.error ? (
        <p className="m-0 text-xs break-words text-(--destructive-text)" data-row-error="">
          {e.error}
        </p>
      ) : null}
    </ItemContent>
  );
}

/** Dry-run off: Run now names the PR and the exact comment first, and posts only on this click. */
function Confirm({ v, act, onClose }: { v: QueueView; act: (a: QueueAction) => Promise<boolean>; onClose: () => void }) {
  const [running, setRunning] = useState(false);
  const next = v.next;
  return (
    <AlertDialog open onOpenChange={(open) => (open || running ? null : onClose())}>
      <AlertDialogContent data-run-confirm="">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{next ? `Post on ${ref(next.url)}?` : "Nothing to post"}</AlertDialogTitle>
          <AlertDialogDescription>{next ? "This comment goes to GitHub as you, once." : "No queued PR is eligible now. Refresh to read GitHub again."}</AlertDialogDescription>
        </AlertDialogHeader>
        {next ? (
          <div className="grid gap-2 text-sm">
            <p className="m-0">
              {next.title} <span className="text-muted-foreground">at {short(next.head)}</span>
            </p>
            <code className="rounded-md border bg-muted px-3 py-2 font-mono text-sm" data-confirm-comment="">
              {next.comment}
            </code>
            <p className={NOTE}>From the facts last read; the server checks them again and posts nothing if anything changed.</p>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" disabled={running}>
            Cancel
          </AlertDialogCancel>
          {next ? (
            <Button
              size="sm"
              disabled={running}
              data-confirm-post=""
              onClick={async () => {
                setRunning(true);
                await act({ action: "run", confirm: { url: next.url, head: next.head } });
                setRunning(false);
                onClose();
              }}
            >
              {running ? "Posting…" : "Post comment"}
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
