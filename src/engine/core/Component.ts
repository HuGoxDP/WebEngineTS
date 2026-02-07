// path: src/engine/core/Component.ts

import { EngineObject } from "./EngineObject.ts";
import type { GameObject } from "./GameObject.ts";
import type { Transform } from "./Transform.ts";


/**
 * Base class for everything attached to GameObjects.
 *
 * Provides a link to its owning {@link GameObject} and convenience methods
 * that delegate to the GameObject's component-management API.
 *
 * Hierarchy: {@link EngineObject} → Component → {@link Behaviour} → {@link ScriptableBehaviour}
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Component`.
 * A Component cannot be moved to another GameObject after creation.
 */
export abstract class Component extends EngineObject {

    // ==================== FIELDS ====================

    /**
     * The {@link GameObject} this component is attached to.
     * A component is always attached to a game object.
     *
     * @remarks
     * Readonly — a component cannot be re-parented to a different GameObject.
     */
    public readonly gameObject: GameObject;

    // ==================== CONSTRUCTOR ====================

    /**
     * Creates a new Component attached to the given GameObject.
     *
     * @param gameObject - The owning GameObject.
     *
     * @remarks
     * Subclass constructors should forward the `gameObject` parameter
     * and call `super(gameObject)`.
     */
    constructor(gameObject: GameObject) {
        super();
        this.gameObject = gameObject;
    }

    // ==================== CONVENIENCE PROPERTIES ====================

    /**
     * The {@link Transform} attached to this GameObject.
     *
     * @remarks
     * Every GameObject always has a Transform, so this never returns null.
     * Equivalent to Unity's `Component.transform`.
     */
    public get transform(): Transform {
        return this.gameObject.transform;
    }

    /**
     * The tag of this game object.
     *
     * @remarks
     * Shorthand for `this.gameObject.tag`.
     */
    public get tag(): string {
        return this.gameObject.tag;
    }

    public set tag(value: string) {
        this.gameObject.tag = value;
    }

    // ==================== COMPONENT ACCESS (DELEGATES) ====================

    /**
     * Returns the component of the given type attached to the same GameObject,
     * or `null` if none exists.
     *
     * @typeParam T - Component subclass to search for.
     * @param type - The class / constructor of the component.
     *
     * @example
     * ```ts
     * const renderer = this.getComponent(MeshRenderer);
     * ```
     */
    public getComponent<T extends Component>(type: new (...args: never[]) => T): T | null {
        return this.gameObject.getComponent(type);
    }

    /**
     * Returns all components of the given type attached to the same GameObject.
     *
     * @typeParam T - Component subclass to search for.
     * @param type - The class / constructor of the component.
     */
    public getComponents<T extends Component>(type: new (...args: never[]) => T): T[] {
        return this.gameObject.getComponents(type);
    }

    /**
     * Returns the first component of the given type found in the GameObject
     * or any of its children (depth-first search).
     *
     * @typeParam T - Component subclass to search for.
     * @param type - The class / constructor of the component.
     * @param includeInactive - If `true`, also searches inactive GameObjects. Default `false`.
     */
    public getComponentInChildren<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false
    ): T | null {
        return this.gameObject.getComponentInChildren(type, includeInactive);
    }

    /**
     * Returns all components of the given type found in the GameObject
     * and its children (depth-first search).
     *
     * @typeParam T - Component subclass to search for.
     * @param type - The class / constructor of the component.
     * @param includeInactive - If `true`, also searches inactive GameObjects. Default `false`.
     */
    public getComponentsInChildren<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false
    ): T[] {
        return this.gameObject.getComponentsInChildren(type, includeInactive);
    }

    /**
     * Returns the first component of the given type found in any parent GameObject.
     *
     * @typeParam T - Component subclass to search for.
     * @param type - The class / constructor of the component.
     * @param includeInactive - If `true`, also searches inactive GameObjects. Default `false`.
     */
    public getComponentInParent<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false
    ): T | null {
        return this.gameObject.getComponentInParent(type, includeInactive);
    }

    /**
     * Returns all components of the given type found in any parent GameObject.
     *
     * @typeParam T - Component subclass to search for.
     * @param type - The class / constructor of the component.
     * @param includeInactive - If `true`, also searches inactive GameObjects. Default `false`.
     */
    public getComponentsInParent<T extends Component>(
        type: new (...args: never[]) => T,
        includeInactive: boolean = false
    ): T[] {
        return this.gameObject.getComponentsInParent(type, includeInactive);
    }

    /**
     * Adds a component of the given type to the GameObject.
     *
     * @typeParam T - Component subclass to add.
     * @param type - The class / constructor of the component.
     * @returns The newly added component instance.
     *
     * @remarks
     * Convenience delegate for `this.gameObject.addComponent(type)`.
     */
    public addComponent<T extends Component>(type: new (gameObject: GameObject) => T): T {
        return this.gameObject.addComponent(type);
    }

    // ==================== TAG COMPARISON ====================

    /**
     * Checks whether the GameObject has the given tag.
     *
     * @param tag - Tag string to compare against.
     *
     * @remarks
     * Equivalent to Unity's `Component.CompareTag`.
     */
    public compareTag(tag: string): boolean {
        return this.gameObject.compareTag(tag);
    }

    // ==================== MESSAGING ====================

    /**
     * Calls the named method on every {@link ScriptableBehaviour} attached to this GameObject.
     *
     * @param methodName - Name of the method to invoke.
     * @param value - Optional argument to pass to the method.
     *
     * @remarks
     * Equivalent to Unity's `Component.SendMessage`.
     * Only invokes the method on components that define it.
     */
    public sendMessage(methodName: string, value?: unknown): void {
        this.gameObject.sendMessage(methodName, value);
    }

    /**
     * Calls the named method on every {@link ScriptableBehaviour} in this
     * GameObject **and all of its children** (recursive).
     *
     * @param methodName - Name of the method to invoke.
     * @param value - Optional argument to pass to the method.
     *
     * @remarks
     * Equivalent to Unity's `Component.BroadcastMessage`.
     */
    public broadcastMessage(methodName: string, value?: unknown): void {
        this.gameObject.broadcastMessage(methodName, value);
    }

    /**
     * Calls the named method on every {@link ScriptableBehaviour} in this
     * GameObject **and all of its parents** (upwards).
     *
     * @param methodName - Name of the method to invoke.
     * @param value - Optional argument to pass to the method.
     *
     * @remarks
     * Equivalent to Unity's `Component.SendMessageUpwards`.
     */
    public sendMessageUpwards(methodName: string, value?: unknown): void {
        this.gameObject.sendMessageUpwards(methodName, value);
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * Called by the engine when this component is being destroyed.
     * Override in subclasses for custom cleanup logic.
     *
     * @remarks
     * Always call `super.onDestroy()` when overriding.
     */
    protected override onDestroy(): void {
        // Subclasses perform cleanup here
    }

    // ==================== CLONING ====================

    /**
     * @internal
     * Creates a shallow clone of this component.
     *
     * @remarks
     * The base implementation throws because a Component cannot be cloned
     * in isolation — it must be cloned as part of a GameObject clone.
     * {@link GameObject._clone} handles component duplication.
     *
     * Subclasses that support standalone cloning should override this method.
     */
    protected override _clone(): EngineObject {
        throw new Error(
            `Component._clone(): Cannot clone component '${this.name}' in isolation. ` +
            `Components are cloned as part of GameObject.Instantiate().`
        );
    }
}