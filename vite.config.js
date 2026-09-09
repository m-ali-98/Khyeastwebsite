import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
