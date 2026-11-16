// Secret redaction for any CLI text that leaves the core (an error shown on the page or printed by the CLI, a log
// line). Identity strings (account ids, role ARNs, emails) are allowed and stay as they are; tokens and keys never do.
// Pure: the browser bundle may import it.

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // key = value / "key": "value" pairs whose key names a secret
  [/((?:aws_)?(?:secret_access_key|session_token|access_token|refresh_token|id_token|client_secret|secretaccesskey|sessiontoken|accesstoken|refreshtoken|password|private_key)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, (_m, k) => `${k}[redacted]`],
  // AWS access key ids
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted-key-id]"],
  // Google OAuth access and refresh tokens
  [/\bya29\.[\w.-]+/g, "[redacted-token]"],
  [/\b1\/\/[\w.-]{20,}/g, "[redacted-token]"],
  // JWTs
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[redacted-jwt]"],
  // Bearer headers
  [/(Bearer\s+)[\w.~+/=-]{8,}/gi, (_m, k) => `${k}[redacted]`],
  // any other long opaque run (session tokens, secret keys): 40+ base64-ish characters with no "/" path shape
  [/(?<![\w/.:-])[A-Za-z0-9+=]{40,}(?![\w/])/g, "[redacted]"],
];

const MAX = 2000;

/** Text with every token, key and secret it holds replaced; cut to MAX characters. */
export function redact(text: string): string {
  let out = String(text ?? "");
  if (out.length > MAX) out = `${out.slice(0, MAX)}…`;
  for (const [re, to] of RULES) out = out.replace(re, to as never);
  return out;
}

/** The first non-empty line of a CLI's output, redacted: what an error message carries. */
export const firstLine = (s: string) => redact(String(s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "");
