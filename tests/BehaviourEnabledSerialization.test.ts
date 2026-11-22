import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { EngineObject } from "../src/engine/core/EngineObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Serializable, getAllFields } from "../src/engine/core/reflection/Decorators";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { PointLight } from "../src/engine/core/components/PointLight";
import { BloomEffect } from "../src/engine/core/postprocessing/BloomEffect";
import { SceneSerializer, type SerializedGameObject } from "../src/engine/core/serialization/SceneSerializer";

/**
 * SER1: `Behaviour.enabled` is serialized (D-1).
 *
 * A component switched off in the editor used to come back on after a
 * save/load, an `Instantiate` or a prefab use, because nothing wrote its
 * `enabled`. The field is now always saved — hidden from the inspector, as
 * Unity keeps `m_Enabled` out of the field list — and loaded before `awake`,
 * so a disabled script wakes once and never gets `onEnable` until it is
 * switched on. A file written before the field existed has no `enabled` key
 * and reads as the default, `true`, without touching the setter.
 */

@Serializable({ typeName: "EnabledSpec.Script" })
class EnabledScript extends ScriptableBehaviour {}

/** Counts the lifecycle callbacks of one loaded instance. */
@Serializable({ typeName: "EnabledSpec.Counter" })
class Counter extends ScriptableBehaviour {
    public awakeCalls = 0;
    public enableCalls = 0;
    public disableCalls = 0;
    public override awake(): void { this.awakeCalls++; }
    public override onEnable(): void { this.enableCalls++; }
    public override onDisable(): void { this.disableCalls++; }
}

function destroyScene(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

/** One object holding one of each Behaviour kind, plus an enabled twin of each. */
function kindsObject(): GameObject {
    const go = new GameObject("Kinds");
    go.addComponent(EnabledScript).enabled = false;
    go.addComponent(MeshRenderer).enabled = false;
    go.addComponent(BoxCollider).enabled = false;
    go.addComponent(PointLight).enabled = false;
    go.addComponent(EnabledScript).enabled = true;
    go.addComponent(MeshRenderer).enabled = true;
    go.addComponent(BoxCollider).enabled = true;
    go.addComponent(PointLight).enabled = true;
    return go;
}

function expectDisabledTwinsEnabled(go: GameObject): void {
    const scripts = go.getComponents(EnabledScript);
    expect(scripts.map(s => s.enabled)).toEqual([false, true]);
    const renderers = go.getComponents(MeshRenderer);
    expect(renderers.map(r => r.enabled)).toEqual([false, true]);
    const colliders = go.getComponents(BoxCollider);
    expect(colliders.map(c => c.enabled)).toEqual([false, true]);
    const lights = go.getComponents(PointLight);
    expect(lights.map(l => l.enabled)).toEqual([false, true]);
}

beforeEach(destroyScene);
afterEach(destroyScene);

describe("enabled as a field (DW-1.1)", () => {
    test("a Behaviour subclass carries enabled: serialized, hidden from the inspector", () => {
        const field = getAllFields(MeshRenderer).find(f => f.name === "enabled");
        expect(field).toBeDefined();
        expect(field!.serialize).toBe(true);
        expect(field!.hideInInspector).toBe(true);
    });

    test("every kind tested reads the same field from Behaviour", () => {
        for (const ctor of [EnabledScript, BoxCollider, PointLight]) {
            const field = getAllFields(ctor).find(f => f.name === "enabled");
            expect(field, ctor.name).toBeDefined();
            expect(field!.serialize, ctor.name).toBe(true);
            expect(field!.hideInInspector, ctor.name).toBe(true);
        }
    });

    test("a PostEffect keeps its own enabled, visible: it is not a Behaviour", () => {
        const field = getAllFields(BloomEffect).find(f => f.name === "enabled");
        expect(field).toBeDefined();
        expect(field!.serialize).toBe(true);
        expect(field!.hideInInspector).not.toBe(true);
    });
});

describe("save and load (DW-1.2)", () => {
    test("every disabled component comes back disabled; its enabled twin stays enabled", () => {
        const go = kindsObject();
        const json = SceneSerializer.serializeGameObject(go);

        // Always written: false for the switched-off four, true for their twins.
        const written = json.components.map(c => c.fields.enabled);
        expect(written).toEqual([false, false, false, false, true, true, true, true]);

        destroyScene();
        const back = SceneSerializer.deserializeGameObject(json);
        expectDisabledTwinsEnabled(back);
    });
});

describe("Instantiate (DW-1.3)", () => {
    test("a copy of a disabled component is disabled; its enabled twin stays enabled", () => {
        const go = kindsObject();
        const copy = EngineObject.Instantiate(go);
        expectDisabledTwinsEnabled(copy);
    });
});

describe("lifecycle of a loaded script (DW-1.4)", () => {
    function loadedCounter(disabled: boolean): Counter {
        const go = new GameObject("Counter");
        go.addComponent(Counter).enabled = !disabled;
        const json = SceneSerializer.serializeGameObject(go);
        destroyScene();
        return SceneSerializer.deserializeGameObject(json).getComponent(Counter)!;
    }

    test("loaded disabled: awake once, onEnable never; switching on enables once", () => {
        const c = loadedCounter(true);
        expect(c.enabled).toBe(false);
        expect([c.awakeCalls, c.enableCalls, c.disableCalls]).toEqual([1, 0, 0]);

        c.enabled = true;
        expect([c.awakeCalls, c.enableCalls, c.disableCalls]).toEqual([1, 1, 0]);
    });

    test("loaded enabled: awake once, onEnable once", () => {
        const c = loadedCounter(false);
        expect([c.awakeCalls, c.enableCalls, c.disableCalls]).toEqual([1, 1, 0]);
    });

    test("loaded disabled under an inactive parent: activation wakes it without enabling it", () => {
        const parent = new GameObject("Parent");
        const child = new GameObject("Child");
        child.transform.setParent(parent.transform, false);
        child.addComponent(Counter).enabled = false;
        parent.setActive(false);
        const json = SceneSerializer.serializeGameObject(parent);
        destroyScene();

        const back = SceneSerializer.deserializeGameObject(json);
        const c = back.transform.getChild(0).gameObject.getComponent(Counter)!;
        expect(c.enabled).toBe(false);
        // Nothing wakes under an inactive parent.
        expect([c.awakeCalls, c.enableCalls]).toEqual([0, 0]);

        back.setActive(true);
        expect([c.awakeCalls, c.enableCalls, c.disableCalls]).toEqual([1, 0, 0]);
    });
});

describe("an old file without enabled (DW-1.5)", () => {
    test("loads enabled, and the setter is never called", () => {
        const json: SerializedGameObject = {
            name: "Old",
            active: true,
            transform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                scale: { x: 1, y: 1, z: 1 },
            },
            components: [{ type: "EnabledSpec.Counter", fields: {} }],
            children: [],
        };
        const spy = vi.spyOn(Behaviour.prototype, "enabled", "set");
        try {
            const back = SceneSerializer.deserializeGameObject(json);
            const c = back.getComponent(Counter)!;
            expect(c.enabled).toBe(true);
            // The load skipped the absent key: the setter never ran. The
            // default wake still gives the script its awake and onEnable.
            expect(spy).not.toHaveBeenCalled();
            expect([c.awakeCalls, c.enableCalls]).toEqual([1, 1]);
        } finally {
            spy.mockRestore();
        }
    });
});