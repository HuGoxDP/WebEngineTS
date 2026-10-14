import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Serializable, SerializedField } from "../src/engine/core/reflection/Decorators";
import { SceneSerializer, type SerializedScene } from "../src/engine/core/serialization/SceneSerializer";
import { MissingComponent } from "../src/engine/core/serialization/MissingComponent";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { Rigidbody } from "../src/engine/physics/Rigidbody";

/**
 * What a load does with an object's components, as a sequence.
 *
 * Every component of an object is built before the first one wakes, so that an
 * `awake` which looks for a sibling finds it. Each component then wakes and
 * takes its saved fields in list order, exactly as it did when a load added
 * them one at a time: only whether the siblings exist during that sequence has
 * changed. Fields are not written before the wake, though Unity does, because
 * a built-in whose setter needs what its `onAwake` creates drops the value.
 */

const log: string[] = [];

@Serializable({ typeName: "RestoreOrder.A" })
class A extends ScriptableBehaviour {
    @SerializedField() public n = 1;
    private _v = 1;
    @SerializedField()
    public get v(): number { return this._v; }
    public set v(value: number) { log.push(`A.v=${value}`); this._v = value; }
    public override awake(): void {
        log.push(`A.awake n=${this.n} sees=${this.gameObject.getComponents(ScriptableBehaviour).length}`);
    }
    public override onEnable(): void { log.push("A.onEnable"); }
    public override start(): void { log.push("A.start"); }
}

@Serializable({ typeName: "RestoreOrder.B" })
class B extends ScriptableBehaviour {
    @SerializedField() public n = 1;
    public override awake(): void { log.push(`B.awake n=${this.n}`); }
    public override onEnable(): void { log.push("B.onEnable"); }
    public override start(): void { log.push("B.start"); }
}

@Serializable({ typeName: "RestoreOrder.Destroyer" })
class Destroyer extends ScriptableBehaviour {
    public override awake(): void { this.gameObject.getComponent(B)?.destroyImmediate(); }
}

const clear = (): void => {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
};

function sceneWith(active: boolean, ...components: unknown[]): SerializedScene {
    return {
        name: "Spec", version: 1,
        roots: [{
            name: "Holder", active,
            transform: {
                position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
            },
            components: components as never,
            children: [],
        }],
    };
}

const a = (n: number, v: number) => ({ type: "RestoreOrder.A", fields: { n, v } });
const b = (n: number) => ({ type: "RestoreOrder.B", fields: { n } });
const ghost = { type: "RestoreOrder.Ghost", fields: { speed: 4 } };

beforeEach(() => {
    clear();
    log.length = 0;
});
afterEach(clear);

describe("the sequence of a load", () => {
    test("each component wakes, enables and takes its fields in list order", () => {
        SceneSerializer.deserializeScene(sceneWith(true, a(5, 9), b(7)));

        // `n` is read by awake before the fields are written; that is the order
        // a load has always had, kept deliberately.
        expect(log).toEqual([
            "A.awake n=1 sees=2", "A.onEnable", "A.v=9",
            "B.awake n=1", "B.onEnable",
        ]);
    });

    test("start still waits for the first update", () => {
        const [go] = SceneSerializer.deserializeScene(sceneWith(true, a(5, 9), b(7)));
        log.length = 0;

        go._systemUpdate();

        expect(log).toEqual(["A.start", "B.start"]);
    });

    test("fields are applied to the component that woke", () => {
        const [go] = SceneSerializer.deserializeScene(sceneWith(true, a(5, 9), b(7)));

        expect(go.getComponent(A)!.n).toBe(5);
        expect(go.getComponent(A)!.v).toBe(9);
        expect(go.getComponent(B)!.n).toBe(7);
    });

    test("an awake can find a sibling listed after it", () => {
        const [go] = SceneSerializer.deserializeScene(sceneWith(true, a(1, 1), b(1)));

        expect(go.getComponent(A)).not.toBeNull();
        expect(log[0]).toBe("A.awake n=1 sees=2");
    });

    test("an inactive object wakes nothing until it is activated, then in list order", () => {
        const [go] = SceneSerializer.deserializeScene(sceneWith(false, a(5, 9), b(7)));
        expect(log).toEqual(["A.v=9"]);
        log.length = 0;

        go.setActive(true);

        expect(log).toEqual(["A.awake n=5 sees=2", "B.awake n=7", "A.onEnable", "B.onEnable"]);
    });

    test("a component destroyed by an earlier awake is neither woken nor given fields", () => {
        const destroyer = { type: "RestoreOrder.Destroyer", fields: {} };

        const [go] = SceneSerializer.deserializeScene(sceneWith(true, destroyer, b(7)));

        expect(go.getComponents(B)).toHaveLength(0);
        expect(log).toEqual([]);
    });
});

describe("a placeholder between restored components", () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
    afterEach(() => warn.mockRestore());

    test("keeps its place, and the ones around it load as usual", () => {
        const [go] = SceneSerializer.deserializeScene(sceneWith(true, a(5, 9), ghost, b(7)));

        expect(go.getAllComponents().map(c => c.constructor)).toEqual([A, MissingComponent, B]);
        expect(go.getComponent(MissingComponent)!.originalType).toBe("RestoreOrder.Ghost");
        expect(go.getComponent(A)!.n).toBe(5);
        expect(go.getComponent(B)!.n).toBe(7);
    });

    test("is written back where it was", () => {
        const [go] = SceneSerializer.deserializeScene(sceneWith(true, a(5, 9), ghost, b(7)));

        expect(SceneSerializer.serializeGameObject(go).components.map(c => c.type))
            .toEqual(["RestoreOrder.A", "RestoreOrder.Ghost", "RestoreOrder.B"]);
        expect(SceneSerializer.serializeGameObject(go).components[1]).toEqual(ghost);
    });
});

describe("a Rigidbody and its colliders", () => {
    test("a Rigidbody enabling leaves a collider that has not enabled yet to its own enable", () => {
        const go = new GameObject("Body");
        const collider = go._attachComponent(BoxCollider);

        const body = go.addComponent(Rigidbody);
        expect(body._body.shapes).toHaveLength(0);

        go._wakeComponent(collider);
        expect(body._body.shapes).toHaveLength(1);
    });

    const rigidbody = { type: "Rigidbody", fields: { mass: 3 } };
    const box = { type: "BoxCollider", fields: {} };

    test.each([
        ["after the collider", [box, rigidbody]],
        ["before the collider", [rigidbody, box]],
    ])("a Rigidbody listed %s carries the collider's shape once", (_label, components) => {
        const [go] = SceneSerializer.deserializeScene(sceneWith(true, ...components));

        const body = go.getComponent(Rigidbody)!;
        expect(body.mass).toBe(3);
        expect(body._body.shapes).toHaveLength(1);
        expect(go.getComponent(BoxCollider)!._getBody()).toBe(body._body);
    });
});
