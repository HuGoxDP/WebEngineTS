// path: src/engine/core/cinemachine/CinemachineVirtualCamera.ts

import { ScriptableBehaviour } from "../ScriptableBehaviour.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Quaternion } from "../math/Quaternion.ts";
import { CameraState, CinemachineBody, CinemachineAim } from "./CinemachineCore.ts";
import type { GameObject } from "../GameObject.ts";
import type { Transform } from "../Transform.ts";

/**
 * A virtual camera that computes a desired {@link CameraState} each frame.
 *
 * Does NOT render anything — the {@link CinemachineBrain} on the real Camera
 * reads the active VCam's state and applies it.
 *
 * **Composition pattern:** Attach a {@link CinemachineBody} subclass and a
 * {@link CinemachineAim} subclass to the same GameObject. The VCam discovers
 * them automatically and drives the Body → Aim pipeline each frame.
 *
 * The VCam with the highest {@link priority} that is active and enabled
 * becomes the Brain's live camera.
 *
 * @remarks
 * Equivalent to Unity's `Cinemachine.CinemachineVirtualCamera`.
 *
 * @example
 * ```ts
 * // Orbit camera looking at origin
 * const vcamGo = new GameObject("Orbit Cam");
 * const vcam = vcamGo.addComponent(CinemachineVirtualCamera);
 * vcam.priority = 10;
 * vcam.lookAt = sunTransform;
 * vcamGo.addComponent(CinemachineOrbitalBody);
 * vcamGo.addComponent(CinemachineHardLookAtAim);
 *
 * // FPS camera
 * const fpsGo = new GameObject("FPS Cam");
 * const fpsCam = fpsGo.addComponent(CinemachineVirtualCamera);
 * fpsCam.priority = 0;
 * fpsGo.addComponent(CinemachineFlyBody);
 * fpsGo.addComponent(CinemachinePOVAim);
 * ```
 */
export class CinemachineVirtualCamera extends ScriptableBehaviour {

    // ==================== STATIC REGISTRY ====================

    /**
     * @internal
     * All active virtual cameras. Brain queries this to find the live cam.
     */
    public static readonly _allVCams: CinemachineVirtualCamera[] = [];

    // ==================== PUBLIC SETTINGS ====================

    /**
     * Camera priority. The Brain selects the highest-priority active VCam.
     *
     * @remarks Equivalent to Unity's `CinemachineVirtualCamera.Priority`.
     */
    public priority: number = 10;

    /**
     * The Transform for the Body to follow (position tracking).
     *
     * @remarks Equivalent to Unity's `CinemachineVirtualCamera.Follow`.
     */
    public follow: Transform | null = null;

    /**
     * The Transform for the Aim to look at (rotation tracking).
     *
     * @remarks Equivalent to Unity's `CinemachineVirtualCamera.LookAt`.
     */
    public lookAt: Transform | null = null;

    /**
     * Default field of view when no Body overrides it.
     */
    public fieldOfView: number = 60;

    // ==================== INTERNAL STATE ====================

    /** Cached Body component. */
    private _body: CinemachineBody | null = null;

    /** Cached Aim component. */
    private _aim: CinemachineAim | null = null;

    /** Last computed state (used as input for next frame). */
    private _state: CameraState = new CameraState();

    /** Debug: log first computation only. */
    private _debugged: boolean = false;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineVirtualCamera";
    }

    // ==================== LIFECYCLE ====================

    public override awake(): void {
        // Register in global list
        CinemachineVirtualCamera._allVCams.push(this);
    }

    public override start(): void {
        this._discoverComponents();
        // Initialize state from this VCam's transform so Body/Aim
        // get a sane starting position (not always origin)
        this._state = new CameraState(
            this.transform.position,
            this.transform.rotation,
            this.fieldOfView
        );
    }

    protected override onDestroy(): void {
        // Unregister
        const idx = CinemachineVirtualCamera._allVCams.indexOf(this);
        if (idx !== -1) {
            CinemachineVirtualCamera._allVCams.splice(idx, 1);
        }
    }

    // ==================== PIPELINE ====================

    /**
     * Discovers Body and Aim components on this GameObject.
     *
     * Called in start(), but can also be called manually after
     * adding/removing components at runtime.
     */
    public resolveComponents(): void {
        this._discoverComponents();
    }

    /**
     * Runs the Body → Aim pipeline and returns the computed state.
     *
     * Called by {@link CinemachineBrain} each frame for the active VCam.
     *
     * @param dt — delta time in seconds.
     * @returns the computed camera state for this frame.
     *
     * @internal
     */
    public _computeState(dt: number): CameraState {
        // Propagate targets to Body/Aim
        if (this._body) this._body.followTarget = this.follow;
        if (this._aim) this._aim.lookAtTarget = this.lookAt;

        // Stage 1: Body → position
        let position: Vector3;
        if (this._body && this._body.isActiveAndEnabled) {
            position = this._body.computePosition(this._state, dt);
        } else {
            position = this.transform.position;
        }

        // Stage 2: Aim → rotation
        let rotation: Quaternion;
        if (this._aim && this._aim.isActiveAndEnabled) {
            rotation = this._aim.computeRotation(position, this._state, dt);
        } else {
            rotation = this.transform.rotation;
        }

        // Build new state
        this._state = new CameraState(position, rotation, this.fieldOfView);

        // Debug first frame
        if (!this._debugged) {
            this._debugged = true;
            const p = position;
            const e = rotation.eulerAngles;
            console.log(
                `[VCam] "${this.gameObject.name}" first state: ` +
                `pos=(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) ` +
                `euler=(${e.x.toFixed(1)}, ${e.y.toFixed(1)}, ${e.z.toFixed(1)}) ` +
                `body=${this._body ? "active" : "NONE"} aim=${this._aim ? "active" : "NONE"}`
            );
        }

        return this._state;
    }

    /**
     * Returns the last computed state without running the pipeline.
     */
    public get state(): CameraState {
        return this._state;
    }

    // ==================== PUBLIC ACCESSORS ====================

    /** The Body component on this VCam (if any). */
    public get body(): CinemachineBody | null {
        return this._body;
    }

    /** The Aim component on this VCam (if any). */
    public get aim(): CinemachineAim | null {
        return this._aim;
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * Scans this GameObject for Body and Aim components using instanceof.
     *
     * Cannot use `getComponent(AbstractClass)` because TypeScript rejects
     * abstract constructors in `new (...) => T` signatures. Manual
     * iteration with `instanceof` works correctly for abstract bases.
     *
     * @internal
     */
    private _discoverComponents(): void {
        this._body = null;
        this._aim = null;

        const components = (this.gameObject as any)._components as any[];
        for (const comp of components) {
            if (!this._body && comp instanceof CinemachineBody) {
                this._body = comp;
            }
            if (!this._aim && comp instanceof CinemachineAim) {
                this._aim = comp;
            }
        }

        console.log(
            `[VCam] "${this.gameObject.name}" discovered: ` +
            `body=${this._body?.name ?? "NONE"} aim=${this._aim?.name ?? "NONE"} ` +
            `(${components.length} components total)`
        );
    }

    // ==================== UNUSED LIFECYCLE (silent) ====================
    public override update(): void { /* driven by Brain, not game loop */ }
    public override lateUpdate(): void { /* driven by Brain */ }
    public override fixedUpdate(): void { /* not used */ }
}