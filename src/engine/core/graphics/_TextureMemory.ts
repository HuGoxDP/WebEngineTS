// path: src/engine/core/graphics/_TextureMemory.ts
//
// @internal — GPU (VRAM) memory estimation for textures.
//
// This module is the single place that knows how a THREE texture format maps
// to bytes-per-texel. It is NEVER exported from the public barrel (index.ts):
// it exists only so the diagnostics subsystem can report an estimated VRAM
// figure — the primary benefit of KTX2/Basis compression, which the JS-heap
// metric cannot show (compressed textures stay compressed in VRAM, whereas an
// uncompressed image is uploaded as RGBA8 at 4 bytes/texel).

import * as THREE from "three";

/**
 * @internal
 * Bits-per-texel for a compressed THREE format constant.
 *
 * Values follow the block sizes of each GPU format: block-compressed formats
 * store a fixed number of bits per NxM texel block, giving a constant
 * bits-per-texel. For ASTC, bpp = 128 / (blockW * blockH).
 */
function compressedBitsPerTexel(format: number): number {
    switch (format) {
        // S3TC / DXT (BC1..BC3)
        case THREE.RGB_S3TC_DXT1_Format:
        case THREE.RGBA_S3TC_DXT1_Format:
            return 4;
        case THREE.RGBA_S3TC_DXT3_Format:
        case THREE.RGBA_S3TC_DXT5_Format:
            return 8;

        // BPTC (BC6H / BC7) — the common UASTC → BC7 transcode target on desktop
        case THREE.RGBA_BPTC_Format:
        case THREE.RGB_BPTC_SIGNED_Format:
        case THREE.RGB_BPTC_UNSIGNED_Format:
            return 8;

        // RGTC (BC4 / BC5)
        case THREE.RED_RGTC1_Format:
        case THREE.SIGNED_RED_RGTC1_Format:
            return 4;
        case THREE.RED_GREEN_RGTC2_Format:
        case THREE.SIGNED_RED_GREEN_RGTC2_Format:
            return 8;

        // ETC (older Android / integrated GPUs)
        case THREE.RGB_ETC1_Format:
        case THREE.RGB_ETC2_Format:
            return 4;
        case THREE.RGBA_ETC2_EAC_Format:
            return 8;

        // PVRTC (legacy iOS)
        case THREE.RGB_PVRTC_2BPPV1_Format:
        case THREE.RGBA_PVRTC_2BPPV1_Format:
            return 2;
        case THREE.RGB_PVRTC_4BPPV1_Format:
        case THREE.RGBA_PVRTC_4BPPV1_Format:
            return 4;

        // ASTC — bpp = 128 / (blockW * blockH)
        case THREE.RGBA_ASTC_4x4_Format: return 8;
        case THREE.RGBA_ASTC_5x4_Format: return 6.4;
        case THREE.RGBA_ASTC_5x5_Format: return 5.12;
        case THREE.RGBA_ASTC_6x5_Format: return 4.27;
        case THREE.RGBA_ASTC_6x6_Format: return 3.56;
        case THREE.RGBA_ASTC_8x5_Format: return 3.2;
        case THREE.RGBA_ASTC_8x6_Format: return 2.67;
        case THREE.RGBA_ASTC_8x8_Format: return 2;
        case THREE.RGBA_ASTC_10x5_Format: return 2.56;
        case THREE.RGBA_ASTC_10x6_Format: return 2.13;
        case THREE.RGBA_ASTC_10x8_Format: return 1.6;
        case THREE.RGBA_ASTC_10x10_Format: return 1.28;
        case THREE.RGBA_ASTC_12x10_Format: return 1.07;
        case THREE.RGBA_ASTC_12x12_Format: return 0.89;

        // Unknown compressed format — assume the BC7 / ASTC-4x4 class (8 bpp).
        default:
            return 8;
    }
}

/** @internal Number of stored channels for an uncompressed THREE format. */
function formatChannels(format: number): number {
    switch (format) {
        case THREE.AlphaFormat:
        case THREE.RedFormat:
        case THREE.RedIntegerFormat:
            return 1;
        case THREE.RGFormat:
        case THREE.RGIntegerFormat:
            return 2;
        case THREE.RGBAFormat:
        case THREE.RGBAIntegerFormat:
            return 4;
        // RGB formats are uploaded as RGBA8 by WebGL2; treat as 4 channels.
        default:
            return 4;
    }
}

/** @internal Bytes per channel for a THREE data type. */
function typeBytesPerChannel(type: number): number {
    switch (type) {
        case THREE.ByteType:
        case THREE.UnsignedByteType:
            return 1;
        case THREE.ShortType:
        case THREE.UnsignedShortType:
        case THREE.HalfFloatType:
            return 2;
        case THREE.IntType:
        case THREE.UnsignedIntType:
        case THREE.FloatType:
            return 4;
        default:
            return 1;
    }
}

/**
 * @internal
 * Estimates the VRAM footprint of a THREE texture, in bytes.
 *
 * The figure is an estimate: exact GPU allocation depends on driver padding,
 * internal format promotion, and mip rounding. It is accurate enough to make
 * the compressed-vs-uncompressed difference visible, which is its purpose.
 *
 * @param tex    — the backing THREE texture (may be a CompressedTexture).
 * @param width  — texel width (caller resolves; cached dims survive source-image release).
 * @param height — texel height.
 * @param faces  — 1 for a 2D texture, 6 for a cube texture.
 * @returns estimated bytes resident in VRAM, or 0 if dimensions are unknown.
 */
export function estimateThreeTextureVramBytes(
    tex: THREE.Texture | null | undefined,
    width: number,
    height: number,
    faces: number = 1,
): number {
    if (!tex || width <= 0 || height <= 0) return 0;

    const isCompressed = (tex as THREE.CompressedTexture).isCompressedTexture === true;
    const bitsPerTexel = isCompressed
        ? compressedBitsPerTexel(tex.format)
        : formatChannels(tex.format) * typeBytesPerChannel(tex.type) * 8;

    let bytes = (width * height * bitsPerTexel) / 8;

    // A full mip chain adds ~1/3 to the base level.
    const hasMipChain = tex.generateMipmaps || (tex.mipmaps?.length ?? 0) > 1;
    if (hasMipChain) bytes *= 4 / 3;

    return Math.round(bytes * Math.max(1, faces));
}
