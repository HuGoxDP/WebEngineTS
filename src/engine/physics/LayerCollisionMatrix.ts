/** Number of layers, matching the width of the bitmask a body carries. */
const LAYER_COUNT = 32;

/** Every bit set — the default, where every layer collides with every other. */
const ALL_LAYERS = ~0 >>> 0;

/**
 * Which layers collide with which.
 *
 * @remarks
 * Equivalent to Unity's Physics layer collision matrix (Project Settings →
 * Physics). It is the cheap way to stop whole categories of object from ever
 * being tested against each other — UI colliders against terrain, debris
 * against debris — and it is enforced in the broad phase, so an ignored pair
 * costs nothing rather than costing a rejected contact.
 *
 * The matrix is **symmetric**: ignoring A→B ignores B→A. A one-way collision is
 * not a thing physics engines model, and pretending otherwise would produce a
 * pair that collides or not depending on which body the solver looked at first.
 *
 * ```ts
 * LayerCollisionMatrix.ignoreLayerCollision(Layers.UI, Layers.DEFAULT);
 * ```
 *
 * Changes apply to bodies created afterwards, and to existing ones once
 * `Physics._refreshLayerFilters()` runs — which {@link ignoreLayerCollision}
 * triggers, so callers do not have to think about it.
 */
export class LayerCollisionMatrix {

    /**
     * Bit `j` of `_masks[i]` is set when layer `i` collides with layer `j`.
     * Starts fully permissive, as Unity's does.
     */
    private static readonly _masks: number[] = new Array(LAYER_COUNT).fill(ALL_LAYERS);

    /** Called when the matrix changes, so live bodies can be re-filtered. */
    private static _onChanged: (() => void) | null = null;

    private constructor() {}

    /** How many layers the matrix covers. */
    public static get layerCount(): number { return LAYER_COUNT; }

    /**
     * Sets whether two layers collide.
     *
     * @remarks
     * Equivalent to Unity's `Physics.IgnoreLayerCollision`. Symmetric: the
     * reverse pair is set to match.
     *
     * @param layerA - first layer, 0–31.
     * @param layerB - second layer, 0–31.
     * @param ignore - true to stop them colliding. Defaults to true.
     */
    public static ignoreLayerCollision(layerA: number, layerB: number, ignore: boolean = true): void {
        if (!LayerCollisionMatrix._valid(layerA) || !LayerCollisionMatrix._valid(layerB)) return;

        const bitB = 1 << layerB;
        const bitA = 1 << layerA;

        if (ignore) {
            LayerCollisionMatrix._masks[layerA] &= ~bitB;
            LayerCollisionMatrix._masks[layerB] &= ~bitA;
        } else {
            LayerCollisionMatrix._masks[layerA] |= bitB;
            LayerCollisionMatrix._masks[layerB] |= bitA;
        }

        LayerCollisionMatrix._onChanged?.();
    }

    /**
     * Whether two layers currently collide.
     *
     * @remarks Equivalent to Unity's `Physics.GetIgnoreLayerCollision`, inverted.
     */
    public static collides(layerA: number, layerB: number): boolean {
        if (!LayerCollisionMatrix._valid(layerA) || !LayerCollisionMatrix._valid(layerB)) return false;
        return (LayerCollisionMatrix._masks[layerA] & (1 << layerB)) !== 0;
    }

    /**
     * The bitmask of layers `layer` collides with.
     *
     * @remarks
     * This is what a physics body carries as its collision filter, so the
     * broad phase can reject a pair without building a contact for it.
     *
     * @param layer - the layer to ask about.
     */
    public static maskFor(layer: number): number {
        return LayerCollisionMatrix._valid(layer)
            ? LayerCollisionMatrix._masks[layer]
            : ALL_LAYERS;
    }

    /** Restores the default, where every layer collides with every other. */
    public static reset(): void {
        LayerCollisionMatrix._masks.fill(ALL_LAYERS);
        LayerCollisionMatrix._onChanged?.();
    }

    /**
     * @internal
     * Registers the callback that re-applies the matrix to live bodies.
     * Set by `Physics` at module load.
     */
    public static _setChangeHandler(handler: (() => void) | null): void {
        LayerCollisionMatrix._onChanged = handler;
    }

    private static _valid(layer: number): boolean {
        return Number.isInteger(layer) && layer >= 0 && layer < LAYER_COUNT;
    }
}
