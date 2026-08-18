import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";

/**
 * One script's exception stopped every component after it in the frame, plus
 * the scenario, the animation, the particles, the UI layout and the input. F21
 * kept the engine's own state consistent through it; the frame was still cut
 * short at the first error. Audit F22, open since part 4.
 */

const made: GameObject[] = [];
const ran: string[] = [];

class Thrower extends ScriptableBehaviour {
    public label = "thrower";
    public throwIn: "update" | "lateUpdate" | "fixedUpdate" | "none" = "update";
    public override update(): void {
        ran.push(`update:${this.label}`);
        if (this.throwIn === "update") throw new Error("scenario code went wrong");
    }
    public override lateUpdate(): void {
        ran.push(`late:${this.label}`);
        if (this.throwIn === "lateUpdate") throw new Error("scenario code went wrong");
    }
    public override fixedUpdate(): void {
        ran.push(`fixed:${this.label}`);
        if (this.throwIn === "fixedUpdate") throw new Error("scenario code went wrong");
    }
}

class Quiet extends ScriptableBehaviour {
    public label = "quiet";
    public override update(): void { ran.push(`update:${this.label}`); }
    public override lateUpdate(): void { ran.push(`late:${this.label}`); }
    public override fixedUpdate(): void { ran.push(`fixed:${this.label}`); }
}

function object(name: string): GameObject {
    const go = new GameObject(name);
    made.push(go);
    return go;
}

/** One Update pass over the whole scene, as `Application._loop` runs it. */
function updateFrame(): void {
    SceneManager.activeScene._update();
}

beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    ScriptableBehaviour.isolateCallbackErrors = true;
    ScriptableBehaviour.callbackFailureLimit = 3;
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
    ran.length = 0;
});

describe("A script that throws", () => {
    test("does not stop the script after it", () => {
        const first = object("first").addComponent(Thrower);
        first.label = "first";
        const second = object("second").addComponent(Quiet);
        second.label = "second";

        updateFrame();

        expect(ran).toContain("update:first");
        expect(ran).toContain("update:second");
    });

    test("does not stop its own siblings on the same object", () => {
        const go = object("one-object");
        const thrower = go.addComponent(Thrower);
        thrower.label = "a";
        const quiet = go.addComponent(Quiet);
        quiet.label = "b";

        updateFrame();

        expect(ran).toEqual(["update:a", "update:b"]);
    });

    test("is logged, with the script, the object and the phase", () => {
        const go = object("Rig");
        go.addComponent(Thrower);

        updateFrame();

        const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
        const line = String(logged[0][0]);
        expect(line).toContain("Thrower");
        expect(line).toContain("Rig");
        expect(line).toContain("update()");
    });

    test("keeps running while it is only occasionally wrong", () => {
        // The failure counter is consecutive, so a script that recovers is not
        // punished for a bad frame earlier on.
        const t = object("flaky").addComponent(Thrower);

        for (let i = 0; i < 10; i++) {
            t.throwIn = i % 2 === 0 ? "update" : "none";
            updateFrame();
        }

        expect(t.enabled).toBe(true);
        expect(ran.filter(e => e.startsWith("update:"))).toHaveLength(10);
    });

    test("is disabled once it has failed the limit in a row", () => {
        const t = object("broken").addComponent(Thrower);

        updateFrame();
        updateFrame();
        expect(t.enabled).toBe(true);
        updateFrame();

        expect(t.enabled).toBe(false);
    });

    test("and says so, rather than going quiet", () => {
        const t = object("broken").addComponent(Thrower);

        for (let i = 0; i < 3; i++) updateFrame();

        const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
        const lines = logged.map(c => String(c[0]));
        expect(lines.some(l => l.includes("disabled after 3"))).toBe(true);
        expect(t.enabled).toBe(false);
    });

    test("stops running once disabled, so the log does not scroll forever", () => {
        const t = object("broken").addComponent(Thrower);

        for (let i = 0; i < 3; i++) updateFrame();
        const afterDisable = ran.length;
        for (let i = 0; i < 5; i++) updateFrame();

        expect(ran).toHaveLength(afterDisable);
    });

    test("a limit of zero lets it throw forever", () => {
        ScriptableBehaviour.callbackFailureLimit = 0;
        const t = object("stubborn").addComponent(Thrower);

        for (let i = 0; i < 20; i++) updateFrame();

        expect(t.enabled).toBe(true);
    });

    test("each script counts its own failures", () => {
        const a = object("a").addComponent(Thrower);
        const b = object("b").addComponent(Thrower);
        b.throwIn = "none";

        for (let i = 0; i < 3; i++) updateFrame();

        expect(a.enabled).toBe(false);
        expect(b.enabled).toBe(true);
    });

    test("the same treatment applies to lateUpdate", () => {
        const t = object("late").addComponent(Thrower);
        t.throwIn = "lateUpdate";
        const quiet = object("quiet").addComponent(Quiet);
        quiet.label = "q";

        SceneManager.activeScene._update();
        SceneManager.activeScene._lateUpdate();

        expect(ran).toContain("late:q");
    });

    test("and to fixedUpdate", () => {
        const t = object("fixed").addComponent(Thrower);
        t.throwIn = "fixedUpdate";
        const quiet = object("quiet").addComponent(Quiet);
        quiet.label = "q";

        SceneManager.activeScene._update();
        SceneManager.activeScene._fixedUpdate();

        expect(ran).toContain("fixed:q");
    });
});

describe("Isolation turned off", () => {
    test("gives back the hard stop, for debugging", () => {
        ScriptableBehaviour.isolateCallbackErrors = false;
        object("boom").addComponent(Thrower);

        expect(() => updateFrame()).toThrow("scenario code went wrong");
    });

    test("and does not count failures or disable anything", () => {
        ScriptableBehaviour.isolateCallbackErrors = false;
        const t = object("boom").addComponent(Thrower);

        for (let i = 0; i < 5; i++) {
            try { updateFrame(); } catch { /* expected */ }
        }

        expect(t.enabled).toBe(true);
    });
});

describe("A script that never throws", () => {
    test("is unaffected — same calls, same order", () => {
        const a = object("a").addComponent(Quiet);
        a.label = "a";
        const b = object("b").addComponent(Quiet);
        b.label = "b";

        updateFrame();
        updateFrame();

        expect(ran).toEqual(["update:a", "update:b", "update:a", "update:b"]);
        expect(console.error).not.toHaveBeenCalled();
    });
});
