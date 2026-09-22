/// <reference types="vite/client" />

/** Only the variables the app actually reads are declared. */
interface ImportMetaEnv {
  /** Overrides the pinned-source link host; defaults to ArduPilot/ardupilot. */
  readonly VITE_GITHUB_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
