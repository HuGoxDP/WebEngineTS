// path: src/engine/core/scenario/ScenarioAssets.ts

import type JSZip from "jszip";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Texture2D } from "../graphics/Texture2D.ts";
import { AssetDatabase } from "../assets/AssetDatabase.ts";
import { GameObject } from "../GameObject.ts";
import { MeshFilter } from "../rendering/MeshFilter.ts";
import { MeshRenderer } from "../rendering/MeshRenderer.ts";
import { Mesh } from "../graphics/Mesh.ts";
import { StandardMaterial, MaterialRenderMode } from "../graphics/StandardMaterial.ts";
import { Color } from "../math/Color.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { IAssetProvider, IScenarioAssetEntry } from "./ScenarioTypes.ts";
import { Resources, type IAssetSource } from "../assets/Resources.ts";
import { ZipAssetSource } from "../assets/ZipAssetSource.ts";
import { mimeTypeForPath } from "../assets/_AssetMime.ts";
import { Animation } from "../animation/Animation.ts";
import { AnimationClip } from "../animation/AnimationClip.ts";

/**
 * Runtime asset manager for a scenario.
 *
 * Loads textures, 3D models, and raw files from the scenario's byte source.
 * All loaded resources are cached and tracked for deterministic cleanup
 * when the scenario is unloaded.
 *
 * @remarks
 * Equivalent to Unity's `Resources` / `AssetDatabase` for runtime use.
 *
 * - Bytes come from an {@link IAssetSource} — an in-memory ZIP
 *   (`ZipAssetSource`) or a manifest fetched over the network
 *   (`StreamingAssetSource`). Which one it is changes only *when* a read
 *   costs something, never what the caller gets back.
 * - Blob URLs are tracked and revoked on {@link dispose}.
 * - Texture2D and model caches prevent redundant loading.
 * - {@link dispose} destroys all engine objects created by this provider.
 *
 * **Three.js isolation:**
 * GLTFLoader and material conversion are private implementation details.
 * Public methods return only engine types (Texture2D, GameObject, Blob).
 *
 * Implements {@link IAssetProvider} so that {@link Scenario} can depend on
 * the interface rather than this concrete class. It also implements
 * {@link IAssetSource} by delegating to its own source, so that blob URLs
 * handed out through `Resources` are revoked by the provider that outlives
 * them.
 */
export class ScenarioAssets implements IAssetProvider, IAssetSource {
    // ==================== PRIVATE STATE ====================

    /** Where bytes are read from. */
    private readonly _source: IAssetSource;

    /**
     * The same object as {@link _source} when it holds its bytes in memory and
     * can be told to drop them — which is what {@link releaseArchive} means.
     * Null for a source that never held them, such as a streaming one.
     */
    private readonly _archive: ZipAssetSource | null;

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
     * @param source — where the scenario's bytes come from: an
     *                 {@link IAssetSource}, or a parsed JSZip instance, which
     *                 is wrapped in a `ZipAssetSource` for you.
     */
    constructor(source: IAssetSource | JSZip) {
        const isAssetSource = typeof (source as IAssetSource).readBytes === "function";
        this._source = isAssetSource
            ? source as IAssetSource
            : new ZipAssetSource(source as JSZip);
        this._archive = this._source instanceof ZipAssetSource ? this._source : null;

        // Create a LoadingManager that resolves external GLTF references
        // (textures, .bin files) from the scenario's source.
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
        const assetPath = path.startsWith("assets/") ? path : `assets/${path}`;
        const bytes = await this._source.readBytes(assetPath);
        return new Blob([ScenarioAssets._toArrayBuffer(bytes)], { type: mimeTypeForPath(path) });
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
     * @deprecated Use {@link getAssetUrl} instead — this method always returns
     * an empty string because an asset's bytes cannot be produced
     * synchronously: JSZip decompresses asynchronously, and a streaming source
     * has to fetch.
     *
     * @param path — path relative to `assets/`.
     * @returns always returns empty string.
     */
    public getBlobUrlSync(path: string): string {
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

        const bytes = await this._source.readBytes(`assets/${normalizedPath}`);
        const data = ScenarioAssets._toArrayBuffer(bytes);

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

        const bytes = await this._source.readBytes(`assets/${normalizedPath}`);
        const data = ScenarioAssets._toArrayBuffer(bytes);

        // Parse directly from ArrayBuffer — no blob URL round-trip
        const gltf = await this._parseGLTF(data, normalizedPath);

        // Convert Three.js scene graph → engine GameObjects
        const root = this._convertGLTFScene(gltf, path);

        // Attach animation clips from GLTF (if any)
        if (gltf.animations.length > 0) {
            const anim = root.addComponent(Animation);
            for (const threeClip of gltf.animations) {
                anim.addClip(new AnimationClip(threeClip));
            }
        }

        // Dispose the original Three.js scene — engine now owns all data.
        // Geometries are safe to dispose (data was copied into engine Mesh).
        // Materials are safe to dispose (replaced by StandardMaterial).
        // Textures are NOT disposed — they are shared with engine Texture2D.
        // Animation clips are NOT disposed — they are referenced by the Animation component.
        ScenarioAssets._disposeThreeScene(gltf.scene);

        // Cache as prefab template
        this._modelCache.set(normalizedPath, root);

        console.log(
            `[ScenarioAssets] Model loaded: "${path}" ` +
            `(${this._countMeshes(root)} meshes, ${gltf.animations.length} animations)`
        );

        return root;
    }

    // ==================== MEMORY MANAGEMENT ====================

    /**
     * Releases the in-memory ZIP archive to free decompressed asset data.
     *
     * Call this after all assets have been loaded (typically at the end of
     * `awake()` or `start()`). After calling this method, no further asset
     * loading is possible — {@link loadTexture}, {@link loadModel},
     * {@link getAsset}, and IAssetSource methods will throw.
     *
     * For a 28 MB compressed scenario archive, this can free ~50–100 MB
     * of decompressed data that JSZip holds in memory.
     *
     * @remarks
     * This is an optimization for scenarios that load all assets upfront.
     * Scenarios that load assets lazily (e.g. on demand during gameplay)
     * should not call this method.
     *
     * @example
     * ```ts
     * async awake() {
     *     const [earth, mars] = await Resources.loadBatch([
     *         [Texture2D, "textures/earth"],
     *         [Texture2D, "textures/mars"],
     *     ]).promise;
     *
     *     // Free the ZIP — no more loading needed
     *     this.context.assets.releaseArchive();
     * }
     * ```
     */
    public releaseArchive(): void {
        if (this._archive === null || this._archive.isReleased) return;
        this._archive.release();
        console.log("[ScenarioAssets] Archive released — no further asset loading possible.");
    }

    /**
     * Whether the archive has been released via {@link releaseArchive}.
     *
     * @remarks
     * Always `false` for a scenario streamed from a manifest: there is no
     * archive to release, because a streaming source never retains the bytes it
     * fetched — `Resources` caches the decoded asset instead. {@link releaseArchive}
     * is a no-op there, and loading keeps working, which is the truth rather
     * than a released flag that would make callers stop.
     */
    public get isArchiveReleased(): boolean {
        return this._archive?.isReleased ?? false;
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
        Resources._clearSource();

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

        // Release the source's own bytes and blob URLs
        this._archive?.dispose();

        console.log("[ScenarioAssets] Disposed.");
    }

    // ==================== IAssetSource IMPLEMENTATION ====================

    /** @internal */
    public has(path: string): boolean {
        return this._source.has(path);
    }

    /** @internal */
    public list(prefix?: string): string[] {
        return this._source.list(prefix);
    }

    /** @internal */
    public async readBytes(path: string): Promise<Uint8Array> {
        return this._source.readBytes(path);
    }

    /** @internal */
    public async readText(path: string): Promise<string> {
        return this._source.readText(path);
    }

    /** @internal */
    public async getBlobUrl(path: string): Promise<string> {
        // Handed out here rather than delegated, so the URL's lifetime belongs
        // to the provider that dispose() runs on.
        const bytes = await this._source.readBytes(path);
        const blob = new Blob([ScenarioAssets._toArrayBuffer(bytes)], {
            type: mimeTypeForPath(path),
        });
        const url = URL.createObjectURL(blob);
        this._blobUrls.push(url);
        return url;
    }

    // ==================== RESOURCES INTEGRATION ====================

    /**
     * @internal
     * Activates this ScenarioAssets as the Resources backend.
     * Registers the GameObject (model) decoder and sets the source.
     * Called by Scenario.run().
     */
    public _activateAsResourceSource(manifestAssets?: readonly IScenarioAssetEntry[]): void {
        // Identities first: a decoder that runs during activation would
        // otherwise bind its asset to a minted id and never see the real one.
        AssetDatabase.setManifest(manifestAssets ?? []);

        // Register model decoder (requires Three.js — stays here, not in Resources)
        Resources.registerDecoder(
            GameObject,
            [".glb", ".gltf"],
            async (bytes: Uint8Array, path: string) => {
                const gltf = await this._parseGLTF(ScenarioAssets._toArrayBuffer(bytes), path);
                const root = this._convertGLTFScene(gltf, path);
                if (gltf.animations.length > 0) {
                    const anim = root.addComponent(Animation);
                    for (const threeClip of gltf.animations) {
                        anim.addClip(new AnimationClip(threeClip));
                    }
                }
                ScenarioAssets._disposeThreeScene(gltf.scene);
                return root;
            },
        );

        Resources._setSource(this);
        console.log("[ScenarioAssets] Resources activated");
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

        // Diagnostic only: a .gltf whose textures and .bin sit beside it needs
        // them resolved out of the source, and setURLModifier is synchronous
        // while every source read is not. Naming the missing file beats a
        // silently untextured model.
        // TODO: resolve external .gltf references by pre-reading them into blob
        // URLs before parseAsync, so a non-embedded .gltf loads like a .glb does.
        this._loadingManager.setURLModifier((url: string) => {
            if (url.startsWith("blob:") || url.startsWith("data:")) return url;

            const sourcePath = basePath + url;
            if (!this._source.has(sourcePath)) {
                console.warn(
                    `[ScenarioAssets] External GLTF resource not found: ${sourcePath}`
                );
            }
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
            const nodeName = threeNode.name || "Node";
            const go = new GameObject(nodeName);

            // Set Object3D name for AnimationMixer track resolution
            go.transform._internalObject3D.name = nodeName;

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

    // ==================== PRIVATE: GLTF CLEANUP ====================

    /**
     * @internal
     * Disposes the original Three.js scene graph after conversion to
     * engine GameObjects is complete.
     *
     * Frees GPU resources (shader programs, buffer objects) that Three.js
     * allocated during GLTF parsing but are no longer needed — the engine
     * now owns all data through its own types.
     *
     * **What is disposed:**
     * - BufferGeometry — vertex/index GPU buffers. Safe because
     *   {@link Mesh.fromThreeGeometry} copies all data into engine arrays.
     * - Materials — GPU shader programs. Safe because we created new
     *   {@link StandardMaterial} instances.
     *
     * **What is NOT disposed:**
     * - Textures — shared with engine {@link Texture2D} via
     *   {@link Texture2D._fromThreeTexture}. Disposing would destroy
     *   the engine's live GPU textures.
     */
    private static _disposeThreeScene(threeScene: THREE.Object3D): void {
        let geometriesDisposed = 0;
        let materialsDisposed = 0;

        threeScene.traverse((node) => {
            // Dispose geometry GPU buffers
            if ((node as THREE.Mesh).isMesh) {
                const mesh = node as THREE.Mesh;
                if (mesh.geometry) {
                    mesh.geometry.dispose();
                    geometriesDisposed++;
                }

                // Dispose material shader programs (NOT their textures)
                const materials = Array.isArray(mesh.material)
                    ? mesh.material
                    : [mesh.material];

                for (const mat of materials) {
                    if (mat) {
                        mat.dispose();
                        materialsDisposed++;
                    }
                }
            }
        });

        if (geometriesDisposed > 0 || materialsDisposed > 0) {
            console.log(
                `[ScenarioAssets] GLTF cleanup: ${geometriesDisposed} geometries, ` +
                `${materialsDisposed} materials disposed`
            );
        }
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
     * Copies a byte view into an ArrayBuffer of exactly its own length.
     *
     * A source may hand back a view onto a larger buffer, and both `Blob` and
     * the GLTF parser take the whole buffer rather than the view — so passing
     * `.buffer` straight through would hand them the neighbouring assets too.
     */
    private static _toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
        return bytes.buffer.slice(
            bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
    }
}