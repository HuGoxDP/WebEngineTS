import * as CANNON from "cannon-es";

/**
 * Describes the friction and bounciness of a physics surface.
 *
 * @remarks
 * Equivalent to Unity's `PhysicMaterial`.
 * Attach to a {@link Collider} to control how it interacts with other surfaces.
 */
export class PhysicMaterial {
    private _friction: number;
    private _bounciness: number;

    /** @internal The underlying cannon-es material. */
    public readonly _cannonMaterial: CANNON.Material;

    constructor(friction: number = 0.4, bounciness: number = 0) {
        this._friction = friction;
        this._bounciness = bounciness;
        this._cannonMaterial = new CANNON.Material({
            friction: this._friction,
            restitution: this._bounciness,
        });
    }

    /** Dynamic friction coefficient (0 = no friction, 1 = maximum friction). */
    public get friction(): number { return this._friction; }
    public set friction(value: number) {
        this._friction = value;
        this._cannonMaterial.friction = value;
    }

    /** Bounciness (0 = no bounce, 1 = perfect bounce). */
    public get bounciness(): number { return this._bounciness; }
    public set bounciness(value: number) {
        this._bounciness = value;
        this._cannonMaterial.restitution = value;
    }
}
