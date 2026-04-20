import { describe, test, expect, beforeEach, vi } from "vitest";
import { Plugin } from "../src/engine/core/plugins/Plugin";
import { PluginManager } from "../src/engine/core/plugins/PluginManager";

class TestPlugin extends Plugin {
    public readonly name: string;
    public calls: string[] = [];

    constructor(name: string) {
        super();
        this.name = name;
    }

    protected override onRegister(): void { this.calls.push("register"); }
    protected override onUnregister(): void { this.calls.push("unregister"); }
    protected override onUpdate(dt: number): void { this.calls.push(`update:${dt}`); }
    protected override onFixedUpdate(dt: number): void { this.calls.push(`fixed:${dt}`); }
    protected override onLateUpdate(dt: number): void { this.calls.push(`late:${dt}`); }
}

describe("PluginManager", () => {
    beforeEach(() => PluginManager._reset());

    test("register adds a plugin and fires onRegister", () => {
        const p = new TestPlugin("A");
        PluginManager.register(p);
        expect(PluginManager.count).toBe(1);
        expect(PluginManager.has("A")).toBe(true);
        expect(PluginManager.get<TestPlugin>("A")).toBe(p);
        expect(p.calls).toEqual(["register"]);
    });

    test("throws on duplicate name", () => {
        PluginManager.register(new TestPlugin("Dup"));
        expect(() => PluginManager.register(new TestPlugin("Dup")))
            .toThrow(/already registered/);
    });

    test("unregister fires onUnregister and removes plugin", () => {
        const p = new TestPlugin("B");
        PluginManager.register(p);
        PluginManager.unregister("B");
        expect(PluginManager.count).toBe(0);
        expect(PluginManager.has("B")).toBe(false);
        expect(p.calls).toEqual(["register", "unregister"]);
    });

    test("unregister missing plugin is a no-op", () => {
        expect(() => PluginManager.unregister("nothing")).not.toThrow();
    });

    test("_onUpdate dispatches to all plugins in order", () => {
        const a = new TestPlugin("A");
        const b = new TestPlugin("B");
        PluginManager.register(a);
        PluginManager.register(b);
        PluginManager._onUpdate(0.016);
        expect(a.calls).toContain("update:0.016");
        expect(b.calls).toContain("update:0.016");
    });

    test("_onFixedUpdate and _onLateUpdate both dispatch", () => {
        const p = new TestPlugin("C");
        PluginManager.register(p);
        PluginManager._onFixedUpdate(0.02);
        PluginManager._onLateUpdate(0.016);
        expect(p.calls).toEqual(["register", "fixed:0.02", "late:0.016"]);
    });

    test("_reset unregisters every plugin", () => {
        PluginManager.register(new TestPlugin("X"));
        PluginManager.register(new TestPlugin("Y"));
        PluginManager._reset();
        expect(PluginManager.count).toBe(0);
        expect(PluginManager.has("X")).toBe(false);
    });

    test("onRegister errors do not prevent registration", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        class Bad extends Plugin {
            public readonly name = "Bad";
            protected override onRegister(): void { throw new Error("boom"); }
        }
        PluginManager.register(new Bad());
        expect(PluginManager.has("Bad")).toBe(true);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test("onUpdate errors are isolated per plugin", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        class Bad extends Plugin {
            public readonly name = "Bad";
            protected override onUpdate(): void { throw new Error("boom"); }
        }
        const good = new TestPlugin("Good");
        PluginManager.register(new Bad());
        PluginManager.register(good);
        PluginManager._onUpdate(0.01);
        expect(good.calls).toContain("update:0.01");
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test("plugins is registration-ordered", () => {
        const a = new TestPlugin("1");
        const b = new TestPlugin("2");
        const c = new TestPlugin("3");
        PluginManager.register(a);
        PluginManager.register(b);
        PluginManager.register(c);
        expect(PluginManager.plugins.map(p => p.name)).toEqual(["1", "2", "3"]);
    });
});
