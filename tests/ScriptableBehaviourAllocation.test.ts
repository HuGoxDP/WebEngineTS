import { describe, test, expect, afterAll } from "vitest";
import v8 from "node:v8";
import vm from "node:vm";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";

/**
 * M0.3e. `ScriptableBehaviour._guard` wrapped every Update / LateUpdate / FixedUpdate in an arrow function, one
 * closure per script per phase per frame — against the engine's zero-allocation rule. The three entry points now call
 * their body directly inside their own try/catch.
 *
 * TurboFan escape-analyses a closure like that away once the caller is hot, so a warmed-up run cannot see the
 * regression. The test therefore switches the optimizing compilers off for the measurement (runtime V8 flags, no
 * process flags needed) and counts bytes per callback: before the change ~224 B, after ~128 B, where the remainder is
 * the interpreter's own cost of the walk, not the guard. The threshold sits between the two.
 */

class Noop extends ScriptableBehaviour {
    public override fixedUpdate(): void { /* nothing */ }
    public override update(): void { /* nothing */ }
    public override lateUpdate(): void { /* nothing */ }
}

describe("ScriptableBehaviour per-frame callbacks do not allocate a closure", () => {
    const made: GameObject[] = [];
    afterAll(() => { for (const go of made) go.destroyImmediate(); });

    test("bytes per callback stay below the closure-per-callback level", () => {
        v8.setFlagsFromString("--expose-gc");
        const gc = vm.runInNewContext("gc") as () => void;
        v8.setFlagsFromString("--no-opt");
        v8.setFlagsFromString("--no-maglev");

        const scripts = 2000;
        for (let i = 0; i < scripts; i++) {
            const go = new GameObject("n");
            go.addComponent(Noop);
            made.push(go);
        }
        const scene = SceneManager.activeScene;
        const frame = (): void => { scene._fixedUpdate(); scene._update(); scene._lateUpdate(); };

        frame(); // Start() runs here, and lazy compilation of the paths below
        frame();

        const frames = 3;
        const samples: number[] = [];
        for (let rep = 0; rep < 3; rep++) {
            gc();
            const before = process.memoryUsage().heapUsed;
            for (let f = 0; f < frames; f++) frame();
            samples.push(process.memoryUsage().heapUsed - before);
        }
        const perCallback = Math.min(...samples) / (scripts * 3 * frames);
        expect(perCallback).toBeLessThan(170);
    });
});
