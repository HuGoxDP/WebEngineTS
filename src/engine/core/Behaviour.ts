// path: src/engine/core/Behaviour.ts

import { Component } from "./Component.ts";
import type { GameObject } from "./GameObject.ts";

/**
 * A {@link Component} that can be enabled or disabled.
 *
 * Most built-in components (except {@link Transform}) and all user scripts
 * inherit from Behaviour. The engine only processes a Behaviour when
 * {@link isActiveAndEnabled} is `true`.
 *
 * Hierarchy: {@link EngineObject} → {@link Component} → Behaviour → {@link ScriptableBehaviour}
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Behaviour`.
 *
 * Lifecycle callbacks:
 * - {@link onEnable} — called on the transition from inactive → active.
 * - {@link onDisable} — called on the transition from active → inactive.
 *
 * These callbacks fire exactly once per transition — never when the
 * effective state remains unchanged (unlike a naive "notify always" approach).
 */
export abstract class Behaviour extends Component {

    // ==================== FIELDS ====================

    /**
     * Whether this component is locally enabled.
     * @internal
     */
    private _enabled: boolean = true;

    /**
     * Tracks the previous effective state to ensure
     * {@link onEnable}/{@link onDisable} fire only on actual transitions.
     *
     * Starts `false` so the first activation triggers {@link onEnable}.
     * @internal
     */
    private _wasActiveAndEnabled: boolean = false;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * Enables or disables this component.
     *
     * When disabled, the engine will not call lifecycle methods
     * (Update, FixedUpdate, etc.) on this component.
     *
     * @remarks
     * Setting `enabled` triggers {@link onEnable} or {@link onDisable}
     * if the effective state actually changes.
     */
    public get enabled(): boolean {
        return this._enabled;
    }

    public set enabled(value: boolean) {
        if (this._enabled === value) return;

        this._enabled = value;
        this._onEnabledChanged();
    }

    /**
     * Is this component enabled **and** is its GameObject active in the scene?
     *
     * The engine's update loops only process components where this is `true`.
     *
     * @remarks
     * Equivalent to Unity's `Behaviour.isActiveAndEnabled`.
     * Takes the full parent hierarchy into account via
     * {@link GameObject.activeInHierarchy}.
     */
    public get isActiveAndEnabled(): boolean {
        return this._enabled && this.gameObject.activeInHierarchy;
    }

    // ==================== INTERNAL METHODS ====================

    /**
     * @internal
     * Called by {@link GameObject.addComponent} for built-in engine components
     * (subclasses of Behaviour that are **not** {@link ScriptableBehaviour}).
     *
     * This is the initialization entry point for components like Camera, Light,
     * MeshRenderer, etc. It calls the protected {@link onAwake} hook.
     *
     * User scripts (ScriptableBehaviour) use `_systemAwake()` instead,
     * which calls the public `awake()` hook.
     *
     * @remarks
     * Matches Unity's internal behaviour where built-in components run
     * their initialization logic as soon as they are added to a GameObject.
     */
    public _internalInitialize(): void {
        this.onAwake();
    }

    /**
     * @internal
     * Called by the engine when any factor affecting the effective active state
     * changes (component enabled, GameObject active, parent active).
     *
     * Compares the current effective state against the previously recorded state
     * and fires {@link onEnable} or {@link onDisable} **only on transitions**.
     *
     * Safe to call repeatedly — no-ops if the state hasn't changed.
     *
     * @remarks
     * Called from `GameObject.setActive()`, `GameObject._onParentActiveStateChanged()`,
     * and `GameObject.addComponent()`.
     */
    public _onEnabledChanged(): void {
        const currentState = this.isActiveAndEnabled;

        if (currentState === this._wasActiveAndEnabled) {
            return; // No transition — skip
        }

        this._wasActiveAndEnabled = currentState;

        if (currentState) {
            this.onEnable();
        } else {
            this.onDisable();
        }
    }

    /**
     * @internal
     * Overrides {@link EngineObject._destroyImmediate} to ensure
     * {@link onDisable} fires before the `onDestroy()` chain runs.
     *
     * This matches Unity's destruction sequence:
     * 1. `OnDisable()` — if the component was active
     * 2. `OnDestroy()` — cleanup hook
     *
     * By handling this in `_destroyImmediate` rather than `onDestroy`,
     * subclasses (including user scripts) can safely override `onDestroy`
     * without calling `super.onDestroy()` and still get correct
     * `onDisable` behavior.
     */
    public override _destroyImmediate(): void {
        // Fire onDisable before destruction if the component was active
        if (this._wasActiveAndEnabled) {
            this._wasActiveAndEnabled = false;
            this.onDisable();
        }

        // Continue normal destruction chain (calls onDestroy → marks destroyed → unregisters)
        super._destroyImmediate();
    }

    // ==================== LIFECYCLE HOOKS ====================

    /**
     * Called once when the component is first initialized.
     *
     * Override this in built-in engine components (Camera, Light, MeshRenderer, etc.)
     * to create and configure internal Three.js objects.
     *
     * @remarks
     * Equivalent to Unity's internal component initialization.
     *
     * For **user scripts**, use {@link ScriptableBehaviour.awake} instead.
     * This method is specifically for engine-internal components that need
     * to set up Three.js objects before the component becomes active.
     *
     * Called from {@link _internalInitialize}, which is invoked by
     * {@link GameObject.addComponent} for non-ScriptableBehaviour Behaviours.
     * @virtual
     */
    protected onAwake(): void {
        // Override in built-in engine components
    }

    /**
     * Called when this component transitions from inactive to active.
     *
     * Override this to initialize per-activation state, subscribe to events, etc.
     *
     * @remarks
     * Equivalent to Unity's `OnEnable`.
     * Fires once per activation — never called if already active.
     * @virtual
     */
    protected onEnable(): void {
        // Override in subclasses
    }

    /**
     * Called when this component transitions from active to inactive.
     *
     * Override this to tear down per-activation state, unsubscribe from events, etc.
     *
     * @remarks
     * Equivalent to Unity's `OnDisable`.
     * Fires once per deactivation — never called if already inactive.
     * Also fires before {@link onDestroy} if the component was active
     * (handled automatically by {@link _destroyImmediate}).
     * @virtual
     */
    protected onDisable(): void {
        // Override in subclasses
    }
}