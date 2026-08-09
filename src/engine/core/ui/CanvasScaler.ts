import { Behaviour } from "../Behaviour";
import { Vector2 } from "../math/Vector2";
import { Mathf } from "../math/Mathf";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/**
 * How the Canvas maps its layout units onto the physical screen.
 *
 * @remarks Equivalent to Unity's `CanvasScaler.ScaleMode`.
 */
export enum CanvasScaleMode {
    /** UI units are CSS pixels; a 100-unit button is 100 px on every screen. */
    ConstantPixelSize = "ConstantPixelSize",
    /** UI is authored against a reference resolution and scaled to fit the screen. */
    ScaleWithScreenSize = "ScaleWithScreenSize",
    /** UI keeps a constant physical size (cm/mm/inches) regardless of screen density. */
    ConstantPhysicalSize = "ConstantPhysicalSize",
}

/**
 * Strategy used by {@link CanvasScaleMode.ScaleWithScreenSize} when the screen
 * aspect ratio differs from the reference resolution's.
 *
 * @remarks Equivalent to Unity's `CanvasScaler.ScreenMatchMode`.
 */
export enum ScreenMatchMode {
    /** Blend between matching width and height via {@link CanvasScaler.matchWidthOrHeight}. */
    MatchWidthOrHeight = "MatchWidthOrHeight",
    /** Expand the canvas area so it never crops the reference resolution. */
    Expand = "Expand",
    /** Shrink the canvas area so it never exceeds the reference resolution. */
    Shrink = "Shrink",
}

/**
 * Physical unit used by {@link CanvasScaleMode.ConstantPhysicalSize}.
 *
 * @remarks Equivalent to Unity's `CanvasScaler.Unit`.
 */
export enum CanvasPhysicalUnit {
    Centimeters = "Centimeters",
    Millimeters = "Millimeters",
    Inches = "Inches",
    Points = "Points",
    Picas = "Picas",
}

/** CSS reference density: 96 CSS pixels per inch at devicePixelRatio 1. */
const CSS_DPI = 96;

/**
 * Controls the scale and pixel density of UI elements in a {@link Canvas}.
 *
 * @remarks
 * Equivalent to Unity's `CanvasScaler`. Attach it to the same GameObject as the
 * Canvas; the Canvas picks it up automatically each frame.
 *
 * Without a scaler, one canvas unit equals one CSS pixel — a layout authored on
 * a 1920×1080 desktop is unusably small on a 2560-wide monitor and unusably
 * large on a 640-wide phone. With {@link CanvasScaleMode.ScaleWithScreenSize}
 * the layout is authored once against {@link referenceResolution} and the whole
 * canvas is scaled to the real screen, so proportions survive both.
 *
 * ```ts
 * const canvasGO = scene.createGameObject("UI");
 * canvasGO.addComponent(Canvas);
 * const scaler = canvasGO.addComponent(CanvasScaler);
 * scaler.uiScaleMode = CanvasScaleMode.ScaleWithScreenSize;
 * scaler.referenceResolution = new Vector2(1920, 1080);
 * scaler.matchWidthOrHeight = 0.5;   // balance width and height
 * ```
 */
@Serializable({ typeName: "CanvasScaler", category: "UI" })
export class CanvasScaler extends Behaviour {

    /** Scaling strategy. */
    @SerializedField({ type: FieldType.Enum })
    public uiScaleMode: CanvasScaleMode = CanvasScaleMode.ConstantPixelSize;

    /**
     * Extra multiplier applied in {@link CanvasScaleMode.ConstantPixelSize} mode.
     * @default 1
     */
    @SerializedField()
    public scaleFactor: number = 1;

    /**
     * Resolution the UI is authored against, used by
     * {@link CanvasScaleMode.ScaleWithScreenSize}.
     * @default (800, 600)
     */
    @SerializedField({ type: FieldType.Vector2 })
    public referenceResolution: Vector2 = new Vector2(800, 600);

    /** How a mismatched screen aspect ratio is resolved. */
    @SerializedField({ type: FieldType.Enum })
    public screenMatchMode: ScreenMatchMode = ScreenMatchMode.MatchWidthOrHeight;

    /**
     * Blend between matching the screen width (`0`) and height (`1`).
     * Only used by {@link ScreenMatchMode.MatchWidthOrHeight}.
     * @default 0
     */
    @SerializedField()
    public matchWidthOrHeight: number = 0;

    /** Physical unit one canvas unit represents in ConstantPhysicalSize mode. */
    @SerializedField({ type: FieldType.Enum })
    public physicalUnit: CanvasPhysicalUnit = CanvasPhysicalUnit.Points;

    /**
     * Screen DPI assumed when the browser reports none.
     * @default 96
     */
    @SerializedField()
    public fallbackScreenDPI: number = 96;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /**
     * @internal
     * Computes the canvas scale factor for the given screen size.
     *
     * @param screenWidth - viewport width in CSS pixels.
     * @param screenHeight - viewport height in CSS pixels.
     * @param dpi - screen density in dots per inch; `0` selects
     *              {@link fallbackScreenDPI}.
     * @returns the multiplier from canvas units to CSS pixels (always > 0).
     */
    public _computeScaleFactor(screenWidth: number, screenHeight: number, dpi: number): number {
        switch (this.uiScaleMode) {
            case CanvasScaleMode.ScaleWithScreenSize:
                return CanvasScaler._sanitize(
                    this._scaleWithScreenSize(screenWidth, screenHeight));

            case CanvasScaleMode.ConstantPhysicalSize:
                return CanvasScaler._sanitize(this._constantPhysicalSize(dpi));

            default:
                return CanvasScaler._sanitize(this.scaleFactor);
        }
    }

    /**
     * @internal
     * The screen density in dots per inch as reported by the browser.
     * Browsers expose density only as `devicePixelRatio` relative to the 96 DPI
     * CSS reference, so this is a derived approximation, not a panel query.
     */
    public static _screenDPI(): number {
        if (typeof window === "undefined") return 0;
        const ratio = window.devicePixelRatio;
        return ratio > 0 ? ratio * CSS_DPI : 0;
    }

    // ── private ──────────────────────────────────────────────────────

    private _scaleWithScreenSize(screenWidth: number, screenHeight: number): number {
        const refW = this.referenceResolution.x;
        const refH = this.referenceResolution.y;
        if (refW <= 0 || refH <= 0) return 1;

        const ratioW = screenWidth / refW;
        const ratioH = screenHeight / refH;

        switch (this.screenMatchMode) {
            case ScreenMatchMode.Expand:
                return Math.min(ratioW, ratioH);

            case ScreenMatchMode.Shrink:
                return Math.max(ratioW, ratioH);

            default: {
                // Unity blends the two ratios in log space so that "halfway"
                // between a 2x and an 8x scale is 4x, not 5x.
                if (ratioW <= 0 || ratioH <= 0) return 1;
                const t = Mathf.clamp01(this.matchWidthOrHeight);
                const logAverage = Mathf.lerp(Math.log2(ratioW), Math.log2(ratioH), t);
                return Math.pow(2, logAverage);
            }
        }
    }

    private _constantPhysicalSize(dpi: number): number {
        const effectiveDpi = dpi > 0 ? dpi : this.fallbackScreenDPI;
        if (effectiveDpi <= 0) return 1;

        // `dpi` counts device dots per inch, but a canvas unit resolves to CSS
        // pixels — so fold out the device pixel ratio before dividing by the
        // unit size. With the browser-derived DPI this reduces to the CSS
        // absolute-unit definitions (1pt = 96/72 px, 1mm = 96/25.4 px).
        const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0
            ? window.devicePixelRatio
            : 1;

        return effectiveDpi / (dpr * CanvasScaler._unitsPerInch(this.physicalUnit));
    }

    private static _unitsPerInch(unit: CanvasPhysicalUnit): number {
        switch (unit) {
            case CanvasPhysicalUnit.Centimeters: return 2.54;
            case CanvasPhysicalUnit.Millimeters: return 25.4;
            case CanvasPhysicalUnit.Inches:      return 1;
            case CanvasPhysicalUnit.Picas:       return 6;
            default:                             return 72; // Points
        }
    }

    /** Keeps the factor finite and positive so the canvas can never collapse. */
    private static _sanitize(factor: number): number {
        if (!Number.isFinite(factor) || factor <= 0) return 1;
        return factor;
    }
}
