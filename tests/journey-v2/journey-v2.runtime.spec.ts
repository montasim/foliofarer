import { expect, test } from "@playwright/test"

test("the homepage Journey CTA enters the world without an onboarding chooser", async ({
  page,
}) => {
  await page.goto("/")

  const journeyCta = page.getByRole("link", {
    name: "Open Montasim's 3D journey",
  })
  await expect(journeyCta).toContainText("View my journey")
  await journeyCta.click()

  await expect(page).toHaveURL(/\/journey$/)
  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-journey-mode", "world")
  await expect(page.locator(".journey-onboarding")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "View the Atlas" })
  ).toHaveCount(0)
  await expect(journey).toHaveAttribute("data-scene-ready", "true", {
    timeout: 20_000,
  })
})

test("streams the town in cells and stays inside the draw-call budget", async ({
  page,
}) => {
  const generatedRequests: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith("/journey-v2/generated-next/")) {
      generatedRequests.push(url.pathname)
    }
  })

  await page.goto("/journey")

  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-journey-mode", "world")
  await expect(journey).toHaveAttribute("data-scene-ready", "true", {
    timeout: 20_000,
  })
  await expect(page.locator("canvas")).toHaveCount(1)

  expect(generatedRequests).toContain("/journey-v2/generated-next/index.json")
  expect(generatedRequests).toContain("/journey-v2/generated-next/shared.json")
  expect(generatedRequests).toContain(
    "/journey-v2/generated-next/navigation.json"
  )
  expect(
    generatedRequests.some((path) =>
      path.startsWith("/journey-v2/generated-next/cells/")
    )
  ).toBe(true)
  expect(generatedRequests).not.toContain(
    "/journey-v2/generated-next/world.json"
  )

  const startX = Number(await journey.getAttribute("data-player-x"))
  const startZ = Number(await journey.getAttribute("data-player-z"))
  await page.keyboard.down("w")
  await page.waitForTimeout(1_600)
  await page.keyboard.up("w")

  await expect
    .poll(async () => {
      const x = Number(await journey.getAttribute("data-player-x"))
      const z = Number(await journey.getAttribute("data-player-z"))
      return Math.hypot(x - startX, z - startZ)
    })
    .toBeGreaterThan(0.5)
  expect(Number(await journey.getAttribute("data-player-z"))).toBeLessThan(
    startZ
  )

  await expect
    .poll(
      async () =>
        Number((await journey.getAttribute("data-draw-calls")) ?? "0"),
      { timeout: 8_000 }
    )
    .toBeGreaterThan(0)

  const drawCalls = Number(await journey.getAttribute("data-draw-calls"))
  expect(drawCalls).toBeLessThanOrEqual(100)
})

test("mobile selects the low tier and stays inside its draw-call budget", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/journey")

  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-render-tier", "low")
  await expect(journey).toHaveAttribute("data-journey-mode", "world")
  await expect(journey).toHaveAttribute("data-scene-ready", "true", {
    timeout: 20_000,
  })
  const canvas = page.locator("canvas")
  await expect(canvas).toHaveAttribute("data-journey-v2-quality", "low")
  await expect
    .poll(async () =>
      Number(
        (await canvas.getAttribute("data-journey-v2-active-cells")) ?? "99"
      )
    )
    .toBeLessThanOrEqual(3)

  // Keep the demand-rendered scene active through its calibration window
  // without changing the avatar's position.
  await page.keyboard.down("j")
  await page.waitForTimeout(5_200)
  await page.keyboard.up("j")
  await expect
    .poll(
      async () =>
        Number((await journey.getAttribute("data-draw-calls")) ?? "0"),
      { timeout: 8_000 }
    )
    .toBeGreaterThan(0)

  expect(
    Number(await journey.getAttribute("data-draw-calls"))
  ).toBeLessThanOrEqual(70)
})
