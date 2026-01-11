import * as THREE from "three";
import { SceneManager } from "./SceneManager.ts";
import { Time } from "./Time.ts";
import { EngineSettings } from "./EngineSettings.ts";

export class Application {
    public readonly renderer: THREE.WebGLRenderer;
    public readonly canvas: HTMLCanvasElement;
    public isPlaying: boolean = false;
    private _fixedUpdateAccumulator: number = 0;
    private _lastFrameTime: number = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: "high-performance"
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    public run(): void {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this._lastFrameTime = performance.now();
        console.log("Engine started.");
        this.loop();
    }

    public stop(): void {
        this.isPlaying = false;
    }

    private loop = (): void => {
        if (!this.isPlaying) return;
        requestAnimationFrame(this.loop);

        const now = performance.now();
        let frameDelta = (now - this._lastFrameTime) / 1000;
        this._lastFrameTime = now;

        if (frameDelta > EngineSettings.Time.MAX_DELTA_TIME) {
            frameDelta = EngineSettings.Time.MAX_DELTA_TIME;
        }

        Time._update(frameDelta);
        this._fixedUpdateAccumulator += frameDelta;
        const fixedStep = EngineSettings.Time.FIXED_TIMESTEP;

        while (this._fixedUpdateAccumulator >= fixedStep) {
            SceneManager.activeScene._fixedUpdate();
            this._fixedUpdateAccumulator -= fixedStep;
        }

        SceneManager.activeScene._update();
        SceneManager.activeScene._lateUpdate();
        this.render();
    };

    private render(): void {
        const scene = SceneManager.activeScene;

        // Знаходимо камеру
        const mainCamera = this.findCamera();

        if (mainCamera) {
            this.renderer.render(scene.threeScene, mainCamera);
        } else {
            // Якщо немає камери, заливаємо темно-синім (щоб розуміти, що рендер працює)
            this.renderer.setClearColor(0x000022);
            this.renderer.clear();
        }
    }

    /**
     * Допоміжний метод для пошуку камери
     */
    private findCamera(): THREE.Camera | null {
        let cam: THREE.Camera | null = null;
        SceneManager.activeScene.threeScene.traverse((obj) => {
            if (!cam && (obj as THREE.Camera).isCamera) {
                cam = obj as THREE.Camera;
            }
        });
        return cam;
    }

    private resize(): void {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.renderer.setSize(width, height);

        // ВАЖЛИВО: Оновлюємо Aspect Ratio камери, інакше картинка буде сплюснута або зникне
        const camera = this.findCamera();
        if (camera && (camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
            const perspectiveCam = camera as THREE.PerspectiveCamera;
            perspectiveCam.aspect = width / height;
            perspectiveCam.updateProjectionMatrix();
        }
    }
}