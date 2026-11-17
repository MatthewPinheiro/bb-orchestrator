// Starting a lead, the CoS or the Steward from the app (the Start buttons): the pure parts. Which repo a project's
// threads work in (PROJECT.md's "## Repos"), and the brief templates in briefs/ with their {placeholders}.
// startLead is the one Start lead path, for the owner's button and the CoS's orch_start_lead.
// No bb or zod import, so node --test checks it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EngineError } from "./model.ts";
import { SLUG as SLUG_RE } from "./memory.ts";

export type Repo = { path: string; base: string | null };

/**
 * The repos PROJECT.md names under "## Repos", in order: each line's first backticked absolute path, and the branch
 * in its "base `<branch>`" when it has one. The section ends at the next "## " heading. Backticked words that aren't
 * absolute paths (`dev`, `origin/main`) are not repos.
 */
export function parseRepos(projectMd: string): Repo[] {
  const out: Repo[] = [];
  let inside = false;
  for (const line of projectMd.split(/\r?\n/)) {
    if (/^##\s/.test(line)) {
      inside = /^##\s+Repos\s*(?:\(.*\))?\s*$/i.test(line); // "## Repos" or "## Repos (…)", not "## Repos history"
      continue;
    }
    if (!inside) continue;
    const path = /`(\/[^`\s]*)`/.exec(line)?.[1];
    if (!path) continue;
    const base = /\bbase\s+`([^`\s]+)`/i.exec(line)?.[1] ?? null;
    out.push({ path: path.length > 1 ? path.replace(/\/+$/, "") : path, base });
  }
  return out;
}

/** The project's primary repo: the first one under "## Repos", or null when it names none. */
export function primaryRepo(projectMd: string): Repo | null {
  return parseRepos(projectMd)[0] ?? null;
}

/** The editable briefs: briefs/<name>.md beside server.ts. */
export const BRIEFS = ["lead", "cos", "steward"] as const;
export type BriefName = (typeof BRIEFS)[number];

/**
 * Fill a brief's {placeholders} (lowercase letters, digits and _) in one pass, so a value is never read as a
 * placeholder. An unknown placeholder throws: a literal {mon} must never reach an agent.
 */
export function fillBrief(template: string, vars: Readonly<Record<string, string>>): string {
  const missing = new Set<string>();
  const out = template.replace(/\{([a-z][a-z0-9_]*)\}/g, (whole, key: string) => {
    if (Object.hasOwn(vars, key)) return vars[key]!;
    missing.add(key);
    return whole;
  });
  if (missing.size) throw new Error(`the brief has unknown placeholders: ${[...missing].map((k) => `{${k}}`).join(", ")}`);
  return out;
}

/** briefs/<name>.md from `dir`, filled. Read on each start, so an edit takes effect without a reload. */
export function loadBrief(dir: string, name: BriefName, vars: Readonly<Record<string, string>>): string {
  const file = join(dir, `${name}.md`);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`no brief at ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return fillBrief(text, vars).trim();
}

/** The variables each brief may use; the server passes exactly these. */
export const BRIEF_VARS: Record<BriefName, readonly string[]> = {
  lead: ["slug", "address", "pokemon", "folder", "repo", "base", "owner"],
  cos: ["pokemon", "folder", "owner"],
  steward: ["pokemon", "folder", "owner"],
};

/**
 * The brief's {pokemon}: a sentence naming the agent's Pokémon, followed by a space, or nothing when it has none
 * (the pokemon setting is off: Engine.monForStart gives null).
 */
export const pokemonSentence = (mon: string | null): string => (mon ? `Your Pokémon is ${mon}. ` : "");

/** Path equality for a bb project source: trailing slashes don't count. */
export const samePath = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** Who pressed Start: the owner from the app, or the CoS with orch_start_lead. Recorded on the spawn and the notice. */
export type StartedBy = "person" | "cos";

/** What startLead needs from the server: the engine's checks, the folders, bb's project lookup and the spawn. */
export type LeadStartPorts = {
  engine: { checkStart(role: "lead", project: string): string; monForStart(role: "lead", project: string): string | null; project(slug: string): { mode: "scoping" | "active" } | null };
  /** The projects folder (the projectsDir setting). */
  projectsDir: string;
  /** A project folder the memory config names for this slug, if any. */
  memoryFolder(slug: string): string | undefined;
  /** The memory engine's state, for the "no project folder" refusal. */
  memoryState: string;
  briefDir: string;
  owner: string;
  /** The bb project whose folder is the repo (created when missing). */
  bbProject(repoPath: string): Promise<{ projectId: string; hostId: string }>;
  /** Spawn and register the lead; the caller binds who started it. */
  spawn(p: { slug: string; address: string; projectId: string; hostId: string; folder: string; prompt: string }): Promise<{ threadId: string; address: string; mon: string | null }>;
};

/**
 * What a lead of a scoping project is told at its start (1.11.0), after its brief: the brief is the same for every lead,
 * this is the one difference. Its live inbox says the same while the project stays scoping.
 */
export function scopingStart(slug: string, owner: string, folder: string): string {
  return [
    `## ${slug} is in scoping mode`,
    `${owner} settles this project's scope with you directly, in the Scope tab: your chat with them and your cards side by side. Until scoping is done:`,
    `- Ask ${owner} with orch_ask (questions and plan cards): your cards and deliverables reach ${owner}'s Scope pane only. The CoS gets a read-only copy, does not triage them, and no standing rule settles them. ${owner}'s chat messages are direct messages: answer each with orch_ack(id, outcome, note), as always.`,
    `- Start no build threads. Read-only investigation is fine.`,
    `- Write what you settle (the goal, the constraints, the first plan) into ${folder}/PROJECT.md.`,
    `- When it is all there, propose the end: orch_ask with scoping_done={summary, project_md: "${folder}/PROJECT.md"}, a summary of the goal, constraints and first plan. The options are fixed: ${owner}'s yes makes the project active (the normal card flow from then on); a no comes back to you with their note.`,
  ].join("\n");
}

/**
 * What a scoping thread is told at its start (1.12.0), after the lead's brief: the thread orch_spawn_thread started with
 * scope_task. Its questions and findings go to its lead as always; the lead takes them to the owner's Scope pane.
 */
export function scopingThreadStart(project: string, task: { id: string; name: string }, owner: string, lead: string): string {
  return [
    `## You are the scoping thread for ${project}'s task ${JSON.stringify(task.name)} (${task.id})`,
    `${owner} and ${lead} are scoping this part of ${project} before anything is built. Your job is read-only investigation: read code, docs and data, and change nothing (no commits, no PRs, no pushes).`,
    `- Ask ${lead} with orch_ask, and send it your findings with orch_send or orch_report. ${lead} takes your questions and findings to ${owner}'s Scope tab, under this task.`,
    `- Write your findings into one file and say where it is in your report: ${lead} proposes closing the task to ${owner} with it.`,
  ].join("\n");
}

/**
 * Start lead:<slug>: one path for the owner's Start lead button and the CoS's orch_start_lead. Refused, before any
 * spawn, when the slug is bad, the project is on hold, a lead is live, there is no project folder, its PROJECT.md names
 * no repo under "## Repos", or that repo isn't on this machine. The hold and live-lead checks run again just before the
 * spawn: the project may have been held meanwhile.
 */
export async function startLead(p: LeadStartPorts, slug: string) {
  const address = p.engine.checkStart("lead", slug);
  // the projects folder first; a memory project folder still serves a project that lives only there
  const own = join(p.projectsDir, slug);
  const folder = SLUG_RE.test(slug) && existsSync(join(own, "PROJECT.md")) ? own : p.memoryFolder(slug);
  if (!folder) throw new EngineError("not_found", `${slug} has no project folder: no ${slug}/PROJECT.md in ${p.projectsDir} or the memory config's project roots (memory: ${p.memoryState})`);
  const repo = primaryRepo(readFileSync(join(folder, "PROJECT.md"), "utf8"));
  if (!repo) throw new EngineError("bad_state", `${folder}/PROJECT.md names no repo: put its absolute path in backticks under "## Repos"`);
  if (!existsSync(repo.path)) throw new EngineError("bad_state", `${slug}'s repo ${repo.path} isn't on this machine`);
  const base = repo.base ?? "not named in PROJECT.md (leave base_branch out: the repo's default branch)";
  const brief = loadBrief(p.briefDir, "lead", { slug, address, pokemon: pokemonSentence(p.engine.monForStart("lead", slug)), folder, repo: repo.path, base, owner: p.owner });
  const prompt = p.engine.project(slug)?.mode === "scoping" ? `${brief.trimEnd()}\n\n${scopingStart(slug, p.owner, folder)}\n` : brief;
  const { projectId, hostId } = await p.bbProject(repo.path);
  p.engine.checkStart("lead", slug); // again: the project may have been held meanwhile
  return p.spawn({ slug, address, projectId, hostId, folder, prompt });
}
