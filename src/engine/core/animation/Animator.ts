import { Behaviour } from "../Behaviour";
import { Animation, AnimationWrapMode } from "./Animation";
import { BlendTree } from "./BlendTree";
import type { AnimationClip } from "./AnimationClip";
import type { GameObject } from "../GameObject";

/**
 * What an {@link AnimatorState} plays: one clip, or a blend of several.
 *
 * @remarks Equivalent to Unity's `Motion`.
 */
export type AnimatorMotion = AnimationClip | BlendTree;

/** What a declared Animator parameter holds. */
export enum AnimatorParameterType {
    Float = "Float",
    Int = "Int",
    Bool = "Bool",
    /**
     * A bool that clears itself once it causes a transition.
     *
     * @remarks
     * Declared rather than inferred, which is the difference between a trigger
     * and a bool that happens to be true: without the declaration there is no
     * way to know which one to reset, and a trigger that never resets fires its
     * transition on every frame that follows.
     */
    Trigger = "Trigger",
}

/** How an {@link AnimatorCondition} compares a parameter. */
export enum AnimatorConditionMode {
    /** Bool or trigger is true. */
    If = "If",
    /** Bool is false. */
    IfNot = "IfNot",
    /** Number is greater than the threshold. */
    Greater = "Greater",
    /** Number is less than the threshold. */
    Less = "Less",
    /** Number equals the threshold. */
    Equals = "Equals",
    /** Number does not equal the threshold. */
    NotEqual = "NotEqual",
}

/**
 * One test a transition makes against a parameter.
 *
 * @remarks
 * Equivalent to Unity's `AnimatorCondition`. Declarative on purpose: a
 * predicate function cannot be serialized, drawn as a graph or edited outside
 * code, which is what an animator controller has to be. The predicate form
 * still exists on {@link AnimatorTransition} for conditions no comparison can
 * express.
 */
export interface AnimatorCondition {
    /** Parameter to test. */
    parameter: string;
    /** How to compare it. */
    mode: AnimatorConditionMode;
    /** Value to compare against. Ignored by `If` / `IfNot`. */
    threshold?: number;
}

/** A transition between two Animator states. */
export class AnimatorTransition {

    /** The state this transition leads to. */
    public readonly target: AnimatorState;

    /** Cross-fade duration in seconds. */
    public readonly duration: number;

    /**
     * Conditions that must **all** hold for the transition to fire.
     *
     * @remarks
     * Empty means it fires as soon as it is evaluated, which is how Unity
     * expresses "when this state finishes, move on".
     */
    public readonly conditions: AnimatorCondition[] = [];

    /**
     * An extra predicate, for what conditions cannot express.
     *
     * @remarks
     * Kept for the original API, and genuinely useful for a test that reads
     * something other than a parameter. Not serializable — a controller that
     * uses one cannot be saved as data.
     */
    public readonly predicate: ((params: ReadonlyMap<string, number | boolean>) => boolean) | null;

    constructor(
        target: AnimatorState,
        predicate: ((params: ReadonlyMap<string, number | boolean>) => boolean) | null,
        duration: number,
        conditions: readonly AnimatorCondition[] = [],
    ) {
        this.target = target;
        this.predicate = predicate;
        this.duration = duration;
        this.conditions = [...conditions];
    }

    /** Whether every condition and the predicate currently hold. */
    public isSatisfied(params: ReadonlyMap<string, number | boolean>): boolean {
        for (const condition of this.conditions) {
            if (!AnimatorTransition._test(condition, params.get(condition.parameter))) return false;
        }
        return this.predicate === null || this.predicate(params);
    }

    /** Trigger parameters this transition consumed by firing. */
    public triggersUsed(): string[] {
        return this.conditions
            .filter(c => c.mode === AnimatorConditionMode.If)
            .map(c => c.parameter);
    }

    private static _test(
        condition: AnimatorCondition,
        value: number | boolean | undefined,
    ): boolean {
        if (value === undefined) return false;
        const threshold = condition.threshold ?? 0;

        switch (condition.mode) {
            case AnimatorConditionMode.If:       return value === true;
            case AnimatorConditionMode.IfNot:    return value === false;
            case AnimatorConditionMode.Greater:  return Number(value) > threshold;
            case AnimatorConditionMode.Less:     return Number(value) < threshold;
            case AnimatorConditionMode.Equals:   return Number(value) === threshold;
            case AnimatorConditionMode.NotEqual: return Number(value) !== threshold;
            default:                             return false;
        }
    }
}

/** A single state in the Animator state machine. */
export class AnimatorState {

    /** Name of this state, and its identifier. */
    public readonly name: string;

    /** What this state plays: a clip, or a blend tree. */
    public readonly motion: AnimatorMotion;

    /** Playback speed for this state. */
    public speed: number = 1;

    /** Wrap mode for this state's clips. */
    public wrapMode: AnimationWrapMode = AnimationWrapMode.Loop;

    /** Transitions leaving this state, evaluated in order. */
    public readonly transitions: AnimatorTransition[] = [];

    constructor(name: string, motion: AnimatorMotion) {
        this.name = name;
        this.motion = motion;
    }

    /** The single clip this state plays, or null when it plays a blend tree. */
    public get clip(): AnimationClip | null {
        return this.motion instanceof BlendTree ? null : this.motion;
    }

    /** The blend tree this state plays, or null when it plays a single clip. */
    public get blendTree(): BlendTree | null {
        return this.motion instanceof BlendTree ? this.motion : null;
    }

    /**
     * Adds a transition driven by declarative conditions.
     *
     * @remarks
     * The form to prefer: it can be serialized, inspected and drawn.
     *
     * @param target - the state to move to.
     * @param conditions - all must hold. Empty fires immediately.
     * @param duration - cross-fade seconds. Defaults to 0.25.
     */
    public addTransition(
        target: AnimatorState,
        conditions: readonly AnimatorCondition[] = [],
        duration: number = 0.25,
    ): AnimatorTransition {
        const transition = new AnimatorTransition(target, null, duration, conditions);
        this.transitions.push(transition);
        return transition;
    }

    /**
     * Adds a transition driven by a predicate.
     *
     * @remarks
     * For tests no comparison can express. Such a transition cannot be
     * serialized — see {@link AnimatorTransition.predicate}.
     *
     * @param target - the state to move to.
     * @param predicate - evaluated each frame against the parameters.
     * @param duration - cross-fade seconds. Defaults to 0.25.
     */
    public addTransitionWhen(
        target: AnimatorState,
        predicate: (params: ReadonlyMap<string, number | boolean>) => boolean,
        duration: number = 0.25,
    ): AnimatorTransition {
        const transition = new AnimatorTransition(target, predicate, duration);
        this.transitions.push(transition);
        return transition;
    }
}

/**
 * A state machine over animation clips.
 *
 * @remarks
 * Equivalent to Unity's `Animator`. Plays through a sibling {@link Animation}
 * component, which owns the actual clips and the cross-fade.
 *
 * ```ts
 * const animator = go.addComponent(Animator);
 * const idle = animator.addState("Idle", idleClip);
 * const walk = animator.addState("Walk", walkClip);
 *
 * animator.setParameterType("Speed", AnimatorParameterType.Float);
 * idle.addTransition(walk, [
 *     { parameter: "Speed", mode: AnimatorConditionMode.Greater, threshold: 0.1 },
 * ]);
 * walk.addTransition(idle, [
 *     { parameter: "Speed", mode: AnimatorConditionMode.Less, threshold: 0.1 },
 * ]);
 * animator.defaultState = idle;
 * ```
 *
 * A state plays either a single clip or a {@link BlendTree}, which blends
 * several clips from the same parameters — the difference between switching
 * from walk to run and speeding up.
 *
 * Evaluated once per frame from `Application._loop`, alongside the animation
 * playback it drives — a state machine the caller has to remember to tick is
 * one that silently stops working.
 */
export class Animator extends Behaviour {

    private static _instances: Animator[] = [];

    /** Reused snapshot the per-frame pass walks. */
    private static _pass: Animator[] = [];

    /**
     * @internal
     * Evaluates every active animator. Called from Application._loop before
     * the animation mixers advance, so a transition decided this frame is the
     * one that plays this frame.
     */
    public static _updateAll(): void {
        // Walked through a reused copy: an animator disabled during the pass —
        // by its own transition, or by anything a state change reaches —
        // splices `_instances`, and an index loop would then skip whatever
        // followed it. The UI drivers take the same precaution through
        // `snapshotInto`; this is the same three lines, kept local rather than
        // importing a UI utility into animation.
        const all = Animator._pass;
        all.length = Animator._instances.length;
        for (let i = 0; i < Animator._instances.length; i++) all[i] = Animator._instances[i];

        for (let i = 0; i < all.length; i++) {
            if (all[i].isActiveAndEnabled) all[i].evaluate();
        }
    }

    /** @internal */
    public static _reset(): void {
        Animator._instances.length = 0;
    }

    private readonly _states: Map<string, AnimatorState> = new Map();
    private readonly _parameters: Map<string, number | boolean> = new Map();
    private readonly _parameterTypes: Map<string, AnimatorParameterType> = new Map();

    private _currentState: AnimatorState | null = null;
    private _defaultState: AnimatorState | null = null;
    private _animation: Animation | null = null;

    /** Scratch for blend-tree weights, refilled each frame rather than rebuilt. */
    private readonly _blendWeights: Map<string, number> = new Map();

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ── properties ───────────────────────────────────────────────────

    /** The currently active state, or null before the machine starts. */
    public get currentState(): AnimatorState | null { return this._currentState; }

    /** Name of the current state, or an empty string. */
    public get currentStateName(): string { return this._currentState?.name ?? ""; }

    /** The state entered when the machine starts. */
    public get defaultState(): AnimatorState | null { return this._defaultState; }

    public set defaultState(state: AnimatorState | null) {
        this._defaultState = state;
        if (this._currentState === null && state !== null && this.isActiveAndEnabled) {
            this._enterState(state);
        }
    }

    // ── states ───────────────────────────────────────────────────────

    /**
     * Adds a named state.
     *
     * @remarks
     * Every clip the motion can play is registered with the sibling
     * {@link Animation}, so a caller does not have to add them in two places.
     *
     * @param name - unique state name.
     * @param motion - the clip or {@link BlendTree} this state plays.
     */
    public addState(name: string, motion: AnimatorMotion): AnimatorState {
        const state = new AnimatorState(name, motion);
        this._states.set(name, state);

        const animation = this._resolveAnimation();
        if (animation) {
            if (motion instanceof BlendTree) {
                for (const clip of motion.clips) animation.addClip(clip);
            } else {
                animation.addClip(motion);
            }
        }
        return state;
    }

    /** A state by name, or null. */
    public getState(name: string): AnimatorState | null {
        return this._states.get(name) ?? null;
    }

    /**
     * Moves to a state immediately, ignoring transitions.
     *
     * @remarks Equivalent to Unity's `Animator.Play`.
     *
     * @param name - state to enter.
     * @param duration - cross-fade seconds. `0` cuts.
     */
    public play(name: string, duration: number = 0): void {
        const state = this._states.get(name);
        if (!state) return;
        if (duration > 0) this._transitionTo(state, duration);
        else this._enterState(state);
    }

    // ── parameters ───────────────────────────────────────────────────

    /**
     * Declares what a parameter holds.
     *
     * @remarks
     * Only {@link AnimatorParameterType.Trigger} changes behaviour — it is what
     * lets the animator know which parameters to clear after a transition.
     * Declaring the others documents the controller and costs nothing.
     *
     * @param name - parameter name.
     * @param type - what it holds.
     */
    public setParameterType(name: string, type: AnimatorParameterType): void {
        this._parameterTypes.set(name, type);
        if (!this._parameters.has(name)) {
            this._parameters.set(name, type === AnimatorParameterType.Bool
                || type === AnimatorParameterType.Trigger ? false : 0);
        }
    }

    /** Sets a numeric parameter. */
    public setFloat(name: string, value: number): void {
        this._parameters.set(name, value);
    }

    /** Sets an integer parameter, truncating. */
    public setInt(name: string, value: number): void {
        this._parameters.set(name, Math.trunc(value));
    }

    /** Sets a boolean parameter. */
    public setBool(name: string, value: boolean): void {
        this._parameters.set(name, value);
    }

    /**
     * Raises a trigger.
     *
     * @remarks
     * Declares the parameter as a trigger if it was not declared already, so
     * the common case needs no separate declaration — and so the trigger
     * actually resets, which the previous implementation never did.
     */
    public setTrigger(name: string): void {
        if (!this._parameterTypes.has(name)) {
            this._parameterTypes.set(name, AnimatorParameterType.Trigger);
        }
        this._parameters.set(name, true);
    }

    /** Clears a trigger before it has been consumed. */
    public resetTrigger(name: string): void {
        this._parameters.set(name, false);
    }

    /** A parameter's value, or undefined if it was never set. */
    public getParameter(name: string): number | boolean | undefined {
        return this._parameters.get(name);
    }

    // ── evaluation ───────────────────────────────────────────────────

    /**
     * Evaluates the transitions leaving the current state.
     *
     * @remarks
     * Runs automatically once per frame; public because a test — or a scenario
     * stepping its own simulation — may want to drive it directly.
     */
    public evaluate(): void {
        if (this._currentState === null) {
            if (this._defaultState !== null) this._enterState(this._defaultState);
            return;
        }

        for (const transition of this._currentState.transitions) {
            if (!transition.isSatisfied(this._parameters)) continue;

            // Consumed *before* entering, so a state that transitions straight
            // out again cannot see the same trigger a second time.
            for (const name of transition.triggersUsed()) {
                if (this._parameterTypes.get(name) === AnimatorParameterType.Trigger) {
                    this._parameters.set(name, false);
                }
            }

            this._transitionTo(transition.target, transition.duration);
            return;
        }

        // A blend tree is a state whose weights keep moving while it is held,
        // so it is re-sampled on every frame no transition fires.
        this._sampleBlendTree(this._currentState, 0);
    }

    protected override onEnable(): void {
        if (!Animator._instances.includes(this)) Animator._instances.push(this);
        if (this._currentState === null && this._defaultState !== null) {
            this._enterState(this._defaultState);
        }
    }

    protected override onDisable(): void {
        const index = Animator._instances.indexOf(this);
        if (index >= 0) Animator._instances.splice(index, 1);
    }

    protected override onDestroy(): void {
        this.onDisable();
    }

    // ── private ──────────────────────────────────────────────────────

    /**
     * The sibling Animation, added if it is missing.
     *
     * @remarks
     * An Animator without one can do nothing, and requiring the caller to add
     * both in the right order is a trap rather than a design.
     */
    private _resolveAnimation(): Animation | null {
        if (this._animation !== null && this._animation.exists()) return this._animation;

        this._animation = this.gameObject.getComponent(Animation)
            ?? this.gameObject.addComponent(Animation);
        return this._animation;
    }

    private _enterState(state: AnimatorState): void {
        this._currentState = state;
        const animation = this._resolveAnimation();
        if (!animation) return;

        animation.speed = state.speed;
        if (state.blendTree) {
            this._sampleBlendTree(state, 0);
            return;
        }
        animation.play(state.motion.name, state.wrapMode);
    }

    private _transitionTo(state: AnimatorState, duration: number): void {
        this._currentState = state;
        const animation = this._resolveAnimation();
        if (!animation) return;

        animation.speed = state.speed;
        if (state.blendTree) {
            this._sampleBlendTree(state, duration);
            return;
        }
        animation.crossFade(state.motion.name, duration, state.wrapMode);
    }

    /**
     * Re-weights a blend-tree state from the current parameters.
     *
     * @param fadeIn - seconds to fade the blend in over. Only has an effect on
     *                 the frame the blend starts.
     */
    private _sampleBlendTree(state: AnimatorState, fadeIn: number): void {
        const tree = state.blendTree;
        if (!tree) return;

        const animation = this._resolveAnimation();
        if (!animation) return;

        tree.evaluate(this._parameters, this._blendWeights);
        animation.blend(this._blendWeights, state.wrapMode, fadeIn, tree.synchronizeTime);
    }
}
