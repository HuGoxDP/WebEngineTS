// path: src/engine/core/assets/LoadHandle.ts

/**
 * Wraps an async load operation with progress tracking and status.
 *
 * Analogous to Unity's `AsyncOperationHandle<T>` / `ResourceRequest`.
 *
 * @remarks
 * Use via {@link Resources.loadAsync} or {@link Resources.loadBatch}.
 *
 * @example
 * ```ts
 * const handle = Resources.loadAsync(Texture2D, "textures/boss");
 * handle.onProgress(p => loadingBar.fillAmount = p);
 * const texture = await handle.promise;
 * ```
 */
export class LoadHandle<T> {

    private _progress: number = 0;
    private _isDone: boolean = false;
    private _result: T | undefined;
    private _error: Error | undefined;
    private _progressCallbacks: Array<(p: number) => void> = [];

    /** The underlying promise. Await this to get the loaded asset. */
    public readonly promise: Promise<T>;

    /** @internal — Use Resources.loadAsync() instead. */
    constructor(executor: (
        reportProgress: (p: number) => void,
        resolve: (value: T) => void,
        reject: (error: Error) => void,
    ) => void) {
        this.promise = new Promise<T>((resolve, reject) => {
            executor(
                (p) => {
                    this._progress = Math.min(1, Math.max(0, p));
                    for (const cb of this._progressCallbacks) cb(this._progress);
                },
                (value) => {
                    this._progress = 1;
                    this._isDone = true;
                    this._result = value;
                    resolve(value);
                },
                (error) => {
                    this._isDone = true;
                    this._error = error;
                    reject(error);
                },
            );
        });
    }

    /** Loading progress from 0 to 1. */
    public get progress(): number {
        return this._progress;
    }

    /** Whether the load operation has completed (success or failure). */
    public get isDone(): boolean {
        return this._isDone;
    }

    /** The loaded asset (available after completion). */
    public get result(): T | undefined {
        return this._result;
    }

    /** The error (available if the load failed). */
    public get error(): Error | undefined {
        return this._error;
    }

    /**
     * Register a callback for progress updates (0 → 1).
     * Returns `this` for chaining.
     *
     * @example
     * ```ts
     * handle
     *   .onProgress(p => console.log(`${(p * 100) | 0}%`))
     *   .promise.then(asset => use(asset));
     * ```
     */
    public onProgress(callback: (progress: number) => void): this {
        this._progressCallbacks.push(callback);
        // If already done, fire immediately
        if (this._isDone) callback(this._progress);
        return this;
    }
}