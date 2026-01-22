# DirectionalLight

## 📖 Опис

**DirectionalLight** — це компонент для сонячного світла. Світло йде з однієї точки у нескінченності в обраному напрямку.

Ідеально для:
- ☀️ Сонячного світла (день/ніч)
- 🌙 Місячного світла
- 💡 Загального напрямленого світла у сцені

Не ідеально для:
- 🔦 Прожекторів (використовуйте SpotLight)
- 💡 Лампочок (використовуйте PointLight)

**Файл:** `src/engine/core/components/DirectionalLight.ts`

---

## 🔧 API

### Властивості (наслідуються від Light)

```typescript
// Колір світла
directionalLight.color = Color.white;

// Яскравість світла (1 = нормально, 2 = двічі яскравіше)
directionalLight.intensity = 1.2;

// Режим тіней
directionalLight.shadows = LightShadows.Soft;

// Роздільність карти тіней
directionalLight.shadowResolution = LightShadowResolution.High;

// Bias для тіней (запобігає shadow acne)
directionalLight.shadowBias = 0.005;

// Normal bias для тіней
directionalLight.shadowNormalBias = 0.1;

// Сила тіней (0-1)
directionalLight.shadowStrength = 1;
```

### Властивості (специфічні для DirectionalLight)

```typescript
// Дальність світла для тіней (світ space)
directionalLight.shadowDistance = 100;
```

### Методи

```typescript
// Отримати внутрішнє THREE.js світло (для advanced use)
const threeLight = directionalLight.getThreeLight();
```

---

## 💡 Приклади

### Приклад 1: Базовий сонячний світло

```typescript
const sunObject = new GameObject("Sun");
const sunLight = sunObject.addComponent(DirectionalLight);

// Налаштовуємо колір та інтенсивність
sunLight.color = Color.white;
sunLight.intensity = 1;

// Розташування та напрямок
sunObject.transform.position = new Vector3(10, 10, 10);
sunObject.transform.lookAt(Vector3.zero, Vector3.up);  // Дивимось на центр

// Включаємо тіні
sunLight.shadows = LightShadows.Soft;
sunLight.shadowResolution = LightShadowResolution.High;
```

### Приклад 2: Денне світло

```typescript
const sun = new GameObject("Sun");
const sunLight = sun.addComponent(DirectionalLight);

// Яскраве білуваті денне світло
sunLight.color = new Color(1, 1, 0.95, 1);  // Трохи жовтавате
sunLight.intensity = 1.5;

// Позиція на небі (урано)
sun.transform.position = new Vector3(10, 15, 5);
sun.transform.lookAt(Vector3.zero);

// Якісні тіні для дня
sunLight.shadows = LightShadows.Soft;
sunLight.shadowResolution = LightShadowResolution.VeryHigh;
sunLight.shadowDistance = 150;
```

### Приклад 3: Ночі світло (місяць + лампа)

```typescript
// Місячне світло
const moonObject = new GameObject("Moon");
const moonLight = moonObject.addComponent(DirectionalLight);
moonLight.color = new Color(0.6, 0.6, 1, 1);  // Синюватий
moonLight.intensity = 0.3;
moonObject.transform.position = new Vector3(-10, 8, 10);
moonObject.transform.lookAt(Vector3.zero);

// Легкі тіні від місяця
moonLight.shadows = LightShadows.Hard;  // Hard для економії

// Додаємо жовту лампочку для атмосфери
const lampObject = new GameObject("Lamp");
const lampLight = lampObject.addComponent(PointLight);
lampLight.color = Color.yellow;
lampLight.intensity = 1.5;
lampLight.range = 10;
lampObject.transform.position = new Vector3(0, 3, 0);
```

### Приклад 4: Динамічна кількість дня/ночі

```typescript
class DayNightCycle extends ScriptableBehaviour {
    private sunLight: DirectionalLight;
    private sunObject: GameObject;
    
    onAwake() {
        this.sunObject = this.gameObject;
        this.sunLight = this.sunObject.getComponent(DirectionalLight);
    }
    
    onUpdate() {
        // Цикл: день->ніч->день кожні 60 секунд
        const timeInDay = (Time.time % 60) / 60;  // 0-1
        const angle = timeInDay * 360;  // 0-360 градусів
        
        // Обертаємо сонце навколо сцени
        this.sunObject.transform.rotation = 
            Quaternion.euler(45 + angle, 45, 0);
        
        // Міняємо колір та інтенсивність
        if (timeInDay < 0.25) {
            // Ніч → Ранок
            const t = timeInDay / 0.25;
            this.sunLight.intensity = 0.2 + t * 0.8;
            this.sunLight.color = Color.lerp(
                new Color(0.3, 0.3, 0.5, 1),  // Синій (ніч)
                Color.white,                   // Білий (день)
                t
            );
        } else if (timeInDay < 0.5) {
            // Ранок → День
            const t = (timeInDay - 0.25) / 0.25;
            this.sunLight.intensity = 1;
        } else if (timeInDay < 0.75) {
            // День → Вечір
            const t = (timeInDay - 0.5) / 0.25;
            this.sunLight.color = Color.lerp(
                Color.white,
                new Color(1, 0.8, 0.5, 1),  // Оранжевий (закат)
                t
            );
            this.sunLight.intensity = 1 - t * 0.5;
        } else {
            // Вечір → Ніч
            const t = (timeInDay - 0.75) / 0.25;
            this.sunLight.color = Color.lerp(
                new Color(1, 0.8, 0.5, 1),
                new Color(0.3, 0.3, 0.5, 1),  // Синій (ніч)
                t
            );
            this.sunLight.intensity = 0.5 - t * 0.3;
        }
    }
}
```

### Приклад 5: Тіні з оптимізацією

```typescript
const sun = new GameObject("Sun");
const sunLight = sun.addComponent(DirectionalLight);

// Для мобілки - економіємо
sunLight.shadows = LightShadows.Hard;      // Жорсткі тіні (швидше)
sunLight.shadowResolution = LightShadowResolution.Medium;  // 1024

// Для десктопу - якість
sunLight.shadows = LightShadows.Soft;      // М'які тіні
sunLight.shadowResolution = LightShadowResolution.High;    // 2048

// Дальність для оптимізації
sunLight.shadowDistance = 80;  // Не рендерити тіні далі 80м
```

---

## 📊 Напрямок світла

DirectionalLight **ігнорує позицію**, важлива тільки **трансформація (rotation)**:

```typescript
// Правильно - світло з верху вниз
sunObject.transform.position = new Vector3(0, 100, 0);  // Ігнорується
sunObject.transform.rotation = Quaternion.euler(-45, 0, 0);  // Важливо!

// Или з lookAt
sunObject.transform.lookAt(Vector3.zero, Vector3.up);

// Результат: світло гарантовано від (10, 10, 10) у напрямку (0, 0, 0)
```

---

## ⚡ Performance Tips

| Налаштування | Витрати | Рекомендація |
|-------------|---------|-------------|
| Hard shadows | Низькі | Мобілка |
| Soft shadows | Середні | Консоль |
| VeryHigh resolution | Високі | Тільки якісні ПК |
| shadowDistance = 200 | Дорого | Зменшити до 80-100 |

---

## 🎯 Best Practices

```typescript
// ✅ ДОБРЕ - Один DirectionalLight для сонця
const sun = new GameObject("Sun");
const sunLight = sun.addComponent(DirectionalLight);
sunLight.intensity = 1;

// ❌ НЕПРАВИЛЬНО - Кілька DirectionalLights
// Очень дорого! DirectionalLight рендерить глобальне освітлення.

// ✅ ДОБРЕ - Оптимізовані тіні
sunLight.shadows = LightShadows.Soft;
sunLight.shadowResolution = LightShadowResolution.High;
sunLight.shadowDistance = 100;

// ❌ НЕПРАВИЛЬНО - Максимальна якість без причини
sunLight.shadowResolution = LightShadowResolution.VeryHigh;  // 4K!
```

---

## 📋 Related

- [Light.md](./Light.md) — базовий клас
- [Camera.md](./Camera.md) — точка зору
- [StandardMaterial.md](./StandardMaterial.md) — реакція матеріалів на світло

---

**Дата оновлення:** 15 січня 2026
