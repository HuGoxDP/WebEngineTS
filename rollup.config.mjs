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

// ─── Known-benign warning suppressor ───
// 1. TS5096 — `allowImportingTsExtensions` conflicts with the emit mode that
//    @rollup/plugin-typescript forces on. Source code intentionally uses `.ts`
//    in import specifiers, so the option must stay enabled.
// 2. Three class-pair circular deps (Physics↔Collider, Application↔Canvas,
//    EventSystem↔Button) — references are confined to method bodies; no
//    top-level value access, so module init order is safe.
const knownCircularPairs = [
  ["src/engine/physics/Physics.ts", "src/engine/physics/Collider.ts"],
  ["src/engine/core/Application.ts", "src/engine/core/ui/Canvas.ts"],
  ["src/engine/core/ui/EventSystem.ts", "src/engine/core/ui/Button.ts"],
];

function onwarn(warning, defaultHandler) {
  if (
    warning.plugin === "typescript" &&
    typeof warning.message === "string" &&
    warning.message.includes("TS5096")
  ) {
    return;
  }
  if (warning.code === "CIRCULAR_DEPENDENCY") {
    const ids = (warning.ids ?? []).map((p) => p.replace(/\\/g, "/"));
    for (const [a, b] of knownCircularPairs) {
      if (ids.some((id) => id.endsWith(a)) && ids.some((id) => id.endsWith(b))) {
        return;
      }
    }
  }
  defaultHandler(warning);
}

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
      declarationMap: false,
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
  onwarn,
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
  onwarn,
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
  onwarn,
};

export default [jsBuild, standaloneBuild, dtsBuild];
