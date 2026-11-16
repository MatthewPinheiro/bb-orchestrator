// The Orchestrator's Game Boy tab, the server part (it was its own plugin until 2026-11-13): the /gameboy/play page, the
// user's uploaded ROM and its save backups, as files under the orchestrator's data directory:
//   gameboy/rom/<sha256>.gba + rom/current.json   the one ROM (never under its uploaded name)
//   gameboy/saves/<sha256>.sav + .json            the latest save backup for that ROM; .prev.sav is the one before it
// Writes (POST) need bb's page as Origin, like the orchestrator's: bb's "local" auth lets a request without an Origin
// through, and this refuses it. Bodies are JSON with base64 data, because "local" auth wants application/json.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ROM_MAX_BYTES, SAVE_MAX_BYTES, SHA256, bodyTooLarge, checkRomUpload, checkSaveUpload, writeOriginProblem } from "./core/rom.ts";
import { playHtml } from "./core/page.ts";

type RomInfo = { name: string; size: number; sha256: string; uploadedAt: number };
type SaveInfo = { size: number; updatedAt: number };

/** The tab's routes. `dir` is where its ROM and saves live (the orchestrator's data directory + /gameboy). */
export function registerGameboy(bb: BbPluginApi, dir: string) {
  const romDir = join(dir, "rom");
  const saveDir = join(dir, "saves");
  mkdirSync(romDir, { recursive: true, mode: 0o700 });
  mkdirSync(saveDir, { recursive: true, mode: 0o700 });

  const atomic = (file: string, data: string | Buffer) => {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, file);
  };
  const readJson = <T>(file: string): T | null => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch {
      return null;
    }
  };
  const currentRom = () => readJson<RomInfo>(join(romDir, "current.json"));
  const saveInfo = (sha: string) => readJson<SaveInfo>(join(saveDir, `${sha}.json`));

  const appUrls = (): string[] => {
    const urls: (string | null)[] = [];
    try {
      urls.push(bb.server.experimental_appUrl);
      urls.push(bb.server.loopbackBaseUrl);
    } catch {
      // not bound yet: the request's own host still counts
    }
    return urls.filter((u): u is string => !!u);
  };
  type Ctx = Parameters<Parameters<typeof bb.http.route>[2]>[0];
  const fail = (c: Ctx, status: number, message: string) => c.json({ ok: false, error: { message } }, status as 400);
  /** The JSON body of a write from bb's page, or a Response refusing it. */
  const writeBody = async (c: Ctx, maxBytes: number): Promise<unknown> => {
    const why = writeOriginProblem({ origin: c.req.header("origin"), secFetchSite: c.req.header("sec-fetch-site"), requestUrl: c.req.url, appUrls: appUrls() });
    if (why) return fail(c, 403, `uploads come only from bb's page (${why})`);
    if (bodyTooLarge(c.req.header("content-length"), maxBytes)) return fail(c, 413, `larger than ${maxBytes} bytes`);
    try {
      return await c.req.json();
    } catch {
      return fail(c, 400, "body is not JSON");
    }
  };

  bb.http.route("GET", "/gameboy/play", (c) =>
    c.body(playHtml(), 200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" }),
  );

  bb.http.route("GET", "/gameboy/rom/info", (c) => {
    const rom = currentRom();
    c.header("cache-control", "no-store");
    return c.json({ rom, save: rom ? saveInfo(rom.sha256) : null });
  });

  bb.http.route("GET", "/gameboy/rom.gba", (c) => {
    const rom = currentRom();
    if (!rom) return fail(c, 404, "no ROM uploaded");
    const etag = `"${rom.sha256}"`;
    const headers = { etag, "cache-control": "private, no-cache", "x-content-type-options": "nosniff" };
    if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers });
    const bytes = readFileSync(join(romDir, `${rom.sha256}.gba`));
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-type": "application/octet-stream" } });
  });

  bb.http.route("POST", "/gameboy/rom", async (c) => {
    const body = await writeBody(c, ROM_MAX_BYTES);
    if (body instanceof Response) return body;
    const r = checkRomUpload(body);
    if (!r.ok) return fail(c, r.status, r.message);
    const sha256 = createHash("sha256").update(r.bytes).digest("hex");
    const old = currentRom();
    atomic(join(romDir, `${sha256}.gba`), r.bytes);
    const info: RomInfo = { name: String((body as { name: string }).name).trim().slice(0, 200), size: r.bytes.length, sha256, uploadedAt: Date.now() };
    atomic(join(romDir, "current.json"), JSON.stringify(info));
    if (old && old.sha256 !== sha256) rmSync(join(romDir, `${old.sha256}.gba`), { force: true }); // its saves stay
    bb.log.info(`ROM uploaded: ${info.size} bytes, sha256 ${sha256.slice(0, 12)}`);
    return c.json({ ok: true, result: info });
  });

  bb.http.route("GET", "/gameboy/save", (c) => {
    const sha = String(c.req.query("rom") ?? "");
    const info = SHA256.test(sha) ? saveInfo(sha) : null;
    const file = join(saveDir, `${sha}.sav`);
    if (!info || !existsSync(file)) return fail(c, 404, "no save for this ROM");
    return new Response(new Uint8Array(readFileSync(file)), {
      headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-updated-at": String(info.updatedAt) },
    });
  });

  bb.http.route("POST", "/gameboy/save", async (c) => {
    const body = await writeBody(c, SAVE_MAX_BYTES);
    if (body instanceof Response) return body;
    const r = checkSaveUpload(body);
    if (!r.ok) return fail(c, r.status, r.message);
    const file = join(saveDir, `${r.rom}.sav`);
    if (existsSync(file)) copyFileSync(file, join(saveDir, `${r.rom}.prev.sav`)); // one step back, if a device pushes a bad save
    atomic(file, r.bytes);
    const info: SaveInfo = { size: r.bytes.length, updatedAt: Date.now() };
    atomic(join(saveDir, `${r.rom}.json`), JSON.stringify(info));
    return c.json({ ok: true, result: info });
  });
}
