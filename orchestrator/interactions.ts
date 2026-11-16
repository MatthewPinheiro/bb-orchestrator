// Native agent questions as Needs you cards (2026-11-13: "make sure questions show as cards in the needs you
// tab"). When an agent with an orchestrator role asks him through its own question tool (Claude Code's
// AskUserQuestion), bb holds it as a pending `user_question` interaction on that thread. The card draws its questions
// and options; his pick goes back through bb as the same `user_answer` the thread's own prompt would send.
import { EngineError } from "./core/model.ts";

export type Question = {
  id: string;
  prompt: string;
  shortLabel: string | null;
  allowFreeText: boolean;
  multiSelect: boolean;
  required: boolean;
  options: { label: string; value: string; description: string | null }[];
};
export type Answers = Record<string, { selected: string[]; freeText?: string }>;

type RawQuestion = { id: string; prompt: string; shortLabel?: string; allowFreeText?: boolean; multiSelect?: boolean; required?: boolean; options?: { label: string; value: string; description?: string }[] };

/** bb's payload questions in the shape the card reads (absent fields made explicit). */
export function toQuestions(raw: unknown): Question[] {
  const qs = (raw as { questions?: RawQuestion[] } | null)?.questions;
  if (!Array.isArray(qs)) return [];
  return qs.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    shortLabel: q.shortLabel ?? null,
    allowFreeText: q.allowFreeText ?? false,
    multiSelect: q.multiSelect ?? false,
    required: q.required ?? true,
    options: (q.options ?? []).map((o) => ({ label: o.label, value: o.value, description: o.description ?? null })),
  }));
}

/**
 * His answers checked against the questions actually asked, so a stale or forged answer can't reach the agent as
 * something it never offered: only offered values, one of them unless multi-select, his own text only where the
 * question allows it, and every required question answered. Returns the answers trimmed to the asked questions.
 */
export function checkAnswers(questions: Question[], answers: Answers): Answers {
  const out: Answers = {};
  for (const id of Object.keys(answers)) {
    if (!questions.some((q) => q.id === id)) throw new EngineError("invalid", `No question "${id}" was asked`);
  }
  for (const q of questions) {
    const a = answers[q.id];
    const selected = [...new Set(a?.selected ?? [])];
    const freeText = a?.freeText?.trim() ? a.freeText.trim() : undefined;
    const offered = new Set(q.options.map((o) => o.value));
    const odd = selected.find((v) => !offered.has(v));
    if (odd !== undefined) throw new EngineError("invalid", `"${odd}" isn't one of the options for: ${q.shortLabel ?? q.prompt}`);
    if (!q.multiSelect && selected.length > 1) throw new EngineError("invalid", `Pick one option for: ${q.shortLabel ?? q.prompt}`);
    if (freeText !== undefined && !q.allowFreeText) throw new EngineError("invalid", `Your own answer isn't allowed for: ${q.shortLabel ?? q.prompt}`);
    if (selected.length === 0 && freeText === undefined) {
      if (q.required) throw new EngineError("invalid", `Answer: ${q.shortLabel ?? q.prompt}`);
      continue;
    }
    out[q.id] = freeText === undefined ? { selected } : { selected, freeText };
  }
  return out;
}
