/**
 * PostToolUse hook (Write|Edit): records which engine checkout had a TypeScript
 * file under src/ touched, so the Stop hook knows which typecheck is owed. Cheap on
 * purpose — the 30-second `npm run typecheck` runs once per turn, not once per edit.
 *
 * The checkout is derived from the EDITED FILE, not from CLAUDE_PROJECT_DIR: a session
 * launched at the workspace root has the root as its project dir, and its edits land in
 * the main engine checkout or in a task worktree. A file that is not inside an engine
 * checkout (virtual-lab/…/src, the editor, ScenarioCreator) records nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Nearest ancestor of `file` that is an engine checkout: it ships this hook pair and a
 * package.json with a `typecheck` script. Null when the file belongs to another repo.
 */
function findEngineCheckout(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".claude", "hooks", "typecheck-run.mjs"))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        if (pkg?.scripts?.typecheck) return dir;
      } catch {
        // no readable package.json here: not a checkout, keep climbing
      }
    }
    if (path.dirname(dir) === dir) return null;
  }
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const edited = input?.tool_input?.file_path ?? input?.tool_response?.filePath ?? "";
if (!edited) process.exit(0);

const file = path.resolve(input.cwd || process.cwd(), edited);
const checkout = findEngineCheckout(file);
if (!checkout) process.exit(0);

// Only src/ of that checkout counts (tests/, scripts/, docs/ are not what the turn-end check is for).
const rel = path.relative(checkout, file);
if (!/^src[\\/].*\.(ts|tsx|mts|cts)$/i.test(rel)) process.exit(0);

// One checkout per line; a turn may edit the main checkout and a worktree.
const marker = path.join(os.tmpdir(), `wets-typecheck-${input.session_id ?? "default"}`);
const owed = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").split("\n").filter(Boolean) : [];
if (!owed.includes(checkout)) {
  owed.push(checkout);
  fs.writeFileSync(marker, owed.join("\n"), "utf8");
}
