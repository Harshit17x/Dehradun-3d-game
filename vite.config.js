import { defineConfig } from 'vite';

export default defineConfig({
  // Keep the original explorer's assets accessible during development, but
  // this procedural scene needs none of them in its production output.
  build: { copyPublicDir: false, chunkSizeWarningLimit: 700 },
});
