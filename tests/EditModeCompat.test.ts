import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Application } from "../src/engine/core/Application";
import { Time } from "../src/engine/core/Time";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { ExecutionOrder, Serializable, SerializedField, ExecuteAlways, _resetExecutionOrders } from "../src/engine/core/reflection/Decorators";
import { WaitForSeconds } from "../src/engine/core/Coroutine";

/**
 * C2 Phase 5: the adversarial cases. Every one is a host doing something odd
 * from inside a callback, and every expectation is pinned: the switch must
 * leave the callbacks paired, must not recurse, and must not run a script the
 * gate kept asleep. Play mode is unaffected throughout.
 */

const clear = (): void => {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
};

let log: string[] = [];
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    clear();
    log = [];
    _resetExecutionOrders();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
    Application.enterPlayMode();
    clear();
});

@Serializable({ typeName: "CompatEdit.Live" })
class Live extends ScriptableBehaviour {
    public override awake(): void { log.push(`${this.gameObject.name}.awake`); }
    public override onEnable(): void { log.push(`${this.gameObject.name}.onEnable`); }
    public override update(): void { log.push(`${this.gameObject.name}.update`); }
    public override lateUpdate(): void { log.push(`${this.gameObject.name}.lateUpdate`); }
    public override onDisable(): void { log.push(`${this.gameObject.name}.onDisable`); }
    public override onDestroy(): void { log.push(`${this.gameObject.name}.onDestroy`); }
}

/** An awake that throws the engine into edit mode mid-wake-pass. */
@Serializable({ typeName: "CompatEdit.Switcher" })
class Switcher extends ScriptableBehaviour {
    public override awake(): void {
        log.push("switcher.awake");
        Application.enterEditMode();
        log.push(`switcher.enteredEdit isPlaying=${Application.isPlaying}`);
    }
    public override onEnable(): void { log.push("switcher.onEnable"); }
}

describe("switching modes from inside a callback", () => {
    test("an awake that enters edit mode mid-pass leaves every callback paired", () => {
        Application.enterEditMode();
        const first = new GameObject("First");
        first.addComponent(Switcher);
        const second = new GameObject("Second");
        second.addComponent(Live);
        log = [];

        Application.enterPlayMode();
        expect(log).toEqual([
            "switcher.awake",
            `switcher.enteredEdit isPlaying=${false}`,
            "switcher.onEnable",              // it woke, so its enable stands
        ]);
        // The script that had not woken yet stayed asleep, and nothing is
        // unpaired: `Second` has no onEnable, so its destroy owes no onDisable.
        expect(log).not.toContain("Second.onEnable");
        second.destroyImmediate();
        expect(log).not.toContain("Second.onDisable");
    });

    test("the half-woken world is reported, not silent", () => {
        Application.enterEditMode();
        new GameObject("First").addComponent(Switcher);
        new GameObject("Second").addComponent(Live);

        Application.enterPlayMode();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("re-entered edit mode during the wake pass"),
        );
        expect(Application.isPlaying).toBe(false);

        // A clean second switch completes the wake, and nothing wakes twice.
        log = [];
        Application.enterPlayMode();
        expect(log.filter(e => e.endsWith(".awake")).length).toBeGreaterThan(0);
        expect(log.filter(e => e === "Second.awake")).toHaveLength(1);
    });

    test("an opted-in update that enters play mode during an edit frame completes the frame", () => {
        @Serializable({ typeName: "CompatEdit.FrameSwitcher" })
        @ExecuteAlways()
        class FrameSwitcher extends ScriptableBehaviour {
            public switched = false;
            public override awake(): void { log.push("frame.awake"); }
            public override update(): void {
                log.push("frame.update");
                if (this.switched) return;              // once only
                this.switched = true;
                Application.enterPlayMode();
                log.push(`frame.inPlay isPlaying=${Application.isPlaying}`);
            }
            public override lateUpdate(): void { log.push("frame.lateUpdate"); }
        }

        Application.enterEditMode();
        new GameObject("Holder").addComponent(FrameSwitcher);

        Application.updateEditMode(1 / 60);
        expect(log).toEqual([
            "frame.awake", "frame.update", "frame.inPlay isPlaying=true", "frame.lateUpdate",
        ]);

        // The frame stopped at the switch, with a warning: the drivers that
        // follow belong to the play loop, not to an edit frame.
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("a callback entered play mode during this frame"),
        );

        // The rest of the frame ran with the clock reset, and a second frame in
        // play mode would belong to the Application loop — not to this call.
        log = [];
        SceneManager.activeScene._update();
        expect(log).toEqual(["frame.update"]);
    });

    test("a timed destroy in an edit frame counts down with the scaled clock", () => {
        const framesToDestroy = (): number => {
            const go = new GameObject("Holder");
            go.addComponent(Live);
            go.destroy(0.1);                  // 0.1 game seconds
            let frames = 0;
            while (go.exists() && frames < 60) { Application.updateEditMode(1 / 60); frames++; }
            return frames;
        };

        Application.enterEditMode();
        Time.timeScale = 0.5;
        const halfSpeed = framesToDestroy();
        Time.timeScale = 1;
        const fullSpeed = framesToDestroy();

        // Half the clock, twice the frames: the sweep is driven by
        // `Time.deltaTime`, not by the raw delta the host passed in.
        expect(halfSpeed).toBeGreaterThan(Math.floor(fullSpeed * 1.5));
        expect(halfSpeed).toBeLessThan(Math.ceil(fullSpeed * 2.5));
    });

    test("an awake that resets the clock does not stop the pass", () => {
        Application.enterEditMode();
        const holder = new GameObject("Holder");
        const a = holder.addComponent(Live); void a;
        holder.addComponent(Switcher);
        log = [];

        Application.enterPlayMode();
        expect(log.filter(e => e === "Holder.awake")).toHaveLength(1);
        expect(log).toContain("switcher.awake");
    });
});

describe("an opted-in script in edit mode", () => {
    test("its coroutine ticks in the edit frame, and a sleeping script's does not exist", () => {
        @Serializable({ typeName: "CompatEdit.Co" })
        @ExecuteAlways()
        class Co extends ScriptableBehaviour {
            public ticks = 0;
            public override awake(): void { log.push("co.awake"); }
            public override update(): void {
                log.push("co.update");
                if (this.ticks++ === 0) {
                    void this.startCoroutine((function* () {
                        yield new WaitForSeconds(0.2);
                        log.push("co.coroutine");
                    })());
                }
            }
        }

        @Serializable({ typeName: "CompatEdit.Quiet" })
        class Quiet extends ScriptableBehaviour {
            public override awake(): void { log.push("quiet.awake"); }
            public override update(): void {
                if (this._startedOnce === false) {
                    this._startedOnce = true;
                    void this.startCoroutine((function* () { log.push("quiet.coroutine"); })());
                }
                log.push("quiet.update");
            }
            private _startedOnce = false;
        }

        Application.enterEditMode();
        const co = new GameObject("Co").addComponent(Co);
        new GameObject("Quiet").addComponent(Quiet);
        expect(log).toEqual(["co.awake"]);

        Application.updateEditMode(1 / 60);
        expect(log.filter(e => e === "co.coroutine")).toHaveLength(0);
        // 0.2 game seconds at 1/60 per frame — thirteen frames, and every one
        // of them was driven by the edit frame.
        for (let i = 0; i < 13; i++) Application.updateEditMode(1 / 60);
        expect(log.filter(e => e === "co.coroutine")).toHaveLength(1);
        expect(co.exists()).toBe(true);
        expect(log).not.toContain("quiet.awake");
        expect(log).not.toContain("quiet.coroutine");
    });

    test("a sendMessage reaches a script the gate never woke — the host asked for it", () => {
        @Serializable({ typeName: "CompatEdit.Quiet2" })
        class Quiet extends ScriptableBehaviour {
            public override awake(): void { log.push("quiet.awake"); }
            public override onEnable(): void { log.push("quiet.onEnable"); }
            public pinged(): void { log.push(`quiet.pinged n=${this.n}`); }
            @SerializedField() public n = 5;
        }

        Application.enterEditMode();
        const go = new GameObject("Holder");
        go.addComponent(Quiet);
        expect(log).toEqual([]);

        go.sendMessage("pinged");
        expect(log).toEqual(["quiet.pinged n=5"]);   // Unity's rule, pinned

        SceneManager.activeScene._update();
        expect(log).toEqual(["quiet.pinged n=5"]);   // update still asleep
    });

    test("@ExecutionOrder and @ExecuteAlways together: the order holds in an edit frame", () => {
        @Serializable({ typeName: "CompatEdit.Early" })
        @ExecutionOrder(-100)
        @ExecuteAlways()
        class Early extends ScriptableBehaviour {
            public override update(): void { log.push("early"); }
        }

        @Serializable({ typeName: "CompatEdit.Normal" })
        @ExecuteAlways()
        class Normal extends ScriptableBehaviour {
            public override update(): void { log.push("normal"); }
        }

        Application.enterEditMode();
        const go = new GameObject("Holder");
        go.addComponent(Normal);
        go.addComponent(Early);

        Application.updateEditMode(1 / 60);
        expect(log).toEqual(["early", "normal"]);   // the declared order, per frame
        Application.updateEditMode(1 / 60);
        expect(log).toEqual(["early", "normal", "early", "normal"]);
    });

    test("a throw in an edit frame is contained to the script, isolateCallbackErrors on or off", () => {
        @Serializable({ typeName: "CompatEdit.Boom" })
        @ExecuteAlways()
        class Boom extends ScriptableBehaviour {
            public override update(): void { log.push("boom.update"); throw new Error("boom"); }
        }

        Application.enterEditMode();
        const go = new GameObject("Holder");
        go.addComponent(Boom);
        const other = go.addComponent(Live); void other;

        // Contained (the default): the frame ends, the script is skipped after
        // its failure limit; nothing else is disturbed.
        Application.updateEditMode(1 / 60);
        expect(log).toContain("boom.update");
        expect(error.mock.calls.some((c: unknown[]) => String(c[0]).includes("threw in update()"))).toBe(true);

        // Hard stop (isolateCallbackErrors = false): the throw reaches the caller.
        Application.enterPlayMode();
        ScriptableBehaviour.isolateCallbackErrors = false;
        Application.enterEditMode();
        log = [];
        expect(() => Application.updateEditMode(1 / 60)).toThrow("boom");
        ScriptableBehaviour.isolateCallbackErrors = true;
    });
});

describe("play mode is untouched by any of it", () => {
    test("a script that woke in play is not affected by an edit frame afterwards", () => {
        const go = new GameObject("Holder");
        go.addComponent(Live);
        expect(log).toEqual(["Holder.awake", "Holder.onEnable"]);

        SceneManager.activeScene._update();
        expect(log).toEqual(["Holder.awake", "Holder.onEnable", "Holder.update"]);

        // An edit frame in between ran nothing for it, and the mode switch
        // cost it no callback either.
        Application.enterEditMode();
        Application.updateEditMode(1 / 60);
        expect(log).toEqual(["Holder.awake", "Holder.onEnable", "Holder.update"]);

        Application.enterPlayMode();
        SceneManager.activeScene._update();
        expect(log).toEqual(["Holder.awake", "Holder.onEnable", "Holder.update", "Holder.update"]);
    });
});
