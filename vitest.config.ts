import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        exclude: [
            "tests/Mathf.test.ts",
            "tests/Coroutine.test.ts",
            "tests/AnimationCurve.test.ts",
        ],
    },
});
