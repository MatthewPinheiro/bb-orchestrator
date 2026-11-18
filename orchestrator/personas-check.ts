// Check a personas pack without installing it: node orchestrator/personas-check.ts /absolute/path/pack.json
// Prints what the pack holds, or every problem with where it is, and exits 1 on a problem. It reads only the pack.
import { PackError, readPersonaPack } from "./personas.ts";
import { TYPES } from "./mons.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: node personas-check.ts /absolute/path/pack.json");
  process.exit(2);
}
try {
  const p = readPersonaPack(path);
  const teams = Object.values(p.personas).flatMap((x) => x.team ?? []);
  const types = TYPES.filter((t) => p.byType?.[t.type]?.length).map((t) => t.type);
  console.log(
    [
      `ok: ${Object.keys(p.personas).length} personas, ${Object.keys(p.lines ?? {}).length} pack lines`,
      `roles: cos ${p.roles?.cos ?? "-"}, steward ${p.roles?.steward ?? "-"}; fallback ${p.fallback}`,
      `byType: ${types.length}/18 types${types.length < 18 ? ` (none for ${TYPES.filter((t) => !types.includes(t.type)).map((t) => t.type).join(", ")})` : ""}`,
      `byProject: ${Object.keys(p.byProject ?? {}).length} overrides`,
      `teams: ${teams.length} members, ${teams.filter((m) => typeof m !== "string").length} with a dex number`,
      `specialties: ${Object.values(p.personas).filter((x) => x.type).length} of ${Object.keys(p.personas).length} personas; fits: ${Object.values(p.personas).filter((x) => x.fits?.length).length} personas, ${Object.values(p.personas).reduce((n, x) => n + (x.fits?.length ?? 0), 0)} lines`,
    ].join("\n"),
  );
} catch (e) {
  if (e instanceof PackError) for (const x of e.problems) console.error(`problem: ${x}`);
  else console.error(`problem: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
