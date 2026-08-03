import { Color } from "../math/Color";
import type { Sprite } from "../graphics/Sprite";

/** How a {@link Selectable} shows its interaction state. */
export enum SelectableTransition {
    /** No automatic visual change; the control draws whatever it likes. */
    None = "None",
    /** Tints {@link Selectable.targetGraphic} per state, with a fade. */
    ColorTint = "ColorTint",
    /** Swaps {@link Selectable.targetGraphic}'s sprite per state. */
    SpriteSwap = "SpriteSwap",
}

/**
 * The colors a {@link SelectableTransition.ColorTint} moves between.
 *
 * @remarks
 * Equivalent to Unity's `ColorBlock`. Colors are multiplied by
 * {@link colorMultiplier}, so one block can drive a washed-out or an
 * over-bright variant of the same palette.
 */
export class ColorBlock {

    /** Tint while idle. */
    public normalColor: Color = Color.white.clone();

    /** Tint while the pointer is over the control. */
    public highlightedColor: Color = new Color(0.96, 0.96, 0.96, 1);

    /** Tint while the control is held down. */
    public pressedColor: Color = new Color(0.78, 0.78, 0.78, 1);

    /** Tint while the control holds focus. */
    public selectedColor: Color = new Color(0.96, 0.96, 0.96, 1);

    /** Tint while the control is not interactable. */
    public disabledColor: Color = new Color(0.78, 0.78, 0.78, 0.5);

    /** Scales every color above. `1` leaves them alone. */
    public colorMultiplier: number = 1;

    /** Seconds a tint change takes. `0` snaps. */
    public fadeDuration: number = 0.1;
}

/**
 * The sprites a {@link SelectableTransition.SpriteSwap} moves between.
 *
 * @remarks
 * Equivalent to Unity's `SpriteState`. The normal sprite is whatever
 * {@link Selectable.targetGraphic} already carries, so only the other states
 * need naming — and a `null` state falls back to it.
 */
export class SpriteState {

    /** Sprite while the pointer is over the control. */
    public highlightedSprite: Sprite | null = null;

    /** Sprite while the control is held down. */
    public pressedSprite: Sprite | null = null;

    /** Sprite while the control holds focus. */
    public selectedSprite: Sprite | null = null;

    /** Sprite while the control is not interactable. */
    public disabledSprite: Sprite | null = null;
}
