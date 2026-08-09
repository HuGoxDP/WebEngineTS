import { Component } from "../Component.ts";
import { Mesh } from "../graphics/Mesh.ts";
import { Serializable, SerializedField } from "../reflection/Decorators.ts";
import { FieldType } from "../reflection/Types.ts";
import type { GameObject } from "../GameObject.ts";

/**
 * Компонент для зберігання геометрії меша.
 * Повна імітація Unity MeshFilter.
 * 
 * MeshFilter зберігає посилання на Mesh, який рендериться компонентом MeshRenderer.
 */
@Serializable({ typeName: "MeshFilter", category: "Rendering" })
export class MeshFilter extends Component {
    /** Shared меш (не копіюється, тільки посилання) */
    private _sharedMesh: Mesh | null = null;

    /** Instance меша (копія для редагування) */
    private _meshInstance: Mesh | null = null;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "MeshFilter";
    }

    // === Властивості ===

    /**
     * Shared меш (спільний ресурс).
     * Не модифікуйте цей меш напряму - він спільний для всіх об'єктів!
     * Для редагування використовуйте mesh (створить копію).
     */
    @SerializedField({ type: FieldType.Mesh })
    public get sharedMesh(): Mesh | null {
        return this._sharedMesh;
    }

    public set sharedMesh(value: Mesh | null) {
        this._sharedMesh = value;
        
        // Скидаємо instance, щоб при наступному доступі до mesh створилася нова копія
        if (this._meshInstance) {
            this._meshInstance = null;
        }
    }

    /**
     * Меш для редагування (instance).
     * При першому доступі створюється копія sharedMesh.
     * Зміни цього меша не вплинуть на інші об'єкти.
     */
    public get mesh(): Mesh | null {
        // Якщо є instance - повертаємо його
        if (this._meshInstance) {
            return this._meshInstance;
        }

        // Якщо немає instance, але є shared - створюємо копію
        if (this._sharedMesh) {
            this._meshInstance = this._sharedMesh.clone() as Mesh;
            return this._meshInstance;
        }

        // Нічого немає
        return null;
    }

    public set mesh(value: Mesh | null) {
        if (value === null) {
            this._meshInstance = null;
            this._sharedMesh = null;
            return;
        }

        // При присвоєнні mesh створюємо копію
        this._meshInstance = value.clone() as Mesh;
        this._sharedMesh = null; // Більше не використовуємо shared
    }

    // === Методи ===

    /**
     * Перевіряє, чи MeshFilter має меш.
     */
    public hasMesh(): boolean {
        return this._sharedMesh !== null || this._meshInstance !== null;
    }

    // === Життєвий цикл ===

    protected override onDestroy(): void {
        // Знищуємо тільки instance (shared не чіпаємо - він може використовуватися іншими)
        if (this._meshInstance) {
            this._meshInstance.destroy();
            this._meshInstance = null;
        }
        
        this._sharedMesh = null;
        
        super.onDestroy();
    }
}
