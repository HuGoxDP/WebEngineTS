import { describe, test, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { GameObject } from "../src/engine/core/GameObject";
import { Vector2 } from "../src/engine/core/math/Vector2";
import { AnimationClip } from "../src/engine/core/animation/AnimationClip";
import { Animation } from "../src/engine/core/animation/Animation";
import { Animator, AnimatorConditionMode } from "../src/engine/core/animation/Animator";
import { BlendTree, BlendTreeType } from "../src/engine/core/animation/BlendTree";

function clip(name: string, duration: number = 1): AnimationClip {
    return new AnimationClip(new THREE.AnimationClip(name, duration, []));
}

/** Weights for one parameter value, as a plain object for readable assertions. */
function weightsAt(tree: BlendTree, value: number, y?: number): Record<string, number> {
    const params = new Map<string, number | boolean>([[tree.blendParameter, value]]);
    if (y !== undefined) params.set(tree.blendParameterY, y);

    const out = new Map<string, number>();
    tree.evaluate(params, out);
    return Object.fromEntries(out);
}

describe("BlendTree — 1D", () => {
    let tree: BlendTree;

    beforeEach(() => {
        tree = new BlendTree("Locomotion");
        tree.blendParameter = "Speed";
        tree.addChild(clip("Idle"), 0);
        tree.addChild(clip("Walk"), 2);
        tree.addChild(clip("Run"), 6);
    });

    test("children are kept sorted by threshold", () => {
        const unsorted = new BlendTree("T");
        unsorted.addChild(clip("Run"), 6);
        unsorted.addChild(clip("Idle"), 0);
        unsorted.addChild(clip("Walk"), 2);

        expect(unsorted.children.map(c => c.clip.name)).toEqual(["Idle", "Walk", "Run"]);
    });

    test("below the first threshold the first child takes everything", () => {
        expect(weightsAt(tree, -5)).toEqual({ Idle: 1 });
    });

    test("above the last threshold the last child takes everything", () => {
        expect(weightsAt(tree, 100)).toEqual({ Run: 1 });
    });

    test("between two children the weight splits linearly", () => {
        const w = weightsAt(tree, 1);

        expect(w.Idle).toBeCloseTo(0.5);
        expect(w.Walk).toBeCloseTo(0.5);
        expect(w.Run).toBeUndefined();
    });

    test("only the bracketing pair contributes", () => {
        const w = weightsAt(tree, 5);

        expect(w.Walk).toBeCloseTo(0.25);
        expect(w.Run).toBeCloseTo(0.75);
        expect(w.Idle).toBeUndefined();
    });

    test("landing on a threshold gives that child everything", () => {
        expect(weightsAt(tree, 2)).toEqual({ Walk: 1 });
    });

    test("weights always sum to 1", () => {
        for (const value of [-1, 0, 0.3, 2, 3.7, 6, 9]) {
            const sum = Object.values(weightsAt(tree, value)).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1);
        }
    });

    test("children sharing a threshold split it evenly instead of dividing by zero", () => {
        const tied = new BlendTree("T");
        tied.blendParameter = "Speed";
        tied.addChild(clip("A"), 0);
        tied.addChild(clip("B"), 1);
        tied.addChild(clip("C"), 1);
        tied.addChild(clip("D"), 2);

        const w = weightsAt(tied, 1);

        for (const value of Object.values(w)) expect(Number.isFinite(value)).toBe(true);
        expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    });

    test("an unset parameter reads as zero rather than throwing", () => {
        const out = new Map<string, number>();

        tree.evaluate(new Map(), out);

        expect(Object.fromEntries(out)).toEqual({ Idle: 1 });
    });

    test("a bool parameter reads as 0 or 1", () => {
        const out = new Map<string, number>();

        tree.evaluate(new Map<string, number | boolean>([["Speed", true]]), out);

        expect(out.get("Idle")).toBeCloseTo(0.5);
        expect(out.get("Walk")).toBeCloseTo(0.5);
    });

    test("children sharing a clip name have their weights summed", () => {
        const shared = clip("Same");
        const twice = new BlendTree("T");
        twice.blendParameter = "Speed";
        twice.addChild(shared, 0);
        twice.addChild(shared, 2);

        expect(weightsAt(twice, 1)).toEqual({ Same: 1 });
    });

    test("an empty tree writes nothing", () => {
        const out = new Map<string, number>([["stale", 1]]);

        new BlendTree("Empty").evaluate(new Map(), out);

        expect(out.size).toBe(0);
    });
});

describe("BlendTree — 2D freeform cartesian", () => {
    let tree: BlendTree;

    beforeEach(() => {
        tree = new BlendTree("Strafe", BlendTreeType.FreeformCartesian2D);
        tree.blendParameter = "X";
        tree.blendParameterY = "Y";
        tree.addChild2D(clip("Forward"), new Vector2(0, 1));
        tree.addChild2D(clip("Back"), new Vector2(0, -1));
        tree.addChild2D(clip("Left"), new Vector2(-1, 0));
        tree.addChild2D(clip("Right"), new Vector2(1, 0));
    });

    test("sampling on a child gives it everything", () => {
        expect(weightsAt(tree, 0, 1)).toEqual({ Forward: 1 });
        expect(weightsAt(tree, -1, 0)).toEqual({ Left: 1 });
    });

    test("between two neighbours the weight splits between them", () => {
        const w = weightsAt(tree, 0.5, 0.5);

        expect(w.Forward).toBeCloseTo(0.5);
        expect(w.Right).toBeCloseTo(0.5);
        expect(w.Back).toBeUndefined();
        expect(w.Left).toBeUndefined();
    });

    test("a clip fades out as another child comes between it and the sample", () => {
        // The band tapers to zero *at* the intervening child, not before it:
        // past Forward the back clip is gone, just short of it a sliver remains.
        expect(weightsAt(tree, 0, 1.5).Back).toBeUndefined();
        expect(weightsAt(tree, 0.9, 0.1).Back).toBeUndefined();
        expect(weightsAt(tree, 0, 0.9).Back).toBeLessThan(0.1);
    });

    test("a child with another between it and the sample drops out", () => {
        const line = new BlendTree("Line", BlendTreeType.FreeformCartesian2D);
        line.blendParameter = "X";
        line.blendParameterY = "Y";
        line.addChild2D(clip("Near"), new Vector2(0, 0));
        line.addChild2D(clip("Mid"), new Vector2(1, 0));
        line.addChild2D(clip("Far"), new Vector2(2, 0));

        // Inverse-distance weighting would still give "Near" a share here;
        // gradient bands do not, which is the reason to use them.
        const w = weightsAt(line, 1.5, 0);

        expect(w.Near).toBeUndefined();
        expect(w.Mid).toBeCloseTo(0.5);
        expect(w.Far).toBeCloseTo(0.5);
    });

    test("a single child takes everything wherever it is sampled", () => {
        const one = new BlendTree("One", BlendTreeType.FreeformCartesian2D);
        one.addChild2D(clip("Only"), new Vector2(3, 4));

        expect(weightsAt(one, -10, 10)).toEqual({ Only: 1 });
    });

    test("weights sum to 1 anywhere, including far outside the children", () => {
        for (const [x, y] of [[0, 0], [5, 5], [-4, 0.2], [0.1, -0.1], [100, -100]]) {
            const sum = Object.values(weightsAt(tree, x, y)).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1);
        }
    });

    test("the centre of a symmetric tree splits evenly", () => {
        const w = weightsAt(tree, 0, 0);

        expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
        for (const value of Object.values(w)) expect(value).toBeCloseTo(0.25);
    });
});

describe("Animation — weighted blending", () => {
    /**
     * The per-clip time scale is not public — it is an implementation detail of
     * synchronization — but it is the whole point of `synchronize`, so the test
     * reads it directly.
     */
    function timeScaleOf(animation: Animation, clipName: string): number {
        const actions = (animation as unknown as {
            _actions: Map<string, { timeScale: number }>;
        })._actions;
        return actions.get(clipName)!.timeScale;
    }

    function makeAnimation(): Animation {
        const animation = new GameObject("Actor").addComponent(Animation);
        animation.addClip(clip("Walk", 1));
        animation.addClip(clip("Run", 0.5));
        return animation;
    }

    beforeEach(() => Animation._reset());

    test("two clips play at once, normalized", () => {
        const animation = makeAnimation();

        animation.blend(new Map([["Walk", 1], ["Run", 3]]));

        expect(animation.isBlending).toBe(true);
        expect(animation.getWeight("Walk")).toBeCloseTo(0.25);
        expect(animation.getWeight("Run")).toBeCloseTo(0.75);
    });

    test("re-weighting an active blend does not restart it", () => {
        const animation = makeAnimation();
        animation.blend(new Map([["Walk", 1], ["Run", 1]]));
        const action = (animation as unknown as {
            _actions: Map<string, { time: number }>;
        })._actions.get("Walk")!;
        action.time = 0.4;

        animation.blend(new Map([["Walk", 3], ["Run", 1]]));

        expect(action.time).toBeCloseTo(0.4);
        expect(animation.getWeight("Walk")).toBeCloseTo(0.75);
    });

    test("a clip whose weight drops to zero leaves the blend", () => {
        const animation = makeAnimation();
        animation.blend(new Map([["Walk", 1], ["Run", 1]]));

        animation.blend(new Map([["Walk", 1], ["Run", 0]]));

        expect(animation.getWeight("Run")).toBe(0);
        expect(animation.getWeight("Walk")).toBeCloseTo(1);
    });

    test("clips are time-scaled to a common cycle", () => {
        const animation = makeAnimation();

        // Equal weights on a 1s and a 0.5s clip: one cycle takes 0.75s, so the
        // long clip speeds up and the short one slows down to match.
        animation.blend(new Map([["Walk", 1], ["Run", 1]]));

        expect(timeScaleOf(animation, "Walk")).toBeCloseTo(1 / 0.75);
        expect(timeScaleOf(animation, "Run")).toBeCloseTo(0.5 / 0.75);
    });

    test("synchronization can be turned off", () => {
        const animation = makeAnimation();

        animation.blend(new Map([["Walk", 1], ["Run", 1]]), undefined, 0, false);

        expect(timeScaleOf(animation, "Walk")).toBeCloseTo(1);
        expect(timeScaleOf(animation, "Run")).toBeCloseTo(1);
    });

    test("speed still multiplies the synchronized scales", () => {
        const animation = makeAnimation();
        animation.blend(new Map([["Walk", 1], ["Run", 1]]));

        animation.speed = 2;

        expect(timeScaleOf(animation, "Walk")).toBeCloseTo(2 / 0.75);
    });

    test("an empty or all-zero blend stops blending", () => {
        const animation = makeAnimation();
        animation.blend(new Map([["Walk", 1]]));

        animation.blend(new Map([["Walk", 0]]));

        expect(animation.isBlending).toBe(false);
    });

    test("unknown clips are ignored", () => {
        const animation = makeAnimation();

        animation.blend(new Map([["Walk", 1], ["Nope", 3]]));

        expect(animation.getWeight("Walk")).toBeCloseTo(1);
        expect(animation.getWeight("Nope")).toBe(0);
    });

    test("play ends the blend", () => {
        const animation = makeAnimation();
        animation.blend(new Map([["Walk", 1], ["Run", 1]]));

        animation.play("Walk");

        expect(animation.isBlending).toBe(false);
        expect(animation.getWeight("Run")).toBe(0);
        expect(animation.currentClipName).toBe("Walk");
        expect(timeScaleOf(animation, "Walk")).toBeCloseTo(1);
    });

    test("stop ends the blend", () => {
        const animation = makeAnimation();
        animation.blend(new Map([["Walk", 1], ["Run", 1]]));

        animation.stop();

        expect(animation.isBlending).toBe(false);
    });

    test("the dominant clip is the reported current one", () => {
        const animation = makeAnimation();

        animation.blend(new Map([["Walk", 1], ["Run", 4]]));

        expect(animation.currentClipName).toBe("Run");
    });
});

describe("Animator — blend tree states", () => {
    function makeTree(): BlendTree {
        const tree = new BlendTree("Locomotion");
        tree.blendParameter = "Speed";
        tree.addChild(clip("Idle", 1), 0);
        tree.addChild(clip("Walk", 1), 2);
        tree.addChild(clip("Run", 1), 6);
        return tree;
    }

    beforeEach(() => {
        Animator._reset();
        Animation._reset();
    });

    test("a state can play a tree, and registers all of its clips", () => {
        const go = new GameObject("Actor");
        const animator = go.addComponent(Animator);

        const state = animator.addState("Locomotion", makeTree());

        expect(state.clip).toBeNull();
        expect(state.blendTree).not.toBeNull();
        expect(go.getComponent(Animation)!.clipCount).toBe(3);
    });

    test("entering the state blends from the current parameters", () => {
        const go = new GameObject("Actor");
        const animator = go.addComponent(Animator);
        const state = animator.addState("Locomotion", makeTree());
        const animation = go.getComponent(Animation)!;

        animator.setFloat("Speed", 1);
        animator.defaultState = state;

        expect(animation.isBlending).toBe(true);
        expect(animation.getWeight("Idle")).toBeCloseTo(0.5);
        expect(animation.getWeight("Walk")).toBeCloseTo(0.5);
    });

    test("the blend follows the parameter while the state is held", () => {
        const go = new GameObject("Actor");
        const animator = go.addComponent(Animator);
        animator.defaultState = animator.addState("Locomotion", makeTree());
        const animation = go.getComponent(Animation)!;

        animator.setFloat("Speed", 6);
        Animator._updateAll();

        expect(animation.getWeight("Run")).toBeCloseTo(1);
        expect(animation.getWeight("Idle")).toBe(0);
    });

    test("a transition out of a blend-tree state still works", () => {
        const go = new GameObject("Actor");
        const animator = go.addComponent(Animator);
        const locomotion = animator.addState("Locomotion", makeTree());
        const jump = animator.addState("Jump", clip("Jump"));
        locomotion.addTransition(jump, [
            { parameter: "Jump", mode: AnimatorConditionMode.If },
        ]);
        animator.defaultState = locomotion;
        const animation = go.getComponent(Animation)!;

        animator.setTrigger("Jump");
        Animator._updateAll();

        expect(animator.currentState).toBe(jump);
        expect(animation.isBlending).toBe(false);
        expect(animation.currentClipName).toBe("Jump");
    });

    test("a transition into a blend-tree state starts the blend", () => {
        const go = new GameObject("Actor");
        const animator = go.addComponent(Animator);
        const idle = animator.addState("Idle", clip("Idle"));
        const locomotion = animator.addState("Locomotion", makeTree());
        idle.addTransition(locomotion, [
            { parameter: "Speed", mode: AnimatorConditionMode.Greater, threshold: 0.1 },
        ]);
        animator.defaultState = idle;
        const animation = go.getComponent(Animation)!;

        animator.setFloat("Speed", 4);
        Animator._updateAll();

        expect(animator.currentState).toBe(locomotion);
        expect(animation.isBlending).toBe(true);
        expect(animation.getWeight("Walk")).toBeCloseTo(0.5);
        expect(animation.getWeight("Run")).toBeCloseTo(0.5);
    });
});
