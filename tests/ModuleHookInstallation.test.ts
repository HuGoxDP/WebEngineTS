import { describe, test, expect } from "vitest";

/**
 * Cross-layer hooks: does the module that installs one actually get loaded?
 *
 * Several subsystems avoid a circular import by having the lower layer declare
 * a callback and the upper layer install it at module load. That only works if
 * the installing module is guaranteed to be loaded whenever the callback can be
 * called, and three of the four families in the engine guarantee it by
 * construction — the caller cannot exist without the installer:
 *
 * - `Texture._onDestroyed` → installed by `UIImage`, which is also the only
 *   module that puts anything in the tint cache. No entries without it.
 * - `Rigidbody._onEnabled` → installed by `Collider`. A collider cannot exist
 *   unless that module loaded, since every subclass extends it.
 * - `profilerHooks.*` → installed by each subsystem. A subsystem that never
 *   loaded has no instances, so the `?? 0` the profiler reads is the right
 *   answer rather than a missing one.
 *
 * `SceneSerializer._createGameObject` is the one that does not: deserializing
 * builds GameObjects from JSON, so the caller does *not* need one to already
 * exist and cannot imply the installer. What closes it is the barrel — it
 * imports `GameObject` as a value, so every consumer of the package loads it.
 * That is an invariant of `src/engine/index.ts`, which is what this file pins.
 */

describe("the barrel installs the serializer's GameObject factory", () => {
    test("importing the package is enough for the hook to be in place", async () => {
        const engine = await import("../src/engine/index");
        const { SceneSerializer } = engine as unknown as {
            SceneSerializer: { _createGameObject: unknown };
        };

        expect(typeof SceneSerializer._createGameObject).toBe("function");
    });

    test("and a deserialize round trip works through it", async () => {
        // The end the hook exists for. Reached the way a consumer reaches it,
        // rather than by importing GameObject directly, which would install the
        // hook itself and prove nothing.
        const { GameObject, SceneSerializer } = await import("../src/engine/index");

        const original = new GameObject("Original");
        const restored = SceneSerializer.deserializeGameObject(
            SceneSerializer.serializeGameObject(original),
        );

        expect(restored.name).toBe("Original");
    });

    test("Instantiate copies a GameObject through the same path", async () => {
        const { GameObject, EngineObject } = await import("../src/engine/index");

        const original = new GameObject("Original");
        const copy = EngineObject.Instantiate(original);

        expect(copy).not.toBe(original);
        expect(copy.name).toBe("Original");
    });
});
