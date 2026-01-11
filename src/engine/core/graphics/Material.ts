import * as THREE from 'three';
import { EngineObject } from '../EngineObject';
import { Color } from './Color';

/**
 * Base class for all materials.
 * Wraps THREE.Material to hide Three.js dependency.
 */
export class Material extends EngineObject {
    /** @internal Internal Three.js material */
    protected _threeMaterial: THREE.Material;

    constructor(threeMaterial?: THREE.Material) {
        super();
        this._threeMaterial = threeMaterial ?? new THREE.MeshBasicMaterial();
    }

    // ===== Common properties =====

    public get transparent(): boolean {
        return this._threeMaterial.transparent;
    }

    public set transparent(value: boolean) {
        this._threeMaterial.transparent = value;
    }

    public get opacity(): number {
        return this._threeMaterial.opacity;
    }

    public set opacity(value: number) {
        this._threeMaterial.opacity = value;
    }

    public get visible(): boolean {
        return this._threeMaterial.visible;
    }

    public set visible(value: boolean) {
        this._threeMaterial.visible = value;
    }

    public get side(): number {
        return this._threeMaterial.side;
    }

    public set side(value: number) {
        this._threeMaterial.side = value;
    }

    public get depthTest(): boolean {
        return this._threeMaterial.depthTest;
    }

    public set depthTest(value: boolean) {
        this._threeMaterial.depthTest = value;
    }

    public get depthWrite(): boolean {
        return this._threeMaterial.depthWrite;
    }

    public set depthWrite(value: boolean) {
        this._threeMaterial.depthWrite = value;
    }

    // ===== Internal access =====

    /** @internal Returns internal THREE.Material */
    public get _internal(): THREE.Material {
        return this._threeMaterial;
    }

    // ===== Lifecycle =====

    /**
     * Called when the material is destroyed.
     * Disposes of GPU resources.
     */
    protected onDestroy(): void {
        this._threeMaterial.dispose();
    }
}
