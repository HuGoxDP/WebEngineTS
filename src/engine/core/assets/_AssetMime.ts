// path: src/engine/core/assets/_AssetMime.ts

/**
 * MIME types for the file kinds an asset source hands out as blobs.
 *
 * @remarks
 * Shared because three places need the same table — the ZIP source, the
 * streaming source and `ScenarioAssets` — and a blob whose type is wrong is a
 * texture the browser declines to decode, which surfaces far from its cause.
 *
 * @internal
 */
const _MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ktx2": "image/ktx2",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".json": "application/json",
    ".js": "text/javascript",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
});

/**
 * The MIME type for a path's extension.
 *
 * @remarks
 * Falls back to `application/octet-stream`, which is what an unknown binary
 * blob honestly is.
 *
 * @param path - a file path or name; only the extension is read.
 *
 * @internal
 */
export function mimeTypeForPath(path: string): string {
    const dot = path.lastIndexOf(".");
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    if (dot <= slash) return "application/octet-stream";
    return _MIME_BY_EXTENSION[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}
