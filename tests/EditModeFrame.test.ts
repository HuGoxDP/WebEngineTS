import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GameObject } from "../src/engine/core/GameObject";
import { SceneManager } from "../src/engine/core/SceneManager";
import { Application } from "../src/engine/core/Application";
import { ScriptableBehaviour } from "../src/engine/core/ScriptableBehaviour";
import { Time } from "../src/engine/core/Time";
import { Animator } from "../src/engine/core/animation/Animator";
import { ParticleSystem } from "../src/engine/core/particles/ParticleSystem";
import { Rigidbody } from "../src/engine/physics/Rigidbody";
import { Canvas } from "../src/engine/core/ui/Canvas";
import { HorizontalLayoutGroup } from "../src/engine/core/ui/LayoutGroup";
import { LayoutElement } from "../src/engine/core/ui/LayoutElement";
import { RectTransform } from "../src/engine/core/ui/RectTransform";
import { Rect } from "../src/engine/core/math/Rect";
import { Serializable, SerializedField, ExecuteAlways } from "../src/engine/core/reflection/Decorators";
import { Vector3 } from "../src/engine/core/math/Vector3";

/**
 * C2 Phase 4: the edit-mode frame. One call advances the clock, runs only the
 * opted-in scripts and the edit-safe drivers, and refuses to run in play mode.
 */

const clear = (): void => {
    for (const root of [...SceneManager.activeScene.getRootGameObjects()]) root.destroyImmediate();
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    clear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    warn.mockRestore();
    Application.enterPlayMode();
    clear();
});

@Serializable({ typeName: "EditModeFrameSpec.Mover" })
class Mover extends ScriptableBehaviour {
    @SerializedField() public speed = 1;
    public override update(): void {
        this.transform.position = new Vector3(
            this.transform.position.x + this.speed * Time.deltaTime, 0, 0,
        );
    }
}

@Serializable({ typeName: "EditModeFrameSpec.EditorMover" })
@ExecuteAlways()
class EditorMover extends Mover {}

describe("the edit-mode frame", () => {
    test("only an opted-in script moves; animation, particles and physics are untouched", () => {
        Application.enterEditMode();
        const moved = new GameObject("EditorDriven").addComponent(EditorMover);
        const still = new GameObject("Parked").addComponent(Mover);

        const animator = new GameObject("Animated").addComponent(Animator);
        const particles = new GameObject("Particles").addComponent(ParticleSystem);
        const body = new GameObject("Body").addComponent(Rigidbody);
        body.useGravity = true;
        const bodyY = body.transform.position.y;

        for (let i = 0; i < 3; i++) Application.updateEditMode(1 / 60);

        expect(moved.transform.position.x).toBeCloseTo(3 / 60, 10);
        expect(still.transform.position.x).toBe(0);
        expect(Time.time).toBeCloseTo(3 / 60, 10);
        expect(Time.deltaTime).toBeCloseTo(1 / 60, 10);

        expect(animator.exists()).toBe(true);
        expect(particles.exists()).toBe(true);
        expect(body.transform.position.y).toBe(bodyY);
    });

    test("a layout group lays out in one edit frame exactly as in play", () => {
        // The same panel, group and two rows, laid out by the play-mode layout
        // step and by one edit-mode frame; the mode is not part of a layout.
        const layout = (): RectTransform[] => {
            const canvasGO = new GameObject("Canvas");
            const canvas = canvasGO.addComponent(Canvas);
            vi.spyOn(canvas, "width", "get").mockReturnValue(800);
            vi.spyOn(canvas, "height", "get").mockReturnValue(600);

            const panel = new GameObject("Panel");
            panel.transform.setParent(canvasGO.transform, false);
            const prt = panel.addComponent(RectTransform);
            prt.anchorMin.set(0, 0); prt.anchorMax.set(0, 0); prt.pivot.set(0, 0);
            prt.anchoredPosition.set(0, 0); prt.sizeDelta.set(400, 300);

            const group = panel.addComponent(HorizontalLayoutGroup);
            group.spacing = 10;
            group.childForceExpandCross = false;

            const rects: RectTransform[] = [];
            for (const [name, w, h] of [["A", 80, 30], ["B", 120, 40]] as const) {
                const child = new GameObject(name);
                child.transform.setParent(panel.transform, false);
                const rt = child.addComponent(RectTransform);
                rt.sizeDelta.set(w, h);
                const el = child.addComponent(LayoutElement);
                el.preferredWidth = w; el.preferredHeight = h;
                rects.push(rt);
            }
            return rects;
        };

        // Play mode: the layout step the Application loop runs.
        const inPlay = layout();
        HorizontalLayoutGroup._updateAll();
        const playRects = inPlay.map(rt => rt.getScreenRect(new Rect()));
        clear();
        Canvas._reset();

        // Edit mode: the same world through one edit-mode frame.
        Application.enterEditMode();
        const inEdit = layout();
        Application.updateEditMode(1 / 60);
        const editRects = inEdit.map(rt => rt.getScreenRect(new Rect()));

        expect(editRects[0].x).toBeCloseTo(playRects[0].x, 10);
        expect(editRects[0].width).toBeCloseTo(playRects[0].width, 10);
        expect(editRects[1].x).toBeCloseTo(playRects[1].x, 10);
        expect(editRects[1].width).toBeCloseTo(playRects[1].width, 10);
    });

    test("updateEditMode refuses in play mode", () => {
        expect(() => Application.updateEditMode(1 / 60)).toThrow(
            "[Application] updateEditMode() is only valid in edit mode."
        );
    });

    test("a bad delta does not throw, and the clock is clamped", () => {
        Application.enterEditMode();

        Application.updateEditMode(NaN);
        expect(Time.deltaTime).toBe(0);
        expect(Time.time).toBe(0);

        Application.updateEditMode(-5);
        expect(Time.deltaTime).toBe(0);

        Application.updateEditMode(10);
        expect(Time.deltaTime).toBeLessThanOrEqual(0.1);
        expect(Time.time).toBeLessThanOrEqual(0.1);
    });

    test("an editor that has run no frame at all can run one", () => {
        // The frame touches `SceneManager.activeScene`, which lazily creates
        // the default scene — a host that never started a player still has one.
        Application.enterEditMode();
        expect(() => Application.updateEditMode(1 / 60)).not.toThrow();
        expect(Time.time).toBeCloseTo(1 / 60, 10);
        expect(SceneManager.sceneCount).toBeGreaterThanOrEqual(1);
    });
});
