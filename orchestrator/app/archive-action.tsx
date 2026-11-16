// Requested 2026-11-13: "release projects to the wild from their leads", meaning archive a finished project. A thread
// action on lead rows, beside bb's own Archive: right-click (or the row's menu) → Archive project → confirm. The same
// write as the Projects tab's Archive…: the lead and its threads are archived and their open cards withdrawn.
import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { WRITES, rpcContract, type Agents, type archiveProjectBody } from "../contract.ts";
import { write } from "./store.ts";

type Data = { leads: ReadonlyMap<string, Agents[number]>; threads: ReadonlyMap<string, number>; refetch: () => void };

export const ARCHIVE_PROJECT_ICON = "orchestrator-archive-project";

/** A box with a lid, for the menu row. */
export function ArchiveProjectIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="2" y="3" width="12" height="3" rx="1" />
      <path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
      <path d="M6.5 9h3" />
    </svg>
  );
}

export const archiveProjectAction: PluginThreadActionRegistration<Data> = {
  id: "archive-project",
  title: "Archive project",
  icon: ARCHIVE_PROJECT_ICON,
  group: "4_lifecycle",
  order: 0,
  // the same agents query as the priority action and the metadata line (one cached query)
  useData() {
    const q = experimental_useRpcQuery({ contract: rpcContract, method: "agents", input: null });
    const all = q.data ?? [];
    const leads = new Map(all.filter((a) => a.role === "lead" && a.project).map((a) => [a.threadId, a]));
    const threads = new Map<string, number>();
    for (const a of all) if (a.role === "thread" && a.project) threads.set(a.project, (threads.get(a.project) ?? 0) + 1);
    return { leads, threads, refetch: () => void q.refetch() };
  },
  item({ thread, data }) {
    const lead = data?.leads.get(thread.id);
    if (!lead?.project) return null;
    const slug = lead.project;
    const n = data.threads.get(slug) ?? 0;
    return {
      label: "Archive project…",
      icon: ARCHIVE_PROJECT_ICON,
      variant: "destructive",
      choices: {
        heading: `Archive ${slug}? Its lead and ${n} ${n === 1 ? "thread" : "threads"} are archived; branches, deliverables and outputs stay.`,
        items: [
          { id: "archive", label: `Archive ${slug}`, selected: false },
          { id: "cancel", label: "Cancel", selected: false },
        ],
      },
      async run({ value }) {
        if (value !== "archive") return;
        const body: z.input<typeof archiveProjectBody> = { slug };
        await write(WRITES.archiveProject, body, { kind: "other", where: "projects", after: data.refetch });
      },
    };
  },
};
