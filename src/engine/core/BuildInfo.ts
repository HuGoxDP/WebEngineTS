// path: src/engine/core/BuildInfo.ts

// The two placeholders below are rewritten at build time by the
// `stamp-build-info` plugin in `rollup.config.mjs`, which fails the build if it
// cannot find them — so edit them together.
//
// They are *string literals* rather than a recognisable declaration because the
// plugin runs after TypeScript has already compiled this module, whatever the
// plugin array order: the type annotations are gone by then, but a string
// literal survives compilation untouched. Each token must appear exactly once,
// which is why the "is this stamped?" test below matches a shorter prefix
// instead of comparing against a whole token.
const _VERSION: string = "__WEBENGINE_VERSION__";
const _BUILT_AT: string = "__WEBENGINE_BUILT_AT__";

/** False when the engine is running from its own sources rather than a build. */
const _STAMPED: boolean = !_VERSION.startsWith("__WEBENGINE_");

/** What a build of the engine calls itself. */
export interface IEngineBuildInfo {
    /**
     * The package version this bundle was built from.
     *
     * @remarks
     * `"0.0.0-source"` when the engine is running from its own sources — tests
     * and the dev entry point — rather than from a build.
     */
    readonly version: string;

    /**
     * When the bundle was built, ISO-8601, or `null` when running from source.
     *
     * @remarks
     * **This, not {@link version}, is what identifies a build.** The repo keeps
     * `version` fixed at `0.1.0` between real releases while the content changes
     * on every local pack, so two bundles that differ entirely still agree on
     * their version. The timestamp is what tells them apart.
     */
    readonly builtAt: string | null;

    /** Whether this is a real build rather than sources loaded directly. */
    readonly isBuild: boolean;
}

/**
 * Identity of the engine build the host is running.
 *
 * @remarks
 * Exists because "which engine build is this?" was previously unanswerable at
 * run time: the version was a string literal in `Application`, maintained by
 * hand beside `package.json` and free to drift from it. It is now stamped from
 * `package.json` during the build, so the two cannot disagree.
 *
 * A host that quotes measurements should record {@link IEngineBuildInfo.builtAt}
 * beside them — a frame time is only reproducible against a named build.
 *
 * @example
 * ```ts
 * import { BuildInfo } from "WebEngineTS";
 *
 * console.log(BuildInfo.isBuild
 *     ? `engine ${BuildInfo.version} (${BuildInfo.builtAt})`
 *     : "engine running from source");
 * ```
 */
export const BuildInfo: IEngineBuildInfo = Object.freeze({
    version: _STAMPED ? _VERSION : "0.0.0-source",
    builtAt: _STAMPED ? _BUILT_AT : null,
    isBuild: _STAMPED,
});
