import { UIBehaviour } from "./UIBehaviour";
import { Color } from "../math/Color";
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
 * ```ts
 * const label = go.addComponent(UIText);
 * label.text = "Score: 0";
 * label.fontSize = 24;
 * label.color = Color.white;
 * label.alignment = TextAlignment.Center;
 * ```
 */
export class UIText extends UIBehaviour {

    /** The string to display. Supports `\n` for line breaks. */
    public text: string = "Text";

    /** Font size in pixels. */
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

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public override _draw(ctx: CanvasRenderingContext2D): void {
        const rect = this.rectTransform.screenRect;
        if (rect.width <= 0 || rect.height <= 0 || !this.text) return;

        ctx.font = `${this.fontStyle} ${this.fontSize}px ${this.fontFamily}`;
        ctx.fillStyle = this._toCSSColor(this.color);
        ctx.textAlign = this.alignment as CanvasTextAlign;
        ctx.textBaseline = "top";

        const x = this._textX(rect);
        const lineH = this.fontSize * this.lineHeight;

        const lines = this.wordWrap
            ? this._wrapText(ctx, this.text, rect.width)
            : this.text.split("\n");

        const totalH = lines.length * lineH;
        let y = this._textStartY(rect, totalH);

        for (const line of lines) {
            if (y + lineH > rect.y + rect.height) break;
            ctx.fillText(line, x, y);
            y += lineH;
        }
    }

    // ── private ──────────────────────────────────────────────────────

    private _textX(rect: { x: number; width: number }): number {
        switch (this.alignment) {
            case TextAlignment.Center: return rect.x + rect.width * 0.5;
            case TextAlignment.Right:  return rect.x + rect.width;
            default:                   return rect.x;
        }
    }

    private _textStartY(rect: { y: number; height: number }, totalH: number): number {
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

    private _toCSSColor(c: Color): string {
        return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
    }
}
