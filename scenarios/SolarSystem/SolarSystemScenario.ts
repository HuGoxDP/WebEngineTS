// scenarios/SolarSystem/SolarSystemScenario.ts

import * as Engine from "@engine";
import { OrbitalMotion } from "./scripts/OrbitalMotion";
import { SelfRotation } from "./scripts/SelfRotation";
import { CameraController } from "./scripts/CameraController";
import { MoonOrbit } from "./scripts/MoonOrbit";

/**
 * Сценарій Сонячної Системи.
 * Демонструє планети, що обертаються навколо Сонця.
 * Розміри планет пропорційні реальним (але масштабовані для наочності).
 */
export default class SolarSystemScenario extends Engine.Scenario {

    public async init(): Promise<void> {
        console.log("🌍 Solar System Scenario Loading...");

        // 1. Створюємо Сонце
        this.createSun();

        // 2. Створюємо планети з орбітами (реалістичні пропорції)
        // Формат: назва, радіус планети, відстань від сонця, швидкість орбіти, колір
        
        // Меркурій - найменша планета, найближча до Сонця
        this.createPlanetWithOrbit("Mercury", 0.38, 6, 4.0, new Engine.Color(0.7, 0.7, 0.7, 1));
        
        // Венера - трохи менша за Землю
        this.createPlanetWithOrbit("Venus", 0.95, 10, 1.6, new Engine.Color(0.9, 0.7, 0.4, 1));
        
        // Земля - базовий розмір 1.0, з Місяцем
        this.createEarthWithMoon(14, 1.0);
        
        // Марс - менший за Землю
        this.createPlanetWithOrbit("Mars", 0.53, 20, 0.5, new Engine.Color(0.8, 0.3, 0.2, 1));
        
        // Юпітер - найбільша планета (в 11 разів більша за Землю, але зменшуємо для наочності)
        this.createPlanetWithOrbit("Jupiter", 3.5, 32, 0.08, new Engine.Color(0.9, 0.8, 0.6, 1));
        
        // Сатурн - друга за розміром (з кільцями - TODO)
        this.createPlanetWithOrbit("Saturn", 2.9, 45, 0.03, new Engine.Color(0.9, 0.85, 0.7, 1));

        // 3. Камера
        this.setupCamera();

        // 4. Освітлення
        this.setupLighting();

        console.log("✅ Solar System Ready!");
    }

    /**
     * Створює Землю з Місяцем.
     */
    private createEarthWithMoon(distance: number, speed: number): void {
        // Земля
        const earth = this.createGameObject("Earth");
        
        const earthMeshFilter = earth.addComponent(Engine.MeshFilter);
        earthMeshFilter.sharedMesh = Engine.Mesh.createSphere(1.0, 32);
        
        const earthRenderer = earth.addComponent(Engine.MeshRenderer);
        const earthMaterial = new Engine.StandardMaterial();
        earthMaterial.albedoColor = new Engine.Color(0.2, 0.4, 0.8, 1);
        earthMaterial.metallic = 0.1;
        earthMaterial.smoothness = 0.6;
        earthRenderer.material = earthMaterial;
        
        // Орбіта Землі
        const earthOrbital = earth.addComponent(OrbitalMotion);
        earthOrbital.orbitRadius = distance;
        earthOrbital.orbitSpeed = speed;
        earthOrbital.centerPosition = Engine.Vector3.zero;
        earthOrbital.startAngle = Math.random() * Math.PI * 2;
        
        // Обертання Землі
        const earthRotation = earth.addComponent(SelfRotation);
        earthRotation.rotationSpeed = new Engine.Vector3(0, 30, 0);
        
        // Орбіта Землі (візуалізація)
        this.createOrbit(distance, new Engine.Color(0.2, 0.4, 0.8, 1));
        
        // Місяць
        const moon = this.createGameObject("Moon");
        
        const moonMeshFilter = moon.addComponent(Engine.MeshFilter);
        moonMeshFilter.sharedMesh = Engine.Mesh.createSphere(0.27, 16);
        
        const moonRenderer = moon.addComponent(Engine.MeshRenderer);
        const moonMaterial = new Engine.StandardMaterial();
        moonMaterial.albedoColor = new Engine.Color(0.8, 0.8, 0.8, 1);
        moonMaterial.metallic = 0.0;
        moonMaterial.smoothness = 0.3;
        moonRenderer.material = moonMaterial;
        
        // Місяць обертається навколо Землі
        const moonOrbit = moon.addComponent(MoonOrbit);
        moonOrbit.parentPlanet = earth;
        moonOrbit.orbitRadius = 2.5;
        moonOrbit.orbitSpeed = 3.0;
        
        console.log("🌍 Earth created with 🌙 Moon");
    }

    /**
     * Створює візуалізацію орбіти (коло).
     */
    private createOrbit(radius: number, color: Engine.Color, segments: number = 128): void {
        const orbitObj = this.createGameObject(`Orbit_${radius}`);
        const line = orbitObj.addComponent(Engine.LineRenderer);
        
        line.positionCount = segments;
        line.loop = true;
        
        // Напівпрозорий колір орбіти
        const orbitColor = new Engine.Color(
            Math.min(1, color.r * 0.5 + 0.3), 
            Math.min(1, color.g * 0.5 + 0.3), 
            Math.min(1, color.b * 0.5 + 0.3), 
            1.0
        );
        line.startColor = orbitColor;
        line.endColor = orbitColor;
        
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            line.setPosition(i, new Engine.Vector3(x, 0, z));
        }
    }

    /**
     * Створює планету разом з візуалізацією орбіти.
     */
    private createPlanetWithOrbit(
        name: string,
        radius: number,
        distance: number,
        speed: number,
        color: Engine.Color
    ): void {
        this.createOrbit(distance, color);
        this.createPlanet(name, radius, distance, speed, color);
    }

    private createSun(): void {
        const sun = this.createGameObject("Sun");

        const meshFilter = sun.addComponent(Engine.MeshFilter);
        meshFilter.sharedMesh = Engine.Mesh.createSphere(3.0, 32); // Сонце велике

        const renderer = sun.addComponent(Engine.MeshRenderer);
        const material = new Engine.StandardMaterial();
        material.albedoColor = new Engine.Color(1, 0.9, 0.3, 1);
        material.emissionColor = new Engine.Color(1, 0.8, 0.3, 1);
        renderer.material = material;

        sun.transform.position = Engine.Vector3.zero;

        const rotation = sun.addComponent(SelfRotation);
        rotation.rotationSpeed = new Engine.Vector3(0, 5, 0);

        console.log("☀️ Sun created");
    }

    private createPlanet(
        name: string,
        radius: number,
        distance: number,
        speed: number,
        color: Engine.Color
    ): void {
        const planet = this.createGameObject(name);

        const meshFilter = planet.addComponent(Engine.MeshFilter);
        meshFilter.sharedMesh = Engine.Mesh.createSphere(radius, 16);

        const renderer = planet.addComponent(Engine.MeshRenderer);
        const material = new Engine.StandardMaterial();
        material.albedoColor = color;
        material.metallic = 0.2;
        material.smoothness = 0.5;
        renderer.material = material;

        const orbital = planet.addComponent(OrbitalMotion);
        orbital.orbitRadius = distance;
        orbital.orbitSpeed = speed;
        orbital.centerPosition = Engine.Vector3.zero;
        orbital.startAngle = Math.random() * Math.PI * 2;

        const selfRot = planet.addComponent(SelfRotation);
        selfRot.rotationSpeed = new Engine.Vector3(0, 25, 0);

        console.log(`🌎 ${name} created (r=${radius}, d=${distance})`);
    }

    private setupCamera(): void {
        const cameraObj = this.createGameObject("MainCamera");
        const camera = cameraObj.addComponent(Engine.Camera);

        camera.orthographic = false;
        camera.fieldOfView = 60;
        camera.nearClipPlane = 0.1;
        camera.farClipPlane = 1000;

        // Позиція камери - далі щоб бачити всю систему
        cameraObj.transform.position = new Engine.Vector3(0, 40, 70);
        cameraObj.transform.lookAt(Engine.Vector3.zero);
        
        const controller = cameraObj.addComponent(CameraController);
        controller.moveSpeed = 40;
        controller.rotateSpeed = 0.2;

        console.log("📷 Camera ready");
    }

    private setupLighting(): void {
        const lightObj = this.createGameObject("SunLight");
        const light = lightObj.addComponent(Engine.DirectionalLight);

        light.color = new Engine.Color(1, 0.95, 0.85, 1);
        light.intensity = 2.0;

        lightObj.transform.position = new Engine.Vector3(0, 10, 0);
        lightObj.transform.eulerAngles = new Engine.Vector3(90, 0, 0);

        console.log("💡 Light ready");
    }
}