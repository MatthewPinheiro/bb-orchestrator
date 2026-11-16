// Small shared pieces, built on the vendored affectUI items (app/affect): buttons, badges for kinds, avatars for roles,
// card sections and time formatting. Colours for roles and kinds come from palette.ts, fed into affectUI's own CSS
// variables, so the look is affectUI's and the colour code stays ours.
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Avatar } from "./affect/avatar-clean.tsx";
import { Badge } from "./affect/badge-clean.tsx";
import { Button } from "./affect/button-clean.tsx";
import { Card, CardContent, CardHeader } from "./affect/card-clean.tsx";
import { EmptyState } from "./affect/empty-state-clean.tsx";
import { gate } from "./store.ts";
import { KIND_TONES, ROLE_TONES, css, kindOf, roleOf, tint, type KindKey } from "./palette.ts";
import { ownerOnScreen } from "../core/owner.ts";
import { useIdentity } from "./identity.ts";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * The page's own CSS, unlayered so it holds against affectUI's injected styles, and scoped by [data-orch] (the panel).
 * - affectUI's text colours for what sits outside its components, in both themes (bb sets color-scheme on html.dark).
 * - The double-tap guard: no press scale on buttons and no entry animation on the defer menu, so nothing under the
 *   pointer shrinks or moves between a press and its release.
 * - Our rows inside the decision inbox: full width, options with a second line, disabled options.
 */
const LOOK = `
[data-orch] {
  --orch-ink: light-dark(rgba(0, 0, 0, 0.88), rgba(255, 255, 255, 0.9));
  --orch-muted: light-dark(rgba(0, 0, 0, 0.61), rgba(255, 255, 255, 0.62));
  --orch-line: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08));
  --orch-wash: light-dark(rgba(0, 0, 0, 0.03), rgba(255, 255, 255, 0.04));
  --orch-danger: light-dark(#c4320a, #ff8a7a);
  font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 13px;
  line-height: 20px;
  color: var(--orch-ink);
  -webkit-font-smoothing: antialiased;
}
[data-orch] .ui-buttonc:active, [data-orch] .ui-dic__btn:active { transform: none !important; }
[data-orch] .ui-dmc__panel { animation: none !important; }
[data-orch] .ui-dic { max-width: none; }
[data-orch] .ui-dic__btn { gap: 6px; text-align: start; }
[data-orch] .ui-dic__btn:disabled { opacity: 0.5; cursor: default; }
[data-orch] .orch-opt-note { font-weight: 400; opacity: 0.7; }
/* Requested 2026-11-13: "Recommended" stays one word on one line however long the option is */
[data-orch] .orch-opt-rec { white-space: nowrap; flex-shrink: 0; }
[data-orch] .orch-muted { color: var(--orch-muted); }
[data-orch] .orch-danger { color: var(--orch-danger); }
[data-orch] .orch-rows > * + * { border-top: 0.5px solid var(--orch-line); }
[data-orch] .orch-wash { background: var(--orch-wash); border-radius: 6px; }
[data-orch] .orch-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
`;
export function Look() {
  return (
    <style href="orch-look" precedence="default">
      {LOOK}
    </style>
  );
}

const VARIANT = { primary: "primary", outline: "secondary", ghost: "ghost", danger: "destructive" } as const;
/** affectUI's button. Disabled stays a real `disabled`: a click on it stops there, not on what's below. */
export function Btn({ tone = "outline", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof VARIANT; [data: `data-${string}`]: string | undefined }) {
  return <Button variant={VARIANT[tone]} {...p} />;
}

/** A plain label (no colour group): affectUI's neutral badge. */
export function Tag({ children, ...p }: { children: ReactNode; [data: `data-${string}`]: string | undefined }) {
  return <Badge {...p}>{children}</Badge>;
}

/**
 * A kind or state (a raw string from the server) as an affectUI badge in its kind's colour, with a dot. Unknown kinds
 * stay neutral. `group` picks the colour group directly (a PR chip's colour is worked out from several fields).
 */
export function Kind({ of, group, children, ...p }: { of: string; group?: KindKey; children?: ReactNode; [data: `data-${string}`]: string | undefined }) {
  const kind = group ?? kindOf(of);
  const tone = kind ? KIND_TONES[kind] : null;
  const style = tone ? ({ "--bg": tint(tone), "--fg": css(tone), "--dot": css(tone) } as CSSProperties) : undefined;
  return (
    <Badge dot={tone !== null} style={style} {...p}>
      {children ?? of}
    </Badge>
  );
}

/** An address (or role or level) in its role's colour: an affectUI avatar (an agent's pixel mark in the role colour, the owner's initial) and the words. */
export function Who({ address, children, nowrap }: { address: string | null | undefined; children?: ReactNode; nowrap?: boolean }) {
  const role = roleOf(address);
  const color = role ? css(ROLE_TONES[role]) : undefined;
  const { ownerName } = useIdentity();
  return (
    <span className={cx("orch-mono inline-flex min-w-0 items-center gap-1.5", nowrap ? "whitespace-nowrap" : "[overflow-wrap:anywhere]")} style={{ color }}>
      {role === "person" ? (
        // affectUI's initial on its soft colour, turned to the person hue; the words beside it name the person
        <Avatar name={ownerOnScreen(ownerName).Name} size={20} aria-label="" style={{ "--h": "330" } as CSSProperties} />
      ) : role ? (
        <Avatar kind="agent" seed={address ?? role} color={color} size={20} />
      ) : null}
      {children ?? address ?? "—"}
    </span>
  );
}

/** A section: an affectUI card with a title, its count, and the content. */
export function Section({ title, count, children, ...p }: { title: string; count?: number; children: ReactNode; [data: `data-${string}`]: string | undefined }) {
  return (
    <Card as="section" {...p}>
      <CardHeader title={title} titleAs="h3" action={count !== undefined ? <Tag>{count}</Tag> : undefined} />
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** The last failed write's message, where it belongs ("board", "rules", "projects"). Callers re-render on useGate(). */
export function PageError({ where }: { where: string }) {
  return gate.error?.where === where ? (
    <p role="alert" className="orch-danger m-0 mt-2 text-xs">
      {gate.error.message}
    </p>
  ) : null;
}

/** A read's state above its view: loading, failed (with Retry), or stale data kept while a refresh failed. */
export function ReadState({ q, what }: { q: { data: unknown; error: { message: string } | null; refetch: () => Promise<void> }; what: string }) {
  if (q.data !== undefined) return q.error ? <p className="orch-danger m-0 text-xs">Stale: {q.error.message}</p> : null;
  return q.error ? (
    <EmptyState title={`Can't read ${what}`} text={q.error.message} icon={null} action={<Btn onClick={() => void q.refetch()}>Retry</Btn>} />
  ) : (
    <Muted>Loading…</Muted>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="orch-muted m-0">{children}</p>;
}

/** A time from an ISO string or epoch ms, short and local. */
export function when(t: string | number | null | undefined): string {
  if (t === null || t === undefined || t === "") return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
