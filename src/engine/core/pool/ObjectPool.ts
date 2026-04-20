/**
 * Callbacks invoked at each stage of a pooled object's lifecycle.
 */
export interface ObjectPoolCallbacks<T> {
    /** Called when the pool creates a new instance (pool was empty). */
    onCreate?: (item: T) => void;
    /** Called when an instance is taken from the pool via {@link ObjectPool.get}. */
    onGet?: (item: T) => void;
    /** Called when an instance is returned via {@link ObjectPool.release}. */
    onRelease?: (item: T) => void;
    /** Called when an instance is permanently destroyed (pool overflow or clear). */
    onDestroy?: (item: T) => void;
}

/**
 * A generic reusable-object pool.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Pool.ObjectPool<T>`.
 * Avoids per-frame allocation for short-lived objects like particles,
 * projectiles, damage numbers, audio one-shots, etc.
 *
 * ```ts
 * const bullets = new ObjectPool<Bullet>(
 *   () => new Bullet(),
 *   {
 *     onGet: (b) => b.reset(),
 *     onRelease: (b) => b.setActive(false),
 *   },
 *   { defaultCapacity: 50, maxSize: 500 },
 * );
 *
 * const b = bullets.get();     // reuse or create
 * bullets.release(b);          // return to pool
 * ```
 */
export class ObjectPool<T> {

    private readonly _stack: T[] = [];
    private readonly _create: () => T;
    private readonly _callbacks: ObjectPoolCallbacks<T>;
    private readonly _maxSize: number;
    private readonly _collectionCheck: boolean;

    private _countAll: number = 0;

    /**
     * @param createFn Factory invoked when the pool is empty.
     * @param callbacks Optional lifecycle callbacks.
     * @param options
     * - `defaultCapacity` — pre-warm the pool with this many instances (default 0).
     * - `maxSize` — hard cap on retained instances; excess are destroyed (default 10_000).
     * - `collectionCheck` — if true, `release` throws on double-release in dev (default true).
     */
    constructor(
        createFn: () => T,
        callbacks: ObjectPoolCallbacks<T> = {},
        options: {
            defaultCapacity?: number;
            maxSize?: number;
            collectionCheck?: boolean;
        } = {},
    ) {
        this._create = createFn;
        this._callbacks = callbacks;
        this._maxSize = options.maxSize ?? 10_000;
        this._collectionCheck = options.collectionCheck ?? true;

        const prewarm = options.defaultCapacity ?? 0;
        for (let i = 0; i < prewarm; i++) {
            const item = this._create();
            this._callbacks.onCreate?.(item);
            this._stack.push(item);
            this._countAll++;
        }
    }

    /** Number of instances currently sitting in the pool (not in use). */
    public get countInactive(): number { return this._stack.length; }

    /** Total number of instances ever created by the pool. */
    public get countAll(): number { return this._countAll; }

    /** Number of instances currently checked out (in use). */
    public get countActive(): number { return this._countAll - this._stack.length; }

    /**
     * Retrieves an instance from the pool, creating a new one if empty.
     * Fires `onGet` (always) and `onCreate` (only on creation).
     */
    public get(): T {
        let item: T;
        if (this._stack.length > 0) {
            item = this._stack.pop()!;
        } else {
            item = this._create();
            this._callbacks.onCreate?.(item);
            this._countAll++;
        }
        this._callbacks.onGet?.(item);
        return item;
    }

    /**
     * Returns an instance to the pool for reuse.
     * Fires `onRelease`. If the pool is at capacity, fires `onDestroy` instead.
     *
     * @throws If `collectionCheck` is enabled and the instance is already
     *         in the pool (indicates a double-release bug).
     */
    public release(item: T): void {
        if (this._collectionCheck && this._stack.indexOf(item) >= 0) {
            throw new Error("ObjectPool: item already released (double release detected)");
        }

        this._callbacks.onRelease?.(item);

        if (this._stack.length < this._maxSize) {
            this._stack.push(item);
        } else {
            this._callbacks.onDestroy?.(item);
            this._countAll--;
        }
    }

    /**
     * Destroys every pooled instance and resets the pool.
     * Does NOT touch instances currently checked out.
     */
    public clear(): void {
        for (const item of this._stack) {
            this._callbacks.onDestroy?.(item);
        }
        this._countAll -= this._stack.length;
        this._stack.length = 0;
    }

    /**
     * Returns a handle that automatically releases the item on dispose.
     * Useful with `using` (TC39) or try/finally patterns.
     */
    public scoped(): { value: T; release: () => void } {
        const value = this.get();
        let released = false;
        return {
            value,
            release: () => {
                if (released) return;
                released = true;
                this.release(value);
            },
        };
    }
}
