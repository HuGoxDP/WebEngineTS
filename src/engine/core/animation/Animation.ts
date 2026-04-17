import * as THREE from "three";
import { Behaviour } from "../Behaviour";
import { AnimationClip } from "./AnimationClip";
import type { GameObject } from "../GameObject";
import { Time } from "../Time";

/**
 * Wrap mode for animation playback.
 */
export enum AnimationWrapMode {
    /** Play once and stop at the last frame. */
    Once = THREE.LoopOnce,
    /** Loop the animation continuously. */
    Loop = THREE.LoopRepeat,
    /** Play forward then backward, repeating. */
    PingPong = THREE.LoopPingPong,
}

/**
 * Plays animation clips on a GameObject hierarchy.
 *
 * @remarks
 * Equivalent to Unity's legacy `Animation` component.
 * Wraps Three.js AnimationMixer internally. The mixer is bound to
 * the root Transform's internal Object3D, so animation tracks resolve
 * by matching child Object3D names to GLTF node names.
 *
 * Animation components are updated automatically each frame via the
 * static {@link _updateAll} method called from the game loop.
 *
 * ```ts
 * const anim = gameObject.getComponent(Animation);
 * anim.play("Walk");
 * anim.crossFade("Run", 0.3);
 * ```
 */
export class Animation extends Behaviour {

    // ==================== STATIC REGISTRY ====================

    /** @internal All active Animation components. Updated each frame. */
    private static _activeInstances: Set<Animation> = new Set();

    /**
     * @internal
     * Updates all active Animation components. Called once per frame
     * from Application._loop() after Update, before LateUpdate.
     */
    public static _updateAll(): void {
        const dt = Time.deltaTime;
        for (const anim of this._activeInstances) {
            if (anim.isActiveAndEnabled && anim._mixer) {
                anim._mixer.update(dt);
            }
        }
    }

    /** @internal Clears all registrations (e.g., on scene unload). */
    public static _reset(): void {
        this._activeInstances.clear();
    }

    // ==================== INSTANCE ====================

    /** @internal The Three.js animation mixer. */
    private _mixer: THREE.AnimationMixer | null = null;

    /** All clips available on this animation component. */
    private _clips: AnimationClip[] = [];

    /** Map of clip name → THREE.AnimationAction for quick lookup. */
    private _actions: Map<string, THREE.AnimationAction> = new Map();

    /** The currently playing action (if any). */
    private _currentAction: THREE.AnimationAction | null = null;

    /** The name of the currently playing clip. */
    private _currentClipName: string = "";

    /** Playback speed multiplier. */
    private _speed: number = 1;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ==================== PROPERTIES ====================

    /** All animation clips on this component. */
    public get clips(): ReadonlyArray<AnimationClip> { return this._clips; }

    /** The number of clips available. */
    public get clipCount(): number { return this._clips.length; }

    /** Whether an animation is currently playing. */
    public get isPlaying(): boolean {
        return this._currentAction !== null && this._currentAction.isRunning();
    }

    /** The name of the currently playing clip, or empty string. */
    public get currentClipName(): string { return this._currentClipName; }

    /** Playback speed (1 = normal, 0.5 = half speed, -1 = reverse). */
    public get speed(): number { return this._speed; }
    public set speed(value: number) {
        this._speed = value;
        if (this._currentAction) {
            this._currentAction.timeScale = value;
        }
    }

    /**
     * The current playback time (in seconds) of the active clip.
     * Can be set to seek to a specific point.
     */
    public get time(): number {
        return this._currentAction?.time ?? 0;
    }

    public set time(value: number) {
        if (this._currentAction) {
            this._currentAction.time = value;
        }
    }

    // ==================== PUBLIC API ====================

    /**
     * Adds an animation clip to this component.
     * @param clip The clip to add.
     */
    public addClip(clip: AnimationClip): void {
        if (this._clips.some(c => c.name === clip.name)) return;
        this._clips.push(clip);
        // Rebuild action cache if mixer exists
        if (this._mixer) {
            this._buildAction(clip);
        }
    }

    /**
     * Gets a clip by name.
     * @param name The clip name.
     * @returns The clip, or null if not found.
     */
    public getClip(name: string): AnimationClip | null {
        return this._clips.find(c => c.name === name) ?? null;
    }

    /**
     * Plays the named animation clip.
     * Stops any currently playing animation first.
     *
     * @param clipName The name of the clip to play.
     * @param wrapMode How the animation should loop (default: Loop).
     */
    public play(clipName: string, wrapMode: AnimationWrapMode = AnimationWrapMode.Loop): void {
        const action = this._getAction(clipName);
        if (!action) {
            console.warn(`[Animation] Clip "${clipName}" not found on "${this.gameObject.name}"`);
            return;
        }

        if (this._currentAction && this._currentAction !== action) {
            this._currentAction.stop();
        }

        action.loop = wrapMode as unknown as THREE.AnimationActionLoopStyles;
        action.clampWhenFinished = wrapMode === AnimationWrapMode.Once;
        action.timeScale = this._speed;
        action.reset().play();
        this._currentAction = action;
        this._currentClipName = clipName;
    }

    /**
     * Smoothly transitions from the current animation to a new one.
     *
     * @param clipName The name of the clip to transition to.
     * @param duration Crossfade duration in seconds (default: 0.3).
     * @param wrapMode How the new animation should loop (default: Loop).
     */
    public crossFade(clipName: string, duration: number = 0.3, wrapMode: AnimationWrapMode = AnimationWrapMode.Loop): void {
        const action = this._getAction(clipName);
        if (!action) {
            console.warn(`[Animation] Clip "${clipName}" not found on "${this.gameObject.name}"`);
            return;
        }

        action.loop = wrapMode as unknown as THREE.AnimationActionLoopStyles;
        action.clampWhenFinished = wrapMode === AnimationWrapMode.Once;
        action.timeScale = this._speed;
        action.reset().play();

        if (this._currentAction && this._currentAction !== action) {
            this._currentAction.crossFadeTo(action, duration, true);
        }

        this._currentAction = action;
        this._currentClipName = clipName;
    }

    /**
     * Stops all animation playback.
     */
    public stop(): void {
        if (this._currentAction) {
            this._currentAction.stop();
            this._currentAction = null;
            this._currentClipName = "";
        }
    }

    /**
     * Pauses the current animation.
     */
    public pause(): void {
        if (this._currentAction) {
            this._currentAction.paused = true;
        }
    }

    /**
     * Resumes a paused animation.
     */
    public resume(): void {
        if (this._currentAction) {
            this._currentAction.paused = false;
        }
    }

    /**
     * Whether the current animation is paused.
     */
    public get isPaused(): boolean {
        return this._currentAction?.paused ?? false;
    }

    // ==================== LIFECYCLE ====================

    protected override onAwake(): void {
        this._mixer = new THREE.AnimationMixer(this.transform._internalObject3D);
        // Build actions for all pre-added clips
        for (const clip of this._clips) {
            this._buildAction(clip);
        }
    }

    protected override onEnable(): void {
        Animation._activeInstances.add(this);
    }

    protected override onDisable(): void {
        Animation._activeInstances.delete(this);
    }

    protected override onDestroy(): void {
        Animation._activeInstances.delete(this);
        if (this._mixer) {
            this._mixer.stopAllAction();
            this._mixer = null;
        }
        this._actions.clear();
        this._clips.length = 0;
        this._currentAction = null;
    }

    // ==================== PRIVATE ====================

    private _getAction(clipName: string): THREE.AnimationAction | null {
        return this._actions.get(clipName) ?? null;
    }

    private _buildAction(clip: AnimationClip): void {
        if (!this._mixer) return;
        const action = this._mixer.clipAction(clip._threeClip);
        this._actions.set(clip.name, action);
    }
}
