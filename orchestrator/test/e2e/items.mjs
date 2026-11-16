// Read-only dump of the orchestrator's items (mail) for evidence: ORCH_DB=<plugin data.db> node items.mjs [ref-or-recipient-filter]
import { DatabaseSync } from "node:sqlite";
if (!process.env.ORCH_DB) throw new Error("set ORCH_DB to the orchestrator plugin's data.db");
const db = new DatabaseSync(process.env.ORCH_DB, { readOnly: true });
const f = process.argv[2];
const rows = db.prepare(`SELECT id, kind, sender, recipient, ref, state, attempts, needs_ack, datetime(created_at/1000,'unixepoch') AS created, datetime(delivered_at/1000,'unixepoch') AS delivered, outcome, substr(body,1,140) AS body FROM items ORDER BY created_at`).all();
for (const r of rows) if (!f || JSON.stringify(r).includes(f)) console.log(JSON.stringify(r));
