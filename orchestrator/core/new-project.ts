// A new project from the CoS's brief (orch_new_project): its folder in the projects folder, with PROJECT.md and the
// project record in the shape the existing projects use, and its row in the projects table. It never starts the lead:
// that is orch_start_lead, which runs the same checks as the owner's Start lead button. Everything is checked before
// anything is written, and the folder appears in one rename, so a refused or failed brief leaves nothing behind.
// No bb or zod import, so node --test checks it.
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import { EngineError, PRIORITIES, type Priority, PROJECT_RE } from "./model.ts";
import { SLUG } from "./memory.ts";
import { primaryRepo } from "./start.ts";

/** The brief as the tool hands it over: any field may be missing or mistyped, and is refused here with its name. */
export type ProjectBriefIn = {
  slug?: unknown;
  title?: unknown;
  repo?: unknown;
  repo_url?: unknown;
  base?: unknown;
  goal?: unknown;
  constraints?: unknown;
  priority?: unknown;
};

export type ProjectBrief = {
  slug: string;
  title: string;
  repo: string;
  repoUrl: string | null;
  base: string | null;
  goal: string;
  constraints: string[];
  priority: Priority;
};

export type NewProjectPorts = {
  engine: {
    project(slug: string): unknown;
    createProject(slug: string, priority: Priority, by: string, title: string, body: string): void;
  };
  /** The projects folder (the projectsDir setting). */
  root: string;
  /** The project record's file name (the projectRecord setting). */
  record: string;
  /** A project folder the memory config names for this slug, if any. */
  memoryFolder(slug: string): string | undefined;
  now: number;
  /** Who files it, on the board notice. */
  by: string;
};

const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/i;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const RECORD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

const bad = (message: string) => new EngineError("invalid", message);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const oneLine = (s: string) => !/[\r\n]/.test(s);

/** The brief, checked: every refusal names the field and what to give instead. Reads the disk only for the repo. */
export function checkBrief(b: ProjectBriefIn): ProjectBrief {
  const missing = (["slug", "title", "repo", "goal"] as const).filter((k) => !text(b[k]));
  if (missing.length) throw bad(`the brief needs ${missing.join(", ")}`);
  const slug = text(b.slug)!;
  if (!SLUG.test(slug) || !PROJECT_RE.test(slug)) throw bad(`slug ${slug}: lowercase letters, digits and -, starting with a letter or digit, at most 40 characters`);
  const title = text(b.title)!;
  if (!oneLine(title) || title.length > 80) throw bad("title: one line, at most 80 characters");

  const repo = text(b.repo)!;
  if (URL_RE.test(repo)) throw bad(`repo ${repo} is a URL: clone it first and pass the local path (the URL can go in repo_url). This tool never clones`);
  if (!isAbsolute(repo)) throw bad(`repo ${repo}: give the repo's absolute path on this machine`);
  if (/[`\s]/.test(repo)) throw bad(`repo ${repo}: a path with spaces or backticks can't go in PROJECT.md`);
  const path = repo.length > 1 ? repo.replace(/\/+$/, "") : repo;
  if (!existsSync(path)) throw new EngineError("not_found", `repo ${path} doesn't exist on this machine`);
  if (!statSync(path).isDirectory()) throw bad(`repo ${path} isn't a folder`);

  let repoUrl: string | null = null;
  if (b.repo_url !== undefined && b.repo_url !== null && b.repo_url !== "") {
    repoUrl = text(b.repo_url);
    if (!repoUrl || !URL_RE.test(repoUrl) || /[`\s]/.test(repoUrl)) throw bad("repo_url: the repo's remote URL (https://… or git@…), one word");
  }
  let base: string | null = null;
  if (b.base !== undefined && b.base !== null && b.base !== "") {
    base = text(b.base);
    if (!base || !BRANCH_RE.test(base)) throw bad("base: a branch name (letters, digits, . _ / -)");
  }

  const goal = text(b.goal)!;
  if (goal.length > 4000) throw bad("goal: at most 4000 characters");
  if (/^\s*#/m.test(goal)) throw bad("goal: no markdown headings (a line starting with #)");

  // a list, a JSON list in a string (a stale schema), or one limit per line
  let given: unknown = b.constraints;
  if (typeof given === "string" && /^\s*\[/.test(given)) {
    try {
      given = JSON.parse(given);
    } catch {
      throw bad("constraints: a list of one-line strings");
    }
  }
  const list = typeof given === "string" ? given.split(/\r?\n/) : given === undefined || given === null ? [] : given;
  if (!Array.isArray(list) || list.some((c) => typeof c !== "string" || !oneLine(c))) throw bad("constraints: a list of one-line strings");
  const constraints = (list as string[]).map((c) => c.trim().replace(/^[-*]\s+/, "")).filter(Boolean);
  if (constraints.length > 30 || constraints.some((c) => c.length > 500 || c.startsWith("#"))) throw bad("constraints: at most 30, each one line of at most 500 characters, no headings");

  const priority = (text(b.priority) ?? "normal") as Priority;
  if (!PRIORITIES.includes(priority)) throw bad(`priority is one of ${PRIORITIES.join(", ")}`);
  return { slug, title, repo: path, repoUrl, base, goal, constraints, priority };
}

/** PROJECT.md for a new project, in the headings the existing ones use. */
export function projectMd(b: ProjectBrief, day: string): string {
  const repoLine = `- \`${b.repo}\`${b.base ? `, base \`${b.base}\`` : ""}: the project's repo; threads branch from it.${b.repoUrl ? ` Remote: ${b.repoUrl}.` : ""}`;
  return [
    `# ${b.title} (${b.slug})`,
    "",
    "## Goal",
    b.goal,
    "",
    "## Repos",
    repoLine,
    "",
    ...(b.constraints.length ? ["## Limits", ...b.constraints.map((c) => `- ${c}`), ""] : []),
    "## Decisions",
    `- ${day}: created by the CoS with orch_new_project; priority ${b.priority}.`,
    "",
  ].join("\n");
}

/** The project record, in the shape the existing records have. */
export function projectRecordJson(b: ProjectBrief, folder: string, nowIso: string): string {
  const rec = { slug: b.slug, name: b.title, dir: folder, repo: { path: b.repo, base: b.base }, created_at: nowIso, archived_at: null, on_hold: null };
  return `${JSON.stringify(rec, null, 2)}\n`;
}

/**
 * Create the project: refused when the brief is incomplete or malformed, the repo isn't a folder on this machine, or
 * the slug is taken (its folder, a memory project folder, or a project row, archived ones included). Then the folder is
 * built beside the projects folder's entries under a temporary name and renamed into place, and the row is created
 * with its board notice.
 */
export function newProject(p: NewProjectPorts, raw: ProjectBriefIn): { slug: string; folder: string; files: string[]; priority: Priority } {
  const b = checkBrief(raw);
  if (!RECORD_RE.test(p.record)) throw new EngineError("bad_state", `the projectRecord setting ${p.record} isn't a .json file name`);
  const folder = join(p.root, b.slug);
  if (existsSync(folder)) throw new EngineError("conflict", `${folder} already exists`);
  const mem = p.memoryFolder(b.slug);
  if (mem) throw new EngineError("conflict", `${b.slug} is already a memory project (${mem})`);
  if (p.engine.project(b.slug)) throw new EngineError("conflict", `${b.slug} is already a project (archived ones keep their slug)`);

  const md = projectMd(b, new Date(p.now).toISOString().slice(0, 10));
  const parsed = primaryRepo(md);
  if (parsed?.path !== b.repo || parsed.base !== b.base) throw new EngineError("bad_state", "the PROJECT.md written from this brief wouldn't name its repo for Start lead; check the goal and constraints");

  mkdirSync(p.root, { recursive: true });
  const tmp = join(p.root, `.new-${b.slug}-${randomBytes(4).toString("hex")}`);
  mkdirSync(tmp);
  try {
    writeFileSync(join(tmp, "PROJECT.md"), md);
    writeFileSync(join(tmp, p.record), projectRecordJson(b, folder, new Date(p.now).toISOString()));
    for (const d of ["library", "memory", "scratch"]) mkdirSync(join(tmp, d));
    if (existsSync(folder)) throw new EngineError("conflict", `${folder} already exists`); // rename would take an empty one
    renameSync(tmp, folder);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  const files = [join(folder, "PROJECT.md"), join(folder, p.record)];
  p.engine.createProject(b.slug, b.priority, p.by, `${p.by} created project ${b.slug}`, `${b.title}. Repo ${b.repo}${b.base ? ` (base ${b.base})` : ""}, priority ${b.priority}. Folder ${folder}. No lead yet: orch_start_lead starts it.`);
  return { slug: b.slug, folder, files, priority: b.priority };
}
