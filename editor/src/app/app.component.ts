import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    HostListener,
    OnDestroy,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { ViewportService } from './viewport.service';
import { SceneService } from './services/scene.service';
import { SelectionService } from './services/selection.service';
import { FileIoService } from './services/file-io.service';
import { PlayModeService } from './services/play-mode.service';
import { HistoryService } from './services/history.service';
import { HierarchyComponent } from './panels/hierarchy/hierarchy.component';
import { InspectorComponent } from './panels/inspector/inspector.component';
import { IconComponent } from './icon.component';
import type { SerializedScene } from 'WebEngineTS';

/** Top-level editor shell — menubar, toolbar, work grid, status bar. */
@Component({
    selector: 'app-root',
    standalone: true,
    imports: [HierarchyComponent, InspectorComponent, IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="app">
            <!-- ═══ MENU BAR ═══ -->
            <header class="menubar">
                <div class="brand">
                    <span class="brand-mark"></span>
                    <span>WETS</span>
                </div>
                <div class="menubar-item" (click)="onNew()">File</div>
                <div class="menubar-item" (click)="history.undo()">Edit</div>
                <div class="menubar-item" (click)="onCreateEmpty()">GameObject</div>
                <div class="menubar-item">Component</div>
                <div class="menubar-item">Window</div>
                <div class="menubar-item">Help</div>
                <div class="spacer"></div>
                <div class="project-tag">
                    <span class="dot"></span>
                    <span>main</span>
                </div>
            </header>

            <!-- ═══ TOOLBAR ═══ -->
            <header class="toolbar">
                <div class="tb-group">
                    <button class="tb-btn"
                        [disabled]="!history.canUndo()"
                        (click)="history.undo()" title="Undo (Ctrl+Z)">
                        <wets-icon name="undo"></wets-icon>
                    </button>
                    <button class="tb-btn"
                        [disabled]="!history.canRedo()"
                        (click)="history.redo()" title="Redo (Ctrl+Shift+Z)">
                        <wets-icon name="redo"></wets-icon>
                    </button>
                </div>
                <div class="tb-sep"></div>
                <div class="tb-group">
                    <button class="tb-btn primary"
                        [class.playing]="play.isPlaying()"
                        [disabled]="play.isPlaying()"
                        (click)="play.play()" title="Play">
                        <wets-icon name="play"></wets-icon>
                    </button>
                    <button class="tb-btn"
                        [disabled]="!play.isPlaying()"
                        (click)="play.stop()" title="Stop">
                        <wets-icon name="stop"></wets-icon>
                    </button>
                </div>
                <div class="tb-sep"></div>
                <div class="tb-group">
                    <button class="tb-btn" (click)="onNew()" title="New scene">
                        <wets-icon name="file-new"></wets-icon>
                    </button>
                    <button class="tb-btn" (click)="onOpen()" title="Open">
                        <wets-icon name="folder"></wets-icon>
                    </button>
                    <button class="tb-btn" (click)="onSave()" title="Save">
                        <wets-icon name="save"></wets-icon>
                    </button>
                </div>

                <div class="tb-spacer"></div>

                @if (play.isPlaying()) {
                    <div class="tb-live"><span class="rec"></span>LIVE</div>
                }
            </header>

            <!-- ═══ WORK AREA ═══ -->
            <section class="work">
                <aside class="pane left">
                    <div class="pane-tabs">
                        <div class="pane-tab active">≡ Hierarchy</div>
                        <div class="pane-tab-actions">
                            <button class="pane-btn" title="Lock">🔒</button>
                            <button class="pane-btn" title="Menu">
                                <wets-icon name="more"></wets-icon>
                            </button>
                        </div>
                    </div>
                    <div class="pane-body">
                        <app-hierarchy></app-hierarchy>
                    </div>
                </aside>

                <section class="pane center">
                    <div class="pane-tabs">
                        <div class="pane-tab active">◉ Scene</div>
                    </div>
                    <div class="pane-body">
                        <div class="viewport-wrap">

                            <!-- Sub-toolbar above the canvas (Pivot/Center · Local/Global · Snap · render-mode chips) -->
                            <div class="vp-subtoolbar">
                                <button class="chip" title="Pivot">
                                    <wets-icon name="pivot"></wets-icon>
                                    <span>Pivot</span>
                                    <span class="caret">▾</span>
                                </button>
                                <button class="chip" title="Local space">
                                    <wets-icon name="globe"></wets-icon>
                                    <span>Local</span>
                                    <span class="caret">▾</span>
                                </button>
                                <button class="chip" title="Snap value">
                                    <wets-icon name="magnet"></wets-icon>
                                    <span>1.0</span>
                                </button>
                                <div class="vp-sep"></div>
                                <button class="chip active" title="Shaded">
                                    <wets-icon name="shaded"></wets-icon>
                                </button>
                                <button class="chip" title="Lighting"><wets-icon name="light"></wets-icon></button>
                                <button class="chip" title="Audio"><wets-icon name="audio-fx"></wets-icon></button>
                                <button class="chip" title="Effects"><wets-icon name="cog"></wets-icon></button>
                                <button class="chip" title="Gizmos"><wets-icon name="gizmo"></wets-icon></button>
                                <div class="vp-spacer"></div>
                                <button class="chip" title="Visibility"><wets-icon name="eye"></wets-icon></button>
                            </div>

                            <div class="vp-canvas">
                                <canvas #viewportCanvas></canvas>

                                <!-- Floating vertical tool palette (Unity-style) -->
                                <aside class="tool-palette">
                                    <button class="tool-btn" title="Hand (Q)" disabled>
                                        <wets-icon name="hand"></wets-icon>
                                    </button>
                                    <button class="tool-btn"
                                        [class.active]="tool() === 'translate'"
                                        (click)="setTool('translate')" title="Move (W)">
                                        <wets-icon name="translate"></wets-icon>
                                    </button>
                                    <button class="tool-btn"
                                        [class.active]="tool() === 'rotate'"
                                        (click)="setTool('rotate')" title="Rotate (E)">
                                        <wets-icon name="rotate"></wets-icon>
                                    </button>
                                    <button class="tool-btn"
                                        [class.active]="tool() === 'scale'"
                                        (click)="setTool('scale')" title="Scale (R)">
                                        <wets-icon name="scale"></wets-icon>
                                    </button>
                                    <button class="tool-btn" title="Rect (T)" disabled>
                                        <wets-icon name="rect"></wets-icon>
                                    </button>
                                    <button class="tool-btn" title="Combined transform (Y)" disabled>
                                        <wets-icon name="transform-combo"></wets-icon>
                                    </button>
                                </aside>

                                <div class="vp-overlay-tl">
                                    <div class="chip">
                                        <span class="k">Tool</span><span class="v">{{ tool() }}</span>
                                    </div>
                                    <div class="chip">
                                        <span class="k">Shortcuts</span><span class="v">W · E · R · Del · Ctrl+Shift+N</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <aside class="pane right">
                    <div class="pane-tabs">
                        <div class="pane-tab active">☰ Inspector</div>
                    </div>
                    <div class="pane-body">
                        <app-inspector></app-inspector>
                    </div>
                </aside>

                <section class="pane bottom">
                    <div class="pane-tabs">
                        <div class="pane-tab active">
                            ▦ Project <span class="badge">soon</span>
                        </div>
                    </div>
                    <div class="pane-body">
                        <div class="bottom-placeholder">
                            Asset browser — coming in Phase 12c
                        </div>
                    </div>
                </section>
            </section>

            <!-- ═══ STATUS BAR ═══ -->
            <footer class="statusbar">
                <div class="st"><span class="dot" [class.ok]="!play.isPlaying()" [class.live]="play.isPlaying()"></span>{{ play.isPlaying() ? 'Playing' : 'Ready' }}</div>
                <div class="st">{{ goCountLabel() }}</div>
                <div class="st accent">{{ history.canUndo() ? 'Unsaved' : 'Saved' }}</div>
                <div class="spacer"></div>
                <div class="st">TypeScript · WebEngineTS 0.1.0</div>
            </footer>
        </div>
    `,
})
export class AppComponent implements AfterViewInit, OnDestroy {

    @ViewChild('viewportCanvas', { static: true })
    private readonly _canvasRef!: ElementRef<HTMLCanvasElement>;

    private readonly _viewport = inject(ViewportService);
    private readonly _scene = inject(SceneService);
    public readonly selection = inject(SelectionService);
    private readonly _fileIo = inject(FileIoService);
    public readonly play = inject(PlayModeService);
    public readonly history = inject(HistoryService);

    /** Currently active gizmo tool (drives the toolbar toggle). */
    public readonly tool = signal<'translate' | 'rotate' | 'scale'>('translate');

    public readonly goCountLabel = computed(() => {
        this._scene.revision();
        const count = (arr: ReadonlyArray<{ transform: { childCount: number; getChild(i: number): any } }>): number => {
            let sum = 0;
            for (const g of arr) {
                sum += 1;
                for (let i = 0; i < g.transform.childCount; i++) {
                    sum += count([g.transform.getChild(i).gameObject]);
                }
            }
            return sum;
        };
        const n = count(this._scene.roots());
        return `${n} GameObject${n === 1 ? '' : 's'}`;
    });

    ngAfterViewInit(): void {
        this._viewport.attach(this._canvasRef.nativeElement);
        window.addEventListener('keydown', this._onKeyDown);
    }

    /**
     * Globally suppress the browser's native context menu inside the editor.
     * Components that want their own menu (e.g. Hierarchy) call preventDefault
     * themselves; this is a safety net for everything else.
     */
    @HostListener('contextmenu', ['$event'])
    public onHostContextMenu(e: MouseEvent): void {
        e.preventDefault();
    }

    ngOnDestroy(): void {
        window.removeEventListener('keydown', this._onKeyDown);
        this._viewport.detach();
    }

    public setTool(mode: 'translate' | 'rotate' | 'scale'): void {
        this.tool.set(mode);
        this._viewport.setGizmoMode(mode);
    }

    private readonly _onKeyDown = (e: KeyboardEvent): void => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) this.history.redo();
            else            this.history.undo();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            this.history.redo();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            this.onCreateEmpty();
            return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.selection.selected()) {
                this.onDeleteSelected();
                e.preventDefault();
            }
            return;
        }

        if (e.key === 'F2') {
            const go = this.selection.selected();
            if (go) {
                window.dispatchEvent(new CustomEvent('wets:rename-selected'));
                e.preventDefault();
            }
            return;
        }

        switch (e.key.toLowerCase()) {
            case 'w': this.setTool('translate'); break;
            case 'e': this.setTool('rotate');    break;
            case 'r': this.setTool('scale');     break;
        }
    };

    public onCreateEmpty(): void {
        this.history.record('Create GameObject', () => {
            const go = this._scene.createEmpty('GameObject');
            this.selection.select(go);
        });
    }

    public onDeleteSelected(): void {
        const go = this.selection.selected();
        if (!go) return;
        this.history.record('Delete GameObject', () => {
            this.selection.clear();
            this._scene.destroy(go);
        });
    }

    public onNew(): void {
        if (this._scene.roots().length > 0 &&
            !confirm('Discard all unsaved changes?')) return;
        this.selection.clear();
        this._scene.clear();
        this.history.clear();
    }

    public onSave(): void {
        const json = this._scene.serialize();
        const fileName = `${json.name || 'scene'}.scene.json`;
        this._fileIo.saveText(fileName, JSON.stringify(json, null, 2));
    }

    public async onOpen(): Promise<void> {
        const file = await this._fileIo.openText('.json,.scene.json');
        if (!file) return;
        let data: SerializedScene;
        try {
            data = JSON.parse(file.text) as SerializedScene;
        } catch {
            alert(`Failed to parse ${file.name}: not valid JSON.`);
            return;
        }
        if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.roots)) {
            alert(`${file.name} is not a valid scene file.`);
            return;
        }
        this.selection.clear();
        this._scene.loadFromJSON(data);
        this.history.clear();
    }
}
