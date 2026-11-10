import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Canvas } from "../src/engine/core/ui/Canvas";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { UIImage } from "../src/engine/core/ui/UIImage";

/**
 * M0.2e: moving an object to another parent can change whether it is active
 * in the hierarchy without anyone calling `setActive`. Unity treats that
 * change exactly like a `SetActive` on an ancestor: moved under an inactive
 * parent, every enabled behaviour of the subtree gets `OnDisable`; moved out
 * from under one, every script that never woke gets `Awake`, and every enabled
 * behaviour `OnEnable`. Before the fix `Transform.setParent` changed the
 * answer of `activeInHierarchy` and fired nothing.
 */

/** Every hook this file looks at, written to one shared log as `name.hook`. */
const log: string[] = [];

class Probe extends ScriptableBehaviour {
    public override awake(): void { log.push(`${this.gameObject.name}.awake`); }
    public override onEnable(): void { log.push(`${this.gameObject.name}.onEnable`); }
    public override onDisable(): void { log.push(`${this.gameObject.name}.onDisable`); }
    public override start(): void { log.push(`${this.gameObject.name}.start`); }
    public override update(): void { log.push(`${this.gameObject.name}.update`); }
}

/** A GameObject named `name` under `parent` (a root when `null`). */
function make(name: string, parent: GameObject | null = null): GameObject {
    const go = new GameObject(name);
    if (parent) go.transform.setParent(parent.transform);
    return go;
}

function probed(name: string, parent: GameObject | null = null): GameObject {
    const go = make(name, parent);
    go.addComponent(Probe);
    return go;
}

function inactive(name: string, parent: GameObject | null = null): GameObject {
    const go = make(name, parent);
    go.setActive(false);
    return go;
}

function clear(): void {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
    log.length = 0;
}

beforeEach(clear);
afterEach(() => {
    clear();
    vi.restoreAllMocks();
});

describe("moved under an inactive parent", () => {
    test("an active object gets onDisable", () => {
        const p = inactive("P");
        const c = probed("C");
        log.length = 0;

        c.transform.setParent(p.transform);

        expect(c.activeInHierarchy).toBe(false);
        expect(log).toEqual(["C.onDisable"]);
    });

    test("the whole subtree is disabled, parents before children", () => {
        const p = inactive("P");
        const c = probed("C");
        const d = probed("D", c);
        probed("E", d);
        probed("F", c);
        log.length = 0;

        c.transform.setParent(p.transform);

        expect(log).toEqual(["C.onDisable", "D.onDisable", "E.onDisable", "F.onDisable"]);
    });

    test("under an active parent whose own ancestor is inactive", () => {
        const top = inactive("Top");
        const mid = make("Mid", top);
        const c = probed("C");
        log.length = 0;

        c.transform.setParent(mid.transform);

        expect(log).toEqual(["C.onDisable"]);
    });

    test("each entry point does it: parent setter, worldPositionStays false", () => {
        const p = inactive("P");
        const a = probed("A");
        const b = probed("B");
        log.length = 0;

        a.transform.parent = p.transform;
        b.transform.setParent(p.transform, false);

        expect(log).toEqual(["A.onDisable", "B.onDisable"]);
    });

    test("a disabled script and an inactive child get nothing", () => {
        const p = inactive("P");
        const c = probed("C");
        const off = probed("Off", c);
        off.getComponent(Probe)!.enabled = false;
        const hidden = probed("Hidden", c);
        hidden.setActive(false);
        log.length = 0;

        c.transform.setParent(p.transform);

        expect(log).toEqual(["C.onDisable"]);
    });

    test("an object inactive on its own gets nothing", () => {
        const p = inactive("P");
        const c = probed("C");
        c.setActive(false);
        log.length = 0;

        c.transform.setParent(p.transform);

        expect(log).toEqual([]);
    });

    test("onDisable already sees the new parent", () => {
        const p = inactive("P");
        const c = make("C");
        const seen: (string | undefined)[] = [];
        class Watcher extends ScriptableBehaviour {
            public override onDisable(): void {
                seen.push(this.transform.parent?.gameObject.name);
                seen.push(String(this.gameObject.activeInHierarchy));
            }
        }
        c.addComponent(Watcher);

        c.transform.setParent(p.transform);

        expect(seen).toEqual(["P", "false"]);
    });

    test("reactivating the new parent enables it again, once", () => {
        const p = inactive("P");
        const c = probed("C");
        c.transform.setParent(p.transform);
        log.length = 0;

        p.setActive(true);

        expect(log).toEqual(["C.onEnable"]);
    });
});

describe("moved out from under an inactive parent", () => {
    test("a script that woke before gets onEnable only", () => {
        const p = inactive("P");
        const c = probed("C");
        c.transform.setParent(p.transform);
        log.length = 0;

        c.transform.setParent(null);

        expect(c.activeInHierarchy).toBe(true);
        expect(log).toEqual(["C.onEnable"]);
    });

    test("a script that never woke gets awake, then onEnable", () => {
        const p = inactive("P");
        const q = make("Q");
        const d = probed("D", p);
        expect(log).toEqual([]);

        d.transform.setParent(q.transform);

        expect(log).toEqual(["D.awake", "D.onEnable"]);
    });

    test("a never-woken subtree wakes whole, each object awake then onEnable, parents first", () => {
        const p = inactive("P");
        const q = make("Q");
        const d = probed("D", p);
        const e = probed("E", d);
        probed("F", e);
        probed("G", d);
        expect(log).toEqual([]);

        d.transform.setParent(q.transform);

        expect(log).toEqual([
            "D.awake", "D.onEnable",
            "E.awake", "E.onEnable",
            "F.awake", "F.onEnable",
            "G.awake", "G.onEnable",
        ]);
    });

    test("every script of an object wakes before any of them is enabled", () => {
        const p = inactive("P");
        const d = make("D", p);
        d.addComponent(Probe);
        d.addComponent(Probe);

        d.transform.setParent(null);

        expect(log).toEqual(["D.awake", "D.awake", "D.onEnable", "D.onEnable"]);
    });

    test("a disabled script wakes but is not enabled", () => {
        const p = inactive("P");
        const d = probed("D", p);
        d.getComponent(Probe)!.enabled = false;

        d.transform.setParent(null);

        expect(log).toEqual(["D.awake"]);
    });

    test("a child inactive on its own stays asleep", () => {
        const p = inactive("P");
        const d = probed("D", p);
        const hidden = probed("Hidden", d);
        hidden.setActive(false);

        d.transform.setParent(null);

        expect(log).toEqual(["D.awake", "D.onEnable"]);
        log.length = 0;

        hidden.setActive(true);
        expect(log).toEqual(["Hidden.awake", "Hidden.onEnable"]);
    });

    test("out of one inactive parent into another, or below one, fires nothing", () => {
        const p1 = inactive("P1");
        const p2 = inactive("P2");
        const top = inactive("Top");
        const mid = make("Mid", top);
        const d = probed("D", p1);

        d.transform.setParent(p2.transform);
        d.transform.setParent(mid.transform);

        expect(log).toEqual([]);
        expect(d.activeInHierarchy).toBe(false);
    });

    test("out from under a nested inactive ancestor", () => {
        const top = inactive("Top");
        const mid = make("Mid", top);
        const d = probed("D", mid);

        d.transform.setParent(top.transform.parent);

        expect(log).toEqual(["D.awake", "D.onEnable"]);
    });

    test("detachChildren of an inactive parent wakes every child", () => {
        const p = inactive("P");
        probed("A", p);
        probed("B", p);

        p.transform.detachChildren();

        // detachChildren walks from the last child back.
        expect(log).toEqual(["B.awake", "B.onEnable", "A.awake", "A.onEnable"]);
    });

    test("awake and onEnable already see the new parent", () => {
        const p = inactive("P");
        const q = make("Q");
        const d = make("D", p);
        const seen: string[] = [];
        class Watcher extends ScriptableBehaviour {
            public override awake(): void { seen.push(`awake ${this.transform.parent?.gameObject.name}`); }
            public override onEnable(): void { seen.push(`onEnable ${this.transform.parent?.gameObject.name}`); }
        }
        d.addComponent(Watcher);

        d.transform.setParent(q.transform);

        expect(seen).toEqual(["awake Q", "onEnable Q"]);
    });

    test("there and back again: disable, enable, never a second awake", () => {
        const p = inactive("P");
        const c = probed("C");
        log.length = 0;

        c.transform.setParent(p.transform);
        c.transform.setParent(null);
        c.transform.setParent(p.transform);
        c.transform.setParent(null);

        expect(log).toEqual(["C.onDisable", "C.onEnable", "C.onDisable", "C.onEnable"]);
    });
});

describe("moves that do not change activity", () => {
    test("between active parents, and reordering siblings, fire nothing", () => {
        const a = make("A");
        const b = make("B");
        const c = probed("C", a);
        probed("D", b);
        log.length = 0;

        c.transform.setParent(b.transform);
        c.transform.setSiblingIndex(0);
        c.transform.setAsLastSibling();
        b.transform.detachChildren();

        expect(log).toEqual([]);
    });
});

describe("a callback that moves the object again", () => {
    test("onDisable moving itself back out ends enabled, with balanced calls", () => {
        const p = inactive("P");
        const c = make("C");
        const seen: string[] = [];
        class Escaper extends ScriptableBehaviour {
            public override onEnable(): void { seen.push("onEnable"); }
            public override onDisable(): void {
                seen.push("onDisable");
                this.transform.setParent(null);
            }
        }
        c.addComponent(Escaper);
        seen.length = 0;

        c.transform.setParent(p.transform);

        expect(c.transform.parent).toBe(null);
        expect(c.activeInHierarchy).toBe(true);
        expect(seen).toEqual(["onDisable", "onEnable"]);
        expect(c.getComponent(Escaper)!.isActiveAndEnabled).toBe(true);
    });

    test("awake moving a child under an inactive object does not leave it enabled", () => {
        const p = inactive("P");
        const sink = inactive("Sink");
        const d = make("D", p);
        const e = probed("E", d);
        class Mover extends ScriptableBehaviour {
            public override awake(): void { e.transform.setParent(sink.transform); }
        }
        d.addComponent(Mover);

        d.transform.setParent(null);

        expect(e.activeInHierarchy).toBe(false);
        expect(log).toEqual([]);
        expect(e.getComponent(Probe)!.isActiveAndEnabled).toBe(false);
    });
});

describe("UI registration follows the move", () => {
    function canvas(name: string): { go: GameObject; canvas: Canvas } {
        const go = make(name);
        const c = go.addComponent(Canvas);
        vi.spyOn(c, "width", "get").mockReturnValue(800);
        vi.spyOn(c, "height", "get").mockReturnValue(600);
        return { go, canvas: c };
    }

    function image(name: string, parent: GameObject): UIImage {
        const go = make(name, parent);
        go.addComponent(RectTransform);
        return go.addComponent(UIImage);
    }

    test("a graphic moved under an inactive panel leaves its canvas, and rejoins on the way out", () => {
        const { go: canvasGO, canvas: c } = canvas("Canvas");
        const panel = inactive("Panel", canvasGO);
        panel.addComponent(RectTransform);
        const img = image("Img", canvasGO);
        expect(c._graphicList).toContain(img);

        img.transform.setParent(panel.transform);
        expect(c._graphicList).not.toContain(img);

        img.transform.setParent(canvasGO.transform);
        expect(c._graphicList).toContain(img);
    });

    test("a graphic built under an inactive panel joins the canvas it is moved into", () => {
        const { go: canvasGO, canvas: c } = canvas("Canvas");
        const hidden = inactive("Hidden");
        const img = image("Img", hidden);
        expect(c._graphicList).not.toContain(img);

        img.transform.setParent(canvasGO.transform);

        expect(c._graphicList).toContain(img);
    });

    test("a canvas moved under an inactive object stops being drawn, and comes back", () => {
        const { go: canvasGO, canvas: c } = canvas("Canvas");
        const holder = inactive("Holder");
        expect(Canvas._sortedInstances()).toContain(c);

        canvasGO.transform.setParent(holder.transform);
        expect(Canvas._sortedInstances()).not.toContain(c);

        canvasGO.transform.setParent(null);
        expect(Canvas._sortedInstances()).toContain(c);
    });
});

describe("activated by a move during an update pass", () => {
    /**
     * Decision (M0.2e): an object activated by a move behaves exactly as one
     * activated by `setActive(true)` at the same point of the pass. Its
     * `awake`/`onEnable` run at once; its `start`/`update` run in this pass
     * only if the walk still reaches its new place, and otherwise next pass.
     * The M0.3d catch-up is for objects that were active, and so owed a run,
     * when they moved — not for objects the move itself turned on. Unity's
     * behaviour manager is understood to give the same "next pass" answer for
     * a behaviour enabled mid-pass (added to a pending list merged when the
     * next pass begins); not checked against a Unity runtime — see
     * `.claude-shared/code-foundations/M0.2e/notes.md`.
     */
    function frame(): void { SceneManager.activeScene._update(); }

    test("moved under an already-walked root: awake and onEnable at once, start and update next pass", () => {
        const a = make("A");
        const mover = make("Mover");
        const p = inactive("P");
        const d = probed("D", p);
        class Move extends ScriptableBehaviour {
            public override update(): void {
                if (d.transform.parent === p.transform) d.transform.setParent(a.transform);
            }
        }
        mover.addComponent(Move);

        frame();
        expect(log).toEqual(["D.awake", "D.onEnable"]);

        log.length = 0;
        frame();
        expect(log).toEqual(["D.start", "D.update"]);

        log.length = 0;
        frame();
        expect(log).toEqual(["D.update"]);
    });

    test("moved under a root still ahead: runs once in that pass", () => {
        const mover = make("Mover");
        const z = make("Z");
        const p = inactive("P");
        const d = probed("D", p);
        class Move extends ScriptableBehaviour {
            public override update(): void {
                if (d.transform.parent === p.transform) d.transform.setParent(z.transform);
            }
        }
        mover.addComponent(Move);

        frame();
        expect(log).toEqual(["D.awake", "D.onEnable", "D.start", "D.update"]);
    });

    test("same as setActive(true) at the same point, over two passes", () => {
        const a = make("A");
        const mover = make("Mover");
        const d = probed("D", a);
        d.setActive(false);
        class Activate extends ScriptableBehaviour {
            public override update(): void { if (!d.activeSelf) d.setActive(true); }
        }
        mover.addComponent(Activate);
        // `a` was walked before Mover ran; D, activated in place, is a child
        // of an already-walked root just like the moved case above.
        log.length = 0;

        frame();
        frame();
        const viaSetActive = [...log];

        clear();
        const a2 = make("A");
        const mover2 = make("Mover");
        const p2 = inactive("P");
        const d2 = probed("D", p2);
        class Move extends ScriptableBehaviour {
            public override update(): void {
                if (d2.transform.parent === p2.transform) d2.transform.setParent(a2.transform);
            }
        }
        mover2.addComponent(Move);

        frame();
        frame();
        // The setActive case woke D before the frame (it was active when its
        // script was added), so compare from onEnable on.
        expect(log.filter(l => l !== "D.awake")).toEqual(
            viaSetActive.filter(l => l !== "D.awake"),
        );
    });

    test("moved under an inactive parent mid-pass: onDisable, no update", () => {
        const mover = make("Mover");
        const d = probed("D");
        const p = inactive("P");
        frame();
        log.length = 0;
        class Move extends ScriptableBehaviour {
            public override update(): void {
                if (d.transform.parent === null) d.transform.setParent(p.transform);
            }
        }
        mover.addComponent(Move);
        mover.transform.setSiblingIndex(0);

        frame();

        expect(log).toEqual(["D.onDisable"]);
    });
});
