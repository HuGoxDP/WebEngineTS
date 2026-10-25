// scripts/player-smoke/browsers.mjs
// How the smoke launches each engine; shared by the spike run (run.mjs) and the shipped run (shipped.mjs).

export const BROWSER_NAMES = ["chromium", "firefox", "webkit"];

export const CHROMIUM_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    // Desktop Chrome's default. Headless builds relax it, which would make every audio result read "running".
    "--autoplay-policy=document-user-activation-required"];

/** Launches `name` from a Playwright module with the flags that make WebGL work headless. */
export const launchBrowser = (playwright, name) => playwright[name].launch(name === "chromium" ? { args: CHROMIUM_ARGS } : {});
