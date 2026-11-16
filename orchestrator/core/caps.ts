// Hard size caps on what reaches the owner (2026-11-16, "way less text"; the 1.1.0 format alone shrank card questions
// 27% but left whole cards at ~920 characters and deliverables at ~2.5 KB). Enforced on the server, never in a tool
// schema: an agent started earlier keeps its old schema, so the refusal text is the only place it learns the limit.
// Blocks have caps of their own and don't count toward a card's context: long how-to content belongs in them.

/** A card's question, option details and context, for orch_ask and the CoS's ask_person. Plans carry a thread list. */
export const CARD_CAPS = { question: 160, detail: 120, context: 600, planContext: 1600 } as const;
/** A deliverable's visible top: its summary, points and blocks' text together (the captions have their own cap). */
export const DELIVER_BUDGET = 1500;

const MOVE = "move detail into blocks (steps, command, list, facts) or a doc";

/** The first field over its cap, named with its limit and its length, or null when the card fits. */
export function cardRefusal(p: { question: string; context?: string | null; options: readonly { detail?: string | null }[]; kind?: "question" | "plan" }): string | null {
  const q = p.question.trim().length;
  if (q > CARD_CAPS.question) return `question is ${q} characters; the cap is ${CARD_CAPS.question}. Ask the one decision in plain words and ${MOVE}`;
  for (const [i, o] of p.options.entries()) {
    const n = (o.detail ?? "").trim().length;
    if (n > CARD_CAPS.detail) return `option ${i + 1}'s detail is ${n} characters; the cap is ${CARD_CAPS.detail}. Say what the option does in one line and ${MOVE}`;
  }
  const cap = p.kind === "plan" ? CARD_CAPS.planContext : CARD_CAPS.context;
  const c = (p.context ?? "").trim().length;
  if (c > cap) return `context is ${c} characters; the cap is ${cap}${p.kind === "plan" ? " for a plan" : ""}. Keep only why it matters and ${MOVE}`;
  return null;
}

/** Keys whose strings are never drawn as text (enums, ids, links, flags). */
const NOT_TEXT = new Set(["kind", "url", "tone", "status", "level", "change", "id", "direction", "from", "to", "ok", "language", "selectable", "paste", "expires_at"]);
/** The characters a block (or any part of a deliverable) draws as text. */
export function visibleText(v: unknown): number {
  if (typeof v === "string") return v.trim().length;
  if (Array.isArray(v)) return v.reduce((s: number, x) => s + visibleText(x), 0);
  if (v && typeof v === "object") return Object.entries(v).reduce((s, [k, x]) => s + (NOT_TEXT.has(k) ? 0 : visibleText(x)), 0);
  return 0;
}

/**
 * A deliverable whose summary, points and blocks together run over the budget, with or without points (an old-schema
 * lead sends none). The refusal says how big each part is, so the lead knows what to cut.
 */
export function deliverBudgetRefusal(p: { summary: string; points?: readonly unknown[] | null; blocks?: unknown }): string | null {
  const parts = { summary: visibleText(p.summary), points: visibleText(p.points ?? []), blocks: visibleText(p.blocks ?? []) };
  const total = parts.summary + parts.points + parts.blocks;
  if (total <= DELIVER_BUDGET) return null;
  const biggest = (Object.entries(parts) as [keyof typeof parts, number][]).sort((a, b) => b[1] - a[1])[0]![0];
  return (
    `the deliverable's visible text is ${total} characters (summary ${parts.summary}, points ${parts.points}, blocks ${parts.blocks}); the budget is ${DELIVER_BUDGET}. ` +
    `Cut ${total - DELIVER_BUDGET}, starting with the ${biggest}: keep the decisions and findings, and put the rest in a text or doc proof`
  );
}
