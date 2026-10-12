/**
 * Stop hook: runs `npm run typecheck` once, only when this turn edited a
 * TypeScript file under src/ (the marker left by typecheck-mark.mjs). On failure
 * it blocks the stop and hands the compiler output back so the errors get fixed.
 *
 * `stop_hook_active` guards against looping when a block already fired this turn.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const marker = path.join(os.tmpdir(), `wets-typecheck-${input.session_id ?? "default"}`);
if (!fs.existsSync(marker)) process.exit(0);
fs.rmSync(marker, { force: true });

if (input.stop_hook_active) process.exit(0);

const projectDir =
  process.env.CLAUDE_PROJECT_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const result = spawnSync("npm run typecheck", {
  cwd: projectDir,
  shell: true,
  encoding: "utf8",
});
if (result.status === 0) process.exit(0);

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(-4000);
process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason: `\`npm run typecheck\` failed after edits under src/. Fix these type errors before finishing:\n\n${output}`,
  }),
);
