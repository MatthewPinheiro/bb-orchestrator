// The upload rules guard the user's disk and the emulator: a GBA cartridge is at most 32 MiB, so anything bigger is not a
// ROM and must not fill the plugin's data folder; and only a .gba file is a ROM the mGBA core will boot, so a zip, a
// save or a random file must be refused at the server, not discovered as a black screen. The limits are written out
// here as literals on purpose: a change to the constant in core/rom.ts has to fail these tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyTooLarge, checkRomUpload, checkSaveUpload, writeOriginProblem } from "../core/rom.ts";

const MiB = 1024 * 1024;
const b64 = (n: number) => Buffer.alloc(n, 7).toString("base64");

test("a full-size 32 MiB cartridge is accepted, since the biggest real GBA ROMs are exactly that size", () => {
  const r = checkRomUpload({ name: "big.gba", data: b64(32 * MiB) });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.bytes.length, 32 * MiB);
});

test("one byte over 32 MiB is refused with 413, because no GBA cartridge is that large and the disk must stay bounded", () => {
  const r = checkRomUpload({ name: "big.gba", data: b64(32 * MiB + 1) });
  assert.deepEqual(r.ok ? null : r.status, 413);
});

test("a 16 MiB ROM fits, so a typical ROM is never refused for its size", () => {
  assert.equal(checkRomUpload({ name: "game-16MiB.gba", data: b64(16 * MiB) }).ok, true);
});

test("an upper-case .GBA extension is accepted, since dumps from other tools often use it", () => {
  assert.equal(checkRomUpload({ name: "EMERALD.GBA", data: b64(16) }).ok, true);
});

test("a zip, a save file or an extensionless file is refused, because the mGBA core only boots a bare .gba", () => {
  for (const name of ["emerald.gba.zip", "emerald.sav", "emerald", "emerald.gb", "gba"]) {
    const r = checkRomUpload({ name, data: b64(16) });
    assert.equal(r.ok, false, name);
    assert.equal(!r.ok && r.status, 400, name);
  }
});

test("an empty or non-base64 body is refused, so a broken upload never replaces a working ROM", () => {
  assert.equal(checkRomUpload({ name: "a.gba", data: "" }).ok, false);
  assert.equal(checkRomUpload({ name: "a.gba", data: "not base64!" }).ok, false);
  assert.equal(checkRomUpload({ name: "a.gba" }).ok, false);
});

test("an oversized body is refused from its Content-Length, before the server reads 40+ MB into memory", () => {
  const roomFor32MiB = Math.ceil((32 * MiB) / 3) * 4;
  assert.equal(bodyTooLarge(String(roomFor32MiB + 100), 32 * MiB), false); // a full-size ROM plus its JSON wrapper
  assert.equal(bodyTooLarge(String(64 * MiB), 32 * MiB), true);
  assert.equal(bodyTooLarge(undefined, 32 * MiB), false); // no header: the decoded-size check still applies
});

test("a save backup must name its ROM by sha256, so one game's save can never land on another game", () => {
  assert.equal(checkSaveUpload({ rom: "emerald", data: b64(128 * 1024) }).ok, false);
  const r = checkSaveUpload({ rom: "a".repeat(64), data: b64(128 * 1024) });
  assert.equal(r.ok, true); // 128 KiB, the largest GBA save (Flash 1M)
  assert.equal(checkSaveUpload({ rom: "a".repeat(64), data: b64(2 * MiB) }).ok, false);
});

test("a write without bb's page as Origin is refused, so a local process or another site can't swap the user's ROM", () => {
  const base = { requestUrl: "http://127.0.0.1:38886/api/v1/plugins/gameboy/http/rom", appUrls: [] };
  assert.equal(writeOriginProblem({ ...base, origin: "http://127.0.0.1:38886", secFetchSite: "same-origin" }), null);
  assert.notEqual(writeOriginProblem({ ...base, origin: undefined, secFetchSite: undefined }), null);
  assert.notEqual(writeOriginProblem({ ...base, origin: "https://evil.example", secFetchSite: "cross-site" }), null);
});
