/**
 * Base class for individual post-processing effects.
 *
 * @remarks
 * Effects are added to the global {@link PostProcessing} pipeline and
 * applied each frame in the order they were added.
 *
 * Subclasses own their underlying Three.js pass and expose engine-friendly
 * parameters (number, Color). The Three.js pass object is kept internal.
 */
export abstract class PostEffect {

    /** Whether this effect participates in the pipeline this frame. */
    public enabled: boolean = true;

    /**
     * @internal Lazily creates the Three.js Pass object.
     * Called by PostProcessing when the pipeline is built.
     */
    public abstract _createPass(width: number, height: number): any;

    /**
     * @internal Syncs public parameters to the underlying pass each frame.
     * Default implementation is a no-op.
     */
    public _updatePass(_pass: any): void {}

    /** @internal Called when the render target resizes. */
    public _resize(_pass: any, _width: number, _height: number): void {}

    /** @internal Disposes GPU resources. */
    public _dispose(_pass: any): void {}
}
