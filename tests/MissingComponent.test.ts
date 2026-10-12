import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
// Loaded for its side effect: it installs the hook SceneSerializer builds objects through.
import "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import { SceneSerializer, type SerializedScene } from "../src/engine/core/serialization/SceneSerializer";
import { MissingComponent, MissingValue } from "../src/engine/core/serialization/MissingComponent";
import { Prefab } from "../src/engine/core/serialization/Prefab";
import { AssetDatabase } from "../src/engine/core/assets/AssetDatabase";
import { Camera } from "../src/engine/core/components/Camera";
import { Rigidbody } from "../src/engine/physics/Rigidbody";

/**
 * Opening a scene and saving it again must not be able to delete anything.
 *
 * A scene that names a component type the running code does not know — a script
 * that failed to compile, a package that is not installed, a scene from a newer
 * build — used to lose that component on load ("skipped"), and so on the next
 * save. These tests pin the other behaviour: it is kept inert, with its data,
 * and written back as it was read.
 */

@Serializable({ typeName: "MissingSpec.Pointer" })
class Pointer extends Behaviour {
    @SerializedField({ type: FieldType.Component })
    public target: object | null = null;

    @SerializedField({ type: FieldType.Object })
    public config: unknown = null;
}

const GHOST = {
    type: "MissingSpec.Ghost",
    fields: {
        speed: 4.5,
        label: "scout",
        offset: { $type: "Vector3", x: 1, y: 2, z: 3 },
        follow: { $type: "GameObjectRef", path: [0] },
        waypoints: [{ $type: "Vector3", x: 0, y: 0, z: 0 }, { $type: "Vector3", x: 5, y: 0, z: 5 }],
    },
};

function sceneWith(...components: unknown[]): SerializedScene {
    return {
        name: "Spec",
        version: 1,
        roots: [{
            name: "Holder",
            active: true,
            transform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                scale: { x: 1, y: 1, z: 1 },
            },
            components: components as never,
            children: [],
        }],
    };
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
}

describe("a component whose class is not registered", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        clear();
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    test("is kept as a placeholder instead of being skipped", () => {
        const [root] = SceneSerializer.deserializeScene(sceneWith(GHOST));

        const missing = root.getComponent(MissingComponent);
        expect(missing).not.toBeNull();
        expect(missing!.originalType).toBe("MissingSpec.Ghost");
        expect(warn).toHaveBeenCalled();
    });

    test("is written back exactly as it was read", () => {
        const [root] = SceneSerializer.deserializeScene(sceneWith(GHOST));
        const out = SceneSerializer.serializeGameObject(root);

        expect(out.components).toEqual([GHOST]);
    });

    test("survives being loaded and saved twice — the file does not drift", () => {
        const first = SceneSerializer.serializeScene(
            (() => { clear(); SceneSerializer.deserializeScene(sceneWith(GHOST)); return SceneManager.activeScene; })(),
        );
        clear();
        SceneSerializer.deserializeScene(first);
        const second = SceneSerializer.serializeScene(SceneManager.activeScene);

        expect(second.roots[0].components).toEqual([GHOST]);
    });

    test("does not share its data with the file it was read from", () => {
        const source = sceneWith(GHOST);
        const [root] = SceneSerializer.deserializeScene(source);

        root.getComponent(MissingComponent)!.originalFields["speed"] = 99;

        expect((source.roots[0].components[0] as unknown as { fields: { speed: number } }).fields.speed).toBe(4.5);
    });

    test("keeps its place among the components that are known", () => {
        const ghost = { ...GHOST, type: "MissingSpec.Middle" };
        const [root] = SceneSerializer.deserializeScene(sceneWith(
            { type: "Camera", fields: {} },
            ghost,
            { type: "Rigidbody", fields: {} },
        ));

        expect(root.getComponent(Camera)).not.toBeNull();
        expect(root.getComponent(Rigidbody)).not.toBeNull();
        expect(SceneSerializer.serializeGameObject(root).components.map(c => c.type))
            .toEqual(["Camera", "MissingSpec.Middle", "Rigidbody"]);
    });

    test("does nothing while it is missing", () => {
        const [root] = SceneSerializer.deserializeScene(sceneWith(GHOST));
        const missing = root.getComponent(MissingComponent)!;

        // A Component, not a Behaviour: it has no enable switch and no lifecycle
        // to run, so there is nothing for an update loop to call.
        expect(missing).not.toBeInstanceOf(Behaviour);
        expect(missing.gameObject).toBe(root);
    });

    test("becomes the real component once its type is registered", () => {
        // A name of its own: the registry is global and cannot forget a type, so
        // registering the shared one here would stop it being missing in the
        // tests that follow.
        const LATE = { ...GHOST, type: "MissingSpec.Late" };
        const [root] = SceneSerializer.deserializeScene(sceneWith(LATE));
        const saved = SceneSerializer.serializeScene(SceneManager.activeScene);
        clear();
        expect(root.exists()).toBe(false);

        // The script compiles; the same file is opened again.
        @Serializable({ typeName: "MissingSpec.Late" })
        class Late extends Behaviour {
            @SerializedField() public speed = 0;
            @SerializedField() public label = "";
        }

        const [back] = SceneSerializer.deserializeScene(saved);
        const ghost = back.getComponent(Late);

        expect(ghost).not.toBeNull();
        expect(ghost!.speed).toBe(4.5);
        expect(ghost!.label).toBe("scout");
        expect(back.getComponent(MissingComponent)).toBeNull();
    });

    test("can still be pointed at by a component that is known", () => {
        const [root] = SceneSerializer.deserializeScene(sceneWith(
            GHOST,
            {
                type: "MissingSpec.Pointer",
                fields: { target: { $type: "ComponentRef", path: [0], component: "MissingSpec.Ghost", index: 0 } },
            },
        ));

        const pointer = root.getComponent(Pointer)!;
        expect(pointer.target).toBe(root.getComponent(MissingComponent));

        const out = SceneSerializer.serializeGameObject(root);
        const ref = out.components.find(c => c.type === "MissingSpec.Pointer")!.fields["target"];
        expect(ref).toEqual({ $type: "ComponentRef", path: [0], component: "MissingSpec.Ghost", index: 0 });
    });

    test("is carried by a prefab and by a copy", () => {
        const [root] = SceneSerializer.deserializeScene(sceneWith(GHOST));

        const copy = Prefab.fromGameObject(root).instantiate();

        expect(SceneSerializer.serializeGameObject(copy).components).toEqual([GHOST]);
    });

    test("a prefab instance keeps an unknown component of its prefab without reporting an override", () => {
        const [root] = SceneSerializer.deserializeScene(sceneWith(GHOST));
        const prefab = Prefab.fromGameObject(root);
        AssetDatabase._bindGuid("missing-spec-prefab", prefab);

        const instance = prefab.instantiate();

        expect(instance.getComponent(MissingComponent)!.originalType).toBe("MissingSpec.Ghost");
        expect(prefab.getOverrides(instance)).toEqual([]);
        const link = SceneSerializer.serializeGameObject(instance, { prefabs: "link" }).prefab!;
        expect(link.changes).toEqual({ overrides: [] });
        AssetDatabase.clear();
    });
});

describe("a nested value whose class is not registered", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        clear();
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    test("is kept and written back as it was read", () => {
        const nested = { $type: "Nested", type: "MissingSpec.Struct", fields: { a: 1, b: [2, 3] } };
        const [root] = SceneSerializer.deserializeScene(sceneWith({
            type: "MissingSpec.Pointer",
            fields: { config: nested },
        }));

        const pointer = root.getComponent(Pointer)!;
        expect(pointer.config).toBeInstanceOf(MissingValue);

        const out = SceneSerializer.serializeGameObject(root);
        expect(out.components[0].fields["config"]).toEqual(nested);
    });
});
