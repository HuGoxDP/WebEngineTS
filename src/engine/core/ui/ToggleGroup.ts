import { Behaviour } from "../Behaviour";
import type { Toggle } from "./Toggle";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/**
 * Makes a set of {@link Toggle}s behave as radio buttons: at most one on.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.UI.ToggleGroup`. Attach it anywhere and
 * point each member's {@link Toggle.group} at it — membership is by assignment,
 * not by hierarchy, so the toggles do not have to be siblings.
 *
 * ```ts
 * const group = panel.addComponent(ToggleGroup);
 * for (const answer of answers) answer.group = group;
 * ```
 */
@Serializable({ typeName: "ToggleGroup", category: "UI" })
export class ToggleGroup extends Behaviour {

    /**
     * Whether clicking the active toggle may turn it off, leaving none on.
     *
     * @remarks
     * `false` (the default) is the radio-button rule: once an answer is picked
     * the group always has one. Setting it while nothing is on does not force a
     * selection; it only constrains future clicks.
     */
    @SerializedField()
    public allowSwitchOff: boolean = false;

    private readonly _members: Set<Toggle> = new Set();

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    /** The toggle that is currently on, or null. */
    public get active(): Toggle | null {
        for (const toggle of this._members) {
            if (toggle.isOn) return toggle;
        }
        return null;
    }

    /** Every toggle currently registered with this group. */
    public get members(): readonly Toggle[] {
        return [...this._members];
    }

    /**
     * Turns every member off.
     *
     * @remarks
     * Ignores {@link allowSwitchOff}, since this is the deliberate "clear the
     * answer" action rather than a stray click.
     */
    public setAllTogglesOff(): void {
        for (const toggle of this._members) toggle._setFromGroup(false);
    }

    /** Whether any member is currently on. */
    public anyTogglesOn(): boolean {
        return this.active !== null;
    }

    /** @internal Adds a toggle. Called by Toggle when its group is assigned. */
    public _register(toggle: Toggle): void {
        this._members.add(toggle);
    }

    /** @internal Removes a toggle. */
    public _unregister(toggle: Toggle): void {
        this._members.delete(toggle);
    }

    /** @internal Whether `toggle` is the only member currently on. */
    public _isOnlyActive(toggle: Toggle): boolean {
        if (!toggle.isOn) return false;
        for (const other of this._members) {
            if (other !== toggle && other.isOn) return false;
        }
        return true;
    }

    /**
     * @internal
     * Turns the other members off after `toggle` came on. Goes through
     * `_setFromGroup` so a sibling cannot bounce the notification back here.
     */
    public _notifyTurnedOn(toggle: Toggle): void {
        for (const other of this._members) {
            if (other !== toggle) other._setFromGroup(false);
        }
    }
}
