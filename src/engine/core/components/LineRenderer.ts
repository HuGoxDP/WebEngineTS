import * as THREE from "three";
import { Renderer } from "../rendering/Renderer.ts";
import { Color } from "../math/Color";
import { Vector3 } from "../math/Vector3";
import { Serializable, SerializedField } from "../reflection/Decorators";
import { FieldType } from "../reflection/Types";
import type { GameObject } from "../GameObject";

/**
 * Режим вирівнювання лінії.
 */
export enum LineAlignment {
    /** Лінія повернута до камери (billboard) */
    View = 0,
    /** Лінія в локальному просторі Transform */
    TransformZ = 1
}

/**
 * Режим текстурування лінії.
 */
export enum LineTextureMode {
    /** Текстура розтягується по всій лінії */
    Stretch = 0,
    /** Текстура повторюється по довжині */
    Tile = 1,
    /** Текстура розподіляється по довжині на кожен сегмент */
    DistributePerSegment = 2,
    /** Текстура повторюється з відступами */
    RepeatPerSegment = 3
}

/**
 * Ключовий кадр для Gradient (колір + час).
 */
export interface GradientColorKey {
    color: Color;
    time: number; // 0-1
}

/**
 * Ключовий кадр для AnimationCurve (значення + час).
 */
export interface CurveKey {
    value: number;
    time: number; // 0-1
}

/**
 * Компонент LineRenderer - малювання ліній у 3D просторі.
 * Повна імітація Unity LineRenderer.
 * 
 * Дозволяє малювати лінії з:
 * - Градієнтом кольору
 * - Зміною ширини
 * - Різними режимами вирівнювання
 * 
 * @example
 * ```typescript
 * const lineObj = new GameObject("Line");
 * const line = lineObj.addComponent(LineRenderer);
 * 
 * // Встановлюємо точки
 * line.positionCount = 3;
 * line.setPosition(0, new Vector3(0, 0, 0));
 * line.setPosition(1, new Vector3(5, 2, 0));
 * line.setPosition(2, new Vector3(10, 0, 0));
 * 
 * // Налаштовуємо вигляд
 * line.startWidth = 0.5;
 * line.endWidth = 0.1;
 * line.startColor = Color.red;
 * line.endColor = Color.blue;
 * ```
 */
@Serializable({ typeName: "LineRenderer", category: "Rendering" })
export class LineRenderer extends Renderer {
    /**
     * @internal - НЕ використовувати напряму!
     * THREE.js лінія
     */
    private _threeLine: THREE.Line | null = null;
    
    /** Масив точок лінії */
    private _positions: Vector3[] = [];
    
    /** Ширина на початку лінії */
    private _startWidth: number = 1.0;
    
    /** Ширина в кінці лінії */
    private _endWidth: number = 1.0;
    
    /** Колір на початку лінії */
    private _startColor: Color = Color.white;
    
    /** Колір в кінці лінії */
    private _endColor: Color = Color.white;
    
    /** Gradient кольорів (для складних градієнтів) */
    private _colorGradient: GradientColorKey[] = [];
    
    /** Крива ширини (для складних змін ширини) */
    private _widthCurve: CurveKey[] = [];
    
    /** Множник ширини */
    private _widthMultiplier: number = 1.0;
    
    /** Чи використовувати світові координати */
    private _useWorldSpace: boolean = true;
    
    /** Чи замикати лінію */
    private _loop: boolean = false;
    
    /** Кількість кутових сегментів */
    private _numCornerVertices: number = 0;
    
    /** Кількість сегментів на кінцях */
    private _numCapVertices: number = 0;
    
    /** Режим вирівнювання */
    private _alignment: LineAlignment = LineAlignment.View;
    
    /** Режим текстурування */
    private _textureMode: LineTextureMode = LineTextureMode.Stretch;
    
    /** Прапор оновлення */
    private _needsUpdate: boolean = true;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.name = "LineRenderer";
    }

    // === Lifecycle ===

    protected override onAwake(): void {
        // Створюємо THREE.js лінію
        const geometry = new THREE.BufferGeometry();
        
        const material = new THREE.LineBasicMaterial({ 
            color: 0xffffff,
            linewidth: 1
        });
        
        this._threeLine = new THREE.Line(geometry, material);
       // this._threeObject = this._threeLine;
        
        // Додаємо до сцени через Transform
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

    // === Властивості - Кількість точок ===

    /**
     * Кількість точок у лінії.
     */
    public get positionCount(): number {
        return this._positions.length;
    }

    public set positionCount(value: number) {
        const oldCount = this._positions.length;
        
        if (value > oldCount) {
            // Додаємо нові точки (з нульовими координатами)
            for (let i = oldCount; i < value; i++) {
                this._positions.push(Vector3.zero);
            }
        } else if (value < oldCount) {
            // Видаляємо зайві точки
            this._positions.length = value;
        }
        
        this._needsUpdate = true;
    }

    // === Властивості - Ширина ===

    /**
     * Ширина лінії на початку.
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
     * Ширина лінії в кінці.
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
     * Множник ширини (застосовується до всіх значень ширини).
     */
    @SerializedField()
    public get widthMultiplier(): number {
        return this._widthMultiplier;
    }

    public set widthMultiplier(value: number) {
        this._widthMultiplier = Math.max(0, value);
        this._needsUpdate = true;
    }

    // === Властивості - Колір ===

    /**
     * Колір на початку лінії.
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
     * Колір в кінці лінії.
     */
    @SerializedField({ type: FieldType.Color })
    public get endColor(): Color {
        return this._endColor.clone();
    }

    public set endColor(value: Color) {
        this._endColor = value.clone();
        this._needsUpdate = true;
    }

    // === Властивості - Налаштування ===

    /**
     * Чи використовувати світові координати для точок.
     * Якщо true - точки в світовому просторі.
     * Якщо false - точки відносно Transform.
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
     * Чи замикати лінію (з'єднати останню точку з першою).
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
     * Режим вирівнювання лінії.
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
     * Режим текстурування.
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
     * Кількість вершин для згладжування кутів.
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
     * Кількість вершин для закінчень лінії.
     */
    @SerializedField()
    public get numCapVertices(): number {
        return this._numCapVertices;
    }

    public set numCapVertices(value: number) {
        this._numCapVertices = Math.max(0, Math.floor(value));
        this._needsUpdate = true;
    }

    // === Методи - Позиції ===

    /**
     * Отримати позицію точки за індексом.
     * @param index Індекс точки
     * @returns Позиція точки
     */
    public getPosition(index: number): Vector3 {
        if (index < 0 || index >= this._positions.length) {
            console.warn(`[LineRenderer] Index ${index} out of range [0, ${this._positions.length})`);
            return Vector3.zero;
        }
        return this._positions[index].clone();
    }

    /**
     * Встановити позицію точки за індексом.
     * @param index Індекс точки
     * @param position Нова позиція
     */
    public setPosition(index: number, position: Vector3): void {
        if (index < 0 || index >= this._positions.length) {
            console.warn(`[LineRenderer] Index ${index} out of range [0, ${this._positions.length})`);
            return;
        }
        this._positions[index] = position.clone();
        this._needsUpdate = true;
        
        // Оновлюємо лінію одразу
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
     * Отримати всі позиції точок.
     * @returns Масив позицій
     */
    public getPositions(): Vector3[] {
        return this._positions.map(p => p.clone());
    }

    /**
     * Встановити всі позиції точок.
     * @param positions Масив позицій
     */
    public setPositions(positions: Vector3[]): void {
        this._positions = positions.map(p => p.clone());
        this._needsUpdate = true;
        
        // Оновлюємо лінію одразу
        this.updateLine();
    }

    // === Методи - Gradient та Curve ===

    /**
     * Встановити градієнт кольорів.
     * @param keys Масив ключових кадрів (color + time)
     */
    public setColorGradient(keys: GradientColorKey[]): void {
        this._colorGradient = keys.map(k => ({
            color: k.color.clone(),
            time: Math.max(0, Math.min(1, k.time))
        }));
        // Сортуємо за часом
        this._colorGradient.sort((a, b) => a.time - b.time);
        this._needsUpdate = true;
    }

    /**
     * Встановити криву ширини.
     * @param keys Масив ключових кадрів (value + time)
     */
    public setWidthCurve(keys: CurveKey[]): void {
        this._widthCurve = keys.map(k => ({
            value: k.value,
            time: Math.max(0, Math.min(1, k.time))
        }));
        // Сортуємо за часом
        this._widthCurve.sort((a, b) => a.time - b.time);
        this._needsUpdate = true;
    }

    // === Методи - Спрощене API ===

    /**
     * Швидко створити лінію з двох точок.
     * @param start Початкова точка
     * @param end Кінцева точка
     */
    public setLine(start: Vector3, end: Vector3): void {
        this._positions = [start.clone(), end.clone()];
        this._needsUpdate = true;
    }

    /**
     * Очистити всі точки.
     */
    public clear(): void {
        this._positions = [];
        this._needsUpdate = true;
    }

    // === Внутрішні методи ===

    /**
     * Оновити THREE.js геометрію лінії.
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

        // Створюємо масив вершин
        const vertices: number[] = [];

        for (let i = 0; i < this._positions.length; i++) {
            const pos = this._positions[i];
            vertices.push(pos.x, pos.y, pos.z);
        }
        
        // Для loop - додаємо першу точку в кінець
        if (this._loop && this._positions.length > 0) {
            const firstPos = this._positions[0];
            vertices.push(firstPos.x, firstPos.y, firstPos.z);
        }

        // Оновлюємо геометрію
        const geometry = this._threeLine.geometry as THREE.BufferGeometry;
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeBoundingSphere();

        // Встановлюємо колір матеріалу
        const material = this._threeLine.material as THREE.LineBasicMaterial;
        material.color.setRGB(this._startColor.r, this._startColor.g, this._startColor.b);
        material.needsUpdate = true;

        this._needsUpdate = false;
    }

    /**
     * Отримати колір в точці t (0-1).
     * @internal Зарезервовано для градієнтів
     */
    // @ts-ignore - буде використано коли додамо градієнти
    private getColorAtT(t: number): Color {
        // Якщо є градієнт - використовуємо його
        if (this._colorGradient.length >= 2) {
            return this.sampleGradient(t);
        }
        
        // Інакше - лінійна інтерполяція між startColor та endColor
        return this._startColor.clone().lerp(this._endColor, t);
    }

    /**
     * Вибірка кольору з градієнта.
     */
    private sampleGradient(t: number): Color {
        const keys = this._colorGradient;
        
        if (keys.length === 0) return Color.white;
        if (keys.length === 1) return keys[0].color.clone();
        if (t <= keys[0].time) return keys[0].color.clone();
        if (t >= keys[keys.length - 1].time) return keys[keys.length - 1].color.clone();

        // Знаходимо два ключі між якими знаходиться t
        for (let i = 0; i < keys.length - 1; i++) {
            if (t >= keys[i].time && t <= keys[i + 1].time) {
                const localT = (t - keys[i].time) / (keys[i + 1].time - keys[i].time);
                return keys[i].color.clone().lerp(keys[i + 1].color, localT);
            }
        }

        return Color.white;
    }

    /**
     * Оновлення (викликається кожен кадр якщо потрібно).
     */
    public _systemLateUpdate(): void {
        if (this._needsUpdate) {
            this.updateLine();
        }
    }

    // === Реалізація абстрактних методів Renderer ===

  /*  protected override updateMaterial(): void {
        if (!this._threeLine) return;
        
       // const mat = this._materialInstance || this._sharedMaterial;
        
        if (mat) {
            // Для лінії використовуємо LineBasicMaterial
            // TODO: конвертувати Material в LineBasicMaterial
        }
    }*/

   /* protected override updateMaterials(): void {
        this.updateMaterial();
    }*/
}
