import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// Relative base so `dist/` can be served from any static path. The directory
// picker API requires a secure context, so `file://` is deliberately not a
// supported way to run the built output.
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    // Element Plus components are imported on demand; unused components and
    // their styles never reach the production bundle.
    Components({
      // The declaration file is what lets `vue-tsc` see the auto-imported
      // components; without it the templates would type-check against
      // unregistered globals.
      dts: 'types/components.d.ts',
      resolvers: [ElementPlusResolver({ importStyle: 'css' })],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // ELK is not listed here on purpose: `elkLayout` imports it
        // dynamically, so Rollup already emits it as a chunk of its own that is
        // only fetched once a folder is open and the first layout runs.
        manualChunks: {
          vendor: ['vue', 'pinia'],
        },
      },
    },
    // ELK is ~1.4 MB minified and there is no smaller build of the layout
    // engine; the limit is raised so the warning keeps flagging the app's own
    // chunks rather than a fixed dependency.
    chunkSizeWarningLimit: 1600,
  },
})
