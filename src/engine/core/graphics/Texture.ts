import * as THREE from "three";
import { EngineObject } from "../EngineObject";

/**
 * Режим фільтрації текстур.
 */
export enum FilterMode {
    Point = THREE.NearestFilter,
    Bilinear = THREE.LinearFilter,
    Trilinear = THREE.LinearMipMapLinearFilter
}

/**
 * Режим обробки країв текстури (Wrapping).
 */
export enum TextureWrapMode {
    Repeat = THREE.RepeatWrapping,
    Clamp = THREE.ClampToEdgeWrapping,
    Mirror = THREE.MirroredRepeatWrapping
}

export class Texture extends EngineObject {
    /** @internal */
    public readonly _threeTexture: THREE.Texture;

    // Змінили на private backing field + getter
    private _url: string = "";

    constructor(threeTexture?: THREE.Texture) {
        super("Texture");
        this._threeTexture = threeTexture || new THREE.Texture();

        // Default settings
        this.filterMode = FilterMode.Bilinear;
        this.wrapMode = TextureWrapMode.Repeat;
    }

    // Публічний доступ тільки для читання
    public get url(): string {
        return this._url;
    }

    public static load(url: string): Texture {
        const texture = new Texture();

        // Тепер ми можемо писати в приватне поле, бо ми всередині класу Texture
        texture._url = url;
        texture.name = url.split('/').pop() || "Loaded Texture";

        const loader = new THREE.TextureLoader();

        // Прибрали аргумент 't', щоб не було попередження TS6133
        texture._threeTexture.image = loader.load(url, () => {
            texture._threeTexture.needsUpdate = true;
            if (texture.filterMode === FilterMode.Trilinear) {
                texture._threeTexture.generateMipmaps = true;
            }
        }).image;

        return texture;
    }

    // === Властивості ===

    public get filterMode(): FilterMode {
        return this._threeTexture.magFilter as unknown as FilterMode;
    }

    public set filterMode(value: FilterMode) {
        // Використовуємо 'as any', щоб задовольнити TypeScript
        // (наші Enums сумісні з числами Three.js)
        this._threeTexture.magFilter = value as any;

        if (value === FilterMode.Trilinear) {
            this._threeTexture.minFilter = THREE.LinearMipMapLinearFilter;
            this._threeTexture.generateMipmaps = true;
        } else {
            this._threeTexture.minFilter = value as any;
        }
        this._threeTexture.needsUpdate = true;
    }

    public get wrapMode(): TextureWrapMode {
        return this._threeTexture.wrapS as unknown as TextureWrapMode;
    }

    public set wrapMode(value: TextureWrapMode) {
        this._threeTexture.wrapS = value as any;
        this._threeTexture.wrapT = value as any;
        this._threeTexture.needsUpdate = true;
    }

    public setOffset(x: number, y: number): void {
        this._threeTexture.offset.set(x, y);
    }

    public setTiling(x: number, y: number): void {
        this._threeTexture.repeat.set(x, y);
    }

    protected override onDestroy(): void {
        this._threeTexture.dispose();
    }
}