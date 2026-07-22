import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // S8-2: Local Mode works fully offline after first load (§12). The
    // service worker precaches the entire app shell including the parser
    // worker chunk; Workspace Mode calls simply fail gracefully offline.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['prismshift-icon.svg'],
      manifest: {
        name: 'PrismShift — Blue Prism → UiPath Migration',
        short_name: 'PrismShift',
        description:
          'Analyze, document, and convert Blue Prism estates entirely in your browser.',
        theme_color: '#0f172a',
        background_color: '#020617',
        display: 'standalone',
        icons: [
          { src: 'prismshift-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // The parser worker + jsPDF chunks are large; raise the precache cap.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  define: {
    // Stamped when the dev server starts or a build runs — shown in the UI
    // so a stale browser tab / cached bundle is immediately recognizable.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
