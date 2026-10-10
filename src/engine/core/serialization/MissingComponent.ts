import { Component } from "../Component";

/**
 * Stands in for a component whose class is not registered, and carries its saved
 * data through unchanged.
 *
 * @remarks
 * Unity's "Missing (Mono Script)". A scene that mentions a component type the
 * running code does not know — a script that failed to compile, a package that
 * is not installed, a scene written by a newer build — used to lose that
 * component on load, and so on the next save: the serializer skipped it, the
 * live scene never held it, and the file written back no longer did either.
 * Opening a scene and saving it should not be able to delete someone's work.
 *
 * A `MissingComponent` holds the type name and the fields exactly as read, does
 * nothing at runtime, and is written back exactly as read. Once the type is
 * registered, loading the same scene again produces the real component from the
 * preserved data.
 *
 * It is deliberately not `@Serializable`: it has no type name of its own to
 * register, and the scene serializer handles it by name of what it replaced.
 *
 * References *to* a missing component survive, since they are written by the
 * original type name. References *held by* one are kept as the file had them —
 * paths into the hierarchy — and so go stale if objects are reordered while the
 * component is missing.
 */
export class MissingComponent extends Component {

    /** The type name the saved scene used. */
    public originalType: string = "";

    /** The saved fields, JSON as read and never interpreted. */
    public originalFields: Record<string, unknown> = {};
}

/**
 * Stands in for a nested value (a `@Serializable` struct that is neither a
 * component nor an asset) whose class is not registered. The counterpart of
 * {@link MissingComponent} for values: held as read, written back as read.
 */
export class MissingValue {

    constructor(
        /** The type name the saved scene used. */
        public readonly type: string,
        /** The saved fields, JSON as read and never interpreted. */
        public readonly fields: Record<string, unknown>,
    ) {}
}
