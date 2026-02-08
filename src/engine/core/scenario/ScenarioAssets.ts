// path: src/engine/core/scenario/ScenarioAssets.ts

import JSZip from "jszip";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Texture2D } from "../graphics/Texture2D.ts";
import { GameObject } from "../GameObject.ts";
import { MeshFilter } from "../rendering/MeshFilter.ts";
import { MeshRenderer } from "../rendering/MeshRenderer.ts";
import { Mesh } from "../graphics/Mesh.ts";
import { StandardMaterial } from "../graphics/StandardMaterial.ts";
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

    // ==================== CONSTRUCTOR ====================

    /**
     * @param zip — a parsed JSZip instance representing the scenario archive.
     */
    constructor(zip: JSZip) {
        this._zip = zip;
        this._gltfLoader = new GLTFLoader();
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
     * @param path — path relative to `assets/models/` or `assets/`.
     * @returns a root GameObject containing child meshes.
     *
     * @remarks
     * The first load parses the GLTF and caches the result as a "prefab".
     * Subsequent loads return the same reference.
     * Full prefab cloning will be supported when GameObject.clone() is
     * implemented.
     */
    public async loadModel(path: string): Promise<GameObject> {
        const normalizedPath = ScenarioAssets._normalizePath("models", path);

        // Return cached prefab (TODO: clone when GameObject.clone() exists)
        const cached = this._modelCache.get(normalizedPath);
        if (cached) return cached;

        // Read raw bytes from ZIP
        const file = this._zip.file(`assets/${normalizedPath}`);
        if (!file) {
            throw new Error(`[ScenarioAssets] Model not found: assets/${normalizedPath}`);
        }

        const data = await file.async("arraybuffer");
        const blob = new Blob([data], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        this._blobUrls.push(url);

        // Load via Three.js GLTFLoader
        const gltf = await this._loadGLTF(url);

        // Convert Three.js scene graph → engine GameObjects
        const root = this._convertGLTFToGameObject(gltf, path);

        // Cache as prefab template
        this._modelCache.set(normalizedPath, root);

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

    // ==================== PRIVATE: GLTF LOADING ====================

    /**
     * @internal
     * Loads a GLTF/GLB from a blob URL using Three.js GLTFLoader.
     */
    private _loadGLTF(url: string): Promise<GLTF> {
        return new Promise((resolve, reject) => {
            this._gltfLoader.load(
                url,
                (gltf) => resolve(gltf),
                undefined,
                (error) => reject(new Error(`[ScenarioAssets] GLTF load failed: ${error}`))
            );
        });
    }

    /**
     * @internal
     * Converts a Three.js GLTF scene into an engine GameObject hierarchy.
     *
     * For each mesh in the GLTF scene:
     * 1. Creates a GameObject with MeshFilter + MeshRenderer.
     * 2. Copies the local transform (position, rotation, scale).
     * 3. Converts Three.js material → engine StandardMaterial.
     * 4. Attaches as a child of the root GameObject.
     *
     * **Three.js isolation:**
     * All THREE.Mesh/Material/Geometry access happens here — the returned
     * GameObjects contain only engine types.
     */
    private _convertGLTFToGameObject(gltf: GLTF, name: string): GameObject {
        const root = new GameObject(name);

        gltf.scene.traverse((child) => {
            if (!(child as THREE.Mesh).isMesh) return;

            const threeMesh = child as THREE.Mesh;
            const meshObject = new GameObject(threeMesh.name || "Mesh");

            // --- Transform ---
            // Use setter assignment (not mutation) because getters return clones.
            meshObject.transform.localPosition = new Vector3(
                threeMesh.position.x,
                threeMesh.position.y,
                threeMesh.position.z
            );
            meshObject.transform.localRotation = new Quaternion(
                threeMesh.quaternion.x,
                threeMesh.quaternion.y,
                threeMesh.quaternion.z,
                threeMesh.quaternion.w
            );
            meshObject.transform.localScale = new Vector3(
                threeMesh.scale.x,
                threeMesh.scale.y,
                threeMesh.scale.z
            );

            // --- Geometry ---
            const meshFilter = meshObject.addComponent(MeshFilter);
            meshFilter.sharedMesh = Mesh.fromThreeGeometry(
                threeMesh.geometry,
                threeMesh.name || "ImportedMesh"
            );

            // --- Material ---
            const meshRenderer = meshObject.addComponent(MeshRenderer);
            if (threeMesh.material) {
                const material = ScenarioAssets._convertThreeMaterial(
                    threeMesh.material as THREE.Material
                );
                meshRenderer.sharedMaterial = material;
            }

            // --- Hierarchy ---
            meshObject.transform.parent = root.transform;
        });

        return root;
    }

    // ==================== PRIVATE: MATERIAL CONVERSION ====================

    /**
     * @internal
     * Converts a Three.js material into an engine StandardMaterial.
     *
     * Handles MeshStandardMaterial and MeshPhysicalMaterial from GLTF.
     * Falls back to a white StandardMaterial for unsupported material types.
     */
    private static _convertThreeMaterial(threeMat: THREE.Material): StandardMaterial {
        const material = new StandardMaterial();
        material.name = threeMat.name || "ImportedMaterial";

        // MeshStandardMaterial / MeshPhysicalMaterial (GLTF default)
        if ((threeMat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const src = threeMat as THREE.MeshStandardMaterial;

            // Color → albedoColor
            if (src.color) {
                material.albedoColor = new Color(src.color.r, src.color.g, src.color.b, 1);
            }

            // PBR properties
            if (src.metalness !== undefined) {
                material.metallic = src.metalness;
            }
            if (src.roughness !== undefined) {
                material.smoothness = 1 - src.roughness; // Unity uses smoothness (inverse of roughness)
            }

            // Emissive
            if (src.emissive && (src.emissive.r > 0 || src.emissive.g > 0 || src.emissive.b > 0)) {
                material.emissionColor = new Color(src.emissive.r, src.emissive.g, src.emissive.b, 1);
            }

            // TODO: Convert texture maps (albedoTexture, normalTexture, etc.)
            // This requires loading Three.js textures into Texture2D instances,
            // which needs async processing. Deferring to a future iteration.
        }

        return material;
    }

    // ==================== PRIVATE: UTILITY ====================

    /**
     * @internal
     * Normalizes an asset path by prepending the category folder if missing.
     *
     * @example
     * ```
     * _normalizePath("textures", "brick.png")        → "textures/brick.png"
     * _normalizePath("textures", "textures/brick.png") → "textures/brick.png"
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
            default:     return "application/octet-stream";
        }
    }
}