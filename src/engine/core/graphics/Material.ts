// path: src/engine/core/graphics/Material.ts

import * as THREE from "three";
import { EngineObject } from "../EngineObject.ts";
import { Shader } from "./Shader.ts";
import { Color } from "../math/Color.ts";
import { Texture } from "./Texture.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Vector4 } from "../math/Vector4.ts";
import { Matrix4x4 } from "../math/Matrix4x4.ts";

// ==================== PROPERTY VALUE TYPE ====================

/**
 * Union of all types that can be stored as a material property.
 * Used instead of `any` for the internal property map.
 */
type MaterialPropertyValue = number | Color | Vector4 | Matrix4x4 | Texture | null;

// ==================== MATERIAL CLASS ====================

/**
 * Base class for all materials.
 *
 * A Material stores shader properties (colors, floats, textures, vectors,
 * matrices) and a reference to a {@link Shader}. Internally it manages a
 * `THREE.Material` that mirrors engine state, but users never interact
 * with Three.js directly.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Material`.
 *
 * **Shared vs Instance semantics:**
 * - `renderer.sharedMaterial` — the shared asset (editing affects all users).
 * - `renderer.material` — auto-clones on first access (editing is per-object).
 *
 * @example
 * ```ts
 * const mat = new Material(Shader.Standard);
 * mat.color = Color.red;
 * mat.mainTexture = myTexture;
 * renderer.sharedMaterial = mat;
 * ```
 */
export class Material extends EngineObject {

    // ==================== PRIVATE FIELDS ====================

    /**
     * The underlying Three.js material.
     * @internal — NEVER expose to engine users.
     */
    protected _threeMatHandle: THREE.Material;

    /** The shader defining which Three.js material type to use. */
    private _shader: Shader;

    /** Render queue priority (lower = earlier). Default 2000 (Geometry). */
    private _renderQueue: number = 2000;

    /** Active shader keywords. */
    private _keywords: Set<string> = new Set();

    /** Custom property store (shader property name → value). */
    private _properties: Map<string, MaterialPropertyValue> = new Map();

    // ==================== CONSTRUCTOR ====================

    /**
     * Creates a new material with the given shader.
     * @param shader — the shader (e.g. `Shader.Standard`, `Shader.Unlit`).
     */
    constructor(shader: Shader);

    /**
     * Creates a copy of an existing material.
     * @param source — the material to copy.
     */
    constructor(source: Material);

    constructor(shaderOrSource: Shader | Material) {
        super("Material");

        if (shaderOrSource instanceof Material) {
            // ---- COPY FROM MATERIAL ----
            const source = shaderOrSource;
            this._shader = source._shader;
            this._renderQueue = source._renderQueue;
            this._keywords = new Set(source._keywords);
            this._properties = Material._deepCloneProperties(source._properties);
            this._threeMatHandle = source._threeMatHandle.clone();
            this.name = source.name + " (Instance)";
        } else {
            // ---- CREATE FROM SHADER ----
            this._shader = shaderOrSource;
            this._threeMatHandle = Material._createThreeMaterial(this._shader);
            this.name = `Material (${this._shader.shaderName})`;
        }
    }

    // ==================== INTERNAL THREE.JS ACCESSORS ====================

    /**
     * @internal
     * The underlying Three.js material handle.
     *
     * Used by:
     * - {@link Renderer} — to assign material to Three.js mesh
     * - {@link StandardMaterial} — subclass accesses via `protected _threeMatHandle`
     *
     * **NEVER use in user-facing code.**
     */
    public get _internalThreeMaterial(): THREE.Material {
        return this._threeMatHandle;
    }

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * The shader used by this material.
     *
     * Changing the shader recreates the internal Three.js material
     * and preserves basic settings (transparency).
     *
     * @remarks Equivalent to Unity's `Material.shader`.
     */
    public get shader(): Shader {
        return this._shader;
    }

    public set shader(value: Shader) {
        if (this._shader === value) return;

        this._shader = value;
        const oldMat = this._threeMatHandle;
        this._threeMatHandle = Material._createThreeMaterial(value);

        // Preserve basic rendering state
        this._threeMatHandle.transparent = oldMat.transparent;

        oldMat.dispose();
    }

    /**
     * Main color (`_Color` property).
     * @remarks Equivalent to Unity's `Material.color`.
     */
    public get color(): Color {
        return this.getColor("_Color");
    }

    public set color(value: Color) {
        this.setColor("_Color", value);
    }

    /**
     * Main texture (`_MainTex` property).
     * @remarks Equivalent to Unity's `Material.mainTexture`.
     */
    public get mainTexture(): Texture | null {
        return this.getTexture("_MainTex");
    }

    public set mainTexture(value: Texture | null) {
        this.setTexture("_MainTex", value);
    }

    /**
     * UV offset of the main texture.
     * @remarks Equivalent to Unity's `Material.mainTextureOffset`.
     */
    public get mainTextureOffset(): Vector2 {
        return this.getTextureOffset("_MainTex");
    }

    public set mainTextureOffset(value: Vector2) {
        this.setTextureOffset("_MainTex", value);
    }

    /**
     * UV scale (tiling) of the main texture.
     * @remarks Equivalent to Unity's `Material.mainTextureScale`.
     */
    public get mainTextureScale(): Vector2 {
        return this.getTextureScale("_MainTex");
    }

    public set mainTextureScale(value: Vector2) {
        this.setTextureScale("_MainTex", value);
    }

    /**
     * Render queue priority.
     * @remarks Equivalent to Unity's `Material.renderQueue`.
     */
    public get renderQueue(): number {
        return this._renderQueue;
    }

    public set renderQueue(value: number) {
        this._renderQueue = value;
    }

    // ==================== PROPERTY ACCESSORS ====================

    /**
     * Returns true if this material has the named property.
     * @param propertyName — Unity-style name (e.g. `"_Color"`, `"_MainTex"`).
     */
    public hasProperty(propertyName: string): boolean {
        return this._shader.hasProperty(propertyName) || this._properties.has(propertyName);
    }

    // ---- Color ----

    /**
     * Gets a color property.
     * @param propertyName — e.g. `"_Color"`, `"_EmissionColor"`.
     * @returns the color value, or white if not set.
     */
    public getColor(propertyName: string): Color {
        const value = this._properties.get(propertyName);
        if (value instanceof Color) {
            return value.clone();
        }
        return Color.white;
    }

    /**
     * Sets a color property and syncs to the Three.js material.
     * @param propertyName — e.g. `"_Color"`, `"_EmissionColor"`, `"_SpecColor"`.
     * @param value — the color value.
     */
    public setColor(propertyName: string, value: Color): void {
        this._properties.set(propertyName, value.clone());
        this._syncColorToThree(propertyName, value);
    }

    // ---- Float ----

    /**
     * Gets a float property.
     * @param propertyName — e.g. `"_Metallic"`, `"_Glossiness"`.
     * @returns the float value, or 0 if not set.
     */
    public getFloat(propertyName: string): number {
        const value = this._properties.get(propertyName);
        return typeof value === "number" ? value : 0;
    }

    /**
     * Sets a float property and syncs to the Three.js material.
     * @param propertyName — e.g. `"_Metallic"`, `"_Glossiness"`, `"_BumpScale"`.
     * @param value — the float value.
     */
    public setFloat(propertyName: string, value: number): void {
        this._properties.set(propertyName, value);
        this._syncFloatToThree(propertyName, value);
    }

    // ---- Int ----

    /**
     * Gets an integer property.
     * @param propertyName — the property name.
     * @returns the integer value, or 0 if not set.
     */
    public getInt(propertyName: string): number {
        return Math.floor(this.getFloat(propertyName));
    }

    /**
     * Sets an integer property.
     * @param propertyName — the property name.
     * @param value — the integer value.
     */
    public setInt(propertyName: string, value: number): void {
        this.setFloat(propertyName, Math.floor(value));
    }

    // ---- Vector4 ----

    /**
     * Gets a Vector4 property.
     * @param propertyName — the property name.
     * @returns the vector, or Vector4.zero if not set.
     */
    public getVector(propertyName: string): Vector4 {
        const value = this._properties.get(propertyName);
        if (value instanceof Vector4) {
            return value.clone();
        }
        return Vector4.zero;
    }

    /**
     * Sets a Vector4 property.
     * @param propertyName — the property name.
     * @param value — the vector value.
     */
    public setVector(propertyName: string, value: Vector4): void {
        this._properties.set(propertyName, value.clone());
    }

    // ---- Matrix4x4 ----

    /**
     * Gets a Matrix4x4 property.
     * @param propertyName — the property name.
     * @returns the matrix, or identity if not set.
     */
    public getMatrix(propertyName: string): Matrix4x4 {
        const value = this._properties.get(propertyName);
        if (value instanceof Matrix4x4) {
            return value.clone();
        }
        return Matrix4x4.identity;
    }

    /**
     * Sets a Matrix4x4 property.
     * @param propertyName — the property name.
     * @param value — the matrix value.
     */
    public setMatrix(propertyName: string, value: Matrix4x4): void {
        this._properties.set(propertyName, value.clone());
    }

    // ---- Texture ----

    /**
     * Gets a texture property.
     * @param propertyName — e.g. `"_MainTex"`, `"_BumpMap"`.
     * @returns the texture, or null if not set.
     */
    public getTexture(propertyName: string): Texture | null {
        const value = this._properties.get(propertyName);
        if (value instanceof Texture) {
            return value;
        }
        return null;
    }

    /**
     * Sets a texture property and syncs to the Three.js material.
     * @param propertyName — e.g. `"_MainTex"`, `"_BumpMap"`, `"_MetallicGlossMap"`.
     * @param value — the texture, or null to clear.
     */
    public setTexture(propertyName: string, value: Texture | null): void {
        this._properties.set(propertyName, value);
        this._syncTextureToThree(propertyName, value);
    }

    // ---- Texture Offset / Scale ----

    /**
     * Gets the UV offset of a texture property.
     * @param propertyName — texture property name.
     */
    public getTextureOffset(propertyName: string): Vector2 {
        const texture = this.getTexture(propertyName);
        if (texture) {
            const offset = texture._internalThreeTexture.offset;
            return new Vector2(offset.x, offset.y);
        }
        return Vector2.zero;
    }

    /**
     * Sets the UV offset of a texture property.
     * @param propertyName — texture property name.
     * @param value — the offset vector.
     */
    public setTextureOffset(propertyName: string, value: Vector2): void {
        const texture = this.getTexture(propertyName);
        if (texture) {
            texture.setOffset(value.x, value.y);
        }
    }

    /**
     * Gets the UV tiling (scale) of a texture property.
     * @param propertyName — texture property name.
     */
    public getTextureScale(propertyName: string): Vector2 {
        const texture = this.getTexture(propertyName);
        if (texture) {
            const repeat = texture._internalThreeTexture.repeat;
            return new Vector2(repeat.x, repeat.y);
        }
        return Vector2.one;
    }

    /**
     * Sets the UV tiling (scale) of a texture property.
     * @param propertyName — texture property name.
     * @param value — the scale vector.
     */
    public setTextureScale(propertyName: string, value: Vector2): void {
        const texture = this.getTexture(propertyName);
        if (texture) {
            texture.setTiling(value.x, value.y);
        }
    }

    // ==================== KEYWORDS ====================

    /**
     * Enables a shader keyword.
     * @param keyword — the keyword to enable.
     */
    public enableKeyword(keyword: string): void {
        this._keywords.add(keyword);
    }

    /**
     * Disables a shader keyword.
     * @param keyword — the keyword to disable.
     */
    public disableKeyword(keyword: string): void {
        this._keywords.delete(keyword);
    }

    /**
     * Returns true if the keyword is enabled.
     * @param keyword — the keyword to check.
     */
    public isKeywordEnabled(keyword: string): boolean {
        return this._keywords.has(keyword);
    }

    // ==================== CLONE & COPY ====================

    /**
     * Creates a deep copy of this material.
     *
     * The clone has its own Three.js material, property map, and keywords.
     * Modifying the clone does not affect the original.
     *
     * @returns a new Material with identical properties.
     *
     * @remarks
     * Equivalent to Unity's implicit clone when accessing `Renderer.material`.
     * Also used by `new Material(existingMaterial)`.
     */
    public clone(): Material {
        return new Material(this);
    }

    /**
     * Copies all properties from another material into this one.
     *
     * @param source — the material to copy from.
     *
     * @remarks
     * Equivalent to Unity's `Material.CopyPropertiesFromMaterial`.
     * Does NOT change the shader — only copies property values, keywords,
     * and render queue.
     */
    public copyPropertiesFromMaterial(source: Material): void {
        this._properties = Material._deepCloneProperties(source._properties);
        this._keywords = new Set(source._keywords);
        this._renderQueue = source._renderQueue;
        this._threeMatHandle.needsUpdate = true;
    }

    // ==================== LIFECYCLE ====================

    protected override onDestroy(): void {
        this._threeMatHandle.dispose();
        this._properties.clear();
        this._keywords.clear();
    }

    // ==================== INTERNAL THREE.JS SYNC ====================
    // These methods push engine property values into Three.js material fields.
    // They use `as any` casts because Three.js material subtypes have different
    // property sets (color, emissive, metalness, etc.) and there is no common
    // interface. This is acceptable in the internal sync layer.

    /**
     * @internal Syncs a color property to the Three.js material.
     */
    private _syncColorToThree(propertyName: string, value: Color): void {
        const mat = this._threeMatHandle as unknown as Record<string, unknown>;

        if (propertyName === "_Color") {
            const c = mat["color"] as THREE.Color | undefined;
            c?.setHex(value.getHex());
            (mat as Record<string, unknown>)["opacity"] = value.a;
        } else if (propertyName === "_EmissionColor") {
            const e = mat["emissive"] as THREE.Color | undefined;
            e?.setHex(value.getHex());
        } else if (propertyName === "_SpecColor") {
            const s = mat["specular"] as THREE.Color | undefined;
            s?.setHex(value.getHex());
        }
    }

    /**
     * @internal Syncs a float property to the Three.js material.
     */
    private _syncFloatToThree(propertyName: string, value: number): void {
        const mat = this._threeMatHandle as unknown as Record<string, unknown>;

        switch (propertyName) {
            case "_Metallic":
                mat["metalness"] = value;
                break;
            case "_Glossiness":
                // Unity Smoothness = 1 − Three.js Roughness
                mat["roughness"] = 1.0 - value;
                break;
            case "_BumpScale": {
                const ns = mat["normalScale"] as THREE.Vector2 | undefined;
                ns?.set(value, value);
                break;
            }
            case "_OcclusionStrength":
                mat["aoMapIntensity"] = value;
                break;
            case "_Shininess":
                mat["shininess"] = value;
                break;
        }
    }

    /**
     * @internal Syncs a texture property to the Three.js material.
     */
    private _syncTextureToThree(propertyName: string, value: Texture | null): void {
        const mat = this._threeMatHandle as unknown as Record<string, unknown>;
        const threeTex = value ? value._internalThreeTexture : null;

        switch (propertyName) {
            case "_MainTex":
                mat["map"] = threeTex;
                break;
            case "_BumpMap":
                mat["normalMap"] = threeTex;
                break;
            case "_MetallicGlossMap":
                mat["metalnessMap"] = threeTex;
                mat["roughnessMap"] = threeTex;
                break;
            case "_OcclusionMap":
                mat["aoMap"] = threeTex;
                break;
            case "_EmissionMap":
                mat["emissiveMap"] = threeTex;
                break;
        }

        this._threeMatHandle.needsUpdate = true;
    }

    // ==================== STATIC HELPERS ====================

    /**
     * @internal Creates a Three.js material corresponding to the shader type.
     */
    private static _createThreeMaterial(shader: Shader): THREE.Material {
        const materialType = shader._threeMaterialType;

        switch (materialType) {
            case "MeshStandardMaterial":
                return new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    metalness: 0,
                    roughness: 1
                });

            case "MeshBasicMaterial":
                return new THREE.MeshBasicMaterial({
                    color: 0xffffff
                });

            case "MeshLambertMaterial":
                return new THREE.MeshLambertMaterial({
                    color: 0xffffff
                });

            case "MeshPhongMaterial":
                return new THREE.MeshPhongMaterial({
                    color: 0xffffff,
                    shininess: 30
                });

            default:
                console.warn(`[Material] Unknown material type "${materialType}", falling back to MeshStandardMaterial`);
                return new THREE.MeshStandardMaterial();
        }
    }

    /**
     * @internal Deep-clones the property map.
     *
     * Cloneable types (Color, Vector4, Matrix4x4) get cloned.
     * Textures and numbers are shared (correct: textures are assets,
     * numbers are primitives).
     */
    private static _deepCloneProperties(
        source: Map<string, MaterialPropertyValue>
    ): Map<string, MaterialPropertyValue> {
        const clone = new Map<string, MaterialPropertyValue>();
        for (const [key, value] of source) {
            if (value instanceof Color) {
                clone.set(key, value.clone());
            } else if (value instanceof Vector4) {
                clone.set(key, value.clone());
            } else if (value instanceof Matrix4x4) {
                clone.set(key, value.clone());
            } else {
                // number, Texture (shared asset), or null — copy reference
                clone.set(key, value);
            }
        }
        return clone;
    }
}