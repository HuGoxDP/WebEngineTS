// path: src/engine/core/components/SpriteRenderer.ts

import * as THREE from "three";
import { Renderer } from "../rendering/Renderer.ts";
import { Color } from "../math/Color.ts";
import { Vector2 } from "../math/Vector2.ts";
import { Texture2D } from "../graphics/Texture2D.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Billboard rendering mode for a sprite.
 *
 * @remarks Equivalent to a subset of Unity's `SpriteMeshType` / billboard settings.
 */
export enum SpriteBillboardMode {
    /** Always faces the camera on all axes (full billboard). Default. */
    FaceCamera = 0,
    /**
     * Fixed size on screen regardless of camera distance.
     * Useful for labels, markers, UI indicators in world space.
     */
    FixedScreenSize = 1,
}

/**
 * Renders a 2D sprite (textured billboard quad) in 3D space.
 *
 * The sprite always faces the camera automatically — no per-frame
 * rotation code needed. Uses Three.js `Sprite` internally for
 * GPU-side billboarding (zero CPU overhead for orientation).
 *
 * Supports color tinting, opacity, flip, sprite sheet animation
 * via UV rect, sorting order, and pixel-art-friendly filtering.
 *
 * @remarks Equivalent to Unity's `UnityEngine.SpriteRenderer`.
 *
 * **Three.js isolation:** The internal `THREE.Sprite` is never exposed.
 * All public properties use engine types (Color, Texture2D, Vector2).
 *
 * @example
 * ```ts
 * const go = new GameObject("Icon");
 * const sr = go.addComponent(SpriteRenderer);
 * sr.sprite = await assets.loadTexture("textures/star.png");
 * sr.color = new Color(1, 0.9, 0, 1);
 * sr.pixelsPerUnit = 100;
 *
 * // Sprite sheet animation (4×4 grid, frame 5)
 * sr.setAtlasRect(4, 4, 5);
 * ```
 */
export class SpriteRenderer extends Renderer {

    // ==================== INTERNAL THREE.JS STATE ====================

    /** @internal */
    private _threeSprite: THREE.Sprite | null = null;

    /** @internal */
    private _threeSpriteMaterial: THREE.SpriteMaterial | null = null;

    // ==================== ENGINE STATE ====================

    /** The texture displayed by this sprite. */
    private _sprite: Texture2D | null = null;

    /** Color tint applied to the sprite. */
    private _color: Color = Color.white;

    /** Horizontal flip (UV-based, does not affect children). */
    private _flipX: boolean = false;

    /** Vertical flip (UV-based, does not affect children). */
    private _flipY: boolean = false;

    /** Billboard mode. */
    private _billboardMode: SpriteBillboardMode = SpriteBillboardMode.FaceCamera;

    /**
     * Pixels-per-unit scale factor. A 100×100px sprite with
     * pixelsPerUnit=100 renders as 1×1 world unit.
     */
    private _pixelsPerUnit: number = 100;

    /**
     * Sorting order within the same sorting layer.
     * Higher values render on top.
     */
    private _sortingOrder: number = 0;

    /**
     * Normalized pivot point (0–1). Default (0.5, 0.5) = center.
     * (0, 0) = bottom-left, (1, 1) = top-right.
     */
    private _pivot: Vector2 = new Vector2(0.5, 0.5);

    /** Whether the alpha test is enabled (for cutout sprites). */
    private _alphaTest: number = 0.01;

    // ==================== CONSTRUCTOR ====================

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "SpriteRenderer";
    }

    // ==================== LIFECYCLE ====================

    /** @internal */
    protected override onAwake(): void {
        this._threeSpriteMaterial = new THREE.SpriteMaterial({
            color: 0xffffff,
            transparent: true,
            alphaTest: this._alphaTest,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this._threeSprite = new THREE.Sprite(this._threeSpriteMaterial);

        // Register with Renderer base
        this._setInternalRenderObject(this._threeSprite);

        // Apply initial state
        this._syncColor();
        this._syncTexture();
        this._syncScale();
        this._syncPivot();
    }

    /** @internal */
    protected override onDestroy(): void {
        if (this._threeSpriteMaterial) {
            this._threeSpriteMaterial.dispose();
            this._threeSpriteMaterial = null;
        }
        this._threeSprite = null;

        super.onDestroy();
    }

    // ==================== PUBLIC PROPERTIES ====================

    /**
     * The sprite texture to display.
     *
     * @remarks Equivalent to Unity's `SpriteRenderer.sprite`.
     */
    public get sprite(): Texture2D | null {
        return this._sprite;
    }

    public set sprite(value: Texture2D | null) {
        this._sprite = value;
        this._syncTexture();
        this._syncScale();
    }

    /**
     * Color tint multiplied with the sprite texture.
     * Alpha controls overall opacity.
     *
     * @remarks Equivalent to Unity's `SpriteRenderer.color`.
     */
    public get color(): Color {
        return this._color.clone();
    }

    public set color(value: Color) {
        this._color = value.clone();
        this._syncColor();
    }

    /**
     * Flip the sprite horizontally (UV flip, does not affect children).
     *
     * @remarks Equivalent to Unity's `SpriteRenderer.flipX`.
     */
    public get flipX(): boolean {
        return this._flipX;
    }

    public set flipX(value: boolean) {
        this._flipX = value;
        this._syncFlip();
    }

    /**
     * Flip the sprite vertically (UV flip, does not affect children).
     *
     * @remarks Equivalent to Unity's `SpriteRenderer.flipY`.
     */
    public get flipY(): boolean {
        return this._flipY;
    }

    public set flipY(value: boolean) {
        this._flipY = value;
        this._syncFlip();
    }

    /**
     * Billboard rendering mode.
     */
    public get billboardMode(): SpriteBillboardMode {
        return this._billboardMode;
    }

    public set billboardMode(value: SpriteBillboardMode) {
        this._billboardMode = value;
        if (this._threeSpriteMaterial) {
            this._threeSpriteMaterial.sizeAttenuation =
                value !== SpriteBillboardMode.FixedScreenSize;
            this._threeSpriteMaterial.needsUpdate = true;
        }
    }

    /**
     * Pixels-per-unit conversion factor.
     * Controls how many texture pixels correspond to one world unit.
     * Higher values = smaller sprite in world space.
     *
     * @remarks Equivalent to Unity's Sprite import setting `Pixels Per Unit`.
     */
    public get pixelsPerUnit(): number {
        return this._pixelsPerUnit;
    }

    public set pixelsPerUnit(value: number) {
        this._pixelsPerUnit = Math.max(1, value);
        this._syncScale();
    }

    /**
     * Sorting order within the rendering layer.
     * Sprites with higher sortingOrder render on top of lower ones.
     *
     * @remarks Equivalent to Unity's `SpriteRenderer.sortingOrder`.
     */
    public get sortingOrder(): number {
        return this._sortingOrder;
    }

    public set sortingOrder(value: number) {
        this._sortingOrder = value;
        if (this._threeSprite) {
            this._threeSprite.renderOrder = value;
        }
    }

    /**
     * Normalized pivot point (0–1 range).
     * (0.5, 0.5) = center, (0, 0) = bottom-left, (1, 1) = top-right.
     *
     * @remarks Equivalent to Unity's Sprite pivot setting.
     */
    public get pivot(): Vector2 {
        return this._pivot.clone();
    }

    public set pivot(value: Vector2) {
        this._pivot = value.clone();
        this._syncPivot();
    }

    /**
     * Alpha test threshold. Pixels with alpha below this value are discarded.
     * Set to 0 to disable alpha testing.
     *
     * @remarks Default 0.01 (discard fully transparent pixels).
     */
    public get alphaTest(): number {
        return this._alphaTest;
    }

    public set alphaTest(value: number) {
        this._alphaTest = value;
        if (this._threeSpriteMaterial) {
            this._threeSpriteMaterial.alphaTest = value;
            this._threeSpriteMaterial.needsUpdate = true;
        }
    }

    // ==================== SPRITE SHEET / ATLAS ====================

    /**
     * Sets the UV rectangle for sprite sheet / atlas animation.
     *
     * Call this each frame (or when the animation frame changes) to
     * display a specific tile from a sprite sheet.
     *
     * @param columns — number of columns in the sprite sheet.
     * @param rows — number of rows in the sprite sheet.
     * @param frameIndex — zero-based frame index (left-to-right, top-to-bottom).
     *
     * @example
     * ```ts
     * // 4×4 sprite sheet, show frame 7
     * spriteRenderer.setAtlasRect(4, 4, 7);
     * ```
     */
    public setAtlasRect(columns: number, rows: number, frameIndex: number): void {
        if (!this._sprite) return;

        const threeTex = this._sprite._internalThreeTexture;
        const col = frameIndex % columns;
        const row = Math.floor(frameIndex / columns);

        threeTex.repeat.set(1 / columns, 1 / rows);
        threeTex.offset.set(
            col / columns,
            1 - (row + 1) / rows
        );
        threeTex.needsUpdate = true;
    }

    /**
     * Resets the UV rectangle to show the full texture (no atlas).
     */
    public resetAtlasRect(): void {
        if (!this._sprite) return;

        const threeTex = this._sprite._internalThreeTexture;
        threeTex.repeat.set(1, 1);
        threeTex.offset.set(0, 0);
        threeTex.needsUpdate = true;
    }

    /**
     * Enables pixel-art-friendly rendering (nearest-neighbor filtering,
     * no mipmaps). Call after setting a pixel-art sprite.
     */
    public usePixelArtFiltering(): void {
        if (!this._sprite) return;

        const threeTex = this._sprite._internalThreeTexture;
        threeTex.magFilter = THREE.NearestFilter;
        threeTex.minFilter = THREE.NearestFilter;
        threeTex.generateMipmaps = false;
        threeTex.needsUpdate = true;
    }

    // ==================== RENDERER OVERRIDES ====================

    /**
     * @internal
     * SpriteRenderer manages its own material internally (SpriteMaterial),
     * not through the Renderer material system. Override to no-op.
     */
    protected override _syncMaterialToThree(): void {
        // SpriteMaterial is managed directly, not through sharedMaterial
    }

    // ==================== PRIVATE SYNC METHODS ====================

    /** Syncs color + opacity to Three.js SpriteMaterial. */
    private _syncColor(): void {
        if (!this._threeSpriteMaterial) return;

        this._threeSpriteMaterial.color.setRGB(
            this._color.r,
            this._color.g,
            this._color.b
        );
        this._threeSpriteMaterial.opacity = this._color.a;
        this._threeSpriteMaterial.needsUpdate = true;
    }

    /** Syncs texture to Three.js SpriteMaterial. */
    private _syncTexture(): void {
        if (!this._threeSpriteMaterial) return;

        if (this._sprite) {
            this._threeSpriteMaterial.map = this._sprite._internalThreeTexture;
        } else {
            this._threeSpriteMaterial.map = null;
        }
        this._threeSpriteMaterial.needsUpdate = true;
    }

    /**
     * Syncs sprite world scale based on texture dimensions and pixelsPerUnit.
     * A 200×100 texture at 100 PPU renders as 2×1 world units.
     */
    private _syncScale(): void {
        if (!this._threeSprite) return;

        if (this._sprite) {
            const tex = this._sprite._internalThreeTexture;
            const img = tex.image as HTMLImageElement | HTMLCanvasElement | null;
            const w = img?.width ?? 1;
            const h = img?.height ?? 1;

            this._threeSprite.scale.set(
                w / this._pixelsPerUnit,
                h / this._pixelsPerUnit,
                1
            );
        } else {
            this._threeSprite.scale.set(1, 1, 1);
        }
    }

    /** Syncs pivot to Three.js Sprite.center. */
    private _syncPivot(): void {
        if (!this._threeSprite) return;
        this._threeSprite.center.set(this._pivot.x, this._pivot.y);
    }

    /**
     * Syncs flipX/flipY via texture repeat (negative = flip).
     * This is a UV-only operation — does not affect Transform or children.
     */
    private _syncFlip(): void {
        if (!this._sprite) return;

        const threeTex = this._sprite._internalThreeTexture;
        const rx = Math.abs(threeTex.repeat.x);
        const ry = Math.abs(threeTex.repeat.y);

        threeTex.repeat.set(
            this._flipX ? -rx : rx,
            this._flipY ? -ry : ry
        );
        threeTex.needsUpdate = true;
    }
}