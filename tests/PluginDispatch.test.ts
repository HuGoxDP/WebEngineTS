import { describe, test, expect, afterEach } from "vitest";
import { PluginManager } from "../src/engine/core/plugins/PluginManager";
import { Plugin } from "../src/engine/core/plugins/Plugin";

/**
 * The dispatch loops walked the plugin list directly. A plugin that
 * unregisters itself from its own update — how a one-shot plugin ends —
 * spliced that list mid-iteration, and the plugin registered after it was
 * skipped for that frame. `UIEvent.invoke` snapshots for exactly this reason.
 * Audit part 10, F63.
 */

class Recorder extends Plugin {
    public updates = 0;
    public fixed = 0;
    public late = 0;

    constructor(public readonly pluginName: string) { super(); }
    public override get name(): string { return this.pluginName; }

    protected override onUpdate(): void { this.updates++; }
    protected override onFixedUpdate(): void { this.fixed++; }
    protected override onLateUpdate(): void { this.late++; }
}

/** Unregisters itself the first time it updates. */
class SelfRemoving extends Recorder {
    protected override onUpdate(): void {
        super.onUpdate();
        PluginManager.unregister(this.name);
    }
}

afterEach(() => PluginManager._reset());

describe("Plugin dispatch", () => {
    test("reaches every plugin", () => {
        const a = new Recorder("a");
        const b = new Recorder("b");
        PluginManager.register(a);
        PluginManager.register(b);

        PluginManager._onUpdate(1 / 60);

        expect(a.updates).toBe(1);
        expect(b.updates).toBe(1);
    });

    test("a plugin unregistering itself does not skip the next one", () => {
        const first = new SelfRemoving("first");
        const second = new Recorder("second");
        PluginManager.register(first);
        PluginManager.register(second);

        PluginManager._onUpdate(1 / 60);

        expect(first.updates).toBe(1);
        expect(second.updates).toBe(1);
    });

    test("and is gone from the next frame", () => {
        const first = new SelfRemoving("first");
        const second = new Recorder("second");
        PluginManager.register(first);
        PluginManager.register(second);

        PluginManager._onUpdate(1 / 60);
        PluginManager._onUpdate(1 / 60);

        expect(first.updates).toBe(1);
        expect(second.updates).toBe(2);
        expect(PluginManager.has("first")).toBe(false);
    });

    test("the fixed and late loops behave the same", () => {
        const a = new Recorder("a");
        const b = new Recorder("b");
        PluginManager.register(a);
        PluginManager.register(b);

        PluginManager._onFixedUpdate(1 / 60);
        PluginManager._onLateUpdate(1 / 60);

        expect(a.fixed).toBe(1);
        expect(b.late).toBe(1);
    });

    test("a plugin that throws does not stop the others", () => {
        // Already true, and worth keeping true: this is the isolation the
        // component loops do not have (F22).
        class Thrower extends Recorder {
            protected override onUpdate(): void {
                super.onUpdate();
                throw new Error("plugin went wrong");
            }
        }
        const bad = new Thrower("bad");
        const good = new Recorder("good");
        PluginManager.register(bad);
        PluginManager.register(good);

        expect(() => PluginManager._onUpdate(1 / 60)).not.toThrow();

        expect(good.updates).toBe(1);
    });

    test("registering during a dispatch does not run the newcomer twice", () => {
        // The snapshot is taken before the loop, so a plugin added mid-frame
        // starts on the next one — the same rule UIEvent applies to listeners.
        const late = new Recorder("late");
        class Adder extends Recorder {
            protected override onUpdate(): void {
                super.onUpdate();
                if (!PluginManager.has("late")) PluginManager.register(late);
            }
        }
        PluginManager.register(new Adder("adder"));

        PluginManager._onUpdate(1 / 60);

        expect(late.updates).toBe(0);
    });
});
