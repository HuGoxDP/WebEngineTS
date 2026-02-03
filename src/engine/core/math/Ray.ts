import { Vector3 } from "./Vector3";
export class Ray {
    public origin: Vector3;
    public direction: Vector3;

    constructor(origin: Vector3 = new Vector3(), direction: Vector3 = new Vector3(0, 0, 1)) {
        this.origin = origin;
        this.direction = direction;
    }

    public getPoint(distance: number): Vector3 {
        // origin + direction * distance
        return this.origin.clone().add(this.direction.clone().multiplyScalar(distance));
    }

    public toString(): string {
        return `Ray(Origin: ${this.origin.toString()}, Dir: ${this.direction.toString()})`;
    }
}