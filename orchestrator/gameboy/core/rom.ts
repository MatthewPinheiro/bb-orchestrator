// The server's checks, kept pure so node:test can drive them: what a ROM or save upload must be, and whether a write
// comes from bb's own page.

/** A GBA cartridge is at most 32 MiB; a 16 MiB ROM is typical. */
export const ROM_MAX_BYTES = 32 * 1024 * 1024;
/** A GBA save is at most 128 KiB (Flash 1M); mGBA may append a few bytes of RTC data. */
export const SAVE_MAX_BYTES = 256 * 1024;

export type Checked = { ok: true; bytes: Buffer } | { ok: false; status: number; message: string };

/** The longest base64 text that can decode to `max` bytes. */
export const base64Max = (max: number) => Math.ceil(max / 3) * 4;

/** The upload body before JSON parsing: refuse an oversized body before reading it all into a string. */
export function bodyTooLarge(contentLength: string | undefined, maxBytes: number): boolean {
  if (contentLength === undefined) return false;
  const n = Number(contentLength);
  // JSON wrapper (field names, file name) on top of the base64 text
  return Number.isFinite(n) && n > base64Max(maxBytes) + 4096;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decode(data: unknown, max: number, what: string): Checked {
  if (typeof data !== "string" || data.length === 0) return { ok: false, status: 400, message: `${what}: no data` };
  // checked on the text first, so an oversized upload is refused without decoding it
  if (data.length > base64Max(max)) return { ok: false, status: 413, message: `${what}: larger than ${max} bytes` };
  if (data.length % 4 !== 0 || !BASE64.test(data)) return { ok: false, status: 400, message: `${what}: data is not base64` };
  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0) return { ok: false, status: 400, message: `${what}: empty` };
  if (bytes.length > max) return { ok: false, status: 413, message: `${what}: larger than ${max} bytes` };
  return { ok: true, bytes };
}

/** A ROM upload: `{ name, data }`, name ending in .gba (any case), data base64 of at most ROM_MAX_BYTES. */
export function checkRomUpload(body: unknown): Checked {
  const b = (body ?? {}) as { name?: unknown; data?: unknown };
  if (typeof b.name !== "string" || !/\.gba$/i.test(b.name.trim())) return { ok: false, status: 400, message: "only a .gba file is accepted" };
  return decode(b.data, ROM_MAX_BYTES, "ROM");
}

/** A save backup: `{ rom, data }`, rom the sha256 of the ROM it belongs to. */
export function checkSaveUpload(body: unknown): Checked & { rom?: string } {
  const b = (body ?? {}) as { rom?: unknown; data?: unknown };
  if (typeof b.rom !== "string" || !SHA256.test(b.rom)) return { ok: false, status: 400, message: "save: rom must be the ROM's sha256" };
  const r = decode(b.data, SAVE_MAX_BYTES, "save");
  return r.ok ? { ...r, rom: b.rom } : r;
}

export const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Why a write isn't from the app's own page, or null. Same rule as the orchestrator's writes: the Origin must be the
 * request's own host or one of bb's app URLs, and a browser's Sec-Fetch-Site, when sent, must say same-origin.
 */
export function writeOriginProblem(h: { origin: string | undefined; secFetchSite: string | undefined; requestUrl: string; appUrls: string[] }): string | null {
  if (!h.origin) return "no Origin";
  let host: string;
  try {
    host = new URL(h.origin).host;
  } catch {
    return `bad Origin ${h.origin}`;
  }
  const ok = [h.requestUrl, ...h.appUrls].some((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
  if (!ok) return `Origin ${h.origin} isn't this app`;
  if (h.secFetchSite !== undefined && h.secFetchSite !== "same-origin") return `Sec-Fetch-Site ${h.secFetchSite}`;
  return null;
}
