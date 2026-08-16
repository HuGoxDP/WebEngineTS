import { describe, test, expect, afterEach } from "vitest";
import { TypeRegistry } from "../src/engine/core/reflection/TypeRegistry";
import type { ClassMeta } from "../src/engine/core/reflection/Types";

/**
 * `_clear` emptied the name map and left the constructor map alone, so
 * `getMeta` and `getTypeName` went on answering for classes the registry no
 * longer knew. A WeakMap has no `clear`; the way to empty one is to replace it.
 * Audit part 10, F65.
 */

class Widget {}
class Gadget {}

const meta = (typeName: string): ClassMeta => ({ typeName, fields: [] } as unknown as ClassMeta);

afterEach(() => TypeRegistry._clear());

describe("TypeRegistry._clear", () => {
    test("forgets the name", () => {
        TypeRegistry.register("Widget", Widget, meta("Widget"));

        TypeRegistry._clear();

        expect(TypeRegistry.get("Widget")).toBeNull();
        expect(TypeRegistry.has("Widget")).toBe(false);
    });

    test("forgets the metadata too", () => {
        TypeRegistry.register("Widget", Widget, meta("Widget"));

        TypeRegistry._clear();

        expect(TypeRegistry.getMeta(Widget)).toBeNull();
    });

    test("and stops naming instances of a class it no longer knows", () => {
        TypeRegistry.register("Widget", Widget, meta("Widget"));
        expect(TypeRegistry.getTypeName(new Widget())).toBe("Widget");

        TypeRegistry._clear();

        expect(TypeRegistry.getTypeName(new Widget())).toBeNull();
    });

    test("leaves the registry usable afterwards", () => {
        TypeRegistry.register("Widget", Widget, meta("Widget"));
        TypeRegistry._clear();

        TypeRegistry.register("Gadget", Gadget, meta("Gadget"));

        expect(TypeRegistry.get("Gadget")).toBe(Gadget);
        expect(TypeRegistry.getTypeName(new Gadget())).toBe("Gadget");
        expect(TypeRegistry.all).toEqual(["Gadget"]);
    });

    test("a name can be reused for another class after a clear", () => {
        // The case the half-clear made ambiguous: same name, different class.
        TypeRegistry.register("Thing", Widget, meta("Thing"));
        TypeRegistry._clear();

        TypeRegistry.register("Thing", Gadget, meta("Thing"));

        expect(TypeRegistry.get("Thing")).toBe(Gadget);
        expect(TypeRegistry.getMeta(Widget)).toBeNull();
    });

    test("registering the same class twice is not an error", () => {
        // A module evaluated twice — two bundle copies, or a hot reload.
        TypeRegistry.register("Widget", Widget, meta("Widget"));
        TypeRegistry.register("Widget", Widget, meta("Widget"));

        expect(TypeRegistry.get("Widget")).toBe(Widget);
        expect(TypeRegistry.all).toEqual(["Widget"]);
    });
});
