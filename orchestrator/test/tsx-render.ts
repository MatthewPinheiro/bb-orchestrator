// Rendering app components in node --test (2026-11-18). Node strips types but can't read JSX, so a .tsx is compiled with
// TypeScript's transpileModule into this process's own folder under test/.tsx-render (git-ignored; the test files run
// in parallel, each with its own), its relative imports pointed at the compiled .tsx or the original .ts. Under test/,
// because the tests that walk the plugin's sources skip it: compiled files made and deleted there during a run never
// race them. Only files that don't import the bb SDK can be loaded this way (app/face.tsx, app/mon.tsx, app/ui/*).
import ts from "typescript";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "test", ".tsx-render", String(process.pid));
const done = new Map<string, string>();

function emit(file: string): string {
  const known = done.get(file);
  if (known) return known;
  const out = join(OUT, relative(ROOT, file).replace(/\.tsx$/, ".mjs"));
  done.set(file, out);
  const js = ts
    .transpileModule(readFileSync(file, "utf8"), { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    .outputText.replace(/(from\s+|import\s*\(\s*|import\s+)(["'])(\.{1,2}\/[^"']+)\2/g, (_m, pre: string, q: string, spec: string) => {
      const abs = resolve(dirname(file), spec);
      return `${pre}${q}${pathToFileURL(abs.endsWith(".tsx") ? emit(abs) : abs).href}${q}`;
    });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, js);
  return out;
}

/** Import a .tsx under the plugin (a path relative to it, e.g. "app/face.tsx"). */
export async function importTsx<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(emit(join(ROOT, path))).href)) as T;
}

/** The compiled files go when the test file is done. */
export const cleanTsx = () => rmSync(OUT, { recursive: true, force: true });
