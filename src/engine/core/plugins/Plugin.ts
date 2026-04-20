/**
 * Base class for engine plugins.
 *
 * @remarks
 * Plugins extend the engine with custom subsystems — e.g., a new input
 * backend, a networking layer, an asset pipeline, or developer tools.
 *
 * Register a plugin via {@link PluginManager.register}; it then receives
 * lifecycle callbacks tied to the main engine loop.
 *
 * ```ts
 * class MyInputPlugin extends Plugin {
 *     public readonly name = "MyInputSystem";
 *     protected override onRegister(): void {
 *         // set up DOM listeners, register bindings, etc.
 *     }
 *     protected override onUpdate(dt: number): void {
 *         // poll a device, fire events, etc.
 *     }
 * }
 * PluginManager.register(new MyInputPlugin());
 * ```
 */
export abstract class Plugin {

    /** Unique plugin identifier. Two plugins with the same name cannot coexist. */
    public abstract readonly name: string;

    /** Semantic version string. Informational. */
    public readonly version: string = "1.0.0";

    /**
     * @internal
     * Called by PluginManager when the plugin is registered.
     * Subclasses should override {@link onRegister}.
     */
    public _register(): void { this.onRegister?.(); }

    /** @internal */
    public _unregister(): void { this.onUnregister?.(); }

    /** @internal */
    public _update(dt: number): void { this.onUpdate?.(dt); }

    /** @internal */
    public _fixedUpdate(dt: number): void { this.onFixedUpdate?.(dt); }

    /** @internal */
    public _lateUpdate(dt: number): void { this.onLateUpdate?.(dt); }

    /** Called once when the plugin is registered. Set up listeners here. */
    protected onRegister?(): void;

    /** Called when the plugin is unregistered. Tear down listeners here. */
    protected onUnregister?(): void;

    /** Called every frame before scene Update. */
    protected onUpdate?(dt: number): void;

    /** Called at fixed timestep before Physics step. */
    protected onFixedUpdate?(dt: number): void;

    /** Called every frame after scene LateUpdate, before render. */
    protected onLateUpdate?(dt: number): void;
}
