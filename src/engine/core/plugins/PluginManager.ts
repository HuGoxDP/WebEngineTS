import { Plugin } from "./Plugin";

/**
 * Static registry and dispatcher for engine plugins.
 *
 * @remarks
 * Plugins register with this manager and receive lifecycle callbacks
 * from the main engine loop. Use this to extend the engine without
 * forking — custom input systems, networking, analytics, etc.
 *
 * ```ts
 * PluginManager.register(new NewInputSystem());
 * PluginManager.register(new NetworkingPlugin());
 * const net = PluginManager.get<NetworkingPlugin>("Networking");
 * ```
 */
export class PluginManager {

    private static _plugins: Map<string, Plugin> = new Map();
    private static _ordered: Plugin[] = [];

    /** All registered plugins in registration order. */
    public static get plugins(): readonly Plugin[] {
        return PluginManager._ordered;
    }

    /** Number of registered plugins. */
    public static get count(): number {
        return PluginManager._ordered.length;
    }

    /**
     * Registers a plugin. Fires the plugin's `onRegister` immediately.
     * @throws If a plugin with the same name is already registered.
     */
    public static register(plugin: Plugin): void {
        if (PluginManager._plugins.has(plugin.name)) {
            throw new Error(`[PluginManager] Plugin "${plugin.name}" is already registered`);
        }
        PluginManager._plugins.set(plugin.name, plugin);
        PluginManager._ordered.push(plugin);
        try {
            plugin._register();
        } catch (err) {
            console.error(`[PluginManager] Error in ${plugin.name}.onRegister:`, err);
        }
    }

    /**
     * Unregisters the plugin and fires its `onUnregister`.
     * No-op if no plugin by that name exists.
     */
    public static unregister(name: string): void {
        const plugin = PluginManager._plugins.get(name);
        if (!plugin) return;
        try {
            plugin._unregister();
        } catch (err) {
            console.error(`[PluginManager] Error in ${plugin.name}.onUnregister:`, err);
        }
        PluginManager._plugins.delete(name);
        const idx = PluginManager._ordered.indexOf(plugin);
        if (idx >= 0) PluginManager._ordered.splice(idx, 1);
    }

    /** Looks up a plugin by name. */
    public static get<T extends Plugin>(name: string): T | null {
        return (PluginManager._plugins.get(name) as T) ?? null;
    }

    /** Whether a plugin with this name is registered. */
    public static has(name: string): boolean {
        return PluginManager._plugins.has(name);
    }

    /** @internal Unregisters every plugin (used on engine teardown). */
    public static _reset(): void {
        for (const p of [...PluginManager._ordered]) {
            PluginManager.unregister(p.name);
        }
    }

    /**
     * Snapshot the dispatch loops iterate.
     *
     * @remarks
     * A plugin may unregister itself — or another — from inside its own update,
     * which is how a one-shot plugin ends. Splicing `_ordered` while a `for…of`
     * walks it makes the loop skip whatever followed the plugin that left. The
     * buffer is reused rather than allocated, since this runs three times a
     * frame; `UIEvent.invoke` takes the same precaution for the same reason.
     */
    private static _dispatching: Plugin[] = [];

    /** Copies the plugin list into the reusable dispatch buffer. */
    private static _snapshot(): readonly Plugin[] {
        const buffer = PluginManager._dispatching;
        buffer.length = PluginManager._ordered.length;
        for (let i = 0; i < PluginManager._ordered.length; i++) {
            buffer[i] = PluginManager._ordered[i];
        }
        return buffer;
    }

    /** @internal Dispatches `onUpdate` to all plugins. */
    public static _onUpdate(dt: number): void {
        const plugins = PluginManager._snapshot();
        for (let i = 0; i < plugins.length; i++) {
            const p = plugins[i];
            try { p._update(dt); }
            catch (err) { console.error(`[PluginManager] ${p.name}.onUpdate:`, err); }
        }
    }

    /** @internal Dispatches `onFixedUpdate` to all plugins. */
    public static _onFixedUpdate(dt: number): void {
        const plugins = PluginManager._snapshot();
        for (let i = 0; i < plugins.length; i++) {
            const p = plugins[i];
            try { p._fixedUpdate(dt); }
            catch (err) { console.error(`[PluginManager] ${p.name}.onFixedUpdate:`, err); }
        }
    }

    /** @internal Dispatches `onLateUpdate` to all plugins. */
    public static _onLateUpdate(dt: number): void {
        const plugins = PluginManager._snapshot();
        for (let i = 0; i < plugins.length; i++) {
            const p = plugins[i];
            try { p._lateUpdate(dt); }
            catch (err) { console.error(`[PluginManager] ${p.name}.onLateUpdate:`, err); }
        }
    }

    private constructor() {}
}
