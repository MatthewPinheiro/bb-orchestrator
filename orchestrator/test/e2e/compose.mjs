// Type one message into a thread's composer in the app and send it; screenshot before and after.
//   node compose.mjs <bb base URL> <projectId> <threadId> <messageFile> <outPng> [--live]
// The base is required (2026-11-18), and the live app (127.0.0.1:38886) is refused unless --live is given too
// (live-guard.ts): this script really sends.
import { readFileSync } from "node:fs";
import { checkBase } from "./live-guard.ts";
const argv = process.argv.slice(2);
const live = argv.includes("--live");
const [given, projectId, threadId, file, outPng] = argv.filter((a) => a !== "--live");
const base = checkBase(given, live);
if (!projectId || !threadId || !file || !outPng) throw new Error("usage: compose.mjs <base> <projectId> <threadId> <messageFile> <outPng> [--live]");
// Playwright loads only after the base passed the guard
const { chromium } = await import("playwright-core");
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(`${base}/projects/${projectId}/threads/${threadId}`, { waitUntil: "load" });
const box = p.locator('[contenteditable="true"], textarea').last();
await box.waitFor({ timeout: 30000 }); await box.click();
await p.keyboard.insertText(readFileSync(file, "utf8").trim());
await p.screenshot({ path: outPng.replace(/\.png$/, "-typed.png") });
await p.keyboard.press("Enter"); await p.waitForTimeout(4000);
await p.screenshot({ path: outPng });
await b.close();
