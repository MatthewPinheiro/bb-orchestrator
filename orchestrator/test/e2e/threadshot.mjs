// Screenshot a thread's transcript in the app: node threadshot.mjs <projectId> <threadId> <outPng>
import { chromium } from "playwright-core";
const [projectId, threadId, outPng] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
await p.goto(`http://127.0.0.1:38886/projects/${projectId}/threads/${threadId}`, { waitUntil: "load" });
await p.waitForTimeout(5000);
await p.screenshot({ path: outPng });
await b.close();
