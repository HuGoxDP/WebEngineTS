// path: src/engine/core/components/Camera.ts

import * as THREE from "three";
import { Behaviour } from "../Behaviour.ts";
import { profilerHooks } from "../diagnostics/ProfilerHooks.ts";
import { Serializable, SerializedField } from "../reflection/Decorators.ts";
import { FieldType } from "../reflection/Types.ts";
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
const _tvec3B = new THREE.Vector3();

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
@Serializable({ typeName: "Camera", category: "Rendering" })
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

    /** Render-surface width in CSS pixels; 0 until the Application sets it. */
    private _pixelWidth: number = 0;

    /** Render-surface height in CSS pixels; 0 until the Application sets it. */
    private _pixelHeight: number = 0;

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
    @SerializedField()
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
    @SerializedField()
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
    @SerializedField()
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
    @SerializedField()
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
    @SerializedField()
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

    /**
     * The width of the camera's render surface in pixels.
     *
     * @remarks
     * Equivalent to Unity's `Camera.pixelWidth`. Driven by the {@link Application}
     * when the canvas resizes; falls back to the window width until then (e.g. in
     * isolated tests). Does not yet account for {@link viewport} — see the
     * coordinate-spaces design note.
     */
    public get pixelWidth(): number {
        return this._surfaceWidth();
    }

    /**
     * The height of the camera's render surface in pixels.
     *
     * @remarks Equivalent to Unity's `Camera.pixelHeight`. See {@link pixelWidth}.
     */
    public get pixelHeight(): number {
        return this._surfaceHeight();
    }

    /**
     * @internal
     * Sets the render-surface size in CSS pixels. The {@link Application} calls
     * this on resize so coordinate conversions do not assume the canvas fills the
     * window. Pass `0`, `0` to clear and fall back to the window size.
     */
    public _setPixelSize(width: number, height: number): void {
        this._pixelWidth = width;
        this._pixelHeight = height;
    }

    // ==================== VIEWPORT & RENDERING PROPERTIES ====================

    /**
     * The normalized viewport rectangle (0–1 range).
     *
     * @remarks Equivalent to Unity's `Camera.rect`.
     */
    @SerializedField({ type: FieldType.Rect })
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
    @SerializedField({ type: FieldType.Color })
    public get backgroundColor(): Color {
        return this._backgroundColor.clone();
    }

    public set backgroundColor(value: Color) {
        this._backgroundColor = value.clone();
    }

    /**
     * The background color, written into `out` when one is given.
     *
     * @remarks
     * The allocation-free form of {@link backgroundColor}. That property is a
     * value type and so returns a fresh copy on every read, which is right for
     * scenario code and wrong for anything reading it once a frame — the render
     * path does. Pass a reused `Color` and nothing is allocated.
     *
     * The same shape as `Gradient.evaluate(t, out)`.
     *
     * @param out - destination. A new `Color` is allocated when omitted.
     * @returns `out`, or a new `Color`.
     */
    public getBackgroundColor(out?: Color): Color {
        return out ? out.copy(this._backgroundColor) : this._backgroundColor.clone();
    }

    /**
     * How the camera clears the background before rendering.
     *
     * @remarks Equivalent to Unity's `Camera.clearFlags`.
     */
    @SerializedField({ type: FieldType.Enum, enumValues: CameraClearFlags as unknown as Record<string, number> })
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
    @SerializedField()
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
    @SerializedField()
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
     * @returns screen-space point where `x`/`y` are pixels from the **top-left** of
     *          the render surface (X right, Y **down**, matching
     *          {@link Input.mousePosition}) and `z` is the distance from the camera
     *          in world units.
     *
     * @remarks
     * Equivalent to Unity's `Camera.WorldToScreenPoint`, except the screen origin
     * is the top-left with Y down rather than Unity's bottom-left, Y up — the
     * engine's screen convention. Pixel size comes from {@link pixelWidth} /
     * {@link pixelHeight}, not the window.
     */
    public worldToScreenPoint(position: Vector3): Vector3 {
        const cam = this._threeCamera;
        if (cam === null) return Vector3.zero.clone();
        this._ensureCameraMatrices(cam);

        // View-space z is negative in front of the camera; Unity's screen z is the
        // world-unit distance from the camera, so negate it. Kept signed, so a
        // point behind the camera reports a negative distance, as Unity's does.
        _tvec3.set(position.x, position.y, position.z).applyMatrix4(cam.matrixWorldInverse);
        const distance = -_tvec3.z;

        _tvec3.set(position.x, position.y, position.z).project(cam);
        return new Vector3(
            (_tvec3.x + 1) * 0.5 * this._surfaceWidth(),
            (1 - _tvec3.y) * 0.5 * this._surfaceHeight(),
            distance
        );
    }

    /**
     * Converts a world-space position to viewport coordinates.
     *
     * @param position — world-space point.
     * @returns viewport point where `x`/`y` are 0–1 across the surface (Y **down**:
     *          0 = top, 1 = bottom) and `z` is the distance from the camera in
     *          world units.
     *
     * @remarks
     * Equivalent to Unity's `Camera.WorldToViewportPoint`, except Y points down
     * (see {@link worldToScreenPoint}), staying consistent with the engine's
     * screen space rather than Unity's bottom-left viewport.
     */
    public worldToViewportPoint(position: Vector3): Vector3 {
        const s = this.worldToScreenPoint(position);
        const w = this._surfaceWidth();
        const h = this._surfaceHeight();
        return new Vector3(w > 0 ? s.x / w : 0, h > 0 ? s.y / h : 0, s.z);
    }

    /**
     * Converts screen-space pixel coordinates to a world-space position.
     *
     * @param screenPos — screen-space point where `x`/`y` are pixels from the
     *          top-left (Y down) and `z` is the distance **in front of the camera
     *          in world units** at which the returned point lies. `z = 0` returns
     *          the camera's own position.
     * @returns world-space position.
     *
     * @remarks Equivalent to Unity's `Camera.ScreenToWorldPoint`, with the
     *          top-left, Y-down screen origin described on {@link worldToScreenPoint}.
     */
    public screenToWorldPoint(screenPos: Vector3): Vector3 {
        const cam = this._threeCamera;
        if (cam === null) return Vector3.zero.clone();
        this._ensureCameraMatrices(cam);

        const ndcX = (screenPos.x / this._surfaceWidth()) * 2 - 1;
        const ndcY = -(screenPos.y / this._surfaceHeight()) * 2 + 1;

        // World-space ray through the pixel: origin at the camera, direction toward
        // the unprojected near-plane point.
        cam.getWorldPosition(_tvec3B);
        _tvec3.set(ndcX, ndcY, 0.5).unproject(cam);
        const dirX = _tvec3.x - _tvec3B.x;
        const dirY = _tvec3.y - _tvec3B.y;
        const dirZ = _tvec3.z - _tvec3B.z;

        // Step along the ray until the camera-space depth equals screenPos.z. The
        // view-space z of the direction is row 2 of the inverse-world matrix dotted
        // with it (column-major elements 2/6/10); the camera origin has view-space
        // z 0, so the point at distance d satisfies t · viewZ(dir) = −d.
        const e = cam.matrixWorldInverse.elements;
        const viewZofDir = e[2] * dirX + e[6] * dirY + e[10] * dirZ;
        const t = viewZofDir !== 0 ? -screenPos.z / viewZofDir : 0;

        return new Vector3(
            _tvec3B.x + dirX * t,
            _tvec3B.y + dirY * t,
            _tvec3B.z + dirZ * t
        );
    }

    /**
     * Converts viewport coordinates to a world-space position.
     *
     * @param viewportPos — viewport point (`x`/`y` in 0–1, Y down) whose `z` is the
     *          distance in front of the camera in world units.
     * @returns world-space position.
     *
     * @remarks Equivalent to Unity's `Camera.ViewportToWorldPoint` (Y-down — see
     *          {@link worldToViewportPoint}).
     */
    public viewportToWorldPoint(viewportPos: Vector3): Vector3 {
        return this.screenToWorldPoint(new Vector3(
            viewportPos.x * this._surfaceWidth(),
            viewportPos.y * this._surfaceHeight(),
            viewportPos.z
        ));
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
        const cam = this._threeCamera;
        if (cam === null) return new Ray();
        this._ensureCameraMatrices(cam);

        const ndcX = (position.x / this._surfaceWidth()) * 2 - 1;
        const ndcY = -(position.y / this._surfaceHeight()) * 2 + 1;

        _tvec3.set(ndcX, ndcY, 0.5).unproject(cam);

        const origin = this.transform.position;
        const direction = new Vector3(
            _tvec3.x - origin.x,
            _tvec3.y - origin.y,
            _tvec3.z - origin.z
        ).normalize();

        return new Ray(origin, direction);
    }

    /**
     * Creates a ray from the camera through a viewport position.
     *
     * @param position — viewport position (`x`/`y` in 0–1, Y down).
     * @returns a {@link Ray} from the camera's position through the viewport point.
     *
     * @remarks Equivalent to Unity's `Camera.ViewportPointToRay` (Y-down).
     */
    public viewportPointToRay(position: Vector2): Ray {
        return this.screenPointToRay(new Vector2(
            position.x * this._surfaceWidth(),
            position.y * this._surfaceHeight()
        ));
    }

    /**
     * Converts screen-space pixel coordinates to viewport coordinates.
     *
     * @param screenPos — screen point (`x`/`y` pixels from the top-left, Y down);
     *          `z` is passed through unchanged.
     * @returns viewport point (`x`/`y` in 0–1, Y down).
     *
     * @remarks Equivalent to Unity's `Camera.ScreenToViewportPoint` (Y-down).
     */
    public screenToViewportPoint(screenPos: Vector3): Vector3 {
        const w = this._surfaceWidth();
        const h = this._surfaceHeight();
        return new Vector3(w > 0 ? screenPos.x / w : 0, h > 0 ? screenPos.y / h : 0, screenPos.z);
    }

    /**
     * Converts viewport coordinates to screen-space pixel coordinates.
     *
     * @param viewportPos — viewport point (`x`/`y` in 0–1, Y down); `z` is passed
     *          through unchanged.
     * @returns screen point (`x`/`y` pixels from the top-left, Y down).
     *
     * @remarks Equivalent to Unity's `Camera.ViewportToScreenPoint` (Y-down).
     */
    public viewportToScreenPoint(viewportPos: Vector3): Vector3 {
        return new Vector3(
            viewportPos.x * this._surfaceWidth(),
            viewportPos.y * this._surfaceHeight(),
            viewportPos.z
        );
    }

    // ==================== MATRIX ACCESS ====================

    /**
     * Returns the camera's projection matrix.
     *
     * @remarks Equivalent to Unity's `Camera.projectionMatrix`.
     */
    public get projectionMatrix(): Matrix4x4 {
        if (this._threeCamera === null) return Matrix4x4.identity.clone();

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
        if (this._threeCamera === null) return Matrix4x4.identity.clone();
        this._ensureCameraMatrices(this._threeCamera);

        const result = new Matrix4x4();
        const src = this._threeCamera.matrixWorldInverse.elements;
        for (let i = 0; i < 16; i++) {
            result.elements[i] = src[i];
        }
        return result;
    }

    /**
     * Returns the camera-to-world matrix (camera space → world).
     *
     * @remarks
     * Equivalent to Unity's `Camera.cameraToWorldMatrix`. Camera space follows the
     * OpenGL convention (forward is −Z), which **matches** Unity — this is not a
     * deviation. See the class docs.
     */
    public get cameraToWorldMatrix(): Matrix4x4 {
        if (this._threeCamera === null) return Matrix4x4.identity.clone();
        this._ensureCameraMatrices(this._threeCamera);

        const result = new Matrix4x4();
        const src = this._threeCamera.matrixWorld.elements;
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
        this._ensureCameraMatrices(cam);

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
     * Refreshes the Three.js camera's world and inverse-world matrices so a
     * conversion reflects the camera's current pose. Coordinate methods and the UI
     * can run before the render pass, when Three's cached matrices still hold the
     * previous frame's values; ancestors are included so a moved rig is current too.
     */
    private _ensureCameraMatrices(cam: THREE.Camera): void {
        cam.updateWorldMatrix(true, false);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    }

    /**
     * @internal
     * Render-surface width in pixels: the size set by the Application, or the
     * window width as a fallback when none has been set (isolated tests).
     */
    private _surfaceWidth(): number {
        if (this._pixelWidth > 0) return this._pixelWidth;
        return typeof window !== "undefined" ? window.innerWidth : 0;
    }

    /**
     * @internal
     * Render-surface height in pixels. See {@link _surfaceWidth}.
     */
    private _surfaceHeight(): number {
        if (this._pixelHeight > 0) return this._pixelHeight;
        return typeof window !== "undefined" ? window.innerHeight : 0;
    }

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