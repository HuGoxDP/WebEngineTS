// Types for tests/PlayerBuild.test.ts, which builds the player artifacts in memory from the real config.
import type { RollupOptions } from "rollup";
export const playerHostBuild: RollupOptions;
export const playerBuild: RollupOptions;
export const playerHostDtsBuild: RollupOptions;
declare const configs: RollupOptions[];
export default configs;
