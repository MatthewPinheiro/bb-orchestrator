// The migration list is append-only and its index is the version recorded in _migrations. A database only ever
// runs the indexes it hasn't recorded, so an entry that changes place is skipped on every database that already
// recorded that index: its table never appears and every query on it fails. These tests pin the order, and upgrade
// databases from each earlier shape to the current one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Engine } from "../core/engine.ts";
import { MIGRATIONS, migrate } from "../core/db.ts";

const ports = { now: () => 1_000_000, deliver: async () => ({ delivery: "sent" as const }), mirror: () => {}, changed: () => {}, log: () => {} };

/** A database as a version that knew only the first `n` migrations left it. */
function dbAt(n: number) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE _migrations (id INTEGER PRIMARY KEY)`);
  MIGRATIONS.slice(0, n).forEach((sql, i) => {
    db.exec(sql);
    db.prepare(`INSERT INTO _migrations (id) VALUES (?)`).run(i);
  });
  return db;
}

const columns = (db: DatabaseSync, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const tables = (db: DatabaseSync) => (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
const versions = (db: DatabaseSync) => (db.prepare(`SELECT id FROM _migrations ORDER BY id`).all() as { id: number }[]).map((r) => r.id);

test("21 is the Pokémon columns and 22 is external_mail: the two lines of the plugin share one numbering", () => {
  assert.equal(MIGRATIONS.length, 23);
  assert.match(MIGRATIONS[21]!, /ALTER TABLE projects ADD COLUMN mon_type TEXT;\s+ALTER TABLE agents ADD COLUMN mon_stage INTEGER;\s+ALTER TABLE agents ADD COLUMN mon_stage_level INTEGER$/);
  assert.match(MIGRATIONS[22]!, /^CREATE TABLE external_mail \(/);
});

test("a 1.6.1 database (versions 0-20) gets both 21 and 22, keeps its rows, and imports external mail", () => {
  const db = dbAt(21);
  db.prepare(`INSERT INTO agents (thread_id, address, role, project, status, created_at) VALUES ('c', 'cos', 'cos', NULL, 'idle', 1)`).run();
  assert.ok(!tables(db).includes("external_mail"));
  migrate(db);
  assert.deepEqual(versions(db), [...Array(23).keys()]);
  assert.ok(columns(db, "projects").includes("mon_type"));
  assert.ok(columns(db, "agents").includes("mon_stage") && columns(db, "agents").includes("mon_stage_level"));
  assert.ok(tables(db).includes("external_mail"));
  const e = new Engine(db as never, ports);
  assert.equal(e.agentByAddress("cos")?.threadId, "c", "the existing agent survives the upgrade");
  const it = e.importMail({ source: "fleet", id: "x", to: "cos", sender: "w", task: "t", severity: "ACTION", summary: "s", createdAt: 1 } as never);
  assert.equal(e.externalReceipts("fleet")[0]!.itemId, it.id);
});

test("a database that already has version 21 (the Pokémon columns) runs only 22, and doesn't add the columns twice", () => {
  const db = dbAt(22);
  migrate(db);
  assert.deepEqual(versions(db), [...Array(23).keys()]);
  assert.ok(tables(db).includes("external_mail"));
  migrate(db); // a second start is a no-op
  assert.deepEqual(versions(db), [...Array(23).keys()]);
});
