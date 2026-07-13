import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5910, strictPort: true },
  preview: { port: 5911, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
});
