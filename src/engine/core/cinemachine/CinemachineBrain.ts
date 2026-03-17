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
 * @remarks
 * Equivalent to Unity 6's `Cinemachine.CinemachineBrain`.
 */
export class CinemachineBrain extends ScriptableBehaviour {

    // ==================== PUBLIC SETTINGS ====================

    /** Default blend style when transitioning between virtual cameras. */
    public defaultBlendStyle: CinemachineBlendStyle = CinemachineBlendStyle.EaseInOut;

    /** Default blend duration in seconds. */
    public defaultBlendTime: number = 0.75;

    // ==================== INTERNAL STATE ====================

    private _activeVCam: CinemachineVirtualCamera | null = null;
    private _blendProgress: number = 1;
    private _blendDuration: number = 0;
    private _outgoingState: CameraState = new CameraState();
    private _camera: Camera | null = null;
    private _frameCount: number = 0;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineBrain";
    }

    // ==================== LIFECYCLE ====================

    public override start(): void {
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

    /** @internal */
    public override lateUpdate(): void {
        const dt = Time.deltaTime;
        this._frameCount++;

        // 1. Select highest-priority VCam
        const bestVCam = this._findActiveVCam();

        // 2. Handle transitions
        if (bestVCam !== this._activeVCam) {
            this._onVCamChanged(bestVCam);
        }

        if (!this._activeVCam) return;

        // 3. Run pipeline
        const activeState = this._activeVCam._computeState(dt);

        // 4. Blend or direct apply
        let finalState: CameraState;

        if (this._blendProgress < 1) {
            this._blendProgress += dt / this._blendDuration;
            this._blendProgress = Math.min(1, this._blendProgress);

            let t: number;
            switch (this.defaultBlendStyle) {
                case CinemachineBlendStyle.Cut:    t = 1; break;
                case CinemachineBlendStyle.Linear: t = this._blendProgress; break;
                case CinemachineBlendStyle.EaseInOut:
                default: t = this._smoothStep(this._blendProgress); break;
            }
            finalState = CameraState.lerp(this._outgoingState, activeState, t);
        } else {
            finalState = activeState;
        }

        // 5. Apply
        this.transform.position = finalState.position;
        this.transform.rotation = finalState.rotation;
        if (this._camera) {
            this._camera.fieldOfView = finalState.fieldOfView;
        }

        // Debug: log first 3 frames and every 120 frames
        if (this._frameCount <= 3 || this._frameCount % 120 === 0) {
            const p = finalState.position;
            const r = finalState.rotation.eulerAngles;
            console.log(
                `[Brain] frame=${this._frameCount} ` +
                `pos=(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) ` +
                `rot=(${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.z.toFixed(1)}) ` +
                `fov=${finalState.fieldOfView.toFixed(0)} ` +
                `blend=${this._blendProgress.toFixed(2)} ` +
                `vcam=${this._activeVCam?.gameObject.name ?? "null"}`
            );
        }
    }

    // ==================== PUBLIC API ====================

    public get activeVirtualCamera(): CinemachineVirtualCamera | null {
        return this._activeVCam;
    }

    public get isBlending(): boolean {
        return this._blendProgress < 1;
    }

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
        const hadPrevious = this._activeVCam !== null;

        if (hadPrevious) {
            // Snapshot outgoing state for blending
            this._outgoingState = this._activeVCam!.state;
        }

        this._activeVCam = newVCam;

        // First activation from null → always Cut (no state to blend from)
        // Subsequent transitions → use configured blend style
        if (!hadPrevious || this.defaultBlendStyle === CinemachineBlendStyle.Cut) {
            this._blendProgress = 1;
            console.log(`[Brain] Cut to "${newVCam?.gameObject.name}" (${hadPrevious ? "cut style" : "first activation"})`);
        } else {
            this._blendDuration = this.defaultBlendTime;
            this._blendProgress = 0;
            console.log(`[Brain] Blend to "${newVCam?.gameObject.name}" over ${this.defaultBlendTime}s`);
        }
    }

    private _smoothStep(t: number): number {
        return t * t * (3 - 2 * t);
    }

    public override update(): void {}
    public override fixedUpdate(): void {}
}