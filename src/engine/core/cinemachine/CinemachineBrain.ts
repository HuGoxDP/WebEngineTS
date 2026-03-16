// path: src/engine/core/cinemachine/CinemachineBrain.ts

import { ScriptableBehaviour } from "../ScriptableBehaviour.ts";
import { Time } from "../Time.ts";
import { CameraState, CinemachineBlendStyle } from "./CinemachineCore.ts";
import { CinemachineVirtualCamera } from "./CinemachineVirtualCamera.ts";
import type { Camera } from "../components/Camera.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Drives the real {@link Camera} from the highest-priority active
 * {@link CinemachineVirtualCamera}.
 *
 * Attach to the same GameObject as a Camera component. Each frame
 * the Brain selects the highest-priority active VCam, runs its
 * Body → Aim pipeline, optionally blends with the outgoing camera,
 * and applies the result to the Camera's Transform and lens.
 *
 * @remarks
 * Equivalent to Unity 6's `Cinemachine.CinemachineBrain`.
 */
export class CinemachineBrain extends ScriptableBehaviour {

    // ==================== PUBLIC SETTINGS ====================

    /** Default blend style when transitioning between virtual cameras. */
    public defaultBlendStyle: CinemachineBlendStyle = CinemachineBlendStyle.Cut;

    /** Default blend duration in seconds. */
    public defaultBlendTime: number = 0.75;

    // ==================== INTERNAL STATE ====================

    private _activeVCam: CinemachineVirtualCamera | null = null;
    private _previousVCam: CinemachineVirtualCamera | null = null;
    private _blendProgress: number = 1;
    private _blendDuration: number = 0;
    private _outgoingState: CameraState = new CameraState();
    private _camera: Camera | null = null;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineBrain";
    }

    // ==================== LIFECYCLE ====================

    public override start(): void {
        // Discover Camera via duck-typing to avoid circular imports
        for (const comp of (this.gameObject as any)._components) {
            if (comp !== this && "fieldOfView" in comp && "_internalThreeCamera" in comp) {
                this._camera = comp as Camera;
                break;
            }
        }
        if (!this._camera) {
            console.warn("[CinemachineBrain] No Camera component found on this GameObject.");
        }
    }

    /**
     * @internal
     * Runs in lateUpdate so all game logic has already executed.
     */
    public override lateUpdate(): void {
        const dt = Time.deltaTime;

        // 1. Select highest-priority VCam
        const bestVCam = this._findActiveVCam();

        // 2. Handle transitions
        if (bestVCam !== this._activeVCam) {
            this._onVCamChanged(bestVCam);
        }

        if (!this._activeVCam) return;

        // 3. Run active VCam pipeline → CameraState
        const activeState = this._activeVCam._computeState(dt);

        // 4. Blend (if transitioning)
        let finalState: CameraState;

        if (this._blendProgress < 1) {
            this._blendProgress += dt / this._blendDuration;
            this._blendProgress = Math.min(1, this._blendProgress);

            let t: number;
            switch (this.defaultBlendStyle) {
                case CinemachineBlendStyle.Cut:
                    t = 1;
                    break;
                case CinemachineBlendStyle.Linear:
                    t = this._blendProgress;
                    break;
                case CinemachineBlendStyle.EaseInOut:
                default:
                    t = this._smoothStep(this._blendProgress);
                    break;
            }

            finalState = CameraState.lerp(this._outgoingState, activeState, t);
        } else {
            finalState = activeState;
        }

        // 5. Apply to real Camera
        this.transform.position = finalState.position;
        this.transform.rotation = finalState.rotation;

        if (this._camera) {
            this._camera.fieldOfView = finalState.fieldOfView;
        }
    }

    // ==================== PUBLIC API ====================

    /** The currently active virtual camera. */
    public get activeVirtualCamera(): CinemachineVirtualCamera | null {
        return this._activeVCam;
    }

    /** Whether the Brain is currently blending between two cameras. */
    public get isBlending(): boolean {
        return this._blendProgress < 1;
    }

    /** Forces an immediate cut to the specified VCam (no blend). */
    public cut(vcam: CinemachineVirtualCamera): void {
        this._activeVCam = vcam;
        this._blendProgress = 1;
        const state = vcam._computeState(0);
        this.transform.position = state.position;
        this.transform.rotation = state.rotation;
    }

    // ==================== PRIVATE ====================

    private _findActiveVCam(): CinemachineVirtualCamera | null {
        let best: CinemachineVirtualCamera | null = null;
        let bestPriority = -Infinity;

        for (const vcam of CinemachineVirtualCamera._allVCams) {
            if (vcam.isActiveAndEnabled && vcam.priority > bestPriority) {
                best = vcam;
                bestPriority = vcam.priority;
            }
        }
        return best;
    }

    private _onVCamChanged(newVCam: CinemachineVirtualCamera | null): void {
        if (this._activeVCam) {
            this._outgoingState = this._activeVCam.state;
            this._previousVCam = this._activeVCam;
        }

        this._activeVCam = newVCam;

        if (newVCam && this.defaultBlendStyle !== CinemachineBlendStyle.Cut) {
            this._blendDuration = this.defaultBlendTime;
            this._blendProgress = 0;
        } else {
            this._blendProgress = 1;
        }
    }

    /** Hermite smoothstep: t²(3 − 2t) */
    private _smoothStep(t: number): number {
        return t * t * (3 - 2 * t);
    }

    // ==================== UNUSED LIFECYCLE ====================
    public override update(): void {}
    public override fixedUpdate(): void {}
}