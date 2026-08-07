import { Color } from "../math/Color";

/**
 * @internal
 * The style in force for a stretch of rich text. Immutable once built: the
 * tokenizer pushes and pops copies rather than mutating one in place.
 */
export interface RichStyle {
    bold: boolean;
    italic: boolean;
    /** `null` inherits the label's own colour. */
    color: Color | null;
    /** `null` inherits the label's own size. */
    size: number | null;
}

/**
 * @internal
 * One measured, styled piece of a line. A token is a word plus the whitespace
 * that followed it, so wrapping only has to decide between tokens.
 */
export interface RichToken {
    text: string;
    style: RichStyle;
    /** Resolved size in canvas units, after the label's own size is applied. */
    size: number;
    /** Width in canvas units, measured with this token's own font. */
    width: number;
    /** Whether a line may start here — false in the middle of a word. */
    canBreak: boolean;
    /** Whether this token forces the line to end (a `\n`). */
    hardBreak: boolean;
}

/** @internal One laid-out line of rich text. */
export interface RichLine {
    tokens: RichToken[];
    /** Sum of the tokens' widths, trailing whitespace included. */
    width: number;
    /** Largest token size on the line; what its height is measured by. */
    maxSize: number;
}

/** Depth cap for the tag stack — a malformed string cannot grow it forever. */
const MAX_TAG_DEPTH = 32;

/** A `<tag>` or `</tag>` with an optional `=value`. */
const TAG_PATTERN = /^<(\/?)(b|i|color|size)(?:=([^>]*))?>/i;

/**
 * @internal
 * Parses and lays out the subset of Unity's rich-text markup this toolkit
 * supports: `<b>`, `<i>`, `<color=…>` and `<size=…>`.
 *
 * @remarks
 * Kept out of {@link UIText} because it is a genuinely separate concern — a
 * tokenizer plus a line breaker — and because everything here is pure: it takes
 * a measuring context and returns geometry, so it is testable on its own.
 *
 * An unrecognized or malformed tag is left as literal text rather than dropped.
 * That matches Unity, and it means a stray `<` in a chemistry caption shows up
 * as itself instead of silently eating the rest of the string.
 */
export class RichText {

    private constructor() {}

    /**
     * Splits `text` into styled, measured tokens.
     *
     * @param ctx - context used for measurement; its font is overwritten.
     * @param text - the marked-up string.
     * @param baseSize - the label's own font size, inherited by untagged runs.
     * @param fontFamily - CSS family for every token.
     * @returns the tokens, in order.
     */
    public static tokenize(
        ctx: CanvasRenderingContext2D,
        text: string,
        baseSize: number,
        fontFamily: string,
    ): RichToken[] {
        const tokens: RichToken[] = [];
        const stack: RichStyle[] = [{ bold: false, italic: false, color: null, size: null }];

        let pending = "";
        let pendingBreakable: boolean = true;

        const flush = (style: RichStyle, breakable: boolean): void => {
            if (pending.length === 0) return;
            tokens.push(RichText._measure(ctx, pending, style, baseSize, fontFamily, breakable));
            pending = "";
        };

        for (let i = 0; i < text.length; i++) {
            const style = stack[stack.length - 1];
            const ch = text[i];

            if (ch === "\n") {
                flush(style, pendingBreakable);
                tokens.push({
                    text: "", style, size: RichText._sizeOf(style, baseSize),
                    width: 0, canBreak: true, hardBreak: true,
                });
                pendingBreakable = true;
                continue;
            }

            if (ch === "<") {
                const match = TAG_PATTERN.exec(text.substring(i));
                if (match) {
                    // A style change ends the current token but not the word:
                    // "<b>un</b>likely" has to keep wrapping as one word, so
                    // what follows a mid-word tag may not start a line.
                    const midWord = pending.length > 0;
                    flush(style, pendingBreakable);
                    if (midWord) pendingBreakable = false;

                    RichText._applyTag(stack, match[1] === "/", match[2].toLowerCase(), match[3]);
                    i += match[0].length - 1;
                    continue;
                }
                // Not a tag we know — falls through and is kept as text.
            }

            pending += ch;

            // The space belongs to the token before it, so a line break lands
            // between words with the space absorbed by the line above.
            if (ch === " ") {
                flush(style, pendingBreakable);
                pendingBreakable = true;
            }
        }

        flush(stack[stack.length - 1], pendingBreakable);
        return tokens;
    }

    /**
     * Packs tokens into lines no wider than `maxWidth`.
     *
     * @param ctx - context used for measurement; its font is overwritten.
     * @param tokens - from {@link tokenize}.
     * @param maxWidth - wrap width in canvas units; ignored when `wrap` is false.
     * @param wrap - whether to wrap at all. Hard breaks always apply.
     * @param fontFamily - CSS family, needed to re-measure a split word.
     * @returns the laid-out lines.
     */
    public static layout(
        ctx: CanvasRenderingContext2D,
        tokens: readonly RichToken[],
        maxWidth: number,
        wrap: boolean,
        fontFamily: string,
    ): RichLine[] {
        const lines: RichLine[] = [];
        let current: RichLine = { tokens: [], width: 0, maxSize: 0 };

        const push = (): void => {
            lines.push(current);
            current = { tokens: [], width: 0, maxSize: 0 };
        };

        for (const token of tokens) {
            if (token.hardBreak) {
                if (current.maxSize === 0) current.maxSize = token.size;
                push();
                continue;
            }

            const fits = !wrap || maxWidth <= 0
                || current.width + token.width <= maxWidth
                || current.tokens.length === 0;

            if (!fits && token.canBreak) {
                push();
            }

            // A single token wider than the whole line has nowhere to break, so
            // it is split between characters — the same rule the plain path uses.
            if (wrap && maxWidth > 0 && token.width > maxWidth && current.tokens.length === 0) {
                const parts = RichText._breakToken(ctx, token, maxWidth, fontFamily);
                for (let i = 0; i < parts.length; i++) {
                    if (i > 0) push();
                    RichText._append(current, parts[i]);
                }
                continue;
            }

            RichText._append(current, token);
        }

        lines.push(current);
        return lines;
    }

    /** Resolved CSS font string for a token. */
    public static fontFor(token: RichToken, fontFamily: string): string {
        const weight = token.style.bold ? "bold" : "";
        const slant = token.style.italic ? "italic" : "";
        const prefix = `${slant} ${weight}`.trim();
        return `${prefix ? prefix + " " : ""}${token.size}px ${fontFamily}`;
    }

    /** The widest line's width, for `preferredWidth`. */
    public static widestLine(lines: readonly RichLine[]): number {
        let widest = 0;
        for (const line of lines) {
            if (line.width > widest) widest = line.width;
        }
        return widest;
    }

    // ── private ──────────────────────────────────────────────────────

    private static _append(line: RichLine, token: RichToken): void {
        line.tokens.push(token);
        line.width += token.width;
        if (token.size > line.maxSize) line.maxSize = token.size;
    }

    private static _sizeOf(style: RichStyle, baseSize: number): number {
        return style.size !== null ? style.size : baseSize;
    }

    private static _measure(
        ctx: CanvasRenderingContext2D,
        text: string,
        style: RichStyle,
        baseSize: number,
        fontFamily: string,
        canBreak: boolean,
    ): RichToken {
        const size = RichText._sizeOf(style, baseSize);
        const token: RichToken = { text, style, size, width: 0, canBreak, hardBreak: false };
        ctx.font = RichText.fontFor(token, fontFamily);
        token.width = ctx.measureText(text).width;
        return token;
    }

    /** Splits an over-wide token into pieces that each fit `maxWidth`. */
    private static _breakToken(
        ctx: CanvasRenderingContext2D,
        token: RichToken,
        maxWidth: number,
        fontFamily: string,
    ): RichToken[] {
        ctx.font = RichText.fontFor(token, fontFamily);

        const parts: RichToken[] = [];
        let chunk = "";

        for (const ch of token.text) {
            const test = chunk + ch;
            if (chunk && ctx.measureText(test).width > maxWidth) {
                parts.push({
                    text: chunk, style: token.style, size: token.size,
                    width: ctx.measureText(chunk).width, canBreak: true, hardBreak: false,
                });
                chunk = ch;
            } else {
                chunk = test;
            }
        }

        parts.push({
            text: chunk, style: token.style, size: token.size,
            width: ctx.measureText(chunk).width, canBreak: true, hardBreak: false,
        });
        return parts;
    }

    /** Pushes or pops one tag on the style stack. */
    private static _applyTag(
        stack: RichStyle[],
        closing: boolean,
        tag: string,
        value: string | undefined,
    ): void {
        if (closing) {
            // Never pop the base style: an unbalanced `</b>` is ignored rather
            // than left to corrupt everything after it.
            if (stack.length > 1) stack.pop();
            return;
        }

        if (stack.length >= MAX_TAG_DEPTH) return;

        const top = stack[stack.length - 1];
        const next: RichStyle = {
            bold: top.bold,
            italic: top.italic,
            color: top.color,
            size: top.size,
        };

        switch (tag) {
            case "b": next.bold = true; break;
            case "i": next.italic = true; break;
            case "color": {
                const parsed = RichText._parseColor(value);
                if (parsed) next.color = parsed;
                break;
            }
            case "size": {
                const parsed = Number.parseFloat(value ?? "");
                if (Number.isFinite(parsed) && parsed > 0) next.size = parsed;
                break;
            }
        }

        stack.push(next);
    }

    /** Parses `#rgb`, `#rrggbb`, `#rrggbbaa` or a few named colours. */
    private static _parseColor(value: string | undefined): Color | null {
        if (!value) return null;
        const text = value.trim().toLowerCase();

        if (text.startsWith("#")) {
            const hex = text.substring(1);
            const expand = (c: string): number => Number.parseInt(c + c, 16) / 255;
            const byte = (at: number): number => Number.parseInt(hex.substr(at, 2), 16) / 255;

            if (hex.length === 3) {
                return new Color(expand(hex[0]), expand(hex[1]), expand(hex[2]), 1);
            }
            if (hex.length === 6) return new Color(byte(0), byte(2), byte(4), 1);
            if (hex.length === 8) return new Color(byte(0), byte(2), byte(4), byte(6));
            return null;
        }

        // The handful Unity names and a scenario is likely to reach for. An
        // unknown name is a no-op, so the text keeps the label's own colour.
        switch (text) {
            case "red":     return new Color(1, 0, 0, 1);
            case "green":   return new Color(0, 1, 0, 1);
            case "blue":    return new Color(0, 0, 1, 1);
            case "yellow":  return new Color(1, 1, 0, 1);
            case "cyan":    return new Color(0, 1, 1, 1);
            case "magenta": return new Color(1, 0, 1, 1);
            case "white":   return new Color(1, 1, 1, 1);
            case "black":   return new Color(0, 0, 0, 1);
            case "grey":
            case "gray":    return new Color(0.5, 0.5, 0.5, 1);
            case "orange":  return new Color(1, 0.5, 0, 1);
            default:        return null;
        }
    }
}
