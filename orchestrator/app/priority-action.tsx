// Requested 2026-11-13: "I need to be able to change priority on projects" from the sidebar, where each lead's row shows
// its project's priority. A thread action on lead rows: right-click (or the row's menu) → Priority → urgent, high,
// normal or low. The same write as the Projects tab's menu.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { WRITES, rpcContract, type Agents, type priorityBody } from "../contract.ts";
import { PRIORITIES, PRIORITY_TONES, type Priority } from "./palette.ts";
import { write } from "./store.ts";

type Data = { leads: ReadonlyMap<string, Agents[number]>; refetch: () => void };

export const PRIORITY_ICON = "orchestrator-priority";

/** A flag, for the menu row. */
export function PriorityIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M3.5 14V2.5" />
      <path d="M3.5 2.5h8l-1.5 3 1.5 3h-8" />
    </svg>
  );
}

export const priorityAction: PluginThreadActionRegistration<Data> = {
  id: "priority",
  title: "Project priority",
  icon: PRIORITY_ICON,
  group: "2_organize",
  order: 0,
  // the same agents read as the sidebar's metadata line (one cached query for both)
  useData() {
    const q = experimental_useRpcQuery({ contract: rpcContract, method: "agents", input: null });
    const leads = new Map((q.data ?? []).filter((a) => a.role === "lead" && a.project).map((a) => [a.threadId, a]));
    return { leads, refetch: () => void q.refetch() };
  },
  item({ thread, data }) {
    const lead = data?.leads.get(thread.id);
    if (!lead?.project) return null;
    const slug = lead.project;
    const current = (lead.priority && lead.priority in PRIORITY_TONES ? lead.priority : "normal") as Priority;
    return {
      label: "Priority",
      detail: PRIORITY_TONES[current].label,
      icon: PRIORITY_ICON,
      choices: {
        heading: `Priority of ${slug}`,
        items: PRIORITIES.map((p) => ({ id: p, label: p[0]!.toUpperCase() + p.slice(1), selected: p === current })),
      },
      async run({ value }) {
        if (!value || value === current || !(PRIORITIES as readonly string[]).includes(value)) return;
        const body: z.input<typeof priorityBody> = { slug, priority: value as Priority };
        await write(WRITES.priority, body, { kind: "other", where: "projects", after: data.refetch });
      },
    };
  },
};
