import { EngineObject } from "../EngineObject";
import { Vector3 } from "../math/Vector3";
import { Vector2 } from "../math/Vector2";
import { Vector4 } from "../math/Vector4";
import { Color } from "./Color";
import { Bounds } from "../math/Bounds";
import * as THREE from "three";

/**
 * Mesh.ts
 * Клас для зберігання та управління геометричними даними 3D мешу.
 * 
 * Меш містить:
 * - Вершини (vertices) - позиції точок у 3D просторі
 * - Нормалі (normals) - напрямки поверхонь для освітлення
 * - Тангенти (tangents) - для normal mapping
 * - UV координати (uv, uv2, uv3, uv4) - для текстур
 * - Кольори вершин (colors)
 * - Індекси трикутників (triangles)
 * - Обмежувальну коробку (bounds)
 * 
 * Аналог Unity Mesh.
 */

/**
 * Топологія меша - як інтерпретувати індекси
 */
export enum MeshTopology {
    /** Стандартні трикутники (кожні 3 індекси = 1 трикутник) */
    Triangles = 0,
    /** Чотирикутники (кожні 4 індекси = 1 quad) */
    Quads = 1,
    /** Лінії (кожні 2 індекси = 1 лінія) */
    Lines = 2,
    /** Зв'язані лінії (послідовність вершин) */
    LineStrip = 3,
    /** Точки (кожен індекс = 1 точка) */
    Points = 4
}

/**
 * Формат індексів меша
 */
export enum IndexFormat {
    /** 16-біт індекси (до 65,536 вершин) */
    UInt16 = 0,
    /** 32-біт індекси (до 4,294,967,296 вершин) */
    UInt32 = 1
}

/**
 * Інформація про SubMesh (частину меша з окремим матеріалом)
 */
export class SubMesh {
    /** Початковий індекс у масиві triangles */
    public indexStart: number = 0;
    /** Кількість індексів */
    public indexCount: number = 0;
    /** Топологія цього submesh */
    public topology: MeshTopology = MeshTopology.Triangles;

    constructor(indexStart: number = 0, indexCount: number = 0, topology: MeshTopology = MeshTopology.Triangles) {
        this.indexStart = indexStart;
        this.indexCount = indexCount;
        this.topology = topology;
    }
}

/**
 * Меш - контейнер для геометричних даних 3D моделі
 */
export class Mesh extends EngineObject {
    // ==================== ВЕРШИННІ ДАНІ ====================
    
    /** Масив позицій вершин */
    private _vertices: Vector3[] = [];
    /** Масив нормалей (один вектор на вершину) */
    private _normals: Vector3[] = [];
    /** Масив тангентів для normal mapping (xyz = напрямок, w = handedness) */
    private _tangents: Vector4[] = [];
    /** Основні UV координати (для основної текстури) */
    private _uv: Vector2[] = [];
    /** Додаткові UV координати (для lightmap) */
    private _uv2: Vector2[] = [];
    /** Додаткові UV координати 3 */
    private _uv3: Vector2[] = [];
    /** Додаткові UV координати 4 */
    private _uv4: Vector2[] = [];
    /** Кольори вершин */
    private _colors: Color[] = [];
    
    // ==================== ІНДЕКСИ ====================
    
    /** Масив індексів трикутників (кожні 3 індекси = 1 трикутник) */
    private _triangles: number[] = [];
    /** Формат індексів */
    private _indexFormat: IndexFormat = IndexFormat.UInt16;
    
    // ==================== BOUNDS ====================
    
    /** Обмежувальна коробка меша */
    private _bounds: Bounds = new Bounds();
    
    // ==================== SUBMESHES ====================
    
    /** Масив submesh для мультиматеріалів */
    private _subMeshes: SubMesh[] = [];
    
    // ==================== INTERNAL ====================
    
    /**
     * Внутрішня геометрія Three.js
     * НЕ використовувати напряму - лише для двигуна!
     */
    public _internalGeometry: THREE.BufferGeometry;
    
    /** Флаг чи потрібно оновити геометрію */
    private _needsUpdate: boolean = false;

    constructor(name: string = "Mesh") {
        super(name);
        this._internalGeometry = new THREE.BufferGeometry();
    }

    // ==================== ВЛАСТИВОСТІ ====================

    /** Отримати масив вершин */
    get vertices(): Vector3[] {
        return this._vertices;
    }

    /** Встановити масив вершин */
    set vertices(value: Vector3[]) {
        this._vertices = value;
        this._needsUpdate = true;
    }

    /** Отримати масив нормалей */
    get normals(): Vector3[] {
        return this._normals;
    }

    /** Встановити масив нормалей */
    set normals(value: Vector3[]) {
        this._normals = value;
        this._needsUpdate = true;
    }

    /** Отримати масив тангентів */
    get tangents(): Vector4[] {
        return this._tangents;
    }

    /** Встановити масив тангентів */
    set tangents(value: Vector4[]) {
        this._tangents = value;
        this._needsUpdate = true;
    }

    /** Отримати масив UV координат */
    get uv(): Vector2[] {
        return this._uv;
    }

    /** Встановити масив UV координат */
    set uv(value: Vector2[]) {
        this._uv = value;
        this._needsUpdate = true;
    }

    /** Отримати масив UV2 координат */
    get uv2(): Vector2[] {
        return this._uv2;
    }

    /** Встановити масив UV2 координат */
    set uv2(value: Vector2[]) {
        this._uv2 = value;
        this._needsUpdate = true;
    }

    /** Отримати масив UV3 координат */
    get uv3(): Vector2[] {
        return this._uv3;
    }

    /** Встановити масив UV3 координат */
    set uv3(value: Vector2[]) {
        this._uv3 = value;
        this._needsUpdate = true;
    }

    /** Отримати масив UV4 координат */
    get uv4(): Vector2[] {
        return this._uv4;
    }

    /** Встановити масив UV4 координат */
    set uv4(value: Vector2[]) {
        this._uv4 = value;
        this._needsUpdate = true;
    }

    /** Отримати масив кольорів вершин */
    get colors(): Color[] {
        return this._colors;
    }

    /** Встановити масив кольорів вершин */
    set colors(value: Color[]) {
        this._colors = value;
        this._needsUpdate = true;
    }

    /** Отримати масив індексів трикутників */
    get triangles(): number[] {
        return this._triangles;
    }

    /** Встановити масив індексів трикутників */
    set triangles(value: number[]) {
        this._triangles = value;
        this._needsUpdate = true;
    }

    /** Отримати обмежувальну коробку */
    get bounds(): Bounds {
        return this._bounds;
    }

    /** Встановити обмежувальну коробку */
    set bounds(value: Bounds) {
        this._bounds = value;
    }

    /** Отримати кількість вершин */
    get vertexCount(): number {
        return this._vertices.length;
    }

    /** Отримати кількість трикутників */
    get triangleCount(): number {
        return Math.floor(this._triangles.length / 3);
    }

    /** Отримати/встановити формат індексів */
    get indexFormat(): IndexFormat {
        return this._indexFormat;
    }

    set indexFormat(value: IndexFormat) {
        this._indexFormat = value;
        this._needsUpdate = true;
    }

    /** Отримати кількість submesh */
    get subMeshCount(): number {
        return this._subMeshes.length;
    }

    set subMeshCount(value: number) {
        // Змінити розмір масиву submesh
        if (value > this._subMeshes.length) {
            // Додати нові submesh
            while (this._subMeshes.length < value) {
                this._subMeshes.push(new SubMesh());
            }
        } else if (value < this._subMeshes.length) {
            // Видалити зайві submesh
            this._subMeshes.length = value;
        }
    }

    // ==================== SUBMESH МЕТОДИ ====================

    /**
     * Отримати submesh за індексом
     * @param index Індекс submesh
     * @returns Submesh або undefined
     */
    public getSubMesh(index: number): SubMesh | undefined {
        if (index < 0 || index >= this._subMeshes.length) {
            console.warn(`[Mesh] SubMesh index ${index} out of range [0, ${this._subMeshes.length})`);
            return undefined;
        }
        return this._subMeshes[index];
    }

    /**
     * Встановити submesh за індексом
     * @param index Індекс submesh
     * @param submesh Новий submesh
     */
    public setSubMesh(index: number, submesh: SubMesh): void {
        if (index < 0) {
            console.warn(`[Mesh] SubMesh index ${index} cannot be negative`);
            return;
        }
        
        // Розширити масив якщо потрібно
        while (this._subMeshes.length <= index) {
            this._subMeshes.push(new SubMesh());
        }
        
        this._subMeshes[index] = submesh;
        this._needsUpdate = true;
    }

    // ==================== МЕТОДИ ОБЧИСЛЕННЯ ====================

    /**
     * Перерахувати нормалі автоматично на основі геометрії
     */
    public recalculateNormals(): void {
        if (this._vertices.length === 0 || this._triangles.length === 0) {
            console.warn("[Mesh] Cannot recalculate normals: no vertices or triangles");
            return;
        }

        // Ініціалізувати масив нормалей нулями
        this._normals = new Array(this._vertices.length);
        for (let i = 0; i < this._vertices.length; i++) {
            this._normals[i] = new Vector3(0, 0, 0);
        }

        // Пройтися по всіх трикутниках
        for (let i = 0; i < this._triangles.length; i += 3) {
            const i0 = this._triangles[i];
            const i1 = this._triangles[i + 1];
            const i2 = this._triangles[i + 2];

            const v0 = this._vertices[i0];
            const v1 = this._vertices[i1];
            const v2 = this._vertices[i2];

            // Обчислити нормаль грані (cross product)
            const edge1 = Vector3.subtract(v1, v0);
            const edge2 = Vector3.subtract(v2, v0);
            const normal = Vector3.cross(edge1, edge2);

            // Додати нормаль до всіх вершин трикутника
            this._normals[i0] = Vector3.add(this._normals[i0], normal);
            this._normals[i1] = Vector3.add(this._normals[i1], normal);
            this._normals[i2] = Vector3.add(this._normals[i2], normal);
        }

        // Нормалізувати всі нормалі
        for (let i = 0; i < this._normals.length; i++) {
            this._normals[i].normalize();
        }

        this._needsUpdate = true;
    }

    /**
     * Перерахувати тангенти для normal mapping
     * Алгоритм: Lengyel's Method
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

        // Тимчасові масиви для обчислень
        const tan1 = new Array(this._vertices.length);
        const tan2 = new Array(this._vertices.length);
        for (let i = 0; i < this._vertices.length; i++) {
            tan1[i] = new Vector3(0, 0, 0);
            tan2[i] = new Vector3(0, 0, 0);
        }

        // Обчислити тангенти та бітангенти
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

        // Ортогоналізувати та обчислити handedness
        this._tangents = new Array(this._vertices.length);
        for (let i = 0; i < this._vertices.length; i++) {
            const n = this._normals[i];
            const t = tan1[i];

            // Gram-Schmidt ортогоналізація
            const tangent = Vector3.subtract(t, Vector3.scale(n, Vector3.dot(n, t)));
            tangent.normalize();

            // Обчислити handedness (w компонент)
            const cross = Vector3.cross(n, t);
            const w = (Vector3.dot(cross, tan2[i]) < 0.0) ? -1.0 : 1.0;

            this._tangents[i] = new Vector4(tangent.x, tangent.y, tangent.z, w);
        }

        this._needsUpdate = true;
    }

    /**
     * Перерахувати обмежувальну коробку на основі вершин
     */
    public recalculateBounds(): void {
        if (this._vertices.length === 0) {
            this._bounds = new Bounds(new Vector3(0, 0, 0), new Vector3(0, 0, 0));
            return;
        }

        // Знайти мінімум та максимум
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
     * Очистити всі дані меша
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
     * Синхронізувати дані з внутрішньою геометрією Three.js
     * Викликається автоматично перед рендерингом
     */
    public _syncToThree(): void {
        if (!this._needsUpdate) return;

        // Очистити стару геометрію
        this._internalGeometry.dispose();
        this._internalGeometry = new THREE.BufferGeometry();

        // Вершини
        if (this._vertices.length > 0) {
            const positions = new Float32Array(this._vertices.length * 3);
            for (let i = 0; i < this._vertices.length; i++) {
                positions[i * 3 + 0] = this._vertices[i].x;
                positions[i * 3 + 1] = this._vertices[i].y;
                positions[i * 3 + 2] = this._vertices[i].z;
            }
            this._internalGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        }

        // Нормалі
        if (this._normals.length > 0) {
            const normals = new Float32Array(this._normals.length * 3);
            for (let i = 0; i < this._normals.length; i++) {
                normals[i * 3 + 0] = this._normals[i].x;
                normals[i * 3 + 1] = this._normals[i].y;
                normals[i * 3 + 2] = this._normals[i].z;
            }
            this._internalGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        }

        // Тангенти
        if (this._tangents.length > 0) {
            const tangents = new Float32Array(this._tangents.length * 4);
            for (let i = 0; i < this._tangents.length; i++) {
                tangents[i * 4 + 0] = this._tangents[i].x;
                tangents[i * 4 + 1] = this._tangents[i].y;
                tangents[i * 4 + 2] = this._tangents[i].z;
                tangents[i * 4 + 3] = this._tangents[i].w;
            }
            this._internalGeometry.setAttribute('tangent', new THREE.BufferAttribute(tangents, 4));
        }

        // UV
        if (this._uv.length > 0) {
            const uvs = new Float32Array(this._uv.length * 2);
            for (let i = 0; i < this._uv.length; i++) {
                uvs[i * 2 + 0] = this._uv[i].x;
                uvs[i * 2 + 1] = this._uv[i].y;
            }
            this._internalGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        }

        // UV2
        if (this._uv2.length > 0) {
            const uv2s = new Float32Array(this._uv2.length * 2);
            for (let i = 0; i < this._uv2.length; i++) {
                uv2s[i * 2 + 0] = this._uv2[i].x;
                uv2s[i * 2 + 1] = this._uv2[i].y;
            }
            this._internalGeometry.setAttribute('uv2', new THREE.BufferAttribute(uv2s, 2));
        }

        // Кольори
        if (this._colors.length > 0) {
            const colors = new Float32Array(this._colors.length * 4);
            for (let i = 0; i < this._colors.length; i++) {
                colors[i * 4 + 0] = this._colors[i].r;
                colors[i * 4 + 1] = this._colors[i].g;
                colors[i * 4 + 2] = this._colors[i].b;
                colors[i * 4 + 3] = this._colors[i].a;
            }
            this._internalGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
        }

        // Індекси
        if (this._triangles.length > 0) {
            const indices = this._indexFormat === IndexFormat.UInt32
                ? new Uint32Array(this._triangles)
                : new Uint16Array(this._triangles);
            this._internalGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
        }

        // Обчислити bounds якщо не встановлено вручну
        this._internalGeometry.computeBoundingBox();
        this._internalGeometry.computeBoundingSphere();

        this._needsUpdate = false;
    }

    // ==================== СТАТИЧНІ ФАБРИКИ (ПРИМІТИВИ) ====================

    /**
     * Створити куб
     * @param size Розмір куба (довжина ребра)
     * @returns Новий меш куба
     */
    public static createCube(size: number = 1): Mesh {
        const mesh = new Mesh("Cube");
        const s = size / 2;

        // Вершини куба (24 вершини - по 4 на грань для правильних нормалей)
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

        // Нормалі
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

        // UV координати
        mesh._uv = [];
        for (let i = 0; i < 6; i++) {
            mesh._uv.push(
                new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1)
            );
        }

        // Індекси (6 граней * 2 трикутники * 3 вершини)
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
        return mesh;
    }

    /**
     * Створити сферу
     * @param radius Радіус сфери
     * @param segments Кількість сегментів (детальність)
     * @returns Новий меш сфери
     */
    public static createSphere(radius: number = 0.5, segments: number = 32): Mesh {
        const mesh = new Mesh("Sphere");
        
        const widthSegments = Math.max(3, Math.floor(segments));
        const heightSegments = Math.max(2, Math.floor(segments / 2));

        const vertices: Vector3[] = [];
        const normals: Vector3[] = [];
        const uvs: Vector2[] = [];
        const indices: number[] = [];

        // Генерація вершин
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

        // Генерація індексів
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

        return mesh;
    }

    /**
     * Створити площину
     * @param width Ширина площини
     * @param height Висота площини
     * @param widthSegments Кількість сегментів по ширині (за замовчуванням 1)
     * @param heightSegments Кількість сегментів по висоті (за замовчуванням 1)
     * @returns Новий меш площини
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

        // Генерація вершин
        for (let iy = 0; iy < gridY; iy++) {
            const y = iy * segmentHeight - halfHeight;
            for (let ix = 0; ix < gridX; ix++) {
                const x = ix * segmentWidth - halfWidth;
                
                vertices.push(new Vector3(x, y, 0));
                normals.push(new Vector3(0, 0, 1));
                uvs.push(new Vector2(ix / widthSegs, 1 - (iy / heightSegs)));
            }
        }

        // Генерація індексів
        for (let iy = 0; iy < heightSegs; iy++) {
            for (let ix = 0; ix < widthSegs; ix++) {
                const a = ix + gridX * iy;
                const b = ix + gridX * (iy + 1);
                const c = (ix + 1) + gridX * (iy + 1);
                const d = (ix + 1) + gridX * iy;

                indices.push(a, b, d);
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
     * Створити циліндр
     * @param radius Радіус циліндра
     * @param height Висота циліндра
     * @param segments Кількість сегментів (детальність)
     * @returns Новий меш циліндра
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

        // Бічна поверхня
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

        // Індекси бічної поверхні
        for (let y = 0; y < heightSegments; y++) {
            for (let x = 0; x < radialSegments; x++) {
                const a = y * (radialSegments + 1) + x;
                const b = a + radialSegments + 1;
                const c = a + 1;
                const d = b + 1;

                indices.push(a, b, c);
                indices.push(b, d, c);
            }
        }

        // Верхня кришка
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

        // Нижня кришка
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

        return mesh;
    }

    /**
     * Створити капсулу
     * @param radius Радіус капсули
     * @param height Висота капсули (включаючи півсфери)
     * @param segments Кількість сегментів (детальність)
     * @returns Новий меш капсули
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

        // Верхня півсфера
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

        // Циліндрична частина
        const cylinderSegs = 2;
        for (let i = 0; i <= cylinderSegs; i++) {
            const y = (i / cylinderSegs) * cylinderHeight - halfCylinderHeight;

            for (let lon = 0; lon <= radialSegments; lon++) {
                const phi = (lon * 2 * Math.PI) / radialSegments;
                const x = radius * Math.cos(phi);
                const z = radius * Math.sin(phi);

                vertices.push(new Vector3(x, y, z));
                normals.push(new Vector3(x, 0, z).normalized);
                uvs.push(new Vector2(lon / radialSegments, 0.5 - i / (cylinderSegs * 2)));
            }
        }

        // Нижня півсфера
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

        // Генерація індексів
        const totalRings = heightSegments + cylinderSegs + 1 + heightSegments;
        for (let ring = 0; ring < totalRings; ring++) {
            for (let seg = 0; seg < radialSegments; seg++) {
                const a = ring * (radialSegments + 1) + seg;
                const b = a + radialSegments + 1;
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

        return mesh;
    }

    /**
     * Створити quad (прямокутник, 2 трикутники)
     * @param width Ширина quad
     * @param height Висота quad
     * @returns Новий меш quad
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

        return mesh;
    }

    // ==================== CLONING ====================

    /**
     * Створює копію меша з усіма даними.
     */
    public clone(): Mesh {
        const cloned = new Mesh(this.name + " (Clone)");
        
        // Копіюємо вершинні дані
        cloned._vertices = this._vertices.map(v => v.clone());
        cloned._normals = this._normals.map(n => n.clone());
        cloned._tangents = this._tangents.map(t => t.clone());
        cloned._uv = this._uv.map(uv => uv.clone());
        cloned._uv2 = this._uv2.map(uv => uv.clone());
        cloned._uv3 = this._uv3.map(uv => uv.clone());
        cloned._uv4 = this._uv4.map(uv => uv.clone());
        cloned._colors = this._colors.map(c => c.clone());
        
        // Копіюємо індекси
        cloned._triangles = [...this._triangles];
        cloned._indexFormat = this._indexFormat;
        
        // Копіюємо submeshes
        cloned._subMeshes = this._subMeshes.map(sm => new SubMesh(sm.indexStart, sm.indexCount, sm.topology));
        
        // Копіюємо bounds
        cloned._bounds = this._bounds.clone();
        
        // Позначаємо як потребує оновлення
        cloned._needsUpdate = true;
        
        return cloned;
    }

    // ==================== CLEANUP ====================

    /**
     * Знищити меш та звільнити ресурси
     */
    public destroy(): void {
        this.clear();
        this._internalGeometry.dispose();
        super.destroy();
    }
}
