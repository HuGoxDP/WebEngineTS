import { UIBehaviour } from "./UIBehaviour";
import { Vector2 } from "../math/Vector2";
import { Mathf } from "../math/Mathf";
import { Time } from "../Time";
import { Input } from "../Input";
import { UIEvent } from "./UIEvent";
import { EventSystem } from "./EventSystem";
import type { RectTransform } from "./RectTransform";
import type { PointerEventData } from "./PointerEventData";
import type { Rect } from "../math/Rect";
import type { GameObject } from "../GameObject";

/** What happens when content is dragged past its ends. */
export enum ScrollMovementType {
    /** No limits at all. */
    Unrestricted = "Unrestricted",
    /** Overshoot is allowed but springs back when released. */
    Elastic = "Elastic",
    /** Content stops dead at its ends. */
    Clamped = "Clamped",
}

/**
 * A window onto content larger than itself, movable by dragging or the wheel.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.ScrollRect`. Pair it with a
 * {@link RectMask2D} so the content is actually clipped to the window —
 * the ScrollRect moves content, the mask hides what leaves.
 *
 * **Content anchoring is driven**, exactly as a layout group drives its
 * children: the content's anchors and pivot are forced to the top-left corner
 * so `anchoredPosition` means "how far the content has been pushed". Give the
 * content an explicit size, or a {@link ContentSizeFitter}, rather than
 * stretching it.
 *
 * **Y-down:** {@link verticalNormalizedPosition} is `0` at the *top* of the
 * content and `1` at the bottom, which reads naturally here and is the inverse
 * of Unity.
 *
 * ```ts
 * const scroll = viewGO.addComponent(ScrollRect);
 * viewGO.addComponent(RectMask2D);
 * scroll.content = listGO.getComponent(RectTransform);
 * scroll.horizontal = false;
 * ```
 */
export class ScrollRect extends UIBehaviour {

    private static _instances: ScrollRect[] = [];

    /**
     * @internal
     * Advances inertia and elastic spring-back for every active scroll view.
     * Called from Application._loop after layout and before the input pass.
     */
    public static _updateAll(): void {
        const views = ScrollRect._instances;
        for (let i = 0; i < views.length; i++) {
            const v = views[i];
            if (v.isActiveAndEnabled) v._tick();
        }
    }

    /** @internal */
    public static _reset(): void {
        ScrollRect._instances.length = 0;
    }

    /** The RectTransform being moved. Nothing scrolls until this is set. */
    public content: RectTransform | null = null;

    /** Whether the content may move along X. */
    public horizontal: boolean = true;

    /** Whether the content may move along Y. */
    public vertical: boolean = true;

    /** How the content behaves at its ends. */
    public movementType: ScrollMovementType = ScrollMovementType.Elastic;

    /** Seconds the elastic spring takes to pull most of the way back. */
    public elasticity: number = 0.1;

    /** Whether the content keeps moving after the drag ends. */
    public inertia: boolean = true;

    /** Fraction of velocity retained per second while coasting. */
    public decelerationRate: number = 0.135;

    /** Canvas units moved per unit of wheel delta. */
    public scrollSensitivity: number = 30;

    /** Fired with the normalized position whenever the content moves. */
    public readonly onValueChanged: UIEvent<Vector2> = new UIEvent<Vector2>();

    private readonly _velocity: Vector2 = new Vector2();
    private readonly _lastReported: Vector2 = new Vector2(-1, -1);
    private readonly _dragStart: Vector2 = new Vector2();
    private readonly _dragOrigin: Vector2 = new Vector2();
    private readonly _scratch: Vector2 = new Vector2();
    private _dragging: boolean = false;

    constructor(gameObject: GameObject) {
        super(gameObject);

        this.onBeginDrag.addListener(e => this._beginDrag(e));
        this.onDrag.addListener(e => this._drag(e));
        this.onEndDrag.addListener(() => { this._dragging = false; });
    }

    /** Current coasting speed in canvas units per second. */
    public get velocity(): Vector2 { return this._velocity; }

    /**
     * Scroll position on both axes, `0`–`1`.
     *
     * @remarks
     * `0` is the start of the content — its left edge, and its **top** edge,
     * inverting Unity's vertical convention. Returns `0` on an axis with
     * nothing to scroll.
     *
     * WARNING: allocates. Use {@link getNormalizedPosition} in hot paths.
     */
    public get normalizedPosition(): Vector2 {
        return this.getNormalizedPosition(new Vector2());
    }

    public set normalizedPosition(value: Vector2) {
        this.horizontalNormalizedPosition = value.x;
        this.verticalNormalizedPosition = value.y;
    }

    /** Writes {@link normalizedPosition} into `out` without allocating. */
    public getNormalizedPosition(out: Vector2): Vector2 {
        return out.set(
            this._normalized(false),
            this._normalized(true),
        );
    }

    /** Horizontal scroll position, `0` at the left edge of the content. */
    public get horizontalNormalizedPosition(): number { return this._normalized(false); }

    public set horizontalNormalizedPosition(t: number) { this._setNormalized(false, t); }

    /** Vertical scroll position, `0` at the **top** edge of the content. */
    public get verticalNormalizedPosition(): number { return this._normalized(true); }

    public set verticalNormalizedPosition(t: number) { this._setNormalized(true, t); }

    /** Whether the content is currently being dragged. */
    public get isDragging(): boolean { return this._dragging; }

    /**
     * How far the content can travel on each axis, in canvas units.
     *
     * @param out - vector to receive the result.
     * @returns `out` for chaining.
     */
    public getScrollableSize(out: Vector2): Vector2 {
        const content = this.content;
        if (!content) return out.set(0, 0);

        const view = this.rectTransform._resolvedLocalRect;
        const inner = content._resolvedLocalRect;
        return out.set(
            Math.max(0, inner.width - view.width),
            Math.max(0, inner.height - view.height),
        );
    }

    /** Stops any coasting immediately. */
    public stopMovement(): void {
        this._velocity.set(0, 0);
    }

    protected override onEnable(): void {
        super.onEnable();
        if (!ScrollRect._instances.includes(this)) ScrollRect._instances.push(this);
    }

    protected override onDisable(): void {
        super.onDisable();
        const idx = ScrollRect._instances.indexOf(this);
        if (idx >= 0) ScrollRect._instances.splice(idx, 1);
        this._dragging = false;
        this._velocity.set(0, 0);
    }

    protected override onDestroy(): void {
        super.onDestroy();
        const idx = ScrollRect._instances.indexOf(this);
        if (idx >= 0) ScrollRect._instances.splice(idx, 1);
    }

    /**
     * @internal
     * A scroll view is a window, not a picture: it draws nothing of its own but
     * must still be hit-testable so drags land on it.
     */
    public override _draw(_ctx: CanvasRenderingContext2D, _rect: Rect): void {
        // Intentionally empty — the viewport is defined by its RectTransform and
        // painted, if at all, by a UIImage on the same GameObject.
    }

    public override _visualHash(): number {
        return 0;
    }

    // ── private ──────────────────────────────────────────────────────

    /** Per-frame wheel input, inertia and spring-back. */
    private _tick(): void {
        const content = this.content;
        if (!content) return;

        ScrollRect._pinContentAnchors(content);

        const dt = Time.deltaTime;
        if (dt <= 0) return;

        this._applyWheel();

        if (this._dragging) {
            this._reportIfMoved();
            return;
        }

        if (this.inertia) this._applyInertia(dt);
        if (this.movementType === ScrollMovementType.Elastic) this._applyElastic(dt);
        else if (this.movementType === ScrollMovementType.Clamped) this._clampNow();

        this._reportIfMoved();
    }

    /** Moves the content by the wheel when the pointer is over this view. */
    private _applyWheel(): void {
        const scroll = Input.mouseScrollDelta;
        if (scroll.y === 0 && scroll.x === 0) return;

        const point = EventSystem.getPointerPosition(this._scratch);
        if (!this.rectTransform.canvasToLocalPoint(point.x, point.y, this._scratch)) return;

        const local = this.rectTransform._resolvedLocalRect;
        const inside = this._scratch.x >= local.x && this._scratch.x <= local.x + local.width
            && this._scratch.y >= local.y && this._scratch.y <= local.y + local.height;
        if (!inside) return;

        // A wheel notch scrolls the axis that can actually move, so a vertical
        // list still responds on a device that only reports horizontal deltas.
        const amount = (scroll.y !== 0 ? scroll.y : scroll.x) * this.scrollSensitivity;
        if (this.vertical) this._move(0, -amount);
        else if (this.horizontal) this._move(-amount, 0);

        this._velocity.set(0, 0);
        if (this.movementType !== ScrollMovementType.Unrestricted) this._clampNow();
    }

    private _beginDrag(e: PointerEventData): void {
        const content = this.content;
        if (!content) return;

        this._dragging = true;
        this._velocity.set(0, 0);
        this._dragStart.copy(e.position);
        this._dragOrigin.set(content.anchoredPosition.x, content.anchoredPosition.y);
    }

    private _drag(e: PointerEventData): void {
        const content = this.content;
        if (!content || !this._dragging) return;

        // Measured from where the drag began rather than accumulated per frame,
        // so a dropped frame cannot make the content lag behind the finger.
        let dx = this.horizontal ? e.position.x - this._dragStart.x : 0;
        let dy = this.vertical ? e.position.y - this._dragStart.y : 0;

        if (this.movementType === ScrollMovementType.Elastic) {
            dx = this._rubberBand(this._dragOrigin.x + dx, false) - this._dragOrigin.x;
            dy = this._rubberBand(this._dragOrigin.y + dy, true) - this._dragOrigin.y;
        }

        const before = content.anchoredPosition.y;
        content.anchoredPosition.set(this._dragOrigin.x + dx, this._dragOrigin.y + dy);

        if (this.movementType === ScrollMovementType.Clamped) this._clampNow();

        const dt = Time.deltaTime;
        if (dt > 0) {
            this._velocity.set(
                e.delta.x / dt,
                (content.anchoredPosition.y - before) / dt,
            );
        }

        // The view owns this gesture; an outer scroll view must not pan too.
        e.consumed = true;
        this._reportIfMoved();
    }

    private _applyInertia(dt: number): void {
        const decay = Math.pow(this.decelerationRate, dt);

        this._velocity.set(this._velocity.x * decay, this._velocity.y * decay);
        if (Math.abs(this._velocity.x) < 1 && Math.abs(this._velocity.y) < 1) {
            this._velocity.set(0, 0);
            return;
        }

        this._move(this._velocity.x * dt, this._velocity.y * dt);
        if (this.movementType === ScrollMovementType.Unrestricted) return;

        const content = this.content!;
        const pos = content.anchoredPosition;
        const cx = this._clampAxis(pos.x, false);
        const cy = this._clampAxis(pos.y, true);

        // Running into an end kills the coast on that axis. Without this the
        // view keeps a phantom velocity for seconds after it visibly stopped,
        // and an elastic one would fight its own spring.
        if (cx !== pos.x) this._velocity.x = 0;
        if (cy !== pos.y) this._velocity.y = 0;

        if (this.movementType === ScrollMovementType.Clamped) {
            content.anchoredPosition.set(cx, cy);
        }
    }

    /** Pulls the content back inside its bounds after an overshoot. */
    private _applyElastic(dt: number): void {
        const content = this.content!;
        const pos = content.anchoredPosition;

        const targetX = this._clampAxis(pos.x, false);
        const targetY = this._clampAxis(pos.y, true);
        if (targetX === pos.x && targetY === pos.y) return;

        // Exponential approach: framerate-independent and never overshoots.
        const t = this.elasticity <= 0 ? 1 : 1 - Math.exp(-dt / this.elasticity);
        const nx = Mathf.lerp(pos.x, targetX, t);
        const ny = Mathf.lerp(pos.y, targetY, t);

        content.anchoredPosition.set(
            Math.abs(nx - targetX) < 0.05 ? targetX : nx,
            Math.abs(ny - targetY) < 0.05 ? targetY : ny,
        );
        this._velocity.set(0, 0);
    }

    private _clampNow(): void {
        const content = this.content!;
        const pos = content.anchoredPosition;
        content.anchoredPosition.set(
            this._clampAxis(pos.x, false),
            this._clampAxis(pos.y, true),
        );
    }

    private _move(dx: number, dy: number): void {
        const content = this.content!;
        content.anchoredPosition.set(
            content.anchoredPosition.x + (this.horizontal ? dx : 0),
            content.anchoredPosition.y + (this.vertical ? dy : 0),
        );
    }

    /**
     * The travel limits on one axis. The content starts flush with the window
     * and moves negative, so the range is `[-scrollable, 0]`.
     */
    private _clampAxis(value: number, vertical: boolean): number {
        if (this.movementType === ScrollMovementType.Unrestricted) return value;

        const size = this.getScrollableSize(ScrollRect._sizeScratch);
        const limit = vertical ? size.y : size.x;
        return Mathf.clamp(value, -limit, 0);
    }

    /** Damps motion past the ends so the content resists rather than stops. */
    private _rubberBand(value: number, vertical: boolean): number {
        const clamped = this._clampAxis(value, vertical);
        const overshoot = value - clamped;
        if (overshoot === 0) return value;

        const view = this.rectTransform._resolvedLocalRect;
        const extent = Math.max(1, vertical ? view.height : view.width);
        // Approaches half the viewport asymptotically, so it never runs away.
        return clamped + (overshoot * extent) / (Math.abs(overshoot) * 2 + extent);
    }

    private _normalized(vertical: boolean): number {
        const content = this.content;
        if (!content) return 0;

        const size = this.getScrollableSize(ScrollRect._sizeScratch);
        const limit = vertical ? size.y : size.x;
        if (limit <= 0) return 0;

        const pos = vertical ? content.anchoredPosition.y : content.anchoredPosition.x;
        return Mathf.clamp01(-pos / limit);
    }

    private _setNormalized(vertical: boolean, t: number): void {
        const content = this.content;
        if (!content) return;

        const size = this.getScrollableSize(ScrollRect._sizeScratch);
        const limit = vertical ? size.y : size.x;
        const value = -Mathf.clamp01(t) * limit;

        if (vertical) content.anchoredPosition.y = value;
        else content.anchoredPosition.x = value;

        this._reportIfMoved();
    }

    private _reportIfMoved(): void {
        const now = this.getNormalizedPosition(ScrollRect._reportScratch);
        if (now.x === this._lastReported.x && now.y === this._lastReported.y) return;

        this._lastReported.copy(now);
        this.onValueChanged.invoke(now);
    }

    /**
     * Forces the content to hang from the window's top-left corner.
     *
     * @remarks
     * Written every frame with the same values, so a settled view leaves the
     * RectTransform change snapshot alone and its rect cache still hits.
     */
    private static _pinContentAnchors(content: RectTransform): void {
        content.anchorMin.set(0, 0);
        content.anchorMax.set(0, 0);
        content.pivot.set(0, 0);
    }

    private static readonly _sizeScratch: Vector2 = new Vector2();
    private static readonly _reportScratch: Vector2 = new Vector2();
}
