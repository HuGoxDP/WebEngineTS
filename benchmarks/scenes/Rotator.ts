// path: benchmarks/scenes/Rotator.ts

import { ScriptableBehaviour, Vector3, Time } from "WebEngineTS";

/**
 * Spins its Transform at a fixed angular velocity every frame.
 *
 * Exercises the per-frame transform-mutation path — the exact workload the
 * dirty-flag transform optimization targets (Scene 1 in the paper). Set
 * {@link degreesPerSecond} after `addComponent` and before the loop starts.
 */
export class Rotator extends ScriptableBehaviour {
    /** Angular velocity in degrees/second around each local axis. */
    public degreesPerSecond: Vector3 = new Vector3(0, 45, 0);

    private static readonly _tmp = new Vector3();

    public override update(): void {
        const dt = Time.deltaTime;
        Rotator._tmp.set(
            this.degreesPerSecond.x * dt,
            this.degreesPerSecond.y * dt,
            this.degreesPerSecond.z * dt,
        );
        this.transform.rotate(Rotator._tmp);
    }
}
