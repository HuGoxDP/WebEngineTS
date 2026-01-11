/// <reference types="vite/client" />

// Дозволяє імпортувати картинки як стрічки
declare module "*.jpg" {
    const value: string;
    export default value;
}

declare module "*.png" {
    const value: string;
    export default value;
}