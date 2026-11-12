import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";

/**
 * C6 phase 4 (DW-4.1..DW-4.3): a render target is sampled by the colour slots,
 * and a save of a material holding one writes nothing about it.
 *
 * D8 widened three typed slots — `UnlitMaterial.mainTexture`,
 * `StandardMaterial.albedoTexture`, `StandardMaterial.emissionTexture` — to
 * `Texture2D | RenderTexture | null`, because a target's colour texture *is* the
 * texture a material binds and a monitor is the first thing anyone renders one
 * for. The data slots (normal, metallic, occlusion, height) stayed `Texture2D`:
 * the engine's type system is the guard, and the `// @ts-expect-error` lines
 * below are what keep it one.
 *
 * Two rules hold everywhere in here:
 *
 * - **A `Texture2D` is untouched.** Same three texture, same slot, same order of
 *   calls — a scene with no target must render byte-identically, so the common
 *   path gets no new work. The `Texture2D` assertions below exist to prove it.
 * - **A target is never re-tagged.** `_setLinearData` on a `RenderTexture` is a
 *   deliberate no-op (its storage format is fixed at allocation), so the colour
 *   slot's `_setLinearData(false)` reaches it and does nothing — an ARGB32
 *   target stays sRGB rather than sampling as raw values.
 *
 * Not testable here, and why: the feedback loop (a camera rendering into the
 * texture a visible material samples) is a *WebGL* error that drops the draw.
 * `Camera.targetTexture` is C6 phase 3 and is not on this branch yet, and this
 * suite has no WebGL context — so neither the dropped draw nor three's warning
 * can be produced. The one test that touches it says so in its name and pins
 * only the engine-side half (D8, research follow-up row "feedback-loop guard").
 */

vi.stubGlobal("document", {
    createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }),
    }),
});

const { RenderTexture, RenderTextureFormat } = await import("../src/engine/core/graphics/RenderTexture");
const { UnlitMaterial } = await import("../src/engine/core/graphics/UnlitMaterial");
const { StandardMaterial } = await import("../src/engine/core/graphics/StandardMaterial");
const { Texture2D } = await import("../src/engine/core/graphics/Texture2D");
const { UIImage } = await import("../src/engine/core/ui/UIImage");
const { GameObject } = await import("../src/engine/core/GameObject");
const { MeshRenderer } = await import("../src/engine/core/rendering/MeshRenderer");
const { SceneSerializer } = await import("../src/engine/core/serialization/SceneSerializer");
const { AssetDatabase } = await import("../src/engine/core/assets/AssetDatabase");
const { SceneManager } = await import("../src/engine/core/SceneManager");

/** The Three.js material behind an engine material. */
const threeMat = (m: unknown): any => (m as any)._threeMatHandle;

/** The colour space the target was allocated with. */
const space = (rt: InstanceType<typeof RenderTexture>) => rt._internalThreeTexture.colorSpace;

/** An image texture as the constructor leaves it: canvas-backed, and tagged. */
function imageTexture(width = 4, height = 4): InstanceType<typeof Texture2D> {
    return new Texture2D(width, height);
}

/** Destroys every root so each test starts from an empty scene. */
function destroyScene(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroy();
}

/** Every `AssetRef` guid anywhere in a serialized tree. */
function assetRefGuids(node: unknown): string[] {
    if (Array.isArray(node)) return node.flatMap(assetRefGuids);
    if (node === null || typeof node !== "object") return [];
    const obj = node as Record<string, unknown>;
    const own = obj["$type"] === "AssetRef" && typeof obj["guid"] === "string" ? [obj["guid"] as string] : [];
    return [...own, ...Object.keys(obj).flatMap(key => assetRefGuids(obj[key]))];
}

beforeEach(() => destroyScene());
afterEach(() => {
    destroyScene();
    AssetDatabase.clear();
});

describe("a target fills the colour slots", () => {
    test("UnlitMaterial.mainTexture takes one, and the three material's map is the target's texture", () => {
        const rt = new RenderTexture(16, 8);
        rt.create();
        const m = new UnlitMaterial();

        m.mainTexture = rt;

        expect(m.mainTexture).toBe(rt);
        // Through the ordinary texture path — no second slot exists for a target.
        expect(threeMat(m).map).toBe(rt._internalThreeTexture);
        expect(threeMat(m).map).toBe(rt._internalThreeRenderTarget.texture);
    });

    test("StandardMaterial.albedoTexture takes one", () => {
        const rt = new RenderTexture(16, 8);
        rt.create();
        const m = new StandardMaterial();

        m.albedoTexture = rt;

        expect(m.albedoTexture).toBe(rt);
        expect(threeMat(m).map).toBe(rt._internalThreeRenderTarget.texture);
    });

    test("StandardMaterial.emissionTexture takes one", () => {
        const rt = new RenderTexture(16, 8);
        rt.create();
        const m = new StandardMaterial();

        m.emissionTexture = rt;

        expect(m.emissionTexture).toBe(rt);
        expect(threeMat(m).emissiveMap).toBe(rt._internalThreeRenderTarget.texture);
    });

    test("clearing a widened slot is not an error", () => {
        const m = new StandardMaterial();
        m.albedoTexture = new RenderTexture(4, 4);

        expect(() => { m.albedoTexture = null; }).not.toThrow();
        expect(m.albedoTexture).toBeNull();
        expect(threeMat(m).map).toBeNull();
    });

    test("two materials may sample one target, and both follow it when its image is replaced", () => {
        // The referent path: `release()` swaps the target's texture, so every
        // material holding it has to be re-pointed or it keeps sampling a
        // texture three has given back.
        const rt = new RenderTexture(8, 8);
        rt.create();
        const a = new UnlitMaterial();
        const b = new UnlitMaterial();
        a.mainTexture = rt;
        b.mainTexture = rt;

        const first = rt._internalThreeTexture;
        rt.release();

        expect(threeMat(a).map).toBe(rt._internalThreeTexture);
        expect(threeMat(b).map).toBe(rt._internalThreeTexture);
        expect(threeMat(a).map).not.toBe(first);
    });

    test("a target destroyed while a material holds it does not throw on the next frame", () => {
        const rt = new RenderTexture(8, 8);
        rt.create();
        const m = new StandardMaterial();
        m.albedoTexture = rt;

        rt.destroyImmediate();

        // As with a Texture2D today: the material keeps a reference to a
        // destroyed texture, and nothing blows up when it stops being drawn.
        expect(m.albedoTexture).toBe(rt);
        expect(() => { m.albedoTexture = null; }).not.toThrow();
        expect(m.albedoTexture).toBeNull();
    });
});

describe("a Texture2D in the same slot behaves exactly as before", () => {
    test("the three material's map is that texture, typed sRGB by the slot", () => {
        const tex = imageTexture();
        const m = new StandardMaterial();

        m.albedoTexture = tex;

        expect(m.albedoTexture).toBe(tex);
        expect(threeMat(m).map).toBe(tex._internalThreeTexture);
        // The slot still tags an image texture as colour, as it always did.
        expect(tex._internalThreeTexture.colorSpace).toBe(THREE.SRGBColorSpace);
    });

    test("and the same for UnlitMaterial.mainTexture", () => {
        const tex = imageTexture();
        const m = new UnlitMaterial();

        m.mainTexture = tex;

        expect(m.mainTexture).toBe(tex);
        expect(threeMat(m).map).toBe(tex._internalThreeTexture);
    });
});

describe("colour space: a target keeps what allocation gave it", () => {
    test("an ARGB32 target stays sRGB in a colour slot — the slot's call is a no-op", () => {
        const rt = new RenderTexture(8, 8, 24, RenderTextureFormat.ARGB32);
        expect(space(rt)).toBe(THREE.SRGBColorSpace);

        const seen: boolean[] = [];
        const spy = vi.spyOn(rt, "_setLinearData").mockImplementation((linear: boolean) => {
            seen.push(linear);
        });
        const m = new StandardMaterial();
        m.albedoTexture = rt;
        spy.mockRestore();

        // The colour-space call reaches it and changes nothing: the storage
        // format is fixed where the target is allocated, so re-tagging it would
        // make a monitor sample as raw values.
        expect(seen).toEqual([false]);
        expect(space(rt)).toBe(THREE.SRGBColorSpace);
    });

    test("an ARGBHalf target stays linear", () => {
        const rt = new RenderTexture(8, 8, 24, RenderTextureFormat.DefaultHDR);
        expect(rt.format).toBe(RenderTextureFormat.ARGBHalf);
        expect(space(rt)).toBe(THREE.LinearSRGBColorSpace);

        new StandardMaterial().emissionTexture = rt;

        expect(space(rt)).toBe(THREE.LinearSRGBColorSpace);
        expect(rt._internalThreeTexture.type).toBe(THREE.HalfFloatType);
    });
});

describe("the feedback loop is documented, not guarded (D8)", () => {
    test("no real GL check is possible here — no WebGL context and no Camera.targetTexture on this branch — so only the engine-side state is pinned, and it does not throw", () => {
        // A feedback loop needs a camera rendering into the very texture a
        // visible material samples. WebGL drops that draw and three logs a
        // warning about a feedback loop between framebuffer and texture; C6
        // records it and leaves the guard to a follow-up row. `Camera.targetTexture`
        // is phase 3 and nothing in this suite has a GL context, so the dropped
        // draw and the warning are out of reach: what is pinned is that building
        // the state the loop is made of — a target held by a colour slot whose
        // image is given back and re-created underneath it — does not throw and
        // leaves the slot sampling the new image.
        const rt = new RenderTexture(8, 8);
        rt.create();
        const m = new UnlitMaterial();
        m.mainTexture = rt;

        expect(() => { rt.release(); rt.create(); }).not.toThrow();

        expect(m.mainTexture).toBe(rt);
        expect(threeMat(m).map).toBe(rt._internalThreeTexture);
    });
});

describe("a save writes nothing about a target (D11)", () => {
    /** A box whose single material holds `albedo` in its albedo slot. */
    function boxWith(albedo: InstanceType<typeof Texture2D> | InstanceType<typeof RenderTexture>): InstanceType<typeof GameObject> {
        const go = new GameObject("Monitor");
        const mat = new StandardMaterial();
        mat.albedoTexture = albedo;
        go.addComponent(MeshRenderer).sharedMaterial = mat;
        return go;
    }

    test("a scene whose material holds a target in albedoTexture saves with no guid and no pixels", () => {
        const rt = new RenderTexture(64, 32);
        rt.create();

        let json: any = null;
        expect(() => { json = SceneSerializer.serializeGameObject(boxWith(rt)); }).not.toThrow();

        // The material is carried inline — it is one asset, not two: the target
        // is not an asset and gets no entry of its own.
        expect(json.assets.length).toBe(1);
        expect(json.assets[0].type).toBe("StandardMaterial");

        // What the writer emits for the slot: null. D11 recorded it as
        // absent/null; this is the value, pinned.
        expect(json.assets[0].fields.albedoTexture).toBeNull();

        // No guid anywhere in the file names the target. The only AssetRef is the
        // material itself, from the renderer's field.
        expect(assetRefGuids(json)).toEqual([json.assets[0].guid]);

        // And no pixel data: a target is a GPU resource, and the writer has no
        // inlining path that could carry one — nothing that looks like an
        // encoded image, and no pixel buffer key anywhere in the file.
        const text = JSON.stringify(json);
        expect(text).not.toContain("data:image");
        expect(text).not.toContain("pixels");
        expect(text).not.toContain("RenderTexture");

        const back = SceneSerializer.deserializeGameObject(json)
            .getComponent(MeshRenderer)!.sharedMaterial as InstanceType<typeof StandardMaterial>;
        expect(back.albedoTexture).toBeNull();
    });

    test("an unlit material holding a target in mainTexture saves the same way", () => {
        const rt = new RenderTexture(16, 16);
        const go = new GameObject("Screen");
        const mat = new UnlitMaterial();
        mat.mainTexture = rt;
        go.addComponent(MeshRenderer).sharedMaterial = mat;

        let json: any = null;
        expect(() => { json = SceneSerializer.serializeGameObject(go); }).not.toThrow();

        expect(json.assets.length).toBe(1);
        expect(json.assets[0].fields.mainTexture).toBeNull();
        expect(assetRefGuids(json)).toEqual([json.assets[0].guid]);
    });

    test("the writer embeds no pixels for an image texture either — a code-built texture writes null, not a canvas", () => {
        // The question the phase asked of the writer: does a `FieldType.Asset`
        // slot with no file behind it carry pixels? It does not — an image
        // texture built in code has no guid, so `ValueSerializer` writes null for
        // it exactly as it does for a target. Recorded as a finding, not a
        // workaround.
        const tex = imageTexture(64, 32);
        const json = SceneSerializer.serializeGameObject(boxWith(tex));

        expect(json.assets!.length).toBe(1);
        expect(json.assets![0].fields.albedoTexture).toBeNull();
        expect(JSON.stringify(json)).not.toContain("data:image");
    });
});

describe("the type system is the guard on the data slots (DW-4.3)", () => {
    const dataSlots = ["normalTexture", "metallicTexture", "occlusionTexture", "heightTexture"] as const;

    for (const slot of dataSlots) {
        test(`${slot} still refuses a RenderTexture`, () => {
            const m = new StandardMaterial();
            const rt = new RenderTexture(8, 8);

            // @ts-expect-error — a data slot stays Texture2D: a target does not
            // fit it, and the compiler says so. If this line ever compiles, the
            // guard is gone.
            m[slot] = rt;

            // The guard is the type system, not the runtime: the value does land
            // in the slot, which is why the widened colour slots are a promise
            // the engine keeps rather than one it merely documents.
            expect((m as any)[slot]).toBe(rt);
        });
    }

    test("a target is not in Canvas UI either: UIImage.sprite stays Sprite | Texture2D (D9)", () => {
        const rt = new RenderTexture(8, 8);
        const image = {} as InstanceType<typeof UIImage>;

        // @ts-expect-error — a target lives on the GPU and Canvas UI draws 2D
        // canvases, so a sprite cannot be one.
        image.sprite = rt;
    });
});
