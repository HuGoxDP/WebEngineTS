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

        for (let i = 0; i < lines.length; i++) {
            if (y + lineH > rect.y + rect.height) break;
            if (stroke) ctx.strokeText(lines[i], x, y);
            ctx.fillText(lines[i], x, y);
            y += lineH;
        }
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
                } else {
                    if (line) result.push(line);
                    line = word;
                }
            }
            result.push(line);
        }
        return result;
    }
}
