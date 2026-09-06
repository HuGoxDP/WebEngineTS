import { describe, test, expect, afterEach } from "vitest";
import * as THREE from "three";
import { ScenarioAssets } from "../src/engine/core/scenario/ScenarioAssets";
import { GameObject } from "../src/engine/core/GameObject";

/**
 * glTF 2.0 defines a **right-handed** coordinate system, +Y up and −Z forward.
 * This engine is left-handed with +Z forward, as Unity is. Copying a glTF node's
 * coordinates verbatim therefore imports the model as its own mirror image, which
 * is what every engine bridging the two conventions flips on import.
 *
 * It showed as a factual error rather than a cosmetic one: the solar system's
 * Earth — which takes the procedural-sphere path, and had the same fault in
 * `Mesh.createSphere` — rendered with India west of Africa.
 *
 * These drive `_convertGLTFScene` with a hand-built node tree rather than a real
 * `.glb`, so the conversion is tested without shipping a binary fixture.
 */

const made: GameObject[] = [];

/** An asset source that is never read: only the scene conversion is exercised. */
const stubSource = {
    readBytes: async (): Promise<Uint8Array> => new Uint8Array(),
    exists: async (): Promise<boolean> => false,
    list: async (): Promise<string[]> => [],
};

function node(name: string, x = 0, y = 0, z = 0): THREE.Object3D {
    const object = new THREE.Object3D();
    object.name = name;
    object.position.set(x, y, z);
    return object;
}

/** Runs the private converter over a scene root and tracks the result. */
function convert(scene: THREE.Object3D, name = "Model"): GameObject {
    const assets = new ScenarioAssets(stubSource as never);
    const root = (assets as unknown as {
        _convertGLTFScene(gltf: { scene: THREE.Object3D }, name: string): GameObject;
    })._convertGLTFScene({ scene }, name);
    made.push(root);
    return root;
}

/** Depth-first search by name, since the conversion inserts a node of its own. */
function find(root: GameObject, name: string): GameObject {
    if (root.name === name) return root;
    for (let i = 0; i < root.transform.childCount; i++) {
        const hit = find(root.transform.getChild(i).gameObject, name);
        if (hit) return hit;
    }
    return null as unknown as GameObject;
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("glTF → engine axis conversion", () => {
    test("a node's Z is answered in engine space, opposite to glTF's", () => {
        const scene = node("Scene");
        scene.add(node("Marker", 0, 0, 3));

        const marker = find(convert(scene), "Marker");

        expect(marker.transform.position.z).toBeCloseTo(-3, 5);
    });

    test("X and Y are untouched", () => {
        const scene = node("Scene");
        scene.add(node("Marker", 2, 7, 0));

        const marker = find(convert(scene), "Marker");

        expect(marker.transform.position.x).toBeCloseTo(2, 5);
        expect(marker.transform.position.y).toBeCloseTo(7, 5);
    });

    test("the returned root is left clean for the caller to place and scale", () => {
        // `GameObject.normalizeToSize` assigns localScale outright, so a conversion
        // parked on the root would be wiped by the first caller that resizes a
        // model — which the solar system does to every planet.
        const root = convert(node("Scene"));

        expect(root.transform.localScale.x).toBeCloseTo(1, 5);
        expect(root.transform.localScale.y).toBeCloseTo(1, 5);
        expect(root.transform.localScale.z).toBeCloseTo(1, 5);
        expect(root.transform.localPosition.magnitude()).toBeCloseTo(0, 5);
    });

    test("a nested node keeps its parent's offset", () => {
        // The converter set each node's local transform and then parented it with
        // the default worldPositionStays, which preserves the child's *world* pose
        // — dividing out the parent it had just been given. Deep nodes collapsed
        // onto their own local offset. X is used because the axis flip leaves it
        // alone, so this measures the hierarchy and nothing else.
        const scene = node("Scene");
        const parent = node("Parent", 10, 0, 0);
        parent.add(node("Child", 3, 0, 0));
        scene.add(parent);

        const child = find(convert(scene), "Child");

        expect(child.transform.position.x).toBeCloseTo(13, 5);
    });

    test("nesting composes through the flip too", () => {
        const scene = node("Scene");
        const parent = node("Parent", 0, 0, 10);
        parent.add(node("Child", 0, 0, 4));
        scene.add(parent);

        const child = find(convert(scene), "Child");

        expect(child.transform.position.z).toBeCloseTo(-14, 5);
    });
});
