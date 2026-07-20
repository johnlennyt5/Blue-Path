import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Stamped when the dev server starts or a build runs — shown in the UI
    // so a stale browser tab / cached bundle is immediately recognizable.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
