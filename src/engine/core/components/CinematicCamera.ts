// path: src/engine/core/components/CinematicCamera.ts

import { ScriptableBehaviour } from "../ScriptableBehaviour.ts";
import { Input } from "../Input.ts";
import { KeyCode } from "../KeyCode.ts";
import { Time } from "../Time.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import type { GameObject } from "../GameObject.ts";
import type { Transform } from "../Transform.ts";

// ==================== ENUMS ====================

/**
 * Camera operating mode for {@link CinematicCamera}.
 */
export enum CameraMode {
    /** Orbits around a target point. LMB drag rotates, scroll zooms. */
    Orbit = 0,
    /** Free-fly camera. WASD moves, mouse look rotates. */
    Fly = 1,
    /** Follows a target Transform with offset and smoothing. */
    Follow = 2,
}

// ==================== CINEMATIC CAMERA ====================

/**
 * A versatile camera controller with Orbit, Fly, and Follow modes.
 *
 * Attach to the same GameObject as a {@link Camera} component.
 * Switch modes at runtime via the {@link mode} property.
 *
 * @remarks
 * This is an engine-provided convenience component — scenario authors
 * can use it directly or write their own camera scripts.
 *
 * **Orbit mode:** Drag LMB to rotate around {@link target}, scroll to
 * zoom in/out, MMB to pan the target point.
 *
 * **Fly mode:** Click canvas to lock cursor, then WASD + mouse look.
 * Shift = fast, Space/Ctrl = up/down. Press Escape to unlock.
 *
 * **Follow mode:** Smoothly tracks a {@link followTarget} Transform
 * with configurable offset and damping.
 *
 * @example
 * ```ts
 * const camGo = new GameObject("Camera");
 * camGo.addComponent(Camera);
 * const cc = camGo.addComponent(CinematicCamera);
 * cc.mode = CameraMode.Orbit;
 * cc.target = new Vector3(0, 0, 0);
 * cc.distance = 20;
 * ```
 */
export class CinematicCamera extends ScriptableBehaviour {

    // ==================== SHARED SETTINGS ====================

    /** Current camera mode. */
    public mode: CameraMode = CameraMode.Orbit;

    /** Damping factor for smooth movement (higher = snappier). */
    public damping: number = 8;

    // ==================== ORBIT SETTINGS ====================

    /** The world-space point to orbit around. */
    public target: Vector3 = Vector3.zero;

    /** Current distance from the target. */
    public distance: number = 20;

    /** Minimum zoom distance. */
    public minDistance: number = 1;

    /** Maximum zoom distance. */
    public maxDistance: number = 200;

    /** Horizontal orbit speed (degrees per pixel of mouse movement). */
    public orbitSpeed: number = 0.3;

    /** Vertical orbit speed (degrees per pixel). */
    public orbitSpeedY: number = 0.3;

    /** Zoom speed multiplier for scroll wheel. */
    public zoomSpeed: number = 2;

    /** Pan speed multiplier for middle-mouse drag. */
    public panSpeed: number = 0.01;

    /** Minimum vertical angle in degrees (-89 to avoid gimbal lock). */
    public minPolarAngle: number = -89;

    /** Maximum vertical angle in degrees. */
    public maxPolarAngle: number = 89;

    /** Enable scroll-wheel zoom. */
    public enableZoom: boolean = true;

    /** Enable middle-mouse pan. */
    public enablePan: boolean = true;

    // ==================== FLY SETTINGS ====================

    /** Fly mode movement speed (units per second). */
    public moveSpeed: number = 10;

    /** Fly mode fast movement multiplier (when Shift held). */
    public fastMultiplier: number = 3;

    /** Mouse look sensitivity (degrees per pixel). */
    public lookSensitivity: number = 0.15;

    // ==================== FOLLOW SETTINGS ====================

    /** The Transform to follow (set at runtime). */
    public followTarget: Transform | null = null;

    /** Offset from the follow target (in target's local space). */
    public followOffset: Vector3 = new Vector3(0, 5, -10);

    /** Follow smoothing factor (higher = snappier). */
    public followSmoothing: number = 5;

    /** Whether the camera looks at the follow target. */
    public followLookAt: boolean = true;

    // ==================== INTERNAL STATE ====================

    /** Horizontal angle in degrees (yaw). */
    private _yaw: number = 0;

    /** Vertical angle in degrees (pitch). */
    private _pitch: number = 20;

    /** Smoothed distance for zoom damping. */
    private _currentDistance: number = 20;

    /** Smoothed orbit target for pan damping. */
    private _currentTarget: Vector3 = Vector3.zero;

    /** Fly mode: current euler angles. */
    private _flyYaw: number = 0;
    private _flyPitch: number = 0;

    // ==================== LIFECYCLE ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinematicCamera";
    }

    public override start(): void {
        this._currentDistance = this.distance;
        this._currentTarget = this.target.clone();

        // Initialize fly angles from current rotation
        const fwd = this.transform.forward;
        this._flyYaw = Math.atan2(fwd.x, fwd.z) * (180 / Math.PI);
        this._flyPitch = Math.asin(-fwd.y) * (180 / Math.PI);
    }

    public override lateUpdate(): void {
        switch (this.mode) {
            case CameraMode.Orbit:
                this._updateOrbit();
                break;
            case CameraMode.Fly:
                this._updateFly();
                break;
            case CameraMode.Follow:
                this._updateFollow();
                break;
        }
    }

    // ==================== ORBIT MODE ====================

    private _updateOrbit(): void {
        const dt = Time.deltaTime;

        // ── Rotation (LMB drag) ──
        // Convention: drag right → scene rotates right → camera orbits left (yaw--)
        if (Input.getMouseButton(0)) {
            const delta = Input.mouseDelta;
            this._yaw -= delta.x * this.orbitSpeed;
            this._pitch += delta.y * this.orbitSpeedY;
            this._pitch = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._pitch));
        }

        // ── Zoom (scroll wheel) ──
        if (this.enableZoom) {
            const scroll = Input.mouseScrollDelta;
            if (scroll.y !== 0) {
                // Proportional zoom — feels natural at any distance
                this.distance -= scroll.y * this.zoomSpeed * this.distance * 0.05;
                this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
            }
        }

        // ── Pan (MMB drag) ──
        if (this.enablePan && Input.getMouseButton(1)) {
            const delta = Input.mouseDelta;
            const right = this.transform.right;
            const up = this.transform.up;
            const panAmount = this._currentDistance * this.panSpeed;
            this.target = new Vector3(
                this.target.x - right.x * delta.x * panAmount + up.x * delta.y * panAmount,
                this.target.y - right.y * delta.x * panAmount + up.y * delta.y * panAmount,
                this.target.z - right.z * delta.x * panAmount + up.z * delta.y * panAmount
            );
        }

        // ── Smooth interpolation ──
        const lerpFactor = 1 - Math.exp(-this.damping * dt);
        this._currentDistance += (this.distance - this._currentDistance) * lerpFactor;

        this._currentTarget = new Vector3(
            this._currentTarget.x + (this.target.x - this._currentTarget.x) * lerpFactor,
            this._currentTarget.y + (this.target.y - this._currentTarget.y) * lerpFactor,
            this._currentTarget.z + (this.target.z - this._currentTarget.z) * lerpFactor
        );

        // ── Calculate position from spherical coordinates ──
        const yawRad = this._yaw * (Math.PI / 180);
        const pitchRad = this._pitch * (Math.PI / 180);

        const cosPitch = Math.cos(pitchRad);
        const x = this._currentTarget.x + this._currentDistance * Math.sin(yawRad) * cosPitch;
        const y = this._currentTarget.y + this._currentDistance * Math.sin(pitchRad);
        const z = this._currentTarget.z + this._currentDistance * Math.cos(yawRad) * cosPitch;

        this.transform.position = new Vector3(x, y, z);
        this.transform.lookAt(this._currentTarget);
    }

    // ==================== FLY MODE ====================

    private _updateFly(): void {
        const dt = Time.deltaTime;

        // ── Cursor lock on click ──
        if (Input.getMouseButtonDown(0)) {
            Input.lockCursor();
        }
        if (Input.getKeyDown(KeyCode.Escape)) {
            Input.unlockCursor();
        }

        // ── Mouse look (only when locked) ──
        if (Input.cursorLocked) {
            const delta = Input.mouseDelta;
            this._flyYaw += delta.x * this.lookSensitivity;
            this._flyPitch -= delta.y * this.lookSensitivity;
            this._flyPitch = Math.max(-89, Math.min(89, this._flyPitch));
        }

        // ── Apply rotation ──
        this.transform.rotation = Quaternion.euler(this._flyPitch, this._flyYaw, 0);

        // ── Movement (WASD + Space/Ctrl) ──
        let speed = this.moveSpeed;
        if (Input.getKey(KeyCode.ShiftLeft) || Input.getKey(KeyCode.ShiftRight)) {
            speed *= this.fastMultiplier;
        }

        const forward = this.transform.forward;
        const right = this.transform.right;
        const move = new Vector3(0, 0, 0);

        if (Input.getKey(KeyCode.KeyW)) { move.x += forward.x; move.y += forward.y; move.z += forward.z; }
        if (Input.getKey(KeyCode.KeyS)) { move.x -= forward.x; move.y -= forward.y; move.z -= forward.z; }
        if (Input.getKey(KeyCode.KeyD)) { move.x += right.x; move.y += right.y; move.z += right.z; }
        if (Input.getKey(KeyCode.KeyA)) { move.x -= right.x; move.y -= right.y; move.z -= right.z; }
        if (Input.getKey(KeyCode.Space)) { move.y += 1; }
        if (Input.getKey(KeyCode.ControlLeft) || Input.getKey(KeyCode.ControlRight)) { move.y -= 1; }

        // Normalize to prevent faster diagonal movement
        const len = Math.sqrt(move.x * move.x + move.y * move.y + move.z * move.z);
        if (len > 0) {
            const s = speed * dt / len;
            const pos = this.transform.position;
            this.transform.position = new Vector3(
                pos.x + move.x * s,
                pos.y + move.y * s,
                pos.z + move.z * s
            );
        }
    }

    // ==================== FOLLOW MODE ====================

    private _updateFollow(): void {
        if (!this.followTarget) return;
        const dt = Time.deltaTime;

        // Calculate desired position using target's local axes
        const targetPos = this.followTarget.position;
        const targetFwd = this.followTarget.forward;
        const targetRight = this.followTarget.right;
        const targetUp = this.followTarget.up;

        // followOffset is in target's local space: x=right, y=up, z=forward
        const desiredPos = new Vector3(
            targetPos.x + targetRight.x * this.followOffset.x + targetUp.x * this.followOffset.y + targetFwd.x * this.followOffset.z,
            targetPos.y + targetRight.y * this.followOffset.x + targetUp.y * this.followOffset.y + targetFwd.y * this.followOffset.z,
            targetPos.z + targetRight.z * this.followOffset.x + targetUp.z * this.followOffset.y + targetFwd.z * this.followOffset.z
        );

        // Smooth follow
        const lerpFactor = 1 - Math.exp(-this.followSmoothing * dt);
        const currentPos = this.transform.position;
        this.transform.position = new Vector3(
            currentPos.x + (desiredPos.x - currentPos.x) * lerpFactor,
            currentPos.y + (desiredPos.y - currentPos.y) * lerpFactor,
            currentPos.z + (desiredPos.z - currentPos.z) * lerpFactor
        );

        // Look at the target
        if (this.followLookAt) {
            this.transform.lookAt(targetPos);
        }
    }
}