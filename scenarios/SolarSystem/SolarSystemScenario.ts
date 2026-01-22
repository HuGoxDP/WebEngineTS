// ============================================
// ThreeJS Engine - Unity-Style Imports
// ============================================
//
// Unity C#:
//   using UnityEngine;
//
// ThreeJS Engine:
//   import { ... } from "@engine";
//
// Все з одного місця - як UnityEngine!
// ============================================

import {
    // Core
    Scenario,
    Time,
    ScriptableBehaviour,
    
    // Math
    Vector3,
    Quaternion,
    
    // Graphics
    Color,
    Mesh,
    StandardMaterial,
    
    // Components
    MeshFilter,
    MeshRenderer,
    Camera,
    DirectionalLight
} from "@engine";

/**
 * Планета в сонячній системі
 */
interface PlanetData {
    name: string;
    radius: number;
    distance: number;     // Від сонця
    speed: number;        // Орбітальна швидкість
    color: Color;
    angle?: number;       // Поточний кут орбіти
}

/**
 * Компонент орбітального руху
 */
class OrbitalMotion extends ScriptableBehaviour {
    public orbitDistance: number = 10;
    public orbitSpeed: number = 0.5;
    public centerPosition: Vector3 = Vector3.zero;
    private angle: number = 0;

    onUpdate(): void {
        this.angle += this.orbitSpeed * Time.deltaTime;

        // Обчислюємо позицію на орбіті (коло в XZ площині)
        const x = Math.cos(this.angle) * this.orbitDistance;
        const z = Math.sin(this.angle) * this.orbitDistance;

        this.gameObject.transform.position = new Vector3(
            this.centerPosition.x + x,
            this.centerPosition.y,
            this.centerPosition.z + z
        );
    }
}

/**
 * Компонент обертання об'єкта навколо своєї осі
 */
class SelfRotation extends ScriptableBehaviour {
    public rotationSpeed: Vector3 = Vector3.zero;

    onUpdate(): void {
        const deltaRotation = new Vector3(
            this.rotationSpeed.x * Time.deltaTime,
            this.rotationSpeed.y * Time.deltaTime,
            this.rotationSpeed.z * Time.deltaTime
        );

        // Отримуємо поточне обертання та додаємо до нього
        const currentRotation = this.gameObject.transform.rotation;
        
        // Створюємо delta обертання
        const deltaQuat = Quaternion.fromEuler(
            deltaRotation.x,
            deltaRotation.y,
            deltaRotation.z
        );

        // Множимо: новий rotation = delta * поточний
        this.gameObject.transform.rotation = deltaQuat.multiply(currentRotation);
    }
}

/**
 * Сценарій сонячної системи
 */
export default class SolarSystemScenario extends Scenario {
    private planets: PlanetData[] = [
        {
            name: "Mercury",
            radius: 0.38,
            distance: 3.8,
            speed: 1.6,
            color: new Color(0.6, 0.6, 0.6, 1)
        },
        {
            name: "Venus",
            radius: 0.95,
            distance: 7.2,
            speed: 1.2,
            color: new Color(1, 0.8, 0.2, 1)
        },
        {
            name: "Earth",
            radius: 1,
            distance: 10,
            speed: 1,
            color: new Color(0.2, 0.5, 1, 1)
        },
        {
            name: "Mars",
            radius: 0.53,
            distance: 15,
            speed: 0.8,
            color: new Color(1, 0.4, 0.2, 1)
        },
        {
            name: "Jupiter",
            radius: 2.5,
            distance: 25,
            speed: 0.4,
            color: new Color(1, 0.8, 0.5, 1)
        },
        {
            name: "Saturn",
            radius: 2.1,
            distance: 35,
            speed: 0.3,
            color: new Color(1, 0.9, 0.7, 1)
        }
    ];

    public async init(): Promise<void> {
        console.log("🌍 Solar System Scenario Loading...");

        // 1. Створюємо сонце
        this.createSun();

        // 2. Створюємо планети
        for (const planetData of this.planets) {
            this.createPlanet(planetData);
        }

        // 3. Налаштовуємо камеру
        this.setupCamera();

        // 4. Налаштовуємо освітлення
        this.setupLighting();

        console.log("✅ Solar System Ready!");
    }

    /**
     * Створює сонце
     */
    private createSun(): void {
        const sun = this.createGameObject("Sun");

        // Додаємо геометрію
        const meshFilter = sun.addComponent(MeshFilter);
        meshFilter.sharedMesh = Mesh.createSphere(1, 32);

        // Додаємо матеріал (світиться)
        const renderer = sun.addComponent(MeshRenderer);
        const sunMaterial = new StandardMaterial();
        sunMaterial.albedoColor = Color.yellow;
        sunMaterial.emissionColor = Color.yellow;
        renderer.material = sunMaterial;

        // Сонце розташоване в центрі
        sun.transform.position = Vector3.zero;

        // Сонце обертається
        const selfRotation = sun.addComponent(SelfRotation);
        selfRotation.rotationSpeed = new Vector3(0, 30, 0);  // Обертається на 30°/сек

        console.log("☀️ Sun created");
    }

    /**
     * Створює планету
     */
    private createPlanet(data: PlanetData): void {
        const planet = this.createGameObject(data.name);

        // Додаємо геометрію
        const meshFilter = planet.addComponent(MeshFilter);
        meshFilter.sharedMesh = Mesh.createSphere(data.radius, 16);

        // Додаємо матеріал
        const renderer = planet.addComponent(MeshRenderer);
        const material = new StandardMaterial();
        material.albedoColor = data.color;
        material.metallic = 0.2;
        material.smoothness = 0.8;
        renderer.material = material;

        // Додаємо орбітальний рух
        const orbital = planet.addComponent(OrbitalMotion);
        orbital.orbitDistance = data.distance;
        orbital.orbitSpeed = data.speed;
        orbital.centerPosition = Vector3.zero;

        // Додаємо самообертання
        const selfRotation = planet.addComponent(SelfRotation);
        selfRotation.rotationSpeed = new Vector3(0, 90, 0);  // Обертається на 90°/сек

        console.log(`🌎 Planet "${data.name}" created (radius: ${data.radius}, distance: ${data.distance})`);
    }

    /**
     * Налаштовує камеру
     */
    private setupCamera(): void {
        const cameraObj = this.createGameObject("MainCamera");
        const camera = cameraObj.addComponent(Camera);

        // Perspective камера для 3D вигляду
        camera.orthographic = false;
        camera.fieldOfView = 60;
        camera.nearClipPlane = 0.1;
        camera.farClipPlane = 1000;
        camera.backgroundColor = new Color(0.01, 0.01, 0.02, 1);  // Космос

        // Розташовуємо камеру
        cameraObj.transform.position = new Vector3(0, 20, 40);
        cameraObj.transform.lookAt(Vector3.zero);

        console.log("📷 Camera setup complete");
    }

    /**
     * Налаштовує освітлення
     */
    private setupLighting(): void {
        const lightObj = this.createGameObject("Sunlight");
        const light = lightObj.addComponent(DirectionalLight);

        // Світло від сонця
        light.color = Color.white;
        light.intensity = 1.5;
        light.shadows = 1;  // LightShadows.Hard

        // Розташовуємо світло як сонце
        lightObj.transform.position = new Vector3(10, 10, 10);
        lightObj.transform.lookAt(Vector3.zero);

        console.log("💡 Lighting setup complete");
    }
}
