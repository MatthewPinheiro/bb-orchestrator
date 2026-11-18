// Post to the code-review channel through Slack's Web API (2026-11-17, the owner: "just to actually post to code reviews
// ... using the slack token if you have it connected"). Server only: the token lives in the slackToken secret setting and
// goes nowhere but the Authorization header of a request to slack.com; it is never logged, returned or put in an error.
// Token-agnostic: a user token (xoxp, the post shows as its owner) and a bot token (xoxb) work the same way. Scopes:
// chat:write to post, channels:read (and groups:read for a private channel) to find a channel by name, users:read to turn
// a mapped @handle into a real mention. `fetch` is injected, so the tests run on a fake.
import { channelOf } from "../core/open-prs.ts";

export type SlackFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

const API = "https://slack.com/api/";
const CACHE_MS = 6 * 3600_000;
const CALL_MS = 10_000;
const MAX_PAGES = 20;
export const SLACK_ID_RE = /^[CGD][A-Z0-9]{6,}$/;

/** A Slack failure, in words the owner can act on; `code` is Slack's own error code. `maybe` when it may have posted. */
export class SlackError extends Error {
  readonly code: string;
  readonly maybe: boolean;
  constructor(code: string, message: string, maybe = false) {
    super(message);
    this.name = "SlackError";
    this.code = code;
    this.maybe = maybe;
  }
}

/** Slack's error codes, in words: what is wrong and what to do. */
export function slackWords(code: string, extra: { needed?: string; channel?: string; retryAfter?: string | null } = {}): string {
  const ch = extra.channel ?? "the review channel";
  switch (code) {
    case "not_authed":
    case "invalid_auth":
    case "token_revoked":
    case "token_expired":
    case "account_inactive":
      return `Slack refused the token (${code}). Paste a new one in the slackToken setting.`;
    case "missing_scope":
      return `The Slack token lacks the ${extra.needed ?? "needed"} scope. Add it to the Slack app, reinstall it, and paste the new token.`;
    case "not_in_channel":
      return `The token's user or bot isn't in ${ch}. Join it (for a bot: /invite it in the channel), then post again.`;
    case "channel_not_found":
      return `Slack has no channel ${ch} that this token can see. Check reviewChannel, or add the bot to a private channel.`;
    case "is_archived":
      return `${ch} is archived.`;
    case "msg_too_long":
      return "The message is too long for Slack. Untick some PRs.";
    case "restricted_action":
    case "ekm_access_denied":
      return `This workspace doesn't let this token post in ${ch}.`;
    case "ratelimited":
      return `Slack is rate-limiting this token${extra.retryAfter ? `; try again in ${extra.retryAfter} s` : ""}.`;
    default:
      return `Slack answered ${code}.`;
  }
}

/** A Slack Web API client on one token. Reads are GETs with query parameters; chat.postMessage is a JSON POST. */
export function slackClient(token: string, fetchImpl: SlackFetch) {
  async function call(method: string, params: Record<string, string | boolean>, opts: { post?: boolean; channel?: string } = {}): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    let url = API + method;
    let body: string | undefined;
    if (opts.post) {
      headers["content-type"] = "application/json; charset=utf-8";
      body = JSON.stringify(params);
    } else url += `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
    let res: Awaited<ReturnType<SlackFetch>>;
    try {
      res = await fetchImpl(url, { method: opts.post ? "POST" : "GET", headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(CALL_MS) });
    } catch (e) {
      // no answer: for a post it may still have gone through
      throw new SlackError("network", `Slack didn't answer (${e instanceof Error ? e.name : "network"}).`, !!opts.post);
    }
    if (res.status === 429) throw new SlackError("ratelimited", slackWords("ratelimited", { retryAfter: res.headers.get("retry-after") }));
    let j: Record<string, unknown>;
    try {
      j = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new SlackError("bad_answer", `Slack answered HTTP ${res.status} without JSON.`, !!opts.post && res.ok);
    }
    if (j.ok !== true) {
      const code = typeof j.error === "string" ? j.error : "unknown_error";
      throw new SlackError(code, slackWords(code, { needed: typeof j.needed === "string" ? j.needed : undefined, channel: opts.channel }));
    }
    return j;
  }
  /** Every page of a cursor-paginated list, up to MAX_PAGES. */
  async function list<T>(method: string, params: Record<string, string>, key: string): Promise<T[]> {
    const out: T[] = [];
    let cursor = "";
    for (let i = 0; i < MAX_PAGES; i++) {
      const j = await call(method, { ...params, ...(cursor ? { cursor } : {}) });
      out.push(...((j[key] as T[] | undefined) ?? []));
      cursor = String((j.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "");
      if (!cursor) break;
    }
    return out;
  }
  return { call, list };
}

/** reviewChannel as Slack sees it: an ID (from the setting, a link's /archives/<ID> or ?channel=<ID>), else a name. */
export function channelRef(setting: string): { id: string } | { name: string } | null {
  const s = setting.trim();
  if (!s) return null;
  if (/^https:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const arch = /\/archives\/([A-Z0-9]+)/.exec(u.pathname)?.[1];
      if (arch && SLACK_ID_RE.test(arch)) return { id: arch };
      const ch = u.searchParams.get("channel")?.replace(/^#/, "");
      if (ch) return SLACK_ID_RE.test(ch) ? { id: ch } : { name: ch.toLowerCase() };
    } catch {
      return null;
    }
    return null;
  }
  const n = s.replace(/^#/, "");
  if (!channelOf(n)) return null;
  return SLACK_ID_RE.test(n) ? { id: n } : { name: n.toLowerCase() };
}

type Channel = { id: string; name?: string; is_member?: boolean };
type User = { id: string; name?: string; deleted?: boolean; is_bot?: boolean; profile?: { display_name?: string; display_name_normalized?: string } };

/**
 * The poster: finds the channel and the mentions (kept six hours, per token) and posts. Every call to Slack goes through
 * the client built on the token the settings hold at that moment.
 */
export function slackPoster(fetchImpl: SlackFetch, now: () => number = Date.now) {
  let forToken = "";
  let channels: { at: number; byName: Map<string, Channel> } | null = null;
  let users: { at: number; byHandle: Map<string, string> } | null = null;
  const reset = (token: string) => {
    if (token === forToken) return;
    forToken = token;
    channels = null;
    users = null;
  };

  /** The channel's ID and the name the page says ("#name"). */
  async function channel(token: string, setting: string): Promise<{ id: string; name: string }> {
    reset(token);
    const ref = channelRef(setting);
    if (!ref) throw new SlackError("no_channel", "Set reviewChannel (a channel name, its ID, or a link to it) to post.");
    const shown = channelOf(setting)?.name ?? "the review channel";
    if ("id" in ref) return { id: ref.id, name: shown };
    if (!channels || now() - channels.at > CACHE_MS || !channels.byName.has(ref.name)) {
      const c = slackClient(token, fetchImpl);
      let all: Channel[];
      try {
        all = await c.list<Channel>("conversations.list", { types: "public_channel,private_channel", exclude_archived: "true", limit: "1000" }, "channels");
      } catch (e) {
        // a token without groups:read still finds a public channel
        if (!(e instanceof SlackError && e.code === "missing_scope")) throw e;
        all = await c.list<Channel>("conversations.list", { types: "public_channel", exclude_archived: "true", limit: "1000" }, "channels");
      }
      channels = { at: now(), byName: new Map(all.filter((x) => x.name).map((x) => [x.name!.toLowerCase(), x])) };
    }
    const hit = channels.byName.get(ref.name);
    if (!hit) throw new SlackError("channel_not_found", slackWords("channel_not_found", { channel: `#${ref.name}` }));
    return { id: hit.id, name: `#${hit.name}` };
  }

  /**
   * Each @handle's user ID, by Slack username, else by a display name only one person has (any case); null otherwise
   * (no one, two people, or past the 4,000 users one look reads). When the token can't
   * list users (no users:read), every handle is null and `note` says why: the post then names them in plain words.
   */
  async function mentions(token: string, handles: string[]): Promise<{ ids: Record<string, string | null>; note: string | null }> {
    reset(token);
    const want = [...new Set(handles.map((h) => h.toLowerCase()))];
    if (want.length === 0) return { ids: {}, note: null };
    let note: string | null = null;
    // listed again after six hours, or after five minutes when a handle is new (someone may have just joined)
    if (!users || now() - users.at > CACHE_MS || (want.some((h) => !users!.byHandle.has(h)) && now() - users.at > 5 * 60_000)) {
      try {
        const all = await slackClient(token, fetchImpl).list<User>("users.list", { limit: "200" }, "members");
        // a username is unique: it wins; a display name counts only when exactly one person has it (no guessing)
        const live = all.filter((u) => !u.deleted && !u.is_bot);
        const byHandle = new Map<string, string>();
        const shown = new Map<string, Set<string>>();
        for (const u of live)
          for (const n of [u.profile?.display_name_normalized, u.profile?.display_name]) {
            const k = n?.trim().toLowerCase();
            if (k) shown.set(k, (shown.get(k) ?? new Set()).add(u.id));
          }
        for (const [k, ids] of shown) if (ids.size === 1) byHandle.set(k, [...ids][0]!);
        for (const u of live) if (u.name?.trim()) byHandle.set(u.name.trim().toLowerCase(), u.id);
        users = { at: now(), byHandle };
      } catch (e) {
        if (!(e instanceof SlackError) || e.maybe) throw e;
        note = `@names stay plain words: ${e.message}`;
      }
    }
    return { ids: Object.fromEntries(want.map((h) => [h, users?.byHandle.get(h) ?? null])), note };
  }

  /** chat.postMessage, then its permalink (null if Slack won't say: the post itself went through). */
  async function post(token: string, ch: { id: string; name: string }, text: string): Promise<{ permalink: string | null; ts: string }> {
    reset(token);
    const c = slackClient(token, fetchImpl);
    const j = await c.call("chat.postMessage", { channel: ch.id, text, unfurl_links: false, unfurl_media: false }, { post: true, channel: ch.name });
    const ts = String(j.ts ?? "");
    const at = String(j.channel ?? ch.id);
    const link = await c.call("chat.getPermalink", { channel: at, message_ts: ts }, { channel: ch.name }).catch(() => null);
    return { permalink: typeof link?.permalink === "string" ? link.permalink : null, ts };
  }

  return { channel, mentions, post };
}
