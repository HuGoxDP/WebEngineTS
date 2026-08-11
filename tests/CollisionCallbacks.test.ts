import { describe, test, expect, beforeEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Vector3 } from "../src/engine/core/math/Vector3";
import { Physics } from "../src/engine/physics/Physics";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { Rigidbody } from "../src/engine/physics/Rigidbody";
import { Collider } from "../src/engine/physics/Collider";
import { Collision } from "../src/engine/physics/Collision";

/** Records every physics callback it receives. */
class Recorder extends ScriptableBehaviour {
    public readonly events: string[] = [];
    public lastCollision: Collision | null = null;
    public lastOther: Collider | null = null;

    public onCollisionEnter(collision: Collision): void {
        this.events.push("enter");
        this.lastCollision = collision;
    }

    public onCollisionStay(collision: Collision): void {
        this.events.push("stay");
        this.lastCollision = collision;
    }

    public onCollisionExit(collision: Collision): void {
        this.events.push("exit");
        this.lastCollision = collision;
    }

    public onTriggerEnter(other: Collider): void {
        this.events.push("triggerEnter");
        this.lastOther = other;
    }

    public onTriggerStay(other: Collider): void {
        this.events.push("triggerStay");
        this.lastOther = other;
    }

    public onTriggerExit(other: Collider): void {
        this.events.push("triggerExit");
        this.lastOther = other;
    }
}

/** A static box of the given size, centred on `position`. */
function makeStatic(name: string, position: Vector3, size: Vector3): GameObject {
    const go = new GameObject(name);
    go.transform.position = position;
    const collider = go.addComponent(BoxCollider);
    collider.size = size;
    return go;
}

/** A dynamic box that starts overlapping whatever is at the origin. */
function makeDynamic(name: string, position: Vector3, size: Vector3): GameObject {
    const go = new GameObject(name);
    go.transform.position = position;
    const collider = go.addComponent(BoxCollider);
    collider.size = size;
    go.addComponent(Rigidbody);
    return go;
}

function step(times: number = 1): void {
    for (let i = 0; i < times; i++) Physics._step(1 / 60);
}

describe("Physics — collision callback dispatch", () => {
    beforeEach(() => {
        Physics._reset();
    });

    test("a pair reports Enter once, however many contact points it has", () => {
        const floor = makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(1, 1, 1));
        const recorder = box.addComponent(Recorder);
        floor.addComponent(Recorder);

        step();

        // A box resting flat produces several contact equations. Before the
        // pairs were grouped, the second one fired Stay in the same step.
        expect(recorder.events).toEqual(["enter"]);
    });

    test("every contact point of the pair arrives in one Collision", () => {
        makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(2, 1, 2));
        const recorder = box.addComponent(Recorder);

        step();

        // The data was always there; only one point of it used to be reported.
        expect(recorder.lastCollision!.contacts.length).toBeGreaterThan(1);
    });

    test("Enter is followed by Stay on later steps, not repeated", () => {
        makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(1, 1, 1));
        const recorder = box.addComponent(Recorder);

        step(3);

        expect(recorder.events).toEqual(["enter", "stay", "stay"]);
    });

    test("both sides hear about the collision, each about the other", () => {
        const floor = makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(1, 1, 1));
        const boxRecorder = box.addComponent(Recorder);
        const floorRecorder = floor.addComponent(Recorder);

        step();

        expect(boxRecorder.lastCollision!.collider.gameObject).toBe(floor);
        expect(floorRecorder.lastCollision!.collider.gameObject).toBe(box);
    });

    test("relative velocity is reported from each side's point of view", () => {
        const floor = makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(1, 1, 1));
        box.getComponent(Rigidbody)!.velocity = new Vector3(0, -4, 0);
        const boxRecorder = box.addComponent(Recorder);
        const floorRecorder = floor.addComponent(Recorder);

        step();

        expect(boxRecorder.lastCollision!.relativeVelocity.y)
            .toBeCloseTo(-floorRecorder.lastCollision!.relativeVelocity.y);
    });

    test("separating reports Exit, once, with no contacts", () => {
        makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(1, 1, 1));
        const recorder = box.addComponent(Recorder);
        step();

        box.transform.position = new Vector3(0, 50, 0);
        box.getComponent(Rigidbody)!._syncTransformToBody();
        step();

        expect(recorder.events).toEqual(["enter", "exit"]);
        expect(recorder.lastCollision!.contacts.length).toBe(0);
    });

    test("a trigger sends trigger events, not collision events", () => {
        const zone = makeStatic("Zone", new Vector3(0, 0, 0), new Vector3(4, 4, 4));
        zone.getComponent(BoxCollider)!.isTrigger = true;
        const zoneRecorder = zone.addComponent(Recorder);
        const box = makeDynamic("Box", new Vector3(0, 0, 0), new Vector3(1, 1, 1));
        const boxRecorder = box.addComponent(Recorder);

        step();

        expect(zoneRecorder.events).toEqual(["triggerEnter"]);
        expect(boxRecorder.events).toEqual(["triggerEnter"]);
        expect(zoneRecorder.lastOther!.gameObject).toBe(box);
    });

    test("a trigger reports Stay while overlapped and Exit when left", () => {
        const zone = makeStatic("Zone", new Vector3(0, 0, 0), new Vector3(4, 4, 4));
        zone.getComponent(BoxCollider)!.isTrigger = true;
        const box = makeDynamic("Box", new Vector3(0, 0, 0), new Vector3(1, 1, 1));
        const recorder = box.addComponent(Recorder);

        step(2);
        box.transform.position = new Vector3(0, 100, 0);
        box.getComponent(Rigidbody)!._syncTransformToBody();
        step();

        expect(recorder.events).toEqual(["triggerEnter", "triggerStay", "triggerExit"]);
    });
});

describe("Physics — who receives a callback", () => {
    beforeEach(() => {
        Physics._reset();
    });

    test("a disabled script hears nothing", () => {
        makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(1, 1, 1));
        const recorder = box.addComponent(Recorder);
        recorder.enabled = false;

        step();

        // sendMessage would have called it anyway; Unity does not deliver
        // physics callbacks to a disabled behaviour.
        expect(recorder.events).toEqual([]);
    });

    test("an inactive GameObject hears nothing", () => {
        makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(1, 1, 1));
        const recorder = box.addComponent(Recorder);
        box.setActive(false);

        step();

        expect(recorder.events).toEqual([]);
    });

    test("the survivor still hears Exit when the other object is destroyed", () => {
        const floor = makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(1, 1, 1));
        const floorRecorder = floor.addComponent(Recorder);
        step();

        // destroy() defers to end of frame, which no loop runs here.
        box.destroyImmediate();
        step();

        expect(floorRecorder.events).toEqual(["enter", "exit"]);
    });

    test("a throwing handler is reported and does not stop the others", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        makeStatic("Floor", new Vector3(0, 0, 0), new Vector3(10, 1, 10));
        const box = makeDynamic("Box", new Vector3(0, 0.6, 0), new Vector3(1, 1, 1));

        class Thrower extends ScriptableBehaviour {
            public onCollisionEnter(): void { throw new Error("boom"); }
        }
        box.addComponent(Thrower);
        const recorder = box.addComponent(Recorder);

        step();

        expect(error).toHaveBeenCalled();
        expect(recorder.events).toEqual(["enter"]);
        error.mockRestore();
    });
});
