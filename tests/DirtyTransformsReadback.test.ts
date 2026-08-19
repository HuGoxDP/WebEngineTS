import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Transform } from "../src/engine/core/Transform";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * The dirty-transform switch is a process-wide global that a benchmark run sets
 * per configuration. Every other such global can be read back —
 * `Texture2D.maxSize`, `Resources.preferExtension`, `Application.powerPreference`
 * — so a harness can record what the engine actually holds rather than what it
 * asked for, and a botched reset between runs shows up in the data instead of
 * quietly reporting the previous configuration's numbers. This one could only
 * be written.
 */

afterEach(() => {
    Transform._setDirtyTransformsEnabled(false);
});

describe("Transform.dirtyTransformsEnabled", () => {
    test("it is off unless something turns it on", () => {
        expect(Transform.dirtyTransformsEnabled).toBe(false);
    });

    test("it reports what was set", () => {
        Transform._setDirtyTransformsEnabled(true);
        expect(Transform.dirtyTransformsEnabled).toBe(true);

        Transform._setDirtyTransformsEnabled(false);
        expect(Transform.dirtyTransformsEnabled).toBe(false);
    });

    test("it reports the flag the setters actually consult", () => {
        // The point of the accessor is to be the engine's own state, not a
        // mirror of the last request. A getter backed by a second field would
        // satisfy the two tests above and still tell a harness nothing.
        const go = new GameObject("probe");

        Transform._setDirtyTransformsEnabled(true);
        go.transform.localPosition = new Vector3(1, 2, 3);

        // Deferred, because batching is on — which is what the getter claims.
        expect(Transform.dirtyTransformsEnabled).toBe(true);
        expect(go.transform._internalObject3D.position.x).toBe(0);

        Transform._syncAllDirty();
        expect(go.transform._internalObject3D.position.x).toBe(1);
    });

    test("and reports it after batching is turned back off", () => {
        const go = new GameObject("probe");

        Transform._setDirtyTransformsEnabled(true);
        Transform._setDirtyTransformsEnabled(false);
        go.transform.localPosition = new Vector3(4, 5, 6);

        expect(Transform.dirtyTransformsEnabled).toBe(false);
        // Immediate, because batching is off.
        expect(go.transform._internalObject3D.position.x).toBe(4);
    });
});
