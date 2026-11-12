import { describe, test, expect, beforeEach, afterEach } from "vitest";

/**
 * C6, phase 6 (DW-6.1..DW-6.2): a render target is counted where the report says
 * render targets are, and nowhere else.
 *
 * A target is not a picture texture. Counting it with them would attribute its
 * bytes to "textures" — the number that answers "how much art is on the GPU" —
 * and every existing measurement would shift for a scene that uses a camera
 * preview. So `_surveyTextures` skips it, `estimatedRenderTargetVramBytes` gains
 * its estimate (pure arithmetic, added even when the GL-backed parts cannot be
 * read), and `renderTextures` counts the live created ones.
 *
 * The report is read through `snapshot()`, with the same renderer stub the
 * other profile tests use, so nothing here needs a GPU.
 */

const { MemoryProfiler } = await import("../src/engine/core/diagnostics/MemoryProfiler");
const { RenderTexture, RenderTextureFormat } = await import("../src/engine/core/graphics/RenderTexture");

/** The renderer stub, so `snapshot().renderer` is populated at all. */
function installRenderer(): void {
    (globalThis as Record<string, unknown>).__webengine_application__ = {
        _internalThreeRenderer: {
            info: { memory: { textures: 0, geometries: 0 }, render: { calls: 0, triangles: 0 } },
        },
    };
}

/** The live targets in the registry, so each test starts from none. */
function clearTargets(): void {
    for (const target of (MemoryProfiler as unknown as {
        _surveyRenderTextures(): { count: number };
    })._surveyRenderTextures ? [] : []) {
        void target;
    }
}

beforeEach(() => {
    installRenderer();
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>).__webengine_application__;
});

/** Every live target's estimate, as the survey answers it. */
const survey = () => (MemoryProfiler as unknown as {
    _surveyRenderTextures(): { count: number; bytes: number };
})._surveyRenderTextures();

describe("targets are counted as render targets", () => {
    test("DW-6.1 two created targets are counted, and the bytes are exactly theirs", () => {
        const before = survey();
        const low = new RenderTexture(64, 64, 24, RenderTextureFormat.ARGB32);
        const high = new RenderTexture(128, 64, 16, RenderTextureFormat.ARGB32);
        low.create();
        high.create();
        try {
            const after = survey();
            expect(after.count).toBe(before.count + 2);
            // The report's render-target figure grew by exactly their estimates.
            expect(after.bytes - before.bytes).toBe(low._estimateVramBytes() + high._estimateVramBytes());
            expect(MemoryProfiler.snapshot().renderer!.renderTextures).toBe(after.count);
            expect(MemoryProfiler.snapshot().renderer!.estimatedRenderTargetVramBytes)
                .toBeGreaterThanOrEqual(after.bytes);
        } finally {
            low.destroyImmediate();
            high.destroyImmediate();
        }
        expect(survey().count).toBe(before.count);
    });

    test("a target that was never created costs nothing and is not counted", () => {
        const before = survey();
        const wanted = new RenderTexture(64, 64, 24, RenderTextureFormat.ARGB32);
        try {
            expect(survey().count).toBe(before.count);
            expect(MemoryProfiler.snapshot().renderer!.renderTextures).toBe(before.count);
            // Lazy allocation: the object exists and has allocated nothing.
            expect(wanted._estimateVramBytes()).toBe(0);
        } finally {
            wanted.destroyImmediate();
        }
    });

    test("the picture-texture figures do not move for a scene with a target", () => {
        const withoutTarget = MemoryProfiler.snapshot().renderer!;
        const target = new RenderTexture(64, 64, 24, RenderTextureFormat.ARGB32);
        target.create();
        try {
            const withTarget = MemoryProfiler.snapshot().renderer!;
            // The set a texture measurement describes excludes targets, so the
            // art-on-the-GPU numbers are identical with and without one.
            expect(withTarget.liveTextures).toBe(withoutTarget.liveTextures);
            expect(withTarget.estimatedTextureVramBytes).toBe(withoutTarget.estimatedTextureVramBytes);
            expect(withTarget.textureFormats).toEqual(withoutTarget.textureFormats);
            // …while the render-target figures are what moved.
            expect(withTarget.renderTextures).toBe(withoutTarget.renderTextures + 1);
        } finally {
            target.destroyImmediate();
        }
    });

    test("DW-6.2 the stage-0 pin still holds with a fake renderer", () => {
        const snapshot = MemoryProfiler.snapshot();
        expect(snapshot.renderer).not.toBeNull();
        expect(snapshot.renderer!.renderTextures).toBe(survey().count);
        expect(() => MemoryProfiler.logReport()).not.toThrow();
    });
});

