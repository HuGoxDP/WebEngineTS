import { Behaviour } from "../Behaviour";
import { profilerHooks } from "../diagnostics/ProfilerHooks";
import { AudioClip } from "./AudioClip";
import { AudioManager } from "./AudioManager";
import type { GameObject } from "../GameObject";

/**
 * Controls how the volume attenuates with distance in 3D space.
 */
export enum AudioRolloffMode {
    /** Volume falls off logarithmically (realistic, Unity default). */
    Logarithmic = "Logarithmic",
    /** Volume falls off linearly between minDistance and maxDistance. */
    Linear = "Linear",
}

/**
 * Plays audio clips at a position in the scene.
 *
 * @remarks
 * Equivalent to Unity's `AudioSource`. Wraps Web Audio API nodes internally.
 *
 * For 2D (non-spatial) audio set `spatialBlend = 0` (default).
 * For full 3D audio set `spatialBlend = 1` — the source position is synced
 * from the GameObject's Transform each frame.
 *
 * ```ts
 * const src = go.addComponent(AudioSource);
 * src.clip = await Resources.load<AudioClip>("explosion.mp3");
 * src.spatialBlend = 1;
 * src.play();
 * ```
 */
export class AudioSource extends Behaviour {

    private static _activeInstances: Set<AudioSource> = new Set();

    /**
     * @internal
     * Updates spatial position for all active sources.
     * Called once per frame from Application._loop, after LateUpdate.
     */
    public static _updateAll(): void {
        for (const src of AudioSource._activeInstances) {
            if (src.isActiveAndEnabled && src._spatialBlend > 0) {
                src._updateSpatial();
            }
        }
    }

    /** @internal */
    public static _reset(): void {
        AudioSource._activeInstances.clear();
    }

    // ── fields ──────────────────────────────────────────────────────

    private _clip: AudioClip | null = null;
    private _volume: number = 1;
    private _pitch: number = 1;
    private _loop: boolean = false;
    private _playOnAwake: boolean = false;
    private _spatialBlend: number = 0;
    private _minDistance: number = 1;
    private _maxDistance: number = 500;
    private _rolloffMode: AudioRolloffMode = AudioRolloffMode.Logarithmic;
    private _mute: boolean = false;

    private _gainNode: GainNode | null = null;
    private _pannerNode: PannerNode | null = null;
    private _sourceNode: AudioBufferSourceNode | null = null;

    private _isPlaying: boolean = false;
    private _isPaused: boolean = false;
    private _pauseTime: number = 0;
    private _startContextTime: number = 0;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ── lifecycle ────────────────────────────────────────────────────

    protected override onAwake(): void {
        const ctx = AudioManager.context;

        this._gainNode = ctx.createGain();
        this._gainNode.gain.value = this._volume;

        this._pannerNode = ctx.createPanner();
        this._pannerNode.panningModel = "HRTF";
        this._pannerNode.distanceModel =
            this._rolloffMode === AudioRolloffMode.Linear ? "linear" : "inverse";
        this._pannerNode.refDistance = this._minDistance;
        this._pannerNode.maxDistance = this._maxDistance;
        this._pannerNode.rolloffFactor = 1;
        this._pannerNode.connect(this._gainNode);

        this._gainNode.connect(AudioManager._masterGainNode);

        if (this._playOnAwake && this._clip) {
            this.play();
        }
    }

    protected override onEnable(): void {
        AudioSource._activeInstances.add(this);
    }

    protected override onDisable(): void {
        AudioSource._activeInstances.delete(this);

        // Unity stops a source when it is disabled, and so must this: a
        // disabled source has already been dropped from the spatial update, so
        // leaving it playing gives a sound that carries on from wherever its
        // object was when it was switched off. Hiding a thing has to silence
        // it, which is what a scenario means by hiding it.
        this.stop();
    }

    protected override onDestroy(): void {
        AudioSource._activeInstances.delete(this);
        this._stopSource();
        this._pannerNode?.disconnect();
        this._gainNode?.disconnect();
        this._pannerNode = null;
        this._gainNode = null;
    }

    // ── properties ───────────────────────────────────────────────────

    /** The clip to play. Can be changed while stopped. */
    public get clip(): AudioClip | null { return this._clip; }
    public set clip(value: AudioClip | null) { this._clip = value; }

    /** Playback volume (0–1). */
    public get volume(): number { return this._volume; }
    public set volume(value: number) {
        this._volume = Math.max(0, value);
        if (this._gainNode && !this._mute) {
            this._gainNode.gain.value = this._volume;
        }
    }

    /** Playback pitch/speed multiplier (1 = normal, 0.5 = half speed). */
    public get pitch(): number { return this._pitch; }
    public set pitch(value: number) {
        this._pitch = value;
        if (this._sourceNode) {
            this._sourceNode.playbackRate.value = value;
        }
    }

    /** Whether the clip loops automatically. */
    public get loop(): boolean { return this._loop; }
    public set loop(value: boolean) {
        this._loop = value;
        if (this._sourceNode) this._sourceNode.loop = value;
    }

    /** If true, plays the clip automatically when the component wakes up. */
    public get playOnAwake(): boolean { return this._playOnAwake; }
    public set playOnAwake(value: boolean) { this._playOnAwake = value; }

    /** Blend between 2D (0) and 3D spatial (1) audio. */
    public get spatialBlend(): number { return this._spatialBlend; }
    public set spatialBlend(value: number) {
        this._spatialBlend = Math.max(0, Math.min(1, value));
    }

    /** Distance at which 3D audio starts attenuating. */
    public get minDistance(): number { return this._minDistance; }
    public set minDistance(value: number) {
        this._minDistance = value;
        if (this._pannerNode) this._pannerNode.refDistance = value;
    }

    /** Distance beyond which 3D audio is silent. */
    public get maxDistance(): number { return this._maxDistance; }
    public set maxDistance(value: number) {
        this._maxDistance = value;
        if (this._pannerNode) this._pannerNode.maxDistance = value;
    }

    /** How 3D audio volume attenuates with distance. */
    public get rolloffMode(): AudioRolloffMode { return this._rolloffMode; }
    public set rolloffMode(value: AudioRolloffMode) {
        this._rolloffMode = value;
        if (this._pannerNode) {
            this._pannerNode.distanceModel =
                value === AudioRolloffMode.Linear ? "linear" : "inverse";
        }
    }

    /** Silences this source without stopping playback. */
    public get mute(): boolean { return this._mute; }
    public set mute(value: boolean) {
        this._mute = value;
        if (this._gainNode) {
            this._gainNode.gain.value = value ? 0 : this._volume;
        }
    }

    /** Whether audio is currently playing (not paused and not finished). */
    public get isPlaying(): boolean { return this._isPlaying; }

    /** Whether audio is currently paused. */
    public get isPaused(): boolean { return this._isPaused; }

    /**
     * Current playback position in seconds.
     * Returns 0 when stopped.
     */
    public get time(): number {
        if (this._isPaused) return this._pauseTime;
        if (!this._isPlaying) return 0;
        const elapsed = AudioManager.context.currentTime - this._startContextTime;
        const duration = this._clip?.duration ?? 0;
        return this._loop && duration > 0 ? elapsed % duration : Math.min(elapsed, duration);
    }

    // ── methods ──────────────────────────────────────────────────────

    /**
     * Starts playback of the assigned clip.
     * If already playing, restarts from the beginning (or from pause position).
     * @param delay Optional delay in seconds before playback starts.
     */
    public play(delay: number = 0): void {
        if (!this._clip || !this._gainNode || !this._pannerNode) return;

        this._stopSource();

        const ctx = AudioManager.context;
        const src = ctx.createBufferSource();
        src.buffer = this._clip._buffer;
        src.playbackRate.value = this._pitch;
        src.loop = this._loop;

        const destination = this._spatialBlend > 0 ? this._pannerNode : this._gainNode;
        src.connect(destination);

        src.onended = () => {
            if (this._sourceNode === src) {
                this._isPlaying = false;
                this._sourceNode = null;
            }
        };

        const offset = this._isPaused ? this._pauseTime : 0;
        src.start(ctx.currentTime + delay, offset);

        this._sourceNode = src;
        this._startContextTime = ctx.currentTime - offset + delay;
        this._isPlaying = true;
        this._isPaused = false;
    }

    /** Stops playback and resets position to the beginning. */
    public stop(): void {
        this._stopSource();
        this._isPlaying = false;
        this._isPaused = false;
        this._pauseTime = 0;
    }

    /** Pauses playback, preserving the current position. */
    public pause(): void {
        if (!this._isPlaying) return;
        this._pauseTime = this.time;
        this._stopSource();
        this._isPlaying = false;
        this._isPaused = true;
    }

    /** Resumes a paused clip from where it was paused. */
    public unPause(): void {
        if (this._isPaused) this.play();
    }

    /**
     * Plays a clip once without interrupting the main clip.
     * Useful for one-shot sound effects (footsteps, impacts).
     * @param clip The clip to play once.
     * @param volumeScale Volume multiplier for this shot (0–1).
     */
    public playOneShot(clip: AudioClip, volumeScale: number = 1): void {
        if (!this._gainNode) return;
        const ctx = AudioManager.context;
        const src = ctx.createBufferSource();
        src.buffer = clip._buffer;
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0, volumeScale);
        src.connect(gain);
        gain.connect(this._gainNode);
        src.start();
        src.onended = () => { gain.disconnect(); };
    }

    // ── private ──────────────────────────────────────────────────────

    private _stopSource(): void {
        if (this._sourceNode) {
            try { this._sourceNode.stop(0); } catch { /* already stopped */ }
            this._sourceNode.disconnect();
            this._sourceNode = null;
        }
    }

    private _updateSpatial(): void {
        if (!this._pannerNode) return;
        const pos = this.transform.position;
        this._pannerNode.positionX.value = pos.x;
        this._pannerNode.positionY.value = pos.y;
        this._pannerNode.positionZ.value = pos.z;
    }
}

profilerHooks.audioSourceCount = () => (AudioSource as any)._activeInstances.size;
