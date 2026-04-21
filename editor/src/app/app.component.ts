import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    ViewChild,
    inject,
} from '@angular/core';
import { ViewportService } from './viewport.service';
import { SceneService } from './services/scene.service';
import { SelectionService } from './services/selection.service';
import { HierarchyComponent } from './panels/hierarchy/hierarchy.component';
import { InspectorComponent } from './panels/inspector/inspector.component';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [HierarchyComponent, InspectorComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="editor">
            <header class="toolbar">
                <div class="group">
                    <button>New</button>
                    <button>Open</button>
                    <button>Save</button>
                </div>
                <div class="sep"></div>
                <div class="group">
                    <button class="play">▶ Play</button>
                    <button class="stop">■ Stop</button>
                </div>
                <div class="sep"></div>
                <div class="group">
                    <button (click)="onCreateEmpty()">+ Create GameObject</button>
                </div>
                <div class="group right">
                    <span class="title">WebEngineTS Editor</span>
                </div>
            </header>

            <main class="layout">
                <aside class="panel-frame">
                    <app-hierarchy></app-hierarchy>
                </aside>

                <section class="viewport">
                    <canvas #viewportCanvas></canvas>
                </section>

                <aside class="panel-frame">
                    <app-inspector></app-inspector>
                </aside>
            </main>
        </div>
    `,
    styles: [`
        :host { display: block; height: 100vh; }
        .editor { display: flex; flex-direction: column; height: 100vh; }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 12px;
            background: #2d2d30;
            border-bottom: 1px solid #3f3f46;
            font-size: 12px;
            flex-shrink: 0;
        }
        .toolbar .group { display: flex; gap: 4px; }
        .toolbar .group.right { margin-left: auto; }
        .toolbar .sep { width: 1px; height: 20px; background: #3f3f46; }
        .toolbar .title { color: #808080; font-size: 11px; }

        button {
            background: #3f3f46;
            color: #dcdcdc;
            border: 1px solid #5a5a5f;
            padding: 3px 10px;
            cursor: pointer;
            font-size: 12px;
            border-radius: 2px;
            font-family: inherit;
        }
        button:hover { background: #4a4a4e; }
        button:active { background: #2d2d30; }
        button.play { color: #4ade80; }
        button.stop { color: #f87171; }

        .layout {
            display: grid;
            grid-template-columns: 260px 1fr 320px;
            flex: 1;
            min-height: 0;
        }
        .panel-frame {
            background: #252526;
            overflow-y: auto;
            min-height: 0;
        }
        .panel-frame:first-child { border-right: 1px solid #3f3f46; }
        .panel-frame:last-child  { border-left: 1px solid #3f3f46; }

        .viewport { position: relative; background: #1e1e1e; min-width: 0; }
        canvas { width: 100%; height: 100%; display: block; }
    `],
})
export class AppComponent implements AfterViewInit, OnDestroy {

    @ViewChild('viewportCanvas', { static: true })
    private readonly _canvasRef!: ElementRef<HTMLCanvasElement>;

    private readonly _viewport = inject(ViewportService);
    private readonly _scene = inject(SceneService);
    private readonly _selection = inject(SelectionService);

    ngAfterViewInit(): void {
        this._viewport.attach(this._canvasRef.nativeElement);
    }

    ngOnDestroy(): void {
        this._viewport.detach();
    }

    public onCreateEmpty(): void {
        const go = this._scene.createEmpty('GameObject');
        this._selection.select(go);
    }
}
