/** One asset's identity: a stable id and the path it currently lives at. */
export interface AssetEntry {
    /** Stable identity. Survives renaming and moving the file. */
    guid: string;
    /** Where the asset currently is, as `Resources` addresses it. */
    path: string;
}

/** Characters used by the fallback GUID minter. */
const HEX = "0123456789abcdef";

/**
 * Maps stable asset ids to paths and to the loaded instances behind them.
 *
 * @remarks
 * The engine addressed assets by **path** everywhere: `Resources` caches by
 * path, and a serialized reference could only be a path string. That makes
 * renaming a file a silent break — every scene pointing at it keeps pointing at
 * something that is no longer there — and it is why a scene cannot safely
 * reference a material at all today.
 *
 * This is the identity layer Unity's `AssetDatabase` provides: a GUID is the
 * reference, and the path is a lookup convenience that may change underneath
 * it. A scene stores `{ guid }`; moving or renaming the file updates only the
 * path side of the mapping.
 *
 * **Where GUIDs come from.** Authoring tools own them — a sidecar next to the
 * source file, written by ScenarioCreator or the editor — and supply them here
 * through {@link setManifest}. Without a manifest the database mints a
 * session-local id on first sight so references still resolve *within* a run;
 * those ids do not survive a reload, which is exactly the gap a manifest fills.
 *
 * ```ts
 * AssetDatabase.setManifest([
 *     { guid: "8f2c…", path: "textures/mars.png" },
 * ]);
 * const guid = AssetDatabase.guidOf(marsTexture);
 * ```
 */
export class AssetDatabase {

    private static readonly _pathByGuid: Map<string, string> = new Map();
    private static readonly _guidByPath: Map<string, string> = new Map();
    private static readonly _assetByGuid: Map<string, object> = new Map();
    private static readonly _guidByAsset: WeakMap<object, string> = new WeakMap();

    private constructor() {}

    /**
     * Declares the assets an archive contains and the id of each.
     *
     * @remarks
     * Replaces any previous manifest, so loading a new scenario starts from a
     * clean mapping. Already-loaded instances keep their ids: an entry whose
     * guid is unchanged keeps pointing at the same object.
     *
     * @param entries - the archive's asset identities.
     */
    public static setManifest(entries: readonly AssetEntry[]): void {
        AssetDatabase._pathByGuid.clear();
        AssetDatabase._guidByPath.clear();

        for (const entry of entries) {
            const path = AssetDatabase._normalize(entry.path);
            AssetDatabase._pathByGuid.set(entry.guid, path);
            AssetDatabase._guidByPath.set(path, entry.guid);
        }
    }

    /**
     * The id of the asset at `path`, minting one if this path is new.
     *
     * @param path - path as `Resources` addresses it.
     */
    public static guidForPath(path: string): string {
        const key = AssetDatabase._normalize(path);
        const existing = AssetDatabase._guidByPath.get(key);
        if (existing !== undefined) return existing;

        const guid = AssetDatabase._mintGuid();
        AssetDatabase._guidByPath.set(key, guid);
        AssetDatabase._pathByGuid.set(guid, key);
        return guid;
    }

    /** The path an id currently resolves to, or `null` if unknown. */
    public static pathOf(guid: string): string | null {
        return AssetDatabase._pathByGuid.get(guid) ?? null;
    }

    /** The id of a loaded asset, or `null` if it was never registered. */
    public static guidOf(asset: object | null | undefined): string | null {
        if (!asset) return null;
        return AssetDatabase._guidByAsset.get(asset) ?? null;
    }

    /** The loaded instance behind an id, or `null` if it is not in memory. */
    public static get(guid: string): object | null {
        return AssetDatabase._assetByGuid.get(guid) ?? null;
    }

    /** Whether an id has a loaded instance behind it right now. */
    public static isLoaded(guid: string): boolean {
        return AssetDatabase._assetByGuid.has(guid);
    }

    /**
     * @internal
     * Binds a freshly decoded asset to the path it came from. Called by
     * `Resources` on every successful load, which is what gives a loaded object
     * an identity without every call site having to think about it.
     *
     * @param path - the path the asset was loaded from.
     * @param asset - the decoded instance.
     */
    public static _bind(path: string, asset: object | null | undefined): void {
        if (!asset || typeof asset !== "object") return;

        const guid = AssetDatabase.guidForPath(path);
        AssetDatabase._assetByGuid.set(guid, asset);
        AssetDatabase._guidByAsset.set(asset, guid);
    }

    /**
     * @internal
     * Binds an in-memory asset to an id directly, with no path involved.
     *
     * @remarks
     * For assets a scene carries inside itself rather than loading — a material
     * value-serialized into the scene file. They have an identity so that
     * sharing survives a round trip, but no file to be found at.
     *
     * @param guid - the id the scene stored it under.
     * @param asset - the rebuilt instance.
     */
    public static _bindGuid(guid: string, asset: object): void {
        AssetDatabase._assetByGuid.set(guid, asset);
        AssetDatabase._guidByAsset.set(asset, guid);
    }

    /**
     * @internal
     * Forgets a destroyed asset's instance, keeping its path↔guid mapping.
     *
     * @remarks
     * Destruction removes the *instance*, not the identity: the file is still
     * at its path and the guid still names it, so a scene referring to it must
     * keep resolving once it is loaded again. What must not survive is the
     * pointer to the dead object — `isLoaded` means "in memory right now", and
     * without this it answered `true` for something already destroyed, handing
     * `get` a disposed texture.
     *
     * @param asset - the instance being destroyed.
     */
    public static _unbind(asset: object | null | undefined): void {
        if (!asset || typeof asset !== "object") return;

        const guid = AssetDatabase._guidByAsset.get(asset);
        if (guid === undefined) return;

        AssetDatabase._guidByAsset.delete(asset);
        // Only if it is still the current instance — a reload may already have
        // bound a fresh one under the same id.
        if (AssetDatabase._assetByGuid.get(guid) === asset) {
            AssetDatabase._assetByGuid.delete(guid);
        }
    }

    /**
     * Records that an asset has moved.
     *
     * @remarks
     * The whole point of the id: references keep working, only the lookup
     * changes. A path that is not known is treated as a new asset.
     *
     * @param from - the path it was at.
     * @param to - the path it is at now.
     * @returns whether a mapping was actually moved.
     */
    public static movePath(from: string, to: string): boolean {
        const oldKey = AssetDatabase._normalize(from);
        const guid = AssetDatabase._guidByPath.get(oldKey);
        if (guid === undefined) return false;

        AssetDatabase._guidByPath.delete(oldKey);
        const newKey = AssetDatabase._normalize(to);
        AssetDatabase._guidByPath.set(newKey, guid);
        AssetDatabase._pathByGuid.set(guid, newKey);
        return true;
    }

    /** Every known identity, in insertion order. */
    public static get entries(): readonly AssetEntry[] {
        const out: AssetEntry[] = [];
        for (const [guid, path] of AssetDatabase._pathByGuid) out.push({ guid, path });
        return out;
    }

    /**
     * Forgets every mapping and every loaded instance.
     *
     * @remarks
     * Called when a scenario unloads. Does not destroy the assets themselves —
     * `Resources` owns their lifetime.
     */
    public static clear(): void {
        AssetDatabase._pathByGuid.clear();
        AssetDatabase._guidByPath.clear();
        AssetDatabase._assetByGuid.clear();
    }

    /** Drops only the loaded instances, keeping the id ↔ path mapping. */
    public static clearLoaded(): void {
        AssetDatabase._assetByGuid.clear();
    }

    private static _normalize(path: string): string {
        return path.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
    }

    /**
     * A session-local id, used when no manifest supplied one.
     *
     * @remarks
     * Deliberately random rather than derived from the path: a path-derived id
     * would change when the file moves, which is the one thing an id must not
     * do. `crypto.randomUUID` when available, a plain 32-hex fallback otherwise
     * — these never leave the session, so they need no cryptographic strength.
     */
    private static _mintGuid(): string {
        const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
        if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");

        let out = "";
        for (let i = 0; i < 32; i++) out += HEX[(Math.random() * 16) | 0];
        return out;
    }
}
