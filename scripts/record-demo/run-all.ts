/**
 * Runs every demo recording in sequence, keeps going after a failure, and prints a pass/fail
 * summary. Each script is its own process (own browser, own cleanup), so one failing never
 * stops the next. Same env vars as the individual scripts (DEMO_EMAIL, DEMO_PASSWORD, ...).
 *
 * Exit code: 0 if every script passed, 1 if any failed or left something behind.
 *
 * Run:  npm run record:demo:all   (then  npm run videos:encode)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CLEANUP_INCOMPLETE_EXIT } from "./helpers.ts";

const SCRIPTS = ["estimate-to-invoice", "job-photos", "record-payment", "job-profit"];

type Result = { name: string; status: "PASS" | "FAIL" | "CLEANUP"; seconds: number; code: number | null };
const results: Result[] = [];

for (const name of SCRIPTS) {
  console.log(`\n=== ${name} ===`);
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(import.meta.dirname, `${name}.ts`)], {
    stdio: "inherit",
    env: process.env,
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const status = run.status === 0 ? "PASS" : run.status === CLEANUP_INCOMPLETE_EXIT ? "CLEANUP" : "FAIL";
  results.push({ name, status, seconds, code: run.status });
}

console.log("\n=== Summary ===");
for (const r of results) {
  const note =
    r.status === "PASS"
      ? ""
      : r.status === "CLEANUP"
        ? "  recorded, but cleanup left items behind - see the warning above"
        : `  exit code ${r.code ?? "none (killed)"}`;
  console.log(`${r.status.padEnd(8)} ${r.name.padEnd(22)} ${String(r.seconds).padStart(4)}s${note}`);
}
const bad = results.filter((r) => r.status !== "PASS").length;
console.log(`\n${results.length - bad} of ${results.length} passed.`);
process.exitCode = bad === 0 ? 0 : 1;
