import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { GameObject } from 'WebEngineTS';
import { SceneService } from '../../services/scene.service';
import { SelectionService } from '../../services/selection.service';

interface HierarchyNode {
    go: GameObject;
    depth: number;
    name: string;
}

@Component({
    selector: 'app-hierarchy',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="panel">
            <div class="header">
                <h3>Hierarchy</h3>
            </div>
            @if (flat().length === 0) {
                <div class="empty">No GameObjects. Use <b>Create ▾</b> to add one.</div>
            } @else {
                <ul class="tree">
                    @for (node of flat(); track node.go.getInstanceID()) {
                        <li
                            [class.selected]="selection.selected() === node.go"
                            [style.padding-left.px]="8 + node.depth * 16"
                            (click)="selection.select(node.go)"
                        >
                            <span class="icon">□</span>
                            <span class="name">{{ node.name }}</span>
                        </li>
                    }
                </ul>
            }
        </div>
    `,
    styles: [`
        .panel { padding: 8px 0; }
        .header { padding: 0 10px 10px; display: flex; align-items: center; justify-content: space-between; }
        h3 {
            margin: 0;
            font-size: 11px;
            font-weight: 600;
            color: #cccccc;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }
        .empty { color: #6a6a6a; font-size: 12px; padding: 8px 12px; }
        .tree { list-style: none; margin: 0; padding: 0; }
        li {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 3px 10px 3px 8px;
            cursor: pointer;
            font-size: 12px;
            user-select: none;
        }
        li:hover { background: #2a2d2e; }
        li.selected { background: #094771; color: #ffffff; }
        .icon { color: #858585; font-family: monospace; }
        .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    `],
})
export class HierarchyComponent {

    public readonly scene = inject(SceneService);
    public readonly selection = inject(SelectionService);

    /** Flattened tree — re-derives whenever the scene revision changes. */
    public readonly flat = computed<HierarchyNode[]>(() => {
        // Touch the revision signal so we re-run when it bumps.
        this.scene.revision();
        const out: HierarchyNode[] = [];
        for (const root of this.scene.roots()) {
            HierarchyComponent._walk(root, 0, out);
        }
        return out;
    });

    private static _walk(go: GameObject, depth: number, out: HierarchyNode[]): void {
        out.push({ go, depth, name: go.name });
        const t = go.transform;
        for (let i = 0; i < t.childCount; i++) {
            HierarchyComponent._walk(t.getChild(i).gameObject, depth + 1, out);
        }
    }
}
