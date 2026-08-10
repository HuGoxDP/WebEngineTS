import { describe, test, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { GameObject } from "../src/engine/core/GameObject";
import { AnimationClip } from "../src/engine/core/animation/AnimationClip";
import { Animation } from "../src/engine/core/animation/Animation";
import {
    Animator, AnimatorConditionMode, AnimatorParameterType, AnimatorTransition,
} from "../src/engine/core/animation/Animator";

/** A real, empty clip — Animation builds a mixer action from every clip. */
function clip(name: string): AnimationClip {
    return new AnimationClip(new THREE.AnimationClip(name, 1, []));
}

/** An Animator with Idle and Walk states, Idle by default. */
function makeAnimator() {
    const go = new GameObject("Actor");
    const animator = go.addComponent(Animator);
    const idle = animator.addState("Idle", clip("Idle"));
    const walk = animator.addState("Walk", clip("Walk"));
    return { go, animator, idle, walk };
}

describe("Animator — states", () => {
    beforeEach(() => {
        Animator._reset();
        Animation._reset();
    });

    test("it is a component, and adds the Animation it plays through", () => {
        const { go, animator } = makeAnimator();

        // Its own docs promised addComponent(Animator); before this it took an
        // Animation in its constructor and could not be one.
        expect(animator).toBeInstanceOf(Animator);
        expect(go.getComponent(Animation)).not.toBeNull();
    });

    test("setting the default state enters it", () => {
        const { animator, idle } = makeAnimator();

        animator.defaultState = idle;

        expect(animator.currentState).toBe(idle);
        expect(animator.currentStateName).toBe("Idle");
    });

    test("play moves to a state directly", () => {
        const { animator, idle, walk } = makeAnimator();
        animator.defaultState = idle;

        animator.play("Walk");

        expect(animator.currentState).toBe(walk);
    });

    test("play on an unknown state does nothing", () => {
        const { animator, idle } = makeAnimator();
        animator.defaultState = idle;

        animator.play("Nope");

        expect(animator.currentState).toBe(idle);
    });
});

describe("Animator — conditions", () => {
    beforeEach(() => {
        Animator._reset();
        Animation._reset();
    });

    test("a numeric comparison drives the transition", () => {
        const { animator, idle, walk } = makeAnimator();
        idle.addTransition(walk, [
            { parameter: "Speed", mode: AnimatorConditionMode.Greater, threshold: 0.1 },
        ]);
        animator.defaultState = idle;

        animator.setFloat("Speed", 0);
        animator.evaluate();
        expect(animator.currentState).toBe(idle);

        animator.setFloat("Speed", 1);
        animator.evaluate();
        expect(animator.currentState).toBe(walk);
    });

    test("every condition must hold", () => {
        const { animator, idle, walk } = makeAnimator();
        idle.addTransition(walk, [
            { parameter: "Speed", mode: AnimatorConditionMode.Greater, threshold: 0.1 },
            { parameter: "Grounded", mode: AnimatorConditionMode.If },
        ]);
        animator.defaultState = idle;

        animator.setFloat("Speed", 1);
        animator.setBool("Grounded", false);
        animator.evaluate();
        expect(animator.currentState).toBe(idle);

        animator.setBool("Grounded", true);
        animator.evaluate();
        expect(animator.currentState).toBe(walk);
    });

    test("an unset parameter fails its condition rather than throwing", () => {
        const { animator, idle, walk } = makeAnimator();
        idle.addTransition(walk, [
            { parameter: "Missing", mode: AnimatorConditionMode.Greater, threshold: 0 },
        ]);
        animator.defaultState = idle;

        animator.evaluate();

        expect(animator.currentState).toBe(idle);
    });

    test("every comparison mode behaves", () => {
        const { walk } = makeAnimator();
        const params = new Map<string, number | boolean>([["N", 5], ["B", false]]);

        const check = (mode: AnimatorConditionMode, parameter: string, threshold?: number) =>
            new AnimatorTransition(walk, null, 0, [{ parameter, mode, threshold }])
                .isSatisfied(params);

        expect(check(AnimatorConditionMode.Greater, "N", 4)).toBe(true);
        expect(check(AnimatorConditionMode.Less, "N", 4)).toBe(false);
        expect(check(AnimatorConditionMode.Equals, "N", 5)).toBe(true);
        expect(check(AnimatorConditionMode.NotEqual, "N", 5)).toBe(false);
        expect(check(AnimatorConditionMode.IfNot, "B")).toBe(true);
        expect(check(AnimatorConditionMode.If, "B")).toBe(false);
    });

    test("an empty condition list fires immediately", () => {
        const { animator, idle, walk } = makeAnimator();
        idle.addTransition(walk);
        animator.defaultState = idle;

        animator.evaluate();

        expect(animator.currentState).toBe(walk);
    });

    test("a predicate transition still works", () => {
        const { animator, idle, walk } = makeAnimator();
        idle.addTransitionWhen(walk, p => (p.get("Speed") as number) > 2);
        animator.defaultState = idle;

        animator.setFloat("Speed", 1);
        animator.evaluate();
        expect(animator.currentState).toBe(idle);

        animator.setFloat("Speed", 3);
        animator.evaluate();
        expect(animator.currentState).toBe(walk);
    });

    test("transitions are evaluated in order and only one fires", () => {
        const { animator, idle, walk } = makeAnimator();
        const run = animator.addState("Run", clip("Run"));
        idle.addTransition(walk);
        idle.addTransition(run);
        animator.defaultState = idle;

        animator.evaluate();

        expect(animator.currentState).toBe(walk);
    });
});

describe("Animator — triggers", () => {
    beforeEach(() => {
        Animator._reset();
        Animation._reset();
    });

    test("a trigger fires its transition exactly once", () => {
        const { animator, idle, walk } = makeAnimator();
        idle.addTransition(walk, [{ parameter: "Jump", mode: AnimatorConditionMode.If }]);
        walk.addTransition(idle, [{ parameter: "Jump", mode: AnimatorConditionMode.If }]);
        animator.defaultState = idle;

        animator.setTrigger("Jump");
        animator.evaluate();
        expect(animator.currentState).toBe(walk);

        // Before this, a trigger stayed true forever and bounced the machine
        // back and forth on every frame that followed.
        animator.evaluate();
        expect(animator.currentState).toBe(walk);
        expect(animator.getParameter("Jump")).toBe(false);
    });

    test("a plain bool is not consumed", () => {
        const { animator, idle, walk } = makeAnimator();
        animator.setParameterType("Grounded", AnimatorParameterType.Bool);
        idle.addTransition(walk, [{ parameter: "Grounded", mode: AnimatorConditionMode.If }]);
        animator.defaultState = idle;

        animator.setBool("Grounded", true);
        animator.evaluate();

        expect(animator.currentState).toBe(walk);
        expect(animator.getParameter("Grounded")).toBe(true);
    });

    test("resetTrigger clears one before it is used", () => {
        const { animator, idle, walk } = makeAnimator();
        idle.addTransition(walk, [{ parameter: "Jump", mode: AnimatorConditionMode.If }]);
        animator.defaultState = idle;

        animator.setTrigger("Jump");
        animator.resetTrigger("Jump");
        animator.evaluate();

        expect(animator.currentState).toBe(idle);
    });

    test("declaring a parameter gives it a starting value", () => {
        const { animator } = makeAnimator();

        animator.setParameterType("Speed", AnimatorParameterType.Float);
        animator.setParameterType("Grounded", AnimatorParameterType.Bool);

        expect(animator.getParameter("Speed")).toBe(0);
        expect(animator.getParameter("Grounded")).toBe(false);
    });

    test("setInt truncates", () => {
        const { animator } = makeAnimator();

        animator.setInt("Phase", 2.7);

        expect(animator.getParameter("Phase")).toBe(2);
    });
});

describe("Animator — driven by the loop", () => {
    beforeEach(() => {
        Animator._reset();
        Animation._reset();
    });

    test("_updateAll evaluates active animators", () => {
        const { animator, idle, walk } = makeAnimator();
        idle.addTransition(walk);
        animator.defaultState = idle;

        Animator._updateAll();

        // A state machine the caller has to remember to tick is one that
        // silently stops working.
        expect(animator.currentState).toBe(walk);
    });

    test("a disabled animator is not evaluated", () => {
        const { animator, idle, walk } = makeAnimator();
        idle.addTransition(walk);
        animator.defaultState = idle;
        animator.enabled = false;

        Animator._updateAll();

        expect(animator.currentState).toBe(idle);
    });

    test("re-enabling enters the default state if nothing is current", () => {
        const { animator, idle } = makeAnimator();
        animator.enabled = false;
        animator.defaultState = idle;
        expect(animator.currentState).toBeNull();

        animator.enabled = true;

        expect(animator.currentState).toBe(idle);
    });
});
