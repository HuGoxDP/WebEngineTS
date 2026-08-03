/**
 * A multicast callback list for UI controls.
 *
 * @remarks
 * Equivalent to Unity's `UnityEvent`. Several parts of a scenario routinely
 * care about the same click — a controller advancing its state, an audio cue,
 * an analytics hook — and a single assignable callback silently loses all but
 * the last one to be assigned.
 *
 * ```ts
 * button.onClick.addListener(() => advance());
 * button.onClick.addListener(() => playSound());
 * ```
 *
 * Controls that historically exposed a plain assignable callback keep that
 * working: assigning replaces the *assigned* handler and leaves listeners added
 * through {@link addListener} untouched.
 */
export class UIEvent<T = void> {

    private _listeners: ((arg: T) => void)[] = [];

    /**
     * The handler set by assigning to the owning property, kept apart from
     * {@link addListener} subscribers so the two cannot clobber each other.
     */
    private _assigned: ((arg: T) => void) | null = null;

    /** Whether anything at all would run on {@link invoke}. */
    public get hasListeners(): boolean {
        return this._assigned !== null || this._listeners.length > 0;
    }

    /** Number of subscribers, including an assigned handler. */
    public get listenerCount(): number {
        return this._listeners.length + (this._assigned !== null ? 1 : 0);
    }

    /**
     * Subscribes a callback. Adding the same function twice calls it twice,
     * matching Unity.
     *
     * @param fn - callback to invoke.
     */
    public addListener(fn: (arg: T) => void): void {
        this._listeners.push(fn);
    }

    /**
     * Unsubscribes the first occurrence of a callback added via
     * {@link addListener}. Silently does nothing if it was never added.
     *
     * @param fn - the same function reference that was passed to `addListener`.
     */
    public removeListener(fn: (arg: T) => void): void {
        const idx = this._listeners.indexOf(fn);
        if (idx >= 0) this._listeners.splice(idx, 1);
    }

    /** Removes every subscriber, including an assigned handler. */
    public removeAllListeners(): void {
        this._listeners.length = 0;
        this._assigned = null;
    }

    /**
     * Calls every subscriber in subscription order, the assigned handler first.
     *
     * @remarks
     * A listener that throws must not stop the others or abort the frame's
     * input processing, so failures are reported and swallowed.
     *
     * Listeners are invoked from a snapshot, so a handler may add or remove
     * subscribers — including itself — without disturbing the run in progress.
     *
     * @param arg - payload passed to each subscriber.
     */
    public invoke(arg: T): void {
        if (this._assigned) UIEvent._safeCall(this._assigned, arg);

        const listeners = this._listeners;
        if (listeners.length === 0) return;

        if (listeners.length === 1) {
            UIEvent._safeCall(listeners[0], arg);
            return;
        }

        // Only pay for a copy when there is more than one listener, since that
        // is the only case where re-entrant subscription changes can bite.
        const snapshot = listeners.slice();
        for (let i = 0; i < snapshot.length; i++) UIEvent._safeCall(snapshot[i], arg);
    }

    /** @internal Sets the handler assigned through the owning property. */
    public _setAssigned(fn: ((arg: T) => void) | null): void {
        this._assigned = fn;
    }

    /** @internal The handler assigned through the owning property, if any. */
    public _getAssigned(): ((arg: T) => void) | null {
        return this._assigned;
    }

    private static _safeCall<T>(fn: (arg: T) => void, arg: T): void {
        try {
            fn(arg);
        } catch (error) {
            console.error("[UIEvent] Listener threw:", error);
        }
    }
}
