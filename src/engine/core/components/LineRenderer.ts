import * as THREE from "three";
import { Renderer } from "../rendering/Renderer.ts";
import { Color } from "../math/Color";
import { Vector3 } from "../math/Vector3";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/**
 * How a line orients itself.
 */
export enum LineAlignment {
    /** The line faces the camera — a billboard. */
    View = 0,
    /** The line stays in its Transform's local space. */
    TransformZ = 1
}

/**
 * How a texture is mapped along a line.
 */
export enum LineTextureMode {
    /** Stretched once over the whole line. */
    Stretch = 0,
    /** Repeated along the line's length. */
    Tile = 1,
    /** Distributed across the line, one span per segment. */
    DistributePerSegment = 2,
    /** Repeated per segment, with spacing. */
    RepeatPerSegment = 3
}

/**
 * A gradient key — a colour at a position along the line.
 */
export interface GradientColorKey {
    color: Color;
    time: number; // 0-1
}

/**
 * A curve key — a value at a position along the line.
 */
export interface CurveKey {
    value: number;
    time: number; // 0-1
}

/**
 * Draws a line through a set of points in 3D.
 * Mirrors Unity's `LineRenderer`.
 * 
 * Supports:
 * - a colour gradient,
 * - a width that varies along the line,
 * - several alignment modes.
 * 
 * @example
 * ```typescript
 * const lineObj = new GameObject("Line");
 * const line = lineObj.addComponent(LineRenderer);
 * 
 * // Set the points
 * line.positionCount = 3;
 * line.setPosition(0, new Vector3(0, 0, 0));
 * line.setPosition(1, new Vector3(5, 2, 0));
 * line.setPosition(2, new Vector3(10, 0, 0));
 * 
 * // Configure the look
 * line.startWidth = 0.5;
 * line.endWidth = 0.1;
 * line.startColor = Color.red;
 * line.endColor = Color.blue;
 * ```
 */
@Serializable({ typeName: "LineRenderer", category: "Rendering" })
export class LineRenderer extends Renderer {
    /**
     * @internal Not for use outside the engine.
     * The backing Three.js line.
     */
    private _threeLine: THREE.Line | null = null;
    
    /** The points the line passes through. */
    private _positions: Vector3[] = [];
    
    /** Width at the start of the line. */
    private _startWidth: number = 1.0;
    
    /** Width at the end of the line. */
    private _endWidth: number = 1.0;
    
    /** Colour at the start of the line. */
    private _startColor: Color = Color.white;
    
    /** Colour at the end of the line. */
    private _endColor: Color = Color.white;
    
    /** Colour gradient, for anything more than a two-colour blend. */
    private _colorGradient: GradientColorKey[] = [];
    
    /** Width curve, for anything more than a start-to-end taper. */
    private _widthCurve: CurveKey[] = [];
    
    /** Multiplier applied to every width value. */
    private _widthMultiplier: number = 1.0;
    
    /** Whether the points are in world space. */
    private _useWorldSpace: boolean = true;
    
    /** Whether the line closes back on itself. */
    private _loop: boolean = false;
    
    /** Vertices used to round each corner. */
    private _numCornerVertices: number = 0;
    
    /** Vertices used to cap each end. */
    private _numCapVertices: number = 0;
    
    /** Alignment mode. */
    private _alignment: LineAlignment = LineAlignment.View;
    
    /** Texture mode. */
    private _textureMode: LineTextureMode = LineTextureMode.Stretch;
    
    /** Set when the geometry needs rebuilding. */
    private _needsUpdate: boolean = true;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "LineRenderer";
    }

    // === Lifecycle ===

    protected override onAwake(): void {
        // Build the backing Three.js line.
        const geometry = new THREE.BufferGeometry();
        
        const material = new THREE.LineBasicMaterial({ 
            color: 0xffffff,
            linewidth: 1
        });
        
        this._threeLine = new THREE.Line(geometry, material);
       // this._threeObject = this._threeLine;
        
        // Attach it to the scene through the Transform.
        if (this.gameObject?.transform._internalObject3D) {
            this.gameObject.transform._internalObject3D.add(this._threeLine);
        }
    }

    protected override onEnable(): void {
        super.onEnable();
        if (this._threeLine) {
            this._threeLine.visible = true;
        }
    }

    protected override onDisable(): void {
        super.onDisable();
        if (this._threeLine) {
            this._threeLine.visible = false;
        }
    }

    protected override onDestroy(): void {
        if (this._threeLine && this.gameObject?.transform._internalObject3D) {
            this.gameObject.transform._internalObject3D.remove(this._threeLine);
        }
        
        if (this._threeLine) {
            this._threeLine.geometry?.dispose();
            if (this._threeLine.material instanceof THREE.Material) {
                this._threeLine.material.dispose();
            }
        }
        
        this._threeLine = null;
      //  this._threeObject = null;
        
        super.onDestroy();
    }

    // === Properties — point count ===

    /**
     * How many points the line has.
     */
    public get positionCount(): number {
        return this._positions.length;
    }

    public set positionCount(value: number) {
        const oldCount = this._positions.length;
        
        if (value > oldCount) {
            // Grow: new points start at the origin.
            for (let i = oldCount; i < value; i++) {
                this._positions.push(Vector3.zero);
            }
        } else if (value < oldCount) {
            // Shrink: drop the extra points.
            this._positions.length = value;
        }
        
        this._needsUpdate = true;
    }

    // === Properties — width ===

    /**
     * The line's width at its start.
     */
    @SerializedField()
    public get startWidth(): number {
        return this._startWidth;
    }

    public set startWidth(value: number) {
        this._startWidth = Math.max(0, value);
        this._needsUpdate = true;
    }

    /**
     * The line's width at its end.
     */
    @SerializedField()
    public get endWidth(): number {
        return this._endWidth;
    }

    public set endWidth(value: number) {
        this._endWidth = Math.max(0, value);
        this._needsUpdate = true;
    }

    /**
     * Multiplier applied to every width value.
     */
    @SerializedField()
    public get widthMultiplier(): number {
        return this._widthMultiplier;
    }

    public set widthMultiplier(value: number) {
        this._widthMultiplier = Math.max(0, value);
        this._needsUpdate = true;
    }

    // === Properties — colour ===

    /**
     * The line's colour at its start.
     */
    @SerializedField({ type: FieldType.Color })
    public get startColor(): Color {
        return this._startColor.clone();
    }

    public set startColor(value: Color) {
        this._startColor = value.clone();
        this._needsUpdate = true;
    }

    /**
     * The line's colour at its end.
     */
    @SerializedField({ type: FieldType.Color })
    public get endColor(): Color {
        return this._endColor.clone();
    }

    public set endColor(value: Color) {
        this._endColor = value.clone();
        this._needsUpdate = true;
    }

    // === Properties — settings ===

    /**
     * Whether the points are in world space.
     * `true` — the points are world-space positions.
     * `false` — the points are relative to the Transform.
     */
    @SerializedField()
    public get useWorldSpace(): boolean {
        return this._useWorldSpace;
    }

    public set useWorldSpace(value: boolean) {
        this._useWorldSpace = value;
        this._needsUpdate = true;
    }

    /**
     * Whether to join the last point back to the first.
     */
    @SerializedField()
    public get loop(): boolean {
        return this._loop;
    }

    public set loop(value: boolean) {
        this._loop = value;
        this._needsUpdate = true;
    }

    /**
     * How a line orients itself.
     */
    @SerializedField({ type: FieldType.Enum })
    public get alignment(): LineAlignment {
        return this._alignment;
    }

    public set alignment(value: LineAlignment) {
        this._alignment = value;
        this._needsUpdate = true;
    }

    /**
     * How a texture is mapped along the line.
     */
    @SerializedField({ type: FieldType.Enum })
    public get textureMode(): LineTextureMode {
        return this._textureMode;
    }

    public set textureMode(value: LineTextureMode) {
        this._textureMode = value;
        this._needsUpdate = true;
    }

    /**
     * Vertices used to round each corner.
     */
    @SerializedField()
    public get numCornerVertices(): number {
        return this._numCornerVertices;
    }

    public set numCornerVertices(value: number) {
        this._numCornerVertices = Math.max(0, Math.floor(value));
        this._needsUpdate = true;
    }

    /**
     * Vertices used to cap each end.
     */
    @SerializedField()
    public get numCapVertices(): number {
        return this._numCapVertices;
    }

    public set numCapVertices(value: number) {
        this._numCapVertices = Math.max(0, Math.floor(value));
        this._needsUpdate = true;
    }

    // === Methods — positions ===

    /**
     * Reads one point.
     * @param index — which point.
     * @returns the point's position.
     */
    public getPosition(index: number): Vector3 {
        if (index < 0 || index >= this._positions.length) {
            console.warn(`[LineRenderer] Index ${index} out of range [0, ${this._positions.length})`);
            return Vector3.zero.clone();
        }
        return this._positions[index].clone();
    }

    /**
     * Writes one point.
     * @param index — which point.
     * @param position — the new position.
     */
    public setPosition(index: number, position: Vector3): void {
        if (index < 0 || index >= this._positions.length) {
            console.warn(`[LineRenderer] Index ${index} out of range [0, ${this._positions.length})`);
            return;
        }
        this._positions[index] = position.clone();
        this._needsUpdate = true;
        
        // Rebuild straight away.
        this.updateLine();
    }

    /**
     * Every point of the line, in order.
     *
     * @remarks
     * The property form of {@link getPositions} / {@link setPositions}, and what
     * serialization reads — a method pair cannot be a serialized field. Both
     * sides copy, so the returned array can be modified freely without the line
     * changing behind the caller's back.
     */
    @SerializedField({ type: FieldType.Array, elementType: FieldType.Vector3 })
    public get positions(): Vector3[] {
        return this.getPositions();
    }

    public set positions(value: Vector3[]) {
        this.setPositions(value);
    }

    /**
     * Reads every point.
     * @returns the positions, in order.
     */
    public getPositions(): Vector3[] {
        return this._positions.map(p => p.clone());
    }

    /**
     * Replaces every point.
     * @param positions — the new positions, in order.
     */
    public setPositions(positions: Vector3[]): void {
        this._positions = positions.map(p => p.clone());
        this._needsUpdate = true;
        
        // Rebuild straight away.
        this.updateLine();
    }

    // === Methods — gradient and curve ===

    /**
     * Sets the colour gradient.
     * @param keys — colour keys, each with a position.
     */
    public setColorGradient(keys: GradientColorKey[]): void {
        this._colorGradient = keys.map(k => ({
            color: k.color.clone(),
            time: Math.max(0, Math.min(1, k.time))
        }));
        // Keys must be in order along the line.
        this._colorGradient.sort((a, b) => a.time - b.time);
        this._needsUpdate = true;
    }

    /**
     * Sets the width curve.
     * @param keys — width keys, each with a position.
     */
    public setWidthCurve(keys: CurveKey[]): void {
        this._widthCurve = keys.map(k => ({
            value: k.value,
            time: Math.max(0, Math.min(1, k.time))
        }));
        // Keys must be in order along the line.
        this._widthCurve.sort((a, b) => a.time - b.time);
        this._needsUpdate = true;
    }

    // === Methods — shorthand ===

    /**
     * Sets the line to a single segment.
     * @param start — the first point.
     * @param end — the second point.
     */
    public setLine(start: Vector3, end: Vector3): void {
        this._positions = [start.clone(), end.clone()];
        this._needsUpdate = true;
    }

    /**
     * Removes every point.
     */
    public clear(): void {
        this._positions = [];
        this._needsUpdate = true;
    }

    // === Internals ===

    /**
     * Rebuilds the backing Three.js geometry.
     */
    private updateLine(): void {
        if (!this._threeLine) {
            return;
        }
        
        if (this._positions.length < 2) {
            this._threeLine.visible = false;
            return;
        }

        this._threeLine.visible = this.enabled;

        // Build the vertex array.
        const vertices: number[] = [];

        for (let i = 0; i < this._positions.length; i++) {
            const pos = this._positions[i];
            vertices.push(pos.x, pos.y, pos.z);
        }
        
        // A closed line repeats its first point at the end.
        if (this._loop && this._positions.length > 0) {
            const firstPos = this._positions[0];
            vertices.push(firstPos.x, firstPos.y, firstPos.z);
        }

        // Hand the vertices to the geometry.
        const geometry = this._threeLine.geometry as THREE.BufferGeometry;
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeBoundingSphere();

        // Apply the material colour.
        const material = this._threeLine.material as THREE.LineBasicMaterial;
        material.color.setRGB(this._startColor.r, this._startColor.g, this._startColor.b);
        material.needsUpdate = true;

        this._needsUpdate = false;
    }

    /**
     * The colour at position `t` along the line, 0–1.
     * @internal Reserved for gradient support.
     */
    // @ts-ignore — unused until gradients are wired up.
    private getColorAtT(t: number): Color {
        // Prefer the gradient when one is set.
        if (this._colorGradient.length >= 2) {
            return this.sampleGradient(t);
        }
        
        // Otherwise blend from startColor to endColor.
        return this._startColor.clone().lerp(this._endColor, t);
    }

    /**
     * Samples the gradient.
     */
    private sampleGradient(t: number): Color {
        const keys = this._colorGradient;
        
        if (keys.length === 0) return Color.white.clone();
        if (keys.length === 1) return keys[0].color.clone();
        if (t <= keys[0].time) return keys[0].color.clone();
        if (t >= keys[keys.length - 1].time) return keys[keys.length - 1].color.clone();

        // Find the two keys `t` falls between.
        for (let i = 0; i < keys.length - 1; i++) {
            if (t >= keys[i].time && t <= keys[i + 1].time) {
                const localT = (t - keys[i].time) / (keys[i + 1].time - keys[i].time);
                return keys[i].color.clone().lerp(keys[i + 1].color, localT);
            }
        }

        return Color.white.clone();
    }

    /**
     * Per-frame update, when the line is dirty.
     */
    public _systemLateUpdate(): void {
        if (this._needsUpdate) {
            this.updateLine();
        }
    }

    // === Renderer's abstract members ===

  /*  protected override updateMaterial(): void {
        if (!this._threeLine) return;
        
       // const mat = this._materialInstance || this._sharedMaterial;
        
        if (mat) {
            // A line draws with a LineBasicMaterial.
            // TODO: convert the engine Material into a LineBasicMaterial —
            // colour, texture and blending are dropped until that exists.
        }
    }*/

   /* protected override updateMaterials(): void {
        this.updateMaterial();
    }*/
}
