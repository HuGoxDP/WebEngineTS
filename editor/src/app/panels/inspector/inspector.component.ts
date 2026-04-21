import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
    GameObject,
    Quaternion,
    Vector3,
} from 'WebEngineTS';
import { SelectionService } from '../../services/selection.service';
import { SceneService } from '../../services/scene.service';

/** Euler angles in degrees — friendlier for the inspector than quaternions. */
interface EulerDeg { x: number; y: number; z: number; }

@Component({
    selector: 'app-inspector',
    standalone: true,
    imports: [FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="panel">
            <h3>Inspector</h3>

            @if (!go()) {
                <div class="empty">Select a GameObject to inspect.</div>
            } @else {
                <!-- Name -->
                <div class="row name">
                    <input
                        [ngModel]="go()!.name"
                        (ngModelChange)="onRename($event)"
                        spellcheck="false"
                    >
                </div>

                <!-- Transform -->
                <div class="section">
                    <div class="section-header">Transform</div>

                    <div class="field">
                        <label>Position</label>
                        <div class="vec3">
                            <span class="axis x">X</span>
                            <input type="number" step="0.1"
                                [ngModel]="pos().x"
                                (ngModelChange)="onPos('x', $event)">
                            <span class="axis y">Y</span>
                            <input type="number" step="0.1"
                                [ngModel]="pos().y"
                                (ngModelChange)="onPos('y', $event)">
                            <span class="axis z">Z</span>
                            <input type="number" step="0.1"
                                [ngModel]="pos().z"
                                (ngModelChange)="onPos('z', $event)">
                        </div>
                    </div>

                    <div class="field">
                        <label>Rotation</label>
                        <div class="vec3">
                            <span class="axis x">X</span>
                            <input type="number" step="1"
                                [ngModel]="rot().x"
                                (ngModelChange)="onRot('x', $event)">
                            <span class="axis y">Y</span>
                            <input type="number" step="1"
                                [ngModel]="rot().y"
                                (ngModelChange)="onRot('y', $event)">
                            <span class="axis z">Z</span>
                            <input type="number" step="1"
                                [ngModel]="rot().z"
                                (ngModelChange)="onRot('z', $event)">
                        </div>
                    </div>

                    <div class="field">
                        <label>Scale</label>
                        <div class="vec3">
                            <span class="axis x">X</span>
                            <input type="number" step="0.1"
                                [ngModel]="scl().x"
                                (ngModelChange)="onScl('x', $event)">
                            <span class="axis y">Y</span>
                            <input type="number" step="0.1"
                                [ngModel]="scl().y"
                                (ngModelChange)="onScl('y', $event)">
                            <span class="axis z">Z</span>
                            <input type="number" step="0.1"
                                [ngModel]="scl().z"
                                (ngModelChange)="onScl('z', $event)">
                        </div>
                    </div>
                </div>
            }
        </div>
    `,
    styles: [`
        .panel { padding: 8px 10px; }
        h3 {
            margin: 0 0 10px;
            font-size: 11px;
            font-weight: 600;
            color: #cccccc;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }
        .empty { color: #6a6a6a; font-size: 12px; }
        .row.name input {
            width: 100%;
            background: #3c3c3c;
            color: #dcdcdc;
            border: 1px solid #4a4a4a;
            border-radius: 2px;
            padding: 4px 6px;
            font-family: inherit;
            font-size: 13px;
        }
        .row.name input:focus { outline: 1px solid #007acc; outline-offset: -1px; }

        .section { margin-top: 12px; }
        .section-header {
            font-size: 11px;
            font-weight: 600;
            color: #aaaaaa;
            padding: 6px 0 8px;
            border-bottom: 1px solid #3f3f46;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }
        .field { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .field label { flex: 0 0 60px; font-size: 12px; color: #b0b0b0; }
        .vec3 { flex: 1; display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr; gap: 4px; align-items: center; }
        .axis {
            font-size: 11px;
            font-weight: 600;
            width: 12px;
            text-align: center;
        }
        .axis.x { color: #f87171; }
        .axis.y { color: #4ade80; }
        .axis.z { color: #60a5fa; }
        input[type=number] {
            background: #3c3c3c;
            color: #dcdcdc;
            border: 1px solid #4a4a4a;
            border-radius: 2px;
            padding: 3px 4px;
            font-family: inherit;
            font-size: 12px;
            width: 100%;
            min-width: 0;
        }
        input[type=number]:focus { outline: 1px solid #007acc; outline-offset: -1px; }
    `],
})
export class InspectorComponent {

    private readonly _selection = inject(SelectionService);
    private readonly _scene = inject(SceneService);

    /** The currently selected GameObject, as a computed signal. */
    public readonly go = computed<GameObject | null>(() => {
        this._selection.revision();
        return this._selection.selected();
    });

    public readonly pos = computed(() => {
        const g = this.go();
        return g ? { x: g.transform.localPosition.x, y: g.transform.localPosition.y, z: g.transform.localPosition.z }
                 : { x: 0, y: 0, z: 0 };
    });

    public readonly rot = computed<EulerDeg>(() => {
        const g = this.go();
        if (!g) return { x: 0, y: 0, z: 0 };
        const e = InspectorComponent._quatToEulerDeg(g.transform.localRotation);
        return e;
    });

    public readonly scl = computed(() => {
        const g = this.go();
        return g ? { x: g.transform.localScale.x, y: g.transform.localScale.y, z: g.transform.localScale.z }
                 : { x: 1, y: 1, z: 1 };
    });

    public onRename(name: string): void {
        const g = this.go();
        if (!g) return;
        g.name = name;
        this._scene.notify();
    }

    public onPos(axis: 'x' | 'y' | 'z', value: number): void {
        const g = this.go();
        if (!g) return;
        const p = g.transform.localPosition;
        const next = new Vector3(
            axis === 'x' ? value : p.x,
            axis === 'y' ? value : p.y,
            axis === 'z' ? value : p.z,
        );
        g.transform.localPosition = next;
        this._selection.notifyChanged();
    }

    public onRot(axis: 'x' | 'y' | 'z', value: number): void {
        const g = this.go();
        if (!g) return;
        const cur = this.rot();
        const e: EulerDeg = {
            x: axis === 'x' ? value : cur.x,
            y: axis === 'y' ? value : cur.y,
            z: axis === 'z' ? value : cur.z,
        };
        g.transform.localRotation = InspectorComponent._eulerDegToQuat(e);
        this._selection.notifyChanged();
    }

    public onScl(axis: 'x' | 'y' | 'z', value: number): void {
        const g = this.go();
        if (!g) return;
        const s = g.transform.localScale;
        const next = new Vector3(
            axis === 'x' ? value : s.x,
            axis === 'y' ? value : s.y,
            axis === 'z' ? value : s.z,
        );
        g.transform.localScale = next;
        this._selection.notifyChanged();
    }

    // ── Quaternion ↔ Euler (YXZ order, degrees) ──────────────────

    private static _quatToEulerDeg(q: Quaternion): EulerDeg {
        const { x, y, z, w } = q;
        // YXZ extraction (Unity-like for inspector display)
        const sinP = 2 * (w * x - y * z);
        const cp = Math.min(Math.max(sinP, -1), 1);
        const ex = Math.asin(cp);
        let ey: number, ez: number;
        if (Math.abs(sinP) < 0.99999) {
            ey = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
            ez = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z));
        } else {
            ey = Math.atan2(-2 * (x * z - w * y), 1 - 2 * (y * y + z * z));
            ez = 0;
        }
        const k = 180 / Math.PI;
        return {
            x: +(ex * k).toFixed(3),
            y: +(ey * k).toFixed(3),
            z: +(ez * k).toFixed(3),
        };
    }

    private static _eulerDegToQuat(e: EulerDeg): Quaternion {
        const k = Math.PI / 180;
        const ex = e.x * k, ey = e.y * k, ez = e.z * k;
        // YXZ order
        const cx = Math.cos(ex * 0.5), sx = Math.sin(ex * 0.5);
        const cy = Math.cos(ey * 0.5), sy = Math.sin(ey * 0.5);
        const cz = Math.cos(ez * 0.5), sz = Math.sin(ez * 0.5);
        return new Quaternion(
            sx * cy * cz + cx * sy * sz,
            cx * sy * cz - sx * cy * sz,
            cx * cy * sz - sx * sy * cz,
            cx * cy * cz + sx * sy * sz,
        );
    }
}
