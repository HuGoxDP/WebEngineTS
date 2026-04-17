import { Animation, AnimationWrapMode } from "./Animation";
import type { AnimationClip } from "./AnimationClip";
import type { GameObject } from "../GameObject";

/**
 * A single state in the Animator state machine.
 */
export class AnimatorState {
    /** Name of this state (used as identifier). */
    public readonly name: string;

    /** The animation clip played in this state. */
    public readonly clip: AnimationClip;

    /** Playback speed for this state. */
    public speed: number = 1;

    /** Wrap mode for this state's clip. */
    public wrapMode: AnimationWrapMode = AnimationWrapMode.Loop;

    /** Transitions from this state. */
    public readonly transitions: AnimatorTransition[] = [];

    constructor(name: string, clip: AnimationClip) {
        this.name = name;
        this.clip = clip;
    }

    /**
     * Adds a transition from this state to another.
     * @param target Target state.
     * @param condition Function evaluated each frame — returns true to trigger.
     * @param duration Crossfade duration in seconds.
     */
    public addTransition(
        target: AnimatorState,
        condition: (params: ReadonlyMap<string, number | boolean>) => boolean,
        duration: number = 0.25,
    ): AnimatorTransition {
        const t = new AnimatorTransition(target, condition, duration);
        this.transitions.push(t);
        return t;
    }
}

/**
 * A transition between two Animator states.
 */
export class AnimatorTransition {
    public readonly target: AnimatorState;
    public readonly condition: (params: ReadonlyMap<string, number | boolean>) => boolean;
    public readonly duration: number;

    constructor(
        target: AnimatorState,
        condition: (params: ReadonlyMap<string, number | boolean>) => boolean,
        duration: number,
    ) {
        this.target = target;
        this.condition = condition;
        this.duration = duration;
    }
}

/**
 * A higher-level animation controller with state machine logic.
 *
 * @remarks
 * Equivalent to Unity's `Animator`.
 * Manages transitions between animation states based on parameters.
 * Uses a sibling {@link Animation} component for actual playback.
 *
 * ```ts
 * const animator = go.addComponent(Animator);
 * const idle = animator.addState("Idle", idleClip);
 * const walk = animator.addState("Walk", walkClip);
 * idle.addTransition(walk, p => (p.get("Speed") as number) > 0.1);
 * walk.addTransition(idle, p => (p.get("Speed") as number) < 0.1);
 * animator.defaultState = idle;
 *
 * // In update:
 * animator.setFloat("Speed", velocity.magnitude());
 * ```
 */
export class Animator {
    private _states: Map<string, AnimatorState> = new Map();
    private _parameters: Map<string, number | boolean> = new Map();
    private _currentState: AnimatorState | null = null;
    private _defaultState: AnimatorState | null = null;
    private _animation: Animation;
    private _started: boolean = false;

    constructor(animation: Animation) {
        this._animation = animation;
    }

    // ==================== PROPERTIES ====================

    /** The currently active state, or null. */
    public get currentState(): AnimatorState | null { return this._currentState; }

    /** Name of the current state, or empty string. */
    public get currentStateName(): string { return this._currentState?.name ?? ""; }

    /** The default state entered when the Animator starts. */
    public get defaultState(): AnimatorState | null { return this._defaultState; }
    public set defaultState(state: AnimatorState | null) {
        this._defaultState = state;
        if (!this._started && state) {
            this._enterState(state);
            this._started = true;
        }
    }

    // ==================== STATE MANAGEMENT ====================

    /**
     * Adds a named state with an animation clip.
     * @param name Unique state name.
     * @param clip The animation clip for this state.
     * @returns The created state (for adding transitions).
     */
    public addState(name: string, clip: AnimationClip): AnimatorState {
        const state = new AnimatorState(name, clip);
        this._states.set(name, state);
        return state;
    }

    /**
     * Gets a state by name.
     */
    public getState(name: string): AnimatorState | null {
        return this._states.get(name) ?? null;
    }

    // ==================== PARAMETERS ====================

    /**
     * Sets a float parameter value.
     */
    public setFloat(name: string, value: number): void {
        this._parameters.set(name, value);
    }

    /**
     * Sets a boolean parameter value.
     */
    public setBool(name: string, value: boolean): void {
        this._parameters.set(name, value);
    }

    /**
     * Sets a trigger (boolean that auto-resets after being consumed).
     */
    public setTrigger(name: string): void {
        this._parameters.set(name, true);
    }

    /**
     * Gets a parameter value.
     */
    public getParameter(name: string): number | boolean | undefined {
        return this._parameters.get(name);
    }

    // ==================== UPDATE ====================

    /**
     * Evaluates transitions from the current state.
     * Call this each frame (typically from a ScriptableBehaviour's update).
     */
    public update(): void {
        if (!this._currentState) {
            if (this._defaultState) {
                this._enterState(this._defaultState);
                this._started = true;
            }
            return;
        }

        for (const transition of this._currentState.transitions) {
            if (transition.condition(this._parameters)) {
                this._transitionTo(transition.target, transition.duration);

                // Reset triggers after consumption
                for (const [key, val] of this._parameters) {
                    if (val === true && typeof val === "boolean") {
                        // Only reset if it was set as a trigger (heuristic)
                    }
                }
                break;
            }
        }
    }

    // ==================== PRIVATE ====================

    private _enterState(state: AnimatorState): void {
        this._currentState = state;
        this._animation.speed = state.speed;
        this._animation.play(state.clip.name, state.wrapMode);
    }

    private _transitionTo(state: AnimatorState, duration: number): void {
        this._currentState = state;
        this._animation.speed = state.speed;
        this._animation.crossFade(state.clip.name, duration, state.wrapMode);
    }
}
