import { describe, test, expect } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";

/**
 * GameObject activity and the enable/disable transitions, against Unity's
 * documented behaviour. The class had no direct tests before this.
 *
 * One divergence found while writing them is deliberately *not* asserted here,
 * because a test would cement it: Awake fires on addComponent even when the
 * GameObject is inactive, where Unity defers it until activation. Recorded as
 * F4 in design/audit/findings.md.
 */

/** Records the order lifecycle hooks fire in. */
class Probe extends ScriptableBehaviour {
    public readonly log: string[] = [];
    public override awake(): void { this.log.push("awake"); }
    public override onEnable(): void { this.log.push("onEnable"); }
    public override onDisable(): void { this.log.push("onDisable"); }
    public override onDestroy(): void { this.log.push("onDestroy"); }
}

function probed(): { go: GameObject; probe: Probe } {
    const go = new GameObject("go");
    return { go, probe: go.addComponent(Probe) };
}

describe("GameObject — activity", () => {
    test("a new GameObject is active, and says so both ways", () => {
        const go = new GameObject("go");

        expect(go.activeSelf).toBe(true);
        expect(go.activeInHierarchy).toBe(true);
    });

    test("activeInHierarchy is false when any ancestor is inactive", () => {
        const root = new GameObject("root");
        const mid = new GameObject("mid");
        const leaf = new GameObject("leaf");
        mid.transform.parent = root.transform;
        leaf.transform.parent = mid.transform;

        root.setActive(false);

        // Its own flag is untouched — only the inherited answer changes.
        expect(leaf.activeSelf).toBe(true);
        expect(leaf.activeInHierarchy).toBe(false);
    });

    test("re-activating an ancestor does not revive a child disabled on its own", () => {
        const root = new GameObject("root");
        const child = new GameObject("child");
        child.transform.parent = root.transform;
        child.setActive(false);

        root.setActive(false);
        root.setActive(true);

        expect(child.activeInHierarchy).toBe(false);
    });

    test("setActive to the value it already has does nothing", () => {
        const { go, probe } = probed();
        probe.log.length = 0;

        go.setActive(true);

        expect(probe.log).toEqual([]);
    });
});

describe("GameObject — enable and disable transitions", () => {
    test("awake then onEnable, in that order, on a live GameObject", () => {
        const { probe } = probed();

        expect(probe.log).toEqual(["awake", "onEnable"]);
    });

    test("deactivating fires onDisable, reactivating fires onEnable", () => {
        const { go, probe } = probed();
        probe.log.length = 0;

        go.setActive(false);
        go.setActive(true);

        expect(probe.log).toEqual(["onDisable", "onEnable"]);
    });

    test("the transition fires once, not once per toggle attempt", () => {
        // _onEnabledChanged compares against the recorded state, so a repeated
        // call with no change must stay silent.
        const { go, probe } = probed();
        probe.log.length = 0;

        go.setActive(false);
        go.setActive(false);

        expect(probe.log).toEqual(["onDisable"]);
    });

    test("disabling the component alone fires onDisable", () => {
        const { probe } = probed();
        probe.log.length = 0;

        probe.enabled = false;

        expect(probe.log).toEqual(["onDisable"]);
    });

    test("an enabled component on a deactivated object is not active", () => {
        const { go, probe } = probed();

        go.setActive(false);

        expect(probe.enabled).toBe(true);
        expect(probe.isActiveAndEnabled).toBe(false);
    });

    test("re-enabling a component under an inactive parent stays quiet", () => {
        // The effective state never changed, so neither hook should fire.
        const { go, probe } = probed();
        go.setActive(false);
        probe.enabled = false;
        probe.log.length = 0;

        probe.enabled = true;

        expect(probe.log).toEqual([]);
        expect(probe.isActiveAndEnabled).toBe(false);
    });

    test("a deactivated ancestor disables descendants at any depth", () => {
        const root = new GameObject("root");
        const mid = new GameObject("mid");
        const leaf = new GameObject("leaf");
        mid.transform.parent = root.transform;
        leaf.transform.parent = mid.transform;
        const probe = leaf.addComponent(Probe);
        probe.log.length = 0;

        root.setActive(false);

        expect(probe.log).toEqual(["onDisable"]);
    });
});

describe("GameObject — destruction", () => {
    test("onDisable runs before onDestroy, as Unity sequences it", () => {
        const { go, probe } = probed();
        probe.log.length = 0;

        go.destroyImmediate();

        expect(probe.log).toEqual(["onDisable", "onDestroy"]);
    });

    test("destroying a parent destroys its children", () => {
        const root = new GameObject("root");
        const child = new GameObject("child");
        child.transform.parent = root.transform;

        root.destroyImmediate();

        expect(child.exists()).toBe(false);
    });

    test("destroying a GameObject destroys its components", () => {
        const { go, probe } = probed();

        go.destroyImmediate();

        expect(probe.exists()).toBe(false);
    });

    test("an already-disabled component does not fire onDisable again", () => {
        const { go, probe } = probed();
        go.setActive(false);
        probe.log.length = 0;

        go.destroyImmediate();

        expect(probe.log).toEqual(["onDestroy"]);
    });
});
