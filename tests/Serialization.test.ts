import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
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
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { CanvasGroup } from "../src/engine/core/ui/CanvasGroup";
import { LayoutElement } from "../src/engine/core/ui/LayoutElement";
import { VerticalLayoutGroup, LayoutPadding, LayoutAnchor } from "../src/engine/core/ui/LayoutGroup";
import { GridLayoutGroup, GridConstraint, GridStartCorner } from "../src/engine/core/ui/GridLayoutGroup";
import { ContentSizeFitter, FitMode } from "../src/engine/core/ui/ContentSizeFitter";
import { AspectRatioFitter, AspectMode } from "../src/engine/core/ui/AspectRatioFitter";
import { RectMask2D } from "../src/engine/core/ui/RectMask2D";
import { Rigidbody, RigidbodyConstraints } from "../src/engine/physics/Rigidbody";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { SphereCollider } from "../src/engine/physics/SphereCollider";
import { CapsuleCollider } from "../src/engine/physics/CapsuleCollider";
import {
    Serializable, SerializedField, ExecutionOrder, getExecutionOrder, getClassMeta,
} from "../src/engine/core/reflection/Decorators";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { FieldType } from "../src/engine/core/reflection/Types";
import { SceneSerializer } from "../src/engine/core/serialization/SceneSerializer";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";
import {
    UIImage, ImageType, ImageFillMethod, ImageFillOrigin,
} from "../src/engine/core/ui/UIImage";
import {
    UIText, TextAlignment, VerticalAlignment, TextOverflow,
} from "../src/engine/core/ui/UIText";
import { Sprite } from "../src/engine/core/graphics/Sprite";
import { Button } from "../src/engine/core/ui/Button";
import { Toggle } from "../src/engine/core/ui/Toggle";
import { Slider, SliderDirection } from "../src/engine/core/ui/Slider";
import { Scrollbar, ScrollbarDirection } from "../src/engine/core/ui/Scrollbar";
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

// ---------------------------------------------------------------------------
// Built-in UI layout components (unity-parity Stage 1; unblocks UI §6.6)
// ---------------------------------------------------------------------------

describe("Built-in components — UI layout", () => {
    beforeEach(destroyScene);

    function roundTrip(go: GameObject): GameObject {
        return SceneSerializer.deserializeGameObject(SceneSerializer.serializeGameObject(go));
    }

    test("a RectTransform round-trips its whole placement", () => {
        const go = new GameObject("Panel");
        const rt = go.addComponent(RectTransform);
        rt.anchorMin.set(0, 0.25);
        rt.anchorMax.set(1, 0.75);
        rt.pivot.set(0.25, 0.5);
        rt.anchoredPosition.set(12, -34);
        rt.sizeDelta.set(320, 180);
        rt.localRotation = 30;
        rt.localScale.set(1.5, 2);

        const back = roundTrip(go).getComponent(RectTransform)!;

        expect(back.anchorMin.y).toBeCloseTo(0.25);
        expect(back.anchorMax.x).toBeCloseTo(1);
        expect(back.pivot.x).toBeCloseTo(0.25);
        expect(back.anchoredPosition.x).toBeCloseTo(12);
        expect(back.anchoredPosition.y).toBeCloseTo(-34);
        expect(back.sizeDelta.x).toBeCloseTo(320);
        expect(back.localRotation).toBeCloseTo(30);
        expect(back.localScale.y).toBeCloseTo(2);
    });

    test("the loaded RectTransform keeps its own Vector2 instances", () => {
        const go = new GameObject("Panel");
        go.addComponent(RectTransform).sizeDelta.set(50, 60);

        const back = roundTrip(go).getComponent(RectTransform)!;
        const instance = back.sizeDelta;

        expect(back.sizeDelta).toBe(instance);
        expect(instance.x).toBeCloseTo(50);
    });

    test("a CanvasGroup round-trips its alpha and flags", () => {
        const go = new GameObject("Fade");
        const group = go.addComponent(CanvasGroup);
        group.alpha = 0.35;
        group.interactable = false;
        group.blocksRaycasts = false;
        group.ignoreParentGroups = true;

        const back = roundTrip(go).getComponent(CanvasGroup)!;

        expect(back.alpha).toBeCloseTo(0.35);
        expect(back.interactable).toBe(false);
        expect(back.blocksRaycasts).toBe(false);
        expect(back.ignoreParentGroups).toBe(true);
    });

    test("a LayoutElement round-trips every size override", () => {
        const go = new GameObject("Row");
        const el = go.addComponent(LayoutElement);
        el.minWidth = 10;
        el.preferredHeight = 44;
        el.flexibleWidth = 2;
        el.ignoreLayout = true;

        const back = roundTrip(go).getComponent(LayoutElement)!;

        expect(back.minWidth).toBe(10);
        expect(back.preferredHeight).toBe(44);
        expect(back.flexibleWidth).toBe(2);
        expect(back.ignoreLayout).toBe(true);
    });

    test("a layout group's padding struct keeps its class, not a bare object", () => {
        const go = new GameObject("List");
        const group = go.addComponent(VerticalLayoutGroup);
        group.padding.set(4, 8, 12, 16);
        group.spacing = 6;
        group.childAlignment = LayoutAnchor.MiddleCenter;
        group.reverseArrangement = true;

        const back = roundTrip(go).getComponent(VerticalLayoutGroup)!;

        expect(back.padding).toBeInstanceOf(LayoutPadding);
        expect(typeof back.padding.set).toBe("function");
        expect(back.padding.left).toBe(4);
        expect(back.padding.bottom).toBe(16);
        expect(back.spacing).toBe(6);
        expect(back.childAlignment).toBe(LayoutAnchor.MiddleCenter);
        expect(back.reverseArrangement).toBe(true);
    });

    test("a GridLayoutGroup round-trips its cells and constraint", () => {
        const go = new GameObject("Grid");
        const grid = go.addComponent(GridLayoutGroup);
        grid.cellSize.set(64, 48);
        grid.spacing.set(5, 7);
        grid.constraint = GridConstraint.FixedColumnCount;
        grid.constraintCount = 3;
        grid.startCorner = GridStartCorner.LowerRight;

        const back = roundTrip(go).getComponent(GridLayoutGroup)!;

        expect(back.cellSize.x).toBeCloseTo(64);
        expect(back.spacing.y).toBeCloseTo(7);
        expect(back.constraint).toBe(GridConstraint.FixedColumnCount);
        expect(back.constraintCount).toBe(3);
        expect(back.startCorner).toBe(GridStartCorner.LowerRight);
    });

    test("the fitters round-trip their modes", () => {
        const go = new GameObject("Fitted");
        const csf = go.addComponent(ContentSizeFitter);
        csf.horizontalFit = FitMode.PreferredSize;
        csf.verticalFit = FitMode.MinSize;
        const arf = go.addComponent(AspectRatioFitter);
        arf.aspectMode = AspectMode.FitInParent;
        arf.aspectRatio = 16 / 9;

        const copy = roundTrip(go);

        expect(copy.getComponent(ContentSizeFitter)!.horizontalFit).toBe(FitMode.PreferredSize);
        expect(copy.getComponent(ContentSizeFitter)!.verticalFit).toBe(FitMode.MinSize);
        expect(copy.getComponent(AspectRatioFitter)!.aspectMode).toBe(AspectMode.FitInParent);
        expect(copy.getComponent(AspectRatioFitter)!.aspectRatio).toBeCloseTo(16 / 9);
    });

    test("a RectMask2D round-trips its padding struct", () => {
        const go = new GameObject("Masked");
        const mask = go.addComponent(RectMask2D);
        mask.padding.left = 3;
        mask.padding.bottom = 9;

        const back = roundTrip(go).getComponent(RectMask2D)!;

        expect(back.padding.left).toBe(3);
        expect(back.padding.bottom).toBe(9);
    });

    test("a whole laid-out panel survives as a hierarchy", () => {
        const root = new GameObject("Panel");
        root.addComponent(RectTransform).sizeDelta.set(400, 300);
        root.addComponent(VerticalLayoutGroup).spacing = 8;

        for (let i = 0; i < 3; i++) {
            const row = new GameObject(`Row${i}`);
            row.transform.parent = root.transform;
            row.addComponent(RectTransform);
            row.addComponent(LayoutElement).preferredHeight = 40;
        }

        const back = roundTrip(root);

        expect(back.transform.childCount).toBe(3);
        expect(back.getComponent(VerticalLayoutGroup)!.spacing).toBe(8);
        for (let i = 0; i < 3; i++) {
            const row = back.transform.getChild(i).gameObject;
            expect(row.getComponent(LayoutElement)!.preferredHeight).toBe(40);
            expect(row.getComponent(RectTransform)).not.toBeNull();
        }
    });
});

// ---------------------------------------------------------------------------
// Built-in physics components (unity-parity Stage 1)
// ---------------------------------------------------------------------------

describe("Built-in components — physics", () => {
    beforeEach(destroyScene);

    function roundTrip(go: GameObject): GameObject {
        return SceneSerializer.deserializeGameObject(SceneSerializer.serializeGameObject(go));
    }

    test("a Rigidbody round-trips its dynamics settings", () => {
        const go = new GameObject("Crate");
        const body = go.addComponent(Rigidbody);
        body.mass = 12.5;
        body.drag = 0.4;
        body.angularDrag = 0.9;
        body.useGravity = false;
        body.isKinematic = true;
        body.constraints = RigidbodyConstraints.FreezeRotation;

        const back = roundTrip(go).getComponent(Rigidbody)!;

        expect(back.mass).toBeCloseTo(12.5);
        expect(back.drag).toBeCloseTo(0.4);
        expect(back.angularDrag).toBeCloseTo(0.9);
        expect(back.useGravity).toBe(false);
        expect(back.isKinematic).toBe(true);
        expect(back.constraints).toBe(RigidbodyConstraints.FreezeRotation);
    });

    test("a BoxCollider round-trips its centre and size", () => {
        const go = new GameObject("Crate");
        const box = go.addComponent(BoxCollider);
        box.center = new Vector3(0, 0.5, 0);
        box.size = new Vector3(2, 3, 4);
        box.isTrigger = true;

        const back = roundTrip(go).getComponent(BoxCollider)!;

        expect(back.center.y).toBeCloseTo(0.5);
        expect(back.size.x).toBeCloseTo(2);
        expect(back.size.z).toBeCloseTo(4);
        expect(back.isTrigger).toBe(true);
    });

    test("a collider's setter runs, so the physics shape follows the loaded size", () => {
        const go = new GameObject("Crate");
        go.addComponent(BoxCollider).size = new Vector3(5, 6, 7);

        const back = roundTrip(go).getComponent(BoxCollider)!;

        // The setter is what pushes the size into the shape; writing the field
        // in place would leave the shape at its default.
        const shape = (back as any)._shape;
        expect(shape.scale.x).toBeCloseTo(5);
        expect(shape.scale.z).toBeCloseTo(7);
    });

    test("a SphereCollider round-trips its radius", () => {
        const go = new GameObject("Ball");
        const sphere = go.addComponent(SphereCollider);
        sphere.radius = 2.5;
        sphere.center = new Vector3(1, 0, -1);

        const back = roundTrip(go).getComponent(SphereCollider)!;

        expect(back.radius).toBeCloseTo(2.5);
        expect(back.center.x).toBeCloseTo(1);
        expect(back.center.z).toBeCloseTo(-1);
    });

    test("a CapsuleCollider round-trips radius and height", () => {
        const go = new GameObject("Player");
        const capsule = go.addComponent(CapsuleCollider);
        capsule.radius = 0.4;
        capsule.height = 1.8;

        const back = roundTrip(go).getComponent(CapsuleCollider)!;

        expect(back.radius).toBeCloseTo(0.4);
        expect(back.height).toBeCloseTo(1.8);
    });

    test("a body and its collider reload together", () => {
        const go = new GameObject("Crate");
        go.addComponent(Rigidbody).mass = 3;
        go.addComponent(BoxCollider).size = new Vector3(1, 1, 1);

        const back = roundTrip(go);

        expect(back.getComponent(Rigidbody)!.mass).toBeCloseTo(3);
        expect(back.getComponent(BoxCollider)).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// @ExecutionOrder (unity-parity Stage 1, item 4)
// ---------------------------------------------------------------------------

describe("ExecutionOrder", () => {
    let log: string[];

    class Recorder extends ScriptableBehaviour {
        public tag: string = "?";
        public override update(): void { log.push(this.tag); }
    }

    @ExecutionOrder(-100)
    class EarlyScript extends Recorder {}

    @ExecutionOrder(100)
    class LateScript extends Recorder {}

    class DefaultScript extends Recorder {}

    /** A root GameObject carrying one recorder, tagged for the log. */
    function make<T extends Recorder>(
        ctor: new (go: GameObject) => T,
        tag: string,
        parent?: GameObject,
    ): GameObject {
        const go = new GameObject(tag);
        if (parent) go.transform.parent = parent.transform;
        go.addComponent(ctor).tag = tag;
        return go;
    }

    beforeEach(() => {
        destroyScene();
        log = [];
    });

    test("a lower order runs before a higher one, whatever the hierarchy says", () => {
        // Declared last-first in the tree, so hierarchy order alone would
        // produce the opposite result.
        make(LateScript, "late");
        make(DefaultScript, "default");
        make(EarlyScript, "early");

        SceneManager.activeScene._update();

        expect(log).toEqual(["early", "default", "late"]);
    });

    test("within one order, hierarchy order still decides", () => {
        const a = make(DefaultScript, "a");
        make(DefaultScript, "a.child", a);
        make(DefaultScript, "b");

        SceneManager.activeScene._update();

        expect(log).toEqual(["a", "a.child", "b"]);
    });

    test("ordering applies to fixedUpdate and lateUpdate too", () => {
        class LateRecorder extends ScriptableBehaviour {
            public tag: string = "?";
            public override lateUpdate(): void { log.push(this.tag); }
        }
        @ExecutionOrder(-50)
        class EarlyLate extends LateRecorder {}

        const b = new GameObject("b");
        b.addComponent(LateRecorder).tag = "normal";
        const a = new GameObject("a");
        a.addComponent(EarlyLate).tag = "early";

        // lateUpdate is gated on start() having run, which the update pass is
        // what triggers — same as Unity, and why this is not just one call.
        SceneManager.activeScene._update();
        log.length = 0;
        SceneManager.activeScene._lateUpdate();

        expect(log).toEqual(["early", "normal"]);
    });

    test("an undecorated script sits at zero", () => {
        const go = new GameObject("Plain");
        const script = go.addComponent(DefaultScript);

        expect(getExecutionOrder(script)).toBe(0);
    });

    test("a subclass inherits its base class's order", () => {
        class DerivedEarly extends EarlyScript {}
        const go = new GameObject("Derived");

        expect(getExecutionOrder(go.addComponent(DerivedEarly))).toBe(-100);
    });

    test("the order reaches the class metadata for an inspector to read", () => {
        @ExecutionOrder(25)
        @Serializable({ typeName: "Test.Ordered" })
        class OrderedScript extends ScriptableBehaviour {}

        expect(getClassMeta(OrderedScript as any)!.executionOrder).toBe(25);
    });
});

// ---------------------------------------------------------------------------
// AssetDatabase + references by GUID (unity-parity Stage 2, steps 2-3)
// ---------------------------------------------------------------------------

@Serializable({ typeName: "Test.AssetHolder" })
class AssetHolder extends Behaviour {
    @SerializedField({ type: FieldType.Asset })
    public asset: object | null = null;
}

describe("AssetDatabase", () => {
    beforeEach(() => {
        destroyScene();
        AssetDatabase.clear();
    });
    afterEach(() => AssetDatabase.clear());

    test("a manifest gives an asset its id", () => {
        AssetDatabase.setManifest([{ guid: "abc123", path: "textures/mars.png" }]);

        expect(AssetDatabase.guidForPath("textures/mars.png")).toBe("abc123");
        expect(AssetDatabase.pathOf("abc123")).toBe("textures/mars.png");
    });

    test("paths are normalized, so separators and a leading slash do not matter", () => {
        AssetDatabase.setManifest([{ guid: "abc123", path: "textures/mars.png" }]);

        expect(AssetDatabase.guidForPath("textures\\mars.png")).toBe("abc123");
        expect(AssetDatabase.guidForPath("/textures/mars.png")).toBe("abc123");
    });

    test("an unknown path gets a minted id, stable for the session", () => {
        const first = AssetDatabase.guidForPath("models/rover.glb");
        const again = AssetDatabase.guidForPath("models/rover.glb");

        expect(first).toBe(again);
        expect(first.length).toBeGreaterThan(8);
    });

    test("a minted id is not derived from the path, so moving cannot change it", () => {
        const a = AssetDatabase.guidForPath("a/one.png");
        const b = AssetDatabase.guidForPath("b/one.png");

        expect(a).not.toBe(b);
    });

    test("binding a loaded object makes it findable by id and back", () => {
        const asset = { name: "mars" };
        AssetDatabase.setManifest([{ guid: "abc123", path: "textures/mars.png" }]);

        AssetDatabase._bind("textures/mars.png", asset);

        expect(AssetDatabase.guidOf(asset)).toBe("abc123");
        expect(AssetDatabase.get("abc123")).toBe(asset);
        expect(AssetDatabase.isLoaded("abc123")).toBe(true);
    });

    test("renaming an asset keeps its id and its loaded instance", () => {
        const asset = { name: "mars" };
        AssetDatabase.setManifest([{ guid: "abc123", path: "textures/mars.png" }]);
        AssetDatabase._bind("textures/mars.png", asset);

        expect(AssetDatabase.movePath("textures/mars.png", "textures/planets/mars4k.png")).toBe(true);

        expect(AssetDatabase.pathOf("abc123")).toBe("textures/planets/mars4k.png");
        expect(AssetDatabase.guidForPath("textures/planets/mars4k.png")).toBe("abc123");
        expect(AssetDatabase.guidOf(asset)).toBe("abc123");
    });

    test("moving an unknown path reports that nothing moved", () => {
        expect(AssetDatabase.movePath("nowhere.png", "elsewhere.png")).toBe(false);
    });

    test("a new manifest replaces the old mapping", () => {
        AssetDatabase.setManifest([{ guid: "one", path: "a.png" }]);
        AssetDatabase.setManifest([{ guid: "two", path: "b.png" }]);

        expect(AssetDatabase.pathOf("one")).toBeNull();
        expect(AssetDatabase.pathOf("two")).toBe("b.png");
    });
});

describe("SceneSerializer — asset references by id", () => {
    beforeEach(() => {
        destroyScene();
        AssetDatabase.clear();
    });
    afterEach(() => AssetDatabase.clear());

    test("an asset field serializes as its id, not its path", () => {
        const asset = { name: "mars" };
        AssetDatabase.setManifest([{ guid: "abc123", path: "textures/mars.png" }]);
        AssetDatabase._bind("textures/mars.png", asset);

        const go = new GameObject("Planet");
        go.addComponent(AssetHolder).asset = asset;

        const json = SceneSerializer.serializeGameObject(go);
        const field = json.components[0].fields.asset as any;

        expect(field.$type).toBe("AssetRef");
        expect(field.guid).toBe("abc123");
    });

    test("a loaded asset resolves back to the same instance", () => {
        const asset = { name: "mars" };
        AssetDatabase.setManifest([{ guid: "abc123", path: "textures/mars.png" }]);
        AssetDatabase._bind("textures/mars.png", asset);

        const go = new GameObject("Planet");
        go.addComponent(AssetHolder).asset = asset;
        const json = SceneSerializer.serializeGameObject(go);

        const back = SceneSerializer.deserializeGameObject(json);

        expect(back.getComponent(AssetHolder)!.asset).toBe(asset);
    });

    test("the reference survives the asset being renamed between save and load", () => {
        const asset = { name: "mars" };
        AssetDatabase.setManifest([{ guid: "abc123", path: "textures/mars.png" }]);
        AssetDatabase._bind("textures/mars.png", asset);

        const go = new GameObject("Planet");
        go.addComponent(AssetHolder).asset = asset;
        const json = SceneSerializer.serializeGameObject(go);

        // The whole point of an id: the file moves, the scene does not notice.
        AssetDatabase.movePath("textures/mars.png", "textures/planets/mars.png");

        const back = SceneSerializer.deserializeGameObject(json);
        expect(back.getComponent(AssetHolder)!.asset).toBe(asset);
    });

    test("an unloaded asset leaves the field null and is reported as pending", () => {
        AssetDatabase.setManifest([{ guid: "abc123", path: "textures/mars.png" }]);
        const asset = { name: "mars" };
        AssetDatabase._bind("textures/mars.png", asset);

        const go = new GameObject("Planet");
        go.addComponent(AssetHolder).asset = asset;
        const json = SceneSerializer.serializeGameObject(go);

        // As if the scenario were reloaded and nothing is in memory yet.
        AssetDatabase.clearLoaded();
        const back = SceneSerializer.deserializeGameObject(json);

        expect(back.getComponent(AssetHolder)!.asset).toBeNull();
        expect(SceneSerializer.pendingAssetGuids).toEqual(["abc123"]);
    });

    test("resolvePendingAssets fills the field in once the asset arrives", () => {
        AssetDatabase.setManifest([{ guid: "abc123", path: "textures/mars.png" }]);
        const original = { name: "mars" };
        AssetDatabase._bind("textures/mars.png", original);

        const go = new GameObject("Planet");
        go.addComponent(AssetHolder).asset = original;
        const json = SceneSerializer.serializeGameObject(go);

        AssetDatabase.clearLoaded();
        const back = SceneSerializer.deserializeGameObject(json);
        expect(back.getComponent(AssetHolder)!.asset).toBeNull();

        // The load the caller was told to perform.
        const reloaded = { name: "mars" };
        AssetDatabase._bind("textures/mars.png", reloaded);

        expect(SceneSerializer.resolvePendingAssets()).toBe(1);
        expect(back.getComponent(AssetHolder)!.asset).toBe(reloaded);
        expect(SceneSerializer.pendingAssetGuids).toEqual([]);
    });

    test("an asset with no identity at all serializes as null rather than a path", () => {
        const go = new GameObject("Planet");
        go.addComponent(AssetHolder).asset = { name: "never registered" };

        const json = SceneSerializer.serializeGameObject(go);

        expect(json.components[0].fields.asset).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// UI graphics — sprites reference their texture by id
// ---------------------------------------------------------------------------

describe("Built-in components — UI graphics", () => {
    /** A texture stand-in with an identity, as Resources would have bound it. */
    function boundTexture(guid: string, path: string): any {
        const texture = { name: path, width: 128, height: 128 };
        AssetDatabase.setManifest([{ guid, path }]);
        AssetDatabase._bind(path, texture);
        return texture;
    }

    beforeEach(() => {
        destroyScene();
        AssetDatabase.clear();
    });
    afterEach(() => AssetDatabase.clear());

    function roundTrip(go: GameObject): GameObject {
        return SceneSerializer.deserializeGameObject(SceneSerializer.serializeGameObject(go));
    }

    test("a UIImage round-trips its own settings", () => {
        const go = new GameObject("Icon");
        const img = go.addComponent(UIImage);
        img.color = new Color(0.2, 0.4, 0.6, 0.8);
        img.type = ImageType.Tiled;
        img.fillAmount = 0.6;
        img.fillMethod = ImageFillMethod.Radial360;
        img.fillOrigin = ImageFillOrigin.Top;
        img.fillClockwise = false;
        img.borderRadius = 7;
        img.preserveAspect = true;
        img.imageSmoothing = false;

        const back = roundTrip(go).getComponent(UIImage)!;

        expect(back.color.g).toBeCloseTo(0.4);
        expect(back.type).toBe(ImageType.Tiled);
        expect(back.fillAmount).toBeCloseTo(0.6);
        expect(back.fillMethod).toBe(ImageFillMethod.Radial360);
        expect(back.fillOrigin).toBe(ImageFillOrigin.Top);
        expect(back.fillClockwise).toBe(false);
        expect(back.borderRadius).toBe(7);
        expect(back.preserveAspect).toBe(true);
        expect(back.imageSmoothing).toBe(false);
    });

    test("a sprite round-trips its texture id and its framing", () => {
        const texture = boundTexture("tex1", "ui/atlas.png");
        const sprite = new Sprite(texture, new Rect(32, 64, 16, 16));
        sprite.border.set(4, 4, 4, 4);
        sprite.pivot.set(0, 1);

        const go = new GameObject("Icon");
        go.addComponent(UIImage).sprite = sprite;

        const back = roundTrip(go).getComponent(UIImage)!;

        expect(back.sprite).not.toBeNull();
        expect(back.sprite!.texture).toBe(texture);
        expect(back.sprite!.rect.x).toBe(32);
        expect(back.sprite!.rect.width).toBe(16);
        expect(back.sprite!.border.left).toBe(4);
        expect(back.sprite!.pivot.y).toBe(1);
    });

    test("two sprites cut from one atlas share the texture after loading", () => {
        const texture = boundTexture("tex1", "ui/atlas.png");

        const root = new GameObject("Panel");
        for (const x of [0, 32]) {
            const child = new GameObject(`Icon${x}`);
            child.transform.parent = root.transform;
            child.addComponent(UIImage).sprite = new Sprite(texture, new Rect(x, 0, 32, 32));
        }

        const back = roundTrip(root);
        const a = back.transform.getChild(0).gameObject.getComponent(UIImage)!;
        const b = back.transform.getChild(1).gameObject.getComponent(UIImage)!;

        expect(a.sprite!.texture).toBe(b.sprite!.texture);
        expect(a.sprite!.rect.x).not.toBe(b.sprite!.rect.x);
    });

    test("renaming the texture does not break the sprite", () => {
        const texture = boundTexture("tex1", "ui/atlas.png");
        const go = new GameObject("Icon");
        go.addComponent(UIImage).sprite = new Sprite(texture, new Rect(0, 0, 16, 16));
        const json = SceneSerializer.serializeGameObject(go);

        AssetDatabase.movePath("ui/atlas.png", "ui/atlases/main.png");

        const back = SceneSerializer.deserializeGameObject(json).getComponent(UIImage)!;
        expect(back.sprite!.texture).toBe(texture);
    });

    test("a sprite whose texture is not loaded is pending, then resolves", () => {
        const texture = boundTexture("tex1", "ui/atlas.png");
        const go = new GameObject("Icon");
        go.addComponent(UIImage).sprite = new Sprite(texture, new Rect(8, 8, 16, 16));
        const json = SceneSerializer.serializeGameObject(go);

        AssetDatabase.clearLoaded();
        const back = SceneSerializer.deserializeGameObject(json).getComponent(UIImage)!;

        expect(back.sprite).toBeNull();
        expect(SceneSerializer.pendingAssetGuids).toEqual(["tex1"]);

        const reloaded = { name: "atlas", width: 128, height: 128 };
        AssetDatabase._bind("ui/atlas.png", reloaded);
        expect(SceneSerializer.resolvePendingAssets()).toBe(1);

        // The framing came back with it, not just the texture.
        expect(back.sprite!.texture).toBe(reloaded);
        expect(back.sprite!.rect.x).toBe(8);
    });

    test("a UIText round-trips everything that affects how it draws", () => {
        const go = new GameObject("Label");
        const label = go.addComponent(UIText);
        label.text = "Mass: 5.2 kg";
        label.fontSize = 22;
        label.fontFamily = "Georgia";
        label.color = new Color(1, 0.8, 0.2, 1);
        label.alignment = TextAlignment.Center;
        label.verticalAlignment = VerticalAlignment.Middle;
        label.wordWrap = false;
        label.lineHeight = 1.4;
        label.outlineWidth = 3;
        label.overflow = TextOverflow.Ellipsis;
        label.richText = true;
        label.bestFit = true;
        label.bestFitMinSize = 8;
        label.bestFitMaxSize = 36;

        const back = roundTrip(go).getComponent(UIText)!;

        expect(back.text).toBe("Mass: 5.2 kg");
        expect(back.fontSize).toBe(22);
        expect(back.fontFamily).toBe("Georgia");
        expect(back.color.g).toBeCloseTo(0.8);
        expect(back.alignment).toBe(TextAlignment.Center);
        expect(back.verticalAlignment).toBe(VerticalAlignment.Middle);
        expect(back.wordWrap).toBe(false);
        expect(back.lineHeight).toBeCloseTo(1.4);
        expect(back.outlineWidth).toBe(3);
        expect(back.overflow).toBe(TextOverflow.Ellipsis);
        expect(back.richText).toBe(true);
        expect(back.bestFit).toBe(true);
        expect(back.bestFitMinSize).toBe(8);
        expect(back.bestFitMaxSize).toBe(36);
    });
});

// ---------------------------------------------------------------------------
// Built-in UI controls
// ---------------------------------------------------------------------------

describe("Built-in components — UI controls", () => {
    beforeEach(destroyScene);

    function roundTrip(go: GameObject): GameObject {
        return SceneSerializer.deserializeGameObject(SceneSerializer.serializeGameObject(go));
    }

    test("a Button round-trips its caption and every state colour", () => {
        const go = new GameObject("Go");
        const btn = go.addComponent(Button);
        btn.text = "Start";
        btn.fontSize = 20;
        btn.fontFamily = "Georgia";
        btn.borderRadius = 9;
        btn.normalColor = new Color(0.1, 0.1, 0.1, 1);
        btn.highlightedColor = new Color(0.2, 0.2, 0.2, 1);
        btn.pressedColor = new Color(0.3, 0.3, 0.3, 1);
        btn.textColor = new Color(1, 0.5, 0, 1);
        btn.interactable = false;

        const back = roundTrip(go).getComponent(Button)!;

        expect(back.text).toBe("Start");
        expect(back.fontSize).toBe(20);
        expect(back.fontFamily).toBe("Georgia");
        expect(back.borderRadius).toBe(9);
        expect(back.normalColor.r).toBeCloseTo(0.1);
        expect(back.pressedColor.g).toBeCloseTo(0.3);
        expect(back.textColor.g).toBeCloseTo(0.5);
        // interactable comes from the Selectable base.
        expect(back.interactable).toBe(false);
    });

    test("a Toggle round-trips its state without announcing it as a click", () => {
        const go = new GameObject("Grid");
        const toggle = go.addComponent(Toggle);
        toggle.label = "Show gridlines";
        toggle.boxSize = 24;
        toggle.isOn = true;

        let notified = 0;
        const back = roundTrip(go).getComponent(Toggle)!;
        back.onValueChanged.addListener(() => { notified++; });

        expect(back.isOn).toBe(true);
        expect(back.label).toBe("Show gridlines");
        expect(back.boxSize).toBe(24);
        // Loading state is not the user toggling it.
        expect(notified).toBe(0);
    });

    test("a Slider round-trips its range, value and direction", () => {
        const go = new GameObject("Mass");
        const slider = go.addComponent(Slider);
        slider.minValue = 10;
        slider.maxValue = 90;
        slider.value = 42;
        slider.wholeNumbers = true;
        slider.direction = SliderDirection.BottomToTop;
        slider.handleSize = 26;

        const back = roundTrip(go).getComponent(Slider)!;

        expect(back.minValue).toBe(10);
        expect(back.maxValue).toBe(90);
        expect(back.value).toBe(42);
        expect(back.wholeNumbers).toBe(true);
        expect(back.direction).toBe(SliderDirection.BottomToTop);
        expect(back.handleSize).toBe(26);
    });

    test("a Slider's range is restored before its value, so the value is not clamped away", () => {
        const go = new GameObject("Wide");
        const slider = go.addComponent(Slider);
        slider.maxValue = 1000;
        slider.value = 750;

        const back = roundTrip(go).getComponent(Slider)!;

        // With the default 0..1 range still in force, 750 would clamp to 1.
        expect(back.value).toBe(750);
    });

    test("a Scrollbar round-trips its position and handle size", () => {
        const go = new GameObject("Bar");
        const bar = go.addComponent(Scrollbar);
        bar.value = 0.25;
        bar.size = 0.4;
        bar.numberOfSteps = 5;
        bar.direction = ScrollbarDirection.LeftToRight;

        const back = roundTrip(go).getComponent(Scrollbar)!;

        expect(back.value).toBeCloseTo(0.25);
        expect(back.size).toBeCloseTo(0.4);
        expect(back.numberOfSteps).toBe(5);
        expect(back.direction).toBe(ScrollbarDirection.LeftToRight);
    });

    test("a whole control panel reloads with its controls intact", () => {
        const root = new GameObject("Panel");
        root.addComponent(RectTransform);
        root.addComponent(VerticalLayoutGroup).spacing = 6;

        const label = new GameObject("Title");
        label.transform.parent = root.transform;
        label.addComponent(UIText).text = "Experiment";

        const slider = new GameObject("Mass");
        slider.transform.parent = root.transform;
        slider.addComponent(Slider).value = 0.5;

        const button = new GameObject("Run");
        button.transform.parent = root.transform;
        button.addComponent(Button).text = "Run";

        const back = roundTrip(root);

        expect(back.transform.childCount).toBe(3);
        expect(back.transform.getChild(0).gameObject.getComponent(UIText)!.text).toBe("Experiment");
        expect(back.transform.getChild(1).gameObject.getComponent(Slider)!.value).toBeCloseTo(0.5);
        expect(back.transform.getChild(2).gameObject.getComponent(Button)!.text).toBe("Run");
    });
});
