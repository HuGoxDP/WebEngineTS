import { describe, test, expect, afterEach } from "vitest";
import * as THREE from "three";
import { GameObject } from "../src/engine/core/GameObject";
import { Camera } from "../src/engine/core/components/Camera";
import { LineRenderer } from "../src/engine/core/components/LineRenderer";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Quaternion } from "../src/engine/core/math/Quaternion";

/**
 * A LineRenderer draws its width as geometry, so the ribbon has to be turned
 * toward the camera — and turned again when the camera moves. It was built once
 * and never re-faced: a line under a rotating parent, or any line at all after
 * the camera orbited, went edge-on and rendered as a hairline. Crystals showed it
 * as unit-cell edges that faded one by one as the lattice turned.
 *
 * Driven through `LineRenderer._updateAll()`, which is what `Application._loop`
 * calls — not through `_systemLateUpdate`, which the loop never calls directly.
 */

const made: GameObject[] = [];

function spawn(name: string): GameObject {
    const go = new GameObject(name);
    made.push(go);
    return go;
}

/** A camera at `at`, so `Camera.main` resolves and the ribbon has a viewpoint. */
function cameraAt(at: Vector3): Camera {
    const cam = spawn("Cam").addComponent(Camera);
    cam.transform.position = at;
    return cam;
}

function lineAlongX(): LineRenderer {
    const line = spawn("Line").addComponent(LineRenderer);
    line.positionCount = 2;
    line.setPosition(0, new Vector3(-1, 0, 0));
    line.setPosition(1, new Vector3(1, 0, 0));
    line.startWidth = 0.5;
    line.endWidth = 0.5;
    return line;
}

/** A copy of the ribbon's current vertices, so a later build can be compared. */
function vertices(line: LineRenderer): Float32Array {
    const object = (line as unknown as { _threeLine: THREE.Mesh | null })._threeLine;
    const attribute = object!.geometry.getAttribute("position") as THREE.BufferAttribute;
    return new Float32Array(attribute.array as Float32Array);
}

const maxDelta = (a: Float32Array, b: Float32Array): number => {
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    return worst;
};

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("LineRenderer ribbon facing", () => {
    test("re-faces after the camera moves", () => {
        const cam = cameraAt(new Vector3(0, 0, -10));
        const line = lineAlongX();
        LineRenderer._updateAll();
        const before = vertices(line);

        // From the side to overhead: the ribbon has to swing through 90°, so its
        // vertices must move by roughly the line's width.
        cam.transform.position = new Vector3(0, 10, 0);
        LineRenderer._updateAll();

        expect(maxDelta(before, vertices(line))).toBeGreaterThan(0.2);
    });

    test("re-faces when the line's own transform turns", () => {
        cameraAt(new Vector3(0, 0, -10));
        const line = lineAlongX();
        LineRenderer._updateAll();
        const before = vertices(line);

        line.transform.rotation = Quaternion.euler(90, 0, 0);
        LineRenderer._updateAll();

        expect(maxDelta(before, vertices(line))).toBeGreaterThan(0.2);
    });

    test("leaves the ribbon alone while nothing moves", () => {
        cameraAt(new Vector3(0, 0, -10));
        const line = lineAlongX();
        LineRenderer._updateAll();
        const before = vertices(line);

        LineRenderer._updateAll();
        LineRenderer._updateAll();

        expect(maxDelta(before, vertices(line))).toBe(0);
    });

    test("reuses its buffers across a rebuild at the same point count", () => {
        const cam = cameraAt(new Vector3(0, 0, -10));
        const line = lineAlongX();
        LineRenderer._updateAll();

        const object = (line as unknown as { _threeLine: THREE.Mesh | null })._threeLine;
        const first = object!.geometry.getAttribute("position");

        cam.transform.position = new Vector3(0, 10, 0);
        LineRenderer._updateAll();

        // Re-facing happens every frame the view changes; allocating three arrays
        // each time would make an orbiting camera a per-frame allocator.
        expect(object!.geometry.getAttribute("position")).toBe(first);
    });

    test("grows its buffers when the point count changes", () => {
        cameraAt(new Vector3(0, 0, -10));
        const line = lineAlongX();
        LineRenderer._updateAll();

        line.positionCount = 4;
        line.setPosition(2, new Vector3(2, 1, 0));
        line.setPosition(3, new Vector3(3, 0, 0));
        LineRenderer._updateAll();

        expect(vertices(line).length).toBe(4 * 6);
    });
});
