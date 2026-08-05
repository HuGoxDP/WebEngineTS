// path: src/engine/core/components/Camera.ts

import * as THREE from "three";
import { Behaviour } from "../Behaviour.ts";
import { profilerHooks } from "../diagnostics/ProfilerHooks.ts";
import { Color } from "../math/Color.ts";
import { Rect } from "../math/Rect.ts";
import { Matrix4x4 } from "../math/Matrix4x4.ts";
import { Vector3 } from "../math/Vector3.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Ray } from "../math/Ray.ts";
import type { GameObject } from "../GameObject.ts";

// ==================== CACHED THREE.JS TEMPORARIES ====================
// Used in coordinate conversion methods to avoid per-call allocations.

const _tvec3 = new THREE.Vector3();

// ==================== ENUMS ====================

/**
 * How the camera clears the background before rendering.
 *
 * @remarks Equivalent to Unity's `CameraClearFlags`.
 */
export enum CameraClearFlags {
    /** Fill the background with {@link Camera.backgroundColor}. */
    SolidColor = 0,
    /** Clear only the depth buffer (for layered camera rendering). */
    Depth = 1,
    /** Don't clear anything. */
    Nothing = 2,
    Skybox = 3,
}

// ==================== CAMERA ====================

/**
 * A component that renders the scene from a specific viewpoint.
 *
 * Camera controls projection (perspective or orthographic), clipping planes,
 * viewport, and background color. It creates and manages an internal Three.js
 * camera that is added as a child of the Transform's scene graph node.
 *
 * @remarks
 * Equivalent to Unity's `UnityEngine.Camera`.
 *
 * **Static access:**
 * - {@link Camera.main} — returns the first active Camera tagged as "MainCamera"
 *   (or the first active Camera if none is tagged).
 * - {@link Camera.allCameras} — returns all active cameras sorted by depth.
 *
 * **Three.js isolation:**
 * - The internal Three.js camera is never exposed in public API.
 * - {@link Application} accesses it via the `@internal` accessor
 *   {@link _internalThreeCamera} for rendering.
 *
 * @example
 * ```ts
 * const camGo = new GameObject("Main Camera");
 * camGo.tag = "MainCamera";
 * const cam = camGo.addComponent(Camera);
 * cam.fieldOfView = 60;
 * cam.backgroundColor = new Color(0.01, 0.01, 0.06);
 * camGo.transform.position = new Vector3(0, 2, 5);
 * camGo.transform.lookAt(Vector3.zero);
 * ```
 */
export class Camera extends Behaviour {

    // ==================== STATIC CAMERA REGISTRY ====================

    /**
     * All currently active Camera instances, in order of creation.
     * Cameras add themselves in `onAwake` and remove in `onDestroy`.
     * @internal
     */
    private static _activeCameras: Camera[] = [];

    /**
     * Returns the main camera.
     *
     * The main camera is the first active Camera whose GameObject is tagged
     * `"MainCamera"`. If no camera has that tag, the first active Camera
     * is returned. Returns `null` if no cameras exist.
     *
     * @remarks Equivalent to Unity's `Camera.main`.
     */
    public static get main(): Camera | null {
        // Prefer tagged MainCamera
        for (const cam of Camera._activeCameras) {
            if (cam.isActiveAndEnabled && cam.gameObject.tag === "MainCamera") {
                return cam;
            }
        }
        // Fallback: first active camera
        for (const cam of Camera._activeCameras) {
            if (cam.isActiveAndEnabled) {
                return cam;
            }
        }
        return null;
    }

    /**
     * Returns all active cameras sorted by {@link depth} (ascending).
     *
     * @remarks Equivalent to Unity's `Camera.allCameras`.
     */
    public static get allCameras(): readonly Camera[] {
        return Camera._activeCameras
            .filter(c => c.isActiveAndEnabled)
            .sort((a, b) => a._depth - b._depth);
    }

    // ==================== INTERNAL THREE.JS STATE ====================

    /**
     * The underlying Three.js camera (Perspective or Orthographic).
     * @internal
     */
    private _threeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null;

    // ==================== ENGINE PROPERTIES ====================

    /** True = orthographic projection, false = perspective. */
    private _orthographic: boolean = false;

    /** Vertical field of view in degrees (perspective mode). */
    private _fieldOfView: number = 60;

    /** Half-height of the orthographic view volume in world units. */
    private _orthographicSize: number = 5;

    /** Near clipping plane distance. */
    private _nearClipPlane: number = 0.3;

    /** Far clipping plane distance. */
    private _farClipPlane: number = 1000;

    /** Width / height ratio. */
    private _aspect: number = 16 / 9;

    /** Normalized viewport rectangle (0–1). */
    private _viewport: Rect = new Rect(0, 0, 1, 1);

    /** Background clear color. */
    private _backgroundColor: Color = Color.black;

    /** How the camera clears the background. */
    private _clearFlags: CameraClearFlags = CameraClearFlags.SolidColor;

    /** Rendering depth (higher = rendered later, drawn on top). */
    private _depth: number = 0;

    /** Culling mask — determines which layers this camera renders. */
    private _cullingMask: number = 0xFFFFFFFF;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "Camera";
    }

    // ==================== INTERNAL ACCESSOR ====================

    /**
     * @internal
     * The underlying Three.js camera, used by {@link Application} for rendering.
     *
     * Returns `null` if the camera hasn't been initialized yet
     * (before `onAwake` runs).
     *
     * **NEVER use in user-facing code.**
     */
    public get _internalThreeCamera(): THREE.Camera | null {
        return this._threeCamera;
    }

    // ==================== LIFECYCLE ====================

    /**
     * @internal
     * Creates the Three.js camera, attaches it as an internal child
     * of the Transform, and registers this camera in the static registry.
     */
    protected override onAwake(): void {
        // Create the Three.js camera based on current projection mode
        this._rebuildThreeCamera();

        // Attach to Transform's scene graph
        if (this._threeCamera !== null) {
            this.gameObject.transform._addInternalChild(this._threeCamera);
        }

        // Register in the global camera list
        Camera._activeCameras.push(this);
    }

    /**
     * @internal
     * Detaches the Three.js camera from the Transform and unregisters
     * from the static camera registry.
     */
    protected override onDestroy(): void {
        // Detach from Transform
        if (this._threeCamera !== null) {
            this.gameObject.transform._removeInternalChild(this._threeCamera);
            this._threeCamera = null;
        }

        // Unregister from global camera list
        const idx = Camera._activeCameras.indexOf(this);
        if (idx !== -1) {
            Camera._activeCameras.splice(idx, 1);
        }
    }

    // ==================== PROJECTION PROPERTIES ====================

    /**
     * Whether this camera uses orthographic projection.
     *
     * Setting this to `true` switches to orthographic mode.
     * Setting to `false` switches to perspective mode.
     * The camera is recreated when this changes.
     *
     * @remarks Equivalent to Unity's `Camera.orthographic`.
     */
    public get orthographic(): boolean {
        return this._orthographic;
    }

    public set orthographic(value: boolean) {
        if (this._orthographic === value) return;
        this._orthographic = value;
        this._switchCameraType();
    }

    /**
     * The vertical field of view in degrees (perspective mode only).
     *
     * @remarks Equivalent to Unity's `Camera.fieldOfView`.
     */
    public get fieldOfView(): number {
        return this._fieldOfView;
    }

    public set fieldOfView(value: number) {
        this._fieldOfView = value;
        if (this._threeCamera instanceof THREE.PerspectiveCamera) {
            this._threeCamera.fov = value;
            this._threeCamera.updateProjectionMatrix();
        }
    }

    /**
     * Half-size of the orthographic view volume (orthographic mode only).
     *
     * @remarks Equivalent to Unity's `Camera.orthographicSize`.
     */
    public get orthographicSize(): number {
        return this._orthographicSize;
    }

    public set orthographicSize(value: number) {
        this._orthographicSize = value;
        if (this._threeCamera instanceof THREE.OrthographicCamera) {
            this._applyOrthoParams(this._threeCamera);
        }
    }

    /**
     * The near clipping plane distance.
     *
     * @remarks Equivalent to Unity's `Camera.nearClipPlane`.
     */
    public get nearClipPlane(): number {
        return this._nearClipPlane;
    }

    public set nearClipPlane(value: number) {
        this._nearClipPlane = value;
        if (this._threeCamera !== null) {
            this._threeCamera.near = value;
            this._threeCamera.updateProjectionMatrix();
        }
    }

    /**
     * The far clipping plane distance.
     *
     * @remarks Equivalent to Unity's `Camera.farClipPlane`.
     */
    public get farClipPlane(): number {
        return this._farClipPlane;
    }

    public set farClipPlane(value: number) {
        this._farClipPlane = value;
        if (this._threeCamera !== null) {
            this._threeCamera.far = value;
            this._threeCamera.updateProjectionMatrix();
        }
    }

    /**
     * The aspect ratio (width / height).
     *
     * Typically set automatically by the Application when the canvas resizes.
     *
     * @remarks Equivalent to Unity's `Camera.aspect`.
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
            this._applyOrthoParams(this._threeCamera);
        }
    }

    // ==================== VIEWPORT & RENDERING PROPERTIES ====================

    /**
     * The normalized viewport rectangle (0–1 range).
     *
     * @remarks Equivalent to Unity's `Camera.rect`.
     */
    public get viewport(): Rect {
        return this._viewport.clone();
    }

    public set viewport(value: Rect) {
        this._viewport = value.clone();
    }

    /**
     * The background color used when {@link clearFlags} is `SolidColor`.
     *
     * @remarks Equivalent to Unity's `Camera.backgroundColor`.
     */
    public get backgroundColor(): Color {
        return this._backgroundColor.clone();
    }

    public set backgroundColor(value: Color) {
        this._backgroundColor = value.clone();
    }

    /**
     * How the camera clears the background before rendering.
     *
     * @remarks Equivalent to Unity's `Camera.clearFlags`.
     */
    public get clearFlags(): CameraClearFlags {
        return this._clearFlags;
    }

    public set clearFlags(value: CameraClearFlags) {
        this._clearFlags = value;
    }

    /**
     * The rendering depth. Cameras with higher depth are rendered later
     * (drawn on top of cameras with lower depth).
     *
     * @remarks Equivalent to Unity's `Camera.depth`.
     */
    public get depth(): number {
        return this._depth;
    }

    public set depth(value: number) {
        this._depth = value;
    }

    /**
     * The layer mask that determines which objects this camera renders.
     *
     * @remarks Equivalent to Unity's `Camera.cullingMask`.
     */
    public get cullingMask(): number {
        return this._cullingMask;
    }

    public set cullingMask(value: number) {
        this._cullingMask = value;
    }

    // ==================== COORDINATE CONVERSION ====================

    /**
     * Converts a world-space position to screen-space pixel coordinates.
     *
     * @param position — world-space point.
     * @returns screen-space point where `x`/`y` are in pixels and
     *          `z` is the depth from the camera.
     *
     * @remarks Equivalent to Unity's `Camera.WorldToScreenPoint`.
     */
    public worldToScreenPoint(position: Vector3): Vector3 {
        if (this._threeCamera === null) return Vector3.zero;

        _tvec3.set(position.x, position.y, position.z);
        _tvec3.project(this._threeCamera);

        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        return new Vector3(
            ((_tvec3.x + 1) * 0.5) * screenWidth,
            ((1 - _tvec3.y) * 0.5) * screenHeight,
            -_tvec3.z
        );
    }

    /**
     * Converts screen-space pixel coordinates to a world-space position.
     *
     * @param screenPos — screen-space point where `x`/`y` are in pixels
     *                     and `z` is the depth from the camera.
     * @returns world-space position.
     *
     * @remarks Equivalent to Unity's `Camera.ScreenToWorldPoint`.
     */
    public screenToWorldPoint(screenPos: Vector3): Vector3 {
        if (this._threeCamera === null) return Vector3.zero;

        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        _tvec3.set(
            (screenPos.x / screenWidth) * 2 - 1,
            -(screenPos.y / screenHeight) * 2 + 1,
            -screenPos.z
        );
        _tvec3.unproject(this._threeCamera);

        return new Vector3(_tvec3.x, _tvec3.y, _tvec3.z);
    }

    /**
     * Creates a ray from the camera through a screen-space pixel position.
     *
     * @param position — screen position in pixels (e.g. `Input.mousePosition`).
     * @returns a {@link Ray} from the camera's position in the direction of
     *          the screen point.
     *
     * @remarks Equivalent to Unity's `Camera.ScreenPointToRay`.
     */
    public screenPointToRay(position: Vector2): Ray {
        if (this._threeCamera === null) return new Ray();

        const ndcX = (position.x / window.innerWidth) * 2 - 1;
        const ndcY = -(position.y / window.innerHeight) * 2 + 1;

        _tvec3.set(ndcX, ndcY, 0.5);
        _tvec3.unproject(this._threeCamera);

        const origin = this.transform.position;
        const direction = new Vector3(
            _tvec3.x - origin.x,
            _tvec3.y - origin.y,
            _tvec3.z - origin.z
        ).normalize();

        return new Ray(origin, direction);
    }

    // ==================== MATRIX ACCESS ====================

    /**
     * Returns the camera's projection matrix.
     *
     * @remarks Equivalent to Unity's `Camera.projectionMatrix`.
     */
    public get projectionMatrix(): Matrix4x4 {
        if (this._threeCamera === null) return Matrix4x4.identity;

        const result = new Matrix4x4();
        const src = this._threeCamera.projectionMatrix.elements;
        for (let i = 0; i < 16; i++) {
            result.elements[i] = src[i];
        }
        return result;
    }

    /**
     * Returns the camera's view matrix (world → camera space).
     *
     * @remarks Equivalent to Unity's inverse of `Camera.cameraToWorldMatrix`.
     */
    public get worldToCameraMatrix(): Matrix4x4 {
        if (this._threeCamera === null) return Matrix4x4.identity;

        const result = new Matrix4x4();
        const src = this._threeCamera.matrixWorldInverse.elements;
        for (let i = 0; i < 16; i++) {
            result.elements[i] = src[i];
        }
        return result;
    }

    /**
     * @internal
     * Projects a world point into normalized viewport coordinates, without
     * allocating and without assuming the render surface fills the window.
     *
     * Writes `x`/`y` in 0–1 across the viewport with **Y down** (0 = top), the
     * UI subsystem's convention rather than {@link worldToScreenPoint}'s, and
     * `z` = distance in front of the camera in world units.
     *
     * @param x - world X.
     * @param y - world Y.
     * @param z - world Z.
     * @param out - vector receiving the result; untouched when this returns false.
     * @returns false when the point is at or behind the eye, where the
     *          projection mirrors and the result would be meaningless.
     */
    public _worldToViewportPoint(x: number, y: number, z: number, out: Vector3): boolean {
        const cam = this._threeCamera;
        if (cam === null) return false;

        // The UI resolves before the render pass, so the matrices Three.js keeps
        // are still the previous frame's — refreshed here so a label tracks the
        // camera's current position rather than lagging it by a frame. Ancestors
        // included: the camera is a child of its Transform's object, and a rig
        // that moved this frame has not been flushed either.
        cam.updateWorldMatrix(true, false);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

        _tvec3.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);

        // View space looks down −Z, so a point in front of the camera has
        // negative z there.
        const distance = -_tvec3.z;
        if (distance <= 1e-6) return false;

        _tvec3.applyMatrix4(cam.projectionMatrix);
        out.set((_tvec3.x + 1) * 0.5, (1 - _tvec3.y) * 0.5, distance);
        return true;
    }

    /**
     * @internal
     * World units spanned vertically by the view volume at `distance`, i.e. how
     * much world fits on screen there. Constant for an orthographic camera.
     */
    public _frustumHeightAt(distance: number): number {
        if (this._orthographic) return 2 * this._orthographicSize;
        return 2 * distance * Math.tan((this._fieldOfView * Math.PI) / 360);
    }

    // ==================== PRIVATE HELPERS ====================

    /**
     * @internal
     * Creates the initial Three.js camera based on current projection settings.
     */
    private _rebuildThreeCamera(): void {
        if (this._orthographic) {
            const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, this._nearClipPlane, this._farClipPlane);
            this._applyOrthoParams(cam);
            this._threeCamera = cam;
        } else {
            this._threeCamera = new THREE.PerspectiveCamera(
                this._fieldOfView,
                this._aspect,
                this._nearClipPlane,
                this._farClipPlane
            );
        }

        this._threeCamera.rotateY(Math.PI);
    }

    /**
     * @internal
     * Destroys the current Three.js camera, rebuilds it with the new
     * projection type, and re-attaches to the Transform.
     */
    private _switchCameraType(): void {
        // Detach old
        if (this._threeCamera !== null) {
            this.gameObject.transform._removeInternalChild(this._threeCamera);
        }

        // Rebuild
        this._rebuildThreeCamera();

        // Re-attach
        if (this._threeCamera !== null) {
            this.gameObject.transform._addInternalChild(this._threeCamera);
        }
    }

    /**
     * @internal
     * Applies current orthographic parameters to an OrthographicCamera.
     */
    private _applyOrthoParams(cam: THREE.OrthographicCamera): void {
        const halfHeight = this._orthographicSize;
        const halfWidth = halfHeight * this._aspect;

        cam.left = -halfWidth;
        cam.right = halfWidth;
        cam.top = halfHeight;
        cam.bottom = -halfHeight;
        cam.near = this._nearClipPlane;
        cam.far = this._farClipPlane;

        cam.updateProjectionMatrix();
    }
}

profilerHooks.cameraCount = () => Camera.allCameras.length;