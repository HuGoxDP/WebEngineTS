import { EngineObject } from "../EngineObject";
import { Color } from "../math/Color";
import { Vector4 } from "../math/Vector4";
import { Matrix4x4 } from "../math/Matrix4x4";
import type { IShaderSource, ShaderUniformValue } from "./ShaderSource";

/** Property kinds a shader can expose. Mirrors Unity's `ShaderPropertyType`. */
export enum ShaderPropertyType {
    Color,
    Vector,
    Float,
    Range,
    Texture,
    Int
}

/**
 * A shader: either one of the engine's built-ins, or GLSL an author wrote.
 *
 * @remarks
 * Equivalent to Unity's `Shader`, where a shader is a separate asset. The
 * built-ins ({@link Shader.Standard}, {@link Shader.Unlit}, ...) name a
 * lighting model and expose Unity's property names (`_Color`, `_MainTex`,
 * `_Metallic`); each maps to a Three.js material type internally.
 *
 * {@link Shader.create} is the other path: vertex and fragment GLSL with
 * declared uniforms, for the effects no built-in covers. Both kinds are used
 * the same way — `new Material(shader)`, then `setColor` / `setFloat` /
 * `setTexture` — so a material can move from a built-in to a custom shader
 * without changing how it is driven.
 */
export class Shader extends EngineObject {
    /** Shader name, e.g. "Standard" or "Unlit". */
    private _shaderName: string;

    /** Whether this shader is usable on the current platform. */
    private _isSupported: boolean = true;

    /**
     * Which Three.js material type backs this shader.
     * @internal — never use directly.
     */
    public readonly _threeMaterialType: string;

    /**
     * Shader properties, for `Material.setFloat`, `setColor` and friends.
     * @internal
     */
    public readonly _properties: Map<string, ShaderPropertyType> = new Map();

    /**
     * The GLSL this shader was created from, or null for a built-in.
     * @internal
     */
    public readonly _source: IShaderSource | null;

    constructor(
        shaderName: string,
        threeMaterialType: string,
        source: IShaderSource | null = null,
    ) {
        super(`Shader:${shaderName}`);
        this._shaderName = shaderName;
        this._threeMaterialType = threeMaterialType;
        this._source = source;
    }

    // === Properties ===

    /** Whether this shader is usable on the current platform. */
    public get isSupported(): boolean {
        return this._isSupported;
    }

    /** The shader's name. */
    public get shaderName(): string {
        return this._shaderName;
    }

    /** Whether this shader was authored as GLSL rather than being a built-in. */
    public get isCustom(): boolean {
        return this._source !== null;
    }

    // === Methods ===

    /**
     * The type of a property, by name.
     *
     * @param propertyName - e.g. `"_Color"`, `"_MainTex"`.
     */
    public getPropertyType(propertyName: string): ShaderPropertyType | null {
        // `??`, not `||`: ShaderPropertyType.Color is 0, so a truthiness test
        // reported every colour property as missing.
        return this._properties.get(propertyName) ?? null;
    }

    /**
     * The index of a property, for parity with Unity's API.
     *
     * @param propertyName - the property to look up.
     */
    public findPropertyIndex(propertyName: string): number {
        const keys = Array.from(this._properties.keys());
        return keys.indexOf(propertyName);
    }

    /**
     * Whether this shader exposes a property.
     *
     * @param propertyName - the property to look for.
     */
    public hasProperty(propertyName: string): boolean {
        return this._properties.has(propertyName);
    }

    /**
     * Declares a property.
     * @internal — used when building the built-in shaders.
     */
    public _addProperty(propertyName: string, propertyType: ShaderPropertyType): void {
        this._properties.set(propertyName, propertyType);
    }

    // === Built-in shaders ===

    private static _standardShader: Shader | null = null;
    private static _unlitShader: Shader | null = null;
    private static _diffuseShader: Shader | null = null;
    private static _specularShader: Shader | null = null;
    private static _transparentShader: Shader | null = null;

    /** Every shader, by name. */
    private static _shaderRegistry: Map<string, Shader> = new Map();

    /**
     * Finds a shader by name, built-in or custom.
     *
     * @remarks Equivalent to Unity's `Shader.Find`.
     *
     * @param name - e.g. `"Standard"`, `"Unlit"`, or a name given to
     *               {@link Shader.create}.
     */
    public static Find(name: string): Shader | null {
        return Shader._shaderRegistry.get(name) || null;
    }

    /**
     * Adds a shader to the registry.
     * @internal
     */
    private static _registerShader(shader: Shader): void {
        Shader._shaderRegistry.set(shader.shaderName, shader);
    }

    /**
     * Creates a shader from GLSL.
     *
     * @remarks
     * The authoring path for effects no built-in covers. Unity writes ShaderLab
     * around HLSL; here the source is GLSL, because that is what the browser
     * compiles and wrapping it in a second language would buy nothing but a
     * translator to maintain.
     *
     * The uniforms declared in {@link IShaderSource.uniforms} become the
     * material's properties, driven by the same `setColor` / `setFloat` /
     * `setTexture` calls a built-in takes — the property name **is** the
     * uniform name, so `uniform vec4 _Color;` is set by `setColor("_Color", …)`.
     * Declaring them is required: a uniform first seen at set time has no slot
     * in the compiled program, and writing to it would silently do nothing.
     *
     * The shader is registered under its name, so {@link Shader.Find} returns
     * it. Creating a second shader with a name already taken replaces the
     * registration and warns — silently shadowing one shader with another
     * would be found only as the wrong thing on screen.
     *
     * ```ts
     * const scanline = Shader.create("Scanline", {
     *     fragment: `
     *         uniform vec4 _Color;
     *         uniform float _Frequency;
     *         varying vec2 vUv;
     *         void main() {
     *             float line = step(0.5, fract(vUv.y * _Frequency));
     *             gl_FragColor = vec4(_Color.rgb * line, _Color.a);
     *         }
     *     `,
     *     uniforms: { _Color: Color.cyan, _Frequency: 40 },
     *     transparent: true,
     * });
     *
     * const material = new Material(scanline);
     * material.setFloat("_Frequency", 80);
     * ```
     *
     * There is no automatic `_Time`: push it from a script with
     * `material.setFloat("_Time", Time.time)`, which keeps a per-frame cost out
     * of every material that does not want one.
     *
     * @param name - the shader's name, and its key in the registry.
     * @param source - the GLSL and the uniform declarations.
     */
    public static create(name: string, source: IShaderSource): Shader {
        if (!source.fragment || source.fragment.trim().length === 0) {
            throw new Error(`[Shader] "${name}" has no fragment shader.`);
        }
        if (Shader._shaderRegistry.has(name)) {
            console.warn(`[Shader] Replacing the existing shader named "${name}".`);
        }

        const shader = new Shader(name, "ShaderMaterial", source);

        for (const [property, value] of Object.entries(source.uniforms ?? {})) {
            shader._addProperty(property, Shader._propertyTypeOf(value));
        }

        Shader._registerShader(shader);
        return shader;
    }

    /** The property kind a declared uniform default implies. */
    private static _propertyTypeOf(value: ShaderUniformValue): ShaderPropertyType {
        if (typeof value === "number") return ShaderPropertyType.Float;
        if (value instanceof Color) return ShaderPropertyType.Color;
        if (value instanceof Vector4) return ShaderPropertyType.Vector;
        if (value instanceof Matrix4x4) return ShaderPropertyType.Vector;
        // A texture, or null — which only ever declares a sampler, since every
        // other kind has a usable zero and would have been written as one.
        return ShaderPropertyType.Texture;
    }

    /** Standard — physically based rendering. */
    public static get Standard(): Shader {
        if (!Shader._standardShader) {
            const shader = new Shader("Standard", "MeshStandardMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_Metallic", ShaderPropertyType.Float);
            shader._addProperty("_MetallicGlossMap", ShaderPropertyType.Texture);
            shader._addProperty("_Glossiness", ShaderPropertyType.Float);
            shader._addProperty("_GlossMapScale", ShaderPropertyType.Float);
            shader._addProperty("_BumpMap", ShaderPropertyType.Texture);
            shader._addProperty("_BumpScale", ShaderPropertyType.Float);
            shader._addProperty("_OcclusionMap", ShaderPropertyType.Texture);
            shader._addProperty("_OcclusionStrength", ShaderPropertyType.Float);
            shader._addProperty("_EmissionColor", ShaderPropertyType.Color);
            shader._addProperty("_EmissionMap", ShaderPropertyType.Texture);
            
            Shader._standardShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._standardShader;
    }

    /** Unlit — unaffected by lights. */
    public static get Unlit(): Shader {
        if (!Shader._unlitShader) {
            const shader = new Shader("Unlit", "MeshBasicMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            
            Shader._unlitShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._unlitShader;
    }

    /** Diffuse — Lambert lighting. */
    public static get Diffuse(): Shader {
        if (!Shader._diffuseShader) {
            const shader = new Shader("Diffuse", "MeshLambertMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_EmissionColor", ShaderPropertyType.Color);
            shader._addProperty("_EmissionMap", ShaderPropertyType.Texture);
            
            Shader._diffuseShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._diffuseShader;
    }

    /** Specular — Blinn-Phong lighting, with highlights. */
    public static get Specular(): Shader {
        if (!Shader._specularShader) {
            const shader = new Shader("Specular", "MeshPhongMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_SpecColor", ShaderPropertyType.Color);
            shader._addProperty("_Shininess", ShaderPropertyType.Float);
            shader._addProperty("_BumpMap", ShaderPropertyType.Texture);
            shader._addProperty("_BumpScale", ShaderPropertyType.Float);
            shader._addProperty("_EmissionColor", ShaderPropertyType.Color);
            shader._addProperty("_EmissionMap", ShaderPropertyType.Texture);
            
            Shader._specularShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._specularShader;
    }

    /** Transparent — Standard, blended. */
    public static get Transparent(): Shader {
        if (!Shader._transparentShader) {
            const shader = new Shader("Transparent", "MeshStandardMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_Metallic", ShaderPropertyType.Float);
            shader._addProperty("_Glossiness", ShaderPropertyType.Float);
            shader._addProperty("_BumpMap", ShaderPropertyType.Texture);
            shader._addProperty("_BumpScale", ShaderPropertyType.Float);
            
            Shader._transparentShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._transparentShader;
    }

    /** VertexLit — simple legacy lighting. */
    private static _vertexLitShader: Shader | null = null;
    
    public static get VertexLit(): Shader {
        if (!Shader._vertexLitShader) {
            const shader = new Shader("VertexLit", "MeshPhongMaterial");
            
            shader._addProperty("_Color", ShaderPropertyType.Color);
            shader._addProperty("_MainTex", ShaderPropertyType.Texture);
            shader._addProperty("_Shininess", ShaderPropertyType.Float);
            
            Shader._vertexLitShader = shader;
            Shader._registerShader(shader);
        }
        return Shader._vertexLitShader;
    }
}
