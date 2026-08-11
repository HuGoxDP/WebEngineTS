// path: src/engine/core/assets/ZipAssetSource.ts

import type JSZip from "jszip";
import type { IAssetSource } from "./Resources.ts";
import { mimeTypeForPath } from "./_AssetMime.ts";

/**
 * An {@link IAssetSource} backed by an in-memory ZIP archive.
 *
 * @remarks
 * The original asset source, extracted from `ScenarioAssets` so the two ways a
 * scenario's bytes can arrive — one archive or many fetches — are two
 * interchangeable objects rather than two branches inside the provider. Its
 * counterpart is `StreamingAssetSource`.
 *
 * Paths are archive-relative and used verbatim (`"assets/textures/earth.png"`,
 * `"scripts/main.js"`), with no prefix normalization: a ZIP is a filesystem and
 * the caller already knows where it put things.
 *
 * Blob URLs handed out by {@link getBlobUrl} are tracked and revoked by
 * {@link dispose}, so nothing outlives the scenario that asked for it.
 *
 * @internal — engine-only. Scenario authors use `Resources`.
 */
export class ZipAssetSource implements IAssetSource {

    /** The archive. Null once {@link release} or {@link dispose} has run. */
    private _zip: JSZip | null;

    private readonly _blobUrls: string[] = [];

    /**
     * @param zip - a parsed JSZip instance holding the scenario archive.
     */
    constructor(zip: JSZip) {
        this._zip = zip;
    }

    /** Whether the archive has been dropped and reads would now throw. */
    public get isReleased(): boolean {
        return this._zip === null;
    }

    /**
     * Drops the archive, freeing the decompressed data JSZip holds.
     *
     * @remarks
     * Reads after this throw rather than returning nothing — a scenario that
     * released too early has a bug, and a silent empty read would hide it until
     * a texture failed to appear. Blob URLs already handed out stay valid;
     * {@link dispose} is what revokes them.
     */
    public release(): void {
        this._zip = null;
    }

    /** Revokes every blob URL handed out, then drops the archive. */
    public dispose(): void {
        for (const url of this._blobUrls) URL.revokeObjectURL(url);
        this._blobUrls.length = 0;
        this._zip = null;
    }

    // ==================== SCRIPTS ====================

    /**
     * Every `.js` module under the archive's `scripts/` directory.
     *
     * @remarks
     * Directory entries and non-JavaScript files are skipped, and separators
     * are folded to `/` — a ZIP written by a Windows tool may use backslashes,
     * and the pre-linker resolves relative imports by string path.
     */
    public listScripts(): readonly string[] {
        return this.list("scripts/")
            .map(path => path.replace(/\\/g, "/"))
            .filter(path => path.endsWith(".js"));
    }

    /**
     * Reads one module's source text.
     *
     * @param path — a script path, with or without the `scripts/` prefix.
     */
    public async readScript(path: string): Promise<string> {
        return this.readText(path.startsWith("scripts/") ? path : `scripts/${path}`);
    }

    // ==================== IAssetSource ====================

    /** @internal */
    public has(path: string): boolean {
        return this._zip !== null && this._zip.file(path) !== null;
    }

    /** @internal */
    public list(prefix?: string): string[] {
        if (this._zip === null) return [];
        const paths: string[] = [];
        this._zip.forEach((relativePath) => {
            if (!prefix || relativePath.startsWith(prefix)) paths.push(relativePath);
        });
        return paths;
    }

    /** @internal */
    public async readBytes(path: string): Promise<Uint8Array> {
        const buffer = await this._file(path).async("arraybuffer");
        return new Uint8Array(buffer);
    }

    /** @internal */
    public async readText(path: string): Promise<string> {
        return this._file(path).async("text");
    }

    /** @internal */
    public async getBlobUrl(path: string): Promise<string> {
        const data = await this._file(path).async("arraybuffer");
        const blob = new Blob([data], { type: mimeTypeForPath(path) });
        const url = URL.createObjectURL(blob);
        this._blobUrls.push(url);
        return url;
    }

    // ==================== PRIVATE ====================

    private _file(path: string): JSZip.JSZipObject {
        if (this._zip === null) {
            throw new Error(
                "[ZipAssetSource] The archive has been released. " +
                "No further asset loading is possible."
            );
        }
        const file = this._zip.file(path);
        if (!file) throw new Error(`[ZipAssetSource] File not found: ${path}`);
        return file;
    }
}
