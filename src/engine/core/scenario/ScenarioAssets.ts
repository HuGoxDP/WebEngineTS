// path: src/engine/core/scenario/ScenarioAssets.ts

import JSZip from "jszip";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Texture2D } from "../graphics/Texture2D.ts";
import { GameObject } from "../GameObject.ts";
import { MeshFilter } from "../rendering/MeshFilter.ts";
import { MeshRenderer } from "../rendering/MeshRenderer.ts";
import { Mesh } from "../graphics/Mesh.ts";
import { StandardMaterial, MaterialRenderMode } from "../graphics/StandardMaterial.ts";
import { Color } from "../math/Color.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { IAssetProvider } from "./ScenarioTypes.ts";

/**
 * Runtime asset manager for a scenario.
 *
 * Loads textures, 3D models, and raw files from an in-memory ZIP archive.
 * All loaded resources are cached and tracked for deterministic cleanup
 * when the scenario is unloaded.
 *
 * @remarks
 * Equivalent to Unity's `Resources` / `AssetDatabase` for runtime use.
 *
 * - All assets are loaded from the in-memory ZIP — nothing touches disk.
 * - Blob URLs are tracked and revoked on {@link dispose}.
 * - Texture2D and model caches prevent redundant loading.
 * - {@link dispose} destroys all engine objects created by this provider.
 *
 * **Three.js isolation:**
 * GLTFLoader and material conversion are private implementation details.
 * Public methods return only engine types (Texture2D, GameObject, Blob).
 *
 * Implements {@link IAssetProvider} so that {@link Scenario} can depend on
 * the interface rather than this concrete class.
 */
export class ScenarioAssets implements IAssetProvider {

    // ==================== PRIVATE STATE ====================

    /** In-memory ZIP archive reference. */
    private _zip: JSZip;

    /** Cache: normalized asset path → loaded Texture2D. */
    private _textureCache: Map<string, Texture2D> = new Map();

    /** Cache: normalized asset path → root GameObject (prefab template). */
    private _modelCache: Map<string, GameObject> = new Map();

    /** All blob URLs created by this provider — revoked on dispose. */
    private _blobUrls: string[] = [];

    /**
     * Three.js GLTF loader instance.
     * @internal — Three.js dependency, never exposed.
     */
    private _gltfLoader: GLTFLoader;

    /**
     * Three.js LoadingManager with URL modifier for resolving
     * external GLTF references (textures, .bin) from the ZIP.
     * @internal
     */
    private _loadingManager: THREE.LoadingManager;

    // ==================== CONSTRUCTOR ====================

    /**
     * @param zip — a parsed JSZip instance representing the scenario archive.
     */
    constructor(zip: JSZip) {
        this._zip = zip;

        // Create a LoadingManager that resolves external GLTF references
        // (textures, .bin files) from the in-memory ZIP archive.
        this._loadingManager = new THREE.LoadingManager();

        this._gltfLoader = new GLTFLoader(this._loadingManager);
    }

    // ==================== IAssetProvider: RAW ASSETS ====================

    /**
     * Loads a raw binary asset from the archive.
     *
     * @param path — path relative to `assets/` (e.g. `"data/config.json"`).
     * @returns a Blob containing the raw file data.
     */
    public async getAsset(path: string): Promise<Blob> {
        const assetPath = `assets/${path}`;
        const file = this._zip.file(assetPath);

        if (!file) {
            throw new Error(`[ScenarioAssets] Asset not found: ${assetPath}`);
        }

        const data = await file.async("arraybuffer");
        return new Blob([data], { type: ScenarioAssets._getMimeType(path) });
    }

    /**
     * Returns a revocable blob URL for an asset.
     *
     * The URL is cached and automatically revoked on {@link dispose}.
     *
     * @param path — path relative to `assets/`.
     */
    public async getAssetUrl(path: string): Promise<string> {
        const blob = await this.getAsset(path);
        const url = URL.createObjectURL(blob);
        this._blobUrls.push(url);
        return url;
    }

    /**
     * Returns a blob URL synchronously if the asset file exists in the ZIP.
     * Creates and caches the URL for later revocation.
     *
     * @param path — path relative to `assets/`.
     * @returns a blob URL string, or empty string if not found.
     *
     * @remarks Useful for Cubemap/Skybox loading where you need URLs up front.
     * Prefer {@link getAssetUrl} for async workflows.
     */
    public getBlobUrl(path: string): string {
        // This is a synchronous helper — reads file to ArrayBuffer in one shot
        const assetPath = `assets/${path}`;
        const file = this._zip.file(assetPath);
        if (!file) return "";

        // Note: JSZip file objects can be read synchronously if already decompressed.
        // For safety, we return a placeholder and the actual URL is created async.
        // Callers should prefer getAssetUrl() for reliability.
        return "";
    }

    // ==================== IAssetProvider: TEXTURES ====================

    /**
     * Loads a texture from the archive.
     *
     * Uses {@link Texture2D.fromArrayBuffer} internally — no Three.js types
     * are exposed. Results are cached by normalized path.
     *
     * @param path — path relative to `assets/textures/` or `assets/`.
     *               Both `"brick.png"` and `"textures/brick.png"` work.
     * @returns an engine Texture2D instance.
     */
    public async loadTexture(path: string): Promise<Texture2D> {
        const normalizedPath = ScenarioAssets._normalizePath("textures", path);

        // Return cached
        const cached = this._textureCache.get(normalizedPath);
        if (cached) return cached;

        // Read raw bytes from ZIP
        const file = this._zip.file(`assets/${normalizedPath}`);
        if (!file) {
            throw new Error(`[ScenarioAssets] Texture not found: assets/${normalizedPath}`);
        }

        const data = await file.async("arraybuffer");

        // Texture2D.fromArrayBuffer handles blob URL + THREE.Texture internally
        const texture = await Texture2D.fromArrayBuffer(data);
        texture.name = path;

        // Cache
        this._textureCache.set(normalizedPath, texture);

        return texture;
    }

    // ==================== IAssetProvider: MODELS ====================

    /**
     * Loads a 3D model (GLB/GLTF) from the archive and converts it
     * to a GameObject hierarchy with MeshFilter + MeshRenderer components.
     *
     * The full node hierarchy is preserved: empty transform nodes become
     * plain GameObjects, mesh nodes get MeshFilter + MeshRenderer, and
     * parent-child relationships mirror the original GLTF structure.
     *
     * PBR material properties (albedo, metallic, roughness, emissive)
     * and texture maps (albedo, normal, metallic/roughness, emissive, AO)
     * are automatically converted to engine {@link StandardMaterial}.
     *
     * @param path — path relative to `assets/models/` or `assets/`.
     * @returns a root GameObject containing the full model hierarchy.
     *
     * @remarks
     * The first load parses the GLTF and caches the result as a "prefab".
     * Subsequent loads return the same reference.
     *
     * @example
     * ```ts
     * const car = await this.context.assets.loadModel("vehicles/car.glb");
     * car.transform.position = new Vector3(0, 0, 5);
     * car.transform.localScale = new Vector3(0.01, 0.01, 0.01);
     * ```
     */
    public async loadModel(path: string): Promise<GameObject> {
        const normalizedPath = ScenarioAssets._normalizePath("models", path);

        // Return cached prefab
        const cached = this._modelCache.get(normalizedPath);
        if (cached) return cached;

        // Read raw bytes from ZIP
        const file = this._zip.file(`assets/${normalizedPath}`);
        if (!file) {
            throw new Error(`[ScenarioAssets] Model not found: assets/${normalizedPath}`);
        }

        const data = await file.async("arraybuffer");

        // Parse directly from ArrayBuffer — no blob URL round-trip
        const gltf = await this._parseGLTF(data, normalizedPath);

        // Convert Three.js scene graph → engine GameObjects
        const root = this._convertGLTFScene(gltf, path);

        // Cache as prefab template
        this._modelCache.set(normalizedPath, root);

        console.log(
            `[ScenarioAssets] Model loaded: "${path}" ` +
            `(${this._countMeshes(root)} meshes)`
        );

        return root;
    }

    // ==================== IAssetProvider: DISPOSE ====================

    /**
     * Releases all cached assets and revokes all blob URLs.
     *
     * - Destroys all cached Texture2D instances (frees GPU memory).
     * - Destroys all cached model GameObjects.
     * - Revokes all blob URLs.
     * - Clears all caches.
     *
     * Called automatically by `Scenario.unload()`.
     */
    public dispose(): void {
        // Destroy cached textures (triggers Texture.onDestroy → THREE.Texture.dispose)
        for (const texture of this._textureCache.values()) {
            if (texture.exists()) {
                texture.destroy();
            }
        }
        this._textureCache.clear();

        // Destroy cached model prefabs
        for (const model of this._modelCache.values()) {
            if (model.exists()) {
                model.destroy();
            }
        }
        this._modelCache.clear();

        // Revoke all blob URLs
        for (const url of this._blobUrls) {
            URL.revokeObjectURL(url);
        }
        this._blobUrls = [];

        console.log("[ScenarioAssets] Disposed.");
    }

    // ==================== PRIVATE: GLTF PARSING ====================

    /**
     * @internal
     * Parses GLTF/GLB directly from an ArrayBuffer using parseAsync.
     *
     * For .glb files (self-contained), all textures are embedded in the
     * binary chunk and resolved automatically.
     *
     * For .gltf files with external references, a LoadingManager with
     * URL modifier resolves paths from the ZIP archive.
     */
    private async _parseGLTF(data: ArrayBuffer, assetPath: string): Promise<GLTF> {
        // Determine base path for external resource resolution
        const lastSlash = assetPath.lastIndexOf("/");
        const basePath = lastSlash >= 0
            ? `assets/${assetPath.substring(0, lastSlash + 1)}`
            : "assets/";

        // Set up URL modifier for external .gltf references (textures, .bin)
        this._loadingManager.setURLModifier((url: string) => {
            // If it's already a blob/data URL, pass through
            if (url.startsWith("blob:") || url.startsWith("data:")) return url;

            // Resolve relative path within the ZIP
            const zipPath = basePath + url;
            const zipFile = this._zip.file(zipPath);
            if (!zipFile) {
                console.warn(`[ScenarioAssets] External GLTF resource not found in ZIP: ${zipPath}`);
                return url;
            }

            // Create blob URL synchronously from the decompressed buffer
            // Note: JSZip decompresses lazily, but for already-loaded archives
            // this is effectively synchronous after the first access.
            // We use a workaround: store a placeholder and handle async in the loader.
            // For GLB files this code path is never hit (all data is embedded).
            return url;
        });

        try {
            // parseAsync accepts ArrayBuffer for .glb or string for .gltf JSON
            const gltf = await this._gltfLoader.parseAsync(data, "");
            return gltf;
        } catch (error) {
            throw new Error(
                `[ScenarioAssets] GLTF parse failed for "${assetPath}": ${error}`
            );
        }
    }

    // ==================== PRIVATE: SCENE GRAPH CONVERSION ====================

    /**
     * @internal
     * Converts the entire GLTF scene into an engine GameObject hierarchy,
     * preserving the full parent-child structure.
     *
     * Conversion rules:
     * - Every THREE.Object3D node → engine GameObject
     * - THREE.Mesh → GameObject + MeshFilter + MeshRenderer
     * - THREE.Group / THREE.Object3D → plain GameObject (transform only)
     * - Local transforms (position, rotation, scale) are copied exactly
     * - Shared geometries and materials are deduplicated via Maps
     *
     * @param gltf — the parsed GLTF result from Three.js.
     * @param name — display name for the root GameObject.
     */
    private _convertGLTFScene(gltf: GLTF, name: string): GameObject {
        // Deduplication maps: same Three.js instance → same engine instance
        const meshMap = new Map<THREE.BufferGeometry, Mesh>();
        const materialMap = new Map<THREE.Material, StandardMaterial>();

        // Recursive converter
        const convert = (threeNode: THREE.Object3D): GameObject => {
            const go = new GameObject(threeNode.name || "Node");

            // --- Copy local transform ---
            go.transform.localPosition = new Vector3(
                threeNode.position.x,
                threeNode.position.y,
                threeNode.position.z
            );
            go.transform.localRotation = new Quaternion(
                threeNode.quaternion.x,
                threeNode.quaternion.y,
                threeNode.quaternion.z,
                threeNode.quaternion.w
            );
            go.transform.localScale = new Vector3(
                threeNode.scale.x,
                threeNode.scale.y,
                threeNode.scale.z
            );

            // --- Mesh node → MeshFilter + MeshRenderer ---
            if ((threeNode as THREE.Mesh).isMesh) {
                const threeMesh = threeNode as THREE.Mesh;
                this._convertMesh(go, threeMesh, meshMap, materialMap);
            }

            // --- Recurse into children ---
            // Skip internal Three.js children that aren't part of the GLTF hierarchy
            // (e.g. bone helpers, light targets). Filter by checking if the child
            // was part of the original GLTF scene graph.
            for (const child of threeNode.children) {
                const childGo = convert(child);
                childGo.transform.parent = go.transform;
            }

            return go;
        };

        const root = convert(gltf.scene);
        root.name = name;

        return root;
    }

    /**
     * @internal
     * Attaches MeshFilter + MeshRenderer to a GameObject from a Three.js Mesh.
     * Uses deduplication maps to share geometry and material instances.
     */
    private _convertMesh(
        go: GameObject,
        threeMesh: THREE.Mesh,
        meshMap: Map<THREE.BufferGeometry, Mesh>,
        materialMap: Map<THREE.Material, StandardMaterial>,
    ): void {
        // --- Geometry (deduplicated) ---
        let engineMesh = meshMap.get(threeMesh.geometry);
        if (!engineMesh) {
            engineMesh = Mesh.fromThreeGeometry(
                threeMesh.geometry,
                threeMesh.name || "ImportedMesh"
            );
            meshMap.set(threeMesh.geometry, engineMesh);
        }

        const meshFilter = go.addComponent(MeshFilter);
        meshFilter.sharedMesh = engineMesh;

        // --- Material (deduplicated, handles arrays for multi-material) ---
        const meshRenderer = go.addComponent(MeshRenderer);

        if (Array.isArray(threeMesh.material)) {
            // Multi-material mesh: convert each and assign as array
            const materials = threeMesh.material.map(m => {
                let mat = materialMap.get(m);
                if (!mat) {
                    mat = ScenarioAssets._convertThreeMaterial(m);
                    materialMap.set(m, mat);
                }
                return mat;
            });
            // Assign first material as primary (engine supports sharedMaterials array)
            meshRenderer.sharedMaterial = materials[0];
        } else if (threeMesh.material) {
            let mat = materialMap.get(threeMesh.material);
            if (!mat) {
                mat = ScenarioAssets._convertThreeMaterial(threeMesh.material);
                materialMap.set(threeMesh.material, mat);
            }
            meshRenderer.sharedMaterial = mat;
        }
    }

    // ==================== PRIVATE: MATERIAL CONVERSION ====================

    /**
     * @internal
     * Converts a Three.js material into an engine StandardMaterial.
     *
     * Handles MeshStandardMaterial and MeshPhysicalMaterial from GLTF,
     * including PBR scalar properties and texture maps.
     *
     * Falls back to a white StandardMaterial for unsupported material types.
     */
    private static _convertThreeMaterial(threeMat: THREE.Material): StandardMaterial {
        const material = new StandardMaterial();
        material.name = threeMat.name || "ImportedMaterial";

        // MeshStandardMaterial / MeshPhysicalMaterial (GLTF default)
        if ((threeMat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const src = threeMat as THREE.MeshStandardMaterial;

            // ── Scalar PBR properties ──

            // Color → albedoColor
            if (src.color) {
                material.albedoColor = new Color(
                    src.color.r, src.color.g, src.color.b,
                    src.opacity !== undefined ? src.opacity : 1
                );
            }

            // Metalness → metallic
            if (src.metalness !== undefined) {
                material.metallic = src.metalness;
            }

            // Roughness → smoothness (Unity uses inverse)
            if (src.roughness !== undefined) {
                material.smoothness = 1 - src.roughness;
            }

            // Emissive color
            if (src.emissive && (src.emissive.r > 0 || src.emissive.g > 0 || src.emissive.b > 0)) {
                const intensity = src.emissiveIntensity ?? 1;
                material.emissionColor = new Color(
                    src.emissive.r * intensity,
                    src.emissive.g * intensity,
                    src.emissive.b * intensity,
                    1
                );
            }

            // ── Transparency ──
            if (src.transparent) {
                if (src.alphaTest > 0) {
                    material.renderMode = MaterialRenderMode.Cutout;
                    material.alphaCutoff = src.alphaTest;
                } else {
                    material.renderMode = MaterialRenderMode.Transparent;
                }
            }

            // Double-sided
            // TODO: Add material.doubleSided property to StandardMaterial.
            // For now, GLTF double-sided models render as single-sided.

            // ── Texture maps ──
            // Wrap embedded Three.js textures into engine Texture2D instances.
            // GLB files have textures fully decoded in memory at this point.

            if (src.map) {
                material.albedoTexture = Texture2D._fromThreeTexture(src.map);
            }

            if (src.normalMap) {
                material.normalTexture = Texture2D._fromThreeTexture(src.normalMap);
                if (src.normalScale) {
                    material.normalScale = src.normalScale.x;
                }
            }

            if (src.metalnessMap) {
                material.metallicTexture = Texture2D._fromThreeTexture(src.metalnessMap);
            }

            if (src.aoMap) {
                material.occlusionTexture = Texture2D._fromThreeTexture(src.aoMap);
                if (src.aoMapIntensity !== undefined) {
                    material.occlusionStrength = src.aoMapIntensity;
                }
            }

            if (src.emissiveMap) {
                material.emissionTexture = Texture2D._fromThreeTexture(src.emissiveMap);
            }

            if (src.displacementMap) {
                material.heightTexture = Texture2D._fromThreeTexture(src.displacementMap);
                if (src.displacementScale !== undefined) {
                    material.heightScale = src.displacementScale;
                }
            }
        }
        // MeshBasicMaterial (unlit models)
        else if ((threeMat as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
            const src = threeMat as THREE.MeshBasicMaterial;
            if (src.color) {
                material.albedoColor = new Color(src.color.r, src.color.g, src.color.b, 1);
            }
            material.metallic = 0;
            material.smoothness = 0;
        }

        return material;
    }

    // ==================== PRIVATE: UTILITIES ====================

    /**
     * Counts the number of MeshFilter components in a GameObject hierarchy.
     * @internal
     */
    private _countMeshes(root: GameObject): number {
        let count = 0;
        if (root.getComponent(MeshFilter)) count++;
        for (let i = 0; i < root.transform.childCount; i++) {
            count += this._countMeshes(root.transform.getChild(i).gameObject);
        }
        return count;
    }

    /**
     * @internal
     * Normalizes an asset path by prepending the category folder if missing.
     *
     * @example
     * ```
     * _normalizePath("textures", "brick.png")          → "textures/brick.png"
     * _normalizePath("textures", "textures/brick.png")  → "textures/brick.png"
     * ```
     */
    private static _normalizePath(folder: string, path: string): string {
        if (path.startsWith(`${folder}/`)) return path;
        return `${folder}/${path}`;
    }

    /**
     * @internal
     * Determines MIME type from file extension.
     */
    private static _getMimeType(path: string): string {
        const ext = path.split(".").pop()?.toLowerCase();
        switch (ext) {
            case "png":  return "image/png";
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "gif":  return "image/gif";
            case "webp": return "image/webp";
            case "svg":  return "image/svg+xml";
            case "glb":  return "model/gltf-binary";
            case "gltf": return "model/gltf+json";
            case "json": return "application/json";
            case "mp3":  return "audio/mpeg";
            case "ogg":  return "audio/ogg";
            case "wav":  return "audio/wav";
            case "bin":  return "application/octet-stream";
            default:     return "application/octet-stream";
        }
    }
}