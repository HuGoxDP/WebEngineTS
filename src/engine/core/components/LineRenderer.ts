import * as THREE from "three";
import { Renderer } from "../rendering/Renderer.ts";
import { Color } from "../math/Color";
import { Vector3 } from "../math/Vector3";
import { Camera } from "./Camera";
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
/** Scratch for the view point, so building a ribbon allocates nothing. */
const _eye = { x: 0, y: 0, z: 0 };
/** The same camera in world space, kept so a built ribbon can record what it faced. */
const _eyeWorld = { x: 0, y: 0, z: 0 };
/** Scratch for pulling a world-space line's points into the ribbon's own space. */
const _worldToLocal = new THREE.Matrix4();
const _point = new THREE.Vector3();

/**
 * The camera's position expressed in `go`'s local space, which is the space the
 * ribbon's vertices live in. Also leaves the world-space position in
 * {@link _eyeWorld}, which is what the facing cache compares against.
 *
 * Falls back to a point far along +Z when there is no camera — headless tests
 * build lines with no scene, and a ribbon still has to have a facing.
 */
function _viewPointFor(go: GameObject): { x: number; y: number; z: number } {
    const cam = Camera.main;
    if (cam === null) {
        _eye.x = 0; _eye.y = 0; _eye.z = -1e4;
        _eyeWorld.x = 0; _eyeWorld.y = 0; _eyeWorld.z = -1e4;
        return _eye;
    }

    const world = cam.transform.position;
    _eyeWorld.x = world.x; _eyeWorld.y = world.y; _eyeWorld.z = world.z;
    const local = go.transform.inverseTransformPoint(world);
    _eye.x = local.x; _eye.y = local.y; _eye.z = local.z;
    return _eye;
}

@Serializable({ typeName: "LineRenderer", category: "Rendering" })
export class LineRenderer extends Renderer {
    /**
     * @internal Not for use outside the engine.
     * The backing Three.js line.
     */
    private _threeLine: THREE.Mesh | null = null;

    /**
     * The vertex-coloured material this line builds for itself, used whenever no
     * engine {@link Material} has been assigned. Owned here, so it is the only
     * one this component disposes.
     */
    private _ownMaterial: THREE.MeshBasicMaterial | null = null;
    
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

    /**
     * The camera position and world matrix the current ribbon was built against.
     * `NaN` until the first build, so the first check always rebuilds.
     */
    private readonly _facedCamera = new Float64Array([NaN, NaN, NaN]);
    private readonly _facedMatrix = new Float64Array(16).fill(NaN);

    /** The points the ribbon is built from, closed and converted; see `_buildPath`. */
    private readonly _pathBuffer: { x: number; y: number; z: number }[] = [];

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "LineRenderer";
    }

    // === Lifecycle ===

    // ==================== PER-FRAME DRIVER ====================

    /** @internal Every enabled line, so the loop can flush dirty ones. */
    private static _activeInstances: Set<LineRenderer> = new Set();

    /**
     * @internal
     * Rebuilds every line whose state changed this frame. Called once per frame
     * from `Application._loop`, the same registry pattern as `LODGroup`.
     *
     * Without this nothing consumed `_needsUpdate`. `GameObject._systemLateUpdate`
     * only visits `ScriptableBehaviour`s, and a LineRenderer is a `Renderer`, so
     * its own `_systemLateUpdate` was never called: geometry happened to work
     * because `setPosition` rebuilds directly, while colour, width and every
     * other setter marked the line dirty and were then silently dropped.
     */
    public static _updateAll(): void {
        if (LineRenderer._activeInstances.size === 0) return;

        // The camera's world position once for the whole set, rather than once per
        // line: every line needs it to decide whether its ribbon still faces the
        // right way, and reading it allocates.
        const cam = Camera.main;
        const camPos = cam !== null ? cam.transform.position : null;
        const cx = camPos !== null ? camPos.x : 0;
        const cy = camPos !== null ? camPos.y : 0;
        const cz = camPos !== null ? camPos.z : -1e4;

        for (const line of LineRenderer._activeInstances) {
            if (!line.isActiveAndEnabled) continue;
            line._checkFacing(cx, cy, cz);
            line._systemLateUpdate();
        }
    }

    /**
     * Marks the ribbon dirty once the camera has moved relative to this line.
     *
     * Width is geometry here, not a shader constant, so a ribbon is built facing
     * one viewpoint. Nothing used to invalidate that: a line under a rotating
     * parent, or any line at all once the camera orbited, kept its original
     * facing until some other change happened to mark it dirty, turned edge-on and
     * rendered as a hairline. Crystals showed it plainly — of twelve unit-cell
     * edges only three or four stayed solid, and which ones changed as the lattice
     * turned.
     *
     * Compares the camera's world position and this line's world matrix instead of
     * recomputing the local eye, because both are available without allocating.
     * The matrix is brought current first rather than trusted: outside a render it
     * is only refreshed lazily, and a line whose own transform turned would
     * otherwise keep comparing equal to itself and never re-face.
     */
    private _checkFacing(cx: number, cy: number, cz: number): void {
        if (this._needsUpdate || this._positions.length < 2) return;

        this.transform._ensureWorldMatrix();
        const e = this.transform._internalObject3D.matrixWorld.elements;
        if (this._facedCamera[0] === cx && this._facedCamera[1] === cy && this._facedCamera[2] === cz) {
            let same = true;
            for (let i = 0; i < 16; i++) {
                if (this._facedMatrix[i] !== e[i]) { same = false; break; }
            }
            if (same) return;
        }

        this._needsUpdate = true;
    }

    protected override onAwake(): void {
        // Build the backing Three.js line.
        const geometry = new THREE.BufferGeometry();
        
        // A ribbon of triangles rather than THREE.Line: WebGL ignores
        // `linewidth` on LineBasicMaterial, so a real width has to be geometry.
        // Vertex colours carry the start→end gradient, and the material is unlit
        // so a line reads as its own colour rather than as a lit surface.
        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            transparent: true,
        });

        this._ownMaterial = material;
        this._threeLine = new THREE.Mesh(geometry, material);

        // Register through the base class rather than adding to the Transform
        // directly: that is what gives a line the rest of Renderer — shadow
        // settings, visibility and bounds all key off `_internalRenderObject`,
        // and it stayed null while this attached itself.
        this._setInternalRenderObject(this._threeLine);
    }

    protected override onEnable(): void {
        super.onEnable();   // base syncs visibility
        LineRenderer._activeInstances.add(this);
    }

    protected override onDisable(): void {
        super.onDisable();
        LineRenderer._activeInstances.delete(this);
    }

    protected override onDestroy(): void {
        LineRenderer._activeInstances.delete(this);

        // Only what this class owns: the geometry and the fallback material it
        // built. Detaching from the Transform is the base class's job.
        if (this._threeLine) {
            this._threeLine.geometry?.dispose();
            if (this._ownMaterial !== null) {
                this._ownMaterial.dispose();
                this._ownMaterial = null;
            }
        }

        this._threeLine = null;
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
     * `true` — the points are world-space positions, and the line stays where they
     * put it however its Transform moves. This is the default, as in Unity.
     * `false` — the points are relative to the Transform and move with it.
     *
     * @remarks
     * World-space points are in **engine** world space, the space `position` and
     * `Physics.raycast` speak, not the mirrored space of the Three.js object
     * underneath.
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
     * Fills {@link _pathBuffer} with the points the ribbon is built from, closed
     * when {@link loop} is set and brought into the ribbon's own space when
     * {@link useWorldSpace} is set. Returns how many points it wrote.
     *
     * @remarks
     * `useWorldSpace` was stored and never read: every line was drawn as though
     * its points were local, so the property's own default — `true`, Unity's —
     * described the opposite of what happened. A world-space line is now pulled
     * through the inverse of its object's world matrix, which is what makes it sit
     * still while its transform moves. `_checkFacing` already marks the line dirty
     * when that matrix changes, so the conversion is redone when it must be.
     *
     * Writes into a reused buffer. The ribbon rebuilds whenever the view turns, so
     * a fresh array per rebuild would be an allocation per line per frame.
     */
    private _buildPath(): number {
        const source = this._positions;
        const count = source.length + (this._loop ? 1 : 0);
        while (this._pathBuffer.length < count) this._pathBuffer.push({ x: 0, y: 0, z: 0 });

        if (this._useWorldSpace) this.transform._engineWorldMatrix(_worldToLocal).invert();

        for (let i = 0; i < count; i++) {
            const p = source[i % source.length];
            const out = this._pathBuffer[i];
            if (this._useWorldSpace) {
                _point.set(p.x, p.y, p.z).applyMatrix4(_worldToLocal);
                out.x = _point.x; out.y = _point.y; out.z = _point.z;
            } else {
                out.x = p.x; out.y = p.y; out.z = p.z;
            }
        }
        return count;
    }

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

        const count = this._buildPath();
        const path = this._pathBuffer;

        // Width is geometry here, so the ribbon has to face somewhere. Facing the
        // camera is Unity's default (`alignment = View`) and the only choice that
        // keeps a line visible from every angle; the fallback matters when there
        // is no camera yet, as in a test.
        const eye = _viewPointFor(this.gameObject);
        const geometry = this._threeLine.geometry as THREE.BufferGeometry;

        // Buffers are reused while the point count holds. The ribbon now rebuilds
        // whenever the view turns, so allocating three arrays per rebuild would be
        // three allocations per line per frame for a scene that simply orbits.
        let position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
        if (position === undefined || position.array.length !== count * 6) {
            position = new THREE.BufferAttribute(new Float32Array(count * 6), 3);
            geometry.setAttribute("position", position);
            geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 6), 3));
            geometry.setIndex(new THREE.BufferAttribute(new Uint32Array((count - 1) * 6), 1));
        }
        const color = geometry.getAttribute("color") as THREE.BufferAttribute;
        const index = geometry.getIndex() as THREE.BufferAttribute;

        const vertices = position.array as Float32Array;
        const colors = color.array as Float32Array;
        const indices = index.array as Uint32Array;

        for (let i = 0; i < count; i++) {
            const p = path[i];
            const t = count > 1 ? i / (count - 1) : 0;

            // Segment direction: forward difference, backward at the last point.
            const next = path[Math.min(i + 1, count - 1)];
            const prev = path[Math.max(i - 1, 0)];
            let dx = next.x - prev.x, dy = next.y - prev.y, dz = next.z - prev.z;
            let len = Math.hypot(dx, dy, dz);
            if (len < 1e-8) { dx = 1; dy = 0; dz = 0; len = 1; }
            dx /= len; dy /= len; dz /= len;

            // Toward the viewer, then side = dir × view, giving a ribbon that
            // turns its face to the camera.
            let vx = eye.x - p.x, vy = eye.y - p.y, vz = eye.z - p.z;
            let sx = dy * vz - dz * vy;
            let sy = dz * vx - dx * vz;
            let sz = dx * vy - dy * vx;
            let slen = Math.hypot(sx, sy, sz);
            if (slen < 1e-8) {
                // Looking straight down the line: any perpendicular will do.
                sx = -dy; sy = dx; sz = 0;
                slen = Math.hypot(sx, sy, sz) || 1;
            }
            sx /= slen; sy /= slen; sz /= slen;

            const half = (this._startWidth + (this._endWidth - this._startWidth) * t) * 0.5;
            const o = i * 6;
            vertices[o]     = p.x + sx * half;
            vertices[o + 1] = p.y + sy * half;
            vertices[o + 2] = p.z + sz * half;
            vertices[o + 3] = p.x - sx * half;
            vertices[o + 4] = p.y - sy * half;
            vertices[o + 5] = p.z - sz * half;

            const c = this.getColorAtT(t);
            colors[o]     = c.r; colors[o + 1] = c.g; colors[o + 2] = c.b;
            colors[o + 3] = c.r; colors[o + 4] = c.g; colors[o + 5] = c.b;

            if (i < count - 1) {
                const a = i * 2;
                const k = i * 6;
                indices[k] = a; indices[k + 1] = a + 1; indices[k + 2] = a + 2;
                indices[k + 3] = a + 1; indices[k + 4] = a + 3; indices[k + 5] = a + 2;
            }
        }

        position.needsUpdate = true;
        color.needsUpdate = true;
        index.needsUpdate = true;
        geometry.computeBoundingSphere();

        const material = this._threeLine.material as THREE.MeshBasicMaterial;
        material.opacity = this._startColor.a;
        material.needsUpdate = true;

        // What this ribbon now faces, so _checkFacing can tell when it stops.
        this._facedCamera[0] = _eyeWorld.x;
        this._facedCamera[1] = _eyeWorld.y;
        this._facedCamera[2] = _eyeWorld.z;
        const e = this.transform._internalObject3D.matrixWorld.elements;
        for (let i = 0; i < 16; i++) this._facedMatrix[i] = e[i];

        this._needsUpdate = false;
    }

    /**
     * The colour at position `t` along the line, 0–1. Written into the ribbon's
     * vertex colours, so start/end colours and gradients all render.
     */
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

    /**
     * Uses the assigned engine {@link Material} when there is one, and this
     * line's own vertex-coloured material otherwise.
     *
     * @remarks
     * Previously commented out, so `sharedMaterial` never reached a line and
     * colour could only come from {@link startColor}. A line is a ribbon of
     * triangles, so an ordinary material works on it unchanged; the only thing
     * worth saying is that a material without `vertexColors` ignores the
     * start/end gradient, which is the assignment's own choice.
     */
    protected override _syncMaterialToThree(): void {
        if (!this._threeLine) return;

        const assigned = this._getActiveMaterial();
        this._threeLine.material = assigned !== null
            ? assigned._internalThreeMaterial
            : this._ownMaterial!;
    }
}
