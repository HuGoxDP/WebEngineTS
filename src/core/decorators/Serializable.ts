import 'reflect-metadata';

/**
 * Декоратор для позначення полів, які треба зберігати.
 * Аналог [SerializeField] в Unity.
 */
export function serializable(target: any, propertyKey: string) {
    // Створюємо список полів для серіалізації в прототипі класу
    if (!target.constructor._serializableFields) {
        target.constructor._serializableFields = [];
    }
    target.constructor._serializableFields.push(propertyKey);
}