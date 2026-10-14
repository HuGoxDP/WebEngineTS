// rollup.config.mjs
// ============================================
// WebEngineTS Engine — Library Build
// ============================================
//
// Produces:
//   dist/WebEngineTS.esm.js         — ES module (three external, for Angular/Vite bundlers)
//   dist/WebEngineTS.cjs.js         — CommonJS (three external, for Node.js tooling, SSR)
//   dist/WebEngineTS.standalone.js  — ES module, minified (three BUNDLED, for browser import maps)
//   dist/WebEngineTS.d.ts           — Single bundled type declaration
//
// The standalone build is used by the host page's <script type="importmap">
// so that scenario scripts loaded as Blob URLs can resolve `from "WebEngineTS"`
// and `from "three"` without additional configuration.
//
// ============================================

import { readFileSync } from "node:fs";
import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";

// ─── Build identity ───
// Stamped into src/engine/core/BuildInfo.ts so the running engine can name
// itself. The version is single-sourced from package.json — it used to be a
// string literal in Application, maintained by hand beside it and free to
// drift. WEBENGINE_BUILD_VERSION overrides it, so a packaging script that
// stamps a temporary version can pass the same value in here.
//
// The *timestamp* is what actually identifies a build: this repo keeps the
// version pinned at 0.1.0 between real releases while the content changes on
// every local pack, so two very different bundles still agree on their version.
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const BUILD_VERSION = process.env.WEBENGINE_BUILD_VERSION || pkg.version;
const BUILD_TIMESTAMP = new Date().toISOString();

const BUILD_INFO_MODULE = "src/engine/core/BuildInfo.ts";
const VERSION_TOKEN = '"__WEBENGINE_VERSION__"';
const BUILT_AT_TOKEN = '"__WEBENGINE_BUILT_AT__"';

function stampBuildInfo() {
  return {
    name: "stamp-build-info",
    // Note: this runs *after* @rollup/plugin-typescript has compiled the
    // module, regardless of where it sits in the plugin array — so it matches
    // bare string literals, which survive compilation, rather than a
    // declaration whose type annotation does not.
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith(BUILD_INFO_MODULE)) return null;

      if (!code.includes(VERSION_TOKEN) || !code.includes(BUILT_AT_TOKEN)) {
        this.error(
          `[stamp-build-info] ${BUILD_INFO_MODULE} no longer contains the ` +
          `expected placeholders. A build that silently skipped stamping would ` +
          `report itself as running from source forever.`,
        );
      }

      const stamped = code
        .replace(VERSION_TOKEN, JSON.stringify(BUILD_VERSION))
        .replace(BUILT_AT_TOKEN, JSON.stringify(BUILD_TIMESTAMP));

      // Both replacements stay on their own lines, so every other mapping is
      // unaffected; returning no map costs only those two lines' columns.
      return { code: stamped, map: null };
    },
  };
}

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
    stampBuildInfo(),
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
//
// This is the file every student downloads, so it is the only build that is
// minified. The ESM and CJS builds stay readable: a consumer bundling them
// minifies the result itself and keeps stack traces that name engine code.
//
// Class and function names are kept. The engine never reads them back for its
// own types (every @Serializable passes `typeName`), but scenario code does:
// it registers by class name, warnings and the editor print
// `constructor.name`, and the scenario entry point is found through its class.
//
// Comments are dropped except licence notices (three.js and jszip are MIT and
// ask that the notice travel with the code).
//
// sourcemap "hidden" writes dist/WebEngineTS.standalone.js.map without the
// trailing `//# sourceMappingURL` comment: hosts copy only the .js file, so the
// comment would point at a file that is not there. The map is attached to the
// GitHub Release for debugging. @rollup/plugin-terser only asks terser for a
// map when `sourcemap` is `true` or a path, so `sourceMap: true` is repeated
// here; without it the map would describe the bundle before minification.
const standaloneBuild = {
  input: "src/engine/index.ts",

  output: {
    file: "dist/WebEngineTS.standalone.js",
    format: "es",
    sourcemap: "hidden",
  },

  // No externals — everything is bundled (three, jszip, tslib)
  external: [],
  plugins: [
    ...buildPlugins(),
    terser({
      keep_classnames: true,
      keep_fnames: true,
      sourceMap: true,
      format: { comments: /@license|@preserve|^!/ },
    }),
  ],
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
