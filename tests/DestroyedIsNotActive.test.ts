import { describe, test, expect, afterEach } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { Behaviour } from "../src/engine/core/Behaviour";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { UIImage } from "../src/engine/core/ui/UIImage";
import { RectTransform } from "../src/engine/core/ui/RectTransform";

/**
 * `isActiveAndEnabled` is what the whole engine asks before touching a
 * component — the event system before delivering a click, the loops before
 * updating. Destruction never cleared `enabled`, and a destroyed GameObject
 * keeps its `activeSelf`, so the answer stayed `true` for components that were
 * gone. Audit part 6, F36.
 */

const made: GameObject[] = [];

function object(name = "Thing"): GameObject {
    const go = new GameObject(name);
    made.push(go);
    return go;
}

/** Records what it saw of itself while being torn down. */
class Watcher extends ScriptableBehaviour {
    public activeInDisable: boolean | null = null;
    public activeInDestroy: boolean | null = null;

    protected override onDisable(): void {
        this.activeInDisable = this.isActiveAndEnabled;
    }

    protected override onDestroy(): void {
        this.activeInDestroy = this.isActiveAndEnabled;
    }
}

afterEach(() => {
    for (const go of made) if (go.exists()) go.destroyImmediate();
    made.length = 0;
});

describe("A destroyed component is not active", () => {
    test("says so after its GameObject is destroyed", () => {
        const go = object();
        const image = go.addComponent(UIImage);
        expect(image.isActiveAndEnabled).toBe(true);

        go.destroyImmediate();

        expect(image.isActiveAndEnabled).toBe(false);
    });

    test("says so after being destroyed on its own", () => {
        const go = object();
        const image = go.addComponent(UIImage);

        image.destroyImmediate();

        expect(image.isActiveAndEnabled).toBe(false);
        expect(go.exists()).toBe(true);
    });

    test("a child destroyed with its parent says so too", () => {
        const parent = object("Parent");
        const child = object("Child");
        child.transform.setParent(parent.transform, false);
        const image = child.addComponent(UIImage);

        parent.destroyImmediate();

        expect(image.isActiveAndEnabled).toBe(false);
    });

    test("is still active while its own onDisable runs", () => {
        // Teardown fires onDisable before marking the object destroyed, so
        // cleanup code that asks sees what it saw before.
        const go = object();
        const watcher = go.addComponent(Watcher);

        go.destroyImmediate();

        expect(watcher.activeInDisable).toBe(true);
    });

    test("and while onDestroy runs, which is where cleanup lives", () => {
        // `_isDestroyed` is set *after* onDestroy returns, so both teardown
        // hooks still see a live component — deliberately, since that is where
        // a component unregisters itself and reads its own state to do it. The
        // change only affects the world after destruction has finished.
        const go = object();
        const watcher = go.addComponent(Watcher);

        go.destroyImmediate();

        expect(watcher.activeInDestroy).toBe(true);
    });

    test("disabling and deactivating still work as before", () => {
        const go = object();
        const image = go.addComponent(UIImage);

        image.enabled = false;
        expect(image.isActiveAndEnabled).toBe(false);

        image.enabled = true;
        expect(image.isActiveAndEnabled).toBe(true);

        go.setActive(false);
        expect(image.isActiveAndEnabled).toBe(false);

        go.setActive(true);
        expect(image.isActiveAndEnabled).toBe(true);
    });

    test("a graphic destroyed mid-interaction is not delivered to", () => {
        // The reachable case: a close button whose handler destroys its own
        // panel. Every EventSystem guard is an isActiveAndEnabled test.
        const go = object("Panel");
        go.addComponent(RectTransform);
        const graphic: Behaviour = go.addComponent(UIImage);

        go.destroyImmediate();

        expect(graphic.isActiveAndEnabled).toBe(false);
    });
});
