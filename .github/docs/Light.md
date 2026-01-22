# Light

## 📖 Опис

**Light** — це абстрактний базовий клас для всіх типів світла у сцені. Управляє кольором, інтенсивністю та тінями.

**Це абстрактний клас!** Використовуйте конкретні типи:
- **DirectionalLight** — сонячне світло
- **PointLight** — точкове світло (лампочка)
- **SpotLight** — прожектор

**Файл:** `src/engine/core/components/Light.ts`

---

## 🔧 API

### Властивості — Основні

```typescript
// Колір світла
light.color = Color.white;

// Яскравість світла (1 = нормально)
light.intensity = 1.5;

// Інтенсивність для Global Illumination
light.bounceIntensity = 1;

// Сила тіней (0 = прозорі, 1 = повні)
light.shadowStrength = 1;
```

### Властивості — Тіні

```typescript
// Режим тіней
light.shadows = LightShadows.Soft;  // Soft shadows = красиво

// Роздільність карти тіней
light.shadowResolution = LightShadowResolution.High;  // 2048x2048

// Bias для тіней (запобігає shadow acne)
light.shadowBias = 0.005;

// Normal bias для тіней
light.shadowNormalBias = 0.1;
```

### Enum — LightShadows

```typescript
enum LightShadows {
    None = 0,  // Без тіней (швидко)
    Hard = 1,  // Жорсткі тіні (швидче)
    Soft = 2   // М'які тіні (гарно, повільніше)
}
```

### Enum — LightShadowResolution

```typescript
enum LightShadowResolution {
    Low = 0,       // 512x512 (швидко)
    Medium = 1,    // 1024x1024 (нормально)
    High = 2,      // 2048x2048 (гарно)
    VeryHigh = 3   // 4096x4096 (дорого)
}
```

---

## 💡 Приклади

### Приклад 1: Базове світло

```typescript
const lightObj = new GameObject("DirectionalLight");
const light = lightObj.addComponent(DirectionalLight);

// Налаштовуємо
light.color = Color.white;
light.intensity = 1.2;

// Розташування (напрямок для DirectionalLight)
lightObj.transform.position = new Vector3(10, 10, 10);
lightObj.transform.lookAt(Vector3.zero, Vector3.up);
```

### Приклад 2: Soft shadows

```typescript
const light = gameObject.addComponent(DirectionalLight);

// М'які тіні для якісного результату
light.shadows = LightShadows.Soft;
light.shadowResolution = LightShadowResolution.High;
light.shadowBias = 0.005;

// Дорого для продуктивності! Аркадні гри можуть використовувати Hard.
```

### Приклад 3: Нічна сцена

```typescript
const sunLight = lightObj.addComponent(DirectionalLight);

// Слабке денне світло
sunLight.color = new Color(0.2, 0.2, 0.3, 1);  // Синіший голубий
sunLight.intensity = 0.3;

// Додаємо лампочку для наголосу
const lampLight = lampObj.addComponent(PointLight);
lampLight.color = Color.yellow;
lampLight.intensity = 1.5;
lampLight.range = 10;
```

### Приклад 4: Shadow acne fix

```typescript
const light = gameObject.addComponent(DirectionalLight);

// Якщо бачимо полосати артифакти на тінях
light.shadowBias = 0.01;     // Збільшити bias
light.shadowNormalBias = 0.2; // Збільшити normal bias

// Це може спричинити peter panning (тіні тратать від об'єктів)
// Потрібен баланс!
```

### Приклад 5: Динамічне світло

```typescript
class PulsingLight extends ScriptableBehaviour {
    private light: Light;
    
    onAwake() {
        this.light = this.gameObject.getComponent(DirectionalLight);
    }
    
    onUpdate() {
        // Пульсує яскравість
        const pulse = Math.sin(Time.time * 2) * 0.5 + 0.5;  // 0-1
        this.light.intensity = 0.5 + pulse * 0.5;  // 0.5-1.0
    }
}
```

---

## 📊 Типи світла та їх параметри

| Тип | Форма | Дальність | Напрямок |
|-----|-------|-----------|----------|
| DirectionalLight | Напрямлене | Нескінчена | Трансформація об'єкта |
| PointLight | Сферичне | Обмежена `range` | Від позиції |
| SpotLight | Конус | Обмежена | Напрямок + angle |

---

## ⚙️ Shadow Acne та Peter Panning

### Shadow Acne (полоски на тінях)
```
Причина: Неточності у floating-point
Лікування: Збільшити shadowBias

❌ shadowBias = 0.0      (много артифактів)
✅ shadowBias = 0.005    (оптимально)
✅ shadowBias = 0.01     (більш smooth)
```

### Peter Panning (тіні тратають від об'єктів)
```
Причина: Занадто великий bias
Лікування: Зменшити shadowBias або shadowNormalBias

❌ shadowBias = 0.1      (тіні летять)
✅ shadowBias = 0.005    (добре)
```

---

## 🎯 Best Practices

```typescript
// ✅ ДОБРЕ - Одне DirectionalLight для сонця
const sunLight = sceneRoot.addComponent(DirectionalLight);
sunLight.intensity = 1.2;
sunLight.shadowResolution = LightShadowResolution.High;

// ❌ НЕПРАВИЛЬНО - Все світло на максимум
light.intensity = 10;        // Занадто яскраво!
light.shadows = LightShadows.Soft;
light.shadowResolution = LightShadowResolution.VeryHigh;  // Дорого!

// ✅ ДОБРЕ - Баланс якості та продуктивності
light.shadows = LightShadows.Soft;
light.shadowResolution = LightShadowResolution.High;  // 2048x2048
light.shadowBias = 0.005;

// ❌ НЕПРАВИЛЬНО - Динамічне світло без shadow rendering optimization
// DirectionalLight завжди рендерить тіні - це дорого!
// Для динамічного: використовуйте меньші тіні або динамічні PointLights
```

---

## 📋 Related

- [DirectionalLight.md](./DirectionalLight.md) — реалізація для сонця
- [Camera.md](./Camera.md) — точка зору
- [StandardMaterial.md](./StandardMaterial.md) — як матеріалі реагують на світло

---

**Дата оновлення:** 15 січня 2026
