import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";

/**
 * Two things a host embedding scenario content asked the engine for.
 *
 * A scenario is arbitrary engine code, so a host that merely refrains from
 * calling `showOverlay` has decided nothing — the shipped `solar-system`
 * scenario calls it itself and put a developer overlay of FPS and VRAM counters
 * in front of students. And a host verifying a KTX2 pipeline could only infer
 * whether transcoding happened, by comparing VRAM against what an uncompressed
 * fallback would give, because the report named no format.
 */

vi.stubGlobal("document", {
    createElement: () => ({
        width: 0,
        height: 0,
        style: {},
        dataset: {},
        appendChild: () => {},
        addEventListener: () => {},
        remove: () => {},
        getContext: () => null,
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { appendChild: () => {} },
});

const { MemoryProfiler } = await import("../src/engine/core/diagnostics/MemoryProfiler");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { textureFormatName } = await import("../src/engine/core/graphics/_TextureMemory");

/** A renderer stub, so `snapshot().renderer` is populated at all. */
function installRenderer(): void {
    (globalThis as Record<string, unknown>).__webengine_application__ = {
        _internalThreeRenderer: {
            info: { memory: { textures: 0, geometries: 0 }, render: { calls: 0, triangles: 0 } },
        },
    };
}

beforeEach(() => {
    MemoryProfiler.diagnosticsAllowed = true;
    installRenderer();
});

afterEach(() => {
    MemoryProfiler.diagnosticsAllowed = true;
    delete (globalThis as Record<string, unknown>).__webengine_application__;
});

describe("MemoryProfiler.diagnosticsAllowed", () => {
    test("it is open unless a host closes it", () => {
        expect(MemoryProfiler.diagnosticsAllowed).toBe(true);
    });

    test("a closed deployment cannot be shown an overlay", () => {
        MemoryProfiler.diagnosticsAllowed = false;

        // What scenario code would call.
        MemoryProfiler.showOverlay();

        expect(MemoryProfiler.isOverlayVisible).toBe(false);
    });

    test("and cannot be toggled into one either", () => {
        MemoryProfiler.diagnosticsAllowed = false;

        MemoryProfiler.toggleOverlay();
        MemoryProfiler.enableToggle();

        expect(MemoryProfiler.isOverlayVisible).toBe(false);
    });

    test("closing it reports closed", () => {
        MemoryProfiler.diagnosticsAllowed = false;
        expect(MemoryProfiler.diagnosticsAllowed).toBe(false);
    });

    test("the numbers stay readable — only the panel is withheld", () => {
        // A host may well want the report without putting anything on screen.
        MemoryProfiler.diagnosticsAllowed = false;

        expect(MemoryProfiler.snapshot().renderer).not.toBeNull();
    });
});

describe("textureFormatName", () => {
    const compressed = (format: number) =>
        new THREE.CompressedTexture(
            [] as unknown as ImageData[], 4, 4,
            format as THREE.CompressedPixelFormat, THREE.UnsignedByteType,
        );

    test("names the transcode targets a device might pick", () => {
        expect(textureFormatName(compressed(THREE.RGBA_BPTC_Format))).toBe("BC7");
        expect(textureFormatName(compressed(THREE.RGBA_ETC2_EAC_Format))).toBe("ETC2");
        expect(textureFormatName(compressed(THREE.RGBA_ASTC_4x4_Format))).toBe("ASTC 4x4");
        expect(textureFormatName(compressed(THREE.RGBA_S3TC_DXT5_Format))).toBe("BC3");
    });

    test("an uncompressed texture reports its pixel layout", () => {
        const plain = new THREE.Texture();
        plain.format = THREE.RGBAFormat;
        plain.type = THREE.UnsignedByteType;

        // The value that means "this KTX2 asset did not transcode".
        expect(textureFormatName(plain)).toBe("RGBA8");
    });

    test("a float target is named as one", () => {
        const hdr = new THREE.Texture();
        hdr.format = THREE.RGBAFormat;
        hdr.type = THREE.HalfFloatType;

        expect(textureFormatName(hdr)).toBe("RGBA16F");
    });

    test("an unknown compressed format is still reported as compressed", () => {
        expect(textureFormatName(compressed(0x9999))).toBe("compressed");
    });
});

describe("MemoryReport.renderer.textureFormats", () => {
    test("it tallies the live textures by what they actually became", () => {
        const bc7 = new THREE.CompressedTexture(
            [] as unknown as ImageData[], 64, 64, THREE.RGBA_BPTC_Format, THREE.UnsignedByteType,
        );
        const transcoded = Texture2D._fromThreeTexture(bc7);

        const tally = MemoryProfiler.snapshot().renderer!.textureFormats;

        expect(tally["BC7"]).toBeGreaterThanOrEqual(1);
        transcoded.destroyImmediate();
    });

    test("a texture that did not transcode shows up as uncompressed", () => {
        const plain = new THREE.Texture({ width: 64, height: 64 } as unknown as HTMLImageElement);
        plain.format = THREE.RGBAFormat;
        plain.type = THREE.UnsignedByteType;
        const wrapped = Texture2D._fromThreeTexture(plain);

        const tally = MemoryProfiler.snapshot().renderer!.textureFormats;

        expect(tally["RGBA8"]).toBeGreaterThanOrEqual(1);
        wrapped.destroyImmediate();
    });
});
