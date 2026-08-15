import { Behaviour } from "../Behaviour";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";
import type { RectTransform } from "./RectTransform";

/**
 * A component that can tell a layout group how big it would like to be.
 *
 * @remarks
 * Structural rather than a base class, so any component can opt in simply by
 * exposing the two numbers — {@link UIText} already does.
 */
export interface ILayoutSize {
    readonly preferredWidth: number;
    readonly preferredHeight: number;
}

/** Sentinel for "no override": negative values fall through to the default. */
const UNSET = -1;

/**
 * `getComponents` takes a construct signature and `Behaviour` is abstract, so
 * the size query needs a concrete-looking view of it.
 */
const BEHAVIOUR_TYPE = Behaviour as unknown as new (...args: never[]) => Behaviour;

/**
 * Overrides the size a layout group gives this element.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.LayoutElement`. Every field defaults to
 * `-1`, meaning "leave it to whatever the element itself reports".
 *
 * ```ts
 * const el = go.addComponent(LayoutElement);
 * el.preferredHeight = 40;   // a fixed-height row
 * el.flexibleWidth = 1;      // ...that soaks up spare width
 * ```
 */
@Serializable({ typeName: "LayoutElement", category: "UI" })
export class LayoutElement extends Behaviour {

    /** Smallest width this element may be shrunk to. `-1` leaves it unset. */
    @SerializedField()
    public minWidth: number = UNSET;

    /** Smallest height this element may be shrunk to. `-1` leaves it unset. */
    @SerializedField()
    public minHeight: number = UNSET;

    /** Width this element would like. `-1` defers to the element itself. */
    @SerializedField()
    public preferredWidth: number = UNSET;

    /** Height this element would like. `-1` defers to the element itself. */
    @SerializedField()
    public preferredHeight: number = UNSET;

    /**
     * Share of leftover width this element claims, relative to its siblings.
     * `0` (the default) takes none.
     */
    @SerializedField()
    public flexibleWidth: number = 0;

    /** Share of leftover height this element claims. `0` takes none. */
    @SerializedField()
    public flexibleHeight: number = 0;

    /**
     * Whether a layout group should skip this element entirely.
     *
     * @remarks
     * The element keeps whatever position it had, which is how a floating badge
     * or a drag ghost sits inside a laid-out panel.
     */
    @SerializedField()
    public ignoreLayout: boolean = false;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }
}

/**
 * @internal
 * Resolves the sizes a layout group should use for one child, in priority
 * order: an explicit {@link LayoutElement}, then anything on the GameObject
 * that reports a preferred size, then the element's current size.
 */
export class LayoutUtility {

    /** Whether a layout group should leave this child alone. */
    public static ignoresLayout(rt: RectTransform): boolean {
        const el = rt.gameObject.getComponent(LayoutElement);
        return el !== null && el.isActiveAndEnabled && el.ignoreLayout;
    }

    /** The width this child would like, in canvas units. */
    public static preferredWidth(rt: RectTransform): number {
        const el = LayoutUtility._element(rt);
        if (el && el.preferredWidth >= 0) return el.preferredWidth;

        const reported = LayoutUtility._reported(rt);
        if (reported && reported.preferredWidth > 0) return reported.preferredWidth;

        return rt._resolvedLocalRect.width;
    }

    /** The height this child would like, in canvas units. */
    public static preferredHeight(rt: RectTransform): number {
        const el = LayoutUtility._element(rt);
        if (el && el.preferredHeight >= 0) return el.preferredHeight;

        const reported = LayoutUtility._reported(rt);
        if (reported && reported.preferredHeight > 0) return reported.preferredHeight;

        return rt._resolvedLocalRect.height;
    }

    /** The smallest width this child accepts. Defaults to its preferred one. */
    public static minWidth(rt: RectTransform): number {
        const el = LayoutUtility._element(rt);
        return el && el.minWidth >= 0 ? el.minWidth : LayoutUtility.preferredWidth(rt);
    }

    /** The smallest height this child accepts. Defaults to its preferred one. */
    public static minHeight(rt: RectTransform): number {
        const el = LayoutUtility._element(rt);
        return el && el.minHeight >= 0 ? el.minHeight : LayoutUtility.preferredHeight(rt);
    }

    /** This child's share of leftover width. */
    public static flexibleWidth(rt: RectTransform): number {
        const el = LayoutUtility._element(rt);
        return el ? Math.max(0, el.flexibleWidth) : 0;
    }

    /** This child's share of leftover height. */
    public static flexibleHeight(rt: RectTransform): number {
        const el = LayoutUtility._element(rt);
        return el ? Math.max(0, el.flexibleHeight) : 0;
    }

    private constructor() {}

    private static _element(rt: RectTransform): LayoutElement | null {
        const el = rt.gameObject.getComponent(LayoutElement);
        return el && el.isActiveAndEnabled ? el : null;
    }

    /**
     * The first component on this GameObject that reports a preferred size.
     *
     * @remarks
     * Duck-typed on purpose: a scenario's own control can take part in layout
     * without importing or extending anything from the engine.
     */
    private static _reported(rt: RectTransform): ILayoutSize | null {
        for (const comp of rt.gameObject.getComponents(BEHAVIOUR_TYPE)) {
            // A LayoutElement has both numbers too, and unset they are -1. Left
            // in, it answered here for whatever it was added before — so a
            // label with a LayoutElement setting only `minHeight` lost the
            // width its own text reported, depending on which was added first.
            if (comp instanceof LayoutElement) continue;

            // A disabled component is not describing anything: the size it
            // reports is stale, and switching a control off is how a scenario
            // takes it out of the conversation.
            if (!comp.isActiveAndEnabled) continue;

            const candidate = comp as unknown as Partial<ILayoutSize>;
            if (typeof candidate.preferredWidth === "number"
                && typeof candidate.preferredHeight === "number") {
                return candidate as ILayoutSize;
            }
        }
        return null;
    }
}
