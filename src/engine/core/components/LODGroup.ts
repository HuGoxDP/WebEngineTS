// path: src/engine/core/components/LODGroup.ts

import { Behaviour } from "../Behaviour.ts";
import { Renderer } from "../rendering/Renderer.ts";
import { Camera } from "./Camera.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Serializable, SerializedField } from "../reflection/Decorators.ts";
import { FieldType } from "../reflection/Types.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * One level of detail within a {@link LODGroup}.
 *
 * @remarks Equivalent to Unity's `UnityEngine.LOD` struct.
 */
/**
 * The shape a level can be given in, so callers may pass plain object literals.
 *
 * @remarks
 * {@link LODGroup.setLODs} normalizes anything of this shape into a {@link LOD},
 * which is the instance the serializer can read metadata from.
 */
export interface LODLevel {
    screenRelativeTransitionHeight: number;
    renderers: Renderer[];
}

@Serializable({ typeName: "LOD", category: "Rendering" })
export class LOD implements LODLevel {
    /**
     * Screen-relative height (0–1) at or above which this level is active.
     * As the object shrinks on screen below this value, the group switches to
     * the next (lower-detail) level. Highest-detail level has the largest value.
     */
    @SerializedField()
    public screenRelativeTransitionHeight: number = 0;

    /** Renderers shown while this level is the active LOD. */
    @SerializedField({ type: FieldType.Array, elementType: FieldType.Component })
    public renderers: Renderer[] = [];

    /**
     * @param screenRelativeTransitionHeight - activation threshold (0–1).
     * @param renderers - renderers shown while this level is active.
     *
     * @remarks
     * A class rather than an interface so the serializer can record what it
     * holds: its `renderers` are component references, which one level of field
     * metadata on `LODGroup` could not describe. Object literals still satisfy
     * it structurally, so existing `setLODs([{ ... }])` calls are unaffected —
     * {@link LODGroup.setLODs} normalizes them into instances.
     */
    constructor(screenRelativeTransitionHeight: number = 0, renderers: Renderer[] = []) {
        this.screenRelativeTransitionHeight = screenRelativeTransitionHeight;
        this.renderers = renderers;
    }
}

/**
 * Selects which of several detail levels to display based on how large the
 * object appears on screen, disabling the others (and culling entirely when the
 * object is smaller than the lowest level's threshold).
 *
 * Switching to cheaper meshes for distant objects reduces vertex and draw-call
 * cost — the standard level-of-detail optimization for large scenes.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.LODGroup`. Levels are ordered from highest
 * detail (largest {@link LOD.screenRelativeTransitionHeight}) to lowest; the
 * screen-relative height is `size / frustumHeightAtDistance`, matching Unity's
 * definition. Selection runs once per frame against {@link Camera.main}.
 *
 * @example
 * ```ts
 * const group = go.addComponent(LODGroup);
 * group.size = 2; // world-space diameter used for the calculation
 * group.setLODs([
 *     { screenRelativeTransitionHeight: 0.5, renderers: [highDetail] },
 *     { screenRelativeTransitionHeight: 0.2, renderers: [midDetail] },
 *     { screenRelativeTransitionHeight: 0.05, renderers: [lowDetail] },
 * ]);
 * ```
 */
@Serializable({ typeName: "LODGroup", category: "Rendering" })
export class LODGroup extends Behaviour {

    // ==================== STATIC REGISTRY ====================

    /** @internal */
    private static _activeInstances: Set<LODGroup> = new Set();

    /**
     * @internal
     * Updates every active LOD group. Called once per frame from
     * Application._loop after LateUpdate, before rendering.
     */
    public static _updateAll(): void {
        if (LODGroup._activeInstances.size === 0) return;
        const cam = Camera.main;
        if (cam === null) return;
        for (const group of LODGroup._activeInstances) {
            if (group.isActiveAndEnabled) group._updateLOD(cam);
        }
    }

    /** @internal */
    public static _reset(): void {
        LODGroup._activeInstances.clear();
    }

    /**
     * @internal
     * Screen-relative height fraction for an object of `size` (world diameter)
     * at `distance` from a camera with vertical field of view `fovDeg`.
     */
    public static computeRelativeHeight(size: number, distance: number, fovDeg: number): number {
        if (distance <= 1e-6) return Infinity;
        const frustumHeight = 2 * distance * Math.tan((fovDeg * Math.PI) / 360);
        if (frustumHeight <= 1e-6) return Infinity;
        return size / frustumHeight;
    }

    // ==================== FIELDS ====================

    /**
     * The world-space size (diameter) of the object, used to compute its
     * on-screen height. Defaults to `1`.
     *
     * @remarks Equivalent to Unity's `LODGroup.size`.
     */
    @SerializedField()
    public size: number = 1;

    /** Levels, sorted from highest detail (largest threshold) to lowest. @internal */
    private _lods: LOD[] = [];

    /** Index of the currently displayed level, or −1 when culled. @internal */
    private _currentIndex: number = -1;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "LODGroup";
    }

    // ==================== PUBLIC API ====================

    /** The number of configured LOD levels. */
    public get lodCount(): number {
        return this._lods.length;
    }

    /**
     * The index of the currently active level, or `-1` if the object is
     * culled (smaller than the lowest level's threshold) or not yet evaluated.
     *
     * @remarks Comparable to inspecting Unity's active LOD.
     */
    public get currentLOD(): number {
        return this._currentIndex;
    }

    /**
     * Replaces all levels. Levels are copied and sorted by
     * {@link LOD.screenRelativeTransitionHeight} descending; all renderers are
     * hidden until the next frame's evaluation.
     *
     * @remarks Equivalent to Unity's `LODGroup.SetLODs`.
     */
    public setLODs(lods: ReadonlyArray<LODLevel>): void {
        this._lods = lods
            // An object literal is copied into a real level; one that already is
            // a LOD is kept as-is. Identity matters during a load: a reference
            // inside it resolves in a later pass, and copying here would leave
            // that pass writing into a discarded object.
            // A literal is copied into a real level; one that already is a LOD
            // is kept as-is. Identity matters during a load: a reference inside
            // it resolves in a later pass, and copying here would leave that
            // pass writing into a discarded object.
            .map(l => (l instanceof LOD
                ? l
                : new LOD(l.screenRelativeTransitionHeight, [...l.renderers])))
            .sort((a, b) => b.screenRelativeTransitionHeight - a.screenRelativeTransitionHeight);
        this._currentIndex = -1;
        this._applyVisibility(-1);
    }

    /**
     * The configured levels, highest-detail first.
     *
     * @remarks
     * The property form of {@link getLODs} / {@link setLODs}, and what
     * serialization reads. Both sides copy, so the returned array can be
     * modified without disturbing the group.
     */
    @SerializedField({ type: FieldType.Array })
    public get lods(): LOD[] {
        return this.getLODs();
    }

    public set lods(value: LOD[]) {
        this.setLODs(value);
    }

    /**
     * Returns a copy of the configured levels (sorted highest-detail first).
     *
     * @remarks Equivalent to Unity's `LODGroup.GetLODs`.
     */
    public getLODs(): LOD[] {
        return this._lods.map(l => new LOD(l.screenRelativeTransitionHeight, [...l.renderers]));
    }

    /**
     * Appends a single level and re-sorts.
     *
     * @param screenRelativeTransitionHeight — the level's activation threshold (0–1).
     * @param renderers — renderers shown while this level is active.
     */
    public addLOD(screenRelativeTransitionHeight: number, renderers: Renderer[]): void {
        this.setLODs([...this._lods, new LOD(screenRelativeTransitionHeight, renderers)]);
    }

    /**
     * Forces re-evaluation against the main camera immediately, rather than
     * waiting for the next frame. No-op if there is no main camera.
     */
    public recalculate(): void {
        const cam = Camera.main;
        if (cam !== null) this._updateLOD(cam);
    }

    // ==================== LIFECYCLE ====================

    protected override onEnable(): void {
        LODGroup._activeInstances.add(this);
    }

    protected override onDisable(): void {
        LODGroup._activeInstances.delete(this);
    }

    protected override onDestroy(): void {
        LODGroup._activeInstances.delete(this);
        this._lods = [];
    }

    // ==================== PRIVATE ====================

    /**
     * @internal
     * Index of the active level for a screen-relative height, or −1 (culled).
     * Levels are sorted descending, so the first whose threshold is met wins.
     */
    private _selectIndex(relativeHeight: number): number {
        for (let i = 0; i < this._lods.length; i++) {
            if (relativeHeight >= this._lods[i].screenRelativeTransitionHeight) {
                return i;
            }
        }
        return -1;
    }

    /** @internal Evaluates and applies the active level for the given camera. */
    private _updateLOD(cam: Camera): void {
        const distance = Vector3.distance(cam.transform.position, this.transform.position);
        const relativeHeight = LODGroup.computeRelativeHeight(this.size, distance, cam.fieldOfView);
        const index = this._selectIndex(relativeHeight);
        if (index !== this._currentIndex) {
            this._applyVisibility(index);
            this._currentIndex = index;
        }
    }

    /**
     * @internal
     * Enables the renderers of the active level and disables all others.
     * `activeIndex === -1` disables everything (culled).
     */
    private _applyVisibility(activeIndex: number): void {
        for (let i = 0; i < this._lods.length; i++) {
            const on = i === activeIndex;
            const renderers = this._lods[i].renderers;
            for (const r of renderers) {
                if (r != null && r.exists()) r.enabled = on;
            }
        }
    }
}
