import { Injectable, inject, signal } from '@angular/core';
import { SceneSerializer, type SerializedScene } from 'WebEngineTS';
import { SceneService } from './scene.service';
import { SelectionService } from './selection.service';

interface HistoryEntry {
    label: string;
    snapshot: SerializedScene;
}

/**
 * Editor undo/redo stack based on whole-scene snapshots.
 *
 * @remarks
 * Every mutating editor action wraps itself in {@link record} which takes
 * a snapshot BEFORE the action runs and pushes it onto the undo stack.
 * Calling {@link undo} rewinds to the previous snapshot by reloading it;
 * {@link redo} moves forward again.
 *
 * Snapshot-based history is coarser than a command pattern but handles
 * every possible mutation uniformly (create, delete, rename, transform,
 * component add/remove, field edits) without per-action bookkeeping.
 */
@Injectable({ providedIn: 'root' })
export class HistoryService {

    /** Maximum retained snapshots (oldest are discarded). */
    public static readonly MAX = 30;

    private readonly _scene = inject(SceneService);
    private readonly _selection = inject(SelectionService);

    private _undoStack: HistoryEntry[] = [];
    private _redoStack: HistoryEntry[] = [];

    /** True if an undo is available. Drives toolbar button state. */
    public readonly canUndo = signal(false);
    /** True if a redo is available. */
    public readonly canRedo = signal(false);

    /**
     * Captures the current scene, runs `action`, clears redo.
     * Use for any mutation the user would expect to undo.
     */
    public record(label: string, action: () => void): void {
        const snap = this._scene.serialize();
        this._push(label, snap);
        try {
            action();
        } catch (err) {
            // On failure, pop the snapshot we just added — nothing to undo.
            this._undoStack.pop();
            this._refreshFlags();
            throw err;
        }
    }

    /** Rewinds one step. No-op if the stack is empty. */
    public undo(): void {
        const entry = this._undoStack.pop();
        if (!entry) return;
        const current = this._scene.serialize();
        this._redoStack.push({ label: entry.label, snapshot: current });
        this._applySnapshot(entry.snapshot);
        this._refreshFlags();
    }

    /** Re-applies the last undone action. No-op if nothing to redo. */
    public redo(): void {
        const entry = this._redoStack.pop();
        if (!entry) return;
        const current = this._scene.serialize();
        this._undoStack.push({ label: entry.label, snapshot: current });
        this._applySnapshot(entry.snapshot);
        this._refreshFlags();
    }

    /** Drops all history (used on New / Open). */
    public clear(): void {
        this._undoStack = [];
        this._redoStack = [];
        this._refreshFlags();
    }

    // ── internal ─────────────────────────────────────────────────────

    private _push(label: string, snap: SerializedScene): void {
        this._undoStack.push({ label, snapshot: snap });
        if (this._undoStack.length > HistoryService.MAX) {
            this._undoStack.shift();
        }
        this._redoStack = [];
        this._refreshFlags();
    }

    private _applySnapshot(snap: SerializedScene): void {
        this._selection.clear();
        this._scene.loadFromJSON(snap);
    }

    private _refreshFlags(): void {
        this.canUndo.set(this._undoStack.length > 0);
        this.canRedo.set(this._redoStack.length > 0);
    }
}
