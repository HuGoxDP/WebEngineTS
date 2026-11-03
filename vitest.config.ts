import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        // Several files `await import()` the whole engine inside a test or hook (Application, via backendFactory
        // stubs). With one worker per core each of them transforms the engine graph cold at the same time, which can
        // take longer than the 5 s default on a loaded or many-core machine (measured: the untouched tree fails
        // ApplicationDisposeInput the same way). The budget is for that import, not for slow logic.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
