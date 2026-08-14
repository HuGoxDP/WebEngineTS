import { describe, test, expect, afterEach } from "vitest";
import { LoadHandle } from "../src/engine/core/assets/LoadHandle";

/**
 * A LoadHandle offers two ways to read a failure — await `promise`, or poll
 * `isDone` and `error`. Taking the second one used to leave the rejection
 * unobserved, so a failure the caller was handling still reached the host as an
 * `unhandledrejection`. Audit part 4, F17.
 */

const seen: unknown[] = [];
const onUnhandled = (reason: unknown): void => { seen.push(reason); };
process.on("unhandledRejection", onUnhandled);

afterEach(() => { seen.length = 0; });
process.once("beforeExit", () => process.off("unhandledRejection", onUnhandled));

/** Long enough for Node to decide a rejection went unobserved. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 30));

describe("A failed LoadHandle nobody awaits", () => {
    test("does not surface as an unhandled rejection", async () => {
        const handle = new LoadHandle<number>((_progress, _resolve, reject) => {
            reject(new Error("asset missing"));
        });

        await settle();

        expect(seen).toHaveLength(0);
        expect(handle.isDone).toBe(true);
        expect(handle.error?.message).toBe("asset missing");
    });

    test("still rejects for a caller that does await it", async () => {
        const handle = new LoadHandle<number>((_progress, _resolve, reject) => {
            reject(new Error("asset missing"));
        });

        await expect(handle.promise).rejects.toThrow("asset missing");
        await settle();

        expect(seen).toHaveLength(0);
    });

    test("rejects asynchronously too, without a stray report", async () => {
        // The real shape: the failure arrives a tick later, from a fetch.
        const handle = new LoadHandle<number>((_progress, _resolve, reject) => {
            setTimeout(() => reject(new Error("404")), 1);
        });

        await settle();

        expect(seen).toHaveLength(0);
        expect(handle.error?.message).toBe("404");
        expect(handle.result).toBeUndefined();
    });

    test("a successful handle is unaffected", async () => {
        const handle = new LoadHandle<number>((progress, resolve) => {
            progress(0.5);
            resolve(7);
        });

        await expect(handle.promise).resolves.toBe(7);
        expect(handle.progress).toBe(1);
        expect(handle.result).toBe(7);
        expect(handle.error).toBeUndefined();
    });
});
