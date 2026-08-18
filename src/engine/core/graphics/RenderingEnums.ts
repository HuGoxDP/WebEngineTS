/**
 * Every enum the rendering system uses.
 * Collected here because they are shared across components and classes.
 */

// ==================== MESH ====================

/**
 * Mesh topology — what kind of primitive the indices describe.
 */
export enum MeshTopology {
    Triangles = 0,    // Triangles — 3 vertices per primitive.
    Quads = 1,        // Quads — 4 vertices per primitive.
    Lines = 2,        // Lines — 2 vertices per primitive.
    LineStrip = 3,    // A connected run of lines.
    Points = 4        // Points — 1 vertex per primitive.
}

/**
 * Mesh index format.
 */
export enum IndexFormat {
    UInt16 = 0,  // 16-bit indices — up to 65,535 vertices.
    UInt32 = 1   // 32-bit indices — up to 4,294,967,295 vertices.
}

// ==================== TEXTURE ====================

/**
 * Texture colour format.
 */
export enum TextureFormat {
    RGBA32 = 0,      // 32-bit RGBA — 8 bits per channel.
    RGB24 = 1,       // 24-bit RGB
    Alpha8 = 2,      // 8-bit alpha
    ARGB32 = 3,      // 32-bit ARGB
    RGB565 = 4,      // 16-bit RGB
    R16 = 5,         // 16-bit single channel
    RFloat = 6,      // 32-bit float single channel
    RGFloat = 7,     // 64-bit float dual channel
    RGBAFloat = 8,   // 128-bit float RGBA (HDR)
}

/**
 * Render-texture format.
 */
export enum RenderTextureFormat {
    ARGB32 = 0,
    Depth = 1,
    ARGBHalf = 2,    // 64-bit HDR
    ARGBFloat = 3,   // 128-bit HDR
    RGFloat = 4,
    RGHalf = 5,
    RFloat = 6,
    RHalf = 7,
    R8 = 8,
}

/**
 * A face of a cubemap.
 */
export enum CubemapFace {
    PositiveX = 0,  // Right.
    NegativeX = 1,  // Left.
    PositiveY = 2,  // Top.
    NegativeY = 3,  // Bottom.
    PositiveZ = 4,  // Front.
    NegativeZ = 5   // Back.
}

// ==================== MATERIAL ====================

/**
 * Render queue — the order things are drawn in.
 */
export enum RenderQueue {
    Background = 1000,      // Background, such as a skybox.
    Geometry = 2000,        // Ordinary opaque geometry.
    AlphaTest = 2450,       // Geometry with an alpha cutoff.
    Transparent = 3000,     // Transparent objects.
    Overlay = 4000          // UI and overlays.
}

/**
 * How a material is rendered.
 */
export enum MaterialRenderMode {
    Opaque = 0,         // Fully opaque.
    Cutout = 1,         // Alpha cutoff — pixels below the threshold are discarded.
    Fade = 2,           // Fade transparency (alpha blending, z-write off)
    Transparent = 3     // Transparent (alpha blending, z-write on)
}

// ==================== RENDERER ====================

/**
 * Whether and how a renderer casts shadows.
 */
export enum ShadowCastingMode {
    Off = 0,           // Casts no shadow.
    On = 1,            // Casts a shadow.
    TwoSided = 2,      // Casts from both sides of each polygon.
    ShadowsOnly = 3    // Casts a shadow but is not drawn itself.
}

/**
 * How a renderer samples light probes.
 */
export enum LightProbeUsage {
    Off = 0,                // No light probes.
    BlendProbes = 1,        // Blend the nearest probes.
    UseProxyVolume = 2,     // Use a proxy volume.
    CustomProvided = 3      // Probe data supplied by the caller.
}

/**
 * How a renderer samples reflection probes.
 */
export enum ReflectionProbeUsage {
    Off = 0,           // No reflection probes.
    BlendProbes = 1,   // Blend the nearest probes.
    Simple = 2         // Use the nearest probe only.
}

// ==================== CAMERA ====================

/**
 * What a camera clears before it draws.
 */
export enum CameraClearFlags {
    Skybox = 0,       // Draw the skybox.
    SolidColor = 1,   // Fill with a solid colour.
    Depth = 2,        // Clear the depth buffer only.
    Nothing = 3       // Clear nothing — for overlay cameras.
}

/**
 * Camera projection type.
 */
export enum CameraType {
    Perspective = 0,   // Perspective projection.
    Orthographic = 1   // Orthographic projection.
}

// ==================== LIGHT ====================

/**
 * Light type.
 */
export enum LightType {
    Directional = 0,  // Directional, like the sun.
    Point = 1,        // Point, like a bulb.
    Spot = 2,         // Spotlight.
    Area = 3          // Area light — expensive, and awkward in WebGL.
}

/**
 * The kind of shadow a light casts.
 */
export enum LightShadows {
    None = 0,     // No shadows.
    Hard = 1,     // Hard-edged shadows.
    Soft = 2      // Soft shadows, via PCF.
}

/**
 * How a light is evaluated.
 */
export enum LightRenderMode {
    Auto = 0,          // Let the renderer choose.
    ForcePixel = 1,    // Force per-pixel lighting.
    ForceVertex = 2    // Force per-vertex lighting.
}

// ==================== SPRITE ====================

/**
 * How a sprite is drawn.
 */
export enum SpriteDrawMode {
    Simple = 0,    // Drawn as-is.
    Sliced = 1,    // 9-slice.
    Tiled = 2      // Tiled.
}

/**
 * How a sprite interacts with a mask.
 */
export enum SpriteMaskInteraction {
    None = 0,              // Ignores masks.
    VisibleInsideMask = 1, // Visible inside the mask.
    VisibleOutsideMask = 2 // Visible outside the mask.
}
