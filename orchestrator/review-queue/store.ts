// The review queue's durable state (2026-11-18): one JSON row, and a run lease that outlives a plugin generation, so a
// reload mid-run can't start a second run beside the first. The tables are MIGRATIONS' (core/db.ts); the engine runs
// them before the queue is registered.
import type { Db } from "../core/db.ts";
import { initialState, stateSchema, type QueueState } from "../core/review-queue.ts";

/** A run holds the lease at most this long; an interrupted run's lease lapses then. */
export const LEASE_MS = 10 * 60_000;

export class QueueStore {
  private db: Db;
  constructor(db: Db) {
    this.db = db;
    db.prepare("INSERT OR IGNORE INTO review_queue_state (id, json) VALUES (1, ?)").run(JSON.stringify(initialState()));
  }
  get(): QueueState {
    const row = this.db.prepare("SELECT json FROM review_queue_state WHERE id = 1").get() as { json: string };
    return stateSchema.parse(JSON.parse(row.json));
  }
  /** One change, in one transaction; a change that breaks the schema throws and writes nothing. */
  mutate(fn: (s: QueueState) => void): QueueState {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const s = this.get();
      fn(s);
      stateSchema.parse(s);
      this.db.prepare("UPDATE review_queue_state SET json = ? WHERE id = 1").run(JSON.stringify(s));
      this.db.exec("COMMIT");
      return s;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  /** Take the lease when it is free or lapsed. */
  claim(token: string, now: number): boolean {
    this.db
      .prepare("INSERT INTO review_queue_lease (id, token, expires) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token, expires = excluded.expires WHERE review_queue_lease.expires <= ?")
      .run(token, now + LEASE_MS, now);
    return this.owns(token, now);
  }
  owns(token: string, now: number): boolean {
    const r = this.db.prepare("SELECT token, expires FROM review_queue_lease WHERE id = 1").get() as { token: string; expires: number } | undefined;
    return r?.token === token && r.expires > now;
  }
  release(token: string): void {
    this.db.prepare("DELETE FROM review_queue_lease WHERE token = ?").run(token);
  }
}
