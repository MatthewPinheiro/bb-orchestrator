// Cloud Switch, the orchestrator's Cloud tab: one machine's AWS profiles and GCP configurations, which one the switch has made active, who
// each is logged in as, and the Entra PIM group that gates it. Use sets AWS_PROFILE / CLOUDSDK_ACTIVE_CONFIG_NAME in bb's
// machine environment (Off unsets it), Log in opens the login in a bb terminal on that machine (AWS: the device-code
// link and code show here). Prod is never one click: Use and Log in on a prod target ask again, naming it, and the
// server's host entry refuses without that name. Which accounts and projects are dev or prod, and their PIM groups, come
// from the user's config file on that machine; without one, the page says how to make it.
import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { experimental_Icon as Icon, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { pageContract } from "./contract.ts";
import type { ListingView, TargetView } from "./host-contract.ts";

type Rpc = ReturnType<typeof useRpc<typeof pageContract>>;
type Pending = { cloud: "aws" | "gcp"; name: string; terminalId: string; url: string | null; code: string | null; completeUrl: string | null; status: string };
type Ask = { kind: "use" | "login"; t: TargetView } | { kind: "revoke" } | null;

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Btn({ tone = "outline", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "outline" | "danger" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium disabled:pointer-events-none disabled:opacity-50",
        tone === "primary" && "bg-foreground text-background hover:bg-foreground/90",
        tone === "outline" && "border border-input hover:bg-state-hover",
        tone === "danger" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        className,
      )}
    />
  );
}

function LinkBtn({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium hover:bg-state-hover">
      {children}
      <Icon name="ExternalLink" className="size-3.5" />
    </a>
  );
}

function EnvBadge({ env }: { env: TargetView["env"] }) {
  if (env === "prod") return <span data-env="prod" className="rounded bg-destructive px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-destructive-foreground">PROD</span>;
  if (env === "dev") return <span data-env="dev" className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">dev</span>;
  return <span data-env="unknown" className="rounded border border-destructive px-1.5 py-0.5 text-[11px] font-medium text-destructive">env?</span>;
}

const DOT = { in: "bg-emerald-500", out: "bg-muted-foreground/50", unknown: "bg-amber-500", unchecked: "border border-muted-foreground" } as const;
const STATE = { in: "Logged in", out: "Logged out", unknown: "Unknown", unchecked: "Unchecked" } as const;

function Pim({ t }: { t: TargetView }) {
  if (!t.pim.length) return <span className="text-muted-foreground">PIM: no group in the config</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {t.pim.map((p) => (
        <span key={p.group} title={`${p.permissions}${p.inferred ? " · inferred" : ""}`}>
          <span className="font-mono">{p.group}</span>{" "}
          <span className={cx(p.approval ? "text-destructive" : "text-muted-foreground")}>
            {p.assignment === "active" ? "always on" : `${p.approval ? "approval needed" : "self-activate"}, ${p.maxDuration}`}
            {p.inferred ? " (inferred)" : ""}
          </span>
        </span>
      ))}
    </span>
  );
}

function Row({ t, v, busy, ask, onUse, onLogin, onAsk, onCheck }: { t: TargetView; v: string; busy: boolean; ask: Ask; onUse: (confirm?: string) => void; onLogin: (confirm?: string) => void; onAsk: (a: Ask) => void; onCheck: () => void }) {
  const asking = ask && ask.kind !== "revoke" && ask.t.cloud === t.cloud && ask.t.name === t.name ? ask.kind : null;
  const what = t.cloud === "aws" ? "AWS profile" : "gcloud configuration";
  return (
    <li data-target={`${t.cloud}:${t.name}`} className={cx("py-3", t.env === "prod" && "-mx-4 border-l-4 border-destructive bg-destructive/5 px-3")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm font-medium">{t.name}</span>
            <EnvBadge env={t.env} />
            {t.active ? <span data-active className="rounded bg-foreground px-1.5 py-0.5 text-[11px] font-medium text-background">ACTIVE</span> : null}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <span className={cx("size-2 shrink-0 rounded-full", DOT[t.state])} />
            <span className="shrink-0 whitespace-nowrap">{STATE[t.state]}</span>
            <span className="truncate text-muted-foreground" title={t.identity ?? t.why ?? ""}>{t.identity ?? t.why ?? ""}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[t.account && `account ${t.account}`, t.role && `role ${t.role}`, t.project && `project ${t.project}`].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-1 text-xs"><Pim t={t} /></div>
        </div>
        <div className="flex gap-2">
          {t.state === "unchecked" ? (
            <Btn disabled={busy} onClick={onCheck} aria-label={`Check ${t.name}`} title="Ask sts who this profile is now (read-only; fetches its role credentials)">
              Check
            </Btn>
          ) : null}
          <Btn disabled={busy || t.active} onClick={() => (t.gated ? onAsk({ kind: "use", t }) : onUse())} aria-label={`Use ${t.name}`}>
            {t.active ? "Active" : "Use"}
          </Btn>
          <Btn tone={t.state === "out" ? "primary" : "outline"} disabled={busy} onClick={() => (t.gated ? onAsk({ kind: "login", t }) : onLogin())} aria-label={`Log in ${t.name}`}>
            <Icon name="SquareUnlock02" className="size-3.5" />
            Log in
          </Btn>
        </div>
      </div>
      {asking ? (
        <div role="alertdialog" data-confirm={`${asking}:${t.name}`} className="mt-3 rounded-md border border-destructive bg-background p-3 text-sm">
          <p className="font-medium text-destructive">
            {t.env === "prod" ? "Production." : "This target is not known to be dev."}{" "}
            {asking === "use"
              ? `Set ${v}=${t.name} for every new thread, terminal and command?`
              : `Log in to ${what} ${t.name}?${t.pim.some((p) => p.assignment === "eligible") ? " Activate its PIM group first." : ""}`}
          </p>
          <div className="mt-2 flex gap-2">
            <Btn tone="danger" disabled={busy} onClick={() => (asking === "use" ? onUse(t.name) : onLogin(t.name))}>
              {asking === "use" ? `Yes, use ${t.name}` : `Yes, log in to ${t.name}`}
            </Btn>
            <Btn onClick={() => onAsk(null)}>Cancel</Btn>
          </div>
        </div>
      ) : null}
    </li>
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
      <div className="mt-2 rounded-lg border border-border bg-card px-4">{children}</div>
    </section>
  );
}

/** No config file (or a broken one): what cloud-switch can't know without it, and how to make it. */
function ConfigState({ config }: { config: ListingView["config"] }) {
  if (config.state === "ok") return null;
  return (
    <div data-config={config.state} className="mt-4 rounded-lg border border-dashed border-border bg-card p-4 text-sm">
      <p className="font-medium">{config.state === "missing" ? "No cloud-switch config file yet" : "The cloud-switch config file is invalid, so it is ignored"}</p>
      {config.error ? <pre className="mt-2 whitespace-pre-wrap text-xs text-destructive">{config.error}</pre> : null}
      <p className="mt-2 text-xs text-muted-foreground">
        Without it every AWS account and GCP project is <b>env unknown</b>, so Use and Log in ask for a confirm, and no PIM group is shown.
        Create <code>{config.path}</code> on this machine (copy <code>config.example.json</code> from the plugin) with your accounts, projects
        and their dev/prod env, the PIM groups that gate them, and optional links, then press Refresh. The plugin's "Config file" setting
        changes the path. The file never leaves the machine.
      </p>
    </div>
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
    <div data-login={`${p.cloud}:${p.name}`} className="mt-4 rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">Log in · {p.cloud} {p.name} — {p.status === "waiting" ? "waiting for you" : p.status}</p>
        <Btn onClick={onClose} aria-label="Close">Close</Btn>
      </div>
      {p.cloud === "aws" ? (
        p.url && p.code ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a data-login-url href={p.completeUrl ?? p.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90">
              Open AWS sign-in <Icon name="ExternalLink" className="size-3.5" />
            </a>
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
        <Btn onClick={() => void nav.experimental_openTerminal({ terminalId: p.terminalId })}>
          Open terminal
        </Btn>
      </div>
    </div>
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
  const row = (t: TargetView) => (
    <Row key={`${t.cloud}:${t.name}`} t={t} v={vars[t.cloud]} busy={busy} ask={ask} onAsk={setAsk} onUse={(c) => void use(t, c)} onLogin={(c) => void login(t, c)} onCheck={() => void check(t)} />
  );
  const status = (cloud: "aws" | "gcp", value: string | null, unset: string) => {
    const outside = !value && !!view?.outside?.[cloud];
    return (
      <>
        <code data-var={vars[cloud]} className={cx("rounded border bg-background px-1.5 py-0.5", outside ? "border-amber-500" : "border-border")}>
          {vars[cloud]}={value ?? (outside ? "(set outside cloud-switch, value hidden)" : "(unset)")}
        </code>
        {value || outside ? null : <span className="text-muted-foreground">{unset}</span>}
        {value || outside ? <Btn className="h-6 px-2" disabled={busy} onClick={() => void off(cloud)} aria-label={`Unset ${vars[cloud]}`}>Off</Btn> : null}
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
            <Btn disabled={loading} onClick={() => load(hostId)}><Icon name="ArrowReloadHorizontal" className={cx("size-3.5", loading && "animate-spin")} />Refresh</Btn>
          </div>
        </div>
        {view && view.hosts.length > 1 ? (
          <label className="mt-3 flex items-center gap-2 text-xs">
            Machine
            <select className="h-8 rounded-md border border-input bg-background px-2" value={hostId ?? ""} onChange={(e) => load(e.target.value)}>
              {view.hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
        ) : null}
        {view?.note ? (
          <p data-note className="mt-3 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
            <Icon name="Cloud" className="mt-px size-3.5 shrink-0" />
            {view.note}
          </p>
        ) : null}
        {note ? <p role={note.ok ? "status" : "alert"} className={cx("mt-3 text-sm", note.ok ? "text-foreground" : "text-destructive")}>{note.text}</p> : null}
        {view?.error ? <p role="alert" className="mt-3 text-sm text-destructive">{view.error}</p> : null}
        {l ? <ConfigState config={l.config} /> : null}
        {l?.notes.map((n) => <p key={n} className="mt-2 text-xs text-amber-600">{n}</p>)}
        {pending ? <PendingLogin p={pending} rpc={rpc} onClose={() => setPending(null)} onDone={(status) => { setPending((p) => (p ? { ...p, status } : p)); load(hostId); }} /> : null}
        {!view ? <p role="status" className="mt-6 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Reading the machine's logins…</p> : null}
        {l ? (
          <>
            <Section
              title="AWS profiles"
              sub={<>Use sets <code>{vars.aws}</code>; <code>{l.aws.config}</code> is only read. Log in signs in the profile's SSO session.</>}
              status={status("aws", l.aws.active, "aws uses the default chain: this machine's instance role")}
            >
              {aws.length ? <ul className="divide-y divide-border">{aws.map(row)}</ul> : <p className="py-4 text-sm text-muted-foreground">No AWS profiles.</p>}
            </Section>
            <Section
              title="GCP configurations"
              sub={<>Use sets <code>{vars.gcp}</code>. Login config: {l.gcp.loginConfig ?? "none found"} · ADC: {l.gcp.adc.present ? "present" : "none"}. Accounts and ADC are shared by every configuration.</>}
              status={status("gcp", l.gcp.active, `gcloud uses its own active configuration: ${l.gcp.gcloudActive ?? "none"}`)}
              action={ask?.kind === "revoke" ? (
                <span role="alertdialog" data-confirm="revoke" className="flex items-center gap-2 text-xs text-destructive">
                  Sign every gcloud account and ADC out of {machine}?
                  <Btn tone="danger" disabled={busy} onClick={() => void revoke()}>Yes, revoke</Btn>
                  <Btn onClick={() => setAsk(null)}>Cancel</Btn>
                </span>
              ) : <Btn disabled={busy} onClick={() => setAsk({ kind: "revoke" })}>Revoke gcloud logins</Btn>}
            >
              {gcp.length ? <ul className="divide-y divide-border">{gcp.map(row)}</ul> : <p className="py-4 text-sm text-muted-foreground">No gcloud configurations.</p>}
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The orchestrator's Cloud tab (Cloud Switch was its own plugin's page until 2026-11-13). */
export { CloudSwitchPage as CloudView };
