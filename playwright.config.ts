import { defineConfig, devices } from '@playwright/test'

/**
 * E2E configuration (DESIGN.md 19.3).
 *
 * The viewer is a static site with no backend, so the tests run against the
 * real built-and-served application. `pnpm build` output is served rather than
 * the dev server: the acceptance criteria are about the production bundle, and
 * a dev-only transform difference should not be able to hide here.
 *
 * Chromium only. `showDirectoryPicker` is a Chromium API and the fallback path
 * is tested through the same engine, so a second browser would double the run
 * time without covering a different branch.
 */
const PORT = 4173
const BASE_URL = `http://127.0.0.1:${String(PORT)}`

export default defineConfig({
  testDir: './e2e',
  // Folder loading, ELK layout and the mocked pickers are all deterministic,
  // so a retry would only mask a real flake.
  retries: 0,
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,
  reporter: process.env['CI'] === undefined ? [['list']] : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    // 1440x900 is the desktop target from DESIGN.md 19.3; the narrow layout is
    // covered by a project of its own below.
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // 1024x768 is the second acceptance viewport: still a desktop layout
      // (the sidebar is a column until 1280), so it must stay fully usable.
      name: 'compact',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
      // The readability measurements run here as well as on the desktop
      // project: a label that fits at 1440px can be clipped at 1024px, which is
      // the failure the design document is written about.
      testMatch: /(screenshots|readability)\.spec\.ts/,
    },
  ],

  webServer: {
    // `vite preview` serves `dist/`, which `pnpm build` produced. Running the
    // build here would make a failing build look like a failing test.
    //
    // `--host 127.0.0.1` is not decoration: the default bind is `localhost`,
    // which resolves to `::1` first on Windows, and the readiness probe against
    // `127.0.0.1` would then time out against a server that is running fine.
    command: `pnpm vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 120_000,
  },
})
