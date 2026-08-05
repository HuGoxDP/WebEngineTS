import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
import { HASH_SEED, cssColor, fontGeneration, hashColor, hashNumber, hashString } from "./UIUtils";
import type { Rect } from "../math/Rect";
import type { GameObject } from "../GameObject";

/** Horizontal text alignment options. */
export enum TextAlignment {
    Left   = "left",
    Center = "center",
    Right  = "right",
}

/** Vertical text alignment options. */
export enum VerticalAlignment {
    Top    = "top",
    Middle = "middle",
    Bottom = "bottom",
}

/** What happens to text that does not fit its rect. */
export enum TextOverflow {
    /** Draw every line, even past the bottom edge. */
    Overflow = "Overflow",
    /** Stop at the last line that fits completely. */
    Clip = "Clip",
    /**
     * Like {@link Clip}, but the last drawn line ends in an ellipsis, and with
     * {@link UIText.wordWrap} off each line is truncated to the rect width.
     */
    Ellipsis = "Ellipsis",
}

/** The character appended when text is elided. */
const ELLIPSIS = "…";

/**
 * A context used only to measure text outside of a paint.
 *
 * @remarks
 * `preferredWidth` has to answer before the canvas has drawn anything — a
 * layout pass runs first — so measurement cannot borrow the paint context.
 * `undefined` means "not looked up yet"; `null` means there is no DOM.
 */
let _measureCtx: CanvasRenderingContext2D | null | undefined;

function measureContext(): CanvasRenderingContext2D | null {
    if (_measureCtx === undefined) {
        _measureCtx = typeof document !== "undefined"
            ? document.createElement("canvas").getContext("2d")
            : null;
    }
    return _measureCtx;
}

/**
 * Renders text inside a RectTransform using the Canvas 2D API.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Text` (legacy) component.
 *
 * Word wrapping is measured once and reused until the text, font or rect width
 * changes — `measureText` is among the most expensive 2D-context calls, and a
 * label re-measured every frame is pure waste.
 *
 * ```ts
 * const label = go.addComponent(UIText);
 * label.text = "Score: 0";
 * label.fontSize = 24;
 * label.color = Color.white;
 * label.alignment = TextAlignment.Center;
 * label.outlineWidth = 2;   // readable over a bright 3D scene
 * ```
 */
export class UIText extends UIBehaviour {

    /** The string to display. Supports `\n` for line breaks. */
    public text: string = "Text";

    /** Font size in canvas units. */
    public fontSize: number = 16;

    /** Font family (CSS font-family syntax). */
    public fontFamily: string = "Arial, sans-serif";

    /** Font style (CSS font-style: 'normal', 'italic', 'bold', 'bold italic'). */
    public fontStyle: string = "normal";

    /** Text color. */
    public color: Color = Color.white.clone();

    /** Horizontal alignment. */
    public alignment: TextAlignment = TextAlignment.Left;

    /** Vertical alignment. */
    public verticalAlignment: VerticalAlignment = VerticalAlignment.Top;

    /** Whether text wraps within the rect. */
    public wordWrap: boolean = true;

    /** Line height multiplier (1 = normal). */
    public lineHeight: number = 1.2;

    /**
     * Width of the outline stroked behind the glyphs, in canvas units.
     * `0` disables it.
     */
    public outlineWidth: number = 0;

    /** Outline color, used when {@link outlineWidth} is greater than zero. */
    public outlineColor: Color = new Color(0, 0, 0, 1);

    /**
     * What to do with text that does not fit the rect.
     *
     * @default TextOverflow.Clip
     */
    public overflow: TextOverflow = TextOverflow.Clip;

    /**
     * Width in canvas units this label would like, ignoring its current rect.
     *
     * @remarks
     * The widest line with no wrapping applied, which is what a layout group or
     * a `ContentSizeFitter` sizes against. Returns `0` when no measuring context
     * is available (no DOM), since guessing would silently produce a wrong
     * layout rather than an obviously empty one.
     */
    public get preferredWidth(): number {
        const ctx = measureContext();
        if (!ctx || !this.text) return 0;

        ctx.font = this._font();
        let widest = 0;
        for (const paragraph of this.text.split("\n")) {
            const w = ctx.measureText(paragraph).width;
            if (w > widest) widest = w;
        }
        return widest;
    }

    /**
     * Height in canvas units this label would like at its current rect width.
     *
     * @remarks
     * Equivalent to Unity's `Text.preferredHeight`. See
     * {@link getPreferredHeight} to ask about a different width.
     */
    public get preferredHeight(): number {
        return this.getPreferredHeight(this.rectTransform._resolvedLocalRect.width);
    }

    /**
     * Height in canvas units this label needs if laid out at `width`.
     *
     * @param width - the width to wrap against, in canvas units.
     * @returns the required height, or `0` without a measuring context.
     */
    public getPreferredHeight(width: number): number {
        const ctx = measureContext();
        if (!ctx || !this.text) return 0;

        const font = this._font();
        ctx.font = font;
        const lines = this.wordWrap && width > 0
            ? this._wrapText(ctx, this.text, width)
            : this.text.split("\n");
        return lines.length * this.fontSize * this.lineHeight;
    }

    /**
     * @internal
     * Overrides the context used for measurement. Exists so tests can measure
     * deterministically without a DOM; pass `undefined` to restore the default.
     */
    public static _setMeasureContext(ctx: CanvasRenderingContext2D | null | undefined): void {
        _measureCtx = ctx;
    }

    /** Cached wrap result, keyed by the inputs that can change it. */
    private _lines: string[] = [];
    private _cacheText: string | null = null;
    private _cacheFont: string = "";
    private _cacheWidth: number = -1;
    private _cacheWrap: boolean = true;
    private _cacheFontGeneration: number = -1;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        if (rect.width <= 0 || rect.height <= 0 || !this.text) return;

        const font = this._font();
        ctx.font = font;
        ctx.textAlign = this.alignment as CanvasTextAlign;
        ctx.textBaseline = "top";

        const lines = this._resolveLines(ctx, font, rect.width);
        const lineH = this.fontSize * this.lineHeight;
        const x = this._textX(rect);
        let y = this._textStartY(rect, lines.length * lineH);

        const stroke = this.outlineWidth > 0 && this.outlineColor.a > 0;
        if (stroke) {
            ctx.strokeStyle = cssColor(this.outlineColor);
            ctx.lineWidth = this.outlineWidth;
            ctx.lineJoin = "round";
        }
        ctx.fillStyle = cssColor(this.color);

        const bottom = rect.y + rect.height;
        const clips = this.overflow !== TextOverflow.Overflow;

        for (let i = 0; i < lines.length; i++) {
            const lastVisible = clips && (i + 1 >= lines.length || y + lineH * 2 > bottom);
            if (clips && y + lineH > bottom) break;

            let line = lines[i];
            if (this.overflow === TextOverflow.Ellipsis) {
                // Either there are lines below that will not be drawn, or this
                // one runs off the side because wrapping is off.
                const cutShort = lastVisible && i + 1 < lines.length;
                const tooWide = !this.wordWrap
                    && ctx.measureText(line).width > rect.width;
                if (cutShort || tooWide) line = UIText._elide(ctx, line, rect.width);
            }

            if (stroke) ctx.strokeText(line, x, y);
            ctx.fillText(line, x, y);
            y += lineH;
        }
    }

    public override _drawOverflow(): number {
        const outline = this.outlineWidth > 0 && this.outlineColor.a > 0 ? this.outlineWidth : 0;
        if (!this.text) return outline;

        // Both of these can run arbitrarily far past the rect, and bounding them
        // means measuring the text — far too expensive to do once per element
        // per frame, so they give up partial repaint instead.
        if (this.overflow === TextOverflow.Overflow) return Number.POSITIVE_INFINITY;
        if (!this.wordWrap && this.overflow !== TextOverflow.Ellipsis) {
            return Number.POSITIVE_INFINITY;
        }

        // Wrapping breaks inside a word when it has to, so the only way text
        // escapes sideways is a rect narrower than a single glyph. Two ems of
        // slack covers that without measuring anything.
        return Math.max(outline, this.fontSize * 2);
    }

    public override _visualHash(): number {
        let h = hashString(HASH_SEED, this.text);
        h = hashNumber(h, this.fontSize);
        h = hashString(h, this.fontFamily);
        h = hashString(h, this.fontStyle);
        h = hashColor(h, this.color);
        h = hashString(h, this.alignment);
        h = hashString(h, this.verticalAlignment);
        h = hashNumber(h, this.wordWrap ? 1 : 0);
        h = hashNumber(h, this.lineHeight);
        h = hashNumber(h, this.outlineWidth);
        h = hashColor(h, this.outlineColor);
        h = hashString(h, this.overflow);
        return hashNumber(h, fontGeneration());
    }

    // ── private ──────────────────────────────────────────────────────

    private _font(): string {
        return `${this.fontStyle} ${this.fontSize}px ${this.fontFamily}`;
    }

    /** Returns the wrapped lines, re-measuring only when an input changed. */
    private _resolveLines(ctx: CanvasRenderingContext2D, font: string, maxWidth: number): string[] {
        if (this._cacheText === this.text
            && this._cacheFont === font
            && this._cacheWrap === this.wordWrap
            && this._cacheFontGeneration === fontGeneration()
            && (!this.wordWrap || this._cacheWidth === maxWidth)) {
            return this._lines;
        }

        this._lines = this.wordWrap
            ? this._wrapText(ctx, this.text, maxWidth)
            : this.text.split("\n");

        this._cacheText = this.text;
        this._cacheFont = font;
        this._cacheWidth = maxWidth;
        this._cacheWrap = this.wordWrap;
        this._cacheFontGeneration = fontGeneration();
        return this._lines;
    }

    private _textX(rect: Rect): number {
        switch (this.alignment) {
            case TextAlignment.Center: return rect.x + rect.width * 0.5;
            case TextAlignment.Right:  return rect.x + rect.width;
            default:                   return rect.x;
        }
    }

    private _textStartY(rect: Rect, totalH: number): number {
        switch (this.verticalAlignment) {
            case VerticalAlignment.Middle: return rect.y + (rect.height - totalH) * 0.5;
            case VerticalAlignment.Bottom: return rect.y + rect.height - totalH;
            default:                       return rect.y;
        }
    }

    private _wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
        const result: string[] = [];
        for (const paragraph of text.split("\n")) {
            const words = paragraph.split(" ");
            let line = "";
            for (const word of words) {
                const test = line ? `${line} ${word}` : word;
                if (ctx.measureText(test).width <= maxWidth) {
                    line = test;
                    continue;
                }

                if (line) result.push(line);

                // A single word wider than the rect has no space to break at,
                // so it is split between characters rather than left to run off
                // the edge. A long URL or a chemical formula does this.
                if (ctx.measureText(word).width > maxWidth) {
                    const chunks = UIText._breakWord(ctx, word, maxWidth);
                    for (let i = 0; i < chunks.length - 1; i++) result.push(chunks[i]);
                    line = chunks[chunks.length - 1];
                } else {
                    line = word;
                }
            }
            result.push(line);
        }
        return result;
    }

    /** Splits an over-wide word into chunks that each fit `maxWidth`. */
    private static _breakWord(
        ctx: CanvasRenderingContext2D,
        word: string,
        maxWidth: number,
    ): string[] {
        const chunks: string[] = [];
        let chunk = "";

        for (const ch of word) {
            const test = chunk + ch;
            if (chunk && ctx.measureText(test).width > maxWidth) {
                chunks.push(chunk);
                chunk = ch;
            } else {
                chunk = test;
            }
        }

        chunks.push(chunk);
        return chunks;
    }

    /** Trims a line until it plus an ellipsis fits `maxWidth`. */
    private static _elide(
        ctx: CanvasRenderingContext2D,
        line: string,
        maxWidth: number,
    ): string {
        if (ctx.measureText(line + ELLIPSIS).width <= maxWidth) return line + ELLIPSIS;

        let text = line;
        while (text.length > 0 && ctx.measureText(text + ELLIPSIS).width > maxWidth) {
            text = text.slice(0, -1);
        }
        return text + ELLIPSIS;
    }
}
