import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const serverUrl = process.env.PHAROS_SERVER_URL ?? 'http://localhost:4300';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': serverUrl,
    },
  },
});
