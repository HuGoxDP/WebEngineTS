import { describe, test, expect, beforeEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Color } from "../src/engine/core/math/Color";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import { SceneSerializer } from "../src/engine/core/serialization/SceneSerializer";
import { Prefab } from "../src/engine/core/serialization/Prefab";

@Serializable()
class TestScript extends Behaviour {
    @SerializedField()
    public speed: number = 5;

    @SerializedField()
    public label: string = "default";

    @SerializedField()
    public active: boolean = true;

    @SerializedField({ type: FieldType.Vector3 })
    public offset: Vector3 = new Vector3(0, 0, 0);

    @SerializedField({ type: FieldType.Color })
    public tint: Color = new Color(1, 1, 1, 1);

    public notSerialized: number = 99;
}

@Serializable()
class AnotherScript extends Behaviour {
    @SerializedField()
    public value: number = 0;
}

function destroyScene(): void {
    // Crude cleanup: destroy every root so each test starts clean.
    const scene = SceneManager.activeScene;
    for (const root of [...scene.getRootGameObjects()]) {
        root.destroy();
    }
}

describe("SceneSerializer — GameObject round trip", () => {
    beforeEach(() => destroyScene());

    test("serializes a minimal GameObject", () => {
        const go = new GameObject("Player");
        const json = SceneSerializer.serializeGameObject(go);
        expect(json.name).toBe("Player");
        expect(json.active).toBe(true);
        expect(json.components).toEqual([]);
        expect(json.children).toEqual([]);
    });

    test("round-trips transform position / rotation / scale", () => {
        const go = new GameObject("Box");
        go.transform.localPosition = new Vector3(1, 2, 3);
        go.transform.localScale    = new Vector3(2, 2, 2);

        const json = SceneSerializer.serializeGameObject(go);
        destroyScene();

        const restored = SceneSerializer.deserializeGameObject(json);
        expect(restored.name).toBe("Box");
        expect(restored.transform.localPosition.x).toBeCloseTo(1);
        expect(restored.transform.localPosition.y).toBeCloseTo(2);
        expect(restored.transform.localPosition.z).toBeCloseTo(3);
        expect(restored.transform.localScale.x).toBeCloseTo(2);
    });

    test("round-trips a component with primitive and compound fields", () => {
        const go = new GameObject("Unit");
        const s = go.addComponent(TestScript);
        s.speed = 12;
        s.label = "sniper";
        s.active = false;
        s.offset = new Vector3(4, 5, 6);
        s.tint = new Color(0.5, 0.25, 0.75, 1);
        s.notSerialized = 1234;  // must NOT round-trip

        const json = SceneSerializer.serializeGameObject(go);
        destroyScene();

        const restored = SceneSerializer.deserializeGameObject(json);
        const rs = restored.getComponent(TestScript)!;
        expect(rs).toBeDefined();
        expect(rs.speed).toBe(12);
        expect(rs.label).toBe("sniper");
        expect(rs.active).toBe(false);
        expect(rs.offset.x).toBe(4);
        expect(rs.offset.y).toBe(5);
        expect(rs.offset.z).toBe(6);
        expect(rs.tint.r).toBeCloseTo(0.5);
        expect(rs.tint.a).toBeCloseTo(1);
        // Default applied — not persisted.
        expect(rs.notSerialized).toBe(99);
    });

    test("skips components that are not @Serializable", () => {
        class UnregisteredScript extends Behaviour {
            public foo: number = 1;
        }
        const go = new GameObject("Ghost");
        go.addComponent(UnregisteredScript);

        const json = SceneSerializer.serializeGameObject(go);
        expect(json.components).toEqual([]);
    });

    test("recursively serializes a parent / child hierarchy", () => {
        const parent = new GameObject("Parent");
        const childA = new GameObject("A");
        const childB = new GameObject("B");
        childA.transform.parent = parent.transform;
        childB.transform.parent = parent.transform;

        parent.addComponent(TestScript).speed = 7;
        childA.addComponent(AnotherScript).value = 11;

        const json = SceneSerializer.serializeGameObject(parent);
        destroyScene();

        const restored = SceneSerializer.deserializeGameObject(json);
        expect(restored.transform.childCount).toBe(2);
        const rA = restored.transform.getChild(0).gameObject;
        const rB = restored.transform.getChild(1).gameObject;
        expect(rA.name).toBe("A");
        expect(rB.name).toBe("B");
        expect(restored.getComponent(TestScript)!.speed).toBe(7);
        expect(rA.getComponent(AnotherScript)!.value).toBe(11);
    });
});

describe("SceneSerializer — Scene round trip", () => {
    beforeEach(() => destroyScene());

    test("serializes the whole scene and reconstructs every root", () => {
        const a = new GameObject("A");
        const b = new GameObject("B");
        a.addComponent(TestScript).speed = 10;
        b.addComponent(AnotherScript).value = 99;

        const json = SceneSerializer.serializeScene(SceneManager.activeScene);
        expect(json.roots.length).toBe(2);

        destroyScene();

        const restored = SceneSerializer.deserializeScene(json);
        expect(restored.length).toBe(2);
        expect(restored[0].getComponent(TestScript)!.speed).toBe(10);
        expect(restored[1].getComponent(AnotherScript)!.value).toBe(99);
    });

    test("version marker is present", () => {
        const json = SceneSerializer.serializeScene(SceneManager.activeScene);
        expect(json.version).toBe(1);
    });
});

describe("Prefab — instantiate multiple copies", () => {
    beforeEach(() => destroyScene());

    test("fromGameObject + instantiate produces an independent copy", () => {
        const original = new GameObject("Enemy");
        const script = original.addComponent(TestScript);
        script.speed = 8;
        script.offset = new Vector3(1, 2, 3);

        const prefab = Prefab.fromGameObject(original);

        // Mutate the original — copies should not be affected.
        script.speed = 999;

        const copy = prefab.instantiate();
        const cs = copy.getComponent(TestScript)!;
        expect(cs.speed).toBe(8);
        expect(cs.offset.x).toBe(1);
        // Copies are independent objects, not the same reference.
        expect(copy).not.toBe(original);
        expect(cs.offset).not.toBe(script.offset);
    });

    test("multiple instantiations produce distinct GameObjects", () => {
        const template = new GameObject("Bullet");
        template.addComponent(TestScript);
        const prefab = Prefab.fromGameObject(template);

        const a = prefab.instantiate();
        const b = prefab.instantiate();
        const c = prefab.instantiate();
        expect(a).not.toBe(b);
        expect(b).not.toBe(c);
        expect(a.getComponent(TestScript)).not.toBe(b.getComponent(TestScript));
    });

    test("Prefab toJSON / fromJSON round-trips", () => {
        const src = new GameObject("Coin");
        src.addComponent(TestScript).label = "gold";
        const prefab = Prefab.fromGameObject(src);

        const json = prefab.toJSON();
        const restored = Prefab.fromJSON(json);
        const copy = restored.instantiate();
        expect(copy.getComponent(TestScript)!.label).toBe("gold");
    });

    test("prefab preserves children hierarchy", () => {
        const root = new GameObject("Vehicle");
        const wheelL = new GameObject("WheelL");
        const wheelR = new GameObject("WheelR");
        wheelL.transform.parent = root.transform;
        wheelR.transform.parent = root.transform;

        const prefab = Prefab.fromGameObject(root);
        destroyScene();

        const copy = prefab.instantiate();
        expect(copy.transform.childCount).toBe(2);
        expect(copy.transform.getChild(0).gameObject.name).toBe("WheelL");
        expect(copy.transform.getChild(1).gameObject.name).toBe("WheelR");
    });

    test("prefab name defaults to source GameObject name", () => {
        const go = new GameObject("Tree");
        const prefab = Prefab.fromGameObject(go);
        expect(prefab.name).toBe("Tree");
    });
});

