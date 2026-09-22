import { createPinia } from 'pinia'
import type { App as VueApp } from 'vue'

import { installSemanticTokens } from '@/styles/semanticTokens'

export interface BootstrapResult {
  pinia: ReturnType<typeof createPinia>
}

/**
 * Prepares the runtime once, before the root component mounts.
 *
 * Semantic colour tokens are installed here rather than declared in CSS so the
 * legend and the canvas share one palette table (DESIGN.md 15.2). Browser
 * directory capabilities are not probed here: `useFolderSession()` owns them,
 * so the welcome page and the folder actions cannot disagree about what the
 * browser supports.
 */
export function bootstrap(app: VueApp): BootstrapResult {
  installSemanticTokens()

  const pinia = createPinia()
  app.use(pinia)

  return { pinia }
}
