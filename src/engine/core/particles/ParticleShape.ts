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

    /**
     * Radius. For Sphere, the sphere's own; for Cone, its base disk.
     *
     * @remarks
     * A cone emits from a disk of this radius at `y = 0`, as Unity's does. Set
     * it to `0` for the point-source spray a cone had before, whatever this
     * field said.
     */
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
                // Direction within the cone half-angle around +Y, spawn on the
                // base disk of `radius`. Uniform by area, so `sqrt` rather than
                // a bare random — otherwise the centre of the disk is crowded.
                const angleRad = (this.angle * Math.PI) / 180;
                const theta = Math.random() * angleRad;
                const phi = Math.random() * Math.PI * 2;
                const sinT = Math.sin(theta);
                outDir.set(
                    sinT * Math.cos(phi),
                    Math.cos(theta),
                    sinT * Math.sin(phi),
                );

                const baseR = this.radius * Math.sqrt(Math.random());
                const psi = Math.random() * Math.PI * 2;
                outPos.set(baseR * Math.cos(psi), 0, baseR * Math.sin(psi));
                break;
            }

            case ParticleShapeType.Box: {
                const ex = this.boxExtents;
                if (this.emitFromShell) {
                    // Pick a face weighted by its area, then a random point on
                    // it. Picking one of six uniformly spreads particles evenly
                    // over faces of wildly different size — a 10x1x1 box would
                    // put a third of them on the two small caps — and a flat box
                    // would send two thirds to faces with no area at all.
                    const a = (Math.random() * 2 - 1);
                    const b = (Math.random() * 2 - 1);
                    const side = Math.random() < 0.5 ? 1 : -1;
                    const wx = ex.y * ex.z;
                    const wy = ex.x * ex.z;
                    const wz = ex.x * ex.y;
                    let pick = Math.random() * (wx + wy + wz);

                    if (pick < wx) {
                        outPos.set(side * ex.x, a * ex.y, b * ex.z);
                    } else if ((pick -= wx) < wy) {
                        outPos.set(a * ex.x, side * ex.y, b * ex.z);
                    } else {
                        outPos.set(a * ex.x, b * ex.y, side * ex.z);
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
