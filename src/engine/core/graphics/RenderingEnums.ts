/**
 * Всі перелічення (Enums) для системи рендерингу.
 * Створено для використання в різних компонентах та класах.
 */

// ==================== MESH ====================

/**
 * Топологія меша (тип примітивів).
 */
export enum MeshTopology {
    Triangles = 0,    // Стандартні трикутники (3 вершини на примітив)
    Quads = 1,        // Чотирикутники (4 вершини на примітив)
    Lines = 2,        // Лінії (2 вершини на примітив)
    LineStrip = 3,    // Зв'язані лінії
    Points = 4        // Точки (1 вершина на примітив)
}

/**
 * Формат індексів меша.
 */
export enum IndexFormat {
    UInt16 = 0,  // 16-bit індекси (до 65,535 вершин)
    UInt32 = 1   // 32-bit індекси (до 4,294,967,295 вершин)
}

// ==================== TEXTURE ====================

/**
 * Формат текстури (кольоровий формат).
 */
export enum TextureFormat {
    RGBA32 = 0,      // 32-bit RGBA (8 біт на канал)
    RGB24 = 1,       // 24-bit RGB
    Alpha8 = 2,      // 8-bit alpha
    ARGB32 = 3,      // 32-bit ARGB
    RGB565 = 4,      // 16-bit RGB
    R16 = 5,         // 16-bit single channel
    RFloat = 6,      // 32-bit float single channel
    RGFloat = 7,     // 64-bit float dual channel
    RGBAFloat = 8,   // 128-bit float RGBA (HDR)
}

/**
 * Формат render texture.
 */
export enum RenderTextureFormat {
    ARGB32 = 0,
    Depth = 1,
    ARGBHalf = 2,    // 64-bit HDR
    ARGBFloat = 3,   // 128-bit HDR
    RGFloat = 4,
    RGHalf = 5,
    RFloat = 6,
    RHalf = 7,
    R8 = 8,
}

/**
 * Грань кубічної текстури.
 */
export enum CubemapFace {
    PositiveX = 0,  // Права грань
    NegativeX = 1,  // Ліва грань
    PositiveY = 2,  // Верхня грань
    NegativeY = 3,  // Нижня грань
    PositiveZ = 4,  // Передня грань
    NegativeZ = 5   // Задня грань
}

// ==================== MATERIAL ====================

/**
 * Черга рендерингу (визначає порядок відображення).
 */
export enum RenderQueue {
    Background = 1000,      // Фон (skybox)
    Geometry = 2000,        // Звичайна геометрія (opaque)
    AlphaTest = 2450,       // Геометрія з alpha cutoff
    Transparent = 3000,     // Прозорі об'єкти
    Overlay = 4000          // UI та overlay елементи
}

/**
 * Режим рендерингу матеріалу.
 */
export enum MaterialRenderMode {
    Opaque = 0,         // Непрозорий
    Cutout = 1,         // Alpha cutoff (дискардить пікселі < threshold)
    Fade = 2,           // Fade transparency (alpha blending, z-write off)
    Transparent = 3     // Transparent (alpha blending, z-write on)
}

// ==================== RENDERER ====================

/**
 * Режим відкидання тіней.
 */
export enum ShadowCastingMode {
    Off = 0,           // Не кидає тіні
    On = 1,            // Кидає тіні
    TwoSided = 2,      // Двосторонні тіні (обидві сторони полігонів)
    ShadowsOnly = 3    // Тільки тіні (сам об'єкт невидимий, але тінь є)
}

/**
 * Використання light probes.
 */
export enum LightProbeUsage {
    Off = 0,                // Не використовувати light probes
    BlendProbes = 1,        // Змішувати найближчі probes
    UseProxyVolume = 2,     // Використовувати proxy volume
    CustomProvided = 3      // Користувацькі probes
}

/**
 * Використання reflection probes.
 */
export enum ReflectionProbeUsage {
    Off = 0,           // Не використовувати reflection probes
    BlendProbes = 1,   // Змішувати найближчі probes
    Simple = 2         // Використовувати найближчий probe
}

// ==================== CAMERA ====================

/**
 * Прапорці очищення камери.
 */
export enum CameraClearFlags {
    Skybox = 0,       // Відображати skybox
    SolidColor = 1,   // Заливати суцільним кольором
    Depth = 2,        // Очищати тільки depth buffer
    Nothing = 3       // Нічого не очищати (для overlay камер)
}

/**
 * Тип камери.
 */
export enum CameraType {
    Perspective = 0,   // Перспективна проекція
    Orthographic = 1   // Ортографічна проекція
}

// ==================== LIGHT ====================

/**
 * Тип джерела світла.
 */
export enum LightType {
    Directional = 0,  // Напрямлене світло (сонце)
    Point = 1,        // Точкове світло (лампа)
    Spot = 2,         // Прожектор
    Area = 3          // Площинне світло (складно в WebGL)
}

/**
 * Тип тіней від світла.
 */
export enum LightShadows {
    None = 0,     // Без тіней
    Hard = 1,     // Жорсткі тіні
    Soft = 2      // М'які тіні (PCF)
}

/**
 * Режим рендерингу світла.
 */
export enum LightRenderMode {
    Auto = 0,          // Автоматичний вибір
    ForcePixel = 1,    // Форсувати per-pixel освітлення
    ForceVertex = 2    // Форсувати per-vertex освітлення
}

// ==================== SPRITE ====================

/**
 * Режим малювання спрайта.
 */
export enum SpriteDrawMode {
    Simple = 0,    // Простий спрайт
    Sliced = 1,    // 9-slice спрайт
    Tiled = 2      // Тайловий спрайт
}

/**
 * Тип маскування спрайта.
 */
export enum SpriteMaskInteraction {
    None = 0,              // Без взаємодії з маскою
    VisibleInsideMask = 1, // Видимий всередині маски
    VisibleOutsideMask = 2 // Видимий поза маскою
}
