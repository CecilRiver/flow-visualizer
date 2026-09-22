import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    // The same on-demand resolution the production build uses, so a component
    // test mounts the real `ElButton` rather than an unresolved stub. The style
    // side-effect is left off: jsdom applies no CSS, and the injected
    // `element-plus/theme-chalk/*.css` import is not something Node can load.
    Components({
      dts: false,
      resolvers: [ElementPlusResolver({ importStyle: false })],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.spec.ts', 'tests/component/**/*.spec.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: false,
    server: {
      deps: {
        // elkjs ships an ESM bundle that must not be externalised by jsdom.
        inline: ['elkjs'],
      },
    },
  },
})
