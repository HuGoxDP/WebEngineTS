// path: benchmarks/scenes/scene3Solar.ts

import {
    GameObject, Mesh, MeshFilter, MeshRenderer, StandardMaterial,
    PointLight, AmbientLight, Color, Vector3,
} from "WebEngineTS";
import { Rotator } from "./Rotator.ts";
import { createMainCamera, type SceneInfo } from "./common.ts";

interface PlanetDef {
    name: string;
    radius: number;
    orbitRadius: number;
    orbitDegPerSec: number;
    spinDegPerSec: number;
    color: Color;
}

// Deterministic planet table (relative sizes/distances, not to physical scale).
const PLANETS: readonly PlanetDef[] = [
    { name: "Mercury", radius: 0.30, orbitRadius: 4.0, orbitDegPerSec: 47, spinDegPerSec: 20, color: new Color(0.60, 0.55, 0.50, 1) },
    { name: "Venus",   radius: 0.55, orbitRadius: 5.5, orbitDegPerSec: 35, spinDegPerSec: 12, color: new Color(0.85, 0.70, 0.45, 1) },
    { name: "Earth",   radius: 0.58, orbitRadius: 7.2, orbitDegPerSec: 30, spinDegPerSec: 60, color: new Color(0.25, 0.45, 0.80, 1) },
    { name: "Mars",    radius: 0.42, orbitRadius: 9.0, orbitDegPerSec: 24, spinDegPerSec: 55, color: new Color(0.75, 0.35, 0.22, 1) },
    { name: "Jupiter", radius: 1.20, orbitRadius: 12.0, orbitDegPerSec: 13, spinDegPerSec: 90, color: new Color(0.80, 0.68, 0.52, 1) },
    { name: "Saturn",  radius: 1.05, orbitRadius: 15.0, orbitDegPerSec: 9,  spinDegPerSec: 80, color: new Color(0.85, 0.78, 0.60, 1) },
];

/**
 * Scene 3 — a Solar System educational scenario: a sun with point lighting and
 * six orbiting, spinning planets. The paper's version used PBR-textured planets
 * and a skybox; this variant uses procedural solid-color materials so the scene
 * is fully self-contained and deterministic (no external texture assets).
 *
 * Each planet is a child of an orbit pivot spun by a {@link Rotator}; the planet
 * itself spins via a second Rotator.
 */
export function buildSolarSystem(): SceneInfo {
    // Sun — emissive sphere.
    const sun = new GameObject("Sun");
    sun.addComponent(MeshFilter).sharedMesh = Mesh.createSphere(2, 48);
    const sunMat = new StandardMaterial();
    sunMat.albedoColor = new Color(0, 0, 0, 1);
    sunMat.emissionColor = new Color(1.0, 0.8, 0.3, 1);
    sun.addComponent(MeshRenderer).sharedMaterial = sunMat;
    sun.addComponent(Rotator).degreesPerSecond = new Vector3(0, 8, 0);

    // Point light at the sun.
    const lightGo = new GameObject("Sun Light");
    const pl = lightGo.addComponent(PointLight);
    pl.color = new Color(1.0, 0.95, 0.85, 1);
    pl.intensity = 2.5;
    pl.range = 200;

    // Low ambient fill.
    new GameObject("Ambient").addComponent(AmbientLight).intensity = 0.15;

    for (const p of PLANETS) {
        const pivot = new GameObject(`${p.name} Orbit`);
        pivot.addComponent(Rotator).degreesPerSecond = new Vector3(0, p.orbitDegPerSec, 0);

        const planet = new GameObject(p.name);
        planet.transform.parent = pivot.transform;
        planet.transform.localPosition = new Vector3(p.orbitRadius, 0, 0);
        planet.addComponent(MeshFilter).sharedMesh = Mesh.createSphere(p.radius, 32);

        const mat = new StandardMaterial();
        mat.albedoColor = p.color;
        mat.metallic = 0.0;
        mat.smoothness = 0.3;
        planet.addComponent(MeshRenderer).sharedMaterial = mat;
        planet.addComponent(Rotator).degreesPerSecond = new Vector3(0, p.spinDegPerSec, 0);
    }

    createMainCamera(new Vector3(0, 9, -20), new Vector3(0, 0, 0));

    return {
        label: "Scene 3 — Solar System",
        objects: PLANETS.length * 2 + 3,
        extra: "procedural, no external assets",
    };
}
