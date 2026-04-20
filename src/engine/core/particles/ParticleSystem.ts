import * as THREE from "three";
import { Behaviour } from "../Behaviour";
import { Time } from "../Time";
import { Color } from "../math/Color";
import { Vector3 } from "../math/Vector3";
import { AnimationCurve } from "../math/AnimationCurve";
import { profilerHooks } from "../diagnostics/ProfilerHooks";
import { ParticleShape } from "./ParticleShape";
import { Gradient } from "./Gradient";
import {
    ParticleSimulationSpace,
    ParticleRenderMode,
} from "./ParticleTypes";
import type { GameObject } from "../GameObject";

/** A timed burst of particles emitted in a single frame. */
export class ParticleBurst {
    constructor(
        /** Seconds from Play() when this burst fires. */
        public time: number,
        /** Number of particles emitted by this burst. */
        public count: number,
    ) {}
}

/**
 * Emits and simulates particles using a pre-allocated GPU buffer.
 *
 * @remarks
 * Equivalent to Unity's `ParticleSystem`. Uses `THREE.Points` internally
 * for efficient GPU-accelerated rendering. Particles are billboard sprites
 * that always face the camera.
 *
 * ```ts
 * const fx = go.addComponent(ParticleSystem);
 * fx.startLifetime = 2;
 * fx.startSpeed = 3;
 * fx.emissionRate = 50;
 * fx.shape.type = ParticleShapeType.Cone;
 * fx.play();
 * ```
 */
export class ParticleSystem extends Behaviour {

    // ==================== STATIC REGISTRY ====================

    /** @internal */
    private static _activeInstances: Set<ParticleSystem> = new Set();

    /**
     * @internal
     * Updates all active particle systems. Called once per frame from
     * Application._loop after Update, before LateUpdate.
     */
    public static _updateAll(): void {
        const dt = Time.deltaTime;
        for (const ps of ParticleSystem._activeInstances) {
            if (ps.isActiveAndEnabled) ps._simulate(dt);
        }
    }

    /** @internal */
    public static _reset(): void {
        ParticleSystem._activeInstances.clear();
    }

    // ==================== MAIN MODULE ====================

    /** How long emission lasts (seconds). */
    public duration: number = 5;

    /** If true, the system restarts after {@link duration} elapses. */
    public looping: boolean = true;

    /** Delay in seconds before emission begins after {@link play}. */
    public startDelay: number = 0;

    /** Lifetime of each particle in seconds. */
    public startLifetime: number = 1;

    /** Initial speed of each particle along its spawn direction. */
    public startSpeed: number = 5;

    /** Initial size (diameter in world units) of each particle. */
    public startSize: number = 0.1;

    /** Initial color of each particle. */
    public startColor: Color = Color.white.clone();

    /** Gravity multiplier (1 = full gravity in -Y). */
    public gravityModifier: number = 0;

    /** Maximum particles alive at once. Determines GPU buffer size. */
    public maxParticles: number = 1000;

    /** Whether particles move with the GameObject or stay in world space. */
    public simulationSpace: ParticleSimulationSpace = ParticleSimulationSpace.Local;

    /** Whether {@link play} is called automatically on enable. */
    public playOnAwake: boolean = true;

    // ==================== EMISSION MODULE ====================

    /** Constant rate of particles per second. */
    public emissionRate: number = 10;

    /** Bursts that fire at specific times during the system's duration. */
    public bursts: ParticleBurst[] = [];

    // ==================== SHAPE MODULE ====================

    /** Emitter shape. */
    public readonly shape: ParticleShape = new ParticleShape();

    // ==================== OVER-LIFETIME MODULES ====================

    /** Size multiplier curve evaluated over each particle's normalized lifetime. */
    public sizeOverLifetime: AnimationCurve | null = null;

    /** Color gradient evaluated over each particle's normalized lifetime. */
    public colorOverLifetime: Gradient | null = null;

    /** Constant velocity added each frame (world units / second). */
    public velocityOverLifetime: Vector3 | null = null;

    // ==================== RENDERER MODULE ====================

    /** Render mode. */
    public renderMode: ParticleRenderMode = ParticleRenderMode.Billboard;

    /** Optional sprite texture applied to each particle. */
    public particleTexture: THREE.Texture | null = null;

    // ==================== INTERNAL STATE ====================

    private _playing: boolean = false;
    private _paused: boolean = false;
    private _time: number = 0;
    private _delayRemaining: number = 0;
    private _emissionAccumulator: number = 0;
    private _burstsFired: boolean[] = [];

    // Particle state (parallel arrays; index < _aliveCount are alive).
    private _px!: Float32Array; private _py!: Float32Array; private _pz!: Float32Array;
    private _vx!: Float32Array; private _vy!: Float32Array; private _vz!: Float32Array;
    private _startLife!: Float32Array;
    private _remainLife!: Float32Array;
    private _startS!: Float32Array;
    private _r!: Float32Array; private _g!: Float32Array; private _b!: Float32Array; private _a!: Float32Array;
    private _startR!: Float32Array; private _startG!: Float32Array; private _startB!: Float32Array; private _startA!: Float32Array;
    private _aliveCount: number = 0;

    // Three.js objects (buffers and rendered Points).
    private _geometry: THREE.BufferGeometry | null = null;
    private _material: THREE.ShaderMaterial | null = null;
    private _points: THREE.Points | null = null;
    private _posAttr: THREE.BufferAttribute | null = null;
    private _sizeAttr: THREE.BufferAttribute | null = null;
    private _colorAttr: THREE.BufferAttribute | null = null;

    // Scratch vectors for sampling.
    private static readonly _tmpPos = new Vector3();
    private static readonly _tmpDir = new Vector3();
    private static readonly _tmpColor = new Color();

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    // ==================== PROPERTIES ====================

    /** Whether the system is currently emitting and simulating. */
    public get isPlaying(): boolean { return this._playing && !this._paused; }

    /** Whether the system is paused. */
    public get isPaused(): boolean { return this._paused; }

    /** Whether the system is stopped (neither playing nor paused). */
    public get isStopped(): boolean { return !this._playing && !this._paused; }

    /** Current number of alive particles. */
    public get particleCount(): number { return this._aliveCount; }

    /** Time elapsed since {@link play} was called. */
    public get time(): number { return this._time; }

    // ==================== PUBLIC METHODS ====================

    /** Begins emission and simulation. */
    public play(): void {
        this._playing = true;
        this._paused = false;
        this._time = 0;
        this._delayRemaining = this.startDelay;
        this._emissionAccumulator = 0;
        this._burstsFired = new Array(this.bursts.length).fill(false);
    }

    /** Pauses the system without clearing existing particles. */
    public pause(): void {
        if (this._playing) this._paused = true;
    }

    /** Resumes a paused system. */
    public unPause(): void {
        this._paused = false;
    }

    /**
     * Stops emission.
     * @param clearParticles If true, also removes all alive particles.
     */
    public stop(clearParticles: boolean = false): void {
        this._playing = false;
        this._paused = false;
        if (clearParticles) this.clear();
    }

    /** Removes all alive particles. */
    public clear(): void {
        this._aliveCount = 0;
        this._syncAttributes();
    }

    /** Manually emits `count` particles at the current position. */
    public emit(count: number): void {
        for (let i = 0; i < count; i++) this._emitOne();
    }

    // ==================== LIFECYCLE ====================

    protected override onAwake(): void {
        this._allocateBuffers();
        this._buildPoints();
    }

    protected override onEnable(): void {
        ParticleSystem._activeInstances.add(this);
        if (this._points) this._points.visible = true;
        if (this.playOnAwake) this.play();
    }

    protected override onDisable(): void {
        ParticleSystem._activeInstances.delete(this);
        if (this._points) this._points.visible = false;
    }

    protected override onDestroy(): void {
        ParticleSystem._activeInstances.delete(this);
        if (this._points) {
            this.transform._removeInternalChild(this._points);
            this._points = null;
        }
        this._geometry?.dispose();
        this._material?.dispose();
        this._geometry = null;
        this._material = null;
    }

    // ==================== PRIVATE: ALLOCATION ====================

    private _allocateBuffers(): void {
        const n = this.maxParticles;
        this._px = new Float32Array(n); this._py = new Float32Array(n); this._pz = new Float32Array(n);
        this._vx = new Float32Array(n); this._vy = new Float32Array(n); this._vz = new Float32Array(n);
        this._startLife  = new Float32Array(n);
        this._remainLife = new Float32Array(n);
        this._startS     = new Float32Array(n);
        this._r = new Float32Array(n); this._g = new Float32Array(n); this._b = new Float32Array(n); this._a = new Float32Array(n);
        this._startR = new Float32Array(n); this._startG = new Float32Array(n); this._startB = new Float32Array(n); this._startA = new Float32Array(n);
    }

    private _buildPoints(): void {
        const n = this.maxParticles;

        this._geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(n * 3);
        const sizes = new Float32Array(n);
        const colors = new Float32Array(n * 4);

        this._posAttr = new THREE.BufferAttribute(positions, 3);
        this._sizeAttr = new THREE.BufferAttribute(sizes, 1);
        this._colorAttr = new THREE.BufferAttribute(colors, 4);
        this._posAttr.setUsage(THREE.DynamicDrawUsage);
        this._sizeAttr.setUsage(THREE.DynamicDrawUsage);
        this._colorAttr.setUsage(THREE.DynamicDrawUsage);

        this._geometry.setAttribute("position", this._posAttr);
        this._geometry.setAttribute("aSize", this._sizeAttr);
        this._geometry.setAttribute("aColor", this._colorAttr);
        this._geometry.setDrawRange(0, 0);

        this._material = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: this.particleTexture },
                uUseMap: { value: this.particleTexture ? 1 : 0 },
                uPixelScale: { value: 300 },
            },
            vertexShader: _VERT,
            fragmentShader: _FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
        });

        this._points = new THREE.Points(this._geometry, this._material);
        this._points.frustumCulled = false;
        this.transform._addInternalChild(this._points);
    }

    // ==================== PRIVATE: SIMULATION ====================

    private _simulate(dt: number): void {
        if (!this._playing || this._paused) return;
        if (!this._geometry || !this._posAttr || !this._sizeAttr || !this._colorAttr) return;

        // ── Handle start delay ──
        if (this._delayRemaining > 0) {
            this._delayRemaining -= dt;
            if (this._delayRemaining > 0) return;
            dt += this._delayRemaining; // use the overshoot
            this._delayRemaining = 0;
        }

        this._time += dt;

        // ── Emission ──
        const emitting = this.looping || this._time <= this.duration;

        if (emitting) {
            // Continuous emission
            this._emissionAccumulator += this.emissionRate * dt;
            while (this._emissionAccumulator >= 1) {
                this._emitOne();
                this._emissionAccumulator -= 1;
            }

            // Bursts
            const cycleTime = this.looping ? this._time % this.duration : this._time;
            for (let i = 0; i < this.bursts.length; i++) {
                if (!this._burstsFired[i] && cycleTime >= this.bursts[i].time) {
                    this.emit(this.bursts[i].count);
                    this._burstsFired[i] = true;
                }
            }

            // Reset burst flags at the start of a new loop.
            if (this.looping && cycleTime < dt) {
                for (let i = 0; i < this._burstsFired.length; i++) this._burstsFired[i] = false;
            }
        } else if (!this.looping && this._time > this.duration && this._aliveCount === 0) {
            this._playing = false;
        }

        // ── Update alive particles ──
        const g = this.gravityModifier * -9.81;
        const vol = this.velocityOverLifetime;
        const sizeCurve = this.sizeOverLifetime;
        const colorGrad = this.colorOverLifetime;
        const posAttr = this._posAttr.array as Float32Array;
        const sizeAttr = this._sizeAttr.array as Float32Array;
        const colorAttr = this._colorAttr.array as Float32Array;
        const tmpColor = ParticleSystem._tmpColor;

        let write = 0;
        for (let i = 0; i < this._aliveCount; i++) {
            const life = this._remainLife[i] - dt;
            if (life <= 0) continue; // particle dies; skip compaction write

            // Velocity
            let vx = this._vx[i], vy = this._vy[i], vz = this._vz[i];
            if (vol) { vx += vol.x; vy += vol.y; vz += vol.z; }
            vy += g * dt;
            this._vx[i] = vx; this._vy[i] = vy; this._vz[i] = vz;

            // Position
            const px = this._px[i] + vx * dt;
            const py = this._py[i] + vy * dt;
            const pz = this._pz[i] + vz * dt;
            this._px[i] = px; this._py[i] = py; this._pz[i] = pz;

            // Age and lifetime-based modulations
            const startLife = this._startLife[i];
            const age01 = startLife > 0 ? 1 - life / startLife : 1;

            let size = this._startS[i];
            if (sizeCurve) size *= sizeCurve.evaluate(age01);

            let cr = this._startR[i], cg = this._startG[i], cb = this._startB[i], ca = this._startA[i];
            if (colorGrad) {
                colorGrad.evaluate(age01, tmpColor);
                cr *= tmpColor.r; cg *= tmpColor.g; cb *= tmpColor.b; ca *= tmpColor.a;
            }

            // Compact into write slot
            if (write !== i) {
                this._px[write] = px; this._py[write] = py; this._pz[write] = pz;
                this._vx[write] = vx; this._vy[write] = vy; this._vz[write] = vz;
                this._startLife[write] = startLife;
                this._startS[write] = this._startS[i];
                this._startR[write] = this._startR[i];
                this._startG[write] = this._startG[i];
                this._startB[write] = this._startB[i];
                this._startA[write] = this._startA[i];
            }
            this._remainLife[write] = life;
            this._r[write] = cr; this._g[write] = cg; this._b[write] = cb; this._a[write] = ca;

            // GPU buffers (mirrored for rendering)
            const w3 = write * 3;
            const w4 = write * 4;
            posAttr[w3]     = px;
            posAttr[w3 + 1] = py;
            posAttr[w3 + 2] = pz;
            sizeAttr[write] = size;
            colorAttr[w4]     = cr;
            colorAttr[w4 + 1] = cg;
            colorAttr[w4 + 2] = cb;
            colorAttr[w4 + 3] = ca;

            write++;
        }

        this._aliveCount = write;
        this._syncAttributes();

        // Update map uniform if texture changed at runtime
        if (this._material) {
            this._material.uniforms.uMap.value = this.particleTexture;
            this._material.uniforms.uUseMap.value = this.particleTexture ? 1 : 0;
        }
    }

    private _emitOne(): void {
        if (this._aliveCount >= this.maxParticles) return;

        const i = this._aliveCount;
        const shape = this.shape;
        const pos = ParticleSystem._tmpPos;
        const dir = ParticleSystem._tmpDir;
        shape._sample(pos, dir);

        this._px[i] = pos.x; this._py[i] = pos.y; this._pz[i] = pos.z;
        this._vx[i] = dir.x * this.startSpeed;
        this._vy[i] = dir.y * this.startSpeed;
        this._vz[i] = dir.z * this.startSpeed;

        this._startLife[i]  = this.startLifetime;
        this._remainLife[i] = this.startLifetime;
        this._startS[i]     = this.startSize;
        this._startR[i] = this.startColor.r; this._r[i] = this.startColor.r;
        this._startG[i] = this.startColor.g; this._g[i] = this.startColor.g;
        this._startB[i] = this.startColor.b; this._b[i] = this.startColor.b;
        this._startA[i] = this.startColor.a; this._a[i] = this.startColor.a;

        this._aliveCount++;
    }

    private _syncAttributes(): void {
        if (!this._geometry || !this._posAttr || !this._sizeAttr || !this._colorAttr) return;
        this._posAttr.needsUpdate = true;
        this._sizeAttr.needsUpdate = true;
        this._colorAttr.needsUpdate = true;
        this._geometry.setDrawRange(0, this._aliveCount);
    }
}

// ==================== SHADERS ====================

const _VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uPixelScale;
void main() {
    vColor = aColor;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (uPixelScale / max(0.0001, -mvPos.z));
    gl_Position = projectionMatrix * mvPos;
}
`;

const _FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform int uUseMap;
varying vec4 vColor;
void main() {
    vec4 tex = vec4(1.0);
    if (uUseMap == 1) {
        tex = texture2D(uMap, gl_PointCoord);
    } else {
        // Default: soft circle falloff
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d);
        float a = smoothstep(0.5, 0.35, r);
        tex = vec4(1.0, 1.0, 1.0, a);
    }
    gl_FragColor = vColor * tex;
    if (gl_FragColor.a < 0.01) discard;
}
`;

profilerHooks.particleSystemCount = () => (ParticleSystem as any)._activeInstances.size;
profilerHooks.aliveParticleCount = () => {
    let total = 0;
    for (const ps of (ParticleSystem as any)._activeInstances as Set<ParticleSystem>) {
        total += ps.particleCount;
    }
    return total;
};
