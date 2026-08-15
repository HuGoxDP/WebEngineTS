// path: src/engine/core/cinemachine/CinemachineOrbitalBody.ts

import { CinemachineBody, CameraState } from "./CinemachineCore.ts";
import { Input } from "../Input.ts";
import { Vector3 } from "../math/Vector3.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Orbits the virtual camera around a point in space.
 *
 * - **LMB drag** — rotate around the target (yaw + pitch)
 * - **Scroll wheel** — zoom in/out (proportional)
 * - **MMB drag** — pan the orbit center
 *
 * @remarks
 * Equivalent to Unity's `Cinemachine.CinemachineOrbitalTransposer`
 * combined with `CinemachineFreeLook` orbital behavior.
 *
 * @example
 * ```ts
 * const vcamGo = new GameObject("Orbit Cam");
 * vcamGo.addComponent(CinemachineVirtualCamera);
 * const body = vcamGo.addComponent(CinemachineOrbitalBody);
 * body.orbitCenter = Vector3.zero;
 * body.distance = 30;
 * ```
 */
export class CinemachineOrbitalBody extends CinemachineBody {

    // ==================== PUBLIC SETTINGS ====================

    /** The world-space point to orbit around. */
    public orbitCenter: Vector3 = Vector3.zero;

    /** Current distance from the orbit center. */
    public distance: number = 20;

    /** Minimum zoom distance. */
    public minDistance: number = 1;

    /** Maximum zoom distance. */
    public maxDistance: number = 200;

    /** Horizontal rotation speed (degrees per pixel). */
    public orbitSpeed: number = 0.3;

    /** Vertical rotation speed (degrees per pixel). */
    public orbitSpeedY: number = 0.3;

    /** Zoom speed multiplier for scroll wheel. */
    public zoomSpeed: number = 2;

    /** Pan speed multiplier for MMB drag. */
    public panSpeed: number = 0.01;

    /** Minimum vertical angle in degrees. */
    public minPolarAngle: number = -89;

    /** Maximum vertical angle in degrees. */
    public maxPolarAngle: number = 89;

    /** Enable scroll-wheel zoom. */
    public enableZoom: boolean = true;

    /** Enable middle-mouse pan. */
    public enablePan: boolean = true;

    /** Damping for smooth interpolation (higher = snappier). */
    public damping: number = 8;

    // ==================== INTERNAL STATE ====================

    /** Horizontal angle in degrees (yaw). */
    private _yaw: number = 0;

    /** Vertical angle in degrees (pitch). */
    private _pitch: number = 20;

    /** Smoothed distance for zoom damping. */
    private _currentDistance: number = 20;

    /** Smoothed orbit center for pan damping. */
    private _currentCenter: Vector3 = Vector3.zero;

    /** Whether state has been initialized. */
    private _initialized: boolean = false;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineOrbitalBody";
    }

    // ==================== PIPELINE ====================

    /**
     * Computes the orbital camera position for this frame.
     */
    public override computePosition(currentState: CameraState, dt: number): Vector3 {
        if (!this._initialized) {
            this._currentDistance = this.distance;
            this._currentCenter = this.orbitCenter.clone();
            this._initialized = true;
        }

        // If we have a follow target, use it as orbit center
        if (this.followTarget) {
            this.orbitCenter = this.followTarget.position;
        }

        // ── Rotation (LMB drag) ──
        if (Input.getMouseButton(0)) {
            const delta = Input.mouseDelta;
            this._yaw -= delta.x * this.orbitSpeed;
            this._pitch -= delta.y * this.orbitSpeedY;
            this._pitch = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._pitch));
        }

        // ── Zoom (scroll) ──
        if (this.enableZoom) {
            const scroll = Input.mouseScrollDelta;
            if (scroll.y !== 0) {
                this.distance -= scroll.y * this.zoomSpeed * this.distance * 0.1;
                this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
            }
        }

        // ── Pan (MMB drag) ──
        if (this.enablePan && Input.getMouseButton(1)) {
            const delta = Input.mouseDelta;

            // Compute camera right/up from current yaw/pitch
            const yawRad = this._yaw * (Math.PI / 180);
            const pitchRad = this._pitch * (Math.PI / 180);

            // Right vector (perpendicular to camera forward in XZ plane)
            const rightX = Math.cos(yawRad);
            const rightZ = -Math.sin(yawRad);

            // Up vector (approximate — perpendicular to forward and right)
            const upX = -Math.sin(pitchRad) * Math.sin(yawRad);
            const upY = Math.cos(pitchRad);
            const upZ = -Math.sin(pitchRad) * Math.cos(yawRad);

            const panAmount = this._currentDistance * this.panSpeed;
            this.orbitCenter = new Vector3(
                this.orbitCenter.x - rightX * delta.x * panAmount + upX * delta.y * panAmount,
                this.orbitCenter.y + upY * delta.y * panAmount,
                this.orbitCenter.z - rightZ * delta.x * panAmount + upZ * delta.y * panAmount
            );
        }

        // ── Smooth interpolation ──
        // `damping` is a rate, so zero means "no damping at all" — snap to the
        // target — rather than "never move". Exponential decay gives the second
        // for free: 1 - exp(0) is 0, and the camera would sit where it started.
        const lerpFactor = this.damping > 0 ? 1 - Math.exp(-this.damping * dt) : 1;
        this._currentDistance += (this.distance - this._currentDistance) * lerpFactor;

        this._currentCenter = new Vector3(
            this._currentCenter.x + (this.orbitCenter.x - this._currentCenter.x) * lerpFactor,
            this._currentCenter.y + (this.orbitCenter.y - this._currentCenter.y) * lerpFactor,
            this._currentCenter.z + (this.orbitCenter.z - this._currentCenter.z) * lerpFactor
        );

        // ── Spherical → Cartesian ──
        const yawRad = this._yaw * (Math.PI / 180);
        const pitchRad = this._pitch * (Math.PI / 180);
        const cosPitch = Math.cos(pitchRad);

        return new Vector3(
            this._currentCenter.x + this._currentDistance * Math.sin(yawRad) * cosPitch,
            this._currentCenter.y + this._currentDistance * Math.sin(pitchRad),
            this._currentCenter.z + this._currentDistance * Math.cos(yawRad) * cosPitch
        );
    }

    /**
     * The current orbit center (smoothed).
     * Useful for Aim components that need to know what to look at.
     */
    public get currentOrbitCenter(): Vector3 {
        return this._currentCenter.clone();
    }
}