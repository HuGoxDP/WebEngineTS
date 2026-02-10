import { Physics } from "./Physics";
import * as THREE from "three";
import {Behaviour} from "../core/Behaviour";

export abstract class Collider extends Behaviour {
    /** @internal Об'єкт Three.js, який представляє фізичну форму для Raycaster */
    public abstract _getPhysicsShape(): THREE.Object3D;

    protected override onEnable(): void {
        Physics._registerCollider(this);
    }

    protected override onDisable(): void {
        Physics._unregisterCollider(this);
    }

    protected override onDestroy(): void {
        Physics._unregisterCollider(this);
    }
}