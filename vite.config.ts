import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@engine': path.resolve(__dirname, './src/engine/index.ts')
        }
    },
    server: {
        fs: {
            // Дозволяємо доступ до папки scenarios з кореня проекту
            allow: ['..']
        }
    }
});