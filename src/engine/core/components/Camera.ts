import * as THREE from "three";
import { Behaviour } from "../Behaviour";
import { Color } from "../graphics/Color";
import { Rect } from "../math/Rect";
import { Matrix4x4 } from "../math/Matrix4x4";
import { Vector3 } from "../math/Vector3";
import type { GameObject } from "../GameObject";

/**
 * Режими очищення камери.
 */
export enum CameraClearFlags {
    /** Очистити фон кольором */
    SolidColor = 0,
    
    /** Очистити тільки глибину (для шарування камер) */
    Depth = 1,
    
    /** Не очищувати (рідко використовується) */
    Nothing = 2
}

/**
 * Компонент Camera для візуалізації сцени.
 * Повна імітація Unity Camera.
 * 
 * Камера генерує viewport для рендерингу та управляє проекцією.
 */
export class Camera extends Behaviour {
    /**
     * @internal - НЕ використовувати напряму!
     * THREE.js камера (PerspectiveCamera або OrthographicCamera)
     */
    public _threeCamera: THREE.Camera | null = null;

    /** Режим проекції (true = ortho, false = perspective) */
    private _orthographic: boolean = false;

    /** Кут зору (для perspective, у градусах) */
    private _fieldOfView: number = 60;

    /** Розмір (для orthographic, половина висоти) */
    private _orthographicSize: number = 5;

    /** Близька площина відсікання */
    private _nearClipPlane: number = 0.3;

    /** Далека площина відсікання */
    private _farClipPlane: number = 1000;

    /** Aspect ratio (width / height) */
    private _aspect: number = 16 / 9;

    /** Viewport (у нормальних координатах 0-1) */
    private _viewport: Rect = new Rect(0, 0, 1, 1);

    /** Фоновий колір */
    private _backgroundColor: Color = Color.black;

    /** Режим очищення */
    private _clearFlags: CameraClearFlags = CameraClearFlags.SolidColor;

    /** Глибина рендерингу (для шарування камер) */
    private _depth: number = 0;

    /** Маска для culling (які об'єкти рендерити) */
    private _cullingMask: number = 0xffffffff;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "Camera";
    }

    // === Lifecycle ===

    protected onAwake(): void {
        // Створюємо камеру
        this.updateCameraType();
        
        // Додаємо до сцени
        if (this.gameObject?.transform.object3D) {
            this.gameObject.transform.object3D.add(this._threeCamera!);
        }
    }

    protected onDestroy(): void {
        if (this._threeCamera && this.gameObject?.transform.object3D) {
            this.gameObject.transform.object3D.remove(this._threeCamera);
        }
        
        this._threeCamera = null;
        
        super.onDestroy();
    }

    // === Властивості - Проекція ===

    /**
     * Чи використовувати ортогональну проекцію (замість перспективи)
     */
    public get orthographic(): boolean {
        return this._orthographic;
    }

    public set orthographic(value: boolean) {
        if (this._orthographic === value) return;
        
        this._orthographic = value;
        this.updateCameraType();
    }

    /**
     * Кут зору (для perspective режиму, у градусах)
     */
    public get fieldOfView(): number {
        return this._fieldOfView;
    }

    public set fieldOfView(value: number) {
        this._fieldOfView = value;
        
        if (!this._orthographic && this._threeCamera instanceof THREE.PerspectiveCamera) {
            this._threeCamera.fov = value;
            (this._threeCamera as any).updateProjectionMatrix();
        }
    }

    /**
     * Розмір камери (для orthographic, половина висоти у світовому просторі)
     */
    public get orthographicSize(): number {
        return this._orthographicSize;
    }

    public set orthographicSize(value: number) {
        this._orthographicSize = value;
        
        if (this._orthographic && this._threeCamera instanceof THREE.OrthographicCamera) {
            this.updateOrthoCamera();
        }
    }

    /**
     * Близька площина відсікання
     */
    public get nearClipPlane(): number {
        return this._nearClipPlane;
    }

    public set nearClipPlane(value: number) {
        this._nearClipPlane = value;
        
        if (this._threeCamera) {
            (this._threeCamera as any).near = value;
            (this._threeCamera as any).updateProjectionMatrix();
        }
    }

    /**
     * Далека площина відсікання
     */
    public get farClipPlane(): number {
        return this._farClipPlane;
    }

    public set farClipPlane(value: number) {
        this._farClipPlane = value;
        
        if (this._threeCamera) {
            (this._threeCamera as any).far = value;
            (this._threeCamera as any).updateProjectionMatrix();
        }
    }

    /**
     * Aspect ratio (ширина / висота)
     */
    public get aspect(): number {
        return this._aspect;
    }

    public set aspect(value: number) {
        this._aspect = value;
        
        if (this._threeCamera instanceof THREE.PerspectiveCamera) {
            this._threeCamera.aspect = value;
            this._threeCamera.updateProjectionMatrix();
        } else if (this._threeCamera instanceof THREE.OrthographicCamera) {
            this.updateOrthoCamera();
        }
    }

    // === Властивості - Viewport ===

    /**
     * Viewport камери (нормальні координати 0-1)
     */
    public get viewport(): Rect {
        return this._viewport.clone();
    }

    public set viewport(value: Rect) {
        this._viewport = value.clone();
    }

    // === Властивості - Рендеринг ===

    /**
     * Фоновий колір камери
     */
    public get backgroundColor(): Color {
        return this._backgroundColor.clone();
    }

    public set backgroundColor(value: Color) {
        this._backgroundColor = value.clone();
    }

    /**
     * Режим очищення (як очищувати екран)
     */
    public get clearFlags(): CameraClearFlags {
        return this._clearFlags;
    }

    public set clearFlags(value: CameraClearFlags) {
        this._clearFlags = value;
    }

    /**
     * Глибина рендерингу (більша глибина = рендериться пізніше)
     */
    public get depth(): number {
        return this._depth;
    }

    public set depth(value: number) {
        this._depth = value;
    }

    /**
     * Маска culling (які об'єкти рендерити)
     */
    public get cullingMask(): number {
        return this._cullingMask;
    }

    public set cullingMask(value: number) {
        this._cullingMask = value;
    }

    // === Методи - Конвертація координат ===

    /**
     * Конвертує світові координати у координати екрану.
     * @param position Позиція у світовому просторі
     * @returns Позиція на екрані (z = глибина від камери)
     */
    public worldToScreenPoint(position: Vector3): Vector3 {
        if (!this._threeCamera) {
            console.error("Camera not initialized");
            return Vector3.zero;
        }

        const vec = new THREE.Vector3(position.x, position.y, position.z);
        vec.project(this._threeCamera);

        // Конвертуємо з [-1, 1] в екранні координати
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        return new Vector3(
            (vec.x + 1) / 2 * screenWidth,
            -(vec.y - 1) / 2 * screenHeight,
            -vec.z  // Глибина від камери
        );
    }

    /**
     * Конвертує координати екрану у світові координати.
     * @param screenPos Позиція на екрані
     * @returns Позиція у світовому просторі
     */
    public screenToWorldPoint(screenPos: Vector3): Vector3 {
        if (!this._threeCamera) {
            console.error("Camera not initialized");
            return Vector3.zero;
        }

        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // Конвертуємо екранні координати в [-1, 1]
        const vec = new THREE.Vector3(
            (screenPos.x / screenWidth) * 2 - 1,
            -(screenPos.y / screenHeight) * 2 + 1,
            -screenPos.z
        );

        // Unproject у світові координати
        vec.unproject(this._threeCamera);

        return new Vector3(vec.x, vec.y, vec.z);
    }

    // === Методи - Інші ===

    /**
     * Отримує проекційну матрицю камери
     */
    public getProjectionMatrix(): Matrix4x4 {
        if (!this._threeCamera) {
            return Matrix4x4.identity;
        }

        const result = new Matrix4x4();
        const m = this._threeCamera.projectionMatrix;
        
        // Копіюємо елементи напряму
        for (let i = 0; i < 16; i++) {
            result["elements"][i] = m.elements[i];
        }
        
        return result;
    }

    /**
     * Отримує view матрицю камери
     */
    public getViewMatrix(): Matrix4x4 {
        if (!this._threeCamera) {
            return Matrix4x4.identity;
        }

        const result = new Matrix4x4();
        const m = this._threeCamera.matrixWorldInverse;
        
        // Копіюємо елементи напряму
        for (let i = 0; i < 16; i++) {
            result["elements"][i] = m.elements[i];
        }
        
        return result;
    }

    // === Приватні методи ===

    /**
     * Перестворює камеру при зміні типу (perspective <-> ortho)
     */
    private updateCameraType(): void {
        // Видаляємо стару камеру
        if (this._threeCamera && this.gameObject?.transform.object3D) {
            this.gameObject.transform.object3D.remove(this._threeCamera);
        }

        if (this._orthographic) {
            this.createOrthoCamera();
        } else {
            this.createPerspectiveCamera();
        }

        // Додаємо нову камеру
        if (this._threeCamera && this.gameObject?.transform.object3D) {
            this.gameObject.transform.object3D.add(this._threeCamera);
        }
    }

    /**
     * Створює перспективну камеру
     */
    private createPerspectiveCamera(): void {
        this._threeCamera = new THREE.PerspectiveCamera(
            this._fieldOfView,
            this._aspect,
            this._nearClipPlane,
            this._farClipPlane
        );
    }

    /**
     * Створює ортогональну камеру
     */
    private createOrthoCamera(): void {
        const width = this._orthographicSize * this._aspect;
        const height = this._orthographicSize;

        this._threeCamera = new THREE.OrthographicCamera(
            -width / 2,
            width / 2,
            height / 2,
            -height / 2,
            this._nearClipPlane,
            this._farClipPlane
        );
    }

    /**
     * Оновлює ортогональну камеру при зміні параметрів
     */
    private updateOrthoCamera(): void {
        if (!(this._threeCamera instanceof THREE.OrthographicCamera)) return;

        const width = this._orthographicSize * this._aspect;
        const height = this._orthographicSize;

        this._threeCamera.left = -width / 2;
        this._threeCamera.right = width / 2;
        this._threeCamera.top = height / 2;
        this._threeCamera.bottom = -height / 2;

        this._threeCamera.updateProjectionMatrix();
    }
}
