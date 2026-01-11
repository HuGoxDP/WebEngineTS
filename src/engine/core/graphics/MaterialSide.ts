/**
 * Визначає, яку сторону полігонів рендерити.
 */
export const MaterialSide = {
    /** Рендерити тільки передню сторону (за замовчуванням) */
    Front: 0,
    /** Рендерити тільки задню сторону */
    Back: 1,
    /** Рендерити обидві сторони */
    Double: 2
} as const;

export type MaterialSide = typeof MaterialSide[keyof typeof MaterialSide];