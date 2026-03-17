// path: src/engine/core/cinemachine/CinemachineBrain.ts

import { ScriptableBehaviour } from "../ScriptableBehaviour.ts";
import { Time } from "../Time.ts";
import { CameraState, CinemachineBlendStyle } from "./CinemachineCore.ts";
import { CinemachineVirtualCamera } from "./CinemachineVirtualCamera.ts";
import type { Camera } from "../components/Camera.ts";
import type { GameObject } from "../GameObject.ts";

export class CinemachineBrain extends ScriptableBehaviour {

    public defaultBlendStyle: CinemachineBlendStyle = CinemachineBlendStyle.Cut;
    public defaultBlendTime: number = 0.75;

    private _activeVCam: CinemachineVirtualCamera | null = null;
    private _blendProgress: number = 1;
    private _blendDuration: number = 0;
    private _outgoingState: CameraState = new CameraState();
    private _camera: Camera | null = null;
    private _frameCount: number = 0;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "CinemachineBrain";
    }

    public override start(): void {
        for (const comp of (this.gameObject as any)._components) {
            if (comp !== this && "fieldOfView" in comp && "_internalThreeCamera" in comp) {
                this._camera = comp as Camera;
                break;
            }
        }
    }

    public override lateUpdate(): void {
        const dt = Time.deltaTime;
        this._frameCount++;

        const bestVCam = this._findActiveVCam();
        if (bestVCam !== this._activeVCam) this._onVCamChanged(bestVCam);
        if (!this._activeVCam) return;

        const activeState = this._activeVCam._computeState(dt);

        let finalState: CameraState;
        if (this._blendProgress < 1) {
            this._blendProgress += dt / this._blendDuration;
            this._blendProgress = Math.min(1, this._blendProgress);

            let t: number;
            switch (this.defaultBlendStyle) {
                case CinemachineBlendStyle.Cut:    t = 1; break;
                case CinemachineBlendStyle.Linear: t = this._blendProgress; break;
                default: t = this._blendProgress * this._blendProgress * (3 - 2 * this._blendProgress); break;
            }
            finalState = CameraState.lerp(this._outgoingState, activeState, t);
        } else {
            finalState = activeState;
        }

        this.transform.position = finalState.position;
        this.transform.rotation = finalState.rotation;
        if (this._camera) this._camera.fieldOfView = finalState.fieldOfView;

        // Debug
        if (this._frameCount <= 3 || this._frameCount % 120 === 0) {
            const p = finalState.position;
            const e = finalState.rotation.eulerAngles;
            console.log(
                `[Brain] f=${this._frameCount} ` +
                `pos=(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) ` +
                `rot=(${e.x.toFixed(1)},${e.y.toFixed(1)},${e.z.toFixed(1)}) ` +
                `vcam=${this._activeVCam?.gameObject.name}`
            );
        }
    }

    public get activeVirtualCamera(): CinemachineVirtualCamera | null { return this._activeVCam; }
    public get isBlending(): boolean { return this._blendProgress < 1; }

    public cut(vcam: CinemachineVirtualCamera): void {
        this._activeVCam = vcam;
        this._blendProgress = 1;
        const state = vcam._computeState(0);
        this.transform.position = state.position;
        this.transform.rotation = state.rotation;
    }

    private _findActiveVCam(): CinemachineVirtualCamera | null {
        let best: CinemachineVirtualCamera | null = null;
        let bestPri = -Infinity;
        for (const v of CinemachineVirtualCamera._allVCams) {
            if (v.isActiveAndEnabled && v.priority > bestPri) { best = v; bestPri = v.priority; }
        }
        return best;
    }

    private _onVCamChanged(newVCam: CinemachineVirtualCamera | null): void {
        const hadPrev = this._activeVCam !== null;
        if (hadPrev) this._outgoingState = this._activeVCam!.state;

        this._activeVCam = newVCam;

        // First activation from null → always Cut
        if (!hadPrev || this.defaultBlendStyle === CinemachineBlendStyle.Cut) {
            this._blendProgress = 1;
        } else {
            this._blendDuration = this.defaultBlendTime;
            this._blendProgress = 0;
        }
        console.log(`[Brain] → "${newVCam?.gameObject.name}" (${hadPrev ? "blend" : "first"})`);
    }

    public override update(): void {}
    public override fixedUpdate(): void {}
}