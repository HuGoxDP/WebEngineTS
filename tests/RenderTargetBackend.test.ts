import { describe, test, expect } from "vitest";
import {
    _clearPlan,
    _targetViewport,
} from "../src/engine/core/rendering/WebGLRenderBackend";
import { CameraClearFlags } from "../src/engine/core/components/Camera";

/**
 * C6, phase 2 (DW-2.1..DW-2.3): the render-target seam's decisions, without GL.
 *
 * The GL call sequence of a target render is not checkable here — there is no
 * context in a unit test — so everything that can be decided without one has
 * been pulled out as a pure function: the clear a camera's flags ask for, and
 * the viewport its `rect` becomes in a target's pixels. What is left in
 * `_renderToTarget` is the order of GL calls, which the Full gate pins by review
 * (the `target == null` branch is byte-identical to `06aeaf5`; every state change
 * in the target branch is restored in a `finally`).
 */

describe("what a target render clears (D6)", () => {
    test("SolidColor clears colour and depth", () => {
        expect(_clearPlan(CameraClearFlags.SolidColor))
            .toEqual({ color: true, depth: true, stencil: false, skybox: false });
    });

    test("Skybox clears depth and lets the skybox carry the background", () => {
        expect(_clearPlan(CameraClearFlags.Skybox))
            .toEqual({ color: false, depth: true, stencil: false, skybox: true });
    });

    test("Depth clears depth only", () => {
        expect(_clearPlan(CameraClearFlags.Depth))
            .toEqual({ color: false, depth: true, stencil: false, skybox: false });
    });

    test("Nothing clears nothing at all", () => {
        expect(_clearPlan(CameraClearFlags.Nothing))
            .toEqual({ color: false, depth: false, stencil: false, skybox: false });
    });

    test("an unknown flag falls back to SolidColor rather than clearing nothing by surprise", () => {
        expect(_clearPlan(99 as CameraClearFlags).color).toBe(true);
        expect(_clearPlan(99 as CameraClearFlags).depth).toBe(true);
    });
});

describe("a camera's rect in a target's pixels (D6)", () => {
    const FULL = { x: 0, y: 0, width: 1, height: 1 };

    test("the full rect covers the target with the scissor off", () => {
        expect(_targetViewport(FULL, 256, 128)).toEqual({ x: 0, y: 0, width: 256, height: 128, scissor: false });
    });

    test("a sub-rect is scaled to pixels and enables the scissor", () => {
        expect(_targetViewport({ x: 0.5, y: 0, width: 0.5, height: 1 }, 256, 128))
            .toEqual({ x: 128, y: 0, width: 128, height: 128, scissor: true });
    });

    test("a rect anchored at the top resolves from the top edge", () => {
        expect(_targetViewport({ x: 0, y: 0.5, width: 1, height: 0.25 }, 64, 64))
            .toEqual({ x: 0, y: 32, width: 64, height: 16, scissor: true });
    });

    test("a zero-size rect draws nothing, and never a GL error", () => {
        expect(_targetViewport({ x: 0, y: 0, width: 0, height: 1 }, 64, 64).width).toBe(0);
        expect(_targetViewport({ x: 0, y: 0, width: 1, height: 0 }, 64, 64).height).toBe(0);
        expect(_targetViewport(FULL, 0, 0).width).toBe(0);
    });

    test("fractions round to pixels, and the edges add up to the target", () => {
        // 0.33 * 300 = 99, 0.67 * 300 = 201: 99 + 201 = 300, no seam.
        expect(_targetViewport({ x: 0.33, y: 0.33, width: 0.67, height: 0.67 }, 300, 300))
            .toEqual({ x: 99, y: 99, width: 201, height: 201, scissor: true });
    });
});
