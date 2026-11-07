import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The engine's turn-end typecheck (`.claude/hooks/typecheck-{mark,run}.mjs`) has to work
 * from a session launched at the WebEngine workspace root, not only from inside the engine.
 *
 * Claude Code sets `CLAUDE_PROJECT_DIR` to the folder the session was launched in. At the
 * root that is the workspace (no package.json), and the edited files are in the main
 * engine checkout, in an engine task worktree, or in another repo whose path also contains
 * `/src/`. The hooks must therefore decide *which checkout to typecheck* from the edited
 * file, typecheck exactly that checkout, and stay silent for files of other repos.
 *
 * Each case runs the real scripts as child processes against a throwaway workspace whose
 * "engine" `typecheck` script fails iff a `fail.flag` file sits next to its package.json.
 */

const hooksDir = path.resolve(__dirname, "..", ".claude", "hooks");
const markScript = path.join(hooksDir, "typecheck-mark.mjs");
const runScript = path.join(hooksDir, "typecheck-run.mjs");

let ws: string;
let main: string;
let worktree: string;
let virtualLab: string;
const sessions: string[] = [];

function makeCheckout(dir: string, withModules = true): void {
    fs.mkdirSync(path.join(dir, ".claude", "hooks"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "hooks", "typecheck-run.mjs"), "// marker for hook discovery\n");
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fake-engine", scripts: { typecheck: "node check.cjs" } }));
    fs.writeFileSync(path.join(dir, "check.cjs"), 'process.exit(require("fs").existsSync("fail.flag") ? 1 : 0);\n');
    if (withModules) fs.mkdirSync(path.join(dir, "node_modules"));
}

function newSession(): string {
    const id = `m04-test-${randomUUID()}`;
    sessions.push(id);
    return id;
}

const markerOf = (session: string): string => path.join(os.tmpdir(), `wets-typecheck-${session}`);

/** PostToolUse payload as Claude Code sends it, from a session launched at the workspace root. */
function mark(session: string, file: string, cwd: string = ws): void {
    const r = spawnSync("node", [markScript], {
        input: JSON.stringify({ session_id: session, cwd, tool_name: "Edit", tool_input: { file_path: file } }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: ws },
        encoding: "utf8",
    });
    expect(r.status).toBe(0);
}

interface StopOutput {
    decision?: string;
    reason?: string;
    systemMessage?: string;
}

function stop(session: string, extra: Record<string, unknown> = {}): StopOutput | null {
    const r = spawnSync("node", [runScript], {
        input: JSON.stringify({ session_id: session, cwd: ws, stop_hook_active: false, ...extra }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: ws },
        encoding: "utf8",
    });
    expect(r.status).toBe(0);
    return r.stdout.trim() ? (JSON.parse(r.stdout) as StopOutput) : null;
}

/** Make `dir`'s fake typecheck fail for the duration of `body`. */
function withTypeError(dirs: string[], body: () => void): void {
    for (const d of dirs) fs.writeFileSync(path.join(d, "fail.flag"), "");
    try {
        body();
    } finally {
        for (const d of dirs) fs.rmSync(path.join(d, "fail.flag"), { force: true });
    }
}

describe("engine typecheck hooks launched from the workspace root", () => {
    beforeAll(() => {
        ws = fs.mkdtempSync(path.join(os.tmpdir(), "wets-hooks-"));
        main = path.join(ws, "WebEngineTS");
        worktree = path.join(ws, ".code-foundations", "worktrees", "T1", "WebEngineTS");
        virtualLab = path.join(ws, "virtual-lab", "frontend");
        makeCheckout(main);
        makeCheckout(worktree);
        fs.mkdirSync(path.join(virtualLab, "src"), { recursive: true });
        fs.writeFileSync(path.join(virtualLab, "package.json"), JSON.stringify({ name: "frontend", scripts: { typecheck: "exit 1" } }));
    });

    afterAll(() => {
        fs.rmSync(ws, { recursive: true, force: true });
        for (const id of sessions) fs.rmSync(markerOf(id), { force: true });
    });

    test("an edit under the main checkout's src/ is typechecked there, and passes when clean", () => {
        const s = newSession();
        mark(s, path.join(main, "src", "a.ts"));
        expect(fs.existsSync(markerOf(s))).toBe(true);
        expect(stop(s)).toBeNull();
        expect(fs.existsSync(markerOf(s))).toBe(false);
    });

    test("a type error in the main checkout blocks the stop and names the checkout", () => {
        const s = newSession();
        withTypeError([main], () => {
            mark(s, path.join(main, "src", "a.ts"));
            const out = stop(s);
            expect(out?.decision).toBe("block");
            expect(out?.reason).toContain(`In ${main}:`);
        });
    });

    test("an edit in a task worktree typechecks the worktree, not the main checkout", () => {
        const s = newSession();
        withTypeError([main], () => {
            mark(s, path.join(worktree, "src", "deep", "b.ts"));
            expect(stop(s)).toBeNull(); // main is broken but was not edited this turn
        });
        withTypeError([worktree], () => {
            mark(s, path.join(worktree, "src", "deep", "b.ts"));
            const out = stop(s);
            expect(out?.decision).toBe("block");
            expect(out?.reason).toContain(`In ${worktree}:`);
            expect(out?.reason).not.toContain(`In ${main}:`);
        });
    });

    test("edits in two checkouts in one turn typecheck both, once each", () => {
        const s = newSession();
        withTypeError([main, worktree], () => {
            mark(s, path.join(main, "src", "a.ts"));
            mark(s, path.join(main, "src", "a2.ts"));
            mark(s, path.join(worktree, "src", "b.ts"));
            const out = stop(s);
            expect(out?.reason).toContain(`In ${main}:`);
            expect(out?.reason).toContain(`In ${worktree}:`);
            expect(out?.reason?.match(/^In .*:$/gm)).toHaveLength(2);
        });
    });

    test("another repo's src/ owes nothing, even when its package.json has a typecheck script", () => {
        const s = newSession();
        mark(s, path.join(virtualLab, "src", "App.ts"));
        expect(fs.existsSync(markerOf(s))).toBe(false);
        expect(stop(s)).toBeNull();
    });

    test("only .ts files under the checkout's src/ count", () => {
        const s = newSession();
        mark(s, path.join(main, "tests", "t.test.ts"));
        mark(s, path.join(main, "src", "data.json"));
        mark(s, path.join(main, "src", "notes.md"));
        expect(fs.existsSync(markerOf(s))).toBe(false);
    });

    test("a checkout without node_modules is skipped with a notice, not blocked", () => {
        const bare = path.join(ws, ".code-foundations", "worktrees", "T2", "WebEngineTS");
        makeCheckout(bare, false);
        withTypeError([bare], () => {
            const s = newSession();
            mark(s, path.join(bare, "src", "c.ts"));
            const out = stop(s);
            expect(out?.decision).toBeUndefined();
            expect(out?.systemMessage).toContain(bare);
        });
    });

    test("stop_hook_active clears the marker without running (no loop)", () => {
        const s = newSession();
        withTypeError([main], () => {
            mark(s, path.join(main, "src", "a.ts"));
            expect(stop(s, { stop_hook_active: true })).toBeNull();
            expect(stop(s)).toBeNull();
        });
    });

    test("a relative file_path resolves against the payload's cwd", () => {
        const s = newSession();
        withTypeError([main], () => {
            mark(s, "src/a.ts", main);
            expect(stop(s)?.decision).toBe("block");
        });
    });
});
