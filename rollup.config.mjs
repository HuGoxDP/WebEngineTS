// rollup.config.mjs
// ============================================
// WebEngineTS Engine — Library Build
// ============================================
//
// Produces:
//   dist/WebEngineTS.esm.js         — ES module (three external, for Angular/Vite bundlers)
//   dist/WebEngineTS.cjs.js         — CommonJS (three external, for Node.js tooling, SSR)
//   dist/WebEngineTS.standalone.js  — ES module (three BUNDLED, for browser import maps)
//   dist/WebEngineTS.d.ts           — Single bundled type declaration
//
// The standalone build is used by the host page's <script type="importmap">
// so that scenario scripts loaded as Blob URLs can resolve `from "WebEngineTS"`
// and `from "three"` without additional configuration.
//
// ============================================

import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import dts from "rollup-plugin-dts";

// ─── Shared: mark three as external for npm builds ───
const external = [
  "three",
  /^three\//,       // three/addons/*, three/examples/*, etc.
];

// ─── Shared plugins ───
function buildPlugins() {
  return [
    resolve({
      browser: true,
      preferBuiltins: false,
      extensions: [".ts", ".js", ".mjs"],
    }),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.build.json",
      declaration: false,
      declarationDir: undefined,
      sourceMap: true,
    }),
  ];
}

// ─── Build 1: JavaScript bundles (ESM + CJS) — three external ───
const jsBuild = {
  input: "src/engine/index.ts",

  output: [
    {
      file: "dist/WebEngineTS.esm.js",
      format: "es",
      sourcemap: true,
    },
    {
      file: "dist/WebEngineTS.cjs.js",
      format: "cjs",
      sourcemap: true,
      exports: "named",
    },
  ],

  external,
  plugins: buildPlugins(),
};

// ─── Build 2: Standalone ESM — three BUNDLED (for import maps) ───
const standaloneBuild = {
  input: "src/engine/index.ts",

  output: {
    file: "dist/WebEngineTS.standalone.js",
    format: "es",
    sourcemap: true,
  },

  // No externals — everything is bundled (three, jszip, tslib)
  external: [],
  plugins: buildPlugins(),
};

// ─── Build 3: Bundled type declarations (.d.ts) ───
const dtsBuild = {
  input: "src/engine/index.ts",

  output: {
    file: "dist/WebEngineTS.d.ts",
    format: "es",
  },

  external,

  plugins: [
    dts({
      tsconfig: "./tsconfig.build.json",
    }),
  ],
};

export default [jsBuild, standaloneBuild, dtsBuild];
