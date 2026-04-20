import { Vector3 } from "../math/Vector3";
import { ParticleShapeType } from "./ParticleTypes";

/**
 * Defines the emitter shape — where new particles spawn and
 * which direction they initially travel.
 *
 * @remarks
 * Equivalent to Unity's `ParticleSystem.ShapeModule`.
 */
export class ParticleShape {

    /** The type of emitter shape. */
    public type: ParticleShapeType = ParticleShapeType.Sphere;

    /** Radius (used by Sphere and Cone). */
    public radius: number = 1;

    /** Cone half-angle in degrees (used by Cone). */
    public angle: number = 25;

    /** Axis-aligned box extents (used by Box). Half-sizes on each axis. */
    public boxExtents: Vector3 = new Vector3(1, 1, 1);

    /**
     * If true, emits from the surface of the shape; otherwise from its volume.
     * Only applies to Sphere and Box.
     */
    public emitFromShell: boolean = false;

    /**
     * @internal
     * Samples a random initial position and direction from this shape.
     * Writes results into the provided out-params to avoid allocation.
     */
    public _sample(outPos: Vector3, outDir: Vector3): void {
        switch (this.type) {
            case ParticleShapeType.Point:
                outPos.set(0, 0, 0);
                _randomUnitVector(outDir);
                break;

            case ParticleShapeType.Sphere: {
                _randomUnitVector(outDir);
                const r = this.emitFromShell ? this.radius : this.radius * Math.cbrt(Math.random());
                outPos.set(outDir.x * r, outDir.y * r, outDir.z * r);
                break;
            }

            case ParticleShapeType.Cone: {
                // Spawn at origin, direction within cone half-angle around +Y.
                outPos.set(0, 0, 0);
                const angleRad = (this.angle * Math.PI) / 180;
                const theta = Math.random() * angleRad;
                const phi = Math.random() * Math.PI * 2;
                const sinT = Math.sin(theta);
                outDir.set(
                    sinT * Math.cos(phi),
                    Math.cos(theta),
                    sinT * Math.sin(phi),
                );
                // Slight offset on the disk at radius=0 for cone base
                break;
            }

            case ParticleShapeType.Box: {
                const ex = this.boxExtents;
                if (this.emitFromShell) {
                    // Pick a random face, then a random point on it.
                    const face = Math.floor(Math.random() * 6);
                    const a = (Math.random() * 2 - 1);
                    const b = (Math.random() * 2 - 1);
                    switch (face) {
                        case 0: outPos.set(+ex.x, a * ex.y, b * ex.z); break;
                        case 1: outPos.set(-ex.x, a * ex.y, b * ex.z); break;
                        case 2: outPos.set(a * ex.x, +ex.y, b * ex.z); break;
                        case 3: outPos.set(a * ex.x, -ex.y, b * ex.z); break;
                        case 4: outPos.set(a * ex.x, b * ex.y, +ex.z); break;
                        default: outPos.set(a * ex.x, b * ex.y, -ex.z); break;
                    }
                } else {
                    outPos.set(
                        (Math.random() * 2 - 1) * ex.x,
                        (Math.random() * 2 - 1) * ex.y,
                        (Math.random() * 2 - 1) * ex.z,
                    );
                }
                outDir.set(0, 1, 0);
                break;
            }
        }
    }
}

/** @internal Generates a uniformly distributed unit vector. */
function _randomUnitVector(out: Vector3): void {
    const z = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    out.set(r * Math.cos(t), r * Math.sin(t), z);
}
