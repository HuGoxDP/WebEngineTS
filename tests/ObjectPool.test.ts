import { describe, test, expect, vi } from "vitest";
import { ObjectPool } from "../src/engine/core/pool/ObjectPool";

class Bullet {
    public active: boolean = true;
    public data: number = 0;
    public reset(): void { this.active = true; this.data = 0; }
}

describe("ObjectPool", () => {
    test("creates via factory when empty", () => {
        const factory = vi.fn(() => new Bullet());
        const pool = new ObjectPool<Bullet>(factory);
        const b = pool.get();
        expect(b).toBeInstanceOf(Bullet);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(pool.countAll).toBe(1);
        expect(pool.countActive).toBe(1);
        expect(pool.countInactive).toBe(0);
    });

    test("reuses released instances", () => {
        const factory = vi.fn(() => new Bullet());
        const pool = new ObjectPool<Bullet>(factory);
        const a = pool.get();
        pool.release(a);
        const b = pool.get();
        expect(b).toBe(a);
        expect(factory).toHaveBeenCalledTimes(1);
    });

    test("pre-warms with defaultCapacity", () => {
        const factory = vi.fn(() => new Bullet());
        const pool = new ObjectPool<Bullet>(factory, {}, { defaultCapacity: 5 });
        expect(factory).toHaveBeenCalledTimes(5);
        expect(pool.countInactive).toBe(5);
        expect(pool.countActive).toBe(0);
    });

    test("fires all lifecycle callbacks", () => {
        const onCreate = vi.fn();
        const onGet = vi.fn();
        const onRelease = vi.fn();
        const onDestroy = vi.fn();
        const pool = new ObjectPool<Bullet>(
            () => new Bullet(),
            { onCreate, onGet, onRelease, onDestroy },
        );
        const b = pool.get();
        expect(onCreate).toHaveBeenCalledWith(b);
        expect(onGet).toHaveBeenCalledWith(b);
        pool.release(b);
        expect(onRelease).toHaveBeenCalledWith(b);
        pool.clear();
        expect(onDestroy).toHaveBeenCalledWith(b);
    });

    test("onGet fires on reuse, onCreate does not", () => {
        const onCreate = vi.fn();
        const onGet = vi.fn();
        const pool = new ObjectPool<Bullet>(() => new Bullet(), { onCreate, onGet });
        const b = pool.get();
        pool.release(b);
        pool.get();
        expect(onCreate).toHaveBeenCalledTimes(1);
        expect(onGet).toHaveBeenCalledTimes(2);
    });

    test("respects maxSize and destroys overflow", () => {
        const onDestroy = vi.fn();
        const pool = new ObjectPool<Bullet>(
            () => new Bullet(),
            { onDestroy },
            { maxSize: 2 },
        );
        const a = pool.get(); const b = pool.get(); const c = pool.get();
        pool.release(a); pool.release(b);
        expect(pool.countInactive).toBe(2);
        pool.release(c);  // over cap, destroyed
        expect(pool.countInactive).toBe(2);
        expect(onDestroy).toHaveBeenCalledTimes(1);
        expect(onDestroy).toHaveBeenCalledWith(c);
    });

    test("collectionCheck detects double release", () => {
        const pool = new ObjectPool<Bullet>(() => new Bullet());
        const b = pool.get();
        pool.release(b);
        expect(() => pool.release(b)).toThrow(/double release/i);
    });

    test("collectionCheck can be disabled", () => {
        const pool = new ObjectPool<Bullet>(
            () => new Bullet(),
            {},
            { collectionCheck: false },
        );
        const b = pool.get();
        pool.release(b);
        expect(() => pool.release(b)).not.toThrow();
    });

    test("clear empties the pool and calls onDestroy", () => {
        const onDestroy = vi.fn();
        const pool = new ObjectPool<Bullet>(
            () => new Bullet(),
            { onDestroy },
            { defaultCapacity: 3 },
        );
        pool.clear();
        expect(pool.countInactive).toBe(0);
        expect(onDestroy).toHaveBeenCalledTimes(3);
    });

    test("scoped() returns an auto-releasing handle", () => {
        const pool = new ObjectPool<Bullet>(() => new Bullet());
        const { value, release } = pool.scoped();
        expect(pool.countActive).toBe(1);
        release();
        expect(pool.countActive).toBe(0);
        // Second call is a no-op
        release();
        expect(pool.countActive).toBe(0);
    });

    test("active/inactive/total counts stay consistent", () => {
        const pool = new ObjectPool<Bullet>(() => new Bullet());
        const items = [pool.get(), pool.get(), pool.get()];
        expect(pool.countAll).toBe(3);
        expect(pool.countActive).toBe(3);
        expect(pool.countInactive).toBe(0);
        pool.release(items[0]);
        pool.release(items[1]);
        expect(pool.countActive).toBe(1);
        expect(pool.countInactive).toBe(2);
        expect(pool.countAll).toBe(3);
    });
});
