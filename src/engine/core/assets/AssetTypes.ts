// path: src/engine/core/assets/AssetTypes.ts

import { EngineObject } from "../EngineObject.ts";

/**
 * Wraps parsed JSON data loaded from the scenario archive.
 *
 * @remarks Equivalent to Unity's `TextAsset` when loading JSON.
 *
 * @example
 * ```ts
 * const config = await Resources.load(JsonAsset, "data/config");
 * const maxHp = (config.data as any).player.maxHealth;
 * ```
 */
export class JsonAsset extends EngineObject {
    /** The parsed JSON data. */
    public readonly data: unknown;

    constructor(data: unknown) {
        super();
        this.data = data;
    }

    /**
     * Returns the data cast to type T for convenience.
     *
     * @example
     * ```ts
     * interface LevelConfig { width: number; height: number; }
     * const cfg = config.as<LevelConfig>();
     * ```
     */
    public as<T>(): T {
        return this.data as T;
    }
}

/**
 * Wraps raw text content loaded from the scenario archive.
 *
 * @remarks Equivalent to Unity's `TextAsset`.
 *
 * @example
 * ```ts
 * const dialogue = await Resources.load(TextAsset, "data/intro");
 * console.log(dialogue.text);
 * ```
 */
export class TextAsset extends EngineObject {
    /** The text content (UTF-8 decoded). */
    public readonly text: string;

    constructor(text: string) {
        super();
        this.text = text;
    }

    /** Number of characters. */
    public get length(): number {
        return this.text.length;
    }

    /**
     * The text split into lines.
     *
     * @remarks
     * All three line endings are accepted — `\n`, `\r\n` and a lone `\r` — so a
     * file authored on Windows does not yield lines with a trailing carriage
     * return. A trailing newline produces a final empty string, as
     * `String.split` does.
     */
    public get lines(): string[] {
        return this.text.split(/\r\n|\r|\n/);
    }
}

/**
 * Wraps raw binary data loaded from the scenario archive.
 *
 * @remarks Useful for custom binary formats, navmesh data, etc.
 *
 * @example
 * ```ts
 * const nav = await Resources.load(BinaryAsset, "data/navmesh.bin");
 * // Offset and length included: the array may be a view into a larger buffer.
 * const view = new DataView(nav.bytes.buffer, nav.bytes.byteOffset, nav.bytes.byteLength);
 * ```
 */
export class BinaryAsset extends EngineObject {
    /** The raw byte array. */
    public readonly bytes: Uint8Array;

    constructor(bytes: Uint8Array) {
        super();
        this.bytes = bytes;
    }

    /** Byte length. */
    public get length(): number {
        return this.bytes.byteLength;
    }
}