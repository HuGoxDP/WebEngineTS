/**
 * Режим змішування кольорів при рендерингу.
 */
export const BlendMode = {
    /** Звичайне змішування з урахуванням альфа-каналу */
    Normal: 0,
    /** Адитивне змішування (додавання кольорів) */
    Additive: 1,
    /** Мультиплікативне змішування (множення кольорів) */
    Multiply: 2
} as const;

export type BlendMode = typeof BlendMode[keyof typeof BlendMode];