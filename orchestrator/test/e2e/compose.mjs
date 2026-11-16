// Type one message into a thread's composer in the app and send it; screenshot before and after.
//   node compose.mjs <projectId> <threadId> <messageFile> <outPng>
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
const [projectId, threadId, file, outPng] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(`http://127.0.0.1:38886/projects/${projectId}/threads/${threadId}`, { waitUntil: "load" });
const box = p.locator('[contenteditable="true"], textarea').last();
await box.waitFor({ timeout: 30000 }); await box.click();
await p.keyboard.insertText(readFileSync(file, "utf8").trim());
await p.screenshot({ path: outPng.replace(/\.png$/, "-typed.png") });
await p.keyboard.press("Enter"); await p.waitForTimeout(4000);
await p.screenshot({ path: outPng });
await b.close();
