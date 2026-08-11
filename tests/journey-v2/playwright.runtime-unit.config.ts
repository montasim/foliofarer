import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: /journey-v3\.(?:runtime-.*|code-materials)\.spec\.ts/,
  fullyParallel: true,
  workers: 1,
  reporter: "line",
})
