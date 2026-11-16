// The page on a scratch bb with the fake aws and gcloud: list, prod confirm, swap (bb machine variables), Off, AWS
// device-code login, GCP login. Between the steps it asks the scratch bb itself what is set, runs a new terminal to see
// what a new command gets, and runs the `cloud` CLI against the same bb.
// Run inside the scratch: scratch-bb run cloud-switch -- node test/e2e/shots.mjs --out <dir>
// The scratch machine needs the tests' config (test/sandbox.ts CONFIG) at ~/.config/bb-cloud-switch/config.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values } = parseArgs({ options: { out: { type: "string" }, base: { type: "string", default: "http://127.0.0.1:48886" }, "fake-log": { type: "string" } } });
const out = values.out;
if (!out) throw new Error("--out DIR");
mkdirSync(out, { recursive: true });
const report = { steps: [], console: [] };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on("console", (m) => { if (m.type() === "error") report.console.push(m.text()); });
page.on("pageerror", (e) => report.console.push(String(e)));
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: join(out, name), fullPage: true }); report.steps.push(name); };
const row = (id) => page.locator(`[data-target="${id}"]`);
const chip = (v) => page.locator(`[data-var="${v}"]`);
const bb = (...args) => execFileSync("bb", args, { encoding: "utf8" });
// what bb has (names only: it masks values), and what a new terminal on the machine gets
const machineEnv = () => JSON.parse(bb("machine", "env", "list", "--json")).variables.map((v) => v.name).filter((n) => n !== "PATH");
const newTerminal = () => {
  const host = JSON.parse(bb("machine", "list", "--json"))[0].id;
  return JSON.parse(bb("terminal", "run", "--machine", host, "--json", "--", "bash", "-c", 'echo "AWS_PROFILE=${AWS_PROFILE-} CLOUDSDK_ACTIVE_CONFIG_NAME=${CLOUDSDK_ACTIVE_CONFIG_NAME-}"')).output.trim();
};
// the CLI, pointed at this scratch bb instead of the runner's
const cli = (...args) => {
  const env = { ...process.env, CLOUD_SWITCH_BB_SERVER_URL: values.base, CLOUD_SWITCH_BB_HOST_DAEMON_PORT: "48887" };
  delete env.AWS_CONFIG_FILE;
  return execFileSync(new URL("../../bin/cloud", import.meta.url).pathname, args, { encoding: "utf8", env });
};

try {
  await page.goto(`${values.base}/plugins/cloud-switch/cloud`, { waitUntil: "load", timeout: 60_000 });
  await row("aws:app-prod").waitFor({ timeout: 60_000 });
  // a plain view runs no sts for prod: its rows are unchecked, with a Check button
  await row("aws:app-prod").getByText("Unchecked").waitFor();
  await page.locator("[data-note]", { hasText: "Applies to new threads, terminals and commands" }).waitFor();
  await chip("AWS_PROFILE").getByText("AWS_PROFILE=(unset)").waitFor();
  report.before = { machineEnv: machineEnv(), newTerminal: newTerminal() };
  await shot("01-list-prod-unchecked.png");
  const log = values["fake-log"] && existsSync(values["fake-log"]) ? readFileSync(values["fake-log"], "utf8") : null;
  report.prodStsOnView = log === null ? "no fake log given" : log.split("\n").filter((l) => /get-caller-identity/.test(l) && /--profile=(app-prod|reports-prod)"/.test(l)).length;
  if (report.prodStsOnView !== 0) throw new Error(`page view ran sts for a prod profile: ${report.prodStsOnView}`);
  await row("aws:reports-prod").getByRole("button", { name: "Check reports-prod" }).click();
  await row("aws:reports-prod").getByText("activate Example Prod Reports in PIM").waitFor({ timeout: 30_000 });
  report.checked = "reports-prod";

  // prod is never one click: Use asks again, naming the profile
  await row("aws:app-prod").getByRole("button", { name: "Use app-prod" }).click();
  await page.locator('[data-confirm="use:app-prod"]').waitFor();
  await shot("02-prod-use-confirm.png");
  await page.getByRole("button", { name: "Yes, use app-prod" }).click();
  await row("aws:app-prod").locator("[data-active]").waitFor({ timeout: 30_000 });

  // a dev GCP configuration swaps in one click (and is created on first use)
  await row("gcp:dev").getByRole("button", { name: "Use dev" }).click();
  await row("gcp:dev").locator("[data-active]").waitFor({ timeout: 30_000 });
  await page.getByRole("status").getByText("CLOUDSDK_ACTIVE_CONFIG_NAME=dev set").waitFor();
  await chip("AWS_PROFILE").getByText("AWS_PROFILE=app-prod").waitFor();
  await chip("CLOUDSDK_ACTIVE_CONFIG_NAME").getByText("CLOUDSDK_ACTIVE_CONFIG_NAME=dev").waitFor();
  await shot("03-swap-and-note.png");
  report.afterSwap = { machineEnv: machineEnv(), newTerminal: newTerminal(), cliLs: cli("ls").split("\n").filter((l) => /^(AWS_PROFILE|CLOUDSDK_ACTIVE_CONFIG_NAME):|app-prod|gcp +dev/.test(l)) };
  if (report.afterSwap.newTerminal !== "AWS_PROFILE=app-prod CLOUDSDK_ACTIVE_CONFIG_NAME=dev") throw new Error(`a new terminal got: ${report.afterSwap.newTerminal}`);

  // Off: AWS_PROFILE unset, back to the default chain
  await page.getByRole("button", { name: "Unset AWS_PROFILE" }).click();
  await chip("AWS_PROFILE").getByText("AWS_PROFILE=(unset)").waitFor({ timeout: 30_000 });
  await page.getByRole("status").getByText("AWS_PROFILE unset (was app-prod)").waitFor();
  await shot("04-aws-off.png");
  report.afterOff = { machineEnv: machineEnv(), newTerminal: newTerminal() };
  if (report.afterOff.newTerminal !== "AWS_PROFILE= CLOUDSDK_ACTIVE_CONFIG_NAME=dev") throw new Error(`after Off a new terminal got: ${report.afterOff.newTerminal}`);

  // the CLI's own swap against this bb: `bb machine env set` with the value on stdin, then unset
  const use = cli("use", "aws", "app-dev").trim().split("\n")[0];
  const afterCliUse = newTerminal();
  const off = cli("off", "aws").trim().split("\n")[0];
  report.cliSwap = { use, afterCliUse, off, afterCliOff: newTerminal() };
  if (afterCliUse !== "AWS_PROFILE=app-dev CLOUDSDK_ACTIVE_CONFIG_NAME=dev" || report.cliSwap.afterCliOff !== "AWS_PROFILE= CLOUDSDK_ACTIVE_CONFIG_NAME=dev") throw new Error(`cli swap: ${JSON.stringify(report.cliSwap)}`);

  // AWS login on a prod profile: confirm, then the device-code link and code
  await row("aws:app-prod").getByRole("button", { name: "Log in app-prod" }).click();
  await page.locator('[data-confirm="login:app-prod"]').waitFor();
  await page.getByRole("button", { name: "Yes, log in to app-prod" }).click();
  await page.locator("[data-login-code]").waitFor({ timeout: 30_000 });
  report.login = { code: await page.locator("[data-login-code]").textContent(), href: await page.locator("[data-login-url]").getAttribute("href") };
  await shot("05-aws-device-code-login.png");
  // the fake login finishes after its wait; the page sees the terminal exit and reads again
  await page.locator('[data-login="aws:app-prod"]', { hasText: "done" }).waitFor({ timeout: 60_000 });
  await row("aws:app-prod").getByRole("button", { name: "Check app-prod" }).click();
  await row("aws:app-prod").getByText("Logged in").waitFor({ timeout: 30_000 });
  await shot("06-after-aws-login.png");

  // GCP login opens a bb terminal (gcloud asks for a pasted code there)
  await row("gcp:dev").getByRole("button", { name: "Log in dev" }).click();
  await page.waitForTimeout(4000);
  await shot("07-gcp-login-terminal.png");
} catch (e) {
  report.error = String(e);
  await page.screenshot({ path: join(out, "error.png"), fullPage: true });
} finally {
  writeFileSync(join(out, "shots-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.error ? 1 : 0);
