import { EngineObject } from "../EngineObject";
import { Vector3 } from "../math/Vector3";
import { Vector2 } from "../math/Vector2";
import { Vector4 } from "../math/Vector4";
import { Color } from "../math/Color";
import { Bounds } from "../math/Bounds";
import { Matrix4x4 } from "../math/Matrix4x4";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * One entry for {@link Mesh.combine}: a source mesh and the transform that
 * places it into the combined mesh's local space.
 */
export interface MeshCombineInstance {
    /** The mesh to bake into the combined result. */
    mesh: Mesh;
    /** Local-to-combined transform. Defaults to identity if omitted. */
    matrix?: Matrix4x4;
}

/**
 * Mesh.ts
 * Stores and manages a 3D mesh's geometry.
 *
 * A mesh holds:
 * - vertices — point positions in 3D,
 * - normals — surface directions, used for lighting,
 * - tangents — for normal mapping,
 * - UV coordinates (uv, uv2, uv3, uv4) — for texturing,
 * - vertex colours,
 * - triangle indices,
 * - a bounding box.
 *
 * Equivalent to Unity's `Mesh`.
 */

/**
 * Mesh topology — how the indices are to be read.
 */
export enum MeshTopology {
    /** Triangles — every 3 indices form one. */
    Triangles = 0,
    /** Quads — every 4 indices form one. */
    Quads = 1,
    /** Lines — every 2 indices form one. */
    Lines = 2,
    /** A connected run of lines through the vertices. */
    LineStrip = 3,
    /** Points — one per index. */
    Points = 4
}

/**
 * Mesh index format.
 */
export enum IndexFormat {
    /** 16-bit indices — up to 65,536 vertices. */
    UInt16 = 0,
    /** 32-bit indices — up to 4,294,967,296 vertices. */
    UInt32 = 1
}

/**
 * A submesh — the part of a mesh drawn with one material.
 */
export class SubMesh {
    /** Where this submesh starts in the triangle array. */
    public indexStart: number = 0;
    /** How many indices it spans. */
    public indexCount: number = 0;
    /** This submesh's topology. */
    public topology: MeshTopology = MeshTopology.Triangles;

    constructor(indexStart: number = 0, indexCount: number = 0, topology: MeshTopology = MeshTopology.Triangles) {
        this.indexStart = indexStart;
        this.indexCount = indexCount;
        this.topology = topology;
    }
}

/**
 * A mesh: the geometry of a 3D model.
 */
/** The recipe behind a mesh built by one of {@link Mesh}'s `create*` factories. */
export interface MeshPrimitive {
    /** Which factory made it. */
    kind: "Cube" | "Sphere" | "Plane" | "Cylinder" | "Capsule" | "Quad";
    /** The arguments it was called with, in order. */
    args: readonly number[];
}

export class Mesh extends EngineObject {
    // ==================== VERTEX DATA ====================

    /** Vertex positions. */
    /**
     * How this mesh was built, when it came from one of the `create*` factories.
     *
     * @remarks
     * Lets a primitive round-trip as the recipe that made it rather than as raw
     * vertex data — see {@link primitive}. Null for a mesh loaded from a file,
     * combined, or built by hand.
     */
    private _primitive: MeshPrimitive | null = null;

    /**
     * How this mesh was built, or null if it was not built by a factory.
     *
     * @remarks
     * A primitive can be stored as its recipe — six numbers instead of a vertex
     * buffer — which is what lets a scene reference one without embedding
     * geometry. {@link Mesh.fromPrimitive} rebuilds it.
     */
    public get primitive(): MeshPrimitive | null {
        return this._primitive === null
            ? null
            : { kind: this._primitive.kind, args: [...this._primitive.args] };
    }

    private _vertices: Vector3[] = [];
    /** Normals — one per vertex. */
    private _normals: Vector3[] = [];
    /** Tangents for normal mapping: xyz is the direction, w the handedness. */
    private _tangents: Vector4[] = [];
    /** Primary UVs, for the main texture. */
    private _uv: Vector2[] = [];
    /** Secondary UVs, usually a lightmap. */
    private _uv2: Vector2[] = [];
    /** Third UV set. */
    private _uv3: Vector2[] = [];
    /** Fourth UV set. */
    private _uv4: Vector2[] = [];
    /** Vertex colours. */
    private _colors: Color[] = [];

    // ==================== INDICES ====================

    /** Triangle indices — every 3 form one triangle. */
    private _triangles: number[] = [];
    /** Index format. */
    private _indexFormat: IndexFormat = IndexFormat.UInt16;

    // ==================== BOUNDS ====================

    /** The mesh's bounding box. */
    private _bounds: Bounds = new Bounds();

    // ==================== SUBMESHES ====================

    /** Submeshes, one per material. */
    private _subMeshes: SubMesh[] = [];

    // ==================== INTERNAL ====================

    /**
     * The backing Three.js geometry.
     * Engine-internal; not for use from scenario code.
     * Synchronised on access.
     */
    public get _internalGeometry(): THREE.BufferGeometry {
        // Sync on access, so a reader never sees stale geometry.
        if (this._needsUpdate) {
            this._syncToThree();
        }
        return this._threeGeometry;
    }

    /**
     * @internal
     * Estimates the GPU (VRAM) memory this mesh's vertex and index buffers
     * occupy, in bytes. Computed from the engine-side attribute arrays (float32
     * vertex data, 16- or 32-bit indices), matching what is uploaded to the GPU.
     * Used by the diagnostics subsystem; does not trigger a geometry sync.
     *
     * **NEVER use in user-facing code.**
     */
    public _estimateVramBytes(): number {
        const vertexCount = this._vertices.length;
        if (vertexCount === 0) return 0;

        let bytes = 0;
        bytes += this._vertices.length * 3 * 4;
        bytes += this._normals.length * 3 * 4;
        bytes += this._tangents.length * 4 * 4;
        bytes += this._uv.length * 2 * 4;
        bytes += this._uv2.length * 2 * 4;
        bytes += this._colors.length * 4 * 4;
        // Index buffer: Three.js uses Uint16 when it fits, otherwise Uint32.
        bytes += this._triangles.length * (vertexCount < 65536 ? 2 : 4);
        return bytes;
    }

    /** The backing THREE.BufferGeometry. */
    private _threeGeometry!: THREE.BufferGeometry;

    /** Set when the geometry needs rebuilding. */
    private _needsUpdate: boolean = false;

    constructor(name: string = "Mesh") {
        super(name);
        this._threeGeometry = new THREE.BufferGeometry();
    }

    // ==================== PROPERTIES ====================

    /** The vertex positions. */
    get vertices(): Vector3[] {
        return this._vertices;
    }

    /** Replaces the vertex positions. */
    set vertices(value: Vector3[]) {
        this._vertices = value;
        this._needsUpdate = true;
    }

    /** The normals. */
    get normals(): Vector3[] {
        return this._normals;
    }

    /** Replaces the normals. */
    set normals(value: Vector3[]) {
        this._normals = value;
        this._needsUpdate = true;
    }

    /** The tangents. */
    get tangents(): Vector4[] {
        return this._tangents;
    }

    /** Replaces the tangents. */
    set tangents(value: Vector4[]) {
        this._tangents = value;
        this._needsUpdate = true;
    }

    /** The primary UVs. */
    get uv(): Vector2[] {
        return this._uv;
    }

    /** Replaces the primary UVs. */
    set uv(value: Vector2[]) {
        this._uv = value;
        this._needsUpdate = true;
    }

    /** The second UV set. */
    get uv2(): Vector2[] {
        return this._uv2;
    }

    /** Replaces the second UV set. */
    set uv2(value: Vector2[]) {
        this._uv2 = value;
        this._needsUpdate = true;
    }

    /** The third UV set. */
    get uv3(): Vector2[] {
        return this._uv3;
    }

    /** Replaces the third UV set. */
    set uv3(value: Vector2[]) {
        this._uv3 = value;
        this._needsUpdate = true;
    }

    /** The fourth UV set. */
    get uv4(): Vector2[] {
        return this._uv4;
    }

    /** Replaces the fourth UV set. */
    set uv4(value: Vector2[]) {
        this._uv4 = value;
        this._needsUpdate = true;
    }

    /** The vertex colours. */
    get colors(): Color[] {
        return this._colors;
    }

    /** Replaces the vertex colours. */
    set colors(value: Color[]) {
        this._colors = value;
        this._needsUpdate = true;
    }

    /** The triangle indices. */
    get triangles(): number[] {
        return this._triangles;
    }

    /** Replaces the triangle indices. */
    set triangles(value: number[]) {
        this._triangles = value;
        this._needsUpdate = true;
    }

    /** The bounding box. */
    get bounds(): Bounds {
        return this._bounds;
    }

    /** Replaces the bounding box. */
    set bounds(value: Bounds) {
        this._bounds = value;
    }

    /** How many vertices the mesh has. */
    get vertexCount(): number {
        return this._vertices.length;
    }

    /** How many triangles the mesh has. */
    get triangleCount(): number {
        return Math.floor(this._triangles.length / 3);
    }

    /** The index format. */
    get indexFormat(): IndexFormat {
        return this._indexFormat;
    }

    set indexFormat(value: IndexFormat) {
        this._indexFormat = value;
        this._needsUpdate = true;
    }

    /** How many submeshes the mesh has. */
    get subMeshCount(): number {
        return this._subMeshes.length;
    }

    set subMeshCount(value: number) {
        // Resize the submesh array.
        if (value > this._subMeshes.length) {
            // Grow.
            while (this._subMeshes.length < value) {
                this._subMeshes.push(new SubMesh());
            }
        } else if (value < this._subMeshes.length) {
            // Shrink.
            this._subMeshes.length = value;
        }
    }

    // ==================== SUBMESH METHODS ====================

    /**
     * Reads one submesh.
     * @param index — which submesh.
     * @returns the submesh, or `undefined` if there is none.
     */
    public getSubMesh(index: number): SubMesh | undefined {
        if (index < 0 || index >= this._subMeshes.length) {
            console.warn(`[Mesh] SubMesh index ${index} out of range [0, ${this._subMeshes.length})`);
            return undefined;
        }
        return this._subMeshes[index];
    }

    /**
     * Writes one submesh.
     * @param index — which submesh.
     * @param submesh — the replacement.
     */
    public setSubMesh(index: number, submesh: SubMesh): void {
        if (index < 0) {
            console.warn(`[Mesh] SubMesh index ${index} cannot be negative`);
            return;
        }

        // Grow the array if the index is past the end.
        while (this._subMeshes.length <= index) {
            this._subMeshes.push(new SubMesh());
        }

        this._subMeshes[index] = submesh;
        this._needsUpdate = true;
    }

    // ==================== COMPUTED DATA ====================

    /**
     * Recomputes the normals from the geometry.
     */
    public recalculateNormals(): void {
        if (this._vertices.length === 0 || this._triangles.length === 0) {
            console.warn("[Mesh] Cannot recalculate normals: no vertices or triangles");
            return;
        }

        // Start every normal at zero.
        this._normals = new Array(this._vertices.length);
        for (let i = 0; i < this._vertices.length; i++) {
            this._normals[i] = new Vector3(0, 0, 0);
        }

        // Accumulate each face's normal into its three vertices.
        for (let i = 0; i < this._triangles.length; i += 3) {
            const i0 = this._triangles[i];
            const i1 = this._triangles[i + 1];
            const i2 = this._triangles[i + 2];

            const v0 = this._vertices[i0];
            const v1 = this._vertices[i1];
            const v2 = this._vertices[i2];

            // The face normal, from the cross product of two edges.
            const edge1 = Vector3.subtract(v1, v0);
            const edge2 = Vector3.subtract(v2, v0);
            const normal = Vector3.cross(edge1, edge2);

            // Add it to each of the triangle's vertices.
            this._normals[i0] = Vector3.add(this._normals[i0], normal);
            this._normals[i1] = Vector3.add(this._normals[i1], normal);
            this._normals[i2] = Vector3.add(this._normals[i2], normal);
        }

        // Normalize what the accumulation produced.
        for (let i = 0; i < this._normals.length; i++) {
            this._normals[i].normalize();
        }

        this._needsUpdate = true;
    }

    /**
     * Recomputes the tangents used for normal mapping.
     * Uses Lengyel's method.
     */
    public recalculateTangents(): void {
        if (this._vertices.length === 0 || this._triangles.length === 0 || this._uv.length === 0) {
            console.warn("[Mesh] Cannot recalculate tangents: need vertices, triangles and UVs");
            return;
        }

        if (this._normals.length !== this._vertices.length) {
            console.warn("[Mesh] Normals needed for tangent calculation. Recalculating normals first...");
            this.recalculateNormals();
        }

        // Scratch space for the accumulation.
        const tan1 = new Array(this._vertices.length);
        const tan2 = new Array(this._vertices.length);
        for (let i = 0; i < this._vertices.length; i++) {
            tan1[i] = new Vector3(0, 0, 0);
            tan2[i] = new Vector3(0, 0, 0);
        }

        // Accumulate per-triangle tangents and bitangents.
        for (let i = 0; i < this._triangles.length; i += 3) {
            const i1 = this._triangles[i];
            const i2 = this._triangles[i + 1];
            const i3 = this._triangles[i + 2];

            const v1 = this._vertices[i1];
            const v2 = this._vertices[i2];
            const v3 = this._vertices[i3];

            const w1 = this._uv[i1];
            const w2 = this._uv[i2];
            const w3 = this._uv[i3];

            const x1 = v2.x - v1.x;
            const x2 = v3.x - v1.x;
            const y1 = v2.y - v1.y;
            const y2 = v3.y - v1.y;
            const z1 = v2.z - v1.z;
            const z2 = v3.z - v1.z;

            const s1 = w2.x - w1.x;
            const s2 = w3.x - w1.x;
            const t1 = w2.y - w1.y;
            const t2 = w3.y - w1.y;

            const r = 1.0 / (s1 * t2 - s2 * t1);
            const sdir = new Vector3(
                (t2 * x1 - t1 * x2) * r,
                (t2 * y1 - t1 * y2) * r,
                (t2 * z1 - t1 * z2) * r
            );
            const tdir = new Vector3(
                (s1 * x2 - s2 * x1) * r,
                (s1 * y2 - s2 * y1) * r,
                (s1 * z2 - s2 * z1) * r
            );

            tan1[i1] = Vector3.add(tan1[i1], sdir);
            tan1[i2] = Vector3.add(tan1[i2], sdir);
            tan1[i3] = Vector3.add(tan1[i3], sdir);

            tan2[i1] = Vector3.add(tan2[i1], tdir);
            tan2[i2] = Vector3.add(tan2[i2], tdir);
            tan2[i3] = Vector3.add(tan2[i3], tdir);
        }

        // Orthogonalize, then work out the handedness.
        this._tangents = new Array(this._vertices.length);
        for (let i = 0; i < this._vertices.length; i++) {
            const n = this._normals[i];
            const t = tan1[i];

            // Gram-Schmidt.
            const tangent = Vector3.subtract(t, Vector3.scale(n, Vector3.dot(n, t)));
            tangent.normalize();

            // Handedness goes in the w component.
            const cross = Vector3.cross(n, t);
            const w = (Vector3.dot(cross, tan2[i]) < 0.0) ? -1.0 : 1.0;

            this._tangents[i] = new Vector4(tangent.x, tangent.y, tangent.z, w);
        }

        this._needsUpdate = true;
    }

    /**
     * Recomputes the bounding box from the vertices.
     */
    public recalculateBounds(): void {
        if (this._vertices.length === 0) {
            this._bounds = new Bounds(new Vector3(0, 0, 0), new Vector3(0, 0, 0));
            return;
        }

        // Find the extremes.
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (const vertex of this._vertices) {
            if (vertex.x < minX) minX = vertex.x;
            if (vertex.y < minY) minY = vertex.y;
            if (vertex.z < minZ) minZ = vertex.z;
            if (vertex.x > maxX) maxX = vertex.x;
            if (vertex.y > maxY) maxY = vertex.y;
            if (vertex.z > maxZ) maxZ = vertex.z;
        }

        const min = new Vector3(minX, minY, minZ);
        const max = new Vector3(maxX, maxY, maxZ);

        this._bounds.setMinMax(min, max);
    }

    // ==================== CLEAR ====================

    /**
     * Clears every piece of mesh data.
     */
    public clear(): void {
        this._vertices = [];
        this._normals = [];
        this._tangents = [];
        this._uv = [];
        this._uv2 = [];
        this._uv3 = [];
        this._uv4 = [];
        this._colors = [];
        this._triangles = [];
        this._subMeshes = [];
        this._bounds = new Bounds();
        this._needsUpdate = true;
    }

    // ==================== INTERNAL SYNC ====================

    /**
     * Pushes this mesh's data into the backing Three.js geometry.
     * Called automatically before rendering.
     */
    public _syncToThree(): void {
        if (!this._needsUpdate) return;

        // Drop the previous geometry.
        this._threeGeometry.dispose();
        this._threeGeometry = new THREE.BufferGeometry();

        // Positions.
        if (this._vertices.length > 0) {
            const positions = new Float32Array(this._vertices.length * 3);
            for (let i = 0; i < this._vertices.length; i++) {
                positions[i * 3 + 0] = this._vertices[i].x;
                positions[i * 3 + 1] = this._vertices[i].y;
                positions[i * 3 + 2] = this._vertices[i].z;
            }
            this._threeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        }

        // Normals.
        if (this._normals.length > 0) {
            const normals = new Float32Array(this._normals.length * 3);
            for (let i = 0; i < this._normals.length; i++) {
                normals[i * 3 + 0] = this._normals[i].x;
                normals[i * 3 + 1] = this._normals[i].y;
                normals[i * 3 + 2] = this._normals[i].z;
            }
            this._threeGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        }

        // Tangents.
        if (this._tangents.length > 0) {
            const tangents = new Float32Array(this._tangents.length * 4);
            for (let i = 0; i < this._tangents.length; i++) {
                tangents[i * 4 + 0] = this._tangents[i].x;
                tangents[i * 4 + 1] = this._tangents[i].y;
                tangents[i * 4 + 2] = this._tangents[i].z;
                tangents[i * 4 + 3] = this._tangents[i].w;
            }
            this._threeGeometry.setAttribute('tangent', new THREE.BufferAttribute(tangents, 4));
        }

        // UV
        if (this._uv.length > 0) {
            const uvs = new Float32Array(this._uv.length * 2);
            for (let i = 0; i < this._uv.length; i++) {
                uvs[i * 2 + 0] = this._uv[i].x;
                uvs[i * 2 + 1] = this._uv[i].y;
            }
            this._threeGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        }

        // UV2 — Unity's second set, which Three.js calls `uv1`: channel 0 is
        // `uv`, channel 1 is `uv1`. Writing it as `uv2` fed channel *two*, an
        // attribute nothing sampled, so a material pointed at the second set
        // read an absent one.
        if (this._uv2.length > 0) {
            const uv2s = new Float32Array(this._uv2.length * 2);
            for (let i = 0; i < this._uv2.length; i++) {
                uv2s[i * 2 + 0] = this._uv2[i].x;
                uv2s[i * 2 + 1] = this._uv2[i].y;
            }
            this._threeGeometry.setAttribute('uv1', new THREE.BufferAttribute(uv2s, 2));
        }

        // Colours.
        if (this._colors.length > 0) {
            const colors = new Float32Array(this._colors.length * 4);
            for (let i = 0; i < this._colors.length; i++) {
                colors[i * 4 + 0] = this._colors[i].r;
                colors[i * 4 + 1] = this._colors[i].g;
                colors[i * 4 + 2] = this._colors[i].b;
                colors[i * 4 + 3] = this._colors[i].a;
            }
            this._threeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
        }

        // Indices.
        if (this._triangles.length > 0) {
            const indices = this._indexFormat === IndexFormat.UInt32
                ? new Uint32Array(this._triangles)
                : new Uint16Array(this._triangles);
            this._threeGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
        }

        // Compute bounds unless the caller set them explicitly.
        this._threeGeometry.computeBoundingBox();
        this._threeGeometry.computeBoundingSphere();

        this._needsUpdate = false;
    }

    // ==================== PRIMITIVE FACTORIES ====================

    /**
     * Creates a cube.
     * @param size — edge length.
     * @returns the cube mesh.
     */
    /**
     * Rebuilds a mesh from the recipe {@link primitive} reports.
     *
     * @param descriptor - a recipe from a previously built primitive.
     * @returns the mesh, or null if the recipe names no known factory.
     */
    public static fromPrimitive(descriptor: MeshPrimitive): Mesh | null {
        const a = descriptor.args;
        switch (descriptor.kind) {
            case "Cube":     return Mesh.createCube(a[0]);
            case "Sphere":   return Mesh.createSphere(a[0], a[1]);
            case "Plane":    return Mesh.createPlane(a[0], a[1], a[2], a[3]);
            case "Cylinder": return Mesh.createCylinder(a[0], a[1], a[2]);
            case "Capsule":  return Mesh.createCapsule(a[0], a[1], a[2]);
            case "Quad":     return Mesh.createQuad(a[0], a[1]);
            default:         return null;
        }
    }

    public static createCube(size: number = 1): Mesh {
        const mesh = new Mesh("Cube");
        const s = size / 2;

        // 24 vertices — 4 per face, so each face gets its own normals.
        mesh._vertices = [
            // Front face
            new Vector3(-s, -s, s), new Vector3(s, -s, s), new Vector3(s, s, s), new Vector3(-s, s, s),
            // Back face
            new Vector3(s, -s, -s), new Vector3(-s, -s, -s), new Vector3(-s, s, -s), new Vector3(s, s, -s),
            // Top face
            new Vector3(-s, s, s), new Vector3(s, s, s), new Vector3(s, s, -s), new Vector3(-s, s, -s),
            // Bottom face
            new Vector3(-s, -s, -s), new Vector3(s, -s, -s), new Vector3(s, -s, s), new Vector3(-s, -s, s),
            // Right face
            new Vector3(s, -s, s), new Vector3(s, -s, -s), new Vector3(s, s, -s), new Vector3(s, s, s),
            // Left face
            new Vector3(-s, -s, -s), new Vector3(-s, -s, s), new Vector3(-s, s, s), new Vector3(-s, s, -s),
        ];

        // Normals.
        mesh._normals = [
            // Front
            new Vector3(0, 0, 1), new Vector3(0, 0, 1), new Vector3(0, 0, 1), new Vector3(0, 0, 1),
            // Back
            new Vector3(0, 0, -1), new Vector3(0, 0, -1), new Vector3(0, 0, -1), new Vector3(0, 0, -1),
            // Top
            new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0),
            // Bottom
            new Vector3(0, -1, 0), new Vector3(0, -1, 0), new Vector3(0, -1, 0), new Vector3(0, -1, 0),
            // Right
            new Vector3(1, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 0, 0),
            // Left
            new Vector3(-1, 0, 0), new Vector3(-1, 0, 0), new Vector3(-1, 0, 0), new Vector3(-1, 0, 0),
        ];

        // UVs.
        mesh._uv = [];
        for (let i = 0; i < 6; i++) {
            mesh._uv.push(
                new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1)
            );
        }

        // Indices: 6 faces x 2 triangles x 3 vertices.
        mesh._triangles = [];
        for (let i = 0; i < 6; i++) {
            const offset = i * 4;
            mesh._triangles.push(
                offset + 0, offset + 1, offset + 2,
                offset + 0, offset + 2, offset + 3
            );
        }

        mesh.recalculateBounds();
        mesh._needsUpdate = true;
        mesh._primitive = { kind: "Cube", args: [size] };
        return mesh;
    }

    /**
     * Creates a sphere.
     * @param radius — the sphere's radius.
     * @param segments — subdivision count; higher is smoother.
     * @returns the sphere mesh.
     */
    public static createSphere(radius: number = 0.5, segments: number = 32): Mesh {
        const mesh = new Mesh("Sphere");

        const widthSegments = Math.max(3, Math.floor(segments));
        const heightSegments = Math.max(2, Math.floor(segments / 2));

        const vertices: Vector3[] = [];
        const normals: Vector3[] = [];
        const uvs: Vector2[] = [];
        const indices: number[] = [];

        // Vertices.
        for (let iy = 0; iy <= heightSegments; iy++) {
            const v = iy / heightSegments;
            const phi = v * Math.PI;

            for (let ix = 0; ix <= widthSegments; ix++) {
                const u = ix / widthSegments;
                const theta = u * Math.PI * 2;

                const x = -radius * Math.cos(theta) * Math.sin(phi);
                const y = radius * Math.cos(phi);
                const z = radius * Math.sin(theta) * Math.sin(phi);

                vertices.push(new Vector3(x, y, z));
                normals.push(new Vector3(x, y, z).normalized);
                uvs.push(new Vector2(u, 1 - v));
            }
        }

        // Indices.
        for (let iy = 0; iy < heightSegments; iy++) {
            for (let ix = 0; ix < widthSegments; ix++) {
                const a = iy * (widthSegments + 1) + ix;
                const b = a + widthSegments + 1;
                const c = a + 1;
                const d = b + 1;

                indices.push(a, b, c);
                indices.push(b, d, c);
            }
        }

        mesh._vertices = vertices;
        mesh._normals = normals;
        mesh._uv = uvs;
        mesh._triangles = indices;
        mesh.recalculateBounds();
        mesh._needsUpdate = true;

        mesh._primitive = { kind: "Sphere", args: [radius, segments] };
        return mesh;
    }

    /**
     * Creates a plane.
     * @param width — the plane's width.
     * @param height — the plane's height.
     * @param widthSegments — subdivisions across the width. Defaults to 1.
     * @param heightSegments — subdivisions across the height. Defaults to 1.
     * @returns the plane mesh.
     */
    public static createPlane(width: number = 1, height: number = 1, widthSegments: number = 1, heightSegments: number = 1): Mesh {
        const mesh = new Mesh("Plane");

        const widthSegs = Math.max(1, Math.floor(widthSegments));
        const heightSegs = Math.max(1, Math.floor(heightSegments));

        const halfWidth = width / 2;
        const halfHeight = height / 2;

        const gridX = widthSegs + 1;
        const gridY = heightSegs + 1;

        const segmentWidth = width / widthSegs;
        const segmentHeight = height / heightSegs;

        const vertices: Vector3[] = [];
        const normals: Vector3[] = [];
        const uvs: Vector2[] = [];
        const indices: number[] = [];

        // Vertices.
        for (let iy = 0; iy < gridY; iy++) {
            const y = iy * segmentHeight - halfHeight;
            for (let ix = 0; ix < gridX; ix++) {
                const x = ix * segmentWidth - halfWidth;

                vertices.push(new Vector3(x, y, 0));
                normals.push(new Vector3(0, 0, 1));
                uvs.push(new Vector2(ix / widthSegs, 1 - (iy / heightSegs)));
            }
        }

        // Indices.
        for (let iy = 0; iy < heightSegs; iy++) {
            for (let ix = 0; ix < widthSegs; ix++) {
                const a = ix + gridX * iy;
                const b = ix + gridX * (iy + 1);
                const c = (ix + 1) + gridX * (iy + 1);
                const d = (ix + 1) + gridX * iy;

                // Wound counter-clockwise seen from +Z, which is the normal
                // these vertices store. The opposite order back-face culled the
                // whole plane away.
                indices.push(a, d, b);
                indices.push(b, d, c);
            }
        }

        mesh._vertices = vertices;
        mesh._normals = normals;
        mesh._uv = uvs;
        mesh._triangles = indices;
        mesh.recalculateBounds();
        mesh._needsUpdate = true;

        mesh._primitive = { kind: "Plane", args: [width, height, widthSegments, heightSegments] };
        return mesh;
    }

    /**
     * Creates a cylinder.
     * @param radius — the cylinder's radius.
     * @param height — the cylinder's height.
     * @param segments — subdivision count; higher is smoother.
     * @returns the cylinder mesh.
     */
    public static createCylinder(radius: number = 0.5, height: number = 1, segments: number = 32): Mesh {
        const mesh = new Mesh("Cylinder");

        const radialSegments = Math.max(3, Math.floor(segments));
        const heightSegments = 1;
        const halfHeight = height / 2;

        const vertices: Vector3[] = [];
        const normals: Vector3[] = [];
        const uvs: Vector2[] = [];
        const indices: number[] = [];

        // The side wall.
        for (let y = 0; y <= heightSegments; y++) {
            const v = y / heightSegments;
            const posY = v * height - halfHeight;

            for (let x = 0; x <= radialSegments; x++) {
                const u = x / radialSegments;
                const theta = u * Math.PI * 2;

                const sinTheta = Math.sin(theta);
                const cosTheta = Math.cos(theta);

                const vx = radius * sinTheta;
                const vy = posY;
                const vz = radius * cosTheta;

                vertices.push(new Vector3(vx, vy, vz));
                normals.push(new Vector3(sinTheta, 0, cosTheta));
                uvs.push(new Vector2(u, 1 - v));
            }
        }

        // The side wall's indices.
        for (let y = 0; y < heightSegments; y++) {
            for (let x = 0; x < radialSegments; x++) {
                const a = y * (radialSegments + 1) + x;
                const b = a + radialSegments + 1;
                const c = a + 1;
                const d = b + 1;

                // Counter-clockwise seen from outside the wall, agreeing with
                // the outward radial normals above. Both caps were already
                // right, which is why a cylinder rendered as an open tube.
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }

        // Top cap.
        const topCenterIndex = vertices.length;
        vertices.push(new Vector3(0, halfHeight, 0));
        normals.push(new Vector3(0, 1, 0));
        uvs.push(new Vector2(0.5, 0.5));

        for (let x = 0; x <= radialSegments; x++) {
            const u = x / radialSegments;
            const theta = u * Math.PI * 2;
            const vx = radius * Math.sin(theta);
            const vz = radius * Math.cos(theta);

            vertices.push(new Vector3(vx, halfHeight, vz));
            normals.push(new Vector3(0, 1, 0));
            uvs.push(new Vector2(Math.sin(theta) * 0.5 + 0.5, Math.cos(theta) * 0.5 + 0.5));
        }

        for (let x = 0; x < radialSegments; x++) {
            const a = topCenterIndex;
            const b = topCenterIndex + 1 + x;
            const c = topCenterIndex + 1 + x + 1;
            indices.push(a, b, c);
        }

        // Bottom cap.
        const bottomCenterIndex = vertices.length;
        vertices.push(new Vector3(0, -halfHeight, 0));
        normals.push(new Vector3(0, -1, 0));
        uvs.push(new Vector2(0.5, 0.5));

        for (let x = 0; x <= radialSegments; x++) {
            const u = x / radialSegments;
            const theta = u * Math.PI * 2;
            const vx = radius * Math.sin(theta);
            const vz = radius * Math.cos(theta);

            vertices.push(new Vector3(vx, -halfHeight, vz));
            normals.push(new Vector3(0, -1, 0));
            uvs.push(new Vector2(Math.sin(theta) * 0.5 + 0.5, Math.cos(theta) * 0.5 + 0.5));
        }

        for (let x = 0; x < radialSegments; x++) {
            const a = bottomCenterIndex;
            const c = bottomCenterIndex + 1 + x;
            const b = bottomCenterIndex + 1 + x + 1;
            indices.push(a, b, c);
        }

        mesh._vertices = vertices;
        mesh._normals = normals;
        mesh._uv = uvs;
        mesh._triangles = indices;
        mesh.recalculateBounds();
        mesh._needsUpdate = true;

        mesh._primitive = { kind: "Cylinder", args: [radius, height, segments] };
        return mesh;
    }

    /**
     * Creates a capsule.
     * @param radius — the capsule's radius.
     * @param height — total height, hemispherical caps included.
     * @param segments — subdivision count; higher is smoother.
     * @returns the capsule mesh.
     */
    public static createCapsule(radius: number = 0.5, height: number = 2, segments: number = 32): Mesh {
        const mesh = new Mesh("Capsule");

        const radialSegments = Math.max(3, Math.floor(segments));
        const heightSegments = Math.max(1, Math.floor(segments / 4));

        const cylinderHeight = Math.max(0, height - radius * 2);
        const halfCylinderHeight = cylinderHeight / 2;

        const vertices: Vector3[] = [];
        const normals: Vector3[] = [];
        const uvs: Vector2[] = [];
        const indices: number[] = [];

        // Top hemisphere.
        for (let lat = 0; lat <= heightSegments; lat++) {
            const theta = (lat * Math.PI) / (heightSegments * 2);
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            for (let lon = 0; lon <= radialSegments; lon++) {
                const phi = (lon * 2 * Math.PI) / radialSegments;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);

                const x = radius * sinTheta * cosPhi;
                const y = radius * cosTheta + halfCylinderHeight;
                const z = radius * sinTheta * sinPhi;

                vertices.push(new Vector3(x, y, z));

                const normal = new Vector3(x, y - halfCylinderHeight, z).normalized;
                normals.push(normal);

                uvs.push(new Vector2(lon / radialSegments, 1 - lat / (heightSegments * 2)));
            }
        }

        // The cylindrical middle.
        const cylinderSegs = 2;
        for (let i = 0; i <= cylinderSegs; i++) {
            // Top-down, matching the hemispheres either side. Bottom-up left
            // the single index grid stitching the top hemisphere's equator to
            // the *bottom* of the cylinder, so the middle band spanned the whole
            // capsule and its facing disagreed with the caps'.
            const y = halfCylinderHeight - (i / cylinderSegs) * cylinderHeight;

            for (let lon = 0; lon <= radialSegments; lon++) {
                const phi = (lon * 2 * Math.PI) / radialSegments;
                const x = radius * Math.cos(phi);
                const z = radius * Math.sin(phi);

                vertices.push(new Vector3(x, y, z));
                normals.push(new Vector3(x, 0, z).normalized);
                uvs.push(new Vector2(lon / radialSegments, 0.5 - i / (cylinderSegs * 2)));
            }
        }

        // Bottom hemisphere.
        for (let lat = 1; lat <= heightSegments; lat++) {
            const theta = Math.PI / 2 + (lat * Math.PI) / (heightSegments * 2);
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            for (let lon = 0; lon <= radialSegments; lon++) {
                const phi = (lon * 2 * Math.PI) / radialSegments;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);

                const x = radius * sinTheta * cosPhi;
                const y = radius * cosTheta - halfCylinderHeight;
                const z = radius * sinTheta * sinPhi;

                vertices.push(new Vector3(x, y, z));

                const normal = new Vector3(x, y + halfCylinderHeight, z).normalized;
                normals.push(normal);

                uvs.push(new Vector2(lon / radialSegments, 0.5 - lat / (heightSegments * 2)));
            }
        }

        // Indices.
        const totalRings = heightSegments + cylinderSegs + 1 + heightSegments;
        for (let ring = 0; ring < totalRings; ring++) {
            for (let seg = 0; seg < radialSegments; seg++) {
                const a = ring * (radialSegments + 1) + seg;
                const b = a + radialSegments + 1;
                const c = a + 1;
                const d = b + 1;

                // Counter-clockwise seen from outside, agreeing with the
                // outward normals stored above.
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }

        mesh._vertices = vertices;
        mesh._normals = normals;
        mesh._uv = uvs;
        mesh._triangles = indices;
        mesh.recalculateBounds();
        mesh._needsUpdate = true;

        mesh._primitive = { kind: "Capsule", args: [radius, height, segments] };
        return mesh;
    }

    /**
     * Creates a torus (donut shape) mesh.
     *
     * Use for orbit rings, halos, Saturn rings, or any circular path
     * that needs to be visible as a 3D mesh with proper lighting.
     *
     * The torus lies in the XZ plane (Y-up), centered at origin.
     *
     * @param radius — distance from center of torus to center of tube.
     * @param tube — radius of the tube cross-section.
     * @param radialSegments — segments around the ring (default 64).
     * @param tubularSegments — segments around the tube (default 8).
     * @returns a new torus Mesh.
     *
     * @remarks Equivalent to Unity's built-in Torus primitive.
     *
     * @example
     * ```ts
     * // Orbit ring: radius 9 (Earth orbit), thin tube
     * const orbitMesh = Mesh.createTorus(9, 0.02, 128, 6);
     *
     * // Saturn ring: radius 2.5, flat tube
     * const ringMesh = Mesh.createTorus(2.5, 0.3, 64, 8);
     * ```
     */
    public static createTorus(
        radius: number = 1,
        tube: number = 0.4,
        radialSegments: number = 64,
        tubularSegments: number = 8
    ): Mesh {
        const mesh = new Mesh("Torus");

        const radSegs = Math.max(3, Math.floor(radialSegments));
        const tubeSegs = Math.max(3, Math.floor(tubularSegments));

        const vertices: Vector3[] = [];
        const normals: Vector3[] = [];
        const uvs: Vector2[] = [];
        const indices: number[] = [];

        for (let j = 0; j <= radSegs; j++) {
            for (let i = 0; i <= tubeSegs; i++) {
                const u = (i / tubeSegs) * Math.PI * 2;
                const v = (j / radSegs) * Math.PI * 2;

                const cosV = Math.cos(v);
                const sinV = Math.sin(v);
                const cosU = Math.cos(u);
                const sinU = Math.sin(u);

                // Position on the torus surface (XZ plane, Y-up)
                const x = (radius + tube * cosU) * cosV;
                const y = tube * sinU;
                const z = (radius + tube * cosU) * sinV;

                vertices.push(new Vector3(x, y, z));

                // Normal = direction from ring center to surface point
                const cx = radius * cosV;
                const cz = radius * sinV;
                const nx = x - cx;
                const ny = y;
                const nz = z - cz;
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
                normals.push(new Vector3(nx / len, ny / len, nz / len));

                // UV
                uvs.push(new Vector2(j / radSegs, i / tubeSegs));
            }
        }

        // Indices
        for (let j = 0; j < radSegs; j++) {
            for (let i = 0; i < tubeSegs; i++) {
                const a = j * (tubeSegs + 1) + i;
                const b = a + tubeSegs + 1;
                const c = a + 1;
                const d = b + 1;

                // Counter-clockwise seen from outside the tube, agreeing with
                // the outward normals stored above.
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }

        mesh._vertices = vertices;
        mesh._normals = normals;
        mesh._uv = uvs;
        mesh._triangles = indices;
        mesh.recalculateBounds();
        mesh._needsUpdate = true;

        return mesh;
    }

    /**
     * Creates a quad — a rectangle of two triangles.
     * @param width — the quad's width.
     * @param height — the quad's height.
     * @returns the quad mesh.
     */
    public static createQuad(width: number = 1, height: number = 1): Mesh {
        const mesh = new Mesh("Quad");

        const halfWidth = width / 2;
        const halfHeight = height / 2;

        mesh._vertices = [
            new Vector3(-halfWidth, -halfHeight, 0),
            new Vector3(halfWidth, -halfHeight, 0),
            new Vector3(halfWidth, halfHeight, 0),
            new Vector3(-halfWidth, halfHeight, 0),
        ];

        mesh._normals = [
            new Vector3(0, 0, 1),
            new Vector3(0, 0, 1),
            new Vector3(0, 0, 1),
            new Vector3(0, 0, 1),
        ];

        mesh._uv = [
            new Vector2(0, 0),
            new Vector2(1, 0),
            new Vector2(1, 1),
            new Vector2(0, 1),
        ];

        mesh._triangles = [0, 1, 2, 0, 2, 3];

        mesh.recalculateBounds();
        mesh._needsUpdate = true;

        mesh._primitive = { kind: "Quad", args: [width, height] };
        return mesh;
    }

    // ==================== CLONING ====================

    /**
     * Returns a deep copy of the mesh.
     */
    public clone(): Mesh {
        const cloned = new Mesh(this.name + " (Clone)");

        // Vertex data.
        cloned._vertices = this._vertices.map(v => v.clone());
        cloned._normals = this._normals.map(n => n.clone());
        cloned._tangents = this._tangents.map(t => t.clone());
        cloned._uv = this._uv.map(uv => uv.clone());
        cloned._uv2 = this._uv2.map(uv => uv.clone());
        cloned._uv3 = this._uv3.map(uv => uv.clone());
        cloned._uv4 = this._uv4.map(uv => uv.clone());
        cloned._colors = this._colors.map(c => c.clone());

        // Indices.
        cloned._triangles = [...this._triangles];

        // A clone of a cube is still a cube: the recipe travels with the
        // geometry, so a cloned primitive can still be stored as one.
        cloned._primitive = this._primitive === null
            ? null
            : { kind: this._primitive.kind, args: [...this._primitive.args] };
        cloned._indexFormat = this._indexFormat;

        // Submeshes.
        cloned._subMeshes = this._subMeshes.map(sm => new SubMesh(sm.indexStart, sm.indexCount, sm.topology));

        // Bounds.
        cloned._bounds = this._bounds.clone();

        // The copy has no geometry yet.
        cloned._needsUpdate = true;

        return cloned;
    }

    // ==================== CLEANUP ====================

    /**
     * Destroys the mesh and releases its GPU resources.
     */
    public override destroy(): void {
        this.clear();
        this._threeGeometry.dispose();
        super.destroy();
    }

    // ==================== STATIC CONVERTERS ====================

    /**
     * Builds a Mesh from a THREE.BufferGeometry.
     * Used when importing models through the GLTF and OBJ loaders.
     * @param geometry Three.js BufferGeometry
     * @param name — the mesh's name.
     */
    public static fromThreeGeometry(geometry: THREE.BufferGeometry, name: string = "Imported Mesh"): Mesh {
        const mesh = new Mesh(name);

        // Positions.
        const positionAttr = geometry.getAttribute('position');
        if (positionAttr) {
            mesh._vertices = [];
            for (let i = 0; i < positionAttr.count; i++) {
                mesh._vertices.push(new Vector3(
                    positionAttr.getX(i),
                    positionAttr.getY(i),
                    positionAttr.getZ(i)
                ));
            }
        }

        // Normals.
        const normalAttr = geometry.getAttribute('normal');
        if (normalAttr) {
            mesh._normals = [];
            for (let i = 0; i < normalAttr.count; i++) {
                mesh._normals.push(new Vector3(
                    normalAttr.getX(i),
                    normalAttr.getY(i),
                    normalAttr.getZ(i)
                ));
            }
        }

        // UVs.
        const uvAttr = geometry.getAttribute('uv');
        if (uvAttr) {
            mesh._uv = [];
            for (let i = 0; i < uvAttr.count; i++) {
                mesh._uv.push(new Vector2(
                    uvAttr.getX(i),
                    uvAttr.getY(i)
                ));
            }
        }

        // The second UV set, which Three.js calls `uv1` and Unity calls `uv2`.
        // Dropping it silently broke any imported material whose texture sat on
        // `texCoord: 1` — a common choice for normal and lightmap maps in glTF.
        // The map stayed assigned and sampled an attribute that no longer
        // existed, which reads on screen as broken shading rather than a
        // missing texture.
        const uv1Attr = geometry.getAttribute('uv1');
        if (uv1Attr) {
            mesh._uv2 = [];
            for (let i = 0; i < uv1Attr.count; i++) {
                mesh._uv2.push(new Vector2(
                    uv1Attr.getX(i),
                    uv1Attr.getY(i)
                ));
            }
        }

        // Indices.
        const index = geometry.index;
        if (index) {
            mesh._triangles = [];
            for (let i = 0; i < index.count; i++) {
                mesh._triangles.push(index.getX(i));
            }
        } else {
            // No index buffer: the vertices are already in draw order.
            mesh._triangles = [];
            for (let i = 0; i < mesh._vertices.length; i++) {
                mesh._triangles.push(i);
            }
        }

        // Vertex colours, when present.
        const colorAttr = geometry.getAttribute('color');
        if (colorAttr) {
            mesh._colors = [];
            for (let i = 0; i < colorAttr.count; i++) {
                mesh._colors.push(new Color(
                    colorAttr.getX(i),
                    colorAttr.getY(i),
                    colorAttr.getZ(i),
                    colorAttr.itemSize >= 4 ? colorAttr.getW(i) : 1
                ));
            }
        }

        // Tangents, when present.
        const tangentAttr = geometry.getAttribute('tangent');
        if (tangentAttr) {
            mesh._tangents = [];
            for (let i = 0; i < tangentAttr.count; i++) {
                mesh._tangents.push(new Vector4(
                    tangentAttr.getX(i),
                    tangentAttr.getY(i),
                    tangentAttr.getZ(i),
                    tangentAttr.getW(i)
                ));
            }
        }

        // Bounds.
        mesh.recalculateBounds();
        mesh._needsUpdate = true;

        return mesh;
    }

    /**
     * Combines several meshes into a single mesh (static batching).
     *
     * Each source mesh's geometry is baked by its transform and merged into one
     * geometry, so many static objects sharing a material can be drawn in a
     * **single draw call** via one {@link MeshRenderer}. Analogous to Unity's
     * `Mesh.CombineMeshes` / `StaticBatchingUtility`.
     *
     * All inputs must share the same vertex-attribute set (e.g. position +
     * normal + uv). Meshes produced by the `Mesh.create*` primitives and by
     * model import are compatible. Use this only for **static** geometry — the
     * combined mesh no longer tracks the source transforms.
     *
     * @param instances — the meshes and their local-to-combined transforms.
     * @param name — name for the combined mesh.
     * @returns a new combined {@link Mesh}.
     * @throws if the source meshes have incompatible vertex attributes.
     *
     * @example
     * ```ts
     * const combined = Mesh.combine([
     *     { mesh: wall, matrix: Matrix4x4.TRS(p0, r0, s0) },
     *     { mesh: wall, matrix: Matrix4x4.TRS(p1, r1, s1) },
     * ]);
     * go.addComponent(MeshFilter).sharedMesh = combined;
     * go.addComponent(MeshRenderer).sharedMaterial = wallMaterial;
     * ```
     */
    public static combine(
        instances: MeshCombineInstance[],
        name: string = "Combined Mesh"
    ): Mesh {
        const geometries: THREE.BufferGeometry[] = [];
        const tmp = new THREE.Matrix4();

        for (const inst of instances) {
            if (inst?.mesh == null) continue;

            const baked = inst.mesh._internalGeometry.clone();

            // Normals are required for correct lighting once transformed.
            if (!baked.getAttribute("normal")) baked.computeVertexNormals();

            if (inst.matrix) {
                tmp.fromArray(inst.matrix.elements as unknown as number[]);
                baked.applyMatrix4(tmp); // transforms position + normal + tangent
            }

            geometries.push(baked);
        }

        if (geometries.length === 0) return new Mesh(name);

        const merged = mergeGeometries(geometries, false);
        for (const g of geometries) g.dispose();

        if (merged === null) {
            throw new Error(
                "Mesh.combine: source meshes have incompatible vertex attributes " +
                "(all inputs must share the same attribute set, e.g. position/normal/uv)."
            );
        }

        // fromThreeGeometry copies all data into engine arrays and keeps no
        // reference to `merged`, so the temporary geometry can be disposed.
        const result = Mesh.fromThreeGeometry(merged, name);
        merged.dispose();
        return result;
    }
}