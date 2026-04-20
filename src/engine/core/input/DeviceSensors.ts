import { Vector3 } from "../math/Vector3";

/**
 * Access to mobile device orientation (compass + tilt) and motion
 * (acceleration + rotation rate) sensors.
 *
 * @remarks
 * Wraps the `DeviceOrientationEvent` and `DeviceMotionEvent` APIs.
 * On iOS 13+, {@link requestPermission} must be called from a user
 * gesture (e.g., a button click) before any values become available.
 *
 * ```ts
 * await DeviceSensors.requestPermission();
 * DeviceSensors.enable();
 * // each frame:
 * const tilt = DeviceSensors.orientation;       // alpha/beta/gamma degrees
 * const grav = DeviceSensors.accelGravity;      // m/s² incl. gravity
 * ```
 */
export class DeviceSensors {

    private static _enabled: boolean = false;

    /** Orientation in degrees: `x` = alpha (compass), `y` = beta (front-back tilt), `z` = gamma (left-right tilt). */
    public static readonly orientation: Vector3 = new Vector3(0, 0, 0);

    /** Linear acceleration without gravity (m/s²). Not supported on all devices. */
    public static readonly accel: Vector3 = new Vector3(0, 0, 0);

    /** Linear acceleration including gravity (m/s²). */
    public static readonly accelGravity: Vector3 = new Vector3(0, 0, 0);

    /** Rotation rate in degrees per second (alpha/beta/gamma). */
    public static readonly rotationRate: Vector3 = new Vector3(0, 0, 0);

    private static _onOrientation: ((e: DeviceOrientationEvent) => void) | null = null;
    private static _onMotion: ((e: DeviceMotionEvent) => void) | null = null;

    /** Whether any supported sensor API exists on this device. */
    public static get supported(): boolean {
        return typeof window !== "undefined"
            && ("DeviceOrientationEvent" in window || "DeviceMotionEvent" in window);
    }

    /** Whether DeviceSensors is currently listening. */
    public static get enabled(): boolean { return DeviceSensors._enabled; }

    /**
     * Requests permission on platforms that require it (iOS 13+ Safari).
     * On other browsers this resolves immediately with `true`.
     * Must be called from a user gesture handler.
     */
    public static async requestPermission(): Promise<boolean> {
        if (typeof window === "undefined") return false;
        const anyDOE: any = (window as any).DeviceOrientationEvent;
        const anyDME: any = (window as any).DeviceMotionEvent;

        let ok = true;
        if (anyDOE && typeof anyDOE.requestPermission === "function") {
            try {
                const r = await anyDOE.requestPermission();
                ok = ok && r === "granted";
            } catch { ok = false; }
        }
        if (anyDME && typeof anyDME.requestPermission === "function") {
            try {
                const r = await anyDME.requestPermission();
                ok = ok && r === "granted";
            } catch { ok = false; }
        }
        return ok;
    }

    /** Attaches sensor listeners. Call after {@link requestPermission} on iOS. */
    public static enable(): void {
        if (DeviceSensors._enabled || typeof window === "undefined") return;
        DeviceSensors._enabled = true;

        DeviceSensors._onOrientation = (e: DeviceOrientationEvent) => {
            DeviceSensors.orientation.set(
                e.alpha ?? 0,
                e.beta  ?? 0,
                e.gamma ?? 0,
            );
        };

        DeviceSensors._onMotion = (e: DeviceMotionEvent) => {
            const a = e.acceleration;
            if (a) DeviceSensors.accel.set(a.x ?? 0, a.y ?? 0, a.z ?? 0);
            const ag = e.accelerationIncludingGravity;
            if (ag) DeviceSensors.accelGravity.set(ag.x ?? 0, ag.y ?? 0, ag.z ?? 0);
            const rr = e.rotationRate;
            if (rr) DeviceSensors.rotationRate.set(rr.alpha ?? 0, rr.beta ?? 0, rr.gamma ?? 0);
        };

        window.addEventListener("deviceorientation", DeviceSensors._onOrientation);
        window.addEventListener("devicemotion",      DeviceSensors._onMotion);
    }

    /** Detaches sensor listeners and clears cached values. */
    public static disable(): void {
        if (!DeviceSensors._enabled || typeof window === "undefined") return;
        DeviceSensors._enabled = false;
        if (DeviceSensors._onOrientation) {
            window.removeEventListener("deviceorientation", DeviceSensors._onOrientation);
        }
        if (DeviceSensors._onMotion) {
            window.removeEventListener("devicemotion", DeviceSensors._onMotion);
        }
        DeviceSensors._onOrientation = null;
        DeviceSensors._onMotion = null;
        DeviceSensors.orientation.set(0, 0, 0);
        DeviceSensors.accel.set(0, 0, 0);
        DeviceSensors.accelGravity.set(0, 0, 0);
        DeviceSensors.rotationRate.set(0, 0, 0);
    }

    private constructor() {}
}
