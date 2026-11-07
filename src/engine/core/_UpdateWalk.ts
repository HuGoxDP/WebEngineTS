/**
 * @internal
 * Numbers the hierarchy walks of the per-frame passes, so that a GameObject
 * can tell whether it has already run in the walk that is reaching it.
 *
 * @remarks
 * Every `fixedUpdate`, `update` and `lateUpdate` walk — one per execution
 * order, one per fixed step — takes a new number, and each GameObject stamps
 * the number of the walk its components last ran in. An object that already
 * ran and was then moved under a parent the same walk visits later is reached
 * a second time; it finds its stamp and does not run again, as in Unity, where
 * a behaviour's callback runs at most once per pass whatever the hierarchy does.
 *
 * A leaf module so that `Scene`, which only imports `GameObject` as a type,
 * can start a walk without a value import cycle. A number, not an object, so a
 * walk allocates nothing; at a few walks per frame it stays an exact integer
 * for longer than any page lives.
 */
let walkCount = 0;

/**
 * @internal
 * Starts a walk and returns its number, never `0` and never one returned before.
 */
export function _beginUpdateWalk(): number {
    return ++walkCount;
}
