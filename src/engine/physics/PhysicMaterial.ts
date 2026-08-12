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

    /**
     * Contact materials this material takes part in, one per pairing.
     *
     * @remarks
     * The solver reads friction and restitution from these, never from a
     * material on its own, so changing {@link friction} has to reach them or it
     * changes nothing. Populated by the physics world as pairings are created.
     */
    private readonly _contacts: CANNON.ContactMaterial[] = [];

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
        this._refreshContacts();
    }

    /** Bounciness (0 = no bounce, 1 = perfect bounce). */
    public get bounciness(): number { return this._bounciness; }
    public set bounciness(value: number) {
        this._bounciness = value;
        this._cannonMaterial.restitution = value;
        this._refreshContacts();
    }

    /**
     * @internal
     * Records a contact material this one participates in, so later changes to
     * {@link friction} or {@link bounciness} reach the solver.
     *
     * **NEVER use in user-facing code.**
     */
    public _addContact(contact: CANNON.ContactMaterial): void {
        this._contacts.push(contact);
    }

    /**
     * @internal
     * Drops every recorded pairing. Called when the physics world is reset;
     * the contact materials themselves die with the world.
     *
     * **NEVER use in user-facing code.**
     */
    public _clearContacts(): void {
        this._contacts.length = 0;
    }

    /**
     * Recomputes every pairing this material is part of.
     *
     * @remarks
     * Combines by **average**, which is Unity's default `frictionCombine` /
     * `bounceCombine`. Reading both sides off the cannon materials means the
     * other material's current value is used without having to look it up.
     */
    private _refreshContacts(): void {
        for (const contact of this._contacts) {
            const [a, b] = contact.materials;
            contact.friction = (a.friction + b.friction) / 2;
            contact.restitution = (a.restitution + b.restitution) / 2;
        }
    }
}
