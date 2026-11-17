// What the Cloud tab says when it has nothing to show: why, and what to set up. The tab is always listed (2026-11-16):
// it used to vanish without a config, so a new install had no Cloud tab and no reason.

export type CloudAvailability = { state: "ok" | "invalid" | "missing" | "no-machine" | "error"; path: string | null };

export function cloudEmptyState(a: CloudAvailability): { title: string; text: string } {
  if (a.state === "no-machine") return { title: "No connected machine", text: "The Cloud tab reads its config on a connected machine, and none is connected." };
  if (a.state === "error") return { title: "Couldn't check this machine", text: "The machine didn't answer when asked for its cloud config. Check again in a moment." };
  return {
    title: "No cloud config on this machine",
    text:
      `The Cloud tab shows and swaps your AWS profiles and gcloud configurations once ${a.path ?? "its config file"} exists on this machine. ` +
      "Copy orchestrator/cloud/config.example.json there and list your accounts and projects, or point the orchestrator's Cloud tab config file setting at your own file. " +
      "The machine also needs the aws CLI v2 or gcloud. See orchestrator/cloud/README.md.",
  };
}
