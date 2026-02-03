// scenarios/SolarSystem/scripts/CameraController.ts

import * as Engine from "@engine";

/**
 * Простий контролер камери для орбітального огляду сцени.
 * WASD/Стрілки/ЦФІС - рух, Q/E/Й/У - вгору/вниз, миша - обертання
 */
export class CameraController extends Engine.ScriptableBehaviour {
    
    /** Швидкість переміщення */
    public moveSpeed: number = 20;
    
    /** Швидкість обертання (градуси на піксель) */
    public rotateSpeed: number = 0.3;
    
    /** Поточні кути обертання */
    private _yaw: number = 0;
    private _pitch: number = 0;
    
    /** Стан миші */
    private _isMouseDown: boolean = false;
    private _lastMouseX: number = 0;
    private _lastMouseY: number = 0;
    
    /** Стан клавіш */
    private _keys: { [key: string]: boolean } = {};

    public override start(): void {
        // Ініціалізуємо кути з поточної орієнтації
        const euler = this.transform.eulerAngles;
        this._yaw = euler.y;
        this._pitch = euler.x;
        
        // Слухачі подій
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
        document.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('mouseup', this.onMouseUp);
        document.addEventListener('mousemove', this.onMouseMove);
        
        console.log("[CameraController] Started. Use WASD/ЦФІС to move, mouse to look around.");
    }

    public override update(): void {
        const dt = Engine.Time.deltaTime;
        
        // Обчислюємо напрямки руху
        const forward = this.transform.forward;
        const right = this.transform.right;
        const up = Engine.Vector3.up;
        
        let movement = Engine.Vector3.zero;
        
        // W/Ц/ArrowUp - вперед
        if (this.isKeyPressed('w', 'ц', 'arrowup')) {
            movement = Engine.Vector3.subtract(movement, forward);
        }
        // S/І/Ы/ArrowDown - назад
        if (this.isKeyPressed('s', 'і', 'ы', 'arrowdown')) {
            movement = Engine.Vector3.add(movement, forward);
        }
        // A/Ф/ArrowLeft - вліво
        if (this.isKeyPressed('a', 'ф', 'arrowleft')) {
            movement = Engine.Vector3.subtract(movement, right);
        }
        // D/В/ArrowRight - вправо
        if (this.isKeyPressed('d', 'в', 'arrowright')) {
            movement = Engine.Vector3.add(movement, right);
        }
        
        // E/У/Space - вгору
        if (this.isKeyPressed('e', 'у', ' ')) {
            movement = Engine.Vector3.add(movement, up);
        }
        // Q/Й/Shift - вниз
        if (this.isKeyPressed('q', 'й', 'shift')) {
            movement = Engine.Vector3.subtract(movement, up);
        }
        
        // Застосовуємо рух
        if (movement.magnitude() > 0.01) {
            movement = movement.normalized;
            const delta = Engine.Vector3.scale(movement, this.moveSpeed * dt);
            this.transform.position = Engine.Vector3.add(this.transform.position, delta);
        }
    }
    
    /**
     * Перевіряє чи натиснута одна з клавіш
     */
    private isKeyPressed(...keys: string[]): boolean {
        for (const key of keys) {
            if (this._keys[key.toLowerCase()]) {
                return true;
            }
        }
        return false;
    }
    
    protected override onDestroy(): void {
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('mouseup', this.onMouseUp);
        document.removeEventListener('mousemove', this.onMouseMove);
    }
    
    // === Event Handlers ===
    
    private onKeyDown = (e: KeyboardEvent): void => {
        this._keys[e.key.toLowerCase()] = true;
    };
    
    private onKeyUp = (e: KeyboardEvent): void => {
        this._keys[e.key.toLowerCase()] = false;
    };
    
    private onMouseDown = (e: MouseEvent): void => {
        if (e.button === 0 || e.button === 2) { // Left or right click
            this._isMouseDown = true;
            this._lastMouseX = e.clientX;
            this._lastMouseY = e.clientY;
        }
    };
    
    private onMouseUp = (): void => {
        this._isMouseDown = false;
    };
    
    private onMouseMove = (e: MouseEvent): void => {
        if (!this._isMouseDown) return;
        
        const deltaX = e.clientX - this._lastMouseX;
        const deltaY = e.clientY - this._lastMouseY;
        
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
        
        // Оновлюємо кути
        this._yaw -= deltaX * this.rotateSpeed;
        this._pitch -= deltaY * this.rotateSpeed;
        
        // Обмежуємо pitch щоб не перевернутись
        this._pitch = Math.max(-89, Math.min(89, this._pitch));
        
        // Застосовуємо обертання
        this.transform.eulerAngles = new Engine.Vector3(this._pitch, this._yaw, 0);
    };
}