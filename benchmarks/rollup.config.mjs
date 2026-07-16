// benchmarks/rollup.config.mjs
// ============================================
// Bundles the benchmark runner into benchmarks/run.js.
//
// "WebEngineTS" and "three" are kept EXTERNAL — index.html resolves them at
// runtime through an import map pointing at dist/WebEngineTS.standalone.js.
// Run `npm run build` (to produce dist/) before `npm run benchmark:build`.
// ============================================

import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";

export default {
  input: "benchmarks/run.ts",
  output: {
    file: "benchmarks/run.js",
    format: "es",
    sourcemap: true,
  },
  external: ["WebEngineTS", "three"],
  plugins: [
    resolve({ browser: true, extensions: [".ts", ".js", ".mjs"] }),
    typescript({
      tsconfig: "./benchmarks/tsconfig.json",
      declaration: false,
      declarationMap: false,
      sourceMap: true,
    }),
  ],
  onwarn(warning, defaultHandler) {
    // TS5096 — allowImportingTsExtensions is intentional (source uses .ts specifiers).
    if (
      warning.plugin === "typescript" &&
      typeof warning.message === "string" &&
      warning.message.includes("TS5096")
    ) {
      return;
    }
    defaultHandler(warning);
  },
};
