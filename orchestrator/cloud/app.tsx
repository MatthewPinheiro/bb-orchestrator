// Cloud Switch, the orchestrator's Cloud tab: one machine's AWS profiles and GCP configurations, which one the switch has made active, who
// each is logged in as, and the Entra PIM group that gates it. Use sets AWS_PROFILE / CLOUDSDK_ACTIVE_CONFIG_NAME in bb's
// machine environment (Off unsets it), Log in opens the login in a bb terminal on that machine (AWS: the device-code
// link and code show here). Prod is never one click: Use and Log in on a prod target ask again, naming it, and the
// server's host entry refuses without that name. Which accounts and projects are dev or prod, and their PIM groups, come
// from the user's config file on that machine; without one, the page says how to make it.
// shadcn (2026-11-17): app/ui's Button (asChild for links), Badge, Select, Item rows in a Card, Alert notes and lucide
// icons, on bb's tokens: success and warning for the login dots, and --destructive-text for words in red (its
// --destructive is 3.6:1 on the dark card). The two confirmations (a gated Use or Log in, and Revoke) are one
// AlertDialog: still a second, explicit click that names the target, and its Yes takes clicks only ARM_MS after it
// opens, so the second click of a double-click on Use can't land on it.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Cloud, ExternalLink, LockKeyholeOpen, RefreshCw } from "lucide-react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { pageContract } from "./contract.ts";
import type { ListingView, TargetView } from "./host-contract.ts";
import { ARM_MS } from "../app/gate.ts";
import { cn } from "../app/ui/utils.ts";
import { Alert, AlertDescription, AlertTitle } from "../app/ui/alert.tsx";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../app/ui/alert-dialog.tsx";
import { Badge } from "../app/ui/badge.tsx";
import { Button } from "../app/ui/button.tsx";
import { Card } from "../app/ui/card.tsx";
import { Item, ItemActions, ItemContent, ItemTitle } from "../app/ui/item.tsx";
import { Label } from "../app/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../app/ui/select.tsx";

type Rpc = ReturnType<typeof useRpc<typeof pageContract>>;
type Pending = { cloud: "aws" | "gcp"; name: string; terminalId: string; url: string | null; code: string | null; completeUrl: string | null; status: string };
type Ask = { kind: "use" | "login"; t: TargetView } | { kind: "revoke" } | null;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function LinkBtn({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} target="_blank" rel="noreferrer">
        {children}
        <ExternalLink className="size-3.5" />
      </a>
    </Button>
  );
}

function EnvBadge({ env }: { env: TargetView["env"] }) {
  if (env === "prod") return <Badge variant="destructive" data-env="prod">PROD</Badge>;
  if (env === "dev") return <Badge variant="secondary" data-env="dev">dev</Badge>;
  return <Badge variant="outline" data-env="unknown" className="border-destructive text-(--destructive-text)">env?</Badge>;
}

const DOT = { in: "bg-(--success)", out: "bg-muted-foreground/50", unknown: "bg-(--warning)", unchecked: "border border-muted-foreground" } as const;
const STATE = { in: "Logged in", out: "Logged out", unknown: "Unknown", unchecked: "Unchecked" } as const;

function Pim({ t }: { t: TargetView }) {
  if (!t.pim.length) return <span className="text-muted-foreground">PIM: no group in the config</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {t.pim.map((p) => (
        <span key={p.group} title={`${p.permissions}${p.inferred ? " · inferred" : ""}`}>
          <span className="font-mono">{p.group}</span>{" "}
          <span className={cn(p.approval ? "text-(--destructive-text)" : "text-muted-foreground")}>
            {p.assignment === "active" ? "always on" : `${p.approval ? "approval needed" : "self-activate"}, ${p.maxDuration}`}
            {p.inferred ? " (inferred)" : ""}
          </span>
        </span>
      ))}
    </span>
  );
}

function Row({ t, busy, onUse, onLogin, onAsk, onCheck }: { t: TargetView; busy: boolean; onUse: () => void; onLogin: () => void; onAsk: (a: Exclude<Ask, null>) => void; onCheck: () => void }) {
  return (
    <Item asChild size="sm" className="gap-x-3 gap-y-2 rounded-none border-0 border-b border-border px-0 py-3 last:border-b-0">
      <li data-target={`${t.cloud}:${t.name}`}>
        <ItemContent className="min-w-0 gap-1">
          <ItemTitle className="w-full min-w-0">
            <span className="truncate font-mono">{t.name}</span>
            <EnvBadge env={t.env} />
            {t.active ? <Badge data-active>ACTIVE</Badge> : null}
          </ItemTitle>
          <div className="flex items-center gap-1.5 text-xs">
            <span className={cn("size-2 shrink-0 rounded-full", DOT[t.state])} />
            <span className="shrink-0 whitespace-nowrap">{STATE[t.state]}</span>
            <span className="truncate text-muted-foreground" title={t.identity ?? t.why ?? ""}>{t.identity ?? t.why ?? ""}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {[t.account && `account ${t.account}`, t.role && `role ${t.role}`, t.project && `project ${t.project}`].filter(Boolean).join(" · ")}
          </div>
          <div className="text-xs"><Pim t={t} /></div>
        </ItemContent>
        <ItemActions>
          {t.state === "unchecked" ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onCheck} aria-label={`Check ${t.name}`} title="Ask sts who this profile is now (read-only; fetches its role credentials)">
              Check
            </Button>
          ) : null}
          <Button variant="outline" size="sm" disabled={busy || t.active} onClick={() => (t.gated ? onAsk({ kind: "use", t }) : onUse())} aria-label={`Use ${t.name}`}>
            {t.active ? "Active" : "Use"}
          </Button>
          <Button variant={t.state === "out" ? "default" : "outline"} size="sm" disabled={busy} onClick={() => (t.gated ? onAsk({ kind: "login", t }) : onLogin())} aria-label={`Log in ${t.name}`}>
            <LockKeyholeOpen className="size-3.5" />
            Log in
          </Button>
        </ItemActions>
      </li>
    </Item>
  );
}

/**
 * The second step of a gated Use or Log in, and of Revoke: it names the target, and only its Yes runs the call. It stays
 * open while the call runs and on a failure, which it shows (the page's own note is under the overlay); Cancel, Escape
 * and a success close it.
 */
function Confirm({ ask, v, machine, busy, error, onYes, onCancel }: { ask: Exclude<Ask, null>; v: { aws: string; gcp: string }; machine: string; busy: boolean; error: string | null; onYes: () => void; onCancel: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(timer);
  }, []);
  const t = ask.kind === "revoke" ? null : ask.t;
  const what = t?.cloud === "aws" ? "AWS profile" : "gcloud configuration";
  const title = !t ? "Revoke gcloud logins" : t.env === "prod" ? "Production." : "This target is not known to be dev.";
  const question = !t
    ? `Sign every gcloud account and ADC out of ${machine}?`
    : ask.kind === "use"
      ? `Set ${v[t.cloud]}=${t.name} for every new thread, terminal and command?`
      : `Log in to ${what} ${t.name}?${t.pim.some((p) => p.assignment === "eligible") ? " Activate its PIM group first." : ""}`;
  const yes = !t ? "Yes, revoke" : ask.kind === "use" ? `Yes, use ${t.name}` : `Yes, log in to ${t.name}`;
  return (
    <AlertDialog open onOpenChange={(open) => (open ? null : onCancel())}>
      <AlertDialogContent data-confirm={t ? `${ask.kind}:${t.name}` : "revoke"}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base text-(--destructive-text)">{title}</AlertDialogTitle>
          <AlertDialogDescription>{question}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="m-0 text-sm text-(--destructive-text)">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <Button variant="destructive" size="sm" disabled={busy || !armed} data-armed={armed ? "true" : "false"} onClick={onYes}>
            {yes}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Section({ title, sub, status, action, children }: { title: string; sub: ReactNode; status: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{sub}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">{status}</div>
        </div>
        {action}
      </div>
      <Card className="mt-2 gap-0 rounded-lg px-4 py-0 shadow-none">{children}</Card>
    </section>
  );
}

/** No config file (or a broken one): what cloud-switch can't know without it, and how to make it. */
function ConfigState({ config }: { config: ListingView["config"] }) {
  if (config.state === "ok") return null;
  return (
    <Alert data-config={config.state} className="mt-4">
      <AlertTitle>{config.state === "missing" ? "No cloud-switch config file yet" : "The cloud-switch config file is invalid, so it is ignored"}</AlertTitle>
      <AlertDescription>
      {config.error ? <pre className="whitespace-pre-wrap text-xs text-(--destructive-text)">{config.error}</pre> : null}
      <p className="text-xs">
        Without it every AWS account and GCP project is <b>env unknown</b>, so Use and Log in ask for a confirm, and no PIM group is shown.
        Create <code>{config.path}</code> on this machine (copy <code>config.example.json</code> from the plugin) with your accounts, projects
        and their dev/prod env, the PIM groups that gate them, and optional links, then press Refresh. The plugin's "Config file" setting
        changes the path. The file never leaves the machine.
      </p>
      </AlertDescription>
    </Alert>
  );
}

function PendingLogin({ p, rpc, onDone, onClose }: { p: Pending; rpc: Rpc; onDone: (status: string) => void; onClose: () => void }) {
  const nav = useBbNavigate();
  useEffect(() => {
    if (p.status !== "waiting") return;
    const timer = setInterval(() => {
      rpc.call("cs.loginStatus", { terminalId: p.terminalId }).then((s) => {
        if (s.status === "exited" || s.status === "disconnected") onDone(s.exitCode === 0 ? "done" : `ended (exit ${s.exitCode ?? "?"})`);
      }, () => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [p.terminalId, p.status, rpc, onDone]);
  return (
    <Card data-login={`${p.cloud}:${p.name}`} className="mt-4 gap-0 rounded-lg p-4 text-sm shadow-none">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">Log in · {p.cloud} {p.name} — {p.status === "waiting" ? "waiting for you" : p.status}</p>
        <Button variant="outline" size="sm" onClick={onClose} aria-label="Close">Close</Button>
      </div>
      {p.cloud === "aws" ? (
        p.url && p.code ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button asChild size="sm">
              <a data-login-url href={p.completeUrl ?? p.url} target="_blank" rel="noreferrer">
                Open AWS sign-in <ExternalLink className="size-3.5" />
              </a>
            </Button>
            <span className="text-xs text-muted-foreground">and confirm the code</span>
            <code data-login-code className="rounded border border-border bg-background px-2 py-1 font-mono text-base tracking-widest">{p.code}</code>
            <span className="text-xs text-muted-foreground">({p.url})</span>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">The link and code didn't show yet; they are in the login's terminal.</p>
        )
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">gcloud prints a link, then asks for the code the sign-in page gives you: paste it in the terminal. It logs in, sets the project, then logs in ADC.</p>
      )}
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={() => void nav.experimental_openTerminal({ terminalId: p.terminalId })}>
          Open terminal
        </Button>
      </div>
    </Card>
  );
}

function CloudSwitchPage() {
  const rpc = useRpc<typeof pageContract>();
  const nav = useBbNavigate();
  const [hostId, setHostId] = useState<string | null>(null);
  const [view, setView] = useState<{ hosts: { id: string; name: string }[]; listing: ListingView | null; error: string | null; vars?: { aws: string; gcp: string }; outside?: { aws: boolean; gcp: boolean }; note?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback((id: string | null) => {
    setLoading(true);
    rpc.call("cs.view", { hostId: id }).then((v) => { setView(v); setHostId(v.hostId); }, (e) => setView({ hosts: [], listing: null, error: msg(e) })).finally(() => setLoading(false));
  }, [rpc]);
  useEffect(() => load(null), [load]);

  const act = async (f: () => Promise<string>) => {
    if (!hostId) return;
    setBusy(true);
    try { setNote({ ok: true, text: await f() }); setAsk(null); load(hostId); } catch (e) { setNote({ ok: false, text: msg(e) }); } finally { setBusy(false); }
  };
  const use = (t: TargetView, confirm?: string) => act(async () => {
    const r = await rpc.call("cs.use", { hostId: hostId!, cloud: t.cloud, name: t.name, ...(confirm ? { confirm } : {}) });
    return `${r.variable}=${r.active} set${r.previous && r.previous !== r.active ? ` (was ${r.previous})` : ""}${r.created ? `; created gcloud configuration ${r.active}` : ""}.`;
  });
  const off = (cloud: "aws" | "gcp") => act(async () => {
    const r = await rpc.call("cs.off", { cloud });
    return `${r.variable} unset${r.previous ? ` (was ${r.previous})` : ""}: ${cloud === "aws" ? "aws goes back to the default chain, this machine's instance role" : "gcloud goes back to its own active configuration"}.`;
  });
  const login = (t: TargetView, confirm?: string) => act(async () => {
    const r = await rpc.call("cs.login", { hostId: hostId!, cloud: t.cloud, name: t.name, ...(confirm ? { confirm } : {}) });
    setPending({ cloud: t.cloud, name: t.name, status: "waiting", ...r });
    if (t.cloud === "gcp") void nav.experimental_openTerminal({ terminalId: r.terminalId });
    return `Login for ${t.cloud} ${t.name} opened in a terminal.`;
  });
  // a gated row's Check: one sts call for that profile, merged into the rows shown (a reload shows it unchecked again)
  const check = async (t: TargetView) => {
    if (!hostId) return;
    setBusy(true);
    try {
      const next = await rpc.call("cs.check", { hostId, name: t.name });
      setView((v) => (v?.listing ? { ...v, listing: { ...v.listing, targets: v.listing.targets.map((x) => (x.cloud === "aws" && x.name === t.name ? next : x)) } } : v));
    } catch (e) { setNote({ ok: false, text: msg(e) }); } finally { setBusy(false); }
  };
  const revoke = () => act(async () => {
    const r = await rpc.call("cs.revokeGcp", { hostId: hostId!, confirm: true });
    return r.steps.map((s) => `${s.command}: ${s.message}`).join(" · ");
  });

  const l = view?.listing;
  const aws = l?.targets.filter((t) => t.cloud === "aws") ?? [];
  const gcp = l?.targets.filter((t) => t.cloud === "gcp") ?? [];
  const machine = view?.hosts.find((h) => h.id === hostId)?.name ?? "this machine";
  const vars = view?.vars ?? { aws: "AWS_PROFILE", gcp: "CLOUDSDK_ACTIVE_CONFIG_NAME" };
  // a confirm opens without the last call's message, so an error inside it is this confirm's own
  const confirmFor = (a: Exclude<Ask, null>) => {
    setNote(null);
    setAsk(a);
  };
  const row = (t: TargetView) => (
    <Row key={`${t.cloud}:${t.name}`} t={t} busy={busy} onAsk={confirmFor} onUse={() => void use(t)} onLogin={() => void login(t)} onCheck={() => void check(t)} />
  );
  const status = (cloud: "aws" | "gcp", value: string | null, unset: string) => {
    const outside = !value && !!view?.outside?.[cloud];
    return (
      <>
        <code data-var={vars[cloud]} className={cn("rounded border bg-background px-1.5 py-0.5", outside ? "border-(--warning)" : "border-border")}>
          {vars[cloud]}={value ?? (outside ? "(set outside cloud-switch, value hidden)" : "(unset)")}
        </code>
        {value || outside ? null : <span className="text-muted-foreground">{unset}</span>}
        {value || outside ? <Button variant="outline" size="xs" disabled={busy} onClick={() => void off(cloud)} aria-label={`Unset ${vars[cloud]}`}>Off</Button> : null}
      </>
    );
  };

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto" data-cloud-switch>
      <div className="mx-auto box-border w-full max-w-4xl px-4 pb-8 pt-3 md:px-5 md:pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted-foreground">
            The AWS profile and gcloud configuration bb's <code>aws</code> and <code>gcloud</code> calls use when they name none, set as bb machine variables. Rows and logins are <b>{machine}</b>'s. Activate a PIM group before you log in: the role is stamped in at sign-in.
          </p>
          <div className="flex flex-wrap gap-2">
            {l?.links.map((k) => <LinkBtn key={k.url} href={k.url}>{k.label}</LinkBtn>)}
            <Button variant="outline" size="sm" disabled={loading} onClick={() => load(hostId)}><RefreshCw className={cn("size-3.5", loading && "animate-spin")} />Refresh</Button>
          </div>
        </div>
        {view && view.hosts.length > 1 ? (
          <div className="mt-3 flex items-center gap-2">
            <Label htmlFor="cloud-machine" className="text-xs font-normal">Machine</Label>
            <Select value={hostId ?? undefined} onValueChange={(id) => load(id)}>
              <SelectTrigger id="cloud-machine" size="sm" className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {view.hosts.map((h) => <SelectItem key={h.id} value={h.id} className="text-xs">{h.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {view?.note ? (
          <Alert data-note className="mt-3 px-3 py-2 text-xs">
            <Cloud className="size-3.5" />
            <AlertDescription className="text-xs text-foreground">{view.note}</AlertDescription>
          </Alert>
        ) : null}
        {note ? <p role={note.ok ? "status" : "alert"} className={cn("mt-3 text-sm", note.ok ? "text-foreground" : "text-(--destructive-text)")}>{note.text}</p> : null}
        {view?.error ? <p role="alert" className="mt-3 text-sm text-(--destructive-text)">{view.error}</p> : null}
        {l ? <ConfigState config={l.config} /> : null}
        {l?.notes.map((n) => <p key={n} className="mt-2 text-xs text-(--warning-text)">{n}</p>)}
        {pending ? <PendingLogin p={pending} rpc={rpc} onClose={() => setPending(null)} onDone={(status) => { setPending((p) => (p ? { ...p, status } : p)); load(hostId); }} /> : null}
        {!view ? <p role="status" className="mt-6 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Reading the machine's logins…</p> : null}
        {l ? (
          <>
            <Section
              title="AWS profiles"
              sub={<>Use sets <code>{vars.aws}</code>; <code>{l.aws.config}</code> is only read. Log in signs in the profile's SSO session.</>}
              status={status("aws", l.aws.active, "aws uses the default chain: this machine's instance role")}
            >
              {aws.length ? <ul>{aws.map(row)}</ul> : <p className="py-4 text-sm text-muted-foreground">No AWS profiles.</p>}
            </Section>
            <Section
              title="GCP configurations"
              sub={<>Use sets <code>{vars.gcp}</code>. Login config: {l.gcp.loginConfig ?? "none found"} · ADC: {l.gcp.adc.present ? "present" : "none"}. Accounts and ADC are shared by every configuration.</>}
              status={status("gcp", l.gcp.active, `gcloud uses its own active configuration: ${l.gcp.gcloudActive ?? "none"}`)}
              action={<Button variant="outline" size="sm" disabled={busy} onClick={() => confirmFor({ kind: "revoke" })}>Revoke gcloud logins</Button>}
            >
              {gcp.length ? <ul>{gcp.map(row)}</ul> : <p className="py-4 text-sm text-muted-foreground">No gcloud configurations.</p>}
            </Section>
          </>
        ) : null}
        {ask ? (
          <Confirm
            ask={ask}
            v={vars}
            machine={machine}
            busy={busy}
            error={note && !note.ok ? note.text : null}
            onCancel={() => setAsk(null)}
            onYes={() => void (ask.kind === "revoke" ? revoke() : ask.kind === "use" ? use(ask.t, ask.t.name) : login(ask.t, ask.t.name))}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The orchestrator's Cloud tab (Cloud Switch was its own plugin's page until 2026-11-13). */
export { CloudSwitchPage as CloudView };
