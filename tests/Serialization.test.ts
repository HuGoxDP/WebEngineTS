import { describe, test, expect, beforeEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Color } from "../src/engine/core/math/Color";
import { Rect } from "../src/engine/core/math/Rect";
import { Bounds } from "../src/engine/core/math/Bounds";
import { TypeRegistry } from "../src/engine/core/reflection/TypeRegistry";
import { Camera, CameraClearFlags } from "../src/engine/core/components/Camera";
import { LightShadows, LightShadowResolution } from "../src/engine/core/components/Light";
import { DirectionalLight } from "../src/engine/core/components/DirectionalLight";
import { PointLight } from "../src/engine/core/components/PointLight";
import { SpotLight } from "../src/engine/core/components/SpotLight";
import { AmbientLight } from "../src/engine/core/components/AmbientLight";
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

@Serializable()
class FollowTarget extends Behaviour {
    @SerializedField({ type: FieldType.GameObject })
    public target: GameObject | null = null;

    @SerializedField()
    public weight: number = 1;
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

describe("SceneSerializer — GameObject cross-references (Phase 11b)", () => {
    beforeEach(() => destroyScene());

    test("scene round-trip preserves a sibling GameObject reference", () => {
        const camera = new GameObject("Camera");
        const player = new GameObject("Player");
        const follow = player.addComponent(FollowTarget);
        follow.target = camera;
        follow.weight = 2.5;

        const json = SceneSerializer.serializeScene(SceneManager.activeScene);
        destroyScene();

        const restored = SceneSerializer.deserializeScene(json);
        const restoredCamera = restored.find(g => g.name === 'Camera')!;
        const restoredPlayer = restored.find(g => g.name === 'Player')!;
        const ft = restoredPlayer.getComponent(FollowTarget)!;
        expect(ft.target).toBe(restoredCamera);
        expect(ft.weight).toBe(2.5);
    });

    test("reference to a child GameObject round-trips", () => {
        const root = new GameObject("Vehicle");
        const wheel = new GameObject("Wheel");
        wheel.transform.parent = root.transform;
        const ft = root.addComponent(FollowTarget);
        ft.target = wheel;

        const json = SceneSerializer.serializeScene(SceneManager.activeScene);
        destroyScene();

        const restored = SceneSerializer.deserializeScene(json);
        const restoredRoot  = restored[0];
        const restoredWheel = restoredRoot.transform.getChild(0).gameObject;
        expect(restoredRoot.getComponent(FollowTarget)!.target).toBe(restoredWheel);
    });

    test("null reference round-trips as null", () => {
        const go = new GameObject("Empty");
        const ft = go.addComponent(FollowTarget);
        ft.target = null;

        const json = SceneSerializer.serializeScene(SceneManager.activeScene);
        destroyScene();

        const restored = SceneSerializer.deserializeScene(json);
        expect(restored[0].getComponent(FollowTarget)!.target).toBe(null);
    });

    test("reference outside the serialized subtree drops to null", () => {
        // Serializing only a sub-tree means outside refs can't resolve.
        const camera = new GameObject("Camera");
        const player = new GameObject("Player");
        player.addComponent(FollowTarget).target = camera;

        const playerJson = SceneSerializer.serializeGameObject(player);
        destroyScene();

        const restored = SceneSerializer.deserializeGameObject(playerJson);
        expect(restored.getComponent(FollowTarget)!.target).toBe(null);
    });
});


// ---------------------------------------------------------------------------
// Serializer foundations for built-in components (unity-parity Stage 1)
// ---------------------------------------------------------------------------

@Serializable({ typeName: "Test.RectAndBounds" })
class RectBoundsScript extends Behaviour {
    @SerializedField({ type: FieldType.Rect })
    public viewport: Rect = new Rect(0, 0, 1, 1);

    @SerializedField({ type: FieldType.Bounds })
    public box: Bounds = new Bounds(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
}

@Serializable({ typeName: "Test.ReadonlyCompound" })
class ReadonlyCompoundScript extends Behaviour {
    @SerializedField({ type: FieldType.Color })
    public readonly tint: Color = new Color(1, 1, 1, 1);

    @SerializedField({ type: FieldType.Vector3 })
    public readonly offset: Vector3 = new Vector3(0, 0, 0);
}

describe("ValueSerializer — Rect and Bounds", () => {
    beforeEach(destroyScene);

    test("a Rect field round-trips", () => {
        const go = new GameObject("Cam");
        const script = go.addComponent(RectBoundsScript);
        script.viewport.set(0.25, 0.5, 0.5, 0.25);

        const restored = SceneSerializer.deserializeGameObject(
            SceneSerializer.serializeGameObject(go),
        );
        const back = restored.getComponent(RectBoundsScript)!;

        expect(back.viewport.x).toBeCloseTo(0.25);
        expect(back.viewport.y).toBeCloseTo(0.5);
        expect(back.viewport.width).toBeCloseTo(0.5);
        expect(back.viewport.height).toBeCloseTo(0.25);
    });

    test("a Bounds field round-trips its centre and size", () => {
        const go = new GameObject("Collider");
        const script = go.addComponent(RectBoundsScript);
        script.box = new Bounds(new Vector3(1, 2, 3), new Vector3(4, 6, 8));

        const restored = SceneSerializer.deserializeGameObject(
            SceneSerializer.serializeGameObject(go),
        );
        const back = restored.getComponent(RectBoundsScript)!;

        expect(back.box.center.x).toBeCloseTo(1);
        expect(back.box.center.y).toBeCloseTo(2);
        expect(back.box.center.z).toBeCloseTo(3);
        expect(back.box.size.x).toBeCloseTo(4);
        expect(back.box.size.y).toBeCloseTo(6);
        expect(back.box.size.z).toBeCloseTo(8);
    });
});

describe("SceneSerializer — compound fields are written in place", () => {
    beforeEach(destroyScene);

    test("a readonly compound field keeps its instance and takes the values", () => {
        const go = new GameObject("Styled");
        const script = go.addComponent(ReadonlyCompoundScript);
        script.tint.set(0.25, 0.5, 0.75, 0.5);
        script.offset.set(7, 8, 9);

        const json = SceneSerializer.serializeGameObject(go);
        const restored = SceneSerializer.deserializeGameObject(json);
        const back = restored.getComponent(ReadonlyCompoundScript)!;

        // The instance the constructor created is still the one in the field...
        const instance = back.tint;
        expect(back.tint).toBe(instance);
        // ...and it carries the loaded values.
        expect(back.tint.r).toBeCloseTo(0.25);
        expect(back.tint.a).toBeCloseTo(0.5);
        expect(back.offset.x).toBeCloseTo(7);
        expect(back.offset.z).toBeCloseTo(9);
    });

    test("an aliased reference to the field sees the loaded values", () => {
        const go = new GameObject("Styled");
        const script = go.addComponent(ReadonlyCompoundScript);
        script.offset.set(1, 1, 1);
        const json = SceneSerializer.serializeGameObject(go);

        const restored = SceneSerializer.deserializeGameObject(json);
        const back = restored.getComponent(ReadonlyCompoundScript)!;

        // What a cached snapshot or a layout group would have grabbed.
        const alias = back.offset;
        expect(alias.x).toBeCloseTo(1);
        expect(alias).toBe(back.offset);
    });

    test("a null field still assigns rather than copying", () => {
        const go = new GameObject("Follower");
        go.addComponent(FollowTarget);

        const restored = SceneSerializer.deserializeGameObject(
            SceneSerializer.serializeGameObject(go),
        );

        expect(restored.getComponent(FollowTarget)!.target).toBeNull();
    });
});

describe("TypeRegistry — stable names", () => {
    test("an explicit typeName is what lands in the JSON", () => {
        const go = new GameObject("Named");
        go.addComponent(RectBoundsScript);

        const json = SceneSerializer.serializeGameObject(go);

        expect(json.components[0].type).toBe("Test.RectAndBounds");
    });

    test("registering a second class under one name is refused, not silently accepted", () => {
        const errors: unknown[] = [];
        const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a); });

        class Impostor extends Behaviour {}
        Serializable({ typeName: "Test.RectAndBounds" })(Impostor as any);

        expect(errors.length).toBe(1);
        // The original class still owns the name.
        expect(TypeRegistry.get("Test.RectAndBounds")).toBe(RectBoundsScript as any);
        spy.mockRestore();
    });

    test("re-registering the same class is not an error", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});

        Serializable({ typeName: "Test.RectAndBounds" })(RectBoundsScript as any);

        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// Built-in components round-trip (unity-parity Stage 1)
// ---------------------------------------------------------------------------

describe("Built-in components — Camera", () => {
    beforeEach(destroyScene);

    /** Saves and reloads `go`, returning the rebuilt copy. */
    function roundTrip(go: GameObject): GameObject {
        return SceneSerializer.deserializeGameObject(SceneSerializer.serializeGameObject(go));
    }

    test("a Camera survives save and load", () => {
        const go = new GameObject("Main Camera");
        const cam = go.addComponent(Camera);
        cam.fieldOfView = 42;
        cam.nearClipPlane = 0.7;
        cam.farClipPlane = 900;
        cam.depth = 3;
        cam.backgroundColor = new Color(0.1, 0.2, 0.3, 1);
        cam.viewport = new Rect(0.1, 0.2, 0.5, 0.6);
        cam.clearFlags = CameraClearFlags.Depth;

        const back = roundTrip(go).getComponent(Camera)!;

        expect(back).not.toBeNull();
        expect(back.fieldOfView).toBeCloseTo(42);
        expect(back.nearClipPlane).toBeCloseTo(0.7);
        expect(back.farClipPlane).toBeCloseTo(900);
        expect(back.depth).toBe(3);
        expect(back.clearFlags).toBe(CameraClearFlags.Depth);
    });

    test("a cloning accessor still receives its value", () => {
        // Camera.backgroundColor and .viewport hand back a clone on every read,
        // so the loader must assign rather than copy into what it read.
        const go = new GameObject("Cam");
        const cam = go.addComponent(Camera);
        cam.backgroundColor = new Color(0.25, 0.5, 0.75, 1);
        cam.viewport = new Rect(0.25, 0.25, 0.5, 0.5);

        const back = roundTrip(go).getComponent(Camera)!;

        expect(back.backgroundColor.r).toBeCloseTo(0.25);
        expect(back.backgroundColor.b).toBeCloseTo(0.75);
        expect(back.viewport.x).toBeCloseTo(0.25);
        expect(back.viewport.width).toBeCloseTo(0.5);
    });

    test("an orthographic camera stays orthographic", () => {
        const go = new GameObject("Ortho");
        const cam = go.addComponent(Camera);
        cam.orthographic = true;
        cam.orthographicSize = 12;

        const back = roundTrip(go).getComponent(Camera)!;

        expect(back.orthographic).toBe(true);
        expect(back.orthographicSize).toBeCloseTo(12);
    });
});

describe("Built-in components — lights", () => {
    beforeEach(destroyScene);

    function roundTrip(go: GameObject): GameObject {
        return SceneSerializer.deserializeGameObject(SceneSerializer.serializeGameObject(go));
    }

    test("a DirectionalLight keeps its own fields and the ones it inherits", () => {
        const go = new GameObject("Sun");
        const light = go.addComponent(DirectionalLight);
        light.color = new Color(1, 0.9, 0.8, 1);
        light.intensity = 2.5;
        light.shadowDistance = 75;

        const back = roundTrip(go).getComponent(DirectionalLight)!;

        expect(back.intensity).toBeCloseTo(2.5);
        expect(back.shadowDistance).toBeCloseTo(75);
        expect(back.color.g).toBeCloseTo(0.9);
    });

    test("a PointLight round-trips range and decay", () => {
        const go = new GameObject("Lamp");
        const light = go.addComponent(PointLight);
        light.range = 17;
        light.decay = 1.5;

        const back = roundTrip(go).getComponent(PointLight)!;

        expect(back.range).toBeCloseTo(17);
        expect(back.decay).toBeCloseTo(1.5);
    });

    test("a SpotLight round-trips its cone", () => {
        const go = new GameObject("Spot");
        const light = go.addComponent(SpotLight);
        light.spotAngle = 45;
        light.innerSpotAngle = 20;

        const back = roundTrip(go).getComponent(SpotLight)!;

        expect(back.spotAngle).toBeCloseTo(45);
        expect(back.innerSpotAngle).toBeCloseTo(20);
    });

    test("each light type reloads as its own class, not the base", () => {
        const go = new GameObject("Rig");
        go.addComponent(AmbientLight);
        const child = new GameObject("Child");
        child.transform.parent = go.transform;
        child.addComponent(PointLight);

        const back = roundTrip(go);

        expect(back.getComponent(AmbientLight)).not.toBeNull();
        expect(back.transform.getChild(0).gameObject.getComponent(PointLight)).not.toBeNull();
    });

    test("shadow settings survive as enums", () => {
        const go = new GameObject("Sun");
        const light = go.addComponent(DirectionalLight);
        light.shadows = LightShadows.Soft;
        light.shadowResolution = LightShadowResolution.High;
        light.shadowBias = 0.007;

        const back = roundTrip(go).getComponent(DirectionalLight)!;

        expect(back.shadows).toBe(LightShadows.Soft);
        expect(back.shadowResolution).toBe(LightShadowResolution.High);
        expect(back.shadowBias).toBeCloseTo(0.007);
    });
});
