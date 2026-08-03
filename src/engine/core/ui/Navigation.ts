import { Vector2 } from "../math/Vector2";
import type { Selectable } from "./Selectable";

/** How a {@link Selectable} decides where focus goes next. */
export enum NavigationMode {
    /** Focus never moves off this control by keyboard. */
    None = "None",
    /** Focus moves to the nearest control in the pressed direction. */
    Automatic = "Automatic",
    /** Focus follows the explicit links on {@link Navigation}. */
    Explicit = "Explicit",
}

/**
 * Which direction focus is being moved in.
 *
 * @remarks
 * Named for the screen, so `Down` is toward larger Y — the Y-down convention
 * the rest of this UI uses.
 */
export enum NavigationDirection {
    Left = "Left",
    Right = "Right",
    Up = "Up",
    Down = "Down",
}

/**
 * Keyboard focus routing for one {@link Selectable}.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.Navigation`. {@link NavigationMode.Automatic}
 * is enough for most layouts; the explicit links exist for the cases where
 * "nearest in that direction" is not what the author means, such as wrapping
 * from the last row back to the first.
 */
export class Navigation {

    /** How the next control is chosen. */
    public mode: NavigationMode = NavigationMode.Automatic;

    /** Control to focus on Left, when {@link mode} is Explicit. */
    public selectOnLeft: Selectable | null = null;

    /** Control to focus on Right, when {@link mode} is Explicit. */
    public selectOnRight: Selectable | null = null;

    /** Control to focus on Up, when {@link mode} is Explicit. */
    public selectOnUp: Selectable | null = null;

    /** Control to focus on Down, when {@link mode} is Explicit. */
    public selectOnDown: Selectable | null = null;

    /** The explicit link for `direction`, or null. */
    public get(direction: NavigationDirection): Selectable | null {
        switch (direction) {
            case NavigationDirection.Left:  return this.selectOnLeft;
            case NavigationDirection.Right: return this.selectOnRight;
            case NavigationDirection.Up:    return this.selectOnUp;
            default:                        return this.selectOnDown;
        }
    }
}

/**
 * @internal
 * Unit vector for a direction, in canvas space where Y grows downward.
 */
export function directionVector(direction: NavigationDirection, out: Vector2): Vector2 {
    switch (direction) {
        case NavigationDirection.Left:  return out.set(-1, 0);
        case NavigationDirection.Right: return out.set(1, 0);
        case NavigationDirection.Up:    return out.set(0, -1);
        default:                        return out.set(0, 1);
    }
}
