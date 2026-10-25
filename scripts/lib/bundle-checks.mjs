// scripts/lib/bundle-checks.mjs
// Pure checks on a built file's text, shared by `npm run size` and the unit tests.

import { gzipSync } from "node:zlib";

/**
 * Gzip budgets in bytes. Standalone measured 391,742 on 2026-10-14 (the unminified build was 917,253); player-host
 * 5,981 and player 2,582 on 2026-10-25. The host client is shipped unminified (the consumer's bundler minifies it),
 * so its budget is on the readable file.
 * Raising one is a decision: say why in the commit and record the new size in CHANGELOG.md under "Changed".
 */
export const BUDGETS = { standalone: 450_000, playerHost: 8_000, player: 4_000 };

/**
 * Names that only appear in a bundle when engine or three.js code was pulled in. The player legitimately names a few
 * engine members it calls (`Application`, `MemoryProfiler`, `Time`, ...) as property accesses, so those are not
 * listed; these are classes the player and the host client never touch.
 */
export const ENGINE_MARKERS = ["WebGLRenderer", "GameObject", "Rigidbody", "ScenarioBehaviour", "JSZip", "THREE", "BufferGeometry", "Vector3"];

/** The host client runs on the platform's origin and touches no engine API at all, so it also may not name these. */
export const HOST_ONLY_MARKERS = ["Application", "MemoryProfiler", "Scenario", "AudioManager"];

/** The markers from `markers` that occur as whole words in `code`. */
export function findMarkers(code, markers) {
    return markers.filter(marker => new RegExp(String.raw`\b${marker}\b`).test(code));
}

/** Gzip size at level 9, the same yardstick `check-bundle-size.mjs` uses for the engine. */
export const gzipBytes = code => gzipSync(code, { level: 9 }).length;
