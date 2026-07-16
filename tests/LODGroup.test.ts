import { describe, test, expect } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { LODGroup } from "../src/engine/core/components/LODGroup";
import { Camera } from "../src/engine/core/components/Camera";
import { MeshRenderer } from "../src/engine/core/rendering/MeshRenderer";
import { Vector3 } from "../src/engine/core/math/Vector3";

function makeRenderer(name: string): MeshRenderer {
    return new GameObject(name).addComponent(MeshRenderer);
}

describe("LODGroup", () => {
    test("computeRelativeHeight = size / frustum height, and shrinks with distance", () => {
        // frustum height at d=1, fov=60 is 2*tan(30°) ≈ 1.1547 → 1/1.1547 ≈ 0.866
        expect(LODGroup.computeRelativeHeight(1, 1, 60)).toBeCloseTo(0.86603, 3);
        expect(LODGroup.computeRelativeHeight(1, 2, 60)).toBeLessThan(
            LODGroup.computeRelativeHeight(1, 1, 60),
        );
        expect(LODGroup.computeRelativeHeight(1, 0, 60)).toBe(Infinity);
    });

    test("selects the level matching on-screen size and culls when tiny", () => {
        const camGO = new GameObject("Cam");
        camGO.tag = "MainCamera";
        const cam = camGO.addComponent(Camera);
        cam.fieldOfView = 60;

        const target = new GameObject("LODTarget");
        const group = target.addComponent(LODGroup);
        group.size = 1;

        const r0 = makeRenderer("high");
        const r1 = makeRenderer("mid");
        const r2 = makeRenderer("low");
        group.setLODs([
            { screenRelativeTransitionHeight: 0.5, renderers: [r0] },
            { screenRelativeTransitionHeight: 0.2, renderers: [r1] },
            { screenRelativeTransitionHeight: 0.05, renderers: [r2] },
        ]);

        // Hidden until first evaluation.
        expect(r0.enabled).toBe(false);
        expect(group.currentLOD).toBe(-1);

        // d=1 → relHeight ≈ 0.866 → LOD0 (highest detail).
        target.transform.position = new Vector3(0, 0, 1);
        LODGroup._updateAll();
        expect(group.currentLOD).toBe(0);
        expect([r0.enabled, r1.enabled, r2.enabled]).toEqual([true, false, false]);

        // d=10 → relHeight ≈ 0.0866 → LOD2 (lowest detail).
        target.transform.position = new Vector3(0, 0, 10);
        LODGroup._updateAll();
        expect(group.currentLOD).toBe(2);
        expect([r0.enabled, r1.enabled, r2.enabled]).toEqual([false, false, true]);

        // d=40 → relHeight ≈ 0.0217 → below smallest threshold → culled.
        target.transform.position = new Vector3(0, 0, 40);
        LODGroup._updateAll();
        expect(group.currentLOD).toBe(-1);
        expect([r0.enabled, r1.enabled, r2.enabled]).toEqual([false, false, false]);
    });

    test("setLODs sorts levels by transition height descending", () => {
        const group = new GameObject("g").addComponent(LODGroup);
        group.setLODs([
            { screenRelativeTransitionHeight: 0.05, renderers: [] },
            { screenRelativeTransitionHeight: 0.5, renderers: [] },
            { screenRelativeTransitionHeight: 0.2, renderers: [] },
        ]);
        const heights = group.getLODs().map(l => l.screenRelativeTransitionHeight);
        expect(heights).toEqual([0.5, 0.2, 0.05]);
    });
});
