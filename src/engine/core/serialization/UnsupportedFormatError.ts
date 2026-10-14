/** The kind of saved file a reader was given. */
export type FormatKind = "scene" | "prefab" | "gameObject" | "material" | "physicMaterial";

const LABELS: Readonly<Record<FormatKind, string>> = {
    scene: "scene",
    prefab: "prefab",
    gameObject: "GameObject",
    material: "material",
    physicMaterial: "physic material",
};

function show(value: unknown): string {
    if (typeof value === "string") return JSON.stringify(value);
    if (value === undefined) return "undefined";
    if (value !== null && typeof value === "object") return Array.isArray(value) ? "an array" : "an object";
    return String(value);
}

function list(versions: readonly number[]): string {
    return versions.length === 1
        ? `version ${versions[0]}`
        : `versions ${versions.slice(0, -1).join(", ")} and ${versions[versions.length - 1]}`;
}

/**
 * Thrown when a saved file states a format version this build does not read.
 *
 * @remarks
 * Every reader of a versioned file — a scene, a prefab, a GameObject, a
 * material, a physic material — refuses the same way, before it loads or builds
 * anything, so a host can tell "this file is from a newer build" from a
 * corrupt one and say so in its own words: the fields carry what was found and
 * what is read, and nothing needs parsing out of {@link message}.
 *
 * A file is refused when its `version` is anything other than a whole number of
 * 1 or more that this build reads — `"2"`, `0`, `null` and `1.5` included. An
 * absent `version` means 1. {@link SceneSerializer.canRead} answers the same
 * question without throwing.
 */
export class UnsupportedFormatError extends Error {

    /**
     * The `version` the file stated, exactly as read: `3`, `"2"`, `null`. When the
     * file is not a JSON object at all, the value read in its place.
     */
    public readonly version: unknown;

    /** The versions this reader reads, ascending. */
    public readonly readable: readonly number[];

    /** What kind of file was being read. */
    public readonly what: FormatKind;

    constructor(what: FormatKind, version: unknown, readable: readonly number[]) {
        const label = LABELS[what];
        const known = typeof version === "number" && Number.isInteger(version) && version >= 1;
        super(
            known
                ? `[SceneSerializer] This ${label} was written in format version ${version}, which this ` +
                  `build of the engine cannot read (it reads ${list(readable)}). Update the engine.`
                : `[SceneSerializer] This ${label} has an invalid format version (${show(version)}): it must be ` +
                  `a whole number of 1 or more, and this build reads ${list(readable)}.`,
        );
        this.name = "UnsupportedFormatError";
        this.what = what;
        this.version = version;
        this.readable = Object.freeze([...readable]);
    }
}
