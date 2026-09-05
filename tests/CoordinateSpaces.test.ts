import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Camera } from "../src/engine/core/components/Camera";
import { Space } from "../src/engine/core/Transform";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Vector2 } from "../src/engine/core/math/Vector2";
import { Quaternion } from "../src/engine/core/math/Quaternion";
import { Rect } from "../src/engine/core/math/Rect";
import { Mesh } from "../src/engine/core/graphics/Mesh";
import { MeshFilter } from "../src/engine/core/rendering/MeshFilter";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";

/**
 * Pins the coordinate-conversion contract for Transform and Camera against Unity
 * semantics (design/unity-coordinate-spaces.md): z is a world distance,
 * round-trips return the input, TransformVector scales where TransformDirection
 * does not, and world +X renders to the right of the screen.
 *
 * That last one is F7. The engine used to compensate handedness with a single
 * `rotateY(π)` — a rotation, and no rotation can mirror — so the whole image came
 * out flipped, which for chirality-carrying content (a B-DNA helix, molecular
 * stereochemistry) is a factual error, not a cosmetic one. The scene now carries
 * the reflection itself and cameras cancel it; these tests are the witness.
 *
 * Every GameObject is tracked and destroyed after each test so cameras do not
 * linger in the static registry that Application._resize iterates.
 */

const made: GameObject[] = [];

function spawn(name: string): GameObject {
    const go = new GameObject(name);
    made.push(go);
    return go;
}

function makeCamera(w = 800, h = 600): Camera {
    const cam = spawn("Cam").addComponent(Camera);
    cam.fieldOfView = 60;
    cam.aspect = w / h;
    cam._setPixelSize(w, h);
    return cam;
}

function makeOrthoCamera(w = 800, h = 600, size = 5): Camera {
    const cam = spawn("OrthoCam").addComponent(Camera);
    cam.orthographic = true;
    cam.orthographicSize = size;
    cam.aspect = w / h;
    cam._setPixelSize(w, h);
    return cam;
}

const dist = (a: Vector3, b: Vector3): number =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("Transform — point / vector / direction", () => {
    test("transformPoint applies translation, rotation and scale", () => {
        const go = spawn("t");
        go.transform.position = new Vector3(10, 0, 0);
        go.transform.localScale = new Vector3(2, 2, 2);

        const world = go.transform.transformPoint(new Vector3(1, 0, 0));
        expect(world.x).toBeCloseTo(12, 4);
        expect(world.y).toBeCloseTo(0, 4);
        expect(world.z).toBeCloseTo(0, 4);
    });

    test("transformVector applies scale; transformDirection ignores it", () => {
        const go = spawn("t");
        go.transform.position = new Vector3(10, 5, 3); // must not affect either
        go.transform.localScale = new Vector3(2, 2, 2);

        const v = go.transform.transformVector(new Vector3(1, 0, 0));
        expect(v.x).toBeCloseTo(2, 4); // length scaled, position ignored
        expect(v.y).toBeCloseTo(0, 4);
        expect(v.z).toBeCloseTo(0, 4);

        const d = go.transform.transformDirection(new Vector3(1, 0, 0));
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 4); // unit length kept
    });

    test("inverseTransformPoint / inverseTransformVector round-trip", () => {
        const go = spawn("t");
        go.transform.position = new Vector3(-3, 7, 2);
        go.transform.localRotation = Quaternion.euler(15, 40, -25);
        go.transform.localScale = new Vector3(2, 0.5, 1.5);

        const p = new Vector3(1.2, -0.8, 3);
        const back = go.transform.inverseTransformPoint(go.transform.transformPoint(p));
        expect(dist(back, p)).toBeLessThan(1e-4);

        const v = new Vector3(0.4, 2, -1);
        const backV = go.transform.inverseTransformVector(go.transform.transformVector(v));
        expect(dist(backV, v)).toBeLessThan(1e-4);
    });

    test("localToWorldMatrix matches transformPoint; worldToLocalMatrix inverts it", () => {
        const go = spawn("t");
        go.transform.position = new Vector3(4, -2, 1);
        go.transform.localRotation = Quaternion.euler(0, 30, 0);
        go.transform.localScale = new Vector3(1.5, 1.5, 1.5);

        const p = new Vector3(2, 1, -1);
        const viaMethod = go.transform.transformPoint(p);
        const viaMatrix = go.transform.localToWorldMatrix.multiplyPoint(p);
        expect(dist(viaMethod, viaMatrix)).toBeLessThan(1e-4);

        const back = go.transform.worldToLocalMatrix.multiplyPoint(viaMatrix);
        expect(dist(back, p)).toBeLessThan(1e-4);
    });

    /**
     * The conversions must answer in the same world space as `position`, and the
     * only axis that can tell them apart is Z — the axis the scene's handedness
     * mirror acts on. Every case above uses z = 0, a round trip, or reads only
     * `.x`, so all of them passed while `transformPoint` was answering in Three's
     * mirrored space: an object at z = +5 converted its own origin to z = −5, and
     * `inverseTransformPoint(position)` came back at −2z instead of the origin.
     */
    describe("answers in the same world space as position", () => {
        test("transformPoint on the Z axis agrees with position", () => {
            const go = spawn("t");
            go.transform.position = new Vector3(1, 2, 5);

            expect(dist(go.transform.transformPoint(Vector3.zero), go.transform.position))
                .toBeLessThan(1e-4);
        });

        test("inverseTransformPoint undoes position, not something 2z away", () => {
            const go = spawn("t");
            go.transform.position = new Vector3(1, 2, 5);

            const back = go.transform.inverseTransformPoint(go.transform.position);
            expect(dist(back, Vector3.zero)).toBeLessThan(1e-4);
        });

        test("a child's position matches the parent's transformPoint on Z", () => {
            const parent = spawn("parent");
            const child = spawn("child");
            child.transform.setParent(parent.transform, false);
            parent.transform.position = new Vector3(0, 0, 5);
            child.transform.localPosition = new Vector3(0, 0, 3);

            expect(child.transform.position.z).toBeCloseTo(8, 4);
            expect(parent.transform.transformPoint(new Vector3(0, 0, 3)).z).toBeCloseTo(8, 4);
        });

        test("localToWorldMatrix agrees with position on Z", () => {
            const go = spawn("t");
            go.transform.position = new Vector3(-2, 1, 4);

            const viaMatrix = go.transform.localToWorldMatrix.multiplyPoint(Vector3.zero);
            expect(dist(viaMatrix, go.transform.position)).toBeLessThan(1e-4);
        });

        test("transformDirection carries local forward to the object's forward", () => {
            // `forward` is engine world space; a direction conversion that read the
            // mirrored matrix pointed the opposite way down Z.
            const go = spawn("t");
            go.transform.rotation = Quaternion.euler(0, 35, 0);

            const fwd = go.transform.transformDirection(new Vector3(0, 0, 1));
            expect(dist(fwd, go.transform.forward)).toBeLessThan(1e-4);
        });

        test("transformVector on Z keeps its sign", () => {
            const go = spawn("t");
            go.transform.position = new Vector3(0, 0, 7); // must not enter the result
            go.transform.localScale = new Vector3(2, 2, 2);

            const v = go.transform.transformVector(new Vector3(0, 0, 1));
            expect(v.z).toBeCloseTo(2, 4);
        });

        test("inverseTransformVector undoes it", () => {
            const go = spawn("t");
            go.transform.position = new Vector3(0, 0, 7);
            go.transform.localScale = new Vector3(2, 2, 2);

            const back = go.transform.inverseTransformVector(new Vector3(0, 0, 2));
            expect(back.z).toBeCloseTo(1, 4);
        });
    });

    test("hierarchy: a child's world point includes the parent", () => {
        const parent = spawn("parent");
        const child = spawn("child");
        child.transform.parent = parent.transform;
        child.transform.localPosition = new Vector3(1, 0, 0);
        parent.transform.position = new Vector3(5, 0, 0);

        expect(child.transform.position.x).toBeCloseTo(6, 4);
        const w = child.transform.transformPoint(Vector3.zero);
        expect(w.x).toBeCloseTo(6, 4);
    });

    test("lossyScale equals localScale with no parent", () => {
        const go = spawn("t");
        go.transform.localScale = new Vector3(2, 3, 4);
        const s = go.transform.lossyScale;
        expect(s.x).toBeCloseTo(2, 4);
        expect(s.y).toBeCloseTo(3, 4);
        expect(s.z).toBeCloseTo(4, 4);
    });
});

describe("Transform — translate / rotate / rotateAround with Space", () => {
    test("translate World ignores orientation; Self moves along local axes", () => {
        const w = spawn("w");
        w.transform.localRotation = Quaternion.euler(0, 90, 0);
        w.transform.translate(new Vector3(0, 0, 1)); // default World
        expect(w.transform.position.z).toBeCloseTo(1, 4);
        expect(w.transform.position.x).toBeCloseTo(0, 4);

        const s = spawn("s");
        s.transform.localRotation = Quaternion.euler(0, 90, 0);
        const fwd = s.transform.forward;
        s.transform.translate(new Vector3(0, 0, 1), Space.Self);
        expect(s.transform.position.x).toBeCloseTo(fwd.x, 4);
        expect(s.transform.position.z).toBeCloseTo(fwd.z, 4);
    });

    test("rotate Self applies the delta locally", () => {
        const s = spawn("s");
        s.transform.rotate(new Vector3(0, 90, 0)); // default Self, from identity
        const expected = new Vector3(0, 0, 1).applyQuaternion(Quaternion.euler(0, 90, 0));
        const got = s.transform.forward;
        expect(dist(got, expected)).toBeLessThan(1e-4);
    });

    test("rotate World differs from Self for an already-rotated object", () => {
        const a = spawn("a");
        a.transform.localRotation = Quaternion.euler(90, 0, 0);
        a.transform.rotate(new Vector3(0, 90, 0), Space.Self);

        const b = spawn("b");
        b.transform.localRotation = Quaternion.euler(90, 0, 0);
        b.transform.rotate(new Vector3(0, 90, 0), Space.World);

        const pa = new Vector3(0, 0, 1).applyQuaternion(a.transform.rotation);
        const pb = new Vector3(0, 0, 1).applyQuaternion(b.transform.rotation);
        expect(dist(pa, pb)).toBeGreaterThan(0.1);
    });

    test("forward / up / right setters orient the corresponding axis", () => {
        const f = spawn("f");
        f.transform.forward = new Vector3(1, 0, 0);
        expect(dist(f.transform.forward, new Vector3(1, 0, 0))).toBeLessThan(1e-4);

        const u = spawn("u");
        u.transform.up = new Vector3(0, 0, 1);
        expect(dist(u.transform.up, new Vector3(0, 0, 1))).toBeLessThan(1e-4);

        const r = spawn("r");
        r.transform.right = new Vector3(0, 1, 0);
        expect(dist(r.transform.right, new Vector3(0, 1, 0))).toBeLessThan(1e-4);
    });

    /**
     * `lookAt` used to delegate to `Object3D.lookAt`, which aims an object's −Z at
     * the target where Unity aims its +Z — so `forward` ended up pointing away
     * from what was just looked at. The camera's old `rotateY(π)` hid it; with
     * that gone, a `lookAt` camera rendered an empty scene.
     */
    test("lookAt points forward AT the target, not away from it", () => {
        const o = spawn("looker");
        o.transform.position = new Vector3(0, 0, -10);
        o.transform.lookAt(new Vector3(0, 0, 0));
        expect(dist(o.transform.forward, new Vector3(0, 0, 1))).toBeLessThan(1e-4);

        const side = spawn("side");
        side.transform.lookAt(new Vector3(5, 0, 0));
        expect(dist(side.transform.forward, new Vector3(1, 0, 0))).toBeLessThan(1e-4);
    });

    test("lookAt keeps up roughly world-up and is stable at the target", () => {
        const o = spawn("looker");
        o.transform.lookAt(new Vector3(0, 0, 3));
        expect(o.transform.up.y).toBeGreaterThan(0.9);

        // Degenerate: looking at its own position must not produce NaN.
        const before = o.transform.rotation;
        o.transform.lookAt(o.transform.position);
        expect(Number.isNaN(o.transform.rotation.x)).toBe(false);
        expect(o.transform.rotation.w).toBeCloseTo(before.w, 5);
    });

    test("rotateAround preserves distance to the pivot", () => {
        const o = spawn("o");
        o.transform.position = new Vector3(0, 0, 1);
        o.transform.rotateAround(Vector3.zero, Vector3.up, 90);

        const p = o.transform.position;
        expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 4); // still on the unit circle
        expect(p.y).toBeCloseTo(0, 4);                        // rotation about Y keeps Y
        expect(Math.abs(p.z)).toBeLessThan(0.999);            // no longer on the +Z axis
    });
});

describe("Camera — screen / viewport conversions", () => {
    test("worldToScreenPoint: centre pixel, z is the world distance", () => {
        const cam = makeCamera();
        const s = cam.worldToScreenPoint(new Vector3(0, 0, 5));
        expect(s.x).toBeCloseTo(400, 2);
        expect(s.y).toBeCloseTo(300, 2);
        expect(s.z).toBeCloseTo(5, 4); // distance in world units, not NDC depth
    });

    test("world → screen → world round-trips", () => {
        const cam = makeCamera();
        const p = new Vector3(1.5, -0.7, 8);
        const s = cam.worldToScreenPoint(p);
        const back = cam.screenToWorldPoint(s);
        expect(dist(back, p)).toBeLessThan(1e-3);
    });

    test("screenToWorldPoint with z = 0 returns the camera position", () => {
        const cam = makeCamera();
        const back = cam.screenToWorldPoint(new Vector3(400, 300, 0));
        expect(dist(back, Vector3.zero)).toBeLessThan(1e-4);
    });

    test("viewport: centre maps to (0.5, 0.5) and round-trips", () => {
        const cam = makeCamera();
        const v = cam.worldToViewportPoint(new Vector3(0, 0, 5));
        expect(v.x).toBeCloseTo(0.5, 4);
        expect(v.y).toBeCloseTo(0.5, 4);
        expect(v.z).toBeCloseTo(5, 4);

        const back = cam.viewportToWorldPoint(new Vector3(0.5, 0.5, 5));
        expect(dist(back, new Vector3(0, 0, 5))).toBeLessThan(1e-3);
    });

    test("screen ↔ viewport are pixel-size scaling", () => {
        const cam = makeCamera();
        const vp = cam.screenToViewportPoint(new Vector3(400, 300, 5));
        expect(vp.x).toBeCloseTo(0.5, 4);
        expect(vp.y).toBeCloseTo(0.5, 4);
        const sp = cam.viewportToScreenPoint(new Vector3(0.5, 0.5, 5));
        expect(sp.x).toBeCloseTo(400, 4);
        expect(sp.y).toBeCloseTo(300, 4);
    });

    test("pixelWidth / pixelHeight report the surface set on the camera", () => {
        const cam = makeCamera(1024, 768);
        expect(cam.pixelWidth).toBe(1024);
        expect(cam.pixelHeight).toBe(768);
    });

    test("screenPointToRay: unit direction, points along it reproject to the pixel", () => {
        const cam = makeCamera();
        const ray = cam.screenPointToRay(new Vector2(520, 240));
        expect(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z)).toBeCloseTo(1, 4);
        expect(dist(ray.origin, Vector3.zero)).toBeLessThan(1e-4);

        const along = new Vector3(
            ray.origin.x + ray.direction.x * 5,
            ray.origin.y + ray.direction.y * 5,
            ray.origin.z + ray.direction.z * 5,
        );
        const s = cam.worldToScreenPoint(along);
        expect(s.x).toBeCloseTo(520, 1);
        expect(s.y).toBeCloseTo(240, 1);
    });

    test("worldToCameraMatrix puts camera-space forward on −Z (OpenGL/Unity view)", () => {
        const cam = makeCamera();
        const view = cam.worldToCameraMatrix.multiplyPoint(new Vector3(0, 0, 5));
        expect(view.z).toBeCloseTo(-5, 3); // a point in front has negative view z
        const origin = cam.worldToCameraMatrix.multiplyPoint(Vector3.zero);
        expect(dist(origin, Vector3.zero)).toBeLessThan(1e-4);
    });

    /**
     * SPEC, and the witness for F7's fix. World +X must land on the RIGHT of the
     * screen, as Unity puts it. Until 2026-09-03 it landed on the LEFT: the
     * handedness compensation was a single `rotateY(π)`, a rotation, and no
     * rotation can mirror — so the whole image was a horizontal flip of Unity's.
     *
     * The scene now carries the reflection itself (`Scene._contentRoot`), with
     * cameras cancelling it so their view matrix stays proper. If this ever goes
     * back to being less than 400, the mirror has returned.
     */
    test("world +X projects RIGHT of centre, as Unity renders it (F7 fixed)", () => {
        const cam = makeCamera();
        const s = cam.worldToScreenPoint(new Vector3(1, 0, 5));
        expect(s.x).toBeGreaterThan(400);
    });

    /**
     * End to end, the way a scenario actually sets a camera up: place it back
     * along −Z and `lookAt` the subject. This is what rendered an empty frame when
     * `lookAt` still aimed −Z at the target.
     */
    test("a lookAt camera frames its subject, with +X still to the right", () => {
        const cam = makeCamera();
        cam.gameObject.transform.position = new Vector3(0, 2, -24);
        cam.gameObject.transform.lookAt(new Vector3(0, 2, 0));

        const centre = cam.worldToScreenPoint(new Vector3(0, 2, 0));
        expect(centre.x).toBeCloseTo(400, 0);
        expect(centre.y).toBeCloseTo(300, 0);
        expect(centre.z).toBeGreaterThan(0); // in front of the camera, not behind

        const right = cam.worldToScreenPoint(new Vector3(6, 2, 0));
        expect(right.x).toBeGreaterThan(400);
    });

    test("world +Y projects ABOVE centre and +Z recedes (no vertical or depth flip)", () => {
        const cam = makeCamera();
        const up = cam.worldToScreenPoint(new Vector3(0, 1, 5));
        expect(up.y).toBeLessThan(300); // screen Y is down, so "above" is smaller

        const near = cam.worldToScreenPoint(new Vector3(0, 0, 3));
        const far = cam.worldToScreenPoint(new Vector3(0, 0, 9));
        expect(near.z).toBeCloseTo(3, 4);
        expect(far.z).toBeCloseTo(9, 4);
    });
});

/**
 * World bounds are read out of Three's `matrixWorld`, which carries the scene's
 * handedness mirror — and which `updateMatrixWorld` refreshes *without* walking
 * up to its ancestors. Both bit: before the first render the world matrix of an
 * ancestor is still identity, so bounds came back at the origin however the
 * object was placed. Neither was covered.
 */
describe("Bounds across the handedness mirror", () => {
    function boxAt(pos: Vector3): MeshRenderer {
        const go = spawn("Boxy");
        go.transform.position = pos;
        go.addComponent(MeshFilter).sharedMesh = Mesh.createCube(2);
        return go.addComponent(MeshRenderer);
    }

    test("Renderer.bounds sits where the engine placed the object", () => {
        const b = boxAt(new Vector3(2, 1, 6)).bounds;
        expect(b.center.x).toBeCloseTo(2, 3);
        expect(b.center.y).toBeCloseTo(1, 3);
        expect(b.center.z).toBeCloseTo(6, 3); // not 0, and not -6
    });

    test("Renderer.bounds follows a parent that moved this frame", () => {
        const parent = spawn("Parent");
        const r = boxAt(Vector3.zero);
        r.gameObject.transform.setParent(parent.transform, false);
        parent.transform.position = new Vector3(0, 0, 5);

        expect(r.bounds.center.z).toBeCloseTo(5, 3);
    });

    test("GameObject hierarchy bounds are in engine space too", () => {
        const r = boxAt(new Vector3(0, 0, 4));
        const b = r.gameObject.transform._computeHierarchyBounds();
        expect(b.center.z).toBeCloseTo(4, 3); // not -4
        expect(b.size.z).toBeGreaterThan(0);  // size is unsigned
    });
});

describe("Camera — orthographic conversions", () => {
    test("world → screen → world round-trips", () => {
        const cam = makeOrthoCamera();
        const p = new Vector3(2, -1, 8);
        const back = cam.screenToWorldPoint(cam.worldToScreenPoint(p));
        expect(dist(back, p)).toBeLessThan(1e-3);
    });

    test("centre pixel maps to the axis at the requested depth", () => {
        const cam = makeOrthoCamera();
        const near = cam.screenToWorldPoint(new Vector3(400, 300, 3));
        const far = cam.screenToWorldPoint(new Vector3(400, 300, 9));
        expect(dist(near, new Vector3(0, 0, 3))).toBeLessThan(1e-3);
        expect(dist(far, new Vector3(0, 0, 9))).toBeLessThan(1e-3);
    });

    test("off-centre pixel: world XY is independent of depth (parallel projection)", () => {
        const cam = makeOrthoCamera();
        const a = cam.screenToWorldPoint(new Vector3(600, 200, 4));
        const b = cam.screenToWorldPoint(new Vector3(600, 200, 12));
        expect(Math.abs(a.x)).toBeGreaterThan(0.1); // genuinely off-axis
        expect(a.x).toBeCloseTo(b.x, 4);
        expect(a.y).toBeCloseTo(b.y, 4);
        expect(a.z).toBeCloseTo(4, 3);
        expect(b.z).toBeCloseTo(12, 3);
    });

    test("screenPointToRay produces parallel rays along the camera forward", () => {
        const cam = makeOrthoCamera();
        const r1 = cam.screenPointToRay(new Vector2(100, 100));
        const r2 = cam.screenPointToRay(new Vector2(700, 500));
        expect(dist(r1.direction, r2.direction)).toBeLessThan(1e-4); // parallel
        expect(dist(r1.origin, r2.origin)).toBeGreaterThan(0.1);     // but offset
        expect(dist(r1.direction, new Vector3(0, 0, 1))).toBeLessThan(1e-4); // = forward
    });
});

describe("Camera — viewport rect (F4)", () => {
    test("pixelWidth/pixelHeight and aspect follow the viewport rect", () => {
        const cam = makeCamera(800, 600);
        cam.viewport = new Rect(0, 0, 0.5, 1);
        expect(cam.pixelWidth).toBeCloseTo(400, 4);
        expect(cam.pixelHeight).toBeCloseTo(600, 4);
        expect(cam.aspect).toBeCloseTo(400 / 600, 4);
    });

    test("worldToScreenPoint maps into the camera's sub-rect", () => {
        const cam = makeCamera(800, 600);
        cam.viewport = new Rect(0.5, 0, 0.5, 1); // right half of the surface
        const s = cam.worldToScreenPoint(new Vector3(0, 0, 5));
        expect(s.x).toBeCloseTo(600, 1); // centre of the right half: 0.75 * 800
        expect(s.y).toBeCloseTo(300, 1);
        expect(s.z).toBeCloseTo(5, 4);
    });

    test("world → screen → world round-trips under a sub-rect", () => {
        const cam = makeCamera(800, 600);
        cam.viewport = new Rect(0.25, 0.1, 0.5, 0.8);
        const p = new Vector3(1.2, -0.6, 7);
        const back = cam.screenToWorldPoint(cam.worldToScreenPoint(p));
        expect(dist(back, p)).toBeLessThan(1e-3);
    });

    test("screen <-> viewport respect the rect; viewport stays frustum-relative", () => {
        const cam = makeCamera(800, 600);
        cam.viewport = new Rect(0.5, 0, 0.5, 1); // right half
        // The centre of the right half, in screen pixels, is the frustum centre.
        const vp = cam.screenToViewportPoint(new Vector3(600, 300, 5));
        expect(vp.x).toBeCloseTo(0.5, 4);
        expect(vp.y).toBeCloseTo(0.5, 4);
        const sp = cam.viewportToScreenPoint(new Vector3(0.5, 0.5, 5));
        expect(sp.x).toBeCloseTo(600, 3);
        expect(sp.y).toBeCloseTo(300, 3);
        // The frustum centre projects to viewport (0.5, 0.5) regardless of the rect.
        const wv = cam.worldToViewportPoint(new Vector3(0, 0, 5));
        expect(wv.x).toBeCloseTo(0.5, 4);
        expect(wv.y).toBeCloseTo(0.5, 4);
    });

    /**
     * _worldToSurfacePoint backs world-space Canvas UI. The overlay spans the
     * whole surface, so unlike the frustum-relative public viewport API this one
     * must include the rect, or a world-space canvas drifts off the 3D object it
     * is anchored to whenever the camera does not fill the surface.
     */
    test("_worldToSurfacePoint is surface-normalized and rect-aware", () => {
        const cam = makeCamera(800, 600);
        const out = new Vector3();

        expect(cam._worldToSurfacePoint(0, 0, 5, out)).toBe(true);
        expect(out.x).toBeCloseTo(0.5, 4); // full rect: centre of the surface
        expect(out.y).toBeCloseTo(0.5, 4);
        expect(out.z).toBeCloseTo(5, 4);   // world-unit distance

        cam.viewport = new Rect(0.5, 0, 0.5, 1); // right half
        expect(cam._worldToSurfacePoint(0, 0, 5, out)).toBe(true);
        expect(out.x).toBeCloseTo(0.75, 4); // centre of the right half
        expect(out.y).toBeCloseTo(0.5, 4);
    });

    test("_worldToSurfacePoint rejects points at or behind the eye", () => {
        const cam = makeCamera();
        const out = new Vector3();
        expect(cam._worldToSurfacePoint(0, 0, -5, out)).toBe(false);
        expect(cam._worldToSurfacePoint(0, 0, 0, out)).toBe(false);
    });
});
