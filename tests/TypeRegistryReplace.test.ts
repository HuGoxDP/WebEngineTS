import { describe, test, expect, afterEach, vi } from "vitest";
import { TypeRegistry } from "../src/engine/core/reflection/TypeRegistry";
import { Serializable, SerializedField, getClassMeta } from "../src/engine/core/reflection/Decorators";
import type { ClassMeta } from "../src/engine/core/reflection/Types";
import { SceneManager } from "../src/engine/core/SceneManager";
import { SceneSerializer } from "../src/engine/core/serialization/SceneSerializer";
import { GameObject } from "../src/engine/core/GameObject";
import { Component } from "../src/engine/core/Component";

/**
 * C3 (Engine E4): the type registry accepts a replacement class.
 *
 * A script reload registers a new constructor under the same typeName, and
 * `register` refuses that on purpose. `TypeRegistry.replace` is the explicit
 * swap: the name resolves to the new class afterwards, so a scene deserialized
 * after the swap instantiates it, while an accidental duplicate still goes
 * through `register`'s collision guard.
 */

const NAME = "C3.ReloadTarget";

/** The metadata `getClassMeta` hands a host for the class it just compiled. */
function metaOf(ctor: unknown): ClassMeta {
    const meta = getClassMeta(ctor as never);
    if (!meta) throw new Error("class carries no @Serializable metadata");
    return meta;
}

/** A scene file holding one object with one component of the registered name. */
function savedFile(fields: Record<string, unknown>): string {
    return JSON.stringify({
        name: "Scene",
        version: 2,
        roots: [{
            name: "Holder",
            active: true,
            transform: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                scale: { x: 1, y: 1, z: 1 },
            },
            components: [{ type: NAME, fields }],
            children: [],
        }],
    });
}

afterEach(() => {
    TypeRegistry._clear();
    SceneManager.activeScene.getRootGameObjects().slice().forEach(go => go.destroyImmediate());
});

describe("TypeRegistry.replace", () => {
    test("a scene deserialized after the swap instantiates the new class", () => {
        @Serializable()
        class FirstAttempt extends Component {
            @SerializedField() public speed = 5;
            @SerializedField() public label = "first";
        }
        TypeRegistry.register(NAME, FirstAttempt, metaOf(FirstAttempt));

        // The reload: a second class defining the same typeName. register refuses it.
        @Serializable({ typeName: NAME })
        class Reloaded extends Component {
            @SerializedField() public speed = 5;
            @SerializedField() public label = "first";
            public generation(): string { return "second"; }
        }
        const collision = vi.spyOn(console, "error").mockImplementation(() => {});
        TypeRegistry.register(NAME, Reloaded, metaOf(Reloaded));
        expect(collision).toHaveBeenCalled();
        expect(TypeRegistry.get(NAME)).toBe(FirstAttempt);
        collision.mockRestore();

        // The deliberate swap.
        TypeRegistry.replace(NAME, Reloaded, metaOf(Reloaded));
        expect(TypeRegistry.get(NAME)).toBe(Reloaded);

        // A file saved before the swap now loads the new class, with the old
        // file's field values.
        const roots = SceneSerializer.deserializeScene(JSON.parse(savedFile({ speed: 9, label: "kept" })));
        const comp = roots[0].getComponent(Reloaded);
        expect(comp).toBeInstanceOf(Reloaded);
        expect(comp!.generation()).toBe("second");
        expect(comp!.speed).toBe(9);
        expect(comp!.label).toBe("kept");
    });

    test("an accidental duplicate still goes nowhere", () => {
        @Serializable()
        class Original extends Component {
            @SerializedField() public value = 1;
        }
        TypeRegistry.register(NAME, Original, metaOf(Original));

        @Serializable({ typeName: NAME })
        class Accidental extends Component {
            @SerializedField() public value = 2;
        }
        const collision = vi.spyOn(console, "error").mockImplementation(() => {});
        TypeRegistry.register(NAME, Accidental, metaOf(Accidental));
        collision.mockRestore();

        expect(TypeRegistry.get(NAME)).toBe(Original);
    });

    test("the old class keeps serializing under the same name after a swap", () => {
        @Serializable({ typeName: NAME })
        class OldClass extends Component {
            @SerializedField() public value = 1;
        }
        TypeRegistry.register(NAME, OldClass, metaOf(OldClass));

        @Serializable({ typeName: NAME })
        class NewClass extends Component {
            @SerializedField() public value = 1;
        }
        TypeRegistry.register(NAME, NewClass, metaOf(NewClass));
        TypeRegistry.replace(NAME, NewClass, metaOf(NewClass));

        // A straggler instance of the old class still names the type, so a file
        // saved from a mixed scene loads (as the new class).
        const holder = new GameObject("Holder");
        holder.addComponent(OldClass);
        expect(TypeRegistry.getTypeName(holder.getComponent(OldClass)!)).toBe(NAME);

        const saved = SceneSerializer.serializeScene(SceneManager.activeScene);
        const back = SceneSerializer.deserializeScene(JSON.parse(JSON.stringify(saved)));
        expect(back[0].getComponent(NewClass)).toBeInstanceOf(NewClass);
    });

    test("replacing with the same class is a no-op", () => {
        @Serializable({ typeName: NAME })
        class Same extends Component {
            @SerializedField() public value = 1;
        }
        TypeRegistry.register(NAME, Same, metaOf(Same));

        TypeRegistry.replace(NAME, Same, metaOf(Same));

        expect(TypeRegistry.get(NAME)).toBe(Same);
    });

    test("replacing an unknown name throws", () => {
        @Serializable()
        class Lonely extends Component {
            @SerializedField() public value = 1;
        }
        expect(() => TypeRegistry.replace(NAME, Lonely, metaOf(Lonely))).toThrow(/nothing is registered/);
    });

    test("replacing with metadata that names something else throws", () => {
        @Serializable()
        class Registered extends Component {
            @SerializedField() public value = 1;
        }
        TypeRegistry.register(NAME, Registered, metaOf(Registered));

        @Serializable()
        class Mismatched extends Component {
            @SerializedField() public value = 1;
        }
        const wrongMeta = { ...metaOf(Mismatched), typeName: "Somebody.Else" };
        expect(() => TypeRegistry.replace(NAME, Mismatched, wrongMeta)).toThrow(/names "Somebody.Else"/);
    });
});
