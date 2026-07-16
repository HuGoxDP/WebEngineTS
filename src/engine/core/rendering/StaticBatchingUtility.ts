// path: src/engine/core/rendering/StaticBatchingUtility.ts

import { Mesh, type MeshCombineInstance } from "../graphics/Mesh.ts";
import { Matrix4x4 } from "../math/Matrix4x4.ts";
import { MeshFilter } from "./MeshFilter.ts";
import { MeshRenderer } from "./MeshRenderer.ts";
import { GameObject } from "../GameObject.ts";
import type { Material } from "../graphics/Material.ts";

/** @internal One renderer scheduled for batching. */
interface BatchEntry {
    mesh: Mesh;
    matrix: Matrix4x4;
    renderer: MeshRenderer;
}

/**
 * Combines many static {@link MeshRenderer}s that share a material into a single
 * mesh per material, cutting the draw-call count for static scene geometry.
 *
 * This auto-detects renderers sharing a material, bakes each source mesh by its
 * world transform via {@link Mesh.combine}, and creates one batched GameObject
 * per material group; the source renderers are disabled. Use it once, after the
 * static content of a scene is in place — the combined mesh no longer tracks the
 * originals' transforms, so it is for **static** geometry only.
 *
 * @remarks
 * Equivalent to Unity's `StaticBatchingUtility.Combine`. Multi-material renderers
 * are skipped (single material per renderer is supported). Only groups with two
 * or more members are combined.
 *
 * @example
 * ```ts
 * // Batch every static MeshRenderer under an environment root:
 * StaticBatchingUtility.combineRoot(environmentRoot);
 * ```
 */
export class StaticBatchingUtility {

    /**
     * Combines the given objects' mesh renderers by shared material.
     *
     * @param sources — GameObjects whose (MeshFilter + MeshRenderer) should be batched.
     * @param batchRoot — optional parent for the created batch objects (organizational;
     *                    world transforms are preserved).
     * @returns the created batch GameObjects (one per combined material group).
     */
    public static combine(sources: GameObject[], batchRoot?: GameObject | null): GameObject[] {
        const groups = new Map<Material, BatchEntry[]>();

        for (const go of sources) {
            if (go == null || !go.exists()) continue;

            const renderer = go.getComponent(MeshRenderer);
            const filter = go.getComponent(MeshFilter);
            if (renderer === null || filter === null) continue;
            if (renderer.sharedMaterials.length > 1) continue; // multi-material not supported

            const material = renderer.sharedMaterial;
            const mesh = filter.sharedMesh;
            if (material === null || mesh === null) continue;

            const t = go.transform;
            const matrix = Matrix4x4.TRS(t.position, t.rotation, t.lossyScale);

            let list = groups.get(material);
            if (list === undefined) {
                list = [];
                groups.set(material, list);
            }
            list.push({ mesh, matrix, renderer });
        }

        const batches: GameObject[] = [];

        for (const [material, entries] of groups) {
            if (entries.length < 2) continue; // a single object gains nothing from batching

            const instances: MeshCombineInstance[] = entries.map(e => ({
                mesh: e.mesh,
                matrix: e.matrix,
            }));

            let combined: Mesh;
            try {
                combined = Mesh.combine(instances, `Static Batch (${material.name})`);
            } catch (err) {
                console.warn(
                    `[StaticBatchingUtility] Skipped a batch for material "${material.name}":`,
                    err,
                );
                continue;
            }

            const batchGO = new GameObject(`Static Batch (${material.name})`);
            batchGO.addComponent(MeshFilter).sharedMesh = combined;
            batchGO.addComponent(MeshRenderer).sharedMaterial = material;

            // The combined mesh is baked in world space, so the batch object stays
            // at the world origin; parenting preserves that world transform.
            if (batchRoot != null && batchRoot.exists()) {
                batchGO.transform.setParent(batchRoot.transform, true);
            }

            // The originals are now part of the batch — stop them rendering.
            for (const e of entries) {
                e.renderer.enabled = false;
            }

            batches.push(batchGO);
        }

        return batches;
    }

    /**
     * Convenience wrapper that batches every {@link MeshRenderer} on `root` and
     * its descendants.
     *
     * @param root — the root whose subtree is batched (also the batch parent).
     * @returns the created batch GameObjects.
     */
    public static combineRoot(root: GameObject): GameObject[] {
        const seen = new Set<GameObject>();
        const gos: GameObject[] = [];
        for (const renderer of root.getComponentsInChildren(MeshRenderer)) {
            const go = renderer.gameObject;
            if (!seen.has(go)) {
                seen.add(go);
                gos.push(go);
            }
        }
        return StaticBatchingUtility.combine(gos, root);
    }

    private constructor() {}
}
