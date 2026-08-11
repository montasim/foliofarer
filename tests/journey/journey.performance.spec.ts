import { expect, test, type Page } from "@playwright/test"
import { prepareJourney } from "./journey-test-helpers"
import type { JourneyRenderTier } from "../../lib/journey/types"

declare global {
  interface Window {
    __journeyBenchmark?: {
      done: boolean
      frameTimes: number[]
    }
  }
}

const BENCHMARK_DURATION_MS = 30_000

async function getWebGlRenderer(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl")
    if (!context) return "unavailable"
    const extension = context.getExtension("WEBGL_debug_renderer_info")
    return extension
      ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL))
      : String(context.getParameter(context.RENDERER))
  })
}

function percentile(samples: readonly number[], value: number) {
  const ordered = [...samples].sort((first, second) => first - second)
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * value) - 1)
  )
  return ordered[index] ?? Number.POSITIVE_INFINITY
}

async function startFrameSampler(page: Page) {
  await page.evaluate((durationMs) => {
    const benchmark = { done: false, frameTimes: [] as number[] }
    window.__journeyBenchmark = benchmark
    const startedAt = performance.now()
    let previous = startedAt

    const sample = (now: number) => {
      const frameTime = now - previous
      previous = now
      if (frameTime > 0 && frameTime < 250) benchmark.frameTimes.push(frameTime)
      if (now - startedAt < durationMs) {
        window.requestAnimationFrame(sample)
      } else {
        benchmark.done = true
      }
    }

    window.requestAnimationFrame(sample)
  }, BENCHMARK_DURATION_MS)
}

async function exerciseJourney(page: Page) {
  await page.getByRole("button", { name: "Walk route" }).dispatchEvent("click")
  const explore = page.getByRole("button", { name: /Explore Town Square/ })
  await explore.waitFor({ state: "visible", timeout: 25_000 })
  await explore.dispatchEvent("click")
  await expect(page.getByRole("dialog")).toBeVisible()
  await page
    .getByRole("button", { name: "Continue walking" })
    .dispatchEvent("click")

  await page.keyboard.down("KeyW")
  await page.waitForTimeout(2_500)
  await page.keyboard.up("KeyW")

  const canvas = page.locator("canvas")
  const bounds = await canvas.boundingBox()
  if (bounds) {
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    await page.mouse.move(centerX + Math.min(220, bounds.width / 4), centerY, {
      steps: 12,
    })
    await page.mouse.up()
  }
}

async function runBenchmark(
  page: Page,
  viewport: { width: number; height: number },
  renderTier: JourneyRenderTier,
  maximumP95FrameTimeMs: number
) {
  await page.setViewportSize(viewport)
  await prepareJourney(page, renderTier)
  await page.goto("/journey")
  await page.locator('main[data-scene-ready="true"]').waitFor({
    state: "visible",
    timeout: 30_000,
  })
  await page.waitForTimeout(750)

  const renderer = await getWebGlRenderer(page)
  console.info(JSON.stringify({ viewport, renderer }))
  test.skip(
    /swiftshader|llvmpipe|software rasterizer/i.test(renderer),
    `Frame budget requires GPU-backed WebGL; detected ${renderer}`
  )

  await startFrameSampler(page)
  await exerciseJourney(page)
  await page.waitForFunction(() => window.__journeyBenchmark?.done, null, {
    timeout: BENCHMARK_DURATION_MS + 10_000,
  })

  const result = await page.evaluate(() => window.__journeyBenchmark)
  const frameTimes = result?.frameTimes ?? []
  const p95FrameTimeMs = percentile(frameTimes, 0.95)
  const averageFrameTimeMs =
    frameTimes.reduce((total, frameTime) => total + frameTime, 0) /
    frameTimes.length

  console.info(
    JSON.stringify({
      viewport,
      samples: frameTimes.length,
      averageFrameTimeMs: Number(averageFrameTimeMs.toFixed(2)),
      p95FrameTimeMs: Number(p95FrameTimeMs.toFixed(2)),
      finalTier: await page.locator("main").getAttribute("data-render-tier"),
    })
  )

  expect(frameTimes.length).toBeGreaterThan(300)
  expect(p95FrameTimeMs).toBeLessThanOrEqual(maximumP95FrameTimeMs)
}

test.describe("Journey performance budget", () => {
  test.setTimeout(120_000)

  test("desktop traversal meets the 60 FPS target", async ({ page }) => {
    await runBenchmark(page, { width: 1440, height: 900 }, "high", 20)
  })

  test("mid-range mobile tier sustains at least 30 FPS", async ({ page }) => {
    await runBenchmark(page, { width: 390, height: 844 }, "low", 33.3)
  })
})
