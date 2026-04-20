import { Vector2 } from "../math/Vector2";

/**
 * Lifecycle phase of a tracked touch.
 *
 * @remarks Equivalent to Unity's `UnityEngine.TouchPhase`.
 */
export enum TouchPhase {
    /** First frame a finger touched the surface. */
    Began = "Began",
    /** Finger moved this frame. */
    Moved = "Moved",
    /** Finger is pressed but did not move this frame. */
    Stationary = "Stationary",
    /** Finger lifted this frame. */
    Ended = "Ended",
    /** The OS / browser cancelled the touch (e.g., gesture interruption). */
    Canceled = "Canceled",
}

/**
 * State of a single finger on the touch surface.
 *
 * @remarks Equivalent to Unity's `UnityEngine.Touch`.
 */
export class TouchInfo {
    /** Browser-assigned finger id. Stable across frames. */
    public readonly id: number;

    /** Current touch position, canvas-relative (top-left origin). */
    public readonly position: Vector2 = new Vector2(0, 0);

    /** Position at the beginning of this touch. */
    public readonly startPosition: Vector2 = new Vector2(0, 0);

    /** Change in position since last frame. */
    public readonly deltaPosition: Vector2 = new Vector2(0, 0);

    /** Lifecycle phase. */
    public phase: TouchPhase = TouchPhase.Began;

    /** Timestamp (seconds, from performance.now/1000) when this touch began. */
    public startTime: number = 0;

    /** Pressure 0–1 where supported, else 0. */
    public pressure: number = 0;

    /** Approximate radius of the touch in pixels, else 0. */
    public radius: number = 0;

    /** @internal */
    constructor(id: number) { this.id = id; }
}

/**
 * Static multi-touch input interface.
 *
 * @remarks
 * Equivalent to Unity's `Input.touches` API. The engine wires DOM touch
 * events to this module from {@link Touch._init}. Query from game code:
 *
 * ```ts
 * if (Touch.count > 0) {
 *     const t = Touch.get(0)!;
 *     if (t.phase === TouchPhase.Began) fire();
 * }
 * ```
 *
 * On devices that support touch but also a mouse, both Input (mouse) and
 * Touch (fingers) report independently.
 */
export class Touch {

    private static _active: Map<number, TouchInfo> = new Map();
    private static _ordered: TouchInfo[] = [];
    private static _canvas: HTMLCanvasElement | null = null;
    private static _handlers: {
        start?: (e: TouchEvent) => void;
        move?: (e: TouchEvent) => void;
        end?: (e: TouchEvent) => void;
        cancel?: (e: TouchEvent) => void;
    } = {};

    /** Whether the current environment advertises touch input. */
    public static get supported(): boolean {
        return typeof window !== "undefined" && "ontouchstart" in window;
    }

    /** Number of active touches this frame. */
    public static get count(): number { return Touch._ordered.length; }

    /** Returns the touch at the given slot, or `null`. */
    public static get(index: number): TouchInfo | null {
        return Touch._ordered[index] ?? null;
    }

    /** All active touches in DOM-reported order. */
    public static get touches(): readonly TouchInfo[] { return Touch._ordered; }

    /**
     * @internal
     * Binds DOM touch listeners to the given canvas.
     * Called by `Application` at startup.
     */
    public static _init(canvas: HTMLCanvasElement): void {
        Touch._teardown();
        Touch._canvas = canvas;

        const rect = () => canvas.getBoundingClientRect();

        const updateFromEvent = (t: globalThis.Touch, phase: TouchPhase): void => {
            const r = rect();
            const x = t.clientX - r.left;
            const y = t.clientY - r.top;

            let info = Touch._active.get(t.identifier);
            if (!info) {
                info = new TouchInfo(t.identifier);
                info.startPosition.set(x, y);
                info.startTime = performance.now() / 1000;
                Touch._active.set(t.identifier, info);
                Touch._ordered.push(info);
            } else {
                info.deltaPosition.set(x - info.position.x, y - info.position.y);
            }
            info.position.set(x, y);
            info.phase = phase;
            info.pressure = (t as any).force ?? 0;
            const rx = (t as any).radiusX ?? 0;
            const ry = (t as any).radiusY ?? 0;
            info.radius = (rx + ry) * 0.5;
        };

        Touch._handlers.start = (e: TouchEvent) => {
            for (const t of Array.from(e.changedTouches)) {
                updateFromEvent(t, TouchPhase.Began);
            }
        };
        Touch._handlers.move = (e: TouchEvent) => {
            for (const t of Array.from(e.changedTouches)) {
                updateFromEvent(t, TouchPhase.Moved);
            }
        };
        Touch._handlers.end = (e: TouchEvent) => {
            for (const t of Array.from(e.changedTouches)) {
                updateFromEvent(t, TouchPhase.Ended);
            }
        };
        Touch._handlers.cancel = (e: TouchEvent) => {
            for (const t of Array.from(e.changedTouches)) {
                updateFromEvent(t, TouchPhase.Canceled);
            }
        };

        canvas.addEventListener("touchstart",  Touch._handlers.start,  { passive: true });
        canvas.addEventListener("touchmove",   Touch._handlers.move,   { passive: true });
        canvas.addEventListener("touchend",    Touch._handlers.end);
        canvas.addEventListener("touchcancel", Touch._handlers.cancel);
    }

    /**
     * @internal
     * Advances touch phases and removes ended/canceled touches.
     * Called once per frame at the end of Update (before LateUpdate).
     */
    public static _postUpdate(): void {
        // First pass: Began → Stationary for touches that didn't move this frame.
        // End/Cancel are removed entirely for the next frame.
        const survivors: TouchInfo[] = [];
        for (const t of Touch._ordered) {
            if (t.phase === TouchPhase.Ended || t.phase === TouchPhase.Canceled) {
                Touch._active.delete(t.id);
                continue;
            }
            // Collapse Began/Moved → Stationary unless a new event arrives.
            t.phase = TouchPhase.Stationary;
            t.deltaPosition.set(0, 0);
            survivors.push(t);
        }
        Touch._ordered = survivors;
    }

    /** @internal Detaches DOM listeners (called on engine teardown). */
    public static _teardown(): void {
        if (Touch._canvas && Touch._handlers.start) {
            Touch._canvas.removeEventListener("touchstart",  Touch._handlers.start);
            Touch._canvas.removeEventListener("touchmove",   Touch._handlers.move!);
            Touch._canvas.removeEventListener("touchend",    Touch._handlers.end!);
            Touch._canvas.removeEventListener("touchcancel", Touch._handlers.cancel!);
        }
        Touch._canvas = null;
        Touch._handlers = {};
        Touch._active.clear();
        Touch._ordered = [];
    }

    private constructor() {}
}
