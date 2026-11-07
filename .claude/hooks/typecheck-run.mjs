/**
 * Stop hook: runs `npm run typecheck` once per engine checkout that this turn edited
 * under src/ (the checkouts recorded by typecheck-mark.mjs, in that checkout's own
 * directory). On failure it blocks the stop and hands the compiler output back so the
 * errors get fixed.
 *
 * The directory comes from the marker, never from CLAUDE_PROJECT_DIR: at the workspace
 * root that variable is the workspace, which has no package.json.
 *
 * `stop_hook_active` guards against looping when a block already fired this turn.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const marker = path.join(os.tmpdir(), `wets-typecheck-${input.session_id ?? "default"}`);
if (!fs.existsSync(marker)) process.exit(0);
const checkouts = fs.readFileSync(marker, "utf8").split("\n").filter(Boolean);
fs.rmSync(marker, { force: true });

if (input.stop_hook_active) process.exit(0);

const failures = [];
const skipped = [];
for (const dir of checkouts) {
  // A fresh worktree without `npm ci` cannot typecheck; that is not a type error to fix.
  if (!fs.existsSync(path.join(dir, "node_modules"))) {
    skipped.push(dir);
    continue;
  }
  const result = spawnSync("npm run typecheck", { cwd: dir, shell: true, encoding: "utf8" });
  if (result.status === 0) continue;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(-4000);
  failures.push(`In ${dir}:\n${output}`);
}

if (failures.length > 0) {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: `\`npm run typecheck\` failed after edits under src/. Fix these type errors before finishing:\n\n${failures.join("\n\n")}`,
    }),
  );
} else if (skipped.length > 0) {
  process.stdout.write(
    JSON.stringify({ systemMessage: `Typecheck skipped (no node_modules, run npm ci): ${skipped.join(", ")}` }),
  );
}
