// "Since your last copy" baselines in plugin storage (kv), one key per GitHub login (2026-11-18). Writes run one at a
// time, so a copy of one section and a post of another can't erase each other's baseline. A write that fails, or that
// would pass the kv's size limit, keeps the baseline as it was.
import { saveCopy, type CopiedPr, type CopyHistory, type Section } from "../core/open-prs-copies.ts";
import { copyHistorySchema } from "./contract.ts";

interface Kv {
  get<T>(key: string): Promise<T | null | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}
export const copiesKey = (login: string) => `openPrs.copied.v1.${login.toLowerCase()}`;
/** Under the SDK's 256 KB value limit, with room. */
const MAX_BYTES = 240_000;

export function copyStore(kv: Kv, now: () => number = Date.now) {
  let queue: Promise<unknown> = Promise.resolve();
  /** The login's baselines; anything stored that doesn't parse is no baseline. */
  const read = async (login: string): Promise<CopyHistory> => {
    const r = copyHistorySchema.safeParse((await kv.get<unknown>(copiesKey(login)).catch(() => null)) ?? {});
    return r.success ? r.data : {};
  };
  const remember = (login: string, section: Section, prs: CopiedPr[]): Promise<CopyHistory> => {
    const task = queue.then(async () => {
      const next = saveCopy(await read(login), section, prs, now());
      if (Buffer.byteLength(JSON.stringify(next), "utf8") > MAX_BYTES) throw new Error("Too many PRs to keep as the last copy.");
      await kv.set(copiesKey(login), next);
      return next;
    });
    queue = task.catch(() => {});
    return task;
  };
  return { read, remember };
}
