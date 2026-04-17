import { describe, test, expect } from "vitest";
import * as THREE from "three";
import { AnimationClip } from "../src/engine/core/animation/AnimationClip";
import { AnimationWrapMode } from "../src/engine/core/animation/Animation";
import { Animator, AnimatorState, AnimatorTransition } from "../src/engine/core/animation/Animator";

describe("AnimationClip", () => {
    test("wraps THREE.AnimationClip properties", () => {
        const track = new THREE.NumberKeyframeTrack(".position[0]", [0, 1], [0, 10]);
        const threeClip = new THREE.AnimationClip("Walk", 2.5, [track]);

        const clip = new AnimationClip(threeClip);

        expect(clip.name).toBe("Walk");
        expect(clip.duration).toBeCloseTo(2.5);
        expect(clip.trackCount).toBe(1);
    });

    test("preserves the underlying THREE clip reference", () => {
        const threeClip = new THREE.AnimationClip("Idle", 1, []);
        const clip = new AnimationClip(threeClip);

        expect(clip._threeClip).toBe(threeClip);
    });
});

describe("AnimationWrapMode", () => {
    test("maps to THREE loop constants", () => {
        expect(AnimationWrapMode.Once).toBe(THREE.LoopOnce);
        expect(AnimationWrapMode.Loop).toBe(THREE.LoopRepeat);
        expect(AnimationWrapMode.PingPong).toBe(THREE.LoopPingPong);
    });

    test("enum values are distinct", () => {
        const values = new Set([
            AnimationWrapMode.Once,
            AnimationWrapMode.Loop,
            AnimationWrapMode.PingPong,
        ]);
        expect(values.size).toBe(3);
    });
});

describe("AnimatorState", () => {
    function makeClip(name: string): AnimationClip {
        return new AnimationClip(new THREE.AnimationClip(name, 1, []));
    }

    test("stores name and clip", () => {
        const clip = makeClip("Walk");
        const state = new AnimatorState("Walking", clip);

        expect(state.name).toBe("Walking");
        expect(state.clip).toBe(clip);
        expect(state.speed).toBe(1);
        expect(state.wrapMode).toBe(AnimationWrapMode.Loop);
    });

    test("addTransition creates transition with condition", () => {
        const idleClip = makeClip("Idle");
        const walkClip = makeClip("Walk");
        const idle = new AnimatorState("Idle", idleClip);
        const walk = new AnimatorState("Walk", walkClip);

        const transition = idle.addTransition(
            walk,
            (p) => (p.get("Speed") as number) > 0.1,
            0.3
        );

        expect(idle.transitions.length).toBe(1);
        expect(transition.target).toBe(walk);
        expect(transition.duration).toBe(0.3);
    });

    test("transition condition evaluates correctly", () => {
        const idleClip = makeClip("Idle");
        const walkClip = makeClip("Walk");
        const idle = new AnimatorState("Idle", idleClip);
        const walk = new AnimatorState("Walk", walkClip);

        idle.addTransition(
            walk,
            (p) => (p.get("Speed") as number) > 0.5
        );

        const params = new Map<string, number | boolean>();
        params.set("Speed", 0.2);
        expect(idle.transitions[0].condition(params)).toBe(false);

        params.set("Speed", 0.8);
        expect(idle.transitions[0].condition(params)).toBe(true);
    });
});

describe("AnimatorTransition", () => {
    test("stores target, condition, and duration", () => {
        const clip = new AnimationClip(new THREE.AnimationClip("A", 1, []));
        const target = new AnimatorState("Target", clip);
        const cond = () => true;

        const t = new AnimatorTransition(target, cond, 0.5);

        expect(t.target).toBe(target);
        expect(t.condition).toBe(cond);
        expect(t.duration).toBe(0.5);
    });
});
