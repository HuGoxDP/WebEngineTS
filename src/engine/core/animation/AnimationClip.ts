import * as THREE from "three";

/**
 * A container for animation keyframe data.
 *
 * @remarks
 * Equivalent to Unity's `AnimationClip`.
 * Wraps a Three.js AnimationClip internally. Created automatically
 * when loading GLTF models that contain animation data.
 */
export class AnimationClip {
    /** @internal The underlying Three.js animation clip. */
    public readonly _threeClip: THREE.AnimationClip;

    /**
     * @internal
     * Wraps a clip that a model importer has already parsed.
     *
     * A constructor cannot be renamed out of the public surface the way
     * `_fromThreeGeometry` was, so the tag is the whole of the fence. Nothing
     * outside the engine should reach for this: clips arrive with a model, and
     * `Animation.clips` is how scenario code gets at them.
     */
    constructor(threeClip: THREE.AnimationClip) {
        this._threeClip = threeClip;
    }

    /** The name of this animation clip (e.g., "Idle", "Walk", "Run"). */
    public get name(): string { return this._threeClip.name; }

    /** Duration of the clip in seconds. */
    public get duration(): number { return this._threeClip.duration; }

    /** Number of individual property tracks in this clip. */
    public get trackCount(): number { return this._threeClip.tracks.length; }
}
