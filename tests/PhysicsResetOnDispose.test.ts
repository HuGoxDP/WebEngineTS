import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GraphicsAPI, GraphicsPowerPreference } from "../src/engine/core/rendering/RenderBackend";
import type {
    RenderBackend, RenderBackendOptions, RenderBackendStats,
} from "../src/engine/core/rendering/RenderBackend";
import { GameObject } from "../src/engine/core/GameObject";
import { BoxCollider } from "../src/engine/physics/BoxCollider";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * G5a: physics state survived `Application.dispose()` and the next scenario.
 *
 * `Physics` is static state — the collider registrations, the active collision
 * pairs — and so is the `PhysicsWorld` singleton: gravity, default friction and
 * bounciness, registered bodies and contact materials. `Physics._reset()` had
 * no production caller, so a host that reuses one page realm (opens a viewer,
 * the scenario sets `Physics.gravity` or leaves colliders registered, closes
 * it, opens another) started the next scenario on the old world. The platform
 * never saw it (it runs every scenario in a fresh player frame); any host that
 * does not, did. `Application.dispose()` now calls `Physics._reset()` beside
 * the other module resets (`AudioManager._reset`, `Time._reset`, the pending
 * destroys, the texture releases).
 */

class FakeBackend implements RenderBackend {
    public readonly api = GraphicsAPI.WebGPU;
    public pixelRatio: number;
    public exposure = 1;
    public shadowsEnabled = true;
    public readonly stats: RenderBackendStats | null = null;
    constructor(options: RenderBackendOptions) { this.pixelRatio = options.pixelRatio; }
    public setSize(): void {}
    public setClearColor(): void {}
    public clear(): void {}
    public renderScene(): void {}
    public readPixels(): boolean { return false; }
    public warmup(): void {}
    public dispose(): void {}
}

function installDomStubs(): () => void {
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, raf: g.requestAnimationFrame };
    g.window = {
        addEventListener() {}, removeEventListener() {},
        devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
    };
    g.document = { addEventListener() {}, removeEventListener() {}, pointerLockElement: null };
    g.requestAnimationFrame = () => 0;
    return () => {
        g.window = saved.window;
        g.document = saved.document;
        g.requestAnimationFrame = saved.raf;
    };
}

function stubCanvas(): HTMLCanvasElement {
    return {
        addEventListener() {}, removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement;
}

async function loadPhysics() {
    return (await import("../src/engine/physics/Physics")).Physics;
}

async function loadPhysicsWorld() {
    return (await import("../src/engine/physics/PhysicsWorld")).PhysicsWorld;
}

async function loadApplication() {
    return (await import("../src/engine/core/Application")).Application;
}

function makeApp(Application: Awaited<ReturnType<typeof loadApplication>>) {
    Application.backendFactory = options => new FakeBackend(options);
    return new Application(stubCanvas()) as unknown as {
        isPlaying: boolean;
        dispose(): void;
    };
}

/** A static box collider — registers itself with `Physics` on enable. */
function makeColliderBox(name: string): GameObject {
    const go = new GameObject(name);
    const collider = go.addComponent(BoxCollider);
    collider.size = new Vector3(1, 1, 1);
    return go;
}

let restoreDom: () => void;

beforeEach(() => { restoreDom = installDomStubs(); });

afterEach(async () => {
    const Application = await loadApplication();
    const Physics = await loadPhysics();
    Application.current?.dispose();
    Physics._reset();
    Application.backendFactory = null;
    Application.powerPreference = GraphicsPowerPreference.HighPerformance;
    restoreDom();
});

describe("Physics after disposing an Application", () => {
    test("a scenario's gravity and surface defaults do not reach the next one", async () => {
        const Physics = await loadPhysics();
        const PhysicsWorld = await loadPhysicsWorld();
        const Application = await loadApplication();
        const app = makeApp(Application);
        app.isPlaying = true;

        // The scenario gives itself moon gravity and an icy, bouncy house surface.
        const worldBefore = PhysicsWorld.instance;
        Physics.gravity = new Vector3(0, -1.62, 0);
        Physics.defaultFriction = 0.05;
        Physics.defaultBounciness = 0.9;
        expect(Physics.gravity.y).toBeCloseTo(-1.62);

        // The visitor leaves. The page — this host — stays.
        app.dispose();

        // The next access builds a fresh world with the defaults.
        expect(PhysicsWorld.instance).not.toBe(worldBefore);
        expect(Physics.gravity.x).toBe(0);
        expect(Physics.gravity.y).toBeCloseTo(-9.81);
        expect(Physics.gravity.z).toBe(0);
        expect(Physics.defaultFriction).toBeCloseTo(0.3);
        expect(Physics.defaultBounciness).toBeCloseTo(0);
    });

    test("colliders left registered do not reach the next scenario's queries", async () => {
        const Physics = await loadPhysics();
        const PhysicsWorld = await loadPhysicsWorld();
        const Application = await loadApplication();
        const app = makeApp(Application);
        app.isPlaying = true;

        // A scenario leaves a collider registered (bodies otherwise leave only
        // through their component's onDisable).
        const box = makeColliderBox("LeakedBox");
        const internals = Physics as unknown as {
            _colliders: unknown[];
            _activeCollisions: Map<string, unknown>;
            _framePairs: Map<string, unknown>;
        };
        expect(internals._colliders.length).toBeGreaterThan(0);
        // A touching pair from the last step, as the world would leave it.
        internals._activeCollisions.set("leaked-pair", {});
        internals._framePairs.set("leaked-pair", {});
        const worldBefore = PhysicsWorld.instance;

        app.dispose();

        expect(internals._colliders.length).toBe(0);
        expect(internals._activeCollisions.size).toBe(0);
        expect(internals._framePairs.size).toBe(0);
        expect(PhysicsWorld.instance).not.toBe(worldBefore);
        // The leaked box no longer answers a query in the reused realm.
        expect(Physics.checkSphere(box.transform.position, 2)).toBe(false);
    });

    test("a second dispose and a fresh Application start from a clean world", async () => {
        const Physics = await loadPhysics();
        const PhysicsWorld = await loadPhysicsWorld();
        const Application = await loadApplication();
        const app = makeApp(Application);
        app.isPlaying = true;

        Physics.gravity = new Vector3(0, -3, 0);
        app.dispose();
        // Double reset must be safe (the world is already gone).
        app.dispose();

        // A new Application in the same realm — the next viewer visit.
        const next = makeApp(Application);
        next.isPlaying = true;
        expect(Physics.gravity.y).toBeCloseTo(-9.81);
        expect((PhysicsWorld.instance as unknown as { _rigidbodies: unknown[] })._rigidbodies.length).toBe(0);
        next.dispose();
    });
});
