import * as THREE from "three";
import { Renderer } from "./Renderer";
import { MeshFilter } from "./MeshFilter";
import { Mesh } from "../graphics/Mesh";
import type { GameObject } from "../GameObject";

/**
 * Компонент для рендерингу 3D мешів.
 * Повна імітація Unity MeshRenderer.
 * 
 * MeshRenderer отримує геометрію з MeshFilter та відображає її з матеріалом.
 */
export class MeshRenderer extends Renderer {
    /**
     * @internal - НЕ використовувати напряму!
     * THREE.js меш для рендерингу
     */
    public _threeMesh: THREE.Mesh | null = null;

    /** Кешоване посилання на MeshFilter */
    private _meshFilter: MeshFilter | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "MeshRenderer";
    }

    // === Lifecycle ===

    protected onAwake(): void {
        // Створюємо THREE.Mesh
        this._threeMesh = new THREE.Mesh();
        this._threeObject = this._threeMesh;
        
        // Налаштовуємо тіні
        this._threeMesh.castShadow = true;
        this._threeMesh.receiveShadow = true;
        
        // Шукаємо MeshFilter
        this.findMeshFilter();
        
        // Оновлюємо меш та матеріал
        this.updateMesh();
        this.updateMaterial();
        
        // Додаємо до THREE.js сцени через Transform
        if (this.gameObject && this.gameObject.transform.object3D) {
            this.gameObject.transform.object3D.add(this._threeMesh);
        }
    }

    protected override onEnable(): void {
        super.onEnable();
        if (this._threeMesh) {
            this._threeMesh.visible = true;
        }
    }

    protected override onDisable(): void {
        super.onDisable();
        if (this._threeMesh) {
            this._threeMesh.visible = false;
        }
    }

    protected override onDestroy(): void {
        // Видаляємо з THREE.js сцени
        if (this._threeMesh && this.gameObject?.transform.object3D) {
            this.gameObject.transform.object3D.remove(this._threeMesh);
        }
        
        // Звільняємо ресурси
        if (this._threeMesh) {
            this._threeMesh.geometry?.dispose();
            if (Array.isArray(this._threeMesh.material)) {
                this._threeMesh.material.forEach(m => m?.dispose());
            } else {
                this._threeMesh.material?.dispose();
            }
        }
        
        this._threeMesh = null;
        this._threeObject = null;
        this._meshFilter = null;
        
        super.onDestroy();
    }

    // === Методи ===

    /**
     * Шукає MeshFilter компонент на тому ж GameObject.
     */
    private findMeshFilter(): void {
        if (!this.gameObject) return;
        
        this._meshFilter = this.gameObject.getComponent(MeshFilter);
        
        if (!this._meshFilter) {
            console.warn("MeshRenderer: MeshFilter не знайдено на GameObject!");
        }
    }

    /**
     * Оновлює геометрію з MeshFilter.
     */
    public updateMesh(): void {
        if (!this._threeMesh) return;
        
        // Якщо немає MeshFilter - шукаємо
        if (!this._meshFilter) {
            this.findMeshFilter();
        }
        
        if (!this._meshFilter) return;
        
        // Отримуємо меш з MeshFilter
        const mesh = this._meshFilter.sharedMesh;
        if (!mesh) {
            console.warn("MeshRenderer: MeshFilter не має меша!");
            return;
        }
        
        // Встановлюємо геометрію
        this.setMeshGeometry(mesh);
        
        // Оновлюємо bounds
        this.updateBounds(mesh);
    }

    /**
     * Встановлює геометрію THREE.js з нашого Mesh.
     */
    private setMeshGeometry(mesh: Mesh): void {
        if (!this._threeMesh) return;
        
        // Отримуємо THREE.BufferGeometry з нашого Mesh
        const geometry = mesh._internalGeometry;
        
        if (!geometry) {
            console.error("MeshRenderer: Mesh не має THREE.BufferGeometry!");
            return;
        }
        
        // Звільняємо стару геометрію
        if (this._threeMesh.geometry) {
            this._threeMesh.geometry.dispose();
        }
        
        // Встановлюємо нову
        this._threeMesh.geometry = geometry;
    }

    /**
     * Оновлює bounds з меша.
     */
    private updateBounds(mesh: Mesh): void {
        const bounds = mesh.bounds;
        this._localBounds = bounds.clone();
    }

    /**
     * Оновлює матеріал на THREE.js меші (один матеріал).
     */
    protected override updateMaterial(): void {
        if (!this._threeMesh) return;
        
        const mat = this._materialInstance || this._sharedMaterial;
        
        if (mat) {
            this._threeMesh.material = mat._threeMaterial;
        } else {
            // Дефолтний матеріал (білий)
            this._threeMesh.material = new THREE.MeshStandardMaterial({ color: 0xffffff });
        }
    }

    /**
     * Оновлює масив матеріалів на THREE.js меші (multi-material).
     */
    protected override updateMaterials(): void {
        if (!this._threeMesh) return;
        
        const mats = this._materialInstances || this._sharedMaterials;
        
        if (mats.length > 0) {
            this._threeMesh.material = mats.map(m => m._threeMaterial);
        } else {
            // Дефолтний матеріал
            this._threeMesh.material = new THREE.MeshStandardMaterial({ color: 0xffffff });
        }
    }

    // === Допоміжні методи ===

    /**
     * Примусово оновлює рендерер (меш + матеріал).
     */
    public forceUpdate(): void {
        this.updateMesh();
        
        if (this._materialInstances || this._sharedMaterials.length > 0) {
            this.updateMaterials();
        } else {
            this.updateMaterial();
        }
    }
}
