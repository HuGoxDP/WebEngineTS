import JSZip from 'jszip';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { Texture2D } from '../graphics/Texture2D';
import { GameObject } from '../GameObject';
import { MeshFilter } from '../components/MeshFilter';
import { MeshRenderer } from '../components/MeshRenderer';
import { Mesh } from '../graphics/Mesh';
import { StandardMaterial } from '../graphics/StandardMaterial';

/**
 * ScenarioAssets.ts
 * Менеджер ресурсів сценарію - завантаження та кешування текстур, моделей, тощо.
 * Аналог Unity Resources / AssetDatabase для runtime.
 *
 * Всі ресурси зберігаються в RAM та очищаються при вивантаженні сценарію.
 */
export class ScenarioAssets {
    /** ZIP-архів з ресурсами */
    private _zip: JSZip;

    /** Кеш текстур */
    private _textureCache: Map<string, Texture2D> = new Map();

    /** Кеш моделей (як GameObject prefabs) */
    private _modelCache: Map<string, GameObject> = new Map();

    /** Кеш blob URLs для очищення */
    private _blobUrls: string[] = [];

    /** GLTF Loader для 3D моделей */
    private _gltfLoader: GLTFLoader;

    constructor(zip: JSZip) {
        this._zip = zip;
        this._gltfLoader = new GLTFLoader();
    }

    // === Текстури ===

    /**
     * Завантажує текстуру з архіву.
     * @param path Шлях до текстури відносно assets/textures/
     */
    public async loadTexture(path: string): Promise<Texture2D> {
        // Нормалізуємо шлях
        const normalizedPath = this.normalizePath('textures', path);

        // Перевіряємо кеш
        if (this._textureCache.has(normalizedPath)) {
            return this._textureCache.get(normalizedPath)!;
        }

        // Завантажуємо з архіву
        const file = this._zip.file(`assets/${normalizedPath}`);
        if (!file) {
            throw new Error(`Texture not found: assets/${normalizedPath}`);
        }

        const data = await file.async('arraybuffer');
        const blob = new Blob([data], { type: this.getMimeType(path) });
        const url = URL.createObjectURL(blob);
        this._blobUrls.push(url);

        // Створюємо Texture2D
        const texture = await this.loadTextureFromUrl(url, path);

        // Кешуємо
        this._textureCache.set(normalizedPath, texture);

        return texture;
    }

    /**
     * Завантажує текстуру з URL.
     */
    private loadTextureFromUrl(url: string, name: string): Promise<Texture2D> {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                // Створюємо Three.js текстуру
                const threeTexture = new THREE.Texture(img);
                threeTexture.needsUpdate = true;
                threeTexture.colorSpace = THREE.SRGBColorSpace;

                // Обгортаємо в Texture2D
                const texture2d = Texture2D.fromThreeTexture(threeTexture);
                texture2d.name = name;

                resolve(texture2d);
            };

            img.onerror = () => {
                reject(new Error(`Failed to load texture: ${name}`));
            };

            img.src = url;
        });
    }

    // === 3D Моделі ===

    /**
     * Завантажує 3D модель з архіву.
     * Підтримує формати: GLB, GLTF.
     * @param path Шлях до моделі відносно assets/models/
     */
    public async loadModel(path: string): Promise<GameObject> {
        // Нормалізуємо шлях
        const normalizedPath = this.normalizePath('models', path);

        // Перевіряємо кеш - повертаємо клон
        if (this._modelCache.has(normalizedPath)) {
            return this.cloneModel(this._modelCache.get(normalizedPath)!);
        }

        // Завантажуємо з архіву
        const file = this._zip.file(`assets/${normalizedPath}`);
        if (!file) {
            throw new Error(`Model not found: assets/${normalizedPath}`);
        }

        const data = await file.async('arraybuffer');
        const blob = new Blob([data], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        this._blobUrls.push(url);

        // Завантажуємо GLTF
        const gltf = await this.loadGLTF(url);

        // Конвертуємо в GameObject
        const rootObject = this.convertGLTFToGameObject(gltf, path);

        // Кешуємо
        this._modelCache.set(normalizedPath, rootObject);

        // Повертаємо клон
        return this.cloneModel(rootObject);
    }

    /**
     * Завантажує GLTF через Three.js loader.
     */
    private loadGLTF(url: string): Promise<GLTF> {
        return new Promise((resolve, reject) => {
            this._gltfLoader.load(
                url,
                (gltf) => resolve(gltf),
                undefined,
                (error) => reject(error)
            );
        });
    }

    /**
     * Конвертує GLTF сцену в ієрархію GameObject.
     */
    private convertGLTFToGameObject(gltf: GLTF, name: string): GameObject {
        const root = new GameObject(name);

        // Обходимо всі меші в GLTF сцені
        gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const threeMesh = child as THREE.Mesh;

                // Створюємо GameObject для кожного меша
                const meshObject = new GameObject(threeMesh.name || 'Mesh');

                // Копіюємо трансформацію
                meshObject.transform.position.set(
                    threeMesh.position.x,
                    threeMesh.position.y,
                    threeMesh.position.z
                );
                meshObject.transform.rotation.set(
                    threeMesh.quaternion.x,
                    threeMesh.quaternion.y,
                    threeMesh.quaternion.z,
                    threeMesh.quaternion.w
                );
                meshObject.transform.localScale.set(
                    threeMesh.scale.x,
                    threeMesh.scale.y,
                    threeMesh.scale.z
                );

                // Додаємо MeshFilter
                const meshFilter = meshObject.addComponent(MeshFilter);
                const geometry = threeMesh.geometry;
                meshFilter.mesh = Mesh.fromThreeGeometry(geometry);

                // Додаємо MeshRenderer
                const meshRenderer = meshObject.addComponent(MeshRenderer);

                // Конвертуємо матеріал
                if (threeMesh.material) {
                    const material = this.convertMaterial(threeMesh.material as THREE.Material);
                    meshRenderer.sharedMaterial = material;
                }

                // Додаємо як дочірній об'єкт
                meshObject.transform.parent = root.transform;
            }
        });

        return root;
    }

    /**
     * Конвертує Three.js матеріал в StandardMaterial.
     */
    private convertMaterial(threeMaterial: THREE.Material): StandardMaterial {
        const material = new StandardMaterial();
        material.name = threeMaterial.name || 'Material';

        // Базова конвертація для MeshStandardMaterial
        if ((threeMaterial as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const stdMat = threeMaterial as THREE.MeshStandardMaterial;

            // Колір
            if (stdMat.color) {
                material.color.r = stdMat.color.r;
                material.color.g = stdMat.color.g;
                material.color.b = stdMat.color.b;
            }

            // TODO: Конвертувати текстури, metallic, roughness тощо
        }

        return material;
    }

    /**
     * Клонує модель (prefab pattern).
     */
    private cloneModel(original: GameObject): GameObject {
        // TODO: Реалізувати повноцінне клонування GameObject
        // Поки що повертаємо оригінал
        return original;
    }

    // === Допоміжні методи ===

    /**
     * Нормалізує шлях до ресурсу.
     */
    private normalizePath(folder: string, path: string): string {
        // Якщо шлях вже містить папку - повертаємо як є
        if (path.startsWith(`${folder}/`)) {
            return path;
        }
        return `${folder}/${path}`;
    }

    /**
     * Визначає MIME-тип файлу за розширенням.
     */
    private getMimeType(path: string): string {
        const ext = path.split('.').pop()?.toLowerCase();

        switch (ext) {
            case 'png': return 'image/png';
            case 'jpg':
            case 'jpeg': return 'image/jpeg';
            case 'gif': return 'image/gif';
            case 'webp': return 'image/webp';
            case 'svg': return 'image/svg+xml';
            case 'glb': return 'model/gltf-binary';
            case 'gltf': return 'model/gltf+json';
            case 'json': return 'application/json';
            default: return 'application/octet-stream';
        }
    }

    /**
     * Очищає всі завантажені ресурси.
     */
    public dispose(): void {
        // Очищаємо blob URLs
        for (const url of this._blobUrls) {
            URL.revokeObjectURL(url);
        }
        this._blobUrls = [];

        // Очищаємо кеші
        this._textureCache.clear();
        this._modelCache.clear();

        console.log('[ScenarioAssets] Disposed');
    }
}
