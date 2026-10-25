// tests/ReleaseTargets.test.ts
// ============================================================
// DW-3.4: `npm run release:local` delivers the tarball (with dist/player/) to virtual-lab at the workspace root AND
// at testv/. The layout rules are pure functions (scripts/lib/release-targets.mjs), exercised here over real
// temporary directory trees; nothing builds, packs or writes into a sibling repo. The script's `--dry-run` is run
// for real because it provably writes nothing.
// ============================================================

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
    REQUIRED_PACKAGE_FILES, copyTarball, findWorkspaceParent, missingFromTarball, planTargets, resolveVirtualLab,
} from "../scripts/lib/release-targets.mjs";

const TGZ = "WebEngineTS-0.1.0.tgz";
const dirs: string[] = [];
const BUILT = REQUIRED_PACKAGE_FILES.every(file => existsSync(new URL(`../${file}`, import.meta.url)));

/** A workspace tree with the given directories created (relative to its root). */
function workspace(...paths: string[]): string {
    const root = mkdtempSync(join(tmpdir(), "release-targets-"));
    dirs.push(root);
    for (const p of paths) mkdirSync(join(root, p), { recursive: true });
    return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("resolveVirtualLab", () => {
    test("DW_3_4 finds virtual-lab at the workspace root", () => {
        const root = workspace("virtual-lab/frontend");

        expect(resolveVirtualLab(root)).toEqual({ dir: join(root, "virtual-lab"), layout: "virtual-lab", ignored: [] });
    });

    test("DW_3_4 still finds it under testv/", () => {
        const root = workspace("testv/virtual-lab/frontend");

        expect(resolveVirtualLab(root)).toEqual({ dir: join(root, "testv", "virtual-lab"), layout: join("testv", "virtual-lab"), ignored: [] });
    });

    test("when both exist the root layout wins and the other is reported, not written to", () => {
        const root = workspace("virtual-lab/frontend", "testv/virtual-lab/frontend");
        const lab = resolveVirtualLab(root)!;

        expect(lab.dir).toBe(join(root, "virtual-lab"));
        expect(lab.ignored).toEqual([join(root, "testv", "virtual-lab")]);
    });

    test("neither: null", () => {
        expect(resolveVirtualLab(workspace("ScenarioCreator"))).toBeNull();
    });
});

describe("planTargets", () => {
    test("DW_3_4 root layout: the tarball, transcoder and frontend all point under <root>/virtual-lab", () => {
        const root = workspace("virtual-lab/frontend");
        const plan = planTargets(root, TGZ);

        const frontend = plan.consumers.find(c => c.name === "virtual-lab frontend")!;
        expect(frontend).toMatchObject({ dir: join(root, "virtual-lab", "frontend"), copyTgz: true, spec: `./${TGZ}` });
        expect(plan.transcoderTargets.find(t => t.name === "virtual-lab frontend")!.dest).toBe(join(root, "virtual-lab", "frontend", "src", "assets", "basis"));
    });

    test("DW_3_4 testv layout: the same targets point under <root>/testv/virtual-lab", () => {
        const root = workspace("testv/virtual-lab/frontend");
        const plan = planTargets(root, TGZ);

        expect(plan.consumers.find(c => c.name === "virtual-lab frontend")!.dir).toBe(join(root, "testv", "virtual-lab", "frontend"));
        expect(plan.transcoderTargets.find(t => t.name === "virtual-lab frontend")!.dest).toBe(join(root, "testv", "virtual-lab", "frontend", "src", "assets", "basis"));
    });

    test("the other consumers do not move with the layout", () => {
        const plan = planTargets(workspace("testv/virtual-lab"), TGZ);

        expect(plan.consumers.map(c => c.name)).toEqual(["ScenarioCreator", "virtual-lab frontend", "WebEngineTSEditor app"]);
        expect(plan.bundleConsumers[0].files).toEqual(["WebEngineTS.standalone.js", "WebEngineTS.d.ts"]);
    });
});

describe("copyTarball", () => {
    test.each([
        ["root layout", "virtual-lab"],
        ["testv layout", "testv/virtual-lab"],
    ])("DW_3_4 delivers the tarball into virtual-lab/frontend (%s)", (_name, lab) => {
        const root = workspace(`${lab}/frontend`);
        const tgz = join(root, "packed.tgz");
        writeFileSync(tgz, "tarball bytes");
        const frontend = planTargets(root, TGZ).consumers.find(c => c.name === "virtual-lab frontend")!;

        expect(copyTarball(frontend, tgz, TGZ)).toBe("copied");
        expect(readFileSync(join(root, lab, "frontend", TGZ), "utf8")).toBe("tarball bytes");
    });

    test("a consumer that is not there is skipped, and nothing is created for it", () => {
        const root = workspace("virtual-lab/frontend");
        const tgz = join(root, "packed.tgz");
        writeFileSync(tgz, "x");
        const creator = planTargets(root, TGZ).consumers.find(c => c.name === "ScenarioCreator")!;

        expect(copyTarball(creator, tgz, TGZ)).toBe("skipped");
        expect(existsSync(join(root, "ScenarioCreator"))).toBe(false);
    });

    test("a consumer without copyTgz is skipped", () => {
        const root = workspace("a");
        expect(copyTarball({ name: "n", dir: join(root, "a"), copyTgz: false, spec: "" }, join(root, "x"), TGZ)).toBe("skipped");
    });
});

describe("the tarball must carry the player", () => {
    test("DW_3_4 the required files are the three player files plus the host client and its types", () => {
        expect(REQUIRED_PACKAGE_FILES).toEqual([
            "dist/player/player.html", "dist/player/player.js", "dist/player/player.nginx.conf", "dist/player-host.js", "dist/player-host.d.ts",
        ]);
    });

    test("DW_3_4 a complete listing passes, in npm's format or with a package/ prefix or backslashes", () => {
        expect(missingFromTarball(REQUIRED_PACKAGE_FILES)).toEqual([]);
        expect(missingFromTarball(REQUIRED_PACKAGE_FILES.map(f => `package/${f}`))).toEqual([]);
        expect(missingFromTarball(REQUIRED_PACKAGE_FILES.map(f => f.replaceAll("/", "\\")))).toEqual([]);
    });

    test("DW_3_4 a tarball without dist/player is reported file by file", () => {
        const files = ["dist/WebEngineTS.esm.js", "dist/player-host.js", "dist/player-host.d.ts", "CHANGELOG.md"];

        expect(missingFromTarball(files)).toEqual(["dist/player/player.html", "dist/player/player.js", "dist/player/player.nginx.conf"]);
    });

    // Needs a built dist; release-local asserts the same on the real pack, so a checkout without a build skips this.
    test.skipIf(!BUILT)("DW_3_4 `npm pack --dry-run` lists dist/player/*", () => {
        const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: new URL("..", import.meta.url), shell: true, encoding: "utf8" });
        const [result] = JSON.parse(out);

        expect(missingFromTarball(result.files.map((f: { path: string }) => f.path))).toEqual([]);
    }, 120_000);
});

describe("findWorkspaceParent", () => {
    test("a plain checkout's parent is the workspace", () => {
        const root = workspace("WebEngineTS", "virtual-lab");

        expect(findWorkspaceParent(join(root, "WebEngineTS"))).toBe(root);
    });

    test("a worktree (<workspace>/WebEngineTS/.claude/worktrees/x) still finds the workspace, not .claude/worktrees", () => {
        const root = workspace("WebEngineTS/.claude/worktrees/x", "testv/virtual-lab");

        expect(findWorkspaceParent(join(root, "WebEngineTS", ".claude", "worktrees", "x"))).toBe(root);
    });

    test("with no sibling anywhere it falls back to the engine's parent", () => {
        const root = workspace("only/engine");

        expect(findWorkspaceParent(join(root, "only", "engine"))).toBe(join(root, "only"));
    });
});

describe("release-local --dry-run", () => {
    test("DW_3_4 prints the plan and exits 0 without building or copying anything", () => {
        const before = existsSync(new URL("../WebEngineTS-0.1.0.tgz", import.meta.url));
        const run = spawnSync(process.execPath, ["scripts/release-local.mjs", "--dry-run"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });

        expect(run.status).toBe(0);
        expect(run.stdout).toMatch(/virtual-lab:/);
        expect(run.stdout).toMatch(/tarball -> virtual-lab frontend:/);
        expect(run.stdout).not.toMatch(/Building engine/);
        expect(existsSync(new URL("../WebEngineTS-0.1.0.tgz", import.meta.url))).toBe(before);
    }, 60_000);
});
