import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* The Persian face is discovered only after the CSS has downloaded and
   parsed, so the first text paints in Tahoma and reflows when Vazirmatn
   arrives. The filename is content-hashed at build time, so the preload tag
   cannot be written by hand in index.html — it is injected from the bundle. */
function preloadPersianFont() {
  return {
    name: 'preload-persian-font',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      const file = Object.keys(ctx.bundle || {}).find((f) => /vazirmatn-arabic-.*\.woff2$/.test(f));
      if (!file) return html;
      return {
        html,
        tags: [
          {
            tag: 'link',
            injectTo: 'head-prepend',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: '' },
          },
        ],
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadPersianFont()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    cssCodeSplit: true,
    /* Slow connections: keep the first paint payload small and let long-lived
       vendor code be cached separately from our frequently-changing app code. */
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils'))
            return 'motion';
          if (id.includes('react-router')) return 'router';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('scheduler')) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
