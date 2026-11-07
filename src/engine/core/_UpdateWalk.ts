import type { GameObject } from "./GameObject.ts";

/**
 * @internal
 * Numbers the hierarchy walks of the per-frame passes, so that a GameObject
 * can tell whether it has already run in the walk that is reaching it, and
 * records the objects moved while a scene walk is open, so the walk can catch
 * up the ones it would otherwise miss.
 *
 * @remarks
 * Every `fixedUpdate`, `update` and `lateUpdate` walk — one per execution
 * order, one per fixed step — takes a new number, and each GameObject stamps
 * the number of the walk its components last ran in. An object that already
 * ran and was then moved under a parent the same walk visits later is reached
 * a second time; it finds its stamp and does not run again, as in Unity, where
 * a behaviour's callback runs at most once per pass whatever the hierarchy does.
 *
 * The converse — an object moved, before its turn, under a parent the walk
 * has already left — is never reached at all. While `Scene` has a walk open
 * ({@link _recordMovesFor}), `Transform.setParent` reports each moved object
 * here ({@link _noteMoved}); one that has not run in the walk and existed
 * before it began is kept in {@link _movedInWalk}, and `Scene` runs those that
 * are still unrun once the roots are done.
 *
 * A leaf module so that `Scene`, which only imports `GameObject` as a type,
 * can start a walk without a value import cycle. Numbers, not objects, so a
 * walk allocates nothing; the list is one array reused for the page's
 * lifetime and only grows when something is reparented mid-walk. At a few
 * walks per frame the count stays an exact integer for longer than any page
 * lives.
 */
let walkCount = 0;

/** The scene walk whose moves are being recorded, or `0` when none is open. */
let recording = 0;

/**
 * @internal
 * Objects moved while a scene walk was open that had not run in it. Entries
 * from `Scene`'s start index on belong to that walk; `Scene` truncates the
 * array back to that index when the walk closes, so between walks it is empty.
 */
export const _movedInWalk: GameObject[] = [];

/**
 * @internal
 * Starts a walk and returns its number, never `0` and never one returned before.
 */
export function _beginUpdateWalk(): number {
    return ++walkCount;
}

/**
 * @internal
 * The number of the most recently started walk — what a GameObject created
 * now records, so a walk can tell it did not exist when that walk began.
 */
export function _lastUpdateWalk(): number {
    return walkCount;
}

/**
 * @internal
 * Makes `walk` the walk whose moves are recorded (`0` stops recording) and
 * returns the one recorded before, for the caller to restore — a scene pass
 * run from inside another stays correct.
 */
export function _recordMovesFor(walk: number): number {
    const outer = recording;
    recording = walk;
    return outer;
}

/**
 * @internal
 * Called by `Transform.setParent` after `go` changed parent. Outside a scene
 * walk this does nothing.
 */
export function _noteMoved(go: GameObject): void {
    if (recording !== 0 && go._mayMissWalk(recording)) _movedInWalk.push(go);
}
