// Read-only parsing of the AWS config file: its `[profile X]` sections and their keys. cloud-switch never writes this
// file: the active profile is the bb machine variable AWS_PROFILE (core/machineenv.ts), so a call that names no profile
// falls back to the default chain (the runner's instance role) whenever the switch is off.

export type Profile = { name: string; lines: string[]; keys: Record<string, string> };

const HEADER = /^\s*\[\s*([^\]]+?)\s*\]\s*$/;
const KV = /^([^\s=#;][^=]*?)\s*=\s*(.*?)\s*$/;

/** Every `[profile X]` section, in file order. `[default]` is not a target. */
export function profiles(text: string): Profile[] {
  const out: Profile[] = [];
  let cur: Profile | null = null;
  for (const line of text.split("\n")) {
    const h = HEADER.exec(line);
    if (h) {
      const m = /^profile\s+(.+)$/.exec(h[1]);
      cur = m && m[1] !== "default" ? { name: m[1], lines: [], keys: {} } : null;
      if (cur) out.push(cur);
      continue;
    }
    if (!cur || !line.trim() || /^\s*[#;]/.test(line)) continue;
    cur.lines.push(line.replace(/\s+$/, ""));
    const kv = /^\S/.test(line) ? KV.exec(line) : null;
    if (kv) cur.keys[kv[1].trim()] = kv[2];
  }
  return out;
}
