import { Behaviour } from "../Behaviour";
import { AudioManager } from "./AudioManager";
import type { GameObject } from "../GameObject";

/**
 * Represents the ears of the player in the scene.
 *
 * @remarks
 * Equivalent to Unity's `AudioListener`. Attach one to the main Camera
 * (or any GameObject). Each frame the component syncs the Web Audio
 * `AudioContext.listener` position and orientation to this Transform.
 *
 * Only one AudioListener should be active at a time.
 */
export class AudioListener extends Behaviour {

    private static _activeInstances: Set<AudioListener> = new Set();

    /**
     * @internal
     * Syncs all active AudioListener transforms to the AudioContext.
     * Called once per frame from Application._loop, after LateUpdate.
     */
    public static _updateAll(): void {
        for (const inst of AudioListener._activeInstances) {
            if (inst.isActiveAndEnabled) {
                inst._syncToContext();
            }
        }
    }

    /** @internal */
    public static _reset(): void {
        AudioListener._activeInstances.clear();
    }

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    protected override onEnable(): void {
        AudioListener._activeInstances.add(this);
    }

    protected override onDisable(): void {
        AudioListener._activeInstances.delete(this);
    }

    protected override onDestroy(): void {
        AudioListener._activeInstances.delete(this);
    }

    private _syncToContext(): void {
        const listener = AudioManager.context.listener;
        const pos = this.transform.position;
        const fwd = this.transform.forward;
        const up = this.transform.up;

        if (listener.positionX !== undefined) {
            listener.positionX.value = pos.x;
            listener.positionY.value = pos.y;
            listener.positionZ.value = pos.z;
            listener.forwardX.value = fwd.x;
            listener.forwardY.value = fwd.y;
            listener.forwardZ.value = fwd.z;
            listener.upX.value = up.x;
            listener.upY.value = up.y;
            listener.upZ.value = up.z;
        } else {
            (listener as any).setPosition(pos.x, pos.y, pos.z);
            (listener as any).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
        }
    }
}
