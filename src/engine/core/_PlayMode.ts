// path: src/engine/core/_PlayMode.ts

/**
 * @internal
 * Whether the engine runs in the editor's edit mode rather than in play mode
 * — one boolean, consulted by the script lifecycle and the per-frame passes.
 *
 * @remarks
 * Unity's distinction: a user script's `awake`, the per-frame callbacks and
 * physics run in play mode; in edit mode a script runs only when the class
 * says it may (`[ExecuteInEditMode]`, `[ExecuteAlways]`), and `fixedUpdate`
 * never runs at all. Built-ins behave the same in both modes, because the
 * editor's viewport has to show the scene it is editing.
 *
 * The default is play mode: nothing changes for a host that never calls
 * {@link Application.enterEditMode}, which keeps every existing consumer —
 * scenarios, the editor's Play, tests — exactly as they were.
 *
 * A leaf module, like {@link _UpdateWalk}: `Application` owns the switches and
 * everything else only reads, so no module can import its way to a cycle.
 */

let _editMode = false;

/** Whether the engine currently runs in edit mode. */
export function _isEditMode(): boolean {
    return _editMode;
}

/** Switches the mode. Engine-internal: a host goes through {@link Application}. */
export function _setEditMode(value: boolean): void {
    _editMode = value;
}
