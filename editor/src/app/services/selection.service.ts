import { Injectable, signal } from '@angular/core';
import { GameObject } from 'WebEngineTS';

/**
 * Tracks the currently selected GameObject in the editor.
 *
 * Single-selection for the MVP. Multi-select and selection history are
 * deferred to Phase 12b.
 */
@Injectable({ providedIn: 'root' })
export class SelectionService {

    /** The currently selected GameObject, or null. */
    public readonly selected = signal<GameObject | null>(null);

    /** Bumped whenever the selected GameObject's properties change
     *  (used to force Inspector re-render without swapping the reference). */
    public readonly revision = signal(0);

    /** Selects a GameObject (or clears selection with null). */
    public select(go: GameObject | null): void {
        this.selected.set(go);
        this.revision.update(n => n + 1);
    }

    /** Clears selection. */
    public clear(): void {
        this.select(null);
    }

    /** Call after mutating the selected GameObject so the Inspector refreshes. */
    public notifyChanged(): void {
        this.revision.update(n => n + 1);
    }
}
