import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Flask serves the build from /static, so assets load from /static/assets/...
export default defineConfig({ base: '/static/', plugins: [react()], build: { chunkSizeWarningLimit: 3000 } });
