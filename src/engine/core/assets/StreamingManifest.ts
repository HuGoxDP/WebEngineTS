/**
 * How urgently an asset is wanted.
 *
 * @remarks
 * Declared by the packaging tool, read by the loader. Only
 * {@link AssetPriority.Lazy} changes behaviour today — the priority queue that
 * orders the rest is Stage 2 of `design/asset-streaming-proposal.md`. Recording
 * it now means a manifest written today is still correct then.
 */
export enum AssetPriority {
    /** Needed before the first frame can be shown. */
    Critical = "critical",
    /** Wanted early, but the scene can be drawn without it. */
    High = "high",
    /** Fetched once the important assets are in. */
    Low = "low",
    /** Fetched only when something actually asks for it. */
    Lazy = "lazy",
}

/** One detail level of a streamed asset. */
export interface IStreamedAssetLod {
    /** Detail level; 0 is the coarsest. Higher is more detailed. */
    level: number;
    /**
     * Where the bytes live.
     *
     * @remarks
     * Resolved against the manifest's `baseUrl`, so a content-addressed store
     * can publish `"a/9f3c…c1.ktx2"` and move the origin without a reissue.
     */
    url: string;
    /** Size in bytes, when the packaging tool recorded it. */
    bytes?: number;
    /** Content hash, e.g. `"sha256-9f3c…"`. Informational for now. */
    hash?: string;
}

/** One asset in a {@link IStreamingManifest}. */
export interface IStreamedAsset {
    /**
     * The path scenario code addresses this asset by.
     *
     * @remarks
     * Normalized to the `assets/` prefix the {@link Resources} path resolver
     * uses, so a manifest may write either form.
     */
    path: string;
    /**
     * Stable identity, so a serialized scene can reference the asset by id
     * rather than by the path it happens to have today.
     */
    guid?: string;
    /** Asset kind, e.g. `"texture"`. Informational — the decoder is chosen by extension. */
    type?: string;
    /** How urgently it is wanted. Defaults to {@link AssetPriority.High}. */
    priority: AssetPriority;
    /** Detail levels, ascending. Always at least one. */
    lods: IStreamedAssetLod[];
}

/**
 * The streaming manifest: a small JSON document listing individually
 * fetchable assets, loaded before anything else.
 *
 * @remarks
 * The alternative to the monolithic scenario ZIP, and the thing that makes
 * progressive loading, LOD streaming and cross-scenario dedup expressible at
 * all — see `design/asset-streaming-proposal.md` §3.1. This is the schema the
 * engine reads; producing it is the packaging tool's job.
 *
 * ```jsonc
 * {
 *   "schema": 1,
 *   "id": "solar-system",
 *   "baseUrl": "https://cdn.example.org/a/",
 *   "assets": [
 *     {
 *       "path": "textures/earth.ktx2",
 *       "guid": "9f3c...c1",
 *       "priority": "critical",
 *       "lods": [
 *         { "level": 0, "url": "1a...512.ktx2",  "bytes": 180000 },
 *         { "level": 1, "url": "2b...2048.ktx2", "bytes": 720000 }
 *       ]
 *     }
 *   ]
 * }
 * ```
 */
export interface IStreamingManifest {
    /** Schema version. Only `1` is understood. */
    schema: number;
    /** Scenario identifier this manifest belongs to. */
    id: string;
    /** Content version, bumped by the packaging tool. */
    version?: number;
    /** Base every asset URL is resolved against. */
    baseUrl?: string;
    /** The assets, in the order the manifest listed them. */
    assets: IStreamedAsset[];
}

/** The schema version this engine understands. */
const SCHEMA_VERSION = 1;

/**
 * Parses and validates a streaming manifest.
 *
 * @remarks
 * Strict on purpose. A manifest is written by a tool and read by a loader with
 * no user in between, so a malformed one has to fail where it can still be
 * pointed at — not later, as a texture that silently never appears.
 *
 * Normalizes as it goes: asset paths gain the `assets/` prefix the resolver
 * uses, LODs are sorted ascending by level, and a missing priority becomes
 * {@link AssetPriority.High}.
 *
 * @param json - the parsed JSON document.
 * @returns the validated manifest.
 * @throws if the document is not a manifest this engine can load.
 */
export function parseStreamingManifest(json: unknown): IStreamingManifest {
    const root = _object(json, "manifest");

    const schema = root.schema;
    if (typeof schema !== "number") {
        throw new Error("[StreamingManifest] Missing 'schema'.");
    }
    if (schema !== SCHEMA_VERSION) {
        throw new Error(
            `[StreamingManifest] Unsupported schema ${schema}; this engine reads ${SCHEMA_VERSION}.`
        );
    }

    const id = root.id;
    if (typeof id !== "string" || id.length === 0) {
        throw new Error("[StreamingManifest] Missing 'id'.");
    }

    const rawAssets = root.assets;
    if (!Array.isArray(rawAssets)) {
        throw new Error("[StreamingManifest] Missing 'assets' array.");
    }

    const seen = new Set<string>();
    const assets: IStreamedAsset[] = rawAssets.map((raw, index) => {
        const asset = _parseAsset(raw, index);
        if (seen.has(asset.path)) {
            throw new Error(`[StreamingManifest] Duplicate asset path "${asset.path}".`);
        }
        seen.add(asset.path);
        return asset;
    });

    const manifest: IStreamingManifest = { schema, id, assets };
    if (typeof root.version === "number") manifest.version = root.version;
    if (typeof root.baseUrl === "string") manifest.baseUrl = root.baseUrl;
    return manifest;
}

/**
 * Normalizes an asset path to the form the resolver looks up.
 *
 * @remarks
 * `Resources` prefixes every lookup with `assets/`; a manifest that writes the
 * prefix and one that omits it must mean the same file. Backslashes are folded
 * to forward slashes so a manifest generated on Windows still resolves.
 *
 * @param path - the path as written in the manifest.
 */
export function normalizeAssetPath(path: string): string {
    const forward = path.replace(/\\/g, "/").replace(/^\.?\//, "");
    return forward.startsWith("assets/") ? forward : `assets/${forward}`;
}

function _parseAsset(raw: unknown, index: number): IStreamedAsset {
    const where = `assets[${index}]`;
    const obj = _object(raw, where);

    if (typeof obj.path !== "string" || obj.path.length === 0) {
        throw new Error(`[StreamingManifest] ${where} is missing 'path'.`);
    }

    const rawLods = obj.lods;
    if (!Array.isArray(rawLods) || rawLods.length === 0) {
        throw new Error(`[StreamingManifest] ${where} needs at least one entry in 'lods'.`);
    }

    const lods: IStreamedAssetLod[] = rawLods.map((rawLod, lodIndex) => {
        const lod = _object(rawLod, `${where}.lods[${lodIndex}]`);
        if (typeof lod.url !== "string" || lod.url.length === 0) {
            throw new Error(`[StreamingManifest] ${where}.lods[${lodIndex}] is missing 'url'.`);
        }
        const level = typeof lod.level === "number" ? lod.level : lodIndex;
        const parsed: IStreamedAssetLod = { level, url: lod.url };
        if (typeof lod.bytes === "number") parsed.bytes = lod.bytes;
        if (typeof lod.hash === "string") parsed.hash = lod.hash;
        return parsed;
    });

    lods.sort((a, b) => a.level - b.level);

    const asset: IStreamedAsset = {
        path: normalizeAssetPath(obj.path),
        priority: _priority(obj.priority, where),
        lods,
    };
    if (typeof obj.guid === "string") asset.guid = obj.guid;
    if (typeof obj.type === "string") asset.type = obj.type;
    return asset;
}

function _priority(raw: unknown, where: string): AssetPriority {
    if (raw === undefined || raw === null) return AssetPriority.High;
    const values = Object.values(AssetPriority) as string[];
    if (typeof raw !== "string" || !values.includes(raw)) {
        throw new Error(
            `[StreamingManifest] ${where} has unknown priority "${String(raw)}";` +
            ` expected one of ${values.join(", ")}.`
        );
    }
    return raw as AssetPriority;
}

function _object(value: unknown, where: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`[StreamingManifest] ${where} must be an object.`);
    }
    return value as Record<string, unknown>;
}
