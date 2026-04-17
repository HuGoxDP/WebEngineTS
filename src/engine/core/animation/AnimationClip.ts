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
