import { defineConfig } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3013)
const useExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1"

export default defineConfig({
  testDir: "./tests/journey-v2",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: "chrome",
    trace: "on-first-retry",
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: `pnpm start -p ${port}`,
        url: `http://127.0.0.1:${port}/`,
        reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
        timeout: 120_000,
      },
})
