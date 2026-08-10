import * as THREE from "three";
import { Behaviour } from "../Behaviour";
import { profilerHooks } from "../diagnostics/ProfilerHooks";
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
                anim._advance(dt);
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

    /** Clip name → normalized weight, for the clips currently blended. */
    private _blendWeights: Map<string, number> = new Map();

    /** Cycle length every blended clip is time-scaled to, in seconds. */
    private _blendCycle: number = 0;

    /** The action being faded out while a blend fades in, if any. */
    private _fadeOutAction: THREE.AnimationAction | null = null;

    private _fadeElapsed: number = 0;
    private _fadeDuration: number = 0;

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
        if (this._blendWeights.size > 0) {
            this._applyBlendTimeScales();
        } else if (this._currentAction) {
            this._currentAction.timeScale = value;
        }
    }

    /** Whether several clips are currently playing at once. */
    public get isBlending(): boolean { return this._blendWeights.size > 0; }

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

        this._clearBlend();

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

        this._clearBlend();

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
     * Plays several clips at once, each at its own weight.
     *
     * @remarks
     * What a blend tree needs and `play` cannot express: walk and run playing
     * together at 30/70 is not the same thing as cross-fading between them,
     * because the blend is held rather than passed through.
     *
     * Meant to be called every frame with the current weights — re-weighting an
     * already-blended clip does not restart it. Weights are normalized, so
     * callers need not sum them to 1; a clip that drops to zero leaves the
     * blend and stops.
     *
     * Clips entering an existing blend start at the blend's current phase, and
     * with `synchronize` every clip is time-scaled so one cycle takes the same
     * weighted-average time. Without that a 1s walk and a 0.6s run drift apart
     * within a second.
     *
     * @param weights - clip name → relative weight. Empty stops the blend.
     * @param wrapMode - how the blended clips loop. Defaults to Loop.
     * @param fadeIn - seconds to fade the blend in over, replacing whatever was
     *                 playing. Only applies on the call that starts the blend.
     * @param synchronize - time-scale the clips to a common cycle. Default true.
     */
    public blend(
        weights: ReadonlyMap<string, number>,
        wrapMode: AnimationWrapMode = AnimationWrapMode.Loop,
        fadeIn: number = 0,
        synchronize: boolean = true,
    ): void {
        let total = 0;
        let weightedDuration = 0;
        for (const [name, weight] of weights) {
            const clip = weight > 0 ? this.getClip(name) : null;
            if (!clip || !this._actions.has(name)) continue;
            total += weight;
            weightedDuration += weight * clip.duration;
        }

        if (total <= 0) {
            this._clearBlend();
            return;
        }

        const starting = this._blendWeights.size === 0;
        const phase = starting ? 0 : this._blendPhase();

        if (starting && fadeIn > 0 && this._currentAction) {
            this._fadeOutAction = this._currentAction;
            this._fadeElapsed = 0;
            this._fadeDuration = fadeIn;
        }

        this._blendCycle = synchronize ? weightedDuration / total : 0;

        for (const name of this._blendWeights.keys()) {
            if ((weights.get(name) ?? 0) > 0) continue;
            this._getAction(name)?.stop();
            this._blendWeights.delete(name);
        }

        let dominant: THREE.AnimationAction | null = null;
        let dominantWeight = 0;
        let dominantName = "";

        for (const [name, weight] of weights) {
            if (!(weight > 0)) continue;
            const clip = this.getClip(name);
            const action = this._getAction(name);
            if (!clip || !action) continue;

            if (!this._blendWeights.has(name)) {
                action.reset().play();
                action.time = phase * clip.duration;
            }

            action.loop = wrapMode as unknown as THREE.AnimationActionLoopStyles;
            action.clampWhenFinished = wrapMode === AnimationWrapMode.Once;
            this._blendWeights.set(name, weight / total);

            if (weight > dominantWeight) {
                dominantWeight = weight;
                dominant = action;
                dominantName = name;
            }
        }

        // The action that was playing on its own is either part of the blend now
        // or is being faded out; either way it must not keep its full weight.
        if (this._currentAction
            && this._currentAction !== this._fadeOutAction
            && !this._blendWeights.has(this._currentClipName)) {
            this._currentAction.stop();
        }

        this._applyBlendTimeScales();
        this._applyBlendWeights();

        this._currentAction = dominant;
        this._currentClipName = dominantName;
    }

    /**
     * The weight a clip currently carries in the blend.
     *
     * @param clipName - the clip to ask about.
     * @returns its normalized weight, or 0 when it is not blended.
     */
    public getWeight(clipName: string): number {
        return this._blendWeights.get(clipName) ?? 0;
    }

    /**
     * Stops all animation playback.
     */
    public stop(): void {
        this._clearBlend();
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
        this._setPaused(true);
    }

    /**
     * Resumes a paused animation.
     */
    public resume(): void {
        this._setPaused(false);
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
        this._blendWeights.clear();
        this._fadeOutAction = null;
    }

    // ==================== PRIVATE ====================

    /**
     * Advances this component by one frame.
     *
     * @remarks
     * The fade envelope is applied here rather than in {@link blend} because the
     * blend is re-weighted every frame — Three.js' own `fadeIn` schedules a
     * weight ramp that the next `setEffectiveWeight` would cancel.
     */
    private _advance(dt: number): void {
        if (this._fadeOutAction) {
            this._fadeElapsed += dt;
            const k = this._fadeDuration > 0
                ? Math.min(1, this._fadeElapsed / this._fadeDuration)
                : 1;

            this._applyBlendWeights();
            this._fadeOutAction.setEffectiveWeight(1 - k);

            if (k >= 1) {
                this._fadeOutAction.stop();
                this._fadeOutAction = null;
            }
        }

        this._mixer?.update(dt);
    }

    /** How far through its cycle the blend currently is, in [0, 1). */
    private _blendPhase(): number {
        for (const name of this._blendWeights.keys()) {
            const clip = this.getClip(name);
            const action = this._getAction(name);
            if (!clip || !action || clip.duration <= 0) continue;
            const phase = (action.time / clip.duration) % 1;
            return phase < 0 ? phase + 1 : phase;
        }
        return 0;
    }

    /** Pushes the stored weights onto the actions, scaled by the fade envelope. */
    private _applyBlendWeights(): void {
        const k = this._fadeOutAction && this._fadeDuration > 0
            ? Math.min(1, this._fadeElapsed / this._fadeDuration)
            : 1;

        for (const [name, weight] of this._blendWeights) {
            this._getAction(name)?.setEffectiveWeight(weight * k);
        }
    }

    /** Time-scales blended clips so one cycle takes {@link _blendCycle} seconds. */
    private _applyBlendTimeScales(): void {
        for (const name of this._blendWeights.keys()) {
            const action = this._getAction(name);
            if (!action) continue;
            const duration = this.getClip(name)?.duration ?? 0;
            action.timeScale = this._blendCycle > 0 && duration > 0
                ? this._speed * (duration / this._blendCycle)
                : this._speed;
        }
    }

    private _clearBlend(): void {
        for (const name of this._blendWeights.keys()) {
            const action = this._getAction(name);
            if (!action) continue;
            action.setEffectiveWeight(1);
            action.stop();
        }
        this._blendWeights.clear();
        this._blendCycle = 0;

        if (this._fadeOutAction) {
            this._fadeOutAction.setEffectiveWeight(1);
            this._fadeOutAction.stop();
            this._fadeOutAction = null;
        }
    }

    private _setPaused(paused: boolean): void {
        if (this._blendWeights.size > 0) {
            for (const name of this._blendWeights.keys()) {
                const action = this._getAction(name);
                if (action) action.paused = paused;
            }
            return;
        }
        if (this._currentAction) this._currentAction.paused = paused;
    }

    private _getAction(clipName: string): THREE.AnimationAction | null {
        return this._actions.get(clipName) ?? null;
    }

    private _buildAction(clip: AnimationClip): void {
        if (!this._mixer) return;
        const action = this._mixer.clipAction(clip._threeClip);
        this._actions.set(clip.name, action);
    }
}

profilerHooks.animationPlayingCount = () => (Animation as any)._activeInstances.size;
