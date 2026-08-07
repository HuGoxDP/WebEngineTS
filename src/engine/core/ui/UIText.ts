import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
import { HASH_SEED, cssColor, fontGeneration, hashBool, hashColor, hashNumber, hashString } from "./UIUtils";
import { RichText, type RichLine } from "./RichText";
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

/**
 * @internal
 * The shared off-screen context every UI component measures text with. Shared
 * so one stub (see {@link UIText._setMeasureContext}) covers all of them.
 */
export function measureContext(): CanvasRenderingContext2D | null {
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
     * Whether the font size shrinks (and grows) so the text fills its rect.
     *
     * @remarks
     * Equivalent to Unity's `Text.resizeTextForBestFit`. Picks the largest size
     * in `[`{@link bestFitMinSize}`, `{@link bestFitMaxSize}`]` at which the
     * wrapped text still fits, so a label whose content varies — a translated
     * caption, a live readout — stays inside its box without an author guessing
     * a size.
     *
     * {@link fontSize} is ignored while this is on; read
     * {@link effectiveFontSize} for the size actually drawn. Combining this with
     * a `ContentSizeFitter` is contradictory — one sizes the text to the box,
     * the other the box to the text — and the fitter will win.
     */
    public bestFit: boolean = false;

    /** Smallest size {@link bestFit} may shrink to, in canvas units. */
    public bestFitMinSize: number = 10;

    /** Largest size {@link bestFit} may grow to, in canvas units. */
    public bestFitMaxSize: number = 40;

    /**
     * Whether `<b>`, `<i>`, `<color=…>` and `<size=…>` markup is interpreted.
     *
     * @remarks
     * Equivalent to Unity's `Text.supportRichText`, and off by default here
     * because it costs a tokenizer pass and per-run measurement — a HUD label
     * showing a number should not pay for it.
     *
     * ```ts
     * label.richText = true;
     * label.text = "Mass: <b>5.2</b> <color=#8cf>kg</color>";
     * ```
     *
     * Colours accept `#rgb`, `#rrggbb`, `#rrggbbaa` and the common names.
     * An unrecognized or malformed tag is left as literal text rather than
     * dropped, so a stray `<` shows up as itself instead of swallowing the rest
     * of the string.
     *
     * `TextOverflow.Ellipsis` degrades to {@link TextOverflow.Clip} while this
     * is on — eliding across styled runs would have to re-measure the tail of
     * every line, and the plain path exists for labels that need it.
     */
    public richText: boolean = false;

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

        if (this.richText) {
            const tokens = RichText.tokenize(ctx, this.text, this.fontSize, this.fontFamily);
            // Unwrapped, so each hard-break paragraph is measured whole — the
            // same question the plain path answers.
            return RichText.widestLine(RichText.layout(ctx, tokens, 0, false, this.fontFamily));
        }

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

        if (this.richText) {
            const tokens = RichText.tokenize(ctx, this.text, this.fontSize, this.fontFamily);
            const lines = RichText.layout(ctx, tokens, width, this.wordWrap && width > 0, this.fontFamily);
            return lines.length * this.fontSize * this.lineHeight;
        }

        const font = this._font();
        ctx.font = font;
        const lines = this.wordWrap && width > 0
            ? this._wrapText(ctx, this.text, width)
            : this.text.split("\n");
        return lines.length * this.fontSize * this.lineHeight;
    }

    /**
     * The size the label is actually drawn at, in canvas units.
     *
     * @remarks
     * Equal to {@link fontSize} unless {@link bestFit} is on, in which case it
     * is the size the fit search settled on. `0` before the label has been
     * measured once, and without a measuring context.
     */
    public get effectiveFontSize(): number {
        if (!this.bestFit) return this.fontSize;

        const ctx = measureContext();
        if (!ctx || !this.text) return this.fontSize;
        return this._resolveFontSize(ctx, this.rectTransform._resolvedLocalRect);
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

    /** Cached rich-text layout, keyed by everything that can change it. */
    private _richLines: RichLine[] | null = null;
    private _richText: string | null = null;
    private _richKey: string = "";

    /** Cached {@link bestFit} result, keyed the same way. */
    private _fitSize: number = 0;
    private _fitText: string | null = null;
    private _fitWidth: number = -1;
    private _fitHeight: number = -1;
    private _fitMin: number = -1;
    private _fitMax: number = -1;
    private _fitWrap: boolean = true;
    private _fitStyle: string = "";
    private _fitGeneration: number = -1;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public override _draw(ctx: CanvasRenderingContext2D, rect: Rect): void {
        if (rect.width <= 0 || rect.height <= 0 || !this.text) return;

        const size = this._resolveFontSize(ctx, rect);
        if (this.richText) {
            this._drawRich(ctx, rect, size);
            return;
        }

        const font = this._fontAt(size);
        ctx.font = font;
        ctx.textAlign = this.alignment as CanvasTextAlign;
        ctx.textBaseline = "top";

        const lines = this._resolveLines(ctx, font, rect.width);
        const lineH = size * this.lineHeight;
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
        h = hashBool(h, this.richText);
        h = hashBool(h, this.bestFit);
        if (this.bestFit) {
            h = hashNumber(h, this.bestFitMinSize);
            h = hashNumber(h, this.bestFitMaxSize);
            // The resolved size is the only input the rect feeds into drawing,
            // and the canvas hashes the rect separately, so this is enough.
            h = hashNumber(h, this._fitSize);
        }
        return hashNumber(h, fontGeneration());
    }

    // ── private ──────────────────────────────────────────────────────

    /**
     * Draws marked-up text run by run.
     *
     * @remarks
     * The 2D context can only align a whole `fillText` call, so with mixed
     * fonts on one line the x advance is computed here and every token is drawn
     * left-aligned at its own position. Tokens sit on a common baseline, which
     * is what keeps a `<size=24>` run from floating above its neighbours.
     */
    private _drawRich(ctx: CanvasRenderingContext2D, rect: Rect, size: number): void {
        const lines = this._resolveRichLines(ctx, rect.width, size);

        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const stroke = this.outlineWidth > 0 && this.outlineColor.a > 0;
        if (stroke) {
            ctx.strokeStyle = cssColor(this.outlineColor);
            ctx.lineWidth = this.outlineWidth;
            ctx.lineJoin = "round";
        }

        const lineH = size * this.lineHeight;
        let y = this._textStartY(rect, lines.length * lineH);
        const bottom = rect.y + rect.height;
        const clips = this.overflow !== TextOverflow.Overflow;
        const baseFill = cssColor(this.color);

        for (const line of lines) {
            if (clips && y + lineH > bottom) break;

            let x = rect.x;
            if (this.alignment === TextAlignment.Center) {
                x = rect.x + (rect.width - line.width) * 0.5;
            } else if (this.alignment === TextAlignment.Right) {
                x = rect.x + rect.width - line.width;
            }

            for (const token of line.tokens) {
                if (token.text.length === 0) continue;

                ctx.font = RichText.fontFor(token, this.fontFamily);
                // Sat on the line's baseline rather than its top edge, so runs
                // of different sizes line up along the bottom of the glyphs.
                const dy = line.maxSize - token.size;

                if (stroke) ctx.strokeText(token.text, x, y + dy);
                ctx.fillStyle = token.style.color ? cssColor(token.style.color) : baseFill;
                ctx.fillText(token.text, x, y + dy);
                x += token.width;
            }

            y += lineH;
        }
    }

    /** Tokenizes and wraps, reusing the result while nothing relevant changed. */
    private _resolveRichLines(
        ctx: CanvasRenderingContext2D,
        maxWidth: number,
        size: number,
    ): RichLine[] {
        const key = `${size}|${this.fontFamily}|${this.wordWrap}|${maxWidth}|${fontGeneration()}`;
        if (this._richLines && this._richText === this.text && this._richKey === key) {
            return this._richLines;
        }

        const tokens = RichText.tokenize(ctx, this.text, size, this.fontFamily);
        this._richLines = RichText.layout(ctx, tokens, maxWidth, this.wordWrap, this.fontFamily);
        this._richText = this.text;
        this._richKey = key;
        return this._richLines;
    }

    private _font(): string {
        return this._fontAt(this.fontSize);
    }

    private _fontAt(size: number): string {
        return `${this.fontStyle} ${size}px ${this.fontFamily}`;
    }

    /**
     * The size to draw at: {@link fontSize}, or the best-fit search result.
     *
     * @remarks
     * Cached against everything the search depends on, so the binary search
     * runs when the text or the box changes and not once per frame.
     */
    private _resolveFontSize(ctx: CanvasRenderingContext2D, rect: Rect): number {
        if (!this.bestFit) return this.fontSize;

        const min = Math.max(1, Math.min(this.bestFitMinSize, this.bestFitMaxSize));
        const max = Math.max(min, this.bestFitMaxSize);
        const generation = fontGeneration();

        if (this._fitText === this.text
            && this._fitWidth === rect.width
            && this._fitHeight === rect.height
            && this._fitMin === min
            && this._fitMax === max
            && this._fitWrap === this.wordWrap
            && this._fitStyle === `${this.fontStyle}|${this.fontFamily}|${this.lineHeight}`
            && this._fitGeneration === generation) {
            return this._fitSize;
        }

        // Binary search over whole sizes: the fit test is monotonic in size, and
        // a sub-pixel font size is not worth the extra measuring passes.
        let low = min;
        let high = Math.floor(max);
        let best = min;

        while (low <= high) {
            const mid = (low + high) >> 1;
            if (this._fitsAt(ctx, mid, rect)) {
                best = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        this._fitSize = best;
        this._fitText = this.text;
        this._fitWidth = rect.width;
        this._fitHeight = rect.height;
        this._fitMin = min;
        this._fitMax = max;
        this._fitWrap = this.wordWrap;
        this._fitStyle = `${this.fontStyle}|${this.fontFamily}|${this.lineHeight}`;
        this._fitGeneration = generation;

        // The wrap cache was filled at trial sizes during the search.
        this._cacheText = null;
        return best;
    }

    /** Whether the text laid out at `size` fits inside `rect`. */
    private _fitsAt(ctx: CanvasRenderingContext2D, size: number, rect: Rect): boolean {
        if (this.richText) {
            const tokens = RichText.tokenize(ctx, this.text, size, this.fontFamily);
            const laid = RichText.layout(ctx, tokens, rect.width, this.wordWrap, this.fontFamily);
            if (laid.length * size * this.lineHeight > rect.height) return false;
            return RichText.widestLine(laid) <= rect.width;
        }

        ctx.font = this._fontAt(size);

        const lines = this.wordWrap
            ? this._wrapText(ctx, this.text, rect.width)
            : this.text.split("\n");

        if (lines.length * size * this.lineHeight > rect.height) return false;

        // Wrapping already bounds the width, except where a single glyph is
        // wider than the rect — which the height test cannot catch.
        for (const line of lines) {
            if (ctx.measureText(line).width > rect.width) return false;
        }
        return true;
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
