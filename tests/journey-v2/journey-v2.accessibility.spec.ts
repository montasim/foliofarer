import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const diagnostics = {
      detachedWebglCanvases: 0,
      probeContextLosses: 0,
      generatedFetches: [] as Array<{
        path: string
        cache: RequestCache | null
      }>,
    }
    Object.defineProperty(window, "__journeyStartupDiagnostics", {
      configurable: true,
      value: diagnostics,
    })

    const probeCanvases = new WeakSet<HTMLCanvasElement>()
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (
        this: HTMLCanvasElement,
        contextId: string,
        ...args: unknown[]
      ) {
        const isWebgl = contextId === "webgl" || contextId === "webgl2"
        const isProbe =
          isWebgl &&
          !this.parentElement &&
          !this.hasAttribute("data-journey-v2-world")
        if (isProbe && !probeCanvases.has(this)) {
          probeCanvases.add(this)
          diagnostics.detachedWebglCanvases += 1
        }
        const context = Reflect.apply(originalGetContext, this, [
          contextId,
          ...args,
        ]) as WebGLRenderingContext | WebGL2RenderingContext | null
        if (context && isProbe) {
          const originalGetExtension = context.getExtension.bind(context)
          Object.defineProperty(context, "getExtension", {
            configurable: true,
            value: (name: string) => {
              const extension = originalGetExtension(name)
              if (name !== "WEBGL_lose_context" || !extension) return extension
              const loseContextExtension = extension as WEBGL_lose_context
              return {
                loseContext: () => {
                  diagnostics.probeContextLosses += 1
                  loseContextExtension.loseContext()
                },
                restoreContext: () => loseContextExtension.restoreContext(),
              }
            },
          })
        }
        return context
      },
    })

    const originalFetch = window.fetch
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: function (
        this: Window,
        input: RequestInfo | URL,
        init?: RequestInit
      ) {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
              ? input.href
              : input
        const parsed = new URL(url, window.location.href)
        if (parsed.pathname.startsWith("/journey-v2/generated")) {
          diagnostics.generatedFetches.push({
            path: parsed.pathname,
            cache:
              init?.cache ?? (input instanceof Request ? input.cache : null),
          })
        }
        return Reflect.apply(originalFetch, this, [input, init])
      },
    })

    window.localStorage.removeItem("montasim-journey-passport-v1")
  })
  await page.goto("/journey")
})

test("starts from a fresh world index with one non-destructive WebGL probe", async ({
  page,
}) => {
  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-journey-mode", "world")
  await expect(journey).toHaveAttribute(
    "data-scene-ready",
    "true",
    { timeout: 20_000 }
  )

  const diagnostics = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __journeyStartupDiagnostics: {
            detachedWebglCanvases: number
            probeContextLosses: number
            generatedFetches: Array<{
              path: string
              cache: RequestCache | null
            }>
          }
        }
      ).__journeyStartupDiagnostics
  )
  expect(diagnostics.detachedWebglCanvases).toBe(1)
  expect(diagnostics.probeContextLosses).toBe(0)

  const indexFetch = diagnostics.generatedFetches.find(
    (entry) => entry.path === "/journey-v2/generated-next/index.json"
  )
  expect(indexFetch?.cache).toBe("no-store")
  const pinnedAssets = diagnostics.generatedFetches.filter(
    (entry) => entry.path !== "/journey-v2/generated-next/index.json"
  )
  expect(pinnedAssets.length).toBeGreaterThan(2)
  expect(pinnedAssets.every((entry) => entry.cache === "force-cache")).toBe(
    true
  )
})

test("opens the complete Atlas from the world without leaving the world", async ({
  page,
}) => {
  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-journey-mode", "world")
  await expect(journey).toHaveAttribute("data-scene-ready", "true", {
    timeout: 20_000,
  })
  await page
    .getByRole("navigation", { name: "Journey tools" })
    .getByRole("button", { name: "Open Atlas" })
    .click()
  await expect(
    page.getByRole("dialog", { name: "The Journey Atlas" })
  ).toBeVisible()
  await expect(journey).toHaveAttribute("data-world-paused", "true")
  await expect(page.locator("canvas")).toHaveCount(1)
  const worldRequests = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => pathname.startsWith("/journey-v2/generated"))
  )
  expect(worldRequests).toContain("/journey-v2/generated-next/index.json")

  const atlas = page.getByRole("dialog", { name: "The Journey Atlas" })
  const storyTrigger = atlas
    .getByRole("listitem")
    .filter({ hasText: "Rangpur Zilla School" })
    .getByRole("button", { name: "Read chapter" })
  await storyTrigger.focus()
  await storyTrigger.press("Enter")

  const dialog = page.getByRole("dialog", {
    name: "Where my curiosity took root.",
  })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Close story" })
  ).toBeFocused()
  await page.keyboard.press("Escape")
  const restoredAtlas = page.getByRole("dialog", {
    name: "The Journey Atlas",
  })
  await expect(restoredAtlas).toBeVisible()
  await expect(
    restoredAtlas.getByRole("button", { name: "Close Atlas" })
  ).toBeFocused()
})

test("direct reading does not create a physical Passport stamp", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "Journey tools" })
    .getByRole("button", { name: "Open Atlas" })
    .click()
  const atlas = page.getByRole("dialog", { name: "The Journey Atlas" })
  const college = atlas
    .getByRole("listitem")
    .filter({ hasText: "Carmichael College" })
  await college.getByRole("button", { name: "Read chapter" }).click()
  await page.getByRole("button", { name: "Continue journey" }).click()
  await page
    .getByRole("dialog", { name: "The Journey Atlas" })
    .getByRole("button", { name: "Return to world" })
    .click()

  await page
    .getByRole("navigation", { name: "Journey tools" })
    .getByRole("button", { name: /Open Passport/ })
    .click()
  const passport = page.getByRole("dialog", { name: "Journey Passport" })
  await expect(
    passport.getByRole("progressbar", { name: "Journey Passport progress" })
  ).toHaveAttribute("aria-valuenow", "0")
  await expect(
    passport.getByRole("listitem").filter({ hasText: "Carmichael College" })
  ).toContainText("Awaiting visit")
})

test("keeps the Atlas available when WebGL is unavailable", async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    const replacement = function (
      this: HTMLCanvasElement,
      contextId: string,
      ...args: unknown[]
    ) {
      if (contextId === "webgl" || contextId === "webgl2") return null
      return Reflect.apply(original, this, [contextId, ...args])
    }
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: replacement,
    })
  })
  await page.goto("/journey")

  await expect(
    page.getByText(/3D rendering is unavailable here/)
  ).toBeVisible()
  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-journey-mode", "map")
  await expect(
    page.getByRole("button", { name: "Explore in 3D" })
  ).toHaveCount(0)
  await expect(
    page.getByRole("heading", { name: "The Journey Atlas" })
  ).toBeVisible()
  await expect(page.locator("canvas")).toHaveCount(0)
  await expect(page.locator(".journey-onboarding")).toHaveCount(0)
  await context.close()
})

test("returns to the complete Atlas if the WebGL context is lost", async ({
  page,
}) => {
  await expect(page.locator("main[data-scene-ready='true']")).toBeVisible({
    timeout: 20_000,
  })

  await page.locator("canvas").evaluate((canvas) => {
    canvas.dispatchEvent(
      new Event("webglcontextlost", { bubbles: false, cancelable: true })
    )
  })

  await expect(
    page.getByRole("heading", { name: "The Journey Atlas" })
  ).toBeVisible()
  await expect(page.getByText(/browser paused the 3D display/)).toBeVisible()
})

test("keeps the world when WebGL recovers inside the grace period", async ({
  page,
}) => {
  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-scene-ready", "true", {
    timeout: 20_000,
  })

  const canvas = page.locator("canvas")
  await canvas.evaluate((element) => {
    element.dispatchEvent(
      new Event("webglcontextlost", { bubbles: false, cancelable: true })
    )
  })
  await expect(journey).toHaveAttribute("data-scene-ready", "false")
  await canvas.evaluate((element) => {
    element.dispatchEvent(new Event("webglcontextrestored"))
  })

  await expect(journey).toHaveAttribute("data-scene-ready", "true", {
    timeout: 5_000,
  })
  await expect(journey).toHaveAttribute("data-journey-mode", "world")
  await expect(
    page.getByRole("heading", { name: "The Journey Atlas" })
  ).toHaveCount(0)
})

test("keeps world chrome restrained and pauses behind professional panels", async ({
  page,
}) => {
  const journey = page.locator("main[data-journey-v2]")
  await expect(journey).toHaveAttribute("data-scene-ready", "true", {
    timeout: 20_000,
  })

  const tools = page.getByRole("navigation", { name: "Journey tools" })
  const atlasTrigger = tools.getByRole("button", { name: "Open Atlas" })
  const passportTrigger = tools.getByRole("button", {
    name: /Open Passport/,
  })
  await expect(atlasTrigger).toBeVisible()
  await expect(passportTrigger).toBeVisible()
  await expect(tools.getByRole("button")).toHaveCount(2)
  await expect(tools.getByRole("button", { name: /Sound/ })).toHaveCount(0)
  await expect(atlasTrigger).toHaveAttribute(
    "data-journey-map-source",
    "generated-next-index"
  )
  await expect(atlasTrigger.locator("[data-journey-map-landmark]")).toHaveCount(
    12
  )
  await expect(
    atlasTrigger.locator("[data-journey-map-water] path")
  ).toHaveCount(5)
  await expect(atlasTrigger.locator("[data-journey-map-player]")).toBeVisible()

  const passportTriggerBox = await passportTrigger.boundingBox()
  const atlasTriggerBox = await atlasTrigger.boundingBox()
  expect(passportTriggerBox).not.toBeNull()
  expect(atlasTriggerBox).not.toBeNull()
  expect(passportTriggerBox!.x).toBeLessThan(atlasTriggerBox!.x)

  await passportTrigger.click()
  await expect(journey).toHaveAttribute("data-world-paused", "true")
  const passport = page.getByRole("dialog", { name: "Journey Passport" })
  const passportBox = await passport.boundingBox()
  expect(passportBox).not.toBeNull()
  expect(passportBox!.x).toBeLessThan(atlasTriggerBox!.x)
  await passport.getByLabel("Close Passport").click()
  await expect(journey).toHaveAttribute("data-world-paused", "false")

  await atlasTrigger.click()
  await expect(journey).toHaveAttribute("data-world-paused", "true")
  const atlas = page.getByRole("dialog", { name: "The Journey Atlas" })
  const atlasBox = await atlas.boundingBox()
  const expandedAtlasTriggerBox = await atlasTrigger.boundingBox()
  expect(atlasBox).not.toBeNull()
  expect(expandedAtlasTriggerBox).not.toBeNull()
  expect(
    expandedAtlasTriggerBox!.width / atlasTriggerBox!.width
  ).toBeGreaterThanOrEqual(1.49)
  expect(
    Math.abs(atlasBox!.x - expandedAtlasTriggerBox!.x)
  ).toBeLessThanOrEqual(2)
  expect(
    Math.abs(atlasBox!.width - expandedAtlasTriggerBox!.width)
  ).toBeLessThanOrEqual(2)
  await atlas.getByRole("button", { name: "Close Atlas" }).click()
  await expect(journey).toHaveAttribute("data-world-paused", "false")
})
