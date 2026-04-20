import { describe, test, expect } from "vitest";
import { TypeRegistry } from "../src/engine/core/reflection/TypeRegistry";
import {
    Serializable,
    SerializedField,
    Range,
    Header,
    Tooltip,
    HideInInspector,
    getClassMeta,
    getAllFields,
} from "../src/engine/core/reflection/Decorators";
import { FieldType } from "../src/engine/core/reflection/Types";
import { ValueSerializer } from "../src/engine/core/serialization/ValueSerializer";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Color } from "../src/engine/core/math/Color";
import { Quaternion } from "../src/engine/core/math/Quaternion";

@Serializable()
class SimplePoco {
    @SerializedField()
    public speed: number = 5;

    @SerializedField()
    public name: string = "default";

    @SerializedField()
    public active: boolean = true;
}

@Serializable({ category: "Gameplay" })
class AnnotatedPoco {
    @Header("Movement")
    @Range(0, 10)
    @Tooltip("Max speed in units/sec")
    @SerializedField()
    public speed: number = 5;

    @SerializedField({ type: FieldType.Vector3 })
    public offset: Vector3 = new Vector3(1, 2, 3);

    @SerializedField({ type: FieldType.Color })
    public tint: Color = new Color(1, 0, 0, 1);

    @HideInInspector()
    @SerializedField()
    public hiddenState: number = 42;

    public notSerialized: number = 99;
}

@Serializable()
class Base {
    @SerializedField()
    public baseField: number = 1;
}

@Serializable()
class Derived extends Base {
    @SerializedField()
    public derivedField: string = "hello";
}

describe("TypeRegistry", () => {
    test("classes are registered by @Serializable", () => {
        expect(TypeRegistry.has("SimplePoco")).toBe(true);
        expect(TypeRegistry.has("AnnotatedPoco")).toBe(true);
        expect(TypeRegistry.get("SimplePoco")).toBe(SimplePoco);
    });

    test("getTypeName resolves from an instance", () => {
        expect(TypeRegistry.getTypeName(new SimplePoco())).toBe("SimplePoco");
    });

    test("returns null for unregistered types", () => {
        class Anon {}
        expect(TypeRegistry.get("Anon")).toBe(null);
        expect(TypeRegistry.getTypeName(new Anon())).toBe(null);
    });
});

describe("Decorators — class meta", () => {
    test("class meta has typeName and collected fields", () => {
        const meta = getClassMeta(SimplePoco)!;
        expect(meta.typeName).toBe("SimplePoco");
        expect(meta.fields.length).toBeGreaterThanOrEqual(3);
        expect(meta.fields.find(f => f.name === "speed")).toBeDefined();
    });

    test("category propagates from options", () => {
        expect(getClassMeta(AnnotatedPoco)!.category).toBe("Gameplay");
    });
});

describe("Decorators — field annotations", () => {
    const fields = getAllFields(AnnotatedPoco);
    const speed = fields.find(f => f.name === "speed")!;
    const offset = fields.find(f => f.name === "offset")!;

    test("@SerializedField marks field with serialize: true", () => {
        expect(speed.serialize).toBe(true);
    });

    test("@Range sets range [min, max]", () => {
        expect(speed.range).toEqual([0, 10]);
    });

    test("@Header and @Tooltip propagate", () => {
        expect(speed.header).toBe("Movement");
        expect(speed.tooltip).toBe("Max speed in units/sec");
    });

    test("explicit type option is preserved", () => {
        expect(offset.type).toBe(FieldType.Vector3);
    });

    test("@HideInInspector sets the flag (field stays serialized)", () => {
        const hidden = fields.find(f => f.name === "hiddenState")!;
        expect(hidden.hideInInspector).toBe(true);
        expect(hidden.serialize).toBe(true);
    });

    test("fields without @SerializedField are not collected", () => {
        expect(fields.find(f => f.name === "notSerialized")).toBeUndefined();
    });

    test("inherited fields are merged from base to derived", () => {
        const all = getAllFields(Derived).map(f => f.name);
        expect(all).toContain("baseField");
        expect(all).toContain("derivedField");
    });
});

describe("ValueSerializer — round trip", () => {
    test("primitives pass through unchanged", () => {
        expect(ValueSerializer.serialize(42)).toBe(42);
        expect(ValueSerializer.serialize("hi")).toBe("hi");
        expect(ValueSerializer.serialize(true)).toBe(true);
        expect(ValueSerializer.deserialize(42)).toBe(42);
    });

    test("null round-trips as null", () => {
        expect(ValueSerializer.serialize(null)).toBe(null);
        expect(ValueSerializer.deserialize(null)).toBe(null);
    });

    test("Vector3 round trip", () => {
        const v = new Vector3(1, 2, 3);
        const json = ValueSerializer.serialize(v) as any;
        expect(json).toEqual({ $type: "Vector3", x: 1, y: 2, z: 3 });
        const back = ValueSerializer.deserialize(json) as Vector3;
        expect(back).toBeInstanceOf(Vector3);
        expect(back.x).toBe(1);
        expect(back.y).toBe(2);
        expect(back.z).toBe(3);
    });

    test("Quaternion round trip", () => {
        const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
        const back = ValueSerializer.deserialize(ValueSerializer.serialize(q)) as Quaternion;
        expect(back).toBeInstanceOf(Quaternion);
        expect(back.w).toBeCloseTo(0.4);
    });

    test("Color round trip", () => {
        const c = new Color(0.5, 0.25, 0.125, 0.9);
        const back = ValueSerializer.deserialize(ValueSerializer.serialize(c)) as Color;
        expect(back).toBeInstanceOf(Color);
        expect(back.r).toBeCloseTo(0.5);
        expect(back.a).toBeCloseTo(0.9);
    });

    test("arrays of primitives round trip", () => {
        const back = ValueSerializer.deserialize(ValueSerializer.serialize([1, 2, 3]));
        expect(back).toEqual([1, 2, 3]);
    });

    test("arrays of Vector3 round trip", () => {
        const arr = [new Vector3(1, 0, 0), new Vector3(0, 1, 0)];
        const back = ValueSerializer.deserialize(ValueSerializer.serialize(arr)) as Vector3[];
        expect(back[0]).toBeInstanceOf(Vector3);
        expect(back[1].y).toBe(1);
    });
});
