import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import JSZip from "jszip";
import { Scenario } from "../src/engine/core/scenario/Scenario";
import { ScenarioBehaviour } from "../src/engine/core/scenario/ScenarioBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { Resources } from "../src/engine/core/assets/Resources";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";
import { Serializable } from "../src/engine/core/reflection/Decorators";
import { TypeRegistry } from "../src/engine/core/reflection/TypeRegistry";
import { MissingComponent } from "../src/engine/core/serialization/MissingComponent";

/**
 * C4r8: every script of a scenario is imported before the entry's awake, so a
 * component whose script nobody imports (every Library add) resolves on the
 * platform instead of becoming a `MissingComponent` — Unity parity.
 *
 * The fixture is built the same way as `tests/ScenarioEntryScene.test.ts`: a
 * real ZIP through `loadFromData`, real manifest, real pre-linking, real
 * `run()`. Two seams adapt script imports to Node, which cannot import blob:
 * URLs: `URL.createObjectURL` hands out `data:` URLs carrying the rewritten
 * source (Node imports those natively, once per URL, like the browser's module
 * cache), and the scripts take their engine classes from a `globalThis` bridge
 * because a native `data:` module cannot import the vite-transformed TS
 * sources. Calling `Serializable({...})(class ...)` is exactly what tsc emits
 * for `@Serializable` — the shape ScenarioCreator puts in the ZIP.
 */

const BRIDGE = "__c4r8Engine";

/** What the entry's awake saw, and the module evaluation order (DW-1.2/1.3). */
declare global {
    var __c4r8Awake: unknown;
    var __c4r8Order: string[];
}

/** An entry module that imports nothing. `tag` keeps each test's URL unique. */
function entryCode(tag: string): string {
    return `// ${tag}\n` +
        `const { ScenarioBehaviour } = globalThis.${BRIDGE};\n` +
        `export default class Main extends ScenarioBehaviour {}\n`;
}

/** A Library-style script: declares an @Serializable component nobody imports. */
function spinCode(typeName: string): string {
    return `const { Serializable, Behaviour } = globalThis.${BRIDGE};\n` +
        `const Spin = Serializable({ typeName: ${JSON.stringify(typeName)} })(class extends Behaviour {});\n` +
        `export { Spin };\n`;
}

/** A scene naming one component type on a "Holder" object, as a file. */
function sceneJson(...typeNames: string[]): string {
    return JSON.stringify({
        name: "ScriptReg",
        version: 1,
        roots: [{
            name: "Holder",
            active: true,
            transform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                scale: { x: 1, y: 1, z: 1 },
            },
            components: typeNames.map(type => ({ type, fields: {} })),
            children: [],
        }],
    });
}

async function loaded(
    scripts: Record<string, string>,
    sceneTypes: string[] | null,
): Promise<Scenario> {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
        manifestVersion: "1.0", id: "script-reg", name: "Script Registration Spec",
        version: "1.0.0", entryPoint: "main.js",
        ...(sceneTypes ? { entryScene: "scenes/main.scene.json" } : {}),
    }));
    for (const [path, code] of Object.entries(scripts)) zip.file(path, code);
    if (sceneTypes) zip.file("assets/scenes/main.scene.json", sceneJson(...sceneTypes));
    const data = await zip.generateAsync({ type: "arraybuffer" });

    const scenario = new Scenario();
    await scenario.loadFromData(data);

    // The Node seam, installed after the ZIP is built and parsed: pre-linking
    // mints the URLs, run() imports them. The fake Blob also serves the real
    // asset path (`getAsset(...).text()` for the entry scene).
    vi.stubGlobal("Blob", class {
        constructor(public parts: unknown[]) {}
        async text(): Promise<string> {
            return this.parts
                .map(p => typeof p === "string" ? p : new TextDecoder().decode(p as ArrayBuffer))
                .join("");
        }
    });
    vi.spyOn(URL, "createObjectURL").mockImplementation(
        (blob: Blob | MediaSource) =>
            "data:text/javascript," +
            encodeURIComponent((blob as unknown as { parts: string[] }).parts.join("")),
    );
    return scenario;
}

const holder = (): GameObject =>
    SceneManager.activeScene.getRootGameObjects().find(g => g.name === "Holder")!;

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubGlobal(BRIDGE, { ScenarioBehaviour, Behaviour, Serializable, TypeRegistry, GameObject });
});

afterEach(() => {
    Scenario.current?.unload();
    Resources.releaseSource();
    AssetDatabase.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("every script is imported before awake", () => {
    test("DW-1.1: a scene component whose script nobody imports resolves, not MissingComponent", async () => {
        const scenario = await loaded({
            "scripts/main.js": entryCode("dw-1-1"),
            "scripts/library/Spin.js": spinCode("ScriptReg1.Spin"),
        }, ["ScriptReg1.Spin"]);

        await scenario.run();

        expect(scenario.isRunning).toBe(true);
        expect(holder().getComponent(MissingComponent)).toBeNull();
        const spinCtor = TypeRegistry.get("ScriptReg1.Spin");
        expect(spinCtor).not.toBeNull();
        expect(holder().getAllComponents().map(c => c.constructor)).toContain(spinCtor);
    });

    test("DW-1.2: addComponent by type name inside the entry's awake finds the script's class", async () => {
        const entry =
            `const { ScenarioBehaviour, TypeRegistry, GameObject } = globalThis.${BRIDGE};\n` +
            `export default class Main extends ScenarioBehaviour {\n` +
            `    awake() {\n` +
            `        const ctor = TypeRegistry.get("ScriptReg2.Spin");\n` +
            `        globalThis.__c4r8Awake = ctor;\n` +
            `        if (ctor) new GameObject("FromAwake").addComponent(ctor);\n` +
            `    }\n` +
            `}\n`;
        const scenario = await loaded({
            "scripts/main.js": entry,
            "scripts/library/Spin.js": spinCode("ScriptReg2.Spin"),
        }, null);

        await scenario.run();

        const spinCtor = TypeRegistry.get("ScriptReg2.Spin");
        expect(spinCtor).not.toBeNull();
        expect(globalThis.__c4r8Awake).toBe(spinCtor);
        const fromAwake = SceneManager.activeScene.getRootGameObjects()
            .find(g => g.name === "FromAwake")!;
        expect(fromAwake.getComponent(spinCtor!)).toBeInstanceOf(spinCtor!);
    });

    test("DW-1.3: entry graph first, then the rest in sorted path order, each module once", async () => {
        vi.stubGlobal("__c4r8Order", []);
        // Node caches modules by URL: every module's source is tagged so no two
        // tests can share one and skip its evaluation.
        const push = (path: string) => `globalThis.__c4r8Order.push(${JSON.stringify(path)}); // dw-1-3\n`;
        const scenario = await loaded({
            "scripts/main.js":
                `import "./util.js";\n` + push("scripts/main.js") +
                `const { ScenarioBehaviour } = globalThis.${BRIDGE};\n` +
                `export default class Main extends ScenarioBehaviour {}\n`,
            "scripts/util.js": push("scripts/util.js") + `export const answer = 42;\n`,
            "scripts/z.js": push("scripts/z.js"),
            "scripts/a.js": push("scripts/a.js"),
            "scripts/library/Spin.js": push("scripts/library/Spin.js") + spinCode("ScriptReg3.Spin"),
        }, null);

        await scenario.run();

        // util evaluates before main (ESM evaluates imports first); the entry's
        // graph as a whole runs before the remaining scripts, which follow in
        // sorted key order. util is cached — it does not run a second time.
        expect(globalThis.__c4r8Order).toEqual([
            "scripts/util.js",
            "scripts/main.js",
            "scripts/a.js",
            "scripts/library/Spin.js",
            "scripts/z.js",
        ]);
        expect(globalThis.__c4r8Order.filter(p => p === "scripts/util.js")).toHaveLength(1);
    });

    test("DW-1.4: a broken non-entry script is logged once by path; the scenario still runs", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const broken =
            `const { Serializable, Behaviour } = globalThis.${BRIDGE};\n` +
            `throw new Error("boom");\n` +
            `Serializable({ typeName: "ScriptReg4.Broken" })(class extends Behaviour {});\n`;
        const scenario = await loaded({
            "scripts/main.js": entryCode("dw-1-4"),
            "scripts/library/Broken.js": broken,
            "scripts/library/Good.js": spinCode("ScriptReg4.Good"),
        }, ["ScriptReg4.Broken", "ScriptReg4.Good"]);

        await scenario.run();

        expect(error).toHaveBeenCalledTimes(1);
        const message = error.mock.calls[0][0] as string;
        expect(message).toMatch(/^\[Scenario\] Script "scripts\/library\/Broken\.js" failed to load: /);
        expect(message).toContain("boom");

        expect(scenario.isRunning).toBe(true);
        const missing = holder().getComponent(MissingComponent)!;
        expect(missing).toBeInstanceOf(MissingComponent);
        expect(missing.originalType).toBe("ScriptReg4.Broken");
        // The healthy sibling script still registered and resolved.
        const goodCtor = TypeRegistry.get("ScriptReg4.Good");
        expect(holder().getComponent(goodCtor!)).toBeInstanceOf(goodCtor!);
    });
});
