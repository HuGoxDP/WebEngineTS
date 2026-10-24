// scripts/player-smoke/fixtures.mjs
// ============================================================
// The archives the smoke runs. Three kinds, because no shipped scenario covers
// everything the player must survive:
//
//   synthetic  manifest + two scripts + the capabilities no real ZIP exercises
//              (a .ktx2, a .png, a .glb with an embedded texture, a .wav)
//   real       ScenarioCreator's release ZIPs (Mechanics: scripts only;
//              solar-system: GLB + jpg + png), if the sibling repo is present
//   streamed   the synthetic scenario as a manifest plus loose files
//
// Scripts import the engine by ABSOLUTE URL. That is the hand-made stand-in for
// the pre-linker rewrite of the bare "WebEngineTS" specifier, which Phase 2 of the
// plan builds for real; here it is a string replace on the way into the archive.
// ============================================================

import { existsSync, readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "../..");

const ENGINE_PLACEHOLDER = "__ENGINE_URL__";

export const SCENARIO_SOURCE = `
import {
    ScenarioBehaviour, GameObject, Camera, Vector3, Color, MeshFilter, MeshRenderer, Mesh,
    StandardMaterial, DirectionalLight, Application, BuildInfo, Resources, Texture2D, AudioClip,
    CameraClearFlags,
} from "${ENGINE_PLACEHOLDER}";
import { helperValue } from "./helper.js";

const smoke = (globalThis.__smoke = { frames: 0, assets: {} });

// A load that never settles must not stall the scenario: a CSP-blocked KTX2 transcoder worker
// fails inside the worker and the engine's promise simply never resolves.
async function probe(name, load) {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("no result in 15 s")), 15000));
    try { smoke.assets[name] = { ok: true, ...(await Promise.race([load(), timeout])) }; }
    catch (error) { smoke.assets[name] = { ok: false, error: String(error && error.message || error) }; }
}

export default class SmokeScenario extends ScenarioBehaviour {
    async awake() {
        smoke.awake = true;
        smoke.relativeImport = helperValue;
        smoke.sameEngine = Application.current !== null && Application.current === globalThis.__smokeApp;
        smoke.engineBuiltAt = BuildInfo.builtAt;

        const cam = new GameObject("Camera");
        cam.tag = "MainCamera";
        const camera = cam.addComponent(Camera);
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.1, 0.1, 0.2);
        cam.transform.position = new Vector3(0, 0, -3);
        new GameObject("Sun").addComponent(DirectionalLight);

        const cube = new GameObject("Cube");
        cube.addComponent(MeshFilter).sharedMesh = Mesh.createCube(1);
        const material = new StandardMaterial();
        cube.addComponent(MeshRenderer).sharedMaterial = material;

        await probe("ktx2", async () => {
            const texture = await Resources.load(Texture2D, "textures/test.ktx2");
            material.albedoTexture = texture;
            return { width: texture.width, height: texture.height };
        });
        await probe("png", async () => {
            const texture = await Resources.load(Texture2D, "textures/test.png");
            return { width: texture.width, height: texture.height };
        });
        await probe("glb", async () => {
            const model = await Resources.load(GameObject, "models/test");
            const renderer = model.getComponentInChildren(MeshRenderer);
            return { name: model.name, hasMesh: !!renderer, textured: !!renderer?.sharedMaterial?.albedoTexture };
        });
        await probe("wav", async () => {
            const clip = await Resources.load(AudioClip, "audio/test");
            return { duration: clip.duration };
        });
    }

    update() { smoke.frames++; }
}
`;

export const HELPER_SOURCE = `export const helperValue = "relative-import-ok";\n`;

// ── tiny asset encoders ───────────────────────────────────────────────

function pngChunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
}

/** A square RGBA gradient. */
export function makePng(size = 8) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header.set([8, 6, 0, 0, 0], 8);
    const rows = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) rows.set([x * 32, y * 32, 128, 255], y * (size * 4 + 1) + 1 + x * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

/** 0.1 s of 440 Hz, 8 kHz mono 16-bit PCM. */
export function makeWav() {
    const samples = 800;
    const buffer = Buffer.alloc(44 + samples * 2);
    buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write("WAVEfmt ", 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 8000 * 440 * 2 * Math.PI) * 8000), 44 + i * 2);
    return buffer;
}

/** One textured triangle whose base-colour image is embedded in the .glb. */
export function makeGlb(png) {
    const positions = Buffer.alloc(36);
    [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => positions.writeFloatLE(v, i * 4));
    const uvs = Buffer.alloc(24);
    [0, 0, 1, 0, 0, 1].forEach((v, i) => uvs.writeFloatLE(v, i * 4));
    const pad = n => (4 - (n % 4)) % 4;
    const bin = Buffer.concat([positions, uvs, png, Buffer.alloc(pad(png.length))]);
    const json = {
        asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }], images: [{ bufferView: 2, mimeType: "image/png" }],
        buffers: [{ byteLength: bin.length }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 },
            { buffer: 0, byteOffset: 60, byteLength: png.length },
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
            { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
        ],
    };
    let jsonBytes = Buffer.from(JSON.stringify(json));
    jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(pad(jsonBytes.length), 0x20)]);
    const chunk = (type, data) => {
        const head = Buffer.alloc(8);
        head.writeUInt32LE(data.length, 0);
        head.write(type, 4, "latin1");
        return Buffer.concat([head, data]);
    };
    const body = Buffer.concat([chunk("JSON", jsonBytes), chunk("BIN\u0000", bin)]);
    const head = Buffer.alloc(12);
    head.write("glTF", 0, "ascii");
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(12 + body.length, 8);
    return Buffer.concat([head, body]);
}

// ── archives ──────────────────────────────────────────────────────────

/** Every asset of the synthetic scenario, by path under assets/. */
export function syntheticAssets() {
    const png = makePng();
    return {
        "textures/test.ktx2": readFileSync(join(HERE, "fixtures", "test.ktx2")),
        "textures/test.png": png,
        "models/test.glb": makeGlb(png),
        "audio/test.wav": makeWav(),
    };
}

const withEngine = (source, engineUrl) => source.replaceAll(ENGINE_PLACEHOLDER, engineUrl);

/** The synthetic ZIP, as bytes. */
export async function buildSyntheticZip(engineUrl) {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
        manifestVersion: "1.0", id: "player-smoke", name: "Player smoke", version: "1.0.0",
        entryPoint: "Scenario.js", assets: [],
    }));
    zip.file("scripts/Scenario.js", withEngine(SCENARIO_SOURCE, engineUrl));
    zip.file("scripts/helper.js", HELPER_SOURCE);
    for (const [path, bytes] of Object.entries(syntheticAssets())) zip.file(`assets/${path}`, bytes);
    return zip.generateAsync({ type: "nodebuffer" });
}

/** The streamed form: a manifest and the loose files it names, keyed by URL path under /stream/. */
export function buildStreamedFiles(engineUrl) {
    const assets = syntheticAssets();
    const manifest = {
        schema: 1, id: "player-smoke-streamed", name: "Player smoke (streamed)", entry: "scripts/Scenario.js",
        scripts: [{ path: "scripts/Scenario.js", url: "Scenario.js" }, { path: "scripts/helper.js", url: "helper.js" }],
        assets: Object.keys(assets).map(path => ({
            path: `assets/${path}`, priority: "high", lods: [{ url: path.split("/").pop() }],
        })),
    };
    const files = {
        "scenario.json": [JSON.stringify(manifest), "application/json"],
        "Scenario.js": [withEngine(SCENARIO_SOURCE, engineUrl), "text/javascript"],
        "helper.js": [HELPER_SOURCE, "text/javascript"],
    };
    for (const [path, bytes] of Object.entries(assets)) files[path.split("/").pop()] = [bytes, "application/octet-stream"];
    return files;
}

/** ScenarioCreator's ReleaseScenarios/, found beside any ancestor of this repo (main checkout or worktree). */
export function findReleaseDir(start = REPO) {
    for (let dir = start, up = ""; dir !== up; up = dir, dir = dirname(dir)) {
        const candidate = join(dir, "ScenarioCreator", "ReleaseScenarios");
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

/** A ScenarioCreator release ZIP with the engine specifier made absolute, or null if the repo is not here. */
export async function buildRealZip(fileName, engineUrl) {
    const dir = findReleaseDir();
    if (!dir || !existsSync(join(dir, fileName))) return null;

    const zip = await JSZip.loadAsync(readFileSync(join(dir, fileName)));
    for (const path of Object.keys(zip.files)) {
        if (!path.startsWith("scripts/") || !path.endsWith(".js")) continue;
        zip.file(path, (await zip.file(path).async("string")).replace(/(["'])WebEngineTS\1/g, `"${engineUrl}"`));
    }
    return zip.generateAsync({ type: "nodebuffer" });
}
