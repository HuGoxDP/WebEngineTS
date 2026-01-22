# 🎮 Unity-like 3D Engine - Інструкції для Copilot

## 📋 ОСНОВНА ІНФОРМАЦІЯ

**Проект:** Хмарна платформа для 3D сценаріїв (дипломний проект)  
**Мова:** TypeScript  
**Рендер-ядро:** Three.js (приховано від користувача!)  
**Архітектура:** Строга імітація Unity C# API  
**Інтеграція:** Потім Angular (сайт університету)

---

## 🎯 ГОЛОВНИЙ ПРИНЦИП

**Three.js = Внутрішній движок. Користувач НЕ бачить Three.js!**

```typescript
// ❌ ЗАБОРОНЕНО для користувача:
import * as THREE from 'three';
new THREE.Mesh(...);

// ✅ ПРАВИЛЬНО для користувача:
import { Mesh, MeshRenderer, StandardMaterial } from 'engine';
const mesh = Mesh.CreateCube();
```

---

## 📝 ПЛАН ДІЙ ПРИ СТВОРЕННІ КЛАСУ

Використовуй субагент "Plan" для аналізу:

1. **Аналіз Unity** - як реалізовано в Unity C# (НІЧОГО НЕ УПУСКАЙ)
2. **План** - що повинно бути реалізовано (методи, властивості, події)
3. **Код** - реалізація з повною абстракцією Three.js
4. **Документація** - `.md` файл з прикладами

---

## 🔧 КОНВЕНЦІЇ КОДУ

### Коментарі
```typescript
// ✅ Українською мовою
// Обчислення нормалі для поверхні
const normal = Vector3.cross(v1, v2);
```

### Приховування Three.js
```typescript
class Texture extends EngineObject {
    /** @internal - НЕ використовувати напряму! */
    public readonly _threeTexture: THREE.Texture;
    
    // Публічний API - абстракція
    public get width(): number { ... }
}
```

### Патерн sharedX vs X (як в Unity)
```typescript
class MeshRenderer extends Renderer {
    // sharedMaterial - спільний (не копіюється)
    get sharedMaterial(): Material { return this._sharedMaterial; }
    
    // material - копія для редагування
    get material(): Material {
        if (!this._materialInstance) {
            this._materialInstance = this._sharedMaterial.clone();
        }
        return this._materialInstance;
    }
}
```

### Zero-Allocation Pattern
```typescript
// Використовуй параметр 'out' для уникнення алокацій
static add(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
    const result = out || new Vector3();
    result.x = a.x + b.x;
    // ...
    return result;
}
```

---

## 📁 СТРУКТУРА ПРОЕКТУ

```
src/engine/core/
├── math/              # Математика (Vector, Matrix, Bounds...)
├── graphics/          # Графіка (Mesh, Material, Texture...)
├── components/        # Компоненти (MeshRenderer, Camera, Light...)
├── Application.ts     # Головний клас двигуна
├── GameObject.ts      # Ігровий об'єкт
├── Component.ts       # Базовий компонент
├── Behaviour.ts       # Компонент з enabled
└── Transform.ts       # Трансформації
```

---

## 📚 ПОСИЛАННЯ

- **Аудит:** `.github/АУДИТ.md`
- **План розробки:** `.github/ПЛАН_РОЗРОБКИ.md`
- **План реалізації:** `.github/ПЛАН_РЕАЛІЗАЦІЇ.md`
- **Документація:** `.github/docs/`

---

## ⚠️ ВАЖЛИВО

1. **Один крок за раз** - не робити все одразу
2. **Нічого не упускати** - повна імітація Unity API
3. **Перевіряти компіляцію** - `npm run build` після змін
4. **Документація** - кожен публічний клас має `.md` файл
