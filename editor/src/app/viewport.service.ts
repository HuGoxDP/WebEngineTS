import { Injectable, NgZone } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneManager, Transform } from 'WebEngineTS';

/**
 * Owns the Three.js renderer, the editor camera, and the animation loop.
 *
 * Renders the engine's active Scene (`SceneManager.activeScene._internalThreeScene`)
 * plus an editor-only overlay scene with the grid and axes helpers.
 * Dirty transforms are flushed before each draw via `Transform._syncAllDirty`.
 */
@Injectable({ providedIn: 'root' })
export class ViewportService {

    private _renderer: THREE.WebGLRenderer | null = null;
    private _camera: THREE.PerspectiveCamera | null = null;
    private _controls: OrbitControls | null = null;
    private _overlay: THREE.Scene | null = null;
    private _rafId: number = 0;
    private _resizeObs: ResizeObserver | null = null;

    constructor(private readonly _zone: NgZone) {}

    /** Initializes the viewport on the given canvas. Idempotent. */
    public attach(canvas: HTMLCanvasElement): void {
        if (this._renderer) return;

        this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this._renderer.setPixelRatio(window.devicePixelRatio);
        this._renderer.autoClear = false;

        // ── Editor overlay (grid + axes) ──
        const overlay = new THREE.Scene();
        const grid = new THREE.GridHelper(50, 50, 0x555555, 0x333333);
        overlay.add(grid);
        const axes = new THREE.AxesHelper(2);
        overlay.add(axes);
        this._overlay = overlay;

        // ── Editor camera ──
        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
        camera.position.set(6, 6, 10);
        camera.lookAt(0, 0, 0);
        this._camera = camera;

        // ── Orbit controls ──
        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.target.set(0, 0, 0);
        this._controls = controls;

        // ── Lights live in the editor scene, not the engine scene ──
        // Users can add their own lights via GameObjects.
        const hemi = new THREE.HemisphereLight(0xffffff, 0x303030, 1.0);
        overlay.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(5, 10, 5);
        overlay.add(dir);

        this._resize(canvas);
        this._resizeObs = new ResizeObserver(() => this._resize(canvas));
        this._resizeObs.observe(canvas);

        this._zone.runOutsideAngular(() => this._loop());
    }

    /** Releases GPU resources and stops the loop. */
    public detach(): void {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = 0;
        this._resizeObs?.disconnect();
        this._resizeObs = null;
        this._controls?.dispose();
        this._controls = null;
        this._renderer?.dispose();
        this._renderer = null;
        this._overlay = null;
        this._camera = null;
    }

    /** The editor camera. Used by selection raycasting in later milestones. */
    public get camera(): THREE.PerspectiveCamera | null { return this._camera; }

    private _loop = (): void => {
        if (!this._renderer || !this._camera || !this._overlay) return;
        this._rafId = requestAnimationFrame(this._loop);
        this._controls?.update();

        // Flush dirty engine transforms before we render the engine scene.
        Transform._syncAllDirty();

        const engineScene = SceneManager.activeScene._internalThreeScene;

        this._renderer.clear();
        this._renderer.render(this._overlay, this._camera);
        this._renderer.render(engineScene, this._camera);
    };

    private _resize(canvas: HTMLCanvasElement): void {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0 || !this._renderer || !this._camera) return;
        this._renderer.setSize(w, h, false);
        this._camera.aspect = w / h;
        this._camera.updateProjectionMatrix();
    }
}
