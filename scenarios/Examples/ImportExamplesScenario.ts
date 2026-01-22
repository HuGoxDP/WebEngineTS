/**
 * scenarios/Examples/ImportExamplesScenario.ts
 * 
 * Демонстрація Unity-Style імпортів в ThreeJS Engine
 */

// ============================================
// Unity-Style Imports
// ============================================
//
// Unity C#:
//   using UnityEngine;
//
// ThreeJS Engine:
//   import { ... } from "@engine";
//
// Все з одного місця - як UnityEngine namespace!
// ============================================

import {
    // Core
    Scenario,
    
    // Math
    Vector3,
    
    // Graphics
    Color,
    StandardMaterial
} from "@engine";

/**
 * Приклад сценарію з Unity-style імпортами
 */
export default class ImportExamplesScenario extends Scenario {
    public async init(): Promise<void> {
        console.log("📦 Unity-Style Import Examples");

        // Демонстрація класів з @engine
        this.demonstrateMath();
        this.demonstrateGraphics();

        console.log("✅ All examples loaded!");
    }

    private demonstrateMath(): void {
        console.log("=== MATH ===");
        
        const v1 = new Vector3(1, 0, 0);
        const v2 = new Vector3(0, 1, 0);
        const result = v1.add(v2);
        
        console.log(`✅ Vector3(1,0,0) + Vector3(0,1,0) = ${JSON.stringify(result)}`);
    }

    private demonstrateGraphics(): void {
        console.log("=== GRAPHICS ===");
        
        const material = new StandardMaterial();
        material.albedoColor = Color.red;
        
        console.log(`✅ StandardMaterial with Color.red created`);
    }
}

// ============================================
// Порівняння з Unity:
// ============================================
//
// Unity C#:
//   using UnityEngine;
//   public class MyScript : MonoBehaviour { ... }
//
// ThreeJS Engine:
//   import { ScriptableBehaviour, Vector3, ... } from "@engine";
//   class MyScript extends ScriptableBehaviour { ... }
//
// ============================================
