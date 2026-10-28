import { defineConfig } from 'vite';
export default defineConfig({ build: { lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'pay-qr.js' }, target: 'es2022' } });
