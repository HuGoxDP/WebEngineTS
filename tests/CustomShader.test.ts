import { describe, test, expect, vi, afterEach } from "vitest";
import * as THREE from "three";
import { Shader, ShaderPropertyType } from "../src/engine/core/graphics/Shader";
import { Material } from "../src/engine/core/graphics/Material";
import { DEFAULT_VERTEX_SHADER } from "../src/engine/core/graphics/ShaderSource";
import { Color } from "../src/engine/core/math/Color";
import { Vector4 } from "../src/engine/core/math/Vector4";
import { Matrix4x4 } from "../src/engine/core/math/Matrix4x4";

let created = 0;

/** A distinct shader per test, so the registry warning never fires by accident. */
function makeShader(overrides: Partial<Parameters<typeof Shader.create>[1]> = {}): Shader {
    return Shader.create(`Test${created++}`, {
        fragment: "void main() { gl_FragColor = _Color; }",
        uniforms: { _Color: Color.cyan, _Frequency: 40 },
        ...overrides,
    });
}

function uniformsOf(material: Material): Record<string, { value: unknown }> {
    return (material._internalThreeMaterial as THREE.ShaderMaterial).uniforms;
}

afterEach(() => vi.restoreAllMocks());

describe("Shader.create", () => {
    test("produces a custom shader, findable by name", () => {
        const shader = Shader.create("Scanline", {
            fragment: "void main() { gl_FragColor = vec4(1.0); }",
        });

        expect(shader.isCustom).toBe(true);
        expect(shader.shaderName).toBe("Scanline");
        expect(Shader.Find("Scanline")).toBe(shader);
    });

    test("a built-in is not custom", () => {
        expect(Shader.Standard.isCustom).toBe(false);
        expect(Shader.Unlit.isCustom).toBe(false);
    });

    test("a shader that draws nothing is rejected", () => {
        expect(() => Shader.create("Empty", { fragment: "" })).toThrow(/no fragment shader/);
        expect(() => Shader.create("Blank", { fragment: "   " })).toThrow(/no fragment shader/);
    });

    test("reusing a name warns rather than shadowing silently", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        Shader.create("Duplicated", { fragment: "void main() {}" });

        const second = Shader.create("Duplicated", { fragment: "void main() {}" });

        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Replacing the existing shader/));
        expect(Shader.Find("Duplicated")).toBe(second);
    });

    test("declared uniforms become the shader's properties", () => {
        const shader = Shader.create("Typed", {
            fragment: "void main() {}",
            uniforms: {
                _Tint: Color.white,
                _Amount: 0.5,
                _Offset: new Vector4(1, 2, 3, 4),
                _Warp: Matrix4x4.identity,
                _MainTex: null,
            },
        });

        expect(shader.hasProperty("_Tint")).toBe(true);
        expect(shader.getPropertyType("_Tint")).toBe(ShaderPropertyType.Color);
        expect(shader.getPropertyType("_Amount")).toBe(ShaderPropertyType.Float);
        expect(shader.getPropertyType("_Offset")).toBe(ShaderPropertyType.Vector);
        expect(shader.getPropertyType("_Warp")).toBe(ShaderPropertyType.Vector);
        expect(shader.getPropertyType("_MainTex")).toBe(ShaderPropertyType.Texture);
    });
});

describe("Material — authored shaders", () => {
    test("declared uniforms exist before anything is set", () => {
        const material = new Material(makeShader());

        // Three builds the program from the uniform object it is handed, so a
        // uniform added later would have nowhere to go.
        expect(Object.keys(uniformsOf(material)).sort()).toEqual(["_Color", "_Frequency"]);
        expect(uniformsOf(material)._Frequency.value).toBe(40);
    });

    test("a Color arrives as a vec4, alpha included", () => {
        const material = new Material(Shader.create("Alpha", {
            fragment: "void main() {}",
            uniforms: { _Color: new Color(0.1, 0.2, 0.3, 0.4) },
        }));

        const value = uniformsOf(material)._Color.value as THREE.Vector4;

        // vec3 would silently drop alpha, and it would be found in a shader
        // that cannot fade.
        expect(value).toBeInstanceOf(THREE.Vector4);
        expect([value.x, value.y, value.z, value.w]).toEqual([0.1, 0.2, 0.3, 0.4]);
    });

    test("setFloat drives the uniform", () => {
        const material = new Material(makeShader());

        material.setFloat("_Frequency", 80);

        expect(uniformsOf(material)._Frequency.value).toBe(80);
        expect(material.getFloat("_Frequency")).toBe(80);
    });

    test("setColor writes in place rather than reallocating", () => {
        const material = new Material(makeShader());
        const before = uniformsOf(material)._Color.value as THREE.Vector4;

        material.setColor("_Color", new Color(1, 0, 0, 0.5));

        expect(uniformsOf(material)._Color.value).toBe(before);
        expect([before.x, before.y, before.z, before.w]).toEqual([1, 0, 0, 0.5]);
    });

    test("setVector and setMatrix reach uniforms that used to be store-only", () => {
        const material = new Material(Shader.create("Transforms", {
            fragment: "void main() {}",
            uniforms: { _Offset: Vector4.zero, _Warp: Matrix4x4.identity },
        }));

        material.setVector("_Offset", new Vector4(1, 2, 3, 4));
        const warp = Matrix4x4.identity.clone();
        warp.set(0, 3, 5);
        material.setMatrix("_Warp", warp);

        const offset = uniformsOf(material)._Offset.value as THREE.Vector4;
        expect([offset.x, offset.y, offset.z, offset.w]).toEqual([1, 2, 3, 4]);
        expect((uniformsOf(material)._Warp.value as THREE.Matrix4).elements[12]).toBe(5);
    });

    test("an undeclared name on an authored shader does not fall through", () => {
        const material = new Material(Shader.create("NoColor", {
            fragment: "void main() {}",
            uniforms: { _Amount: 1 },
        }));

        material.setColor("_Color", Color.red);

        // The built-in sync knows "_Color" means material.color; applying that
        // to an authored shader would tint something the author never wrote.
        expect("_Color" in uniformsOf(material)).toBe(false);
        expect((material._internalThreeMaterial as unknown as { color?: unknown }).color)
            .toBeUndefined();
        expect(material.getColor("_Color").r).toBe(1);
    });

    test("built-in materials are untouched by the uniform path", () => {
        const material = new Material(Shader.Standard);

        material.setColor("_Color", Color.red);
        material.setFloat("_Metallic", 0.25);

        const three = material._internalThreeMaterial as THREE.MeshStandardMaterial;
        expect(three.color.getHex()).toBe(0xff0000);
        expect(three.metalness).toBe(0.25);
    });

    test("a source without a vertex shader gets the pass-through one", () => {
        const material = new Material(makeShader());

        expect((material._internalThreeMaterial as THREE.ShaderMaterial).vertexShader)
            .toBe(DEFAULT_VERTEX_SHADER);
    });

    test("an authored vertex shader is used as written", () => {
        const vertex = "void main() { gl_Position = vec4(position, 1.0); }";
        const material = new Material(makeShader({ vertex }));

        expect((material._internalThreeMaterial as THREE.ShaderMaterial).vertexShader).toBe(vertex);
    });

    test("render state flags are carried across", () => {
        const material = new Material(makeShader({
            transparent: true, doubleSided: true, depthWrite: false,
        }));
        const three = material._internalThreeMaterial;

        expect(three.transparent).toBe(true);
        expect(three.side).toBe(THREE.DoubleSide);
        expect(three.depthWrite).toBe(false);
    });

    test("defaults are opaque, single-sided and depth-writing", () => {
        const three = new Material(makeShader())._internalThreeMaterial;

        expect(three.transparent).toBe(false);
        expect(three.side).toBe(THREE.FrontSide);
        expect(three.depthWrite).toBe(true);
    });

    test("a cloned material owns its uniforms", () => {
        const original = new Material(makeShader());
        const copy = original.clone();

        copy.setFloat("_Frequency", 5);

        expect(uniformsOf(original)._Frequency.value).toBe(40);
        expect(uniformsOf(copy)._Frequency.value).toBe(5);
    });
});
