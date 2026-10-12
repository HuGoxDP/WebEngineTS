/**
 * PostToolUse hook (Write|Edit): records that a TypeScript file under src/ was
 * touched, so the Stop hook knows whether a typecheck is owed. Cheap on purpose —
 * the 30-second `npm run typecheck` runs once per turn, not once per edit.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const file = input?.tool_input?.file_path ?? input?.tool_response?.filePath ?? "";
if (!/[\\/]src[\\/].*\.(ts|tsx|mts|cts)$/i.test(file)) process.exit(0);

const marker = path.join(os.tmpdir(), `wets-typecheck-${input.session_id ?? "default"}`);
fs.writeFileSync(marker, file, "utf8");
