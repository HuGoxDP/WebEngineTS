import type { IEngineBuildInfo } from "../BuildInfo.ts";

/**
 * @internal
 * The major versions of a scenario manifest's `manifestVersion` this build
 * reads. A minor bump is additive and passes; a new major is a manifest this
 * build would misread, so it is refused instead.
 */
export const MANIFEST_MAJOR_VERSIONS: readonly number[] = Object.freeze([1]);

const VERSION_NUMBER = /^(\d+)(?:\.\d+)*$/;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/** Engine versions already warned about, so a page that loads several scenarios says it once. */
const warned = new Set<string>();

/**
 * @internal
 * The major version of a `manifestVersion`: a string or number made of
 * dot-separated whole numbers (`"1"`, `"1.0"`, `"1.2.3"`, `1`), or null for
 * anything else (`"v1"`, `"1.0abc"`, `""`).
 */
export function manifestMajorOf(value: unknown): number | null {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const match = VERSION_NUMBER.exec(String(value));
    return match === null ? null : Number(match[1]);
}

/**
 * @internal
 * Throws unless this build reads the manifest's major version. The same rule
 * the platform applies at upload (`player-formats.js`), so a manifest it stores
 * is one the player reads.
 */
export function refuseUnreadableManifestVersion(value: unknown): void {
    const reads = MANIFEST_MAJOR_VERSIONS.map(major => `${major}.x`).join(", ");
    const major = manifestMajorOf(value);

    if (major === null) {
        throw new Error(
            `[Scenario] The manifest's manifestVersion is not a version number (${JSON.stringify(value)}); ` +
            `expected one such as "1.0", and this build reads ${reads}.`,
        );
    }
    if (!MANIFEST_MAJOR_VERSIONS.includes(major)) {
        throw new Error(
            `[Scenario] This scenario requires a newer engine (manifestVersion ${String(value)}; ` +
            `this build reads ${reads}). Update the engine.`,
        );
    }
}

/**
 * @internal
 * Warns, once per pair of versions, when a manifest asks for a newer engine
 * than the one running. Never refuses: `engineVersion` states what the scenario
 * was built against, not a promise that it breaks on anything older.
 *
 * Only `major.minor` is compared, so a pre-release stamp such as
 * `0.1.0-local.<timestamp>` never counts as newer or older; and nothing is said
 * when the engine is running from its sources, which has no version to compare.
 */
export function warnIfBuiltForNewerEngine(required: unknown, build: IEngineBuildInfo, scenario?: string): void {
    if (!build.isBuild || typeof required !== "string") return;

    const wanted = SEMVER.exec(required);
    const running = SEMVER.exec(build.version);
    if (wanted === null || running === null) return;

    const newer = Number(wanted[1]) !== Number(running[1])
        ? Number(wanted[1]) > Number(running[1])
        : Number(wanted[2]) > Number(running[2]);
    if (!newer) return;

    const key = `${required}|${build.version}`;
    if (warned.has(key)) return;
    warned.add(key);

    console.warn(
        `[Scenario] ${scenario === undefined ? "This scenario" : `"${scenario}"`} was built for engine ` +
        `${required}, which is newer than this build (${build.version}). It may use features this ` +
        `build does not have.`,
    );
}
