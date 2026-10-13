import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const serverUrl = process.env.PHAROS_SERVER_URL ?? 'http://localhost:4300';

/**
 * Libraries in their own chunks (W11.6): they change less often than the app, so the browser
 * keeps them cached across updates, and no chunk passes Vite's 500 kB warning. Heavy catalog
 * blocks are split off separately, by `lazyBlock` (src/catalog/lazy-block.tsx).
 */
const VENDOR_CHUNKS: [name: string, test: RegExp][] = [
  ['react', /node_modules\/\.pnpm\/(react|react-dom|scheduler)@/],
  ['router', /node_modules\/\.pnpm\/(react-router|cookie|set-cookie-parser)@/],
  ['zod', /node_modules\/\.pnpm\/zod@/],
  [
    'markdown',
    /node_modules\/\.pnpm\/(react-markdown|remark-|rehype-|micromark|mdast-|hast-|unist-|unified|vfile|property-information|space-separated|comma-separated|decode-named|character-|ccount|devlop|bail|trough|zwitch|longest-streak|markdown-table|escape-string|is-plain-obj|html-url|trim-lines|estree-|style-to|inline-style)/,
  ],
  ['icons', /node_modules\/\.pnpm\/lucide-react@/],
  ['schema', /packages\/schema\//],
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          return VENDOR_CHUNKS.find(([, test]) => test.test(id))?.[0];
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': serverUrl,
    },
  },
});
